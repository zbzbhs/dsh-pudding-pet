// Inspect what the built bundle exports, without a browser.
//
// Loads lib/client.js against a minimal loader shim and reports the module's
// export shape. Useful when a plugin fails to register and you need to know
// whether the bundle itself is at fault.
//
//   node tools/inspect-exports.mjs
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)));
const ROOT = resolve(HERE, '..');
const BUNDLE = resolve(ROOT, 'lib/client.js');

if (!existsSync(BUNDLE)) {
  console.error('lib/client.js not found. Run: node tools/build.mjs');
  process.exit(2);
}

const source = readFileSync(BUNDLE, 'utf8');

let registered = null;
globalThis.window = { __ModuleLoader__: { load: (def) => { registered = def; } } };
globalThis.document = {
  createElement: () => ({ style: {} }),
  getElementById: () => null,
  head: { appendChild() {} },
  documentElement: { appendChild() {} },
  body: { appendChild() {} },
};

new Function(source)();

if (!registered) {
  console.error('the bundle never called window.__ModuleLoader__.load()');
  process.exit(1);
}

const fakeReact = {
  createElement: () => ({}),
  useRef: () => ({ current: null }),
  useEffect: () => {},
};

let mod;
try {
  mod = registered.factory((name) => {
    if (name === 'react') return fakeReact;
    throw new Error('unexpected require: ' + name);
  });
} catch (error) {
  console.error('factory threw:', error && error.message);
  process.exit(1);
}

console.log('registered id :', registered.id);
console.log('exports       :', JSON.stringify(Object.keys(mod || {})));
console.log('typeof apply  :', typeof (mod && mod.apply));
console.log('inject        :', JSON.stringify(mod && mod.inject));

const ok = typeof (mod && mod.apply) === 'function'
  && Array.isArray(mod && mod.inject)
  && mod.inject.includes('slots');
console.log('\n' + (ok ? 'export shape looks correct' : 'export shape is WRONG'));
process.exitCode = ok ? 0 : 1;
