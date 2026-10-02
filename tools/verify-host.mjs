// Prove the host half satisfies Cordis's config contract.
//
// Cordis resolves a plugin's config as:
//     if (!runtime.Config) return config;
//     runtime.Config['~standard'].validate(config)
// so a plain JSON-Schema object crashes with
//   "Cannot read properties of undefined (reading 'validate')".
//
// This checks both the old (broken) shape and the current one, so the
// regression is explicit.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)));
const ROOT = resolve(HERE, '..');
const HOST = resolve(ROOT, 'lib/index.js');

if (!existsSync(HOST)) {
  console.error('lib/index.js not found');
  process.exit(2);
}

/** The exact logic from @deepseek-ai/cordis resolveConfig. */
function resolveConfig(runtime, config) {
  if (!runtime.Config) return config;
  const result = runtime.Config['~standard'].validate(config);
  if ('then' in result) throw new TypeError('Async config validation is not supported');
  if (result.issues) throw new Error('invalid config: ' + JSON.stringify(result.issues));
  return result.value;
}

console.log('=== old shape (plain JSON Schema) — expected to fail ===');
try {
  resolveConfig({ Config: { type: 'object', properties: {} } }, {});
  console.log('  unexpectedly passed');
  process.exitCode = 1;
} catch (error) {
  console.log('  fails as expected:', error.message);
}

console.log('\n=== current lib/index.js ===');
const mod = await import(pathToFileURL(HOST).href);
console.log('  exports        :', Object.keys(mod).join(', '));
console.log('  name           :', mod.name);
console.log('  typeof apply   :', typeof mod.apply);
console.log('  has Config     :', 'Config' in mod);

try {
  const resolved = resolveConfig(mod, { anything: true });
  console.log('  resolveConfig  : OK (returns config unchanged)');
} catch (error) {
  console.log('  resolveConfig  : FAILED —', error.message);
  process.exitCode = 1;
}

// apply() must not throw when given a minimal ctx
const calls = [];
const ctx = { logger: { debug: (m) => calls.push(m), info: (m) => calls.push(m) } };
try {
  mod.apply(ctx, {});
  console.log('  apply(ctx)     : OK');
} catch (error) {
  console.log('  apply(ctx)     : FAILED —', error.message);
  process.exitCode = 1;
}

// The file must not reference schemastery (it is dependency-free on purpose)
const source = readFileSync(HOST, 'utf8');
const importsSchemastery = /from\s+['"]@deepseek-ai\/schemastery['"]/.test(source);
console.log('  imports schemastery:', importsSchemastery, importsSchemastery ? '(unexpected)' : '(good, dependency-free)');
if (importsSchemastery) process.exitCode = 1;

console.log('\n' + (process.exitCode ? 'FAILED' : 'host half satisfies the Cordis config contract'));
