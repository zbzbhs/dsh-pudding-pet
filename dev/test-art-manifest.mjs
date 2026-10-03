// Verify the locally-generated art manifest against what is actually on disk.
//
// `assets/local/` is where a user drops their own character clips, and the
// directory is gitignored. A fresh clone therefore has no manifest at all, and
// that case must stay green: it prints SKIP and exits 0 rather than failing.
// That is the whole point of the guard below — the public test suite has to run
// on a clone where the art does not exist.
//
// The manifest is produced by tools/install-local-art.py. This file never
// rewrites it; it only reports inconsistencies so the generator can be fixed.
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)));
const ROOT = resolve(HERE, '..');
const ART_DIR = join(ROOT, 'assets', 'local');
const MANIFEST = join(ART_DIR, 'manifest.json');

const SCHEMA = 'dsh-pudding-pet/art@1';
const BYTES_TOLERANCE = 0.05; // regenerate may shift a few bytes

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'OK  ' : 'FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`);
}

let skipped = 0;
function skip(name, reason = '') {
  skipped++;
  console.log(`  SKIP: ${name}${reason ? '  (' + reason + ')' : ''}`);
}

function size(p) {
  return existsSync(p) ? statSync(p).size : -1;
}

// ---------------------------------------------------------------- absent art
// A fresh clone has no `assets/local/`; every manifest check below would be
// meaningless there, so report SKIP and leave with success.
if (!existsSync(ART_DIR)) {
  console.log('\n=== local art present? ===');
  skip('未安装本地素材', 'assets/local/ 不存在 — 公开克隆的预期状态');
  console.log(`\nall ${results.length} checks passed${skipped ? `, ${skipped} skipped` : ''}`);
  process.exit(0);
}

// ---------------------------------------------------------------- manifest
console.log('\n=== manifest file ===');
let manifest = null;
let raw = '';
{
  const present = existsSync(MANIFEST);
  check('manifest.json exists', present, present ? MANIFEST : 'missing');
  if (present) {
    raw = readFileSync(MANIFEST, 'utf8');
    try {
      manifest = JSON.parse(raw);
    } catch (e) {
      manifest = null;
      check('manifest.json is valid JSON', false, String(e.message));
    }
    if (manifest) check('manifest.json is valid JSON', true, raw.length + ' bytes');
  }
}

if (!manifest || typeof manifest !== 'object') {
  console.log('\n' + `FAILED (${results.filter((r) => !r.pass).length}/${results.length}): ` +
    results.filter((r) => !r.pass).map((f) => f.name).join('; '));
  process.exit(1);
}

const clips = (manifest.clips && typeof manifest.clips === 'object') ? manifest.clips : {};
const states = (manifest.states && typeof manifest.states === 'object') ? manifest.states : {};
const canvas = (manifest.canvas && typeof manifest.canvas === 'object') ? manifest.canvas : {};
const clipEntries = Object.entries(clips);
const stateEntries = Object.entries(states);

check('schema is correct', manifest.schema === SCHEMA, JSON.stringify(manifest.schema));
check('character.id is non-empty',
  !!(manifest.character && typeof manifest.character.id === 'string' && manifest.character.id.trim()),
  manifest.character ? JSON.stringify(manifest.character.id) : 'no character');
check('canvas width/height are positive numbers',
  Number.isFinite(canvas.width) && canvas.width > 0 && Number.isFinite(canvas.height) && canvas.height > 0,
  `${canvas.width}x${canvas.height}`);
check('clip list is non-empty', clipEntries.length > 0, 'clips=' + clipEntries.length);

