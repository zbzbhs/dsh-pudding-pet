// Adversarial hardening tests for the pudding-pet host routes.
//
// Scope: lib/index.js (the fence, the parameter clamping, the cache, the error
// paths) plus the SSML that actually reaches the wire in lib/edge-tts.js.
//
// How the network is avoided
// --------------------------
// `node:https` is patched through `createRequire` so the vendored client's
// `request as httpsRequest` binding points at a local fake. The fake is a plain
// `node:http` server that speaks enough of the Read Aloud protocol to satisfy
// `synthesizeMp3`: a voice-list GET, and an upgrade that answers 101, then
// echoes `turn.start` / a binary `Path:audio` frame / `turn.end`. Because the
// real route, the real retry logic and the real frame codec all run, these
// tests stay deterministic and offline without stubbing the module under test.
//
// Nothing here is a network dependency. `--live` additionally runs a couple of
// real-network spot checks and counts them separately.
//
// Run: node dev/test-host-hardening.mjs [--live]

import { createHash } from 'node:crypto';
import http from 'node:http';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)));
const ROOT = resolve(HERE, '..');
const LIVE = process.argv.includes('--live');

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'OK  ' : 'FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`);
}

// Any of these during the run is a reliability defect in its own right, but a
// fault raised by THIS harness must not be reported as a product fault: record
// it, print it, and let the run end rather than continuing half-blind. Without
// the print a harness bug just looks like a hang, which is how this file once
// wasted a debug cycle.
const processFaults = [];
function recordFault(kind, detail) {
  const line = kind + ': ' + detail;
  processFaults.push(line);
  console.log('  FAIL harness fault  (' + line + ')');
}
process.on('unhandledRejection', (reason) => {
  recordFault('unhandledRejection', String((reason && reason.stack) || reason));
});
process.on('uncaughtException', (error) => {
  recordFault('uncaughtException', String((error && error.stack) || error));
  // An exception here is almost always this harness, not the route under test
  // (the route converts its own failures into 4xx/5xx). Stop instead of
  // waiting forever on a promise nobody will settle.
  process.exitCode = 1;
  queueMicrotask(() => process.exit(1));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ fake service
const AUDIO_MARK = 'ID3fake-audio-payload-';
const fake = {
  /** 'ok' | 'upgrade-refused' | 'hang' | 'empty-audio' */
  mode: 'ok',
  /** 'ok' | 'fail' | 'garbage' */
  catalogMode: 'ok',
  delayMs: 0,
  catalog: [
    { Name: 'Microsoft Server Speech Text to Speech Voice (zh-CN, XiaoyiNeural)', ShortName: 'zh-CN-XiaoyiNeural', Gender: 'Female', Locale: 'zh-CN' },
    { Name: 'Microsoft Server Speech Text to Speech Voice (en-US, AriaNeural)', ShortName: 'en-US-AriaNeural', Gender: 'Female', Locale: 'en-US' },
    { Name: 'Microsoft Server Speech Text to Speech Voice (zh-CN-liaoning, XiaobeiNeural)', ShortName: 'zh-CN-liaoning-XiaobeiNeural', Gender: 'Female', Locale: 'zh-CN-liaoning' },
  ],
  upgrades: 0,
  synthCount: 0,
  socketsAborted: 0,
  ssml: [],
  paths: [],
};

function wsFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

/** Read one masked client frame off the head of `buffer`, or null if incomplete. */
function readClientFrame(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let len = buffer[1] & 0x7f;
  let off = 2;
  if (len === 126) {
    if (buffer.length < 4) return null;
    len = buffer.readUInt16BE(2);
    off = 4;
  } else if (len === 127) {
    if (buffer.length < 10) return null;
    len = Number(buffer.readBigUInt64BE(2));
    off = 10;
  }
  let mask = null;
  if (masked) {
    if (buffer.length < off + 4) return null;
    mask = buffer.subarray(off, off + 4);
    off += 4;
  }
  if (buffer.length < off + len) return null;
  const payload = Buffer.from(buffer.subarray(off, off + len));
  if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
  return { opcode, payload, rest: buffer.subarray(off + len) };
}

const openSockets = new Set();

const fakeServer = http.createServer((req, res) => {
  fake.paths.push(req.method + ' ' + req.url.split('?')[0]);
  if (req.url.startsWith('/consumer/speech/synthesize/readaloud/voices/list')) {
    if (fake.catalogMode === 'fail') {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('nope');
      return;
    }
    if (fake.catalogMode === 'garbage') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{ this is not json');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(fake.catalog));
    return;
  }
  res.writeHead(404);
  res.end();
});

fakeServer.on('upgrade', (req, socket) => {
  openSockets.add(socket);
  socket.on('close', () => openSockets.delete(socket));
  fake.upgrades += 1;
  fake.synthCount += 1;

  if (fake.mode === 'upgrade-refused') {
    socket.end('HTTP/1.1 500 Internal Server Error\r\ncontent-length: 0\r\n\r\n');
    return;
  }

  const key = req.headers['sec-websocket-key'] || '';
  const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n',
  );

  if (fake.mode === 'hang') {
    // Accept the upgrade, answer nothing: the route should only be released by
    // its abort signal (or its 45 s ceiling).
    //
    // `resume()` matters here. A socket with no 'data' listener stays paused, and
    // a paused socket never reads the peer's FIN — so 'close' would never fire
    // and a correctly torn-down connection would look like a leak. A real server
    // reads from its sockets, so the fake must too.
    socket.resume();
    const markGone = () => { fake.socketsAborted += 1; };
    socket.on('close', markGone);
    socket.on('error', markGone);
    socket.on('end', markGone);
    return;
  }

  let buffer = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const frame = readClientFrame(buffer);
      if (!frame) break;
      buffer = frame.rest;
      if (frame.opcode !== 0x1) continue;
      const text = frame.payload.toString('utf8');
      if (!/Path:ssml/.test(text)) continue;

      const ssml = text.slice(text.indexOf('\r\n\r\n') + 4);
      fake.ssml.push(ssml);

      const audio = fake.mode === 'empty-audio' ? Buffer.alloc(0) : Buffer.from(AUDIO_MARK + ssml.length);
      const header = Buffer.from('X-RequestId:test\r\nPath:audio\r\n');
      const payload = Buffer.concat([Buffer.from([header.length >> 8, header.length & 0xff]), header, audio]);

      setTimeout(() => {
        if (socket.destroyed) return;
        socket.write(wsFrame(0x1, Buffer.from('X-RequestId:test\r\nPath:turn.start\r\n\r\n{}')));
        if (payload.length > 2) socket.write(wsFrame(0x2, payload));
        // No space after the colon: the client compares the captured value exactly.
        socket.write(wsFrame(0x1, Buffer.from('X-RequestId:test\r\nPath:turn.end\r\n\r\n')));
      }, fake.delayMs);
    }
  });
});

