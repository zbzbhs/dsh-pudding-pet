// Regression test for the cancel race.
//
// The bug: aborting an in-flight host request ran its `AbortError` handler,
// which called back with `handled === false`. The widget reads `false` as "the
// host could not speak, fall back to the browser engine" — so pressing Stop
// spoke the sentence anyway through the Web Speech API, and a reply that
// superseded another could be read twice, once per engine.
//
// The fix: `cancel()` bumps a generation, and a superseded attempt reports
// `null` ("say nothing") instead of `false` ("try the other engine").
//
// The engine's own callback contract is what matters here, so this extracts
// `createHostSpeech` from the built bundle and drives it directly. That keeps
// the assertion about the shipped code rather than a re-implementation, and
// avoids needing a full DOM to reach a private object.
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

/** Pull the engine factory out of the built bundle. */
function extractEngineFactory() {
  const start = bundle.indexOf('function createHostSpeech()');
  if (start < 0) throw new Error('createHostSpeech not found in the bundle');
  // The next section banner marks the end of the engine.
  const marker = '5. Visual adapter';
  const end = bundle.indexOf(marker, start);
  if (end < 0) throw new Error('could not find the end of the engine section');
  // Trim back to the comment opener that precedes the banner.
  const source = bundle.slice(start, bundle.lastIndexOf('/*', end));
  return new Function('sandbox', `
    const { fetch, URL, URLSearchParams, AbortController, Audio, clamp,
            TTS_ROUTE, VOICES_ROUTE, HOST_RETRY_MS } = sandbox;
    ${source}
    return createHostSpeech;
  `);
}

const makeFactory = extractEngineFactory();

function makeSandbox(fetchImpl) {
  return {
    fetch: fetchImpl,
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    URLSearchParams,
    AbortController,
    Audio: function FakeAudio() {
      this.playbackRate = 1;
      this.preservesPitch = true;
      this.volume = 1;
      // A real element fires `ended` when playback finishes; without that the
      // success path would never settle and the assertion would time out.
      this.play = () => {
        setTimeout(() => { if (this.onended) this.onended(); }, 0);
        return Promise.resolve();
      };
      this.pause = () => {};
    },
    clamp: (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v),
    TTS_ROUTE: '/pudding-pet/tts',
    VOICES_ROUTE: '/pudding-pet/voices',
    HOST_RETRY_MS: 60000,
    console,
  };
}

console.log('=== the guard is present in the built bundle ===');
{
  check('engine factory is extractable', typeof makeFactory === 'function');
  check('tracks a generation', /var generation = 0/.test(bundle));
  check('cancel bumps it', /generation \+= 1/.test(bundle));
  check('superseded attempts are detected', /generation !== mine/.test(bundle));
  check('the widget treats null as "stay silent"', /spoken === null/.test(bundle));
  check('the widget still falls back on false', /else speakBrowser\(\)/.test(bundle));
}

console.log('\n=== a cancelled request reports null, not false ===');
{
  // A fetch that only settles when aborted — the mid-flight state.
  const fetchImpl = (url, init) => {
    if (String(url).split('?')[0] !== '/pudding-pet/tts') {
      return Promise.resolve({ ok: false, status: 404 });
    }
    return new Promise((resolvePromise, rejectPromise) => {
      const signal = init && init.signal;
      const fail = () => rejectPromise(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      if (signal) {
        if (signal.aborted) { fail(); return; }
        signal.addEventListener('abort', fail);
      }
      void resolvePromise;
    });
  };

  const engine = makeFactory(makeSandbox(fetchImpl))();
  const outcomes = [];

  const accepted = engine.speak('这句话应被取消。', {}, (handled) => outcomes.push(handled));
  check('speak() accepted the request', accepted === true, 'returned=' + accepted);

  // Let the fetch be issued, then cancel exactly as Stop does.
  await new Promise((r) => setTimeout(r, 25));
  engine.cancel();
  await new Promise((r) => setTimeout(r, 120));

  check('callback fired once', outcomes.length === 1, 'outcomes=' + JSON.stringify(outcomes));
  check('reported null (not false)', outcomes[0] === null, 'got ' + JSON.stringify(outcomes[0]));
  check(
    'so the caller will NOT fall back and speak',
    outcomes[0] !== false,
    'false would mean "speak it through the browser engine"',
  );
}

console.log('\n=== control: a real failure still reports false (fall back) ===');
{
  const engine = makeFactory(makeSandbox(() => Promise.resolve({ ok: false, status: 500 })))();
  const outcomes = [];
  engine.speak('这句会真的失败。', {}, (handled) => outcomes.push(handled));
  await new Promise((r) => setTimeout(r, 80));
  check('reported false', outcomes[0] === false, 'got ' + JSON.stringify(outcomes[0]));
}

console.log('\n=== control: success still reports true (no fallback) ===');
{
  const engine = makeFactory(makeSandbox(
    () => Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve({ size: 4096 }) }),
  ))();
  const outcomes = [];
  engine.speak('这句会成功。', {}, (handled) => outcomes.push(handled));
  await new Promise((r) => setTimeout(r, 80));
  check('reported true', outcomes[0] === true, 'got ' + JSON.stringify(outcomes[0]));
}

console.log('\n=== control: a 503 still reports false and cools down ===');
{
  const engine = makeFactory(makeSandbox(() => Promise.resolve({ ok: false, status: 503 })))();
  const outcomes = [];
  engine.speak('服务不可用。', {}, (handled) => outcomes.push(handled));
  await new Promise((r) => setTimeout(r, 80));
  check('reported false', outcomes[0] === false, 'got ' + JSON.stringify(outcomes[0]));
  check('engine marked itself not ready', engine.ready === false, 'ready=' + engine.ready);
}

const failed = results.filter((r) => !r.pass);
console.log('\n' + (failed.length
  ? `FAILED (${failed.length}/${results.length}): ${failed.map((f) => f.name).join('; ')}`
  : `all ${results.length} checks passed`));
process.exitCode = failed.length ? 1 : 0;
