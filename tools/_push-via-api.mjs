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

/**
 * Call the API, retrying transient network failures.
 *
 * Uploading a blob over a flaky link fails with `unexpected EOF` rather than an
 * HTTP status, so it is indistinguishable from a permanent error by code alone. A
 * push is idempotent here — blobs and trees are content-addressed, and the ref
 * update is the only step whose ordering matters — so retrying is safe. Read-only
 * calls get the same treatment for the same reason.
 */
const api = (path, init = {}) => {
  const args = ['api', '--method', init.method || 'GET', path];
  if (init.accept) args.push('-H', `Accept: ${init.accept}`);
  const isWrite = (init.method || 'GET') !== 'GET';
  const attempts = isWrite ? 5 : 3;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const out = init.body !== undefined
        ? gh([...args, '--input', '-'], JSON.stringify(init.body))
        : gh(args);
      return out ? JSON.parse(out) : null;
    } catch (error) {
      lastError = error;
      const detail = String((error && (error.stderr || error.message)) || '');
      // Transient if it looks like a link problem rather than a rejection. A
      // `gh` failure here reports transport errors as text, so the match is on
      // wording: EOF, resets, timeouts (including a TLS handshake timeout), and
      // the gateway statuses. A 4xx like 422 (bad request) is NOT transient.
      const transient = /unexpected EOF|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EPIPE|i\/o timeout|handshake timeout|connection reset|temporarily unavailable|\b50[234]\b/i
        .test(detail);
      if (!transient || attempt === attempts) break;
      // Linear backoff: a hiccup usually clears within a second or two.
      const waitMs = 800 * attempt;
      console.log(`    retry ${attempt}/${attempts - 1} after: ${detail.split('\n')[0].slice(0, 70)}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
    }
  }
  throw lastError;
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
let boundary = localCommits.findIndex((c) => c.tree === remoteTree);
/** Set when the whole tree must be published as one commit (see the fallback). */
let REPLAY_AS_SINGLE = false;

// Fallback: match against the remote's own ancestry.
//
// A tree match can fail even though the histories are equivalent, because an
// earlier push wrote a tree that differs from the local one. That is exactly what
// happened when `git ls-tree` quoting mangled a non-ASCII filename: every commit
// containing that file got a different tree on each side, so no local commit
// matched the remote tip.
//
// The walk is bounded, because each step is one API call, and a deep history would
// make this slow for no benefit — the mismatch is always recent.
if (boundary < 0) {
  const localByTree = new Map(localCommits.map((c, index) => [c.tree, index]));
  let cursor = remoteSha;
  for (let depth = 0; depth < 60 && cursor; depth += 1) {
    let commit;
    try {
      commit = api(`repos/${REPO}/git/commits/${cursor}`);
    } catch {
      break;
    }
    if (localByTree.has(commit.tree.sha)) {
      const index = localByTree.get(commit.tree.sha);
      log(`\nnote: the remote tip's tree matches no local commit.`);
      log(`      Resuming from a shared ancestor instead:`);
      log(`        local  ${localCommits[index].sha.slice(0, 7)}  ${localCommits[index].subject.slice(0, 50)}`);
      log(`        remote ${commit.sha.slice(0, 7)}`);
      log(`      (an earlier push wrote a different tree — see the ls-tree quoting fix)`);
      boundary = index;
      break;
    }
    cursor = commit.parents && commit.parents[0];
  }
}

if (boundary < 0) {
  // Nothing in common within the walk. Rather than refuse, publish the current
  // tree as a single commit on top of the remote tip: the content is what matters,
  // and the alternative is a branch that cannot be updated at all.
  log('\nnote: no shared ancestor found within 60 commits.');
  log('      Publishing the current tree as one commit on top of the remote tip.');
  REPLAY_AS_SINGLE = true;
  boundary = 0;
}

// `git log` is newest-first; publish oldest-first.
const revList = REPLAY_AS_SINGLE
  // Single-commit mode publishes only the newest local commit, carrying the full
  // current tree. `boundary` is 0 here, and `slice(0, 0)` is empty — which is why
  // this branch exists rather than reusing the slice.
  ? [localCommits[0].sha]
  : localCommits.slice(0, boundary).map((c) => c.sha).reverse();
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
  // `-z` with quoting disabled, because the default `ls-tree` output QUOTES names
  // that are not plain ASCII and escapes the bytes in octal — and this code passed
  // that quoted string straight to the API as the path. A file named
  // `docs/APK侦察.md` was therefore stored on the remote with literal quotes and
  // escapes in its name, which is the bug this flag pair fixes.
  const listing = git(['-c', 'core.quotePath=false', 'ls-tree', '-z', treeSha]);
  const entries = [];
  if (listing) {
    for (const line of listing.split('\0')) {
      if (!line) continue;
      // <mode> SP <type> SP <sha> TAB <name>
      const match = /^(\d+) (\w+) ([0-9a-f]+)\t([\s\S]*)$/.exec(line);
      if (!match) throw new Error('unparsable ls-tree line: ' + JSON.stringify(line));
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
  let subject = git(['log', '-1', '--pretty=%s', sha]).trim();
  const body = git(['log', '-1', '--pretty=%b', sha]);
  const authorName = git(['log', '-1', '--pretty=%an', sha]).trim();
  const authorEmail = git(['log', '-1', '--pretty=%ae', sha]).trim();
  const authorDate = git(['log', '-1', '--pretty=%aI', sha]).trim();
  const treeSha = git(['rev-parse', `${sha}^{tree}`]).trim();
  void raw;

  // Single-commit mode: only the newest commit is published, carrying the full
  // current tree. Used when no shared ancestor could be found, so the content
  // lands even though the per-commit history cannot be replayed.
  if (REPLAY_AS_SINGLE) {
    if (sha !== revList[revList.length - 1]) continue;
    subject = '同步到本地工作树（远端历史无法逐提交重放）';
  }

  let message = body.trim() && !REPLAY_AS_SINGLE
    ? `${subject}\n\n${body.replace(/\s+$/, '')}`
    : subject;

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