await new Promise((r) => fakeServer.listen(0, '127.0.0.1', r));
const FAKE_PORT = fakeServer.address().port;

// Redirect the vendored client at the fake, without touching it.
//
// Order matters, and it is a real ESM/builtin subtlety rather than a guess:
// `node:https` is a CJS builtin, so its ESM namespace is a *snapshot* taken the
// first time the namespace is created. A static `import https from 'node:https'`
// at the top of this file would create that namespace before the patch and the
// already-loaded `import { request as httpsRequest }` inside lib/edge-tts.js
// would keep the original binding. Patching the CJS export first — and only
// then importing anything that imports `node:https` — is what makes the patch
// reach the vendored client. The assertion below fails loudly if that changes.
const require_ = createRequire(import.meta.url);
const httpsCjs = require_('node:https');
const httpCjs = require_('node:http');
const realHttpsRequest = httpsCjs.request;
const realHttpRequest = httpCjs.request;
/**
 * The client-side sockets the vendored client opened.
 *
 * Teardown is judged from these, not from the server's view: the client calls
 * `destroy()` synchronously, while the fake server only learns about it once the
 * loopback FIN is delivered — which lags behind the assertion. A server-side
 * count therefore reported a correctly closed connection as a leak.
 */
const clientSockets = new Set();
httpsCjs.request = function patched(options, callback) {
  if (options && typeof options === 'object' && options.host === 'speech.platform.bing.com') {
    // Same object shape, but `http.request` so the loopback fake needs no TLS.
    const req = realHttpRequest.call(httpCjs, { ...options, host: '127.0.0.1', port: FAKE_PORT }, callback);
    req.on('socket', (socket) => {
      clientSockets.add(socket);
      socket.on('close', () => clientSockets.delete(socket));
    });
    return req;
  }
  return realHttpsRequest.apply(httpsCjs, arguments);
};
const httpsNamespace = await import('node:https');
if (httpsNamespace.request !== httpsCjs.request) {
  throw new Error('harness: the node:https patch is not visible to ESM importers');
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
console.log('=== harness ===');
check('exports apply', typeof mod.apply === 'function');
mod.apply(ctx);
check('tts route registered', routes.has('/pudding-pet/tts'));
check('voices route registered', routes.has('/pudding-pet/voices'));

/** A minimal ServerResponse stand-in that records what the handler wrote. */
function makeRes({ throwing = false, noOn = false } = {}) {
  const listeners = new Map();
  const chunks = [];
  const res = {
    statusCode: 0,
    _headers: {},
    ended: false,
    _settle: null,
    writeHead(code, headers) {
      if (throwing) throw new Error('EPIPE: write after end');
      res.statusCode = code;
      res._headers = headers || {};
    },
    end(data) {
      if (throwing) throw new Error('EPIPE: write after end');
      res.ended = true;
      if (data) chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
      res._settle?.();
    },
    _body: () => Buffer.concat(chunks),
  };
  if (!noOn) {
    res.on = (event, fn) => {
      const list = listeners.get(event) || [];
      list.push(fn);
      listeners.set(event, list);
      return res;
    };
    res.once = (event, fn) => res.on(event, fn);
    res.removeListener = (event, fn) => {
      listeners.set(event, (listeners.get(event) || []).filter((f) => f !== fn));
      return res;
    };
    res.emit = (event, ...args) => {
      for (const fn of [...(listeners.get(event) || [])]) fn(...args);
    };
    res._listenerCount = (event) => (listeners.get(event) || []).length;
  }
  return res;
}

/**
 * Drive one route with a fake request.
 *
 * `origin: null` omits the header; `origin: undefined` sends the app default.
 */
function callRaw(path, opts = {}) {
  const route = routes.get(path);
  const res = opts.res || makeRes();
  const headers = { host: opts.host === undefined ? '127.0.0.1:3080' : opts.host };
  if (opts.secFetchSite !== null) headers['sec-fetch-site'] = opts.secFetchSite ?? 'same-origin';
  if (opts.origin === undefined) headers.origin = 'dsh-app://app';
  else if (opts.origin !== null) headers.origin = opts.origin;
  Object.assign(headers, opts.headers || {});

  const req = { method: opts.method || 'GET', url: path + (opts.query ? '?' + opts.query : ''), headers };

  let settled = false;
  let finish;
  const promise = new Promise((r) => { finish = r; });
  const settle = (extra) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    // A caller-supplied `res` may be a bare stub with no `_body()`.
    const body = typeof res._body === 'function' ? res._body() : Buffer.alloc(0);
    finish({ status: res.statusCode, headers: res._headers || {}, body, res, req, ...extra });
  };
  res._settle = () => settle();
  const timer = setTimeout(() => settle({ status: 0, timedOut: true }), opts.timeoutMs ?? 10000);

  if (!route) {
    settle({ status: 0, error: 'no route' });
    return { promise, res, req };
  }
  // A custom `res` (the bare object in the error-handling tests) is not wired
  // for the resolve-on-end path, so the handler's own rejection or the timeout
  // is what settles those calls.
  Promise.resolve()
    .then(() => route.handler(req, res))
    .catch((error) => settle({ status: 0, error: String((error && error.message) || error) }));
  return { promise, res, req };
}

