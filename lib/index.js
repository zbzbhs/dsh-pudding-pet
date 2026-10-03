/**
 * Host half of the Pudding pet bundle.
 *
 * The pet itself is rendered in the browser and reads assistant text from the
 * client-side session event stream. This module adds the one thing the browser
 * cannot do: speech synthesis.
 *
 * Why synthesis lives here
 * ------------------------
 * The browser can speak through `speechSynthesis`, but that engine caps its
 * `pitch` at 2.0 and — more importantly — its output cannot be captured, so a
 * strong "cartoon" voice cannot be produced by post-processing it.
 *
 * Host-side synthesis fixes both: Edge TTS takes `pitch` as an SSML parameter,
 * returns real audio bytes, and its Neural voices sound far better than the
 * desktop SAPI ones. The browser still plays the audio, and can apply an extra
 * shift on top.
 *
 * The endpoint is deliberately small: one synthesis route and one voice-catalog
 * route, both GET-only and fenced to this machine.
 *
 * Why there is no `Config` here
 * -----------------------------
 * Cordis validates a plugin's `Config` as a Standard Schema
 * (`Config['~standard'].validate`), so a plain JSON-Schema object fails
 * activation with "Cannot read properties of undefined (reading 'validate')".
 * The correct shape needs `@deepseek-ai/schemastery`, which would add a
 * dependency for little benefit. Switching the row off is already possible at
 * the loader level (`- id: pudding-pet` / `disabled: true`).
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_VOICE,
  synthesizeMp3WithRetry,
  listVoices,
} from './edge-tts.js';

export const name = 'puddingPet';

/**
 * How long a single phrase may be, in characters.
 *
 * `splitForSpeech` budgets the *text* at 1800 bytes, which was confirmed against
 * the live service: a 2269-byte request body (2034 bytes of text plus the
 * 235-byte wrapper) was accepted and synthesized, so the wrapper does not come
 * out of the budget.
 */
const MAX_TEXT_CHARS = 2000;
const TEXT_BUDGET = 1800;

/** Escape the five XML entities, matching the vendored client's own escaping. */
function escapeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Split text into chunks that fit one request.
 *
 * The vendored `splitForRequests()` is almost right, but it can cut a surrogate
 * pair in half: it binary-searches a cut by UTF-16 length while budgeting in
 * UTF-8 bytes, so a boundary can land between an emoji's two halves. The lone
 * surrogate encodes as U+FFFD, destroying the character — reproduced with
 * `'a'.repeat(1793) + '😀'.repeat(30)`, where piece 0 ends in `\ud83d`.
 *
 * This keeps the same budgeting and boundary preference, and additionally backs
 * the cut off until it no longer separates a pair.
 *
 * @param text - the phrase to speak.
 * @returns chunks whose escaped form fits {@link TEXT_BUDGET} bytes.
 */
