// Confirm the surrogate-pair split reaches the wire, and size the cache.
import http from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ssmls = [];
const server = http.createServer((req, res) => {
  if (req.url.includes('voices/list')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify([{ Name: 'Microsoft Server Speech Text to Speech Voice (zh-CN, XiaoyiNeural)', ShortName: 'zh-CN-XiaoyiNeural', Gender: 'Female', Locale: 'zh-CN' }]));
    return;
  }
  res.writeHead(404); res.end();
});
function wsFrame(op, p) { const n = p.length; let h; if (n < 126) h = Buffer.from([0x80 | op, n]); else { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(n, 2); } return Buffer.concat([h, p]); }
function readFrame(b) {
  if (b.length < 2) return null;
  const op = b[0] & 0x0f; const masked = (b[1] & 0x80) !== 0; let len = b[1] & 0x7f; let off = 2;
  if (len === 126) { if (b.length < 4) return null; len = b.readUInt16BE(2); off = 4; }
  else if (len === 127) { if (b.length < 10) return null; len = Number(b.readBigUInt64BE(2)); off = 10; }
  let mask = null;
  if (masked) { if (b.length < off + 4) return null; mask = b.subarray(off, off + 4); off += 4; }
  if (b.length < off + len) return null;
  const p = Buffer.from(b.subarray(off, off + len));
  if (mask) for (let i = 0; i < p.length; i++) p[i] ^= mask[i % 4];
  return { op, payload: p, rest: b.subarray(off + len) };
}
server.on('upgrade', (req, socket) => {
  const accept = createHash('sha1').update((req.headers['sec-websocket-key'] || '') + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  let buf = Buffer.alloc(0);
  socket.on('data', (c) => {
    buf = Buffer.concat([buf, c]);
    for (;;) {
      const f = readFrame(buf);
      if (!f) break;
      buf = f.rest;
      if (f.op !== 1) continue;
      const t = f.payload.toString('utf8');
      if (!t.includes('Path:ssml')) continue;
      ssmls.push(t.slice(t.indexOf('\r\n\r\n') + 4));
      const hd = Buffer.from('X-RequestId:t\r\nPath:audio\r\n');
      // Audio size proportional to the request, so cache growth is measurable.
      const audio = Buffer.alloc(4000, 0x41);
      const payload = Buffer.concat([Buffer.from([hd.length >> 8, hd.length & 0xff]), hd, audio]);
      socket.write(wsFrame(1, Buffer.from('X-RequestId:t\r\nPath:turn.start\r\n\r\n{}')));
      socket.write(wsFrame(2, payload));
      socket.write(wsFrame(1, Buffer.from('X-RequestId:t\r\nPath:turn.end\r\n\r\n')));
    }
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const req_ = createRequire(import.meta.url);
const httpsCjs = req_('node:https');
const httpCjs = req_('node:http');
const real = httpCjs.request;
httpsCjs.request = function (o, cb) { return real.call(httpCjs, { ...o, host: '127.0.0.1', port }, cb); };

const routes = new Map();
const webServer = { register({ path, handler }) { routes.set(path, { handler }); return () => routes.delete(path); } };
const ctx = { inject(n, f) { f(ctx); }, effect(f) { return f; }, on() {}, logger: { warn() {}, info() {}, debug() {} } };
ctx.webServer = webServer;
const mod = await import(pathToFileURL('D:/Deepseek Harness file/dsh-pudding-pet/lib/index.js').href);
mod.apply(ctx);

function call(query) {
  return new Promise((resolveCall) => {
    const route = routes.get('/pudding-pet/tts');
    const chunks = [];
    const res = {
      statusCode: 0, _headers: {},
      writeHead(c, h) { res.statusCode = c; res._headers = h || {}; },
      end(d) { if (d) chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)); resolveCall({ status: res.statusCode, headers: res._headers, body: Buffer.concat(chunks) }); },
      on() {}, removeListener() {}, once() {}, emit() {},
    };
    const req = { method: 'GET', url: '/pudding-pet/tts?' + query, headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin', origin: 'dsh-app://app' } };
    route.handler(req, res);
  });
}

// ---- 1. surrogate split on the wire -------------------------------------
{
  const text = 'a'.repeat(1793) + '\u{1F600}'.repeat(30);
  const before = ssmls.length;
  const r = await call('text=' + encodeURIComponent(text));
  const frames = ssmls.slice(before);
  const withReplacement = frames.filter((s) => s.includes('\uFFFD'));
  console.log('--- surrogate split ---');
  console.log('status=' + r.status + ' frames=' + frames.length);
  console.log('frames containing U+FFFD replacement char: ' + withReplacement.length);
  for (const s of frames) {
    const i = s.indexOf('\uFFFD');
    if (i >= 0) {
      console.log('   wire context=' + JSON.stringify(s.slice(Math.max(0, i - 12), i + 12)));
      console.log('   around hex=' + Buffer.from(s.slice(Math.max(0, i - 4), i + 4)).toString('hex'));
    }
  }
  // Count how many original emoji survive intact across the concatenated payloads.
  const rejoined = frames.map((s) => s.slice(s.indexOf('>', s.indexOf('<prosody')) + 1, s.indexOf('</prosody>'))).join('');
  console.log('emoji in input=' + (text.match(/\u{1F600}/gu) || []).length + ' in wire=' + (rejoined.match(/\u{1F600}/gu) || []).length + ' replacementChars=' + (rejoined.match(/\uFFFD/g) || []).length);
}

// ---- 2. cache memory bound ----------------------------------------------
{
  const memBefore = process.memoryUsage().heapUsed;
  // 240 distinct entries, each a long CJK reply => several MB of audio each.
  for (let i = 0; i < 240; i++) {
    await call('text=' + encodeURIComponent('布'.repeat(1990) + i));
  }
  global.gc?.();
  const memAfter = process.memoryUsage().heapUsed;
  console.log('--- cache memory ---');
  console.log('heapUsed delta = ' + ((memAfter - memBefore) / 1048576).toFixed(1) + ' MB for 240 cached entries');
  console.log('(each entry here is ~' + (4000 * 4 / 1024) + ' KB of audio from the fake; a real long reply is far larger)');
}
server.closeAllConnections(); server.close(); process.exit(0);
