// Prove the host half satisfies Cordis's config contract and still loads.
//
// Cordis resolves a plugin's config as:
//     if (!runtime.Config) return config;
//     runtime.Config['~standard'].validate(config)
// so a plain JSON-Schema object crashes with
//   "Cannot read properties of undefined (reading 'validate')".
//
// This is the regression guard for that crash. Route behaviour and real
// synthesis are covered separately by dev/test-host-tts.mjs; here the only
// question is whether the module is a well-formed, config-safe Cordis plugin.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)));
const ROOT = resolve(HERE, '..');
const HOST = resolve(ROOT, 'lib/index.js');

if (!existsSync(HOST)) {
  console.error('lib/index.js not found');
  process.exit(2);
}

const problems = [];
function note(ok, label, detail = '') {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? '  (' + detail + ')' : ''}`);
  if (!ok) problems.push(label);
}

/** The exact logic from @deepseek-ai/cordis resolveConfig. */
function resolveConfig(runtime, config) {
  if (!runtime.Config) return config;
  const result = runtime.Config['~standard'].validate(config);
  if ('then' in result) throw new TypeError('Async config validation is not supported');
  if (result.issues) throw new Error('invalid config: ' + JSON.stringify(result.issues));
  return result.value;
}

console.log('=== the crash this guards against (plain JSON Schema) ===');
{
  let threw = false;
  try {
    resolveConfig({ Config: { type: 'object', properties: {} } }, {});
  } catch (error) {
    threw = true;
    console.log('  reproduces:', error.message);
  }
  note(threw, 'a plain JSON-Schema Config still crashes resolveConfig');
}

console.log('\n=== current lib/index.js ===');
const mod = await import(pathToFileURL(HOST).href);
note(typeof mod.name === 'string', 'exports a string name', mod.name);
note(typeof mod.apply === 'function', 'exports apply()');
note(!('Config' in mod), 'declares no Config (the crash source)');

try {
  resolveConfig(mod, { anything: true });
  note(true, 'resolveConfig() accepts the module');
} catch (error) {
  note(false, 'resolveConfig() accepts the module', error.message);
}

// The module must stay free of a schemastery dependency.
const source = readFileSync(HOST, 'utf8');
note(
  !/from\s+['"]@deepseek-ai\/schemastery['"]/.test(source),
  'no schemastery import (stays dependency-free)',
);

console.log('\n=== apply() against a realistic host context ===');
{
  const registered = [];
  let injected = null;
  const ctx = {
    // The real host context provides this; the module calls it to wait for
    // `webServer`, and a stub that omitted it would fail for the wrong reason.
    inject(names, fn) { injected = names; fn(ctx); },
    effect(fn) { return fn; },
    on() {},
    logger: { warn() {}, info() {}, debug() {} },
    webServer: {
      register({ kind, path, handler }) {
        registered.push({ kind, path, handler });
        return () => {};
      },
    },
  };
  try {
    mod.apply(ctx, {});
    note(true, 'apply(ctx) runs without throwing');
  } catch (error) {
    note(false, 'apply(ctx) runs without throwing', error.message);
  }
  note(Array.isArray(injected) && injected.includes('webServer'), 'injects webServer', JSON.stringify(injected));
  // Synthesis, the voice catalog, and local art.
  note(registered.length === 3, 'registers exactly three routes', 'count=' + registered.length);
  note(registered.every((r) => r.kind === 'exact'), 'all routes are exact matches');
  note(registered.every((r) => typeof r.handler === 'function'), 'all routes have handlers');
  const paths = registered.map((r) => r.path).sort();
  note(paths.includes('/pudding-pet/tts'), 'tts route registered');
  note(paths.includes('/pudding-pet/voices'), 'voices route registered');
  note(paths.includes('/pudding-pet/art'), 'local art route registered');
}

console.log('\n=== the vendored synthesis module loads ===');
{
  const vendored = resolve(ROOT, 'lib/edge-tts.js');
  note(existsSync(vendored), 'lib/edge-tts.js exists');
  if (existsSync(vendored)) {
    const text = readFileSync(vendored, 'utf8');
    note(/\bMIT\b/.test(text), 'carries an MIT notice');
    note(/dsh-tts-reader/.test(text), 'names its upstream source');
    try {
      const m = await import(pathToFileURL(vendored).href);
      note(typeof m.synthesizeMp3 === 'function', 'exports synthesizeMp3()');
      note(typeof m.synthesizeMp3WithRetry === 'function', 'exports synthesizeMp3WithRetry()');
      note(typeof m.listVoices === 'function', 'exports listVoices()');
    } catch (error) {
      note(false, 'vendored module imports cleanly', error.message);
    }
  }
}

// A missing attribution file would be a licence problem, not a code problem.
console.log('\n=== attribution present ===');
{
  const notices = resolve(ROOT, 'THIRD-PARTY-NOTICES.md');
  note(existsSync(notices), 'THIRD-PARTY-NOTICES.md exists');
}

console.log('\n' + (problems.length
  ? `FAILED (${problems.length}): ${problems.join('; ')}`
  : 'host half satisfies the Cordis config contract'));
process.exitCode = problems.length ? 1 : 0;