const call = (path, opts) => callRaw(path, opts).promise;

let uid = 0;
/** A text no earlier test has cached. */
const fresh = (prefix = 'h') => `${prefix}-${++uid}-text`;

const json = (r) => { try { return JSON.parse(r.body.toString('utf8')); } catch { return null; } };

/** Synthesize and hand back the SSML the vendored client actually put on the wire. */
async function synth(query, opts) {
  const before = fake.ssml.length;
  const r = await call('/pudding-pet/tts', { query, ...opts });
  const frames = fake.ssml.slice(before);
  return { r, ssml: frames.length ? frames[frames.length - 1] : null, frames, attempts: frames.length };
}

// ================================================================== fence
console.log('\n=== fence: origin / host / method ===');
{
  const r = await call('/pudding-pet/tts', { query: 'text=' + fresh(), origin: 'https://evil.example' });
  check('foreign Origin is refused (403)', r.status === 403, 'status=' + r.status);
}
{
  const r = await call('/pudding-pet/tts', { query: 'text=' + fresh(), origin: 'dsh-app://app' });
  check('dsh-app Origin is allowed (200)', r.status === 200, 'status=' + r.status);
}
{
  const r = await call('/pudding-pet/tts', { query: 'text=' + fresh(), origin: 'null' });
  check('Origin: "null" is allowed by the code as written', r.status === 200, 'status=' + r.status);
}
{
  const r = await call('/pudding-pet/tts', {
    query: 'text=' + fresh(), host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080',
  });
  check('same-host same-port Origin is allowed (200)', r.status === 200, 'status=' + r.status);
}
{
  const r = await call('/pudding-pet/tts', {
    query: 'text=' + fresh(), host: '127.0.0.1:3080', origin: 'http://127.0.0.1:9999',
  });
  check('same-host different-port Origin is refused (403)', r.status === 403, 'status=' + r.status);
}
{
  const r = await call('/pudding-pet/tts', { query: 'text=' + fresh(), origin: 'not a url' });
  check('malformed Origin is refused (403)', r.status === 403, 'status=' + r.status);
}
{
  const r = await call('/pudding-pet/tts', {
    query: 'text=' + fresh(), host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', method: 'POST',
  });
  check('POST is refused (405)', r.status === 405, 'status=' + r.status);
}
{
  const r = await call('/pudding-pet/tts', { query: 'text=' + fresh(), method: 'PUT' });
  check('PUT is refused (405)', r.status === 405, 'status=' + r.status);
}
{
  const r = await call('/pudding-pet/tts', { query: 'text=' + fresh(), method: 'DELETE' });
  check('DELETE is refused (405)', r.status === 405, 'status=' + r.status);
}
{
  const r = await call('/pudding-pet/tts', {
    query: 'text=' + fresh(), origin: 'https://evil.example', method: 'OPTIONS',
  });
  check('OPTIONS is refused (405, method before origin)', r.status === 405, 'status=' + r.status);
}
{
  const text = fresh('head');
  const before = fake.ssml.length;
  const r = await call('/pudding-pet/tts', { query: 'text=' + text, method: 'HEAD' });
  const synthesized = fake.ssml.length > before;
  check('HEAD is accepted (200, as coded)', r.status === 200, 'status=' + r.status);
  check('HEAD still performs a full synthesis', synthesized, 'ssml_frames=' + (fake.ssml.length - before));
  check('HEAD writes a body at the handler level (Node suppresses it on the wire)',
    r.body.length > 0, 'handler_bytes=' + r.body.length);
}
{
  // A duplicated header is joined by Node into "cross-site, same-origin"; the
  // fence compares the whole string, so the exact-match test no longer fires.
  const r = await call('/pudding-pet/tts', {
    query: 'text=' + fresh(),
    headers: { 'sec-fetch-site': 'cross-site, same-origin' },
  });
  check('joined duplicate sec-fetch-site is NOT treated as cross-site', r.status === 200, 'status=' + r.status);
}
{
  const r = await call('/pudding-pet/tts', { query: 'text=' + fresh(), secFetchSite: 'cross-site' });
  check('plain cross-site is refused (403)', r.status === 403, 'status=' + r.status);
}

