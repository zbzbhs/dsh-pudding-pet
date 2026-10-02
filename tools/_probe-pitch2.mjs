// Push the voice change well past the browser ceiling and produce files the
// user can actually listen to.
//
// `atempo` accepts 0.5..100 per instance, so 1/factor below 0.5 needs two
// chained stages. That is what unlocks factors above 2.0.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)));
const OUT = resolve(HERE, '..', 'dev', 'voice-samples');
mkdirSync(OUT, { recursive: true });

const src = join(OUT, 'source-neutral.wav');

// 1. Neutral source from the Windows voice.
const ps = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice('Microsoft Huihui Desktop')
$s.Rate = 0
$s.SetOutputToWaveFile('${src.replace(/\\/g, '\\\\')}')
$s.Speak('你好呀，我是布丁。今天想陪你一起干活，你说什么我就跟着念什么。')
$s.Dispose()
`;
execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' });
if (!existsSync(src)) { console.log('FAILED: no source wav'); process.exit(1); }

function wavInfo(p) {
  const b = readFileSync(p);
  return {
    channels: b.readUInt16LE(22),
    sampleRate: b.readUInt32LE(24),
    bits: b.readUInt16LE(34),
    bytes: b.length,
  };
}
const info = wavInfo(src);
const dur = (i) => (i.bytes - 44) / (i.sampleRate * i.channels * (i.bits / 8));
console.log(`source: ${info.sampleRate}Hz ${info.channels}ch ${info.bits}bit ${dur(info).toFixed(2)}s`);

/** Build an ffmpeg filter chain that shifts pitch while keeping duration. */
function chain(factor, rate) {
  const target = rate * factor;
  // atempo must stay within 0.5..100, so split the correction if needed.
  const need = 1 / factor;
  const stages = [];
  let remaining = need;
  while (remaining < 0.5) { stages.push(0.5); remaining /= 0.5; }
  stages.push(remaining);
  return `asetrate=${Math.round(target)},aresample=${rate},`
    + stages.map((t) => `atempo=${t.toFixed(4)}`).join(',');
}

console.log('\n=== generated samples (listen to these) ===');
console.log('  file                    factor  shift    duration  note');
const plan = [
  [1.0, 'neutral (reference)'],
  [1.35, 'browser pitch 2.0 is roughly here'],
  [1.7, 'clearly cartoonish'],
  [2.0, 'strong; one octave up'],
  [2.4, 'very strong'],
  [2.8, 'extreme — may sound thin'],
];

const made = [];
for (const [factor, note] of plan) {
  const name = `pitch-${factor.toFixed(2)}.wav`;
  const out = join(OUT, name);
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-af', chain(factor, info.sampleRate), out], { stdio: 'ignore' });
    const o = wavInfo(out);
    const semis = (12 * Math.log2(factor)).toFixed(1);
    console.log(`  ${name.padEnd(22)} ${factor.toFixed(2)}   +${semis.padStart(4)}st  ${dur(o).toFixed(2)}s    ${note}`);
    made.push(name);
  } catch (error) {
    console.log(`  ${name.padEnd(22)} FAILED: ${(error.message || '').split('\n')[0].slice(0, 50)}`);
  }
}

// 3. An audition page so the user can compare in one place.
const rows = made.map((f) => {
  const factor = Number(f.match(/pitch-([\d.]+)\.wav/)[1]);
  const semis = (12 * Math.log2(factor)).toFixed(1);
  return `<figure><figcaption>pitch ${factor.toFixed(2)} · +${semis} 半音</figcaption>`
    + `<audio controls preload="none" src="${f}"></audio></figure>`;
}).join('\n');

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>布丁变声试听</title>
<style>
body{margin:0;padding:22px;background:#1b1c1e;color:#e8eaed;
 font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
h1{font-size:18px;margin:0 0 4px}
p.sub{color:#a3a8b0;font-size:12.5px;margin:0 0 20px}
figure{margin:0 0 14px;padding:12px 14px;background:#232427;border:1px solid #3a3d42;border-radius:10px}
figcaption{color:#4FB6A6;font-size:12.5px;font-weight:600;margin-bottom:8px}
audio{width:100%;max-width:520px;display:block}
.note{margin-top:18px;padding-top:14px;border-top:1px solid #3a3d42;color:#7c828b;font-size:12px;line-height:1.7}
</style></head><body>
<h1>布丁变声试听</h1>
<p class="sub">同一个句子、不同变声强度。时长已保持（不是简单加速）。选一个你满意的，我把它设为默认。</p>
${rows}
<div class="note">
  浏览器 <code>speechSynthesis</code> 的 <code>pitch</code> 上限是 2.0，且它的输出无法被捕获做后处理。<br>
  上面这些是<b>宿主侧合成 + 重采样变调</b>的结果——重采样会同时抬高基频和共振峰，这正是“卡通嗓”听起来对的原因。<br>
  参考：pitch 1.35 ≈ 浏览器 2.0 附近的听感；1.7 起明显卡通化；2.4 以上开始发尖。
</div>
</body></html>`;

const htmlPath = join(OUT, 'index.html');
(await import('node:fs')).writeFileSync(htmlPath, html, 'utf8');

console.log(`\nwrote ${made.length} samples + index.html`);
console.log('open:', htmlPath);
