// Bake the Pudding artwork into lib/client.js.
//
// Why this exists
// ---------------
// DSH serves a plugin's browser code through a `/plugins/<id>/<file>` route
// that only accepts files named `client.*.js` (CLIENT_CHUNK in
// dsh-client-modules). Arbitrary assets under `assets/` are therefore NOT
// fetchable at runtime, so the artwork and its stylesheet have to travel inside
// the bundle.
//
// Inputs (single sources of truth)
//   assets/pudding.js   -- self-contained IIFE controller, SVG already inlined
//   assets/pudding.css  -- state animations, scoped under `.cat`
//   lib/client.template.js -- authored source with two placeholders
//
// Output
//   lib/client.js       -- generated; never edit by hand
//
// The substitution is plain text, so the generated file stays reviewable.
//
// Usage
//   node tools/build.mjs           write lib/client.js
//   node tools/build.mjs --check   fail if lib/client.js is stale
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)));
const ROOT = resolve(HERE, '..');

const TEMPLATE = resolve(ROOT, 'lib/client.template.js');
const OUTPUT = resolve(ROOT, 'lib/client.js');
const ART_JS = resolve(ROOT, 'assets/pudding.js');
const ART_CSS = resolve(ROOT, 'assets/pudding.css');

const JS_MARK = '"__PUDDING_ARTWORK_JS__"';
const CSS_MARK = '"__PUDDING_ARTWORK_CSS__"';

/** JSON.stringify yields a valid JS string literal (quotes/backslashes/newlines escaped). */
function asLiteral(text) {
  return JSON.stringify(text);
}

/**
 * Normalize line endings to LF.
 *
 * The generated bundle is committed, and `.gitattributes` stores it with LF.
 * If a Windows checkout has CRLF on disk, an un-normalized build would produce
 * a file that differs from the committed one byte-for-byte, making
 * `--check` fail and the artifact non-reproducible across platforms.
 */
function toLf(text) {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * Guard against inputs that would break the substitution.
 *
 * The artwork JS is embedded as a JS string literal and later run through
 * `new Function(...)`, so a literal `</script` is harmless (this is not HTML).
 * Only emptiness is checked here; correctness of the generated bundle is proven
 * by actually parsing it (see verifySyntax below).
 */
function assertUsable(name, text) {
  if (!text.trim()) throw new Error(`${name} is empty`);
}

/**
 * Prove the generated bundle is syntactically valid JavaScript.
 *
 * `window.__ModuleLoader__.load({...})` is a plain call, so parsing the file as
 * a script is enough to catch an unbalanced brace, a stray quote, or a broken
 * template substitution.
 */
function verifySyntax(source) {
  try {
    // eslint-disable-next-line no-new-func
    new Function(source);
  } catch (error) {
    throw new Error(`generated bundle is not valid JavaScript: ${error && error.message}`);
  }
}

async function main() {
  const check = process.argv.includes('--check');

  const [template, artJs, artCss] = await Promise.all([
    readFile(TEMPLATE, 'utf8'),
    readFile(ART_JS, 'utf8'),
    readFile(ART_CSS, 'utf8'),
  ]);

  assertUsable('pudding.js', artJs);
  assertUsable('pudding.css', artCss);

  if (!template.includes(JS_MARK)) throw new Error(`template is missing ${JS_MARK}`);
  if (!template.includes(CSS_MARK)) throw new Error(`template is missing ${CSS_MARK}`);

  const built = toLf(template
    .replace(JS_MARK, asLiteral(artJs))
    .replace(CSS_MARK, asLiteral(artCss)));

  verifySyntax(built);

  const kb = (s) => (Buffer.byteLength(s, 'utf8') / 1024).toFixed(1);

  if (check) {
    let current = '';
    try { current = await readFile(OUTPUT, 'utf8'); } catch { /* not built yet */ }
    if (current !== built) {
      console.error('lib/client.js is out of date. Run: node tools/build.mjs');
      process.exitCode = 1;
      return;
    }
    console.log(`lib/client.js is up to date (${kb(built)} KB)`);
    return;
  }

  await writeFile(OUTPUT, built, 'utf8');
  console.log(`wrote lib/client.js  ${kb(built)} KB`);
  console.log(`  template ${kb(template)} KB + artwork ${kb(artJs)} KB + css ${kb(artCss)} KB`);
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exitCode = 1;
});
