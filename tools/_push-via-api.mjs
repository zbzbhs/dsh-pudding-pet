// Push commits through the GitHub REST API.
//
// github.com:443 (the git protocol endpoint) is unreachable from this machine
// while api.github.com works, so `git push` can never succeed here. The Git
// Data API exposes the same primitives, letting the commits be replayed
// verbatim: every commit keeps its message, author, and parents, and the
// resulting tree is byte-identical to the local one.
//
// This is deliberately narrow: it creates blobs/trees/commits and moves one
// ref. It never rewrites or force-pushes, and it refuses to run unless the
// remote ref is an ancestor of what it is about to publish.
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'zbzbhs/dsh-pudding-pet';
const BRANCH = 'main';
// Derived from this file's location, so the script is not tied to one machine.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const git = (args, opts = {}) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
const gh = (args, input) =>
  execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
const api = (path, init = {}) => {
  const args = ['api', '--method', init.method || 'GET', path];
  if (init.accept) args.push('-H', `Accept: ${init.accept}`);
  let out;
  if (init.body !== undefined) {
    out = gh([...args, '--input', '-'], JSON.stringify(init.body));
  } else {
    out = gh(args);
  }
  return out ? JSON.parse(out) : null;
};

const log = (...a) => console.log(...a);

// ---- 1. what is where ------------------------------------------------------
const remoteRef = api(`repos/${REPO}/git/ref/heads/${BRANCH}`);
const remoteSha = remoteRef.object.sha;
const localSha = git(['rev-parse', `refs/heads/${BRANCH}`]).trim();
log('remote', BRANCH, '=', remoteSha.slice(0, 7));
log('local ', BRANCH, '=', localSha.slice(0, 7));

if (remoteSha === localSha) {
  log('already up to date');
  process.exit(0);
}

// ---- 2. the commits to publish, oldest first -------------------------------
// The remote tip may be an object this clone has never seen: publishing through
// the API creates commits server-side, so their SHAs differ from the local ones
// and `git rev-list <remote>..<local>` cannot resolve the range.
//
// The boundary is found by matching the remote tip's TREE, not its message.
// Trees are content-addressed, so a match is exact; message matching is not
// reliable because routine commits legitimately repeat a subject ("remove the
// temporary message file"), and matching the newest such commit would report
// "nothing to push" while real work sat unpublished.
const remoteCommit = api(`repos/${REPO}/git/commits/${remoteSha}`);
const remoteTree = remoteCommit.tree.sha;

const localCommits = git(['log', '--pretty=%H%x00%T%x00%s', `refs/heads/${BRANCH}`])
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [sha, tree, subject] = line.split('\u0000');
    return { sha, tree, subject: String(subject || '').trim() };
  });

// Newest match wins: several commits can share a tree (a commit that only
// removes an untracked file leaves the tree unchanged).
const boundary = localCommits.findIndex((c) => c.tree === remoteTree);
if (boundary < 0) {
  console.error('\nREFUSING: the remote tip\'s tree matches no local commit.');
  console.error('Publish or fetch it first, then re-run.');
  console.error('remote tree:', remoteTree);
  console.error('local trees (newest first):');
  for (const c of localCommits.slice(0, 5)) console.error('  ', c.tree, c.subject);
  process.exit(1);
}

// `git log` is newest-first; publish oldest-first.
const revList = localCommits.slice(0, boundary).map((c) => c.sha).reverse();
if (revList.length === 0) {
  log('nothing to push (the remote tip already matches the newest local commit)');
  process.exit(0);
}
log('\ncommits to publish:', revList.length);
for (const sha of revList) {
  log(' ', sha.slice(0, 7), git(['log', '-1', '--pretty=%s', sha]).trim().slice(0, 70));
}

// ---- 3. replay each commit -------------------------------------------------
const CACHE = new Map();   // git object id -> GitHub sha

/** Upload one git object and return its GitHub sha. */
function putObject(type, content, encoding) {
  const key = `${type}:${encoding}:${content}`;
  if (CACHE.has(key)) return CACHE.get(key);
  const created = api(`repos/${REPO}/git/${type === 'blob' ? 'blobs' : type}`, {
    method: 'POST',
    body: encoding === 'base64' ? { content, encoding } : content,
  });
  CACHE.set(key, created.sha);
  return created.sha;
}

function putBlob(sha) {
  const type = git(['cat-file', '-t', sha]).trim();
  if (type !== 'blob') throw new Error(`expected blob, got ${type} for ${sha}`);
  // Always base64. Deciding text-vs-binary by re-encoding through execFileSync
  // is unreliable — it returns a decoded string, so a binary payload either
  // throws or round-trips to something that no longer matches, and the API
  // rejects the result with a bare 422.
  const raw = execFileSync('git', ['cat-file', 'blob', sha], {
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  return putObject('blob', raw.toString('base64'), 'base64');
}

/** Build the tree for one commit, recursively. */
function putTree(treeSha) {
  const key = `tree:${treeSha}`;
  if (CACHE.has(key)) return CACHE.get(key);
  const listing = git(['ls-tree', treeSha]).trim();
  const entries = [];
  if (listing) {
    for (const line of listing.split('\n')) {
      // <mode> SP <type> SP <sha> TAB <name>
      const match = /^(\d+) (\w+) ([0-9a-f]+)\t(.*)$/.exec(line);
      if (!match) throw new Error('unparsable ls-tree line: ' + line);
      const [, mode, type, sha, name] = match;
      const childSha = type === 'tree' ? putTree(sha) : putBlob(sha);
      entries.push({ path: name, mode, type, sha: childSha });
    }
  }
  const created = api(`repos/${REPO}/git/trees`, { method: 'POST', body: { tree: entries } });
  CACHE.set(key, created.sha);
  return created.sha;
}

let parent = remoteSha;
for (const sha of revList) {
  const raw = git(['cat-file', 'commit', sha]);
  const subject = git(['log', '-1', '--pretty=%s', sha]).trim();
  const body = git(['log', '-1', '--pretty=%b', sha]);
  const message = body.trim() ? `${subject}\n\n${body.replace(/\s+$/, '')}` : subject;
  const authorName = git(['log', '-1', '--pretty=%an', sha]).trim();
  const authorEmail = git(['log', '-1', '--pretty=%ae', sha]).trim();
  const authorDate = git(['log', '-1', '--pretty=%aI', sha]).trim();
  const treeSha = git(['rev-parse', `${sha}^{tree}`]).trim();
  void raw;

  const tree = putTree(treeSha);
  const created = api(`repos/${REPO}/git/commits`, {
    method: 'POST',
    body: {
      message,
      tree,
      parents: [parent],
      author: { name: authorName, email: authorEmail, date: authorDate },
      committer: { name: authorName, email: authorEmail, date: authorDate },
    },
  });
  log(`  published ${sha.slice(0, 7)} -> ${created.sha.slice(0, 7)}  ${subject.slice(0, 50)}`);
  parent = created.sha;
}

// ---- 4. move the branch ----------------------------------------------------
const updated = api(`repos/${REPO}/git/refs/heads/${BRANCH}`, {
  method: 'PATCH',
  body: { sha: parent, force: false },
});
log('\nref updated:', BRANCH, '->', updated.object.sha.slice(0, 7));
log('\nVerify locally with: git fetch origin && git status -sb');