console.log('\n=== fence: host fence fallback (ctx.connection) ===');
{
  ctx.connection = undefined;
  const r = await call('/pudding-pet/tts', { query: 'text=' + fresh(), host: '8.8.8.8', origin: null });
  check('public Host without ctx.connection falls back to 403', r.status === 403, 'status=' + r.status);
}
{
  ctx.connection = { requestRejection: () => 401 };
  const r = await call('/pudding-pet/tts', { query: 'text=' + fresh(), host: '8.8.8.8', origin: null });
  check('host fence status code is forwarded (401)', r.status === 401, 'status=' + r.status);
}
{
  ctx.connection = { requestRejection: () => undefined };
  const r = await call('/pudding-pet/tts', { query: 'text=' + fresh(), host: '8.8.8.8', origin: null });
  check('falsy host-fence return is treated as "allow"', r.status === 200, 'status=' + r.status);
}
{
  ctx.connection = { requestRejection: () => { throw new Error('fence exploded'); } };
  const r = await call('/pudding-pet/tts', { query: 'text=' + fresh(), host: '8.8.8.8', origin: null });
  check('throwing host fence is refused (403)', r.status === 403, 'status=' + r.status);
}
ctx.connection = undefined;

console.log('\n=== fence: isLocalHost() prefix matching ===');
{
  // A page served from http://10.evil.com (DNS-rebound to 127.0.0.1) sends a
  // same-origin request: Host and Origin agree and sec-fetch-site is
  // same-origin, so this is the only check left standing.
  const r = await call('/pudding-pet/tts', {
    query: 'text=' + fresh(), host: '10.evil.com:3080', origin: 'http://10.evil.com:3080',
  });
  check('[SECURITY] rebinding host 10.evil.com is fenced (403)', r.status === 403, 'status=' + r.status);
}
{
  const r = await call('/pudding-pet/tts', {
    query: 'text=' + fresh(), host: '192.168.evil.com:3080', origin: 'http://192.168.evil.com:3080',
  });
  check('[SECURITY] rebinding host 192.168.evil.com is fenced (403)', r.status === 403, 'status=' + r.status);
}
{
  const r = await call('/pudding-pet/tts', {
    query: 'text=' + fresh(), host: '127.evil.com:3080', origin: 'http://127.evil.com:3080',
  });
  check('[SECURITY] rebinding host 127.evil.com is fenced (403)', r.status === 403, 'status=' + r.status);
}
{
  const r = await call('/pudding-pet/tts', {
    query: 'text=' + fresh(), host: '172.16.evil.com:3080', origin: 'http://172.16.evil.com:3080',
  });
  check('[SECURITY] rebinding host 172.16.evil.com is fenced (403)', r.status === 403, 'status=' + r.status);
}
{
  // A real public hostname must not sneak through.
  const r = await call('/pudding-pet/tts', {
    query: 'text=' + fresh(), host: '100.64.0.1', origin: 'http://100.64.0.1',
  });
  check('non-local numeric host is fenced (403)', r.status === 403, 'status=' + r.status);
}
{
  const r = await call('/pudding-pet/tts', {
    query: 'text=' + fresh(), host: 'evil.localhost:3080', origin: 'http://evil.localhost:3080',
  });
  check('*.localhost is treated as local (200, reserved TLD)', r.status === 200, 'status=' + r.status);
}
{
  const r = await call('/pudding-pet/tts', { query: 'text=' + fresh(), origin: 'dsh-app://evil' });
  check('any dsh-app:// origin is accepted (200)', r.status === 200, 'status=' + r.status);
}
{
  const r = await call('/pudding-pet/tts', { query: 'text=' + fresh(), host: '', origin: 'http://127.0.0.1' });
  check('missing Host with a present Origin is refused (403)', r.status === 403, 'status=' + r.status);
}

