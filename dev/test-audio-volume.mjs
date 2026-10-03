// Regression test: "clicking Test moves the mouth but plays no sound".
//
// Root cause: one field carried two meanings. `pump()` passed the SSML prosody
// offset (a percentage string like "0%") as `options.volume`, and the host engine
// assigned that straight to `audio.volume`. `Number("0%")` is NaN, and `clamp`
// resolves a non-finite value to its LOW bound, so every host-engine utterance
// played at volume 0 — silent, at any user volume setting.
//
// The fix separates them: `volumeOffset` for the request, `volume` (0..1) for the
// element. This drives the real bundle and asserts the element volume.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)));
const ROOT = resolve(HERE, '..');
const bundle = readFileSync(resolve(ROOT, 'lib/client.js'), 'utf8');

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'OK  ' : 'FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`);
}

/** Pull the host engine factory out of the built bundle. */
function extractEngineFactory() {
  const start = bundle.indexOf('function createHostSpeech()');
  if (start < 0) throw new Error('createHostSpeech not found');
  const end = bundle.indexOf('5. Visual adapter', start);
  const source = bundle.slice(start, bundle.lastIndexOf('/*', end));
  return new Function('sandbox', `
    const { fetch, URL, URLSearchParams, AbortController, Audio, clamp,
            TTS_ROUTE, VOICES_ROUTE, HOST_RETRY_MS } = sandbox;
    ${source}
    return createHostSpeech;
  `);
}

/** A sandbox whose Audio records what volume it was given. */
function makeSandbox(fetchImpl, record) {
  return {
    fetch: fetchImpl,
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    URLSearchParams,
    AbortController,
    Audio: function FakeAudio() {
      this.playbackRate = 1;
      this.preservesPitch = true;
      this.volume = 1;
      // Record what the engine assigns, then let playback "finish".
      Object.defineProperty(this, 'volume', {
        get() { return record.volume; },
        set(v) { record.volume = v; },
        configurable: true,
      });
      this.play = () => { setTimeout(() => this.onended && this.onended(), 0); return Promise.resolve(); };
      this.pause = () => {};
    },
    clamp: (v, lo, hi) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return lo;
      return n < lo ? lo : (n > hi ? hi : n);
    },
    TTS_ROUTE: '/pudding-pet/tts',
    VOICES_ROUTE: '/pudding-pet/voices',
    HOST_RETRY_MS: 60000,
    console,
  };
}

const makeFactory = extractEngineFactory();

/** Run one speak() with the given options and report the element volume. */
async function elementVolume(options) {
  const record = { volume: null };
  const urls = [];
  const fetchImpl = (url) => {
    urls.push(String(url));
    return Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve({ size: 4096 }) });
  };
  const engine = makeFactory(makeSandbox(fetchImpl, record))();
  const outcomes = [];
  engine.speak('测试音量。', options, (handled) => outcomes.push(handled));
  await new Promise((r) => setTimeout(r, 80));
  return { volume: record.volume, urls, outcomes };
}

console.log('=== the element volume must follow the 0..1 preference ===');
{
  // The shape `pump()` now sends.
  for (const level of [1, 0.8, 0.5, 0]) {
    const { volume } = await elementVolume({ volume: level, volumeOffset: '0%' });
    check(`preference ${level} plays at volume ${level}`,
      volume === level, 'audio.volume=' + volume);
  }
}

console.log('\n=== the regression: a bare prosody string must not silence it ===');
{
  // This is exactly what the old code passed as `volume`. The element must not
  // receive it, and must not end up at 0.
  const { volume } = await elementVolume({ volume: '0%' });
  check('a percentage string is not applied as the level',
    volume !== 0, 'audio.volume=' + volume);
  check('it falls back to full volume instead',
    volume === 1, 'audio.volume=' + volume);
}

console.log('\n=== the request still carries the prosody offset ===');
{
  const { urls } = await elementVolume({ volume: 1, volumeOffset: '-50%' });
  const url = urls[0] || '';
  check('the URL includes a volume parameter', url.includes('volume='), url.slice(0, 90));
  check('the offset is the percentage form', /volume=-50%25|volume=-50%/.test(url), url.slice(0, 110));
  check('the level is NOT sent as the offset', !/volume=1(?![0-9])/.test(url), url.slice(0, 110));
}

console.log('\n=== the two fields are distinct in the bundle ===');
{
  check('pump passes volumeOffset', /volumeOffset:\s*Math\.round/.test(bundle));
  check('pump passes the numeric volume', /volume:\s*this\.preferences\.volume,/.test(bundle));
  check('buildUrl reads volumeOffset', /options\.volumeOffset\)\s*params\.set\('volume'/.test(bundle));
  check('the element parses the level numerically',
    /var level = options && options\.volume != null \? Number\(options\.volume\)/.test(bundle));
}

const failed = results.filter((r) => !r.pass);
console.log('\n' + (failed.length
  ? `FAILED (${failed.length}/${results.length}): ${failed.map((f) => f.name).join('; ')}`
  : `all ${results.length} checks passed`));
process.exit(failed.length ? 1 : 0);
