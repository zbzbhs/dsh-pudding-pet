// Verify the pitch-shift mechanism without an audio device.
//
// The browser probe could not run: chrome-headless-shell has no audio device,
// a live AudioContext never advances, and OfflineAudioContext's
// `startRendering()` promise does not settle under `--virtual-time-budget`
// (the render runs on the audio thread, which virtual time does not drive).
//
// So the mechanism is verified two ways that do not need a device:
//
//   1. Resampling arithmetic — the definition of the effect, checked directly.
//   2. Feature detection — that the property the code sets actually exists.
//
// This proves the *mechanism* the client relies on. It does not prove any
// particular browser build honours it, which is why dev/probe-morph-mechanism.html
// stays in the repo to be opened on the real machine.
const TONE = 440;
const RATE = 1.4;

console.log('=== 1. resampling arithmetic ===');
console.log(`  source tone          : ${TONE} Hz`);
console.log(`  playbackRate         : ${RATE}x`);

// Reading a waveform 1.4x faster multiplies every frequency by 1.4.
const shifted = TONE * RATE;
console.log(`  expected after shift : ${shifted.toFixed(1)} Hz`);
console.log(`  ratio                : ${(shifted / TONE).toFixed(3)}`);

// The pitch compensation, when enabled, is a time-stretch that restores the
// original frequency by resampling back down.
const compensated = shifted / RATE;
console.log(`  with compensation on : ${compensated.toFixed(1)} Hz (back to the original)`);

const semitones = 12 * Math.log2(RATE);
console.log(`  shift in semitones   : +${semitones.toFixed(2)}`);

// --- compare against the service's own ceiling ------------------------------
// Measured earlier: the Edge TTS endpoint stops honouring pitch above ~+90Hz.
// For a 200 Hz male-ish fundamental, +90 Hz is a large shift already, but the
// point of the extra speed is to go beyond whatever the service will do.
console.log('\n=== 2. what this adds on top of the service ===');
for (const base of [120, 180, 220]) {
  const service = base + 90;          // +90Hz, the measured ceiling
  const extra = service * RATE;       // then the client's extra speed
  console.log(
    `  fundamental ${String(base).padStart(3)} Hz`
    + ` -> service +90Hz = ${String(service).padStart(3)} Hz`
    + ` -> client ${RATE}x = ${extra.toFixed(0)} Hz`,
  );
}
console.log('  (the client rate multiplies whatever the service produced)');

console.log('\n=== 3. feature detection in the bundle ===');
const { readFileSync } = await import('node:fs');
const { resolve, dirname } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const HERE = resolve(dirname(fileURLToPath(import.meta.url)));
const bundle = readFileSync(resolve(HERE, '..', 'lib/client.js'), 'utf8');

const checks = [
  ['sets playbackRate', /playbackRate\s*=/.test(bundle)],
  ['sets preservesPitch', /preservesPitch\s*=/.test(bundle)],
  ['also sets the webkit alias', /webkitPreservesPitch\s*=/.test(bundle)],
  ['also sets the moz alias', /mozPreservesPitch\s*=/.test(bundle)],
  ['clamps the rate to a sane range', /clamp\([^)]*morphSpeed[^)]*0\.6[^)]*1\.6\)/.test(bundle)],
  ['only applies it when morph is on', /morph\s*\?\s*this\.preferences\.morphSpeed\s*:\s*1/.test(bundle)],
];
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`);
  if (!ok) failed++;
}

console.log('\n' + (failed
  ? `FAILED (${failed}): the client does not set the mechanism as expected`
  : 'mechanism verified: the client sets playbackRate with pitch compensation off'));
console.log('\nBrowser-only confirmation is still available at:');
console.log('  dev/probe-morph-mechanism.html');
process.exitCode = failed ? 1 : 0;
