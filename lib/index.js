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

import {
  DEFAULT_VOICE,
  synthesizeMp3WithRetry,
  listVoices,
  splitForRequests,
} from './edge-tts.js';

export const name = 'puddingPet';

/** Synthesis endpoint. GET only — see {@link localRejection} for why. */
const TTS_ROUTE = '/pudding-pet/tts';
/** Voice catalog, so the settings panel can offer the Neural voices. */
const VOICES_ROUTE = '/pudding-pet/voices';

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
  if (String(headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return 403;

  const origin = headers.origin;
  if (typeof origin === 'string' && origin && origin !== 'null') {
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
 * round trip plus synthesis. Keyed by everything that changes the audio, and
 * bounded so a long session cannot grow without limit.
 */
const CACHE_LIMIT = 240;
const cache = new Map();

function cacheGet(key) {
  if (!cache.has(key)) return undefined;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function cacheSet(key, value) {
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
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

        // The client aborts a request it no longer needs (a new reply started);
        // stop paying for synthesis with it.
        const controller = new AbortController();
        const onClose = () => controller.abort();
        res.on('close', onClose);
        try {
          return await handler({ params, sendJson, sendAudio, signal: controller.signal });
        } catch (error) {
          log(`route failed: ${error && error.message}`);
          return sendJson(500, { ok: false, error: String((error && error.message) || error) });
        } finally {
          res.removeListener('close', onClose);
        }
      };
    }

    disposers.push(scoped.webServer.register({
      kind: 'exact',
      path: TTS_ROUTE,
      handler: guarded(async ({ params, sendJson, sendAudio, signal }) => {
        const text = String(params.get('text') || '').trim();
        if (!text) return sendJson(400, { ok: false, error: 'missing text' });
        if (text.length > 2000) return sendJson(413, { ok: false, error: 'text too long' });

        const voice = normalizeVoice(params.get('voice'), DEFAULT_VOICE);
        const pitch = normalizeProsody(params.get('pitch'), '+0Hz', true, 400);
        const rate = normalizeProsody(params.get('rate'), '+0%', true, 200);
        const volume = normalizeProsody(params.get('volume'), '+0%', true, 100);

        const key = `${voice}\u0000${pitch}\u0000${rate}\u0000${volume}\u0000${text}`;
        const hit = cacheGet(key);
        if (hit) return sendAudio(hit, { 'x-pudding-cache': 'hit' });

        // The service caps a single request at about 1800 bytes of SSML, and CJK
        // text is 3 bytes per character — so a 2000-character reply is roughly
        // 6000 bytes and would be refused outright. Split on sentence boundaries
        // and concatenate the MP3s instead; MP3 frames join without a container
        // header, so the browser plays the result as one clip.
        const phrases = splitForRequests(text);
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