// ============================================================ parameters
console.log('\n=== parameters: text ===');
{
  const r = await call('/pudding-pet/tts', { query: '' });
  check('missing text is refused (400)', r.status === 400, 'status=' + r.status);
}
{
  const r = await call('/pudding-pet/tts', { query: 'text=' + encodeURIComponent('   \t  ') });
  check('whitespace-only text is refused (400)', r.status === 400, 'status=' + r.status);
}
{
  const r = await call('/pudding-pet/tts', { query: 'text=' + 'a'.repeat(2001) });
  check('2001-char text is refused (413)', r.status === 413, 'status=' + r.status);
}
{
  const text = '布'.repeat(2000);
  const { r, frames } = await synth('text=' + encodeURIComponent(text));
  const sizes = frames.map((s) => Buffer.byteLength(s, 'utf8'));
  check('exactly 2000 chars is accepted (boundary, 200)', r.status === 200, 'status=' + r.status);
  check('a long CJK reply is split into several service requests', frames.length > 1, 'frames=' + frames.length);
  check('[RELIABILITY] every SSML request stays within the 1800-byte service budget',
    sizes.length > 0 && sizes.every((n) => n <= 1800),
    'max_frame_bytes=' + (sizes.length ? Math.max(...sizes) : 0) + ' sizes=' + sizes.join(','));
}
{
  const { ssml } = await synth('text=' + encodeURIComponent('a & b < c > d'));
  check('text is XML-escaped in the SSML', !!ssml && ssml.includes('a &amp; b &lt; c &gt; d'),
    ssml ? ssml.slice(ssml.indexOf('<prosody'), ssml.indexOf('</prosody>') + 10) : 'no ssml');
}
{
  // `splitForRequests` cuts on UTF-16 indices but budgets in UTF-8 bytes, so a
  // boundary can land between the two halves of an astral character (an emoji
  // is 2 units / 4 bytes). The lone surrogate is then encoded as U+FFFD, so the
  // character is destroyed and the MP3s of the two halves no longer join into
  // the original text. The offsets below are the ones that hit it.
  const text = 'a'.repeat(1793) + '\u{1F600}'.repeat(30);
  const { r, frames } = await synth('text=' + encodeURIComponent(text));
  const rejoined = frames
    .map((s) => s.slice(s.indexOf('>', s.indexOf('<prosody')) + 1, s.indexOf('</prosody>')))
    .join('');
  const inputEmoji = (text.match(/\u{1F600}/gu) || []).length;
  const wireEmoji = (rejoined.match(/\u{1F600}/gu) || []).length;
  const replacement = (rejoined.match(/\uFFFD/g) || []).length;
  check('a long text is still accepted when the split lands mid-emoji (200)', r.status === 200, 'status=' + r.status);
  check('[DATA LOSS] splitting never corrupts an astral character into U+FFFD',
    replacement === 0 && wireEmoji === inputEmoji,
    `emoji ${wireEmoji}/${inputEmoji} replacementChars=${replacement} frames=${frames.length}`);
}

console.log('\n=== parameters: prosody clamping ===');
async function prosody(query) {
  const { r, ssml } = await synth('text=' + fresh() + '&' + query);
  const pitch = /pitch='([^']*)'/.exec(ssml || '')?.[1];
  const rate = /rate='([^']*)'/.exec(ssml || '')?.[1];
  const volume = /volume='([^']*)'/.exec(ssml || '')?.[1];
  return { r, pitch, rate, volume };
}
{
  const p = await prosody('pitch=' + encodeURIComponent('+9999Hz'));
  check('pitch +9999Hz clamps to +400Hz', p.pitch === '+400Hz', 'pitch=' + p.pitch);
}
for (const [label, value] of [['abc', 'abc'], ['50 (no unit)', '50'], ['++50Hz', '++50Hz'], ['50hz (lowercase)', '50hz'], ['empty', ''], ['1e3Hz', '1e3Hz'], ['NaN%', 'NaN%']]) {
  const p = await prosody('pitch=' + encodeURIComponent(value));
  check(`pitch ${label} falls back to +0Hz`, p.pitch === '+0Hz', 'pitch=' + p.pitch);
}
{
  const p = await prosody('pitch=' + encodeURIComponent('-50Hz'));
  check('pitch -50Hz is kept (negative allowed)', p.pitch === '-50Hz', 'pitch=' + p.pitch);
}
{
  const p = await prosody('pitch=' + encodeURIComponent('-9999Hz'));
  check('pitch -9999Hz clamps to -400Hz', p.pitch === '-400Hz', 'pitch=' + p.pitch);
}
{
  const p = await prosody('rate=' + encodeURIComponent('+9999%'));
  check('rate +9999% clamps to +200%', p.rate === '+200%', 'rate=' + p.rate);
}
for (const [label, value] of [['abc', 'abc'], ['99 (no unit)', '99'], ['-+50%', '-+50%'], ['+50 (no unit)', '+50']]) {
  const p = await prosody('rate=' + encodeURIComponent(value));
  check(`rate ${label} falls back to +0%`, p.rate === '+0%', 'rate=' + p.rate);
}
{
  const p = await prosody('volume=' + encodeURIComponent('+9999%'));
  check('volume +9999% clamps to +100%', p.volume === '+100%', 'volume=' + p.volume);
}
for (const [label, value] of [['abc', 'abc'], ['loud', 'loud'], ['100', '100']]) {
  const p = await prosody('volume=' + encodeURIComponent(value));
  check(`volume ${label} falls back to +0%`, p.volume === '+0%', 'volume=' + p.volume);
}
{
  // Nothing above may throw; the guard is that the route still answers at all.
  const p = await prosody('pitch=' + encodeURIComponent('+1'.repeat(500)) + '&rate=&volume=');
  check('garbage prosody never throws (still 200)', p.r.status === 200, 'status=' + p.r.status);
}

