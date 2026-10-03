// Verify the local-art route.
//
// The route is what makes a swappable character possible: DSH's client route only
// serves `client.*.js`, so clips have to come from the host. Two behaviours matter
// most and are asserted first:
//
//   1. A fresh clone has no `assets/local/`, and that must read as
//      `{ available: false }` — not an error, and not a crash.
//   2. The filename parameter is attacker-reachable, so traversal and type
//      confusion must be refused.
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readdirSync } from 'node:fs';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)));
const ROOT = resolve(HERE, '..');
const ART_DIR = join(ROOT, 'assets', 'local');

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'OK  ' : 'FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`);
}

// ---------------------------------------------------------------- harness
const routes = new Map();
const ctx = {
  inject: (n, fn) => fn(ctx),
  effect: (fn) => fn,
  on() {},
  logger: { warn() {}, info() {}, debug() {} },
  webServer: { register({ path, handler }) { routes.set(path, handler); return () => {}; } },
};
const mod = await import(pathToFileURL(resolve(ROOT, 'lib/index.js')).href);
mod.apply(ctx);

const handler = routes.get('/pudding-pet/art');
check('art route registered', typeof handler === 'function');

/** Drive the route; resolves with status, headers and body. */
function call(query) {
  return new Promise((resolveCall) => {
    const chunks = [];
    const res = {
      statusCode: 0,
      _headers: {},
      writeHead(code, h) { res.statusCode = code; res._headers = h || {}; },
      end(data) {
        if (data) chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
        resolveCall({ status: res.statusCode, headers: res._headers, body: Buffer.concat(chunks) });
      },
      on() {}, removeListener() {},
    };
    const req = {
      method: 'GET',
      url: '/pudding-pet/art' + (query ? '?' + query : ''),
      headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin', origin: 'dsh-app://app' },
    };
    handler(req, res).catch((e) => resolveCall({ status: 0, headers: {}, body: Buffer.from(String(e)) }));
  });
}

// ---------------------------------------------------------------- fence
console.log('\n=== fence ===');
{
  const r = await new Promise((resolveCall) => {
    const res = {
      statusCode: 0, _headers: {},
      writeHead(c, h) { res.statusCode = c; res._headers = h || {}; },
      end() { resolveCall(res.statusCode); },
      on() {}, removeListener() {},
    };
    const req = {
      method: 'POST', url: '/pudding-pet/art',
      headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' },
    };
    handler(req, res).catch(() => resolveCall(0));
  });
  check('a non-GET request is refused (405)', r === 405, 'status=' + r);
}

// ---------------------------------------------------------------- manifest
console.log('\n=== manifest ===');
const installed = existsSync(join(ART_DIR, 'manifest.json'));
console.log(installed
  ? '  (local art is installed in this working copy)'
  : '  (no local art in this working copy — testing the absent case)');
{
  const r = await call('');
  check('answers 200', r.status === 200, 'status=' + r.status);
  const json = JSON.parse(r.body.toString('utf8'));
  check('reports ok', json.ok === true);

  if (installed) {
    check('reports art available', json.available === true);
    check('lists clips', json.clips && Object.keys(json.clips).length > 0,
      'clips=' + Object.keys(json.clips || {}).length);
    check('lists files', Array.isArray(json.files) && json.files.length > 0,
      'files=' + (json.files || []).length);
    check('carries a state mapping', json.states && Object.keys(json.states).length > 0,
      'states=' + Object.keys(json.states || {}).length);
    check('names a character', !!(json.character && json.character.id), json.character && json.character.id);
    // Every advertised clip must exist on disk, so a client request cannot 404.
    const onDisk = new Set(readdirSync(ART_DIR));
    const missing = Object.values(json.clips).filter((c) => !onDisk.has(c.file)).map((c) => c.file);
    check('every advertised clip exists on disk', missing.length === 0, missing.join(',') || 'none');
  } else {
    check('reports art NOT available', json.available === false);
    check('returns an empty file list', Array.isArray(json.files) && json.files.length === 0);
  }
}

// ---------------------------------------------------------------- file safety
console.log('\n=== filename safety ===');
for (const bad of [
  '../manifest.json',
  '..%2Fmanifest.json',
  'a/b.webp',
  '.hidden.webp',
  'blink.exe',
  'blink',
  'blink.webp.bak',
  '',
]) {
  const r = await call('name=' + encodeURIComponent(bad));
  // An empty name is the manifest request, which is legitimate.
  const expected = bad === '' ? 200 : (r.status === 400 || r.status === 404);
  check(`refuses ${JSON.stringify(bad)}`, expected, 'status=' + r.status);
}

// ---------------------------------------------------------------- a real file
console.log('\n=== serving a file ===');
if (installed) {
  const manifest = JSON.parse((await call('')).body.toString('utf8'));
  const first = Object.values(manifest.clips)[0];
  const r = await call('name=' + encodeURIComponent(first.file));
  check('serves a listed clip (200)', r.status === 200, 'status=' + r.status);
  check('content-type is image/webp', r.headers['content-type'] === 'image/webp', r.headers['content-type']);
  check('body is non-empty', r.body.length > 0, 'bytes=' + r.body.length);
  // A WebP starts with "RIFF" and has "WEBP" at offset 8.
  const riff = r.body.slice(0, 4).toString('latin1') === 'RIFF';
  const webp = r.body.slice(8, 12).toString('latin1') === 'WEBP';
  check('payload is a real WebP', riff && webp, riff ? 'RIFF ok' : 'no RIFF');
} else {
  const r = await call('name=blink.webp');
  check('absent art yields 404, not 500', r.status === 404, 'status=' + r.status);
}

const failed = results.filter((r) => !r.pass);
console.log('\n' + (failed.length
  ? `FAILED (${failed.length}/${results.length}): ${failed.map((f) => f.name).join('; ')}`
  : `all ${results.length} checks passed`));
process.exit(failed.length ? 1 : 0);
