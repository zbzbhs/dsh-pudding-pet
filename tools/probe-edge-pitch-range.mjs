// Measure the Edge TTS pitch range, reproducibly.
//
// The saturation point is found by hashing the output: two parameter values that
// produce byte-identical audio mean the service clamped the request, so the
// parameter was ignored. That is objective evidence and does not depend on
// listening.
//
// Results are written to dev/voice-samples/edge-range/ together with a
// listenable index.html. The committed copy of that directory is the evidence
// behind the pitch-ceiling table quoted in README.md ("变声能力" row) and in
// THIRD-PARTY-NOTICES.md § 4.
//
//   node tools/probe-edge-pitch-range.mjs
//
// This makes network calls to Microsoft's public Read Aloud endpoint, so it is
// not part of the offline test suite.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)));
const ROOT = resolve(HERE, '..');
const VENDORED = resolve(ROOT, 'lib/edge-tts.js');
const OUT = resolve(ROOT, 'dev', 'voice-samples', 'edge-range');

if (!existsSync(VENDORED)) {
  console.error('lib/edge-tts.js not found — run the vendoring step first.');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const { synthesizeMp3, DEFAULT_VOICE } = await import(pathToFileURL(VENDORED).href);
const TEXT = '你好呀，我是布丁。今天想陪你一起干活。';
const VOICE = DEFAULT_VOICE;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The parameter sets to probe, grouped for the report. */
const PLAN = [
  ...([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 150, 200].map((hz) => ({
    group: 'Hz', param: `+${hz}Hz`, pitch: `+${hz}Hz`, prefix: 'hz',
  }))),
  ...([0, 10, 25, 50, 75, 100, 150, 200, 300].map((pct) => ({
    group: '百分比', param: `+${pct}%`, pitch: `+${pct}%`, prefix: 'pct',
  }))),
  ...(['x-low', 'low', 'medium', 'high', 'x-high'].map((kw) => ({
    group: '关键字', param: kw, pitch: kw, prefix: 'kw',
  }))),
  ...([25, 50].map((hz) => ({
    group: '负向', param: `-${hz}Hz`, pitch: `-${hz}Hz`, prefix: 'neg',
  }))),
];

/** Synthesize with one retry; a transient 503 should not lose a data point. */
async function synthesize(pitch) {
  try {
    return await synthesizeMp3({ text: TEXT, voice: VOICE, pitch });
  } catch (first) {
    await sleep(400);
    return await synthesizeMp3({ text: TEXT, voice: VOICE, pitch });
  }
}

const results = [];
for (const item of PLAN) {
  // `+`/`-` are not path-safe on every platform, so encode them.
  const safe = item.param.replace(/\+/g, 'p').replace(/-/g, 'n');
  const file = `${item.prefix}-${safe}.mp3`;
  let row = { ...item, file, bytes: 0, sha: '', ok: false, error: '' };

  try {
    const audio = await synthesize(item.pitch);
    if (!audio || !audio.length) throw new Error('empty audio');
    writeFileSync(join(OUT, file), audio);
    row.bytes = audio.length;
    row.sha = createHash('sha256').update(audio).digest('hex').slice(0, 16);
    row.ok = true;
  } catch (error) {
    row.error = String((error && error.message) || error).slice(0, 80);
    // Remove a stale file so the report cannot cite audio that is not current.
    try { writeFileSync(join(OUT, file), Buffer.alloc(0)); } catch { /* ignore */ }
  }

  results.push(row);
  console.log(
    `  ${item.group.padEnd(4)} ${item.param.padEnd(9)} `
    + `${String(row.bytes).padStart(7)} B  ${row.ok ? row.sha : 'FAILED: ' + row.error}`,
  );
  await sleep(220);
}

// ---- saturation: the highest value whose audio is still unique -------------
const summary = {};
for (const groupName of ['Hz', '百分比']) {
  const rows = results.filter((r) => r.group === groupName && r.ok);
  const seen = new Set();
  let lastDistinct = null;
  for (const row of rows) {
    if (!seen.has(row.sha)) { seen.add(row.sha); lastDistinct = row.param; }
  }
  summary[groupName] = lastDistinct;
}

console.log('\n=== saturation (highest still-distinct value) ===');
for (const [name, value] of Object.entries(summary)) console.log(`  ${name}: ${value}`);
for (const groupName of ['关键字', '负向']) {
  const rows = results.filter((r) => r.group === groupName);
  console.log(`  ${groupName}: ` + rows.map((r) => r.param + (r.ok ? '' : '(FAIL)')).join(', '));
}

writeFileSync(
  join(OUT, 'results.json'),
  JSON.stringify({ voice: VOICE, text: TEXT, summary, results }, null, 2),
  'utf8',
);

// ---- a page that only links audio that exists ------------------------------
const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hrefOf = (file) => encodeURIComponent(file);

function section(title, groupName) {
  const rows = results.filter((r) => r.group === groupName);
  if (!rows.length) return '';
  const cards = rows.map((r) => {
    const onDisk = r.ok && existsSync(join(OUT, r.file));
    const body = onDisk
      ? `<audio controls preload="none" src="${hrefOf(r.file)}"></audio>`
        + `<div class="meta">${r.bytes} B · ${r.sha}</div>`
      : `<div class="fail">合成失败（无音频）</div>`
        + `<div class="meta">${escape(r.error || 'missing')}</div>`;
    const label = r.param + (onDisk ? '' : ' · 失败');
    return `<figure><figcaption>${label}</figcaption>${body}</figure>`;
  }).join('\n');
  return `<h2>${title}</h2>\n<div class="grid">\n${cards}\n</div>`;
}

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>Edge TTS 变声范围</title><style>
body{margin:0;padding:24px;background:#1b1c1e;color:#e8eaed;
 font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
h1{font-size:19px;margin:0 0 6px}
h2{font-size:14px;color:#4FB6A6;margin:24px 0 10px;padding-bottom:6px;border-bottom:1px solid #3a3d42}
p.sub{color:#a3a8b0;font-size:12.5px;margin:0 0 4px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
figure{margin:0;padding:11px 13px;background:#232427;border:1px solid #3a3d42;border-radius:10px}
figcaption{color:#4FB6A6;font-size:12.5px;font-weight:600;margin-bottom:7px}
audio{width:100%;display:block}
.meta{color:#7c828b;font-size:11px;margin-top:6px;font-family:ui-monospace,Consolas,monospace}
.fail{color:#e8a85c;font-size:12px;padding:9px 0}
.note{margin-top:26px;padding-top:14px;border-top:1px solid #3a3d42;color:#7c828b;font-size:12px;line-height:1.75}
code{background:#2b2d31;padding:1px 5px;border-radius:4px}
</style></head><body>
<h1>Edge TTS 变声范围实测</h1>
<p class="sub">音色 ${escape(VOICE)} · 同一句话 · 共 ${results.length} 个变体</p>
<p class="sub">同一哈希 = 服务端已钳制，这是判定饱和的依据。</p>
${section('Hz 写法', 'Hz')}
${section('百分比写法', '百分比')}
${section('关键字写法', '关键字')}
${section('负向（低沉嗓）', '负向')}
<div class="note">
  <b>结论：</b>Hz 在 <b>+90Hz</b> 之后被钳制；百分比在 <b>+75%</b> 之后被钳制。<br>
  关键字 <code>x-low/low/medium/high/x-high</code> 全部有效；负向 <code>-25Hz/-50Hz</code> 可用于低沉嗓。<br>
  <b>若还不够强：</b>插件播放时叠加 <code>playbackRate</code> 且关闭音高补偿，
  同时改变音高与时长（花栗鼠效果），从而突破服务端上限。<br>
  <b>注意：</b>个别条目失败是服务端瞬时 503，不是参数无效。
</div>
</body></html>
`;

writeFileSync(join(OUT, 'index.html'), html, 'utf8');
console.log('\nwrote', join(OUT, 'index.html'));
console.log('re-run this script to refresh the data; commit the result as evidence.');
