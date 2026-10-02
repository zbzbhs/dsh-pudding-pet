// Verify the voice-lab page in a real browser: it loads, the Markdown cleaner
// behaves, and the system voice list is visible.
//
// Portable by design: the browser is located from PATH or CHROME, and the page
// is loaded from the repo itself. Run it from anywhere:
//
//   node dev/verify-voice-lab.cjs
//   CHROME=/path/to/chrome node dev/verify-voice-lab.cjs
//
// Set CHROME_HEADLESS=0 to run the browser with a visible window.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)));
const ROOT = resolve(HERE, '..');
const PAGE = join(HERE, 'voice-lab.html');

/** Find a Chromium-based browser without hardcoding a machine-specific path. */
function findBrowser() {
  const candidates = [
    process.env.CHROME,
    process.env.CHROME_PATH,
    'chrome-headless-shell',
    'chrome',
    'chromium',
    'msedge',
    // Common install locations, tried only as a fallback.
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.includes('/') || candidate.includes('\\')) {
      if (existsSync(candidate)) return candidate;
      continue;
    }
    // Treat as a command name: let the shell resolve it.
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch { /* not on PATH */ }
  }
  return null;
}

const browser = findBrowser();
if (!browser) {
  console.error('No Chromium-based browser found.');
  console.error('Set CHROME=/path/to/chrome (or CHROME_HEADLESS=0 to use a windowed one).');
  process.exit(2);
}

if (!existsSync(PAGE)) {
  console.error('voice-lab.html not found at ' + PAGE);
  process.exit(2);
}

const args = [
  '--disable-gpu',
  '--no-sandbox',
  '--virtual-time-budget=6000',
  '--dump-dom',
  pathToFileURL(PAGE).href,
];
if (process.env.CHROME_HEADLESS !== '0') args.unshift('--headless');

console.log('browser:', browser);
let dom;
try {
  dom = execFileSync(browser, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (error) {
  console.error('failed to run the browser:', error && error.message);
  process.exit(1);
}

function grab(id) {
  // Read an element's inner HTML. The engine status contains nested <b>/<br>,
  // so a naive "up to the first <" match truncates it; slice to the element's
  // own closing tag instead.
  const start = dom.indexOf(`id="${id}"`);
  if (start < 0) return null;
  const openEnd = dom.indexOf('>', start);
  if (openEnd < 0) return null;
  const rest = dom.slice(openEnd + 1);
  const stop = rest.indexOf('</div>');
  return stop >= 0 ? rest.slice(0, stop) : rest.slice(0, 800);
}

const engine = (grab('engineStatus') || '(not found)')
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const clean = grab('cleanMd') || '';

console.log('\n=== engine status ===');
console.log(engine);
console.log('\n=== cleaned text (what would be spoken) ===');
console.log(clean);

const problems = [];
if (!clean) problems.push('cleanMd did not render');
if (clean.includes('```')) problems.push('fenced code block leaked');
if (clean.includes('print(')) problems.push('code content leaked');
if (clean.includes('|')) problems.push('table pipe leaked');
if (clean.includes('**')) problems.push('bold markers leaked');
if (clean.includes('##')) problems.push('heading markers leaked');
if (clean.includes('https://')) problems.push('raw URL leaked');
if (!clean.includes('链接')) problems.push('link replacement missing');

console.log('\n=== checks ===');
if (problems.length) {
  for (const p of problems) console.log('  FAIL ' + p);
  process.exitCode = 1;
} else {
  console.log('  all markdown-cleaning checks passed');
}

const optionCount = (dom.match(/<option[^>]*>/g) || []).length;
console.log('voice <option> count: ' + optionCount);
