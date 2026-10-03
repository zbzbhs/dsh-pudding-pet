// Verify the synthesis cache is bounded by BYTES, not just by entry count.
//
// The original limit was 240 entries. An entry is not small: a 2000-character
// CJK reply synthesizes to roughly 2.4 MB of MP3, so 240 entries could retain
// over half a gigabyte. The fix adds a byte budget with LRU eviction.
//
// The route is driven with a fake upstream that returns a large payload, so this
// measures the real eviction behaviour without a network call.
import http from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const require_ = createRequire(import.meta.url);
const httpsCjs = require_('node:https');
const httpCjs = require_('node:http');
const realHttpsRequest = httpsCjs.request;
const realHttpRequest = httpCjs.request;

// 2 MB of "audio" per response. 30 inserts = 60 MB, which exceeds the 48 MB
// budget, so eviction must happen. (20 inserts = 40 MB would stay under it and
// the eviction assertion would fail for a reason that is not a defect.)
const AUDIO_BYTES = 2 * 1024 * 1024;
const INSERTS = 30;

const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'] || '';
  const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n',
  );
  let buffer = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 2) break;
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let len = buffer[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (buffer.length < 4) break; len = buffer.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buffer.length < 10) break; len = Number(buffer.readBigUInt64BE(2)); off = 10; }
      let mask = null;
      if (masked) { if (buffer.length < off + 4) break; mask = buffer.subarray(off, off + 4); off += 4; }
      if (buffer.length < off + len) break;
      const payload = Buffer.from(buffer.subarray(off, off + len));
      if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
      buffer = buffer.subarray(off + len);
      if (opcode !== 0x1) continue;
      const text = payload.toString('utf8');
      if (!/Path:ssml/.test(text)) continue;

      // A frame: [2-byte header length][header][audio bytes].
      const header = Buffer.from('X-RequestId:t\r\nPath:audio\r\n');
      const prefix = Buffer.from([header.length >> 8, header.length & 0xff]);
      /**
       * Encode one unmasked server frame.
       *
       * The 16-bit length field only covers 125..65535 bytes, so a 2 MB payload
       * needs the 64-bit form. Writing it as `126` with a 16-bit length produced a
       * frame the client could not parse, which made the test hang rather than fail.
       */
      const frame = (op, data) => {
        const len = data.length;
        let head;
        if (len < 126) {
          head = Buffer.from([0x80 | op, len]);
        } else if (len <= 0xffff) {
          head = Buffer.from([0x80 | op, 126, len >> 8, len & 0xff]);
        } else {
          head = Buffer.alloc(10);
          head[0] = 0x80 | op;
          head[1] = 127;
          head.writeBigUInt64BE(BigInt(len), 2);
        }
        return Buffer.concat([head, data]);
      };
      socket.write(frame(0x1, Buffer.from('X-RequestId:t\r\nPath:turn.start\r\n\r\n{}')));
      socket.write(frame(0x2, Buffer.concat([prefix, header, Buffer.alloc(AUDIO_BYTES, 0x41)])));
      socket.write(frame(0x1, Buffer.from('X-RequestId:t\r\nPath:turn.end\r\n\r\n')));
    }
  });
  socket.on('error', () => {});
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

httpsCjs.request = function patched(options, callback) {
  if (options && typeof options === 'object' && options.host === 'speech.platform.bing.com') {
    return realHttpRequest.call(httpCjs, { ...options, host: '127.0.0.1', port: PORT }, callback);
  }
  return realHttpsRequest.apply(httpsCjs, arguments);
};

const routes = new Map();
const ctx = {
  inject: (n, fn) => fn(ctx),
  effect: (fn) => fn,
  on() {},
  logger: { warn() {}, info() {}, debug() {} },
  webServer: { register({ path, handler }) { routes.set(path, handler); return () => {}; } },
};
const mod = await import(pathToFileURL(resolve(process.cwd(), 'lib/index.js')).href);
mod.apply(ctx);
const handler = routes.get('/pudding-pet/tts');

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass: !!pass });
  console.log(`  ${pass ? 'OK  ' : 'FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`);
}

/** One synthesis request; resolves with the status and cache header. */
function request(text) {
  return new Promise((resolveCall) => {
    const res = {
      statusCode: 0,
      _headers: {},
      writeHead(code, h) { res.statusCode = code; res._headers = h || {}; },
      end() { resolveCall({ status: res.statusCode, headers: res._headers }); },
      on() {}, removeListener() {},
    };
    const req = {
      method: 'GET',
      url: '/pudding-pet/tts?text=' + encodeURIComponent(text),
      headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin', origin: 'dsh-app://app' },
    };
    handler(req, res).catch(() => resolveCall({ status: 0, headers: {} }));
  });
}

console.log('=== cache is bounded by bytes, not entry count ===');
console.log(`  (each response is ${(AUDIO_BYTES / 1024 / 1024).toFixed(1)} MB of audio)`);
console.log('');

// 30 distinct phrases at 2 MB each = 60 MB, which exceeds the 48 MB budget.
const seen = [];
for (let i = 0; i < INSERTS; i += 1) {
  const r = await request('phrase-' + i);
  seen.push(r);
}
check('every request succeeded', seen.every((r) => r.status === 200), 'statuses=' + seen.map((r) => r.status).join(','));

const hits = seen.filter((r) => r.headers['x-pudding-cache'] === 'hit').length;
check(`distinct phrases all missed (${INSERTS})`, hits === 0, 'hits=' + hits);

// The first phrases must have been evicted once the byte budget filled.
const early = await request('phrase-0');
const late = await request('phrase-' + (INSERTS - 1));
check('the earliest entry was evicted (byte budget bound)',
  early.headers['x-pudding-cache'] === 'miss',
  'phrase-0=' + early.headers['x-pudding-cache']);
check('the most recent entry is still cached',
  late.headers['x-pudding-cache'] === 'hit',
  'phrase-' + (INSERTS - 1) + '=' + late.headers['x-pudding-cache']);

// Report what the cache holds, which is the point of the fix.
const stats = mod.cacheStats?.();
if (stats) {
  const mb = (stats.bytes / 1024 / 1024).toFixed(1);
  console.log(`\n  cache after ${INSERTS} x ${(AUDIO_BYTES / 1024 / 1024).toFixed(1)} MB inserts: ${stats.entries} entries, ${mb} MB`);
  check('retained bytes stay within the 48 MB budget',
    stats.bytes <= 48 * 1024 * 1024,
    `bytes=${stats.bytes}`);
  check('entry count also respects its own cap',
    stats.entries <= 240,
    `entries=${stats.entries}`);
} else {
  console.log('\n  (cacheStats is not exported; byte accounting not directly observable)');
}

server.close();
const failed = results.filter((r) => !r.pass);
console.log('\n' + (failed.length
  ? `FAILED (${failed.length}/${results.length})`
  : `all ${results.length} checks passed`));
process.exit(failed.length ? 1 : 0);