function splitForSpeech(text) {
  const encoder = new TextEncoder();
  const sizeOf = (value) => encoder.encode(escapeXml(value)).length;
  const splitsPair = (value, index) => {
    if (index <= 0 || index >= value.length) return false;
    const before = value.charCodeAt(index - 1);
    const after = value.charCodeAt(index);
    return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
  };

  const breaks = ['。', '！', '？', '；', '，', '. ', '! ', '? ', '; ', ', ', ' '];
  const pieces = [];
  let rest = String(text == null ? '' : text);

  while (rest.length > 0) {
    if (sizeOf(rest) <= TEXT_BUDGET) {
      pieces.push(rest);
      break;
    }

    let low = 1;
    let high = rest.length;
    let best = 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (sizeOf(rest.slice(0, middle)) <= TEXT_BUDGET) {
        best = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    while (best > 1 && splitsPair(rest, best)) best -= 1;

    const window = rest.slice(0, best);
    let cut = best;
    for (const marker of breaks) {
      const at = window.lastIndexOf(marker);
      if (at > 0) cut = Math.min(cut, at + marker.length);
    }
    if (cut <= 0) cut = best;
    while (cut > 1 && splitsPair(rest, cut)) cut -= 1;

    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }

  return pieces.filter((piece) => piece.trim().length > 0);
}

/** Synthesis endpoint. GET only — see {@link localRejection} for why. */
const TTS_ROUTE = '/pudding-pet/tts';
/** Voice catalog, so the settings panel can offer the Neural voices. */
const VOICES_ROUTE = '/pudding-pet/voices';
/**
 * Locally-supplied character art.
 *
 * The client bundle can only fetch `client.*.js` from DSH, so clips cannot be
 * loaded by URL from the package. Serving them from a host route is what makes
 * a swappable character possible at all.
 *
 * Everything here reads from `assets/local/`, which is git-ignored: the clips a
 * user drops in are their own material, outside this project's licence. A fresh
 * clone has no such directory and this route simply reports that.
 */
const ART_ROUTE = '/pudding-pet/art';

/** Extensions this route will serve. Anything else is refused. */
const ART_TYPES = new Map([
  ['.webp', 'image/webp'],
  ['.png', 'image/png'],
  ['.gif', 'image/gif'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml'],
]);

/** Hosts that count as "this machine / this app" without asking the host fence. */
const LOCAL_HOSTS = new Set(['dsh-app', 'app', 'localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Parse a dotted-quad IPv4 literal, or return null.
 *
 * A prefix test is not enough here. `10.evil.com` begins with `10.`, so a naive
 * `^(127\.|10\.|192\.168\.)` would treat an attacker-controlled domain as local
 * — the classic DNS-rebinding bypass. The whole host must be four numeric
 * octets before it can be judged by its range.
 */
function parseIpv4(host) {
  const parts = String(host).split('.');
  if (parts.length !== 4) return null;
  const octets = [];
  for (const part of parts) {
    // Reject empty, non-numeric, or padded forms ("0x7f", "010", " 1").
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

/**
 * Whether a hostname is this machine.
 *
 * Only literal private/loopback addresses qualify. A name that merely looks
 * numeric — `10.evil.com`, `192.168.evil.com`, `127.0.0.1.evil.com` — is not
 * local, which is exactly the case that a prefix match gets wrong.
 */
function isLocalHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  if (LOCAL_HOSTS.has(host)) return true;
  if (host.endsWith('.localhost')) return true;

  const octets = parseIpv4(host);
  if (!octets) return false;
  const [a, b] = octets;
  if (a === 127) return true;                       // loopback
  if (a === 10) return true;                        // 10/8
  if (a === 192 && b === 168) return true;          // 192.168/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  return false;
}

/**
 * Accept only same-origin, non-cross-site, read-only requests.
 *
 * Synthesis calls a third-party service on the user's behalf, so this route
 * must never be reachable from another page. GET/HEAD only is part of the
 * fence, which is why the client sends the phrase as a query parameter rather
 * than a request body.
 *
 * @returns a status code when the request must be refused, otherwise null.
 */
function localRejection(req) {
  const headers = (req && req.headers) || {};
  const method = String((req && req.method) || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return 405;

  // `includes`, not equality: Node joins repeated headers, so a duplicated
  // `Sec-Fetch-Site` arrives as "cross-site, same-origin" and an exact compare
  // would miss it.
  if (String(headers['sec-fetch-site'] || '').toLowerCase().includes('cross-site')) return 403;

  const origin = headers.origin;
  if (typeof origin === 'string' && origin) {
    // `Origin: null` comes from sandboxed iframes and data: pages. It is not the
    // app, so it is refused rather than treated as "no origin". (A browser cannot
    // forge Host, so this was not exploitable alone — but refusing it is the
    // stricter reading of the same rule.)
    if (origin === 'null') return 403;
    try {
      const parsed = new URL(origin);
      // The app's own custom scheme, or a same-host http origin.
      if (parsed.protocol !== 'dsh-app:') {
        const host = new URL('http://' + String(headers.host || '')).host.toLowerCase();
        if (parsed.host.toLowerCase() !== host) return 403;
      }
    } catch {
      return 403;
    }
  }
  return null;
}

/**
 * Cache synthesized phrases.
 *
 * Assistant replies repeat phrasing constantly, and each miss costs a network
 * round trip plus synthesis. Keyed by everything that changes the audio.
 *
 * Bounded by BYTES, not by entry count. An entry is not small: a 2000-character
 * CJK reply synthesizes to roughly 2.4 MB of MP3, so a 240-entry count limit
 * could retain over half a gigabyte. The byte budget keeps the cache useful for
 * short repeated phrases while capping what a long session can accumulate.
 */
const CACHE_MAX_BYTES = 48 * 1024 * 1024;
const CACHE_MAX_ENTRIES = 240;
const cache = new Map();
let cacheBytes = 0;

function cacheDrop(key) {
  const value = cache.get(key);
  if (value === undefined) return;
  cacheBytes -= value.length;
  cache.delete(key);
}

function cacheGet(key) {
  if (!cache.has(key)) return undefined;
  const value = cache.get(key);
  // Refresh recency: re-insert so the LRU order reflects this access.
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function cacheSet(key, value) {
  if (!value || !value.length) return;
  // Never store a single entry larger than the whole budget: it would evict
  // everything else and then still be dropped on the next insert.
  if (value.length > CACHE_MAX_BYTES) return;

  if (cache.has(key)) cacheDrop(key);
  cache.set(key, value);
  cacheBytes += value.length;

  while (cache.size > CACHE_MAX_ENTRIES || cacheBytes > CACHE_MAX_BYTES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cacheDrop(oldest);
  }
}

/**
 * Current cache occupancy, in entries and retained bytes.
 *
 * Exported so the byte-budget behaviour can be asserted without reaching into
 * module internals (see dev/test-cache-budget.mjs).
 */
export function cacheStats() {
  return { entries: cache.size, bytes: cacheBytes };
}

/**
 * Clamp a prosody string to something the service accepts.
 *
 * Unparseable input falls back to the default rather than being forwarded: the
 * value comes from the page, and a malformed SSML attribute would make the
 * service reset the socket instead of reporting an error.
 */
function normalizeProsody(value, fallback, allowNegative, max) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return fallback;
  const match = /^([+-]?)(\d+(?:\.\d+)?)(%|Hz)$/.exec(raw);
  if (!match) return fallback;
  const negative = match[1] === '-';
  if (negative && !allowNegative) return fallback;
  const amount = Math.min(Number(match[2]), max);
  if (!Number.isFinite(amount)) return fallback;
  return `${negative ? '-' : '+'}${amount}${match[3]}`;
}

/**
 * Accept only a plausible voice identifier.
 *
 * The vendored client interpolates the voice name into SSML
 * (`<voice name='${voice}'>`) without escaping it, so a value containing a quote
 * or angle bracket could break out of the attribute. The route is already
 * fenced to this machine and GET-only, but validating here is defence in depth:
 * it keeps a malformed value from ever reaching the wire, and rejects the
 * long-form name the service wants only when it does not look like one.
 *
 * Both accepted shapes are what the service documents:
 *   - short name:  `zh-CN-XiaoyiNeural`
 *   - long name:   `Microsoft Server Speech Text to Speech Voice (zh-CN, XiaoyiNeural)`
 */
function normalizeVoice(value, fallback) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return fallback;
  if (raw.length > 160) return fallback;
  if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(raw)) return raw;
  if (/^[A-Za-z0-9 ().,_-]+$/.test(raw)) return raw;
  return fallback;
}

/**
 * Where locally-supplied art lives.
 *
 * `assets/local/` sits beside this package and is git-ignored, so it holds the
 * user's own clips rather than anything this project distributes. Resolved from
 * this module's URL so it works whether the package is installed from git or
 * linked from a working copy.
 */
const LOCAL_ART_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'local');

/** Whether the given name is safe to resolve inside the art directory. */
function isSafeArtName(name) {
  const raw = String(name || '');
  if (!raw || raw.length > 120) return false;
  // A base name only: no separators, no traversal, no dotfiles.
  if (basename(raw) !== raw) return false;
  if (raw.startsWith('.')) return false;
  if (/[\u0000-\u001f]/.test(raw)) return false;
  return ART_TYPES.has(extname(raw).toLowerCase());
}

/**
 * Read the local art manifest, or null when no local art is installed.
 *
 * Returning null is the normal case for a fresh clone, so callers treat it as
 * "no local character" rather than as an error.
 */
async function readLocalArtManifest() {
  try {
    const text = await readFile(join(LOCAL_ART_DIR, 'manifest.json'), 'utf8');
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || !parsed.clips) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * List the art files actually present on disk.
 *
 * The manifest is written by the install script and could drift from the files
 * (a clip deleted by hand, a partial copy). Reporting what is really there keeps
 * the client from requesting a file that does not exist.
 */
async function listLocalArtFiles() {
  try {
    const names = await readdir(LOCAL_ART_DIR);
    return names.filter(isSafeArtName);
  } catch {
    return [];
  }
}

export function apply(ctx) {
  ctx.inject(['webServer'], (scoped) => {
    const disposers = [];
    const log = (message) => {
      try { ctx.logger?.warn?.(`pudding-pet: ${message}`); } catch { /* no logger */ }
    };

    /** Wrap a handler with the fence and small JSON/audio reply helpers. */
    function guarded(handler) {
      return async (req, res) => {
        const sendJson = (code, body) => {
          try {
            const text = JSON.stringify(body);
            res.writeHead(code, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
              'content-length': Buffer.byteLength(text),
            });
            res.end(text);
          } catch { /* already closed */ }
        };

        /**
         * Reply with audio bytes.
         *
         * Handlers never touch `res` themselves: it lives only in this closure,
         * and a handler that referenced it would throw a ReferenceError that a
         * nearby `catch` could swallow — a silent no-response instead of a loud
         * failure. Routing every write through a helper keeps that impossible.
         */
        const sendAudio = (bytes, extraHeaders) => {
          try {
            res.writeHead(200, {
              'content-type': 'audio/mpeg',
              'cache-control': 'no-store',
              'content-length': bytes.length,
              ...(extraHeaders || {}),
            });
            res.end(bytes);
          } catch { /* already closed */ }
        };

        /** Reply with arbitrary bytes and an explicit content type. */
        const sendBinary = (bytes, contentType, extraHeaders) => {
          try {
            res.writeHead(200, {
              'content-type': contentType,
              // Local art never changes under a fixed name, so let the browser
              // keep it; this keeps a looping animation from re-downloading.
              'cache-control': 'private, max-age=3600',
              'content-length': bytes.length,
              ...(extraHeaders || {}),
            });
            res.end(bytes);
          } catch { /* already closed */ }
        };

        const refused = localRejection(req);
        if (refused !== null) return sendJson(refused, { ok: false, error: 'refused' });

        let hostname = '';
        try {
          hostname = new URL('http://' + String((req.headers || {}).host || '')).hostname;
        } catch { hostname = ''; }
        if (!isLocalHost(hostname)) {
          try {
            const fence = scoped.connection && typeof scoped.connection.requestRejection === 'function'
              ? scoped.connection.requestRejection(req)
              : 403;
            if (fence) return sendJson(typeof fence === 'number' ? fence : 403, { ok: false, error: 'refused' });
          } catch {
            return sendJson(403, { ok: false, error: 'refused' });
          }
        }

        let params;
        try {
          params = new URL(String(req.url || '/'), 'http://localhost').searchParams;
        } catch {
          return sendJson(400, { ok: false, error: 'bad request' });
        }

        // A HEAD request is a probe, not a request for audio. Node discards the
        // body on the wire, so synthesizing for it is a wasted paid round trip.
        // Answer the headers and stop.
        if (String(req.method || 'GET').toUpperCase() === 'HEAD') {
          try {
            res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' });
            res.end();
          } catch { /* already closed */ }
          return;
        }

        // The client aborts a request it no longer needs (a new reply started);
        // stop paying for synthesis with it.
        const controller = new AbortController();
        const onClose = () => controller.abort();
        // `res` may be a bare stub. A throwing `on` must not escape the guard and
        // leave the caller with no response, so answer directly here rather than
        // through `sendJson` (which also writes to `res`).
        try {
          res.on('close', onClose);
        } catch {
          try {
            const body = JSON.stringify({ ok: false, error: 'response-not-writable' });
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
            res.end(body);
          } catch { /* nothing further can be done */ }
          return;
        }
        try {
          return await handler({ params, sendJson, sendAudio, sendBinary, signal: controller.signal });
        } catch (error) {
          log(`route failed: ${error && error.message}`);
          return sendJson(500, { ok: false, error: String((error && error.message) || error) });
        } finally {
          try { res.removeListener('close', onClose); } catch { /* already gone */ }
        }
      };
    }

    disposers.push(scoped.webServer.register({
      kind: 'exact',
      path: TTS_ROUTE,
      handler: guarded(async ({ params, sendJson, sendAudio, signal }) => {
        const text = String(params.get('text') || '').trim();
        if (!text) return sendJson(400, { ok: false, error: 'missing text' });
        if (text.length > MAX_TEXT_CHARS) return sendJson(413, { ok: false, error: 'text too long' });

        const voice = normalizeVoice(params.get('voice'), DEFAULT_VOICE);
        const pitch = normalizeProsody(params.get('pitch'), '+0Hz', true, 400);
        const rate = normalizeProsody(params.get('rate'), '+0%', true, 200);
        const volume = normalizeProsody(params.get('volume'), '+0%', true, 100);

        const key = `${voice}\u0000${pitch}\u0000${rate}\u0000${volume}\u0000${text}`;
        const hit = cacheGet(key);
        if (hit) return sendAudio(hit, { 'x-pudding-cache': 'hit' });

        // A reply can be far longer than one request may carry: the service caps
        // the text at about 1800 bytes, and CJK is 3 bytes per character, so a
        // 2000-character answer is roughly 6000 bytes. Split on sentence
        // boundaries and concatenate the MP3s; MP3 frames join without a
        // container header, so the browser plays the result as one clip.
        const phrases = splitForSpeech(text);
        if (phrases.length > 24) return sendJson(413, { ok: false, error: 'text too long' });

        let audio;
        try {
          const parts = [];
          for (const phrase of phrases) {
            if (signal?.aborted) throw new Error('aborted');
            const part = await synthesizeMp3WithRetry({ text: phrase, voice, pitch, rate, volume, signal });
            if (part && part.length) parts.push(part);
          }
          audio = parts.length === 1 ? parts[0] : Buffer.concat(parts);
        } catch (error) {
          // A refused or unreachable service is not a server fault; the client
          // falls back to the browser engine when it sees this.
          log(`synthesis unavailable: ${error && error.message}`);
          return sendJson(503, {
            ok: false,
            error: 'synthesis-unavailable',
            detail: String((error && error.message) || error),
          });
        }
        if (!audio || audio.length === 0) {
          return sendJson(503, { ok: false, error: 'synthesis-empty' });
        }

        cacheSet(key, audio);
        return sendAudio(audio, { 'x-pudding-cache': 'miss' });
      }),
    }));

    disposers.push(scoped.webServer.register({
      kind: 'exact',
      path: VOICES_ROUTE,
      handler: guarded(async ({ params, sendJson, signal }) => {
        const prefix = String(params.get('locale') || '').trim();
        try {
          const voices = await listVoices({ localePrefix: prefix, signal });
          return sendJson(200, {
            ok: true,
            defaultVoice: DEFAULT_VOICE,
            voices: voices.map((v) => ({ name: v.ShortName, gender: v.Gender, locale: v.Locale })),
          });
        } catch (error) {
          log(`voice catalog unavailable: ${error && error.message}`);
          return sendJson(503, { ok: false, error: 'catalog-unavailable' });
        }
      }),
    }));

    /**
     * Local character art: the manifest, then the files it names.
     *
     * `?name=` selects a file; without it the route answers with the manifest and
     * the list of files that actually exist. A clone with no `assets/local/`
     * gets `{ ok: true, available: false }`, which the client reads as "keep using
     * the built-in character" — never an error.
     */
    disposers.push(scoped.webServer.register({
      kind: 'exact',
      path: ART_ROUTE,
      handler: guarded(async ({ params, sendJson, sendBinary }) => {
        const name = String(params.get('name') || '').trim();

        if (!name) {
          const manifest = await readLocalArtManifest();
          const files = await listLocalArtFiles();
          if (!manifest || files.length === 0) {
            return sendJson(200, { ok: true, available: false, files: [] });
          }
          // Only advertise clips whose file is really on disk.
          const present = new Set(files);
          const clips = {};
          for (const [key, clip] of Object.entries(manifest.clips || {})) {
            if (clip && present.has(clip.file)) clips[key] = clip;
          }
          return sendJson(200, {
            ok: true,
            available: true,
            character: manifest.character || null,
            canvas: manifest.canvas || null,
            clips,
            states: manifest.states || {},
            talkVariants: Array.isArray(manifest.talkVariants) ? manifest.talkVariants : [],
            files,
          });
        }

        if (!isSafeArtName(name)) {
          return sendJson(400, { ok: false, error: 'bad-art-name' });
        }
        const type = ART_TYPES.get(extname(name).toLowerCase());
        const target = join(LOCAL_ART_DIR, name);
        try {
          const info = await stat(target);
          if (!info.isFile()) return sendJson(404, { ok: false, error: 'not-a-file' });
          const bytes = await readFile(target);
          return sendBinary(bytes, type, { 'x-pudding-art-bytes': String(bytes.length) });
        } catch (error) {
          // Report the reason instead of a blanket "not found": a silent catch
          // here once masked a real read failure as a missing file.
          log(`art read failed for ${name}: ${error && error.code} ${error && error.message}`);
          return sendJson(404, { ok: false, error: 'not-found', detail: String(error && error.code || '') });
        }
      }),
    }));

    const off = () => {
      for (const dispose of disposers) {
        try { dispose(); } catch { /* gone */ }
      }
      cache.clear();
    };
    if (typeof ctx.on === 'function') ctx.on('dispose', off);
    ctx.effect(() => off);
  });
}
