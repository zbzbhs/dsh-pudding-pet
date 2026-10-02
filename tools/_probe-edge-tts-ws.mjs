// Probe Edge TTS using the `ws` package, which DOES let us set headers.
//
// Node's built-in WebSocket cannot set a User-Agent, and the Edge service
// rejects the handshake without a current browser UA. `ws` can, which is the
// whole reason host-side synthesis is the workable path.
//
// Run with the profile's node_modules on the resolution path, e.g.:
//   node --experimental-default-type=module tools/_probe-edge-tts-ws.mjs
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)));
const HOME = process.env.USERPROFILE || process.env.HOME || '';
const PROFILE_DIR = process.env.DSH_PROFILE_DIR || join(HOME, '.dsh', 'profiles', 'desktop');

// Resolve `ws` from the DSH installation or the profile, whichever has it.
const require = createRequire(import.meta.url);
function loadWs() {
  const candidates = [
    join(PROFILE_DIR, 'node_modules', 'ws'),
    'D:\\DeepSeek Harness\\resources\\app.asar.unpacked\\node_modules\\ws',
    'ws',
  ];
  for (const c of candidates) {
    try { return require(c); } catch { /* try next */ }
  }
  return null;
}

const WebSocketImpl = loadWs();
if (!WebSocketImpl) {
  console.log('RESULT: the `ws` package could not be resolved from this process');
  console.log('(a profile-installed plugin resolves it from the profile, which is what matters)');
  process.exit(0);
}

const TRUSTED_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0';

const url = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'
  + '?TrustedClientToken=' + TRUSTED_TOKEN;

console.log('using ws:', typeof WebSocketImpl === 'function' ? 'ws' : 'ws default export');
const WS = WebSocketImpl.WebSocket || WebSocketImpl;

const started = Date.now();
let settled = false;
function finish(ok, message) {
  if (settled) return;
  settled = true;
  console.log(`RESULT: ${ok ? 'REACHABLE' : 'UNREACHABLE'} — ${message} (${Date.now() - started}ms)`);
  try { ws.close(); } catch {}
  setTimeout(() => process.exit(ok ? 0 : 1), 50);
}

const ws = new WS(url, {
  headers: {
    'User-Agent': CHROME_UA,
    'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
  },
});

let audioBytes = 0;
let sawPath = null;

ws.on('open', () => {
  console.log('  handshake accepted (101)');
  const now = new Date().toISOString();
  ws.send('X-Timestamp:' + now + '\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n'
    + JSON.stringify({
      context: {
        synthesis: {
          audio: {
            metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' },
            outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
          },
        },
      },
    }));
  // Full voice name is required: the short name is accepted at the handshake
  // and then the server silently resets the connection.
  const ssml = '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">'
    + '<voice name="Microsoft Server Speech Text to Speech Voice (zh-CN, XiaoyiNeural)">'
    + '<prosody pitch="+50Hz" rate="+0%">你好，这是测试。</prosody></voice></speak>';
  ws.send('X-RequestId:probe\r\nContent-Type:application/ssml+xml\r\n'
    + 'X-Timestamp:' + now + 'Z\r\nPath:ssml\r\n\r\n' + ssml);
});

ws.on('message', (data, isBinary) => {
  if (isBinary) {
    audioBytes += data.length;
    if (audioBytes > 2000) finish(true, `received ${audioBytes} bytes of audio`);
    return;
  }
  const text = data.toString('utf8');
  if (text.includes('Path:turn.end')) finish(audioBytes > 0, `turn ended, audio=${audioBytes}B`);
  if (text.startsWith('Path:')) sawPath = text.split('\r\n')[0];
});

ws.on('error', (error) => finish(false, 'socket error: ' + (error && error.message)));
ws.on('close', (code) => { if (!settled) finish(false, `closed early (code ${code})${sawPath ? ', last ' + sawPath : ''}`); });

setTimeout(() => finish(audioBytes > 0, `timeout; audio=${audioBytes}B`), 12000);