// ---------------------------------------------------------------- disk <-> manifest
console.log('\n=== manifest matches disk ===');
{
  const missingFiles = clipEntries.filter(([, c]) => !c || !c.file || !existsSync(join(ART_DIR, c.file)))
    .map(([k, c]) => `${k}->${c && c.file}`);
  check('every clip file exists on disk', missingFiles.length === 0, missingFiles.join(', ') || `${clipEntries.length} files`);

  const missingStills = clipEntries.filter(([, c]) => c && c.still && !existsSync(join(ART_DIR, c.still)))
    .map(([k, c]) => `${k}->${c.still}`);
  check('every clip still exists on disk', missingStills.length === 0,
    missingStills.join(', ') || `${clipEntries.filter(([, c]) => c && c.still).length} stills`);

  // Reverse direction: an unreferenced clip is an orphan the manifest forgot to list.
  const referenced = new Set(clipEntries.map(([, c]) => c && c.file).filter(Boolean));
  const onDisk = readdirSync(ART_DIR).filter((f) => f.toLowerCase().endsWith('.webp'));
  const orphans = onDisk.filter((f) => !referenced.has(f));
  check('every .webp on disk is referenced by the manifest', orphans.length === 0,
    orphans.join(', ') || `${onDisk.length} webp files`);

  const drifted = [];
  for (const [key, c] of clipEntries) {
    if (!c || !c.file || !Number.isFinite(c.bytes)) { drifted.push(`${key}: no bytes`); continue; }
    const actual = size(join(ART_DIR, c.file));
    if (actual < 0) continue; // already reported above
    const delta = Math.abs(actual - c.bytes) / Math.max(1, c.bytes);
    if (delta > BYTES_TOLERANCE) drifted.push(`${c.file} claimed=${c.bytes} actual=${actual}`);
  }
  check(`clip bytes match within ±${BYTES_TOLERANCE * 100}%`, drifted.length === 0, drifted.join(', ') || 'all match');
}

// ---------------------------------------------------------------- clip shape
console.log('\n=== clip shape ===');
{
  const badFrames = clipEntries.filter(([, c]) => !c || !Number.isFinite(c.frames) || c.frames < 1)
    .map(([k, c]) => `${k}:${c && c.frames}`);
  check('every clip has frames >= 1', badFrames.length === 0, badFrames.join(', ') || 'all >= 1');

  const badDims = clipEntries
    .filter(([, c]) => !c || c.width !== canvas.width || c.height !== canvas.height)
    .map(([k, c]) => `${k}:${c && c.width}x${c && c.height}`);
  check('every clip matches the canvas size', badDims.length === 0,
    badDims.join(', ') || `${canvas.width}x${canvas.height}`);
}

// ---------------------------------------------------------------- states
console.log('\n=== state mapping ===');
{
  const badClip = stateEntries.filter(([, s]) => !s || !clips[s.clip]).map(([k, s]) => `${k}->${s && s.clip}`);
  check('every state references an existing clip', badClip.length === 0,
    badClip.join(', ') || `${stateEntries.length} states`);

  const ambiguous = stateEntries.filter(([, s]) => {
    const loop = !!(s && s.loop === true);
    const still = !!(s && s.still === true);
    return loop === still; // neither, or both
  }).map(([k, s]) => `${k}:loop=${!!(s && s.loop)} still=${!!(s && s.still)}`);
  check('every state is exactly one of loop / still', ambiguous.length === 0,
    ambiguous.join(', ') || `${stateEntries.length} states`);

  // A still state renders a paused frame; its clip must ship one.
  const noStill = stateEntries
    .filter(([, s]) => s && s.still === true && clips[s.clip] && !clips[s.clip].still)
    .map(([k, s]) => `${k}->${s.clip}`);
  check('every still state has a still image available', noStill.length === 0,
    noStill.join(', ') || 'all still states covered');

  const variants = Array.isArray(manifest.talkVariants) ? manifest.talkVariants : [];
  const badVariants = variants.filter((v) => !clips[v]);
  check('every talkVariant exists in clips', badVariants.length === 0,
    badVariants.join(', ') || `${variants.length} variants`);

  const oddNames = stateEntries
    .filter(([k]) => !k.trim() || k !== k.trim())
    .map(([k]) => JSON.stringify(k));
  check('state names are clean (non-empty, no stray spaces)', oddNames.length === 0,
    oddNames.join(', ') || `${stateEntries.length} names`);

  const loops = stateEntries.filter(([, s]) => s && s.loop === true).length;
  const stills = stateEntries.filter(([, s]) => s && s.still === true).length;
  check('at least one loop state', loops > 0, 'loop=' + loops);
  check('at least one still state', stills > 0, 'still=' + stills);
}

const failed = results.filter((r) => !r.pass);
console.log('\n' + (failed.length
  ? `FAILED (${failed.length}/${results.length}): ${failed.map((f) => f.name).join('; ')}`
  : `all ${results.length} checks passed${skipped ? `, ${skipped} skipped` : ''}`));
process.exit(failed.length ? 1 : 0);
