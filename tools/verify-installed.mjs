// Verify the INSTALLED copy inside the DSH profile, not just the repo copy.
//
// A profile-installed GitHub bundle is a static copy, so fixing the repo does
// not prove the installed one is fixed. This checks the profile's copy directly
// and compares it against the repo.
//
// Portable: the repo root is derived from this file's location, and the profile
// is found from DSH_PROFILE_DIR (set by DSH) or the conventional path.
//
//   node tools/verify-installed.mjs
//   node tools/verify-installed.mjs /path/to/node_modules/dsh-pudding-pet
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)));
const REPO = resolve(HERE, '..');

const HOME = process.env.USERPROFILE || process.env.HOME || '';
const PROFILE_DIR = process.env.DSH_PROFILE_DIR
  || join(HOME, '.dsh', 'profiles', process.env.DSH_PROFILE || 'desktop');
const PROFILE = process.argv[2] || join(PROFILE_DIR, 'node_modules', 'dsh-pudding-pet');

const hash = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
// Compare content, not line endings: git stores LF while a Windows checkout may
// materialize CRLF, and the installed copy comes from git. Normalizing keeps
// this check about the code rather than about the checkout.
const contentHash = (p) => createHash('sha256')
  .update(readFileSync(p, 'utf8').replace(/\r\n/g, '\n'))
  .digest('hex');
const problems = [];
function note(ok, label, detail = '') {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? '  (' + detail + ')' : ''}`);
  if (!ok) problems.push(label);
}

console.log('repo    :', REPO);
console.log('profile :', PROFILE);

console.log('\n=== profile copy present ===');
note(existsSync(PROFILE), 'installed package directory');
if (!existsSync(PROFILE)) { console.log('\nFAILED: nothing installed at that path'); process.exit(1); }

console.log('\n=== required files ===');
for (const rel of ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js', 'assets/icon.svg', 'locale/zh.json']) {
  note(existsSync(join(PROFILE, rel)), rel);
}

console.log('\n=== installed copy matches the repo (content, ignoring line endings) ===');
for (const rel of ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js']) {
  const a = join(PROFILE, rel);
  const b = join(REPO, rel);
  if (!existsSync(a) || !existsSync(b)) { note(false, rel + ' (missing)'); continue; }
  note(contentHash(a) === contentHash(b), rel + ' identical');
}

console.log('\n=== host half: Cordis config contract ===');
// The exact logic from @deepseek-ai/cordis resolveConfig.
function resolveConfig(runtime, config) {
  if (!runtime.Config) return config;
  const result = runtime.Config['~standard'].validate(config);
  if ('then' in result) throw new TypeError('Async config validation is not supported');
  if (result.issues) throw new Error('invalid config');
  return result.value;
}
const hostSrc = readFileSync(join(PROFILE, 'lib/index.js'), 'utf8');
note(!/export\s+const\s+Config/.test(hostSrc), 'no Config export (the crash source)');
note(!/from\s+['"]@deepseek-ai\/schemastery['"]/.test(hostSrc), 'no schemastery import (stays dependency-free)');

const host = await import(pathToFileURL(join(PROFILE, 'lib/index.js')).href);
note(typeof host.apply === 'function', 'exports apply()');
note(typeof host.name === 'string', 'exports name');
try { resolveConfig(host, {}); note(true, 'resolveConfig() accepts the module'); }
catch (error) { note(false, 'resolveConfig() accepts the module', error.message); }
{
  // The host half waits for `webServer` through ctx.inject, so a stub without
  // it would fail for the wrong reason. Count the routes it registers too.
  const routes = [];
  const ctx = {
    inject(names, fn) { fn(ctx); },
    effect(fn) { return fn; },
    on() {},
    logger: { warn() {}, info() {}, debug() {} },
    webServer: { register({ path }) { routes.push(path); return () => {}; } },
  };
  try {
    host.apply(ctx, {});
    note(true, 'apply(ctx) runs without throwing');
    note(routes.length === 3, 'registers three routes', 'count=' + routes.length);
    note(routes.includes('/pudding-pet/tts'), 'tts route registered');
    note(routes.includes('/pudding-pet/voices'), 'voices route registered');
    note(routes.includes('/pudding-pet/art'), 'local art route registered');
  } catch (error) {
    note(false, 'apply(ctx) runs without throwing', error.message);
  }
}

console.log('\n=== vendored synthesis module ===');
{
  const vendored = join(PROFILE, 'lib/edge-tts.js');
  note(existsSync(vendored), 'lib/edge-tts.js present');
  if (existsSync(vendored)) {
    const text = readFileSync(vendored, 'utf8');
    note(/\bMIT\b/.test(text), 'carries an MIT notice');
    note(/dsh-tts-reader/.test(text), 'names its upstream source');
  }
}

console.log('\n=== manifest declares a bundle + client half ===');
const pkg = JSON.parse(readFileSync(join(PROFILE, 'package.json'), 'utf8'));
note(pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'dsh.bundle.patch declared');
note(pkg.dsh?.client?.platform === 'web', 'dsh.client.platform = web');
note(typeof pkg.exports?.['./client'] === 'string', 'exports["./client"] present (hard requirement)');
note(pkg.type === 'module', 'type: module');

console.log('\n=== client bundle loads and exports correctly ===');
const clientSrc = readFileSync(join(PROFILE, 'lib/client.js'), 'utf8');
let registered = null;
globalThis.window = { __ModuleLoader__: { load: (def) => { registered = def; } } };
globalThis.document = {
  createElement: () => ({ style: {} }), getElementById: () => null,
  head: { appendChild() {} }, documentElement: { appendChild() {} }, body: { appendChild() {} },
};
new Function(clientSrc)();
note(registered !== null, 'client bundle registered itself');
if (registered) {
  note(registered.id === 'dsh-pudding-pet', 'registered id matches package name', registered.id);
  const mod = registered.factory((n) => {
    if (n === 'react') {
      return { createElement: () => ({}), useRef: () => ({ current: null }), useEffect: () => {} };
    }
    throw new Error('unexpected require: ' + n);
  });
  note(typeof mod.apply === 'function', 'client exports apply()');
  note(Array.isArray(mod.inject) && mod.inject.includes('slots'), 'client injects slots', JSON.stringify(mod.inject));
}

console.log('\n' + (problems.length
  ? `FAILED (${problems.length}): ${problems.join('; ')}`
  : 'installed copy is correct'));
process.exitCode = problems.length ? 1 : 0;
