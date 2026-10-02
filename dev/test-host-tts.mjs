// Verify the host half end to end, including a real synthesis call.
//
// The route handlers are captured through a mocked `webServer` and then driven
// with mocked req/res objects, so this exercises the same code the Host would
// run: the fence, the parameter clamping, the cache, and the real Edge TTS call.
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)));
const ROOT = resolve(HERE, '..');

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'OK  ' : 'FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`);
}

// ---------------------------------------------------------------- harness
const routes = new Map();
const effects = [];

const webServer = {
  register({ kind, path, handler }) {
    routes.set(path, { kind, path, handler });
    return () => routes.delete(path);
  },
};

const ctx = {
  inject(names, fn) { fn(ctx); },
  effect(fn) { effects.push(fn); return fn; },
  on() {},
  logger: { warn: (m) => console.log('    [host warn]', m), info() {}, debug() {} },
};
ctx.webServer = webServer;

const mod = await import(pathToFileURL(resolve(ROOT, 'lib/index.js')).href);
console.log('=== exports ===');
check('exports name', typeof mod.name === 'string', mod.name);
check('exports apply', typeof mod.apply === 'function');

mod.apply(ctx);

console.log('\n=== routes registered ===');
check('tts route registered', routes.has('/pudding-pet/tts'));
check('voices route registered', routes.has('/pudding-pet/voices'));
check('both are exact matches', [...routes.values()].every((r) => r.kind === 'exact'));

/** Drive one route with a fake request/response. */
function call(path, { query = '', method = 'GET', headers = {}, host = '127.0.0.1:3080' } = {}) {
  return new Promise((resolveCall) => {
    const route = routes.get(path);
    if (!route) return resolveCall({ status: 0, headers: {}, body: null, error: 'no route' });

    const chunks = [];
    const res = {
      statusCode: 0,
      _headers: {},
      writeHead(code, h) { res.statusCode = code; res._headers = h || {}; },
      end(data) {
        if (data) chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
        resolveCall({
          status: res.statusCode,
          headers: res._headers,
          body: Buffer.concat(chunks),
        });
      },
      on() {},
      removeListener() {},
      once() {},
      emit() {},
    };
    const req = {
      method,
      url: path + (query ? '?' + query : ''),
      headers: { host, 'sec-fetch-site': 'same-origin', origin: 'dsh-app://app', ...headers },
    };
    route.handler(req, res).catch((error) => resolveCall({ status: 0, error: String(error && error.message) }));
  });
}

// ---------------------------------------------------------- fence checks
console.log('\n=== fence ===');
{
  const r = await call('/pudding-pet/tts', { query: 'text=hi', method: 'POST' });
  check('POST is refused (405)', r.status === 405, 'status=' + r.status);
}
{
  const r = await call('/pudding-pet/tts', { query: 'text=hi', headers: { 'sec-fetch-site': 'cross-site' } });
  check('cross-site is refused (403)', r.status === 403, 'status=' + r.status);
}
{
  const r = await call('/pudding-pet/tts', {
    query: 'text=hi',
    headers: { origin: 'https://evil.example' },
  });
  check('foreign origin is refused (403)', r.status === 403, 'status=' + r.status);
}
{
  const r = await call('/pudding-pet/tts', { query: '' });
  check('missing text is refused (400)', r.status === 400, 'status=' + r.status);
}

// ------------------------------------------------------- synthesis (live)
console.log('\n=== live synthesis (network) ===');
let first = null;
{
  const query = new URLSearchParams({
    text: '你好呀，我是布丁。',
    voice: 'zh-CN-XiaoyiNeural',
    pitch: '+50Hz',
  }).toString();
  const r = await call('/pudding-pet/tts', { query });
  first = r;
  check('synthesized (200)', r.status === 200, 'status=' + r.status);
  check('content-type is audio/mpeg', r.headers['content-type'] === 'audio/mpeg', r.headers['content-type']);
  check('returned real audio bytes', r.body && r.body.length > 2000, 'bytes=' + (r.body ? r.body.length : 0));
  check('first call is a cache miss', r.headers['x-pudding-cache'] === 'miss', r.headers['x-pudding-cache']);
  // An MP3 begins with an ID3 tag or a sync word; check for either.
  if (r.body && r.body.length > 3) {
    const id3 = r.body.slice(0, 3).toString('latin1') === 'ID3';
    const sync = r.body[0] === 0xff && (r.body[1] & 0xe0) === 0xe0;
    check('payload looks like MP3', id3 || sync, id3 ? 'ID3' : (sync ? 'sync word' : 'unknown'));
  }
}

console.log('\n=== cache ===');
{
  const query = new URLSearchParams({ text: '你好呀，我是布丁。', voice: 'zh-CN-XiaoyiNeural', pitch: '+50Hz' }).toString();
  const r = await call('/pudding-pet/tts', { query });
  check('identical request is a cache hit', r.headers['x-pudding-cache'] === 'hit', r.headers['x-pudding-cache']);
  check('cache hit returns identical bytes',
    first.body && r.body && first.body.equals(r.body),
    `${first.body && first.body.length} vs ${r.body && r.body.length}`);
}

console.log('\n=== prosody clamping ===');
{
  // A malformed value must fall back, not be forwarded into the SSML.
  const query = new URLSearchParams({ text: '测试', pitch: 'not-a-pitch', rate: '99', volume: 'x' }).toString();
  const r = await call('/pudding-pet/tts', { query });
  check('malformed prosody still synthesizes', r.status === 200, 'status=' + r.status);
}

// --------------------------------------------------------- voice catalog
console.log('\n=== voice catalog (network) ===');
{
  const r = await call('/pudding-pet/voices', { query: 'locale=zh' });
  check('catalog returned (200)', r.status === 200, 'status=' + r.status);
  if (r.status === 200) {
    const json = JSON.parse(r.body.toString('utf8'));
    check('catalog has voices', Array.isArray(json.voices) && json.voices.length > 0,
      'count=' + (json.voices ? json.voices.length : 0));
    check('catalog names a default voice', typeof json.defaultVoice === 'string', json.defaultVoice);
    if (json.voices && json.voices.length) {
      console.log('    e.g.', json.voices.slice(0, 3).map((v) => v.name).join(', '));
    }
  }
}

// --------------------------------------------------------------- teardown
console.log('\n=== teardown ===');
for (const fn of effects) {
  const dispose = fn();
  if (typeof dispose === 'function') dispose();
}
check('routes removed on dispose', routes.size === 0, 'remaining=' + routes.size);

const failed = results.filter((r) => !r.pass);
console.log('\n' + (failed.length
  ? `FAILED (${failed.length}/${results.length}): ${failed.map((f) => f.name).join('; ')}`
  : `all ${results.length} checks passed`));
process.exitCode = failed.length ? 1 : 0;