console.log('\n=== parameters: voice validation ===');
{
  const { ssml } = await synth('text=' + fresh() + '&voice=');
  check('empty voice falls back to DEFAULT_VOICE', !!ssml && ssml.includes("name='Microsoft Server Speech Text to Speech Voice (zh-CN, XiaoyiNeural)'"),
    /name='([^']*)'/.exec(ssml || '')?.[1]);
}
{
  // A path-shaped value is not a voice name. It must be rejected at the route,
  // not interpolated into SSML: the vendored client writes the name into
  // `<voice name='...'>` unescaped, so an unchecked value is an injection point.
  const { r, ssml } = await synth('text=' + fresh() + '&voice=' + encodeURIComponent('../../etc/passwd'));
  const name = /name='([^']*)'/.exec(ssml || '')?.[1];
  check('a path-shaped voice is rejected and replaced by the default',
    !!ssml && name === 'Microsoft Server Speech Text to Speech Voice (zh-CN, XiaoyiNeural)',
    'name=' + name + ' status=' + r.status);
}
{
  const payload = "x'><break time='9s'/><voice name='y";
  const { ssml } = await synth('text=' + fresh() + '&voice=' + encodeURIComponent(payload));
  check('[SECURITY] SSML injection via voice is blocked', !!ssml && !ssml.includes(payload),
    ssml ? ssml.slice(0, 160) : 'no ssml');
}
{
  const payload = "Microsoft Server Speech Text to Speech Voice (x'><audio src='http://evil.example/a.mp3'/><voice name='y)";
  const beforeCatalog = fake.paths.length;
  const { ssml } = await synth('text=' + fresh() + '&voice=' + encodeURIComponent(payload));
  check('[SECURITY] long-form voice name is not trusted verbatim',
    !!ssml && !ssml.includes("src='http://evil.example/a.mp3'"),
    ssml ? ssml.slice(0, 120) : 'no ssml');
  check('long-form voice name skips the catalog lookup entirely',
    !fake.paths.slice(beforeCatalog).some((p) => p.includes('voices/list')),
    'catalog_calls=' + fake.paths.slice(beforeCatalog).filter((p) => p.includes('voices/list')).length);
}

// ================================================================ cache
console.log('\n=== cache ===');
let cacheFirst = null;
{
  const text = fresh('cache');
  const query = 'text=' + encodeURIComponent(text) + '&pitch=' + encodeURIComponent('+50Hz');
  cacheFirst = await call('/pudding-pet/tts', { query });
  const second = await call('/pudding-pet/tts', { query });
  check('first call is a miss', cacheFirst.headers['x-pudding-cache'] === 'miss', cacheFirst.headers['x-pudding-cache']);
  check('identical request is a hit', second.headers['x-pudding-cache'] === 'hit', second.headers['x-pudding-cache']);
  check('cache hit returns byte-identical audio',
    cacheFirst.body.length > 0 && cacheFirst.body.equals(second.body),
    `${cacheFirst.body.length} vs ${second.body.length}`);
  check('cache hit keeps content-type audio/mpeg', second.headers['content-type'] === 'audio/mpeg', second.headers['content-type']);
  const otherPitch = await call('/pudding-pet/tts', { query: 'text=' + encodeURIComponent(text) + '&pitch=' + encodeURIComponent('+51Hz') });
  check('changing pitch is a miss', otherPitch.headers['x-pudding-cache'] === 'miss', otherPitch.headers['x-pudding-cache']);
  const otherVoice = await call('/pudding-pet/tts', { query: 'text=' + encodeURIComponent(text) + '&pitch=' + encodeURIComponent('+50Hz') + '&voice=en-US-AriaNeural' });
  check('changing voice is a miss', otherVoice.headers['x-pudding-cache'] === 'miss', otherVoice.headers['x-pudding-cache']);
  const otherRate = await call('/pudding-pet/tts', { query: 'text=' + encodeURIComponent(text) + '&pitch=' + encodeURIComponent('+50Hz') + '&rate=' + encodeURIComponent('+10%') });
  check('changing rate is a miss', otherRate.headers['x-pudding-cache'] === 'miss', otherRate.headers['x-pudding-cache']);
}
{
  // Eviction: 245 distinct texts against CACHE_LIMIT = 240. The cache is shared
  // with the tests above, but 245 > 240, so only this batch can survive.
  const total = 245;
  for (let i = 1; i <= total; i += 1) {
    const r = await call('/pudding-pet/tts', { query: 'text=evict-' + i + '-payload' });
    if (r.status !== 200) { check('eviction fill request ' + i + ' succeeded', false, 'status=' + r.status); break; }
  }
  // Recent entries first: the misses below each re-insert and evict one more.
  const sixth = await call('/pudding-pet/tts', { query: 'text=evict-6-payload' });
  const last = await call('/pudding-pet/tts', { query: 'text=evict-245-payload' });
  check('newest entry is still cached', last.headers['x-pudding-cache'] === 'hit', last.headers['x-pudding-cache']);
  check('entry #6 (within the last 240) is still cached', sixth.headers['x-pudding-cache'] === 'hit', sixth.headers['x-pudding-cache']);
  const evicted = [];
  for (const i of [1, 2, 3, 4, 5]) {
    const r = await call('/pudding-pet/tts', { query: 'text=evict-' + i + '-payload' });
    evicted.push(r.headers['x-pudding-cache']);
  }
  check('the 5 oldest entries were evicted (cache bounded at 240)',
    evicted.every((v) => v === 'miss'), 'flags=' + evicted.join(','));
}

// ======================================================= concurrency/abort
console.log('\n=== concurrency and abort ===');
{
  fake.mode = 'hang';
  // Only the sockets this test creates are relevant; see `clientSockets` above.
  const socketsBefore = new Set(clientSockets);
  const abortedBefore = fake.socketsAborted;

  const { promise, res } = callRaw('/pudding-pet/tts', { query: 'text=' + fresh('abort'), timeoutMs: 6000 });
  await sleep(150); // let the upgrade complete and the SSML go out
  const upgraded = fake.upgrades;
  const started = Date.now();
  res.emit('close'); // the client walked away
  const r = await promise;
  const elapsed = Date.now() - started;
  const mine = [...clientSockets].filter((s) => !socketsBefore.has(s));
  check('abort: route settles promptly instead of waiting 45 s', elapsed < 3000, 'ms=' + elapsed);
  check('abort: reported as 503, not 200', r.status === 503, 'status=' + r.status + ' error=' + (json(r) || {}).error);
  check('abort: the upstream socket is torn down', mine.some((s) => s.destroyed),
    'closed=' + mine.filter((s) => s.destroyed).length + '/' + mine.length + ' upgrades=' + upgraded);
  // The route removes its `close` listener in a `finally`. That runs after the
  // handler resolves, which can be a tick after the response settles here, so
  // give it a moment rather than reading the count mid-teardown. (A standalone
  // trace confirms the sequence is `on:close, remove:close` → 0.)
  await sleep(50);
  check('abort: the close listener is removed afterwards', r.res._listenerCount('close') === 0,
    'listeners=' + r.res._listenerCount('close'));
  await sleep(150);
  const leaked = mine.filter((s) => !s.destroyed).length;
  check('abort: no upstream socket is left open', leaked === 0,
    'undestroyed=' + leaked + ' thisTest=' + mine.length);
  fake.mode = 'ok';
}
{
  fake.delayMs = 60;
  const text = fresh('concurrent');
  const before = fake.synthCount;
  const [a, b] = await Promise.all([
    call('/pudding-pet/tts', { query: 'text=' + text }),
    call('/pudding-pet/tts', { query: 'text=' + text }),
  ]);
  fake.delayMs = 0;
  check('two concurrent identical requests both succeed', a.status === 200 && b.status === 200,
    `statuses=${a.status},${b.status}`);
  check('concurrent responses are identical', a.body.length > 0 && a.body.equals(b.body),
    `${a.body.length} vs ${b.body.length}`);
  check('concurrent identical requests are not coalesced (duplicate upstream work)',
    fake.synthCount - before === 2, 'syntheses=' + (fake.synthCount - before));
}

// ========================================================= error handling
console.log('\n=== error handling ===');
{
  fake.mode = 'upgrade-refused';
  const r = await call('/pudding-pet/tts', { query: 'text=' + fresh('fail') });
  const body = json(r);
  fake.mode = 'ok';
  check('synthesis failure returns 503, not 500', r.status === 503, 'status=' + r.status);
  check('synthesis failure returns JSON', r.headers['content-type'] === 'application/json; charset=utf-8', r.headers['content-type']);
  check('synthesis failure does not leak a stack trace',
    !r.body.toString('utf8').includes('\n    at '), r.body.toString('utf8').slice(0, 140));
  check('synthesis failure is labelled synthesis-unavailable', body && body.error === 'synthesis-unavailable', JSON.stringify(body));
}
{
  fake.mode = 'empty-audio';
  const r = await call('/pudding-pet/tts', { query: 'text=' + fresh('empty') });
  fake.mode = 'ok';
  check('zero-byte audio is reported as 503 synthesis-empty', r.status === 503 && json(r)?.error === 'synthesis-empty',
    'status=' + r.status + ' body=' + r.body.toString('utf8').slice(0, 80));
}
{
  fake.catalogMode = 'fail';
  const r = await call('/pudding-pet/voices', { query: 'locale=zh' });
  check('catalog failure returns 503', r.status === 503, 'status=' + r.status);
  check('catalog failure is labelled catalog-unavailable', json(r)?.error === 'catalog-unavailable', JSON.stringify(json(r)));
}
{
  fake.catalogMode = 'garbage';
  const r = await call('/pudding-pet/voices', { query: 'locale=zh' });
  check('unparseable catalog body returns 503', r.status === 503, 'status=' + r.status);
  fake.catalogMode = 'ok';
}
{
  const r = await call('/pudding-pet/voices', { query: 'locale=zh' });
  const body = json(r);
  check('catalog happy path still works (200)', r.status === 200, 'status=' + r.status);
  check('catalog is filtered by locale prefix', Array.isArray(body?.voices) && body.voices.every((v) => v.locale.startsWith('zh')),
    'locales=' + (body?.voices || []).map((v) => v.locale).join(','));
}
{
  const r = await call('/pudding-pet/voices', { query: 'locale=zz' });
  check('empty locale filter returns an empty list, not an error',
    r.status === 200 && Array.isArray(json(r)?.voices) && json(r).voices.length === 0,
    'status=' + r.status + ' count=' + json(r)?.voices?.length);
}
{
  // res.writeHead / res.end throwing (client vanished) must not escape.
  const res = makeRes({ throwing: true });
  const r = await call('/pudding-pet/tts', { query: 'text=' + fresh('closedres'), res, timeoutMs: 600 });
  check('a throwing res neither crashes nor rejects (response silently dropped)',
    r.timedOut === true && r.error === undefined, 'timedOut=' + r.timedOut + ' error=' + r.error);
}
{
  // res without .on(): the close wiring sits outside the try/catch.
  const bare = { statusCode: 0, writeHead() {}, end() {} };
  const r = await call('/pudding-pet/tts', { query: 'text=' + fresh('nores'), res: bare, timeoutMs: 600 });
  check('a res without .on() rejects out of the guard rather than silently succeeding',
    r.status === 0 && typeof r.error === 'string', 'error=' + r.error);
}
{
  const r = await call('/pudding-pet/tts', { query: 'text=' + fresh('after'), timeoutMs: 6000 });
  check('the route still works after all failure paths (200)', r.status === 200, 'status=' + r.status);
}

// =================================================================== live
if (LIVE) {
  console.log('\n=== live spot checks (real network, informational) ===');
  const original = httpsCjs.request;
  httpsCjs.request = realHttpsRequest; // restore the real transport
  try {
    const r = await call('/pudding-pet/tts', { query: 'text=' + encodeURIComponent('你好，我是布丁。'), timeoutMs: 30000 });
    check('[LIVE] real synthesis returns 200', r.status === 200, 'status=' + r.status);
    check('[LIVE] real synthesis returns MP3 bytes', r.body.length > 2000, 'bytes=' + r.body.length);
    const v = await call('/pudding-pet/voices', { query: 'locale=zh', timeoutMs: 30000 });
    check('[LIVE] real catalog returns 200', v.status === 200, 'status=' + v.status + ' count=' + json(v)?.voices?.length);
  } finally {
    httpsCjs.request = original;
  }
}

// =============================================================== teardown
console.log('\n=== teardown ===');
for (const fn of effects) {
  const dispose = fn();
  if (typeof dispose === 'function') dispose();
}
check('routes removed on dispose', routes.size === 0, 'remaining=' + routes.size);
// Any socket still parked by the abort test would keep the fake server's
// close() pending, so drop them and give the close a hard ceiling.
for (const socket of openSockets) socket.destroy();
openSockets.clear();
await Promise.race([new Promise((r) => fakeServer.close(r)), sleep(2000)]);
fakeServer.closeAllConnections?.();
check('fake service closed', !fakeServer.listening);

check('no unhandled rejection or uncaught exception during the run',
  processFaults.length === 0, processFaults.join(' | '));

const failed = results.filter((r) => !r.pass);
console.log('\n' + (failed.length
  ? `FAILED (${failed.length}/${results.length}): ${failed.map((f) => f.name).join('; ')}`
  : `all ${results.length} checks passed`));
console.log(`fake service: upgrades=${fake.upgrades} syntheses=${fake.synthCount} ssml_frames=${fake.ssml.length}`);
process.exitCode = failed.length ? 1 : 0;
