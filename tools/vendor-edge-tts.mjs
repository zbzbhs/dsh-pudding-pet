// Vendor the known-working Edge TTS client, with provenance.
//
// The upstream file is MIT-licensed, so it can be redistributed with
// attribution. A header is prepended and the original body is copied byte for
// byte, so a future diff against upstream stays meaningful.
//
// Usage:
//   node tools/vendor-edge-tts.mjs <path-to-upstream-edge-tts.js>
//   EDGE_TTS_SRC=<path> node tools/vendor-edge-tts.mjs
//
// The upstream file belongs to another project and is not committed here, so
// the path is supplied by the caller instead of being baked into this script.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)));
const ROOT = resolve(HERE, '..');
const DEST = resolve(ROOT, 'lib/edge-tts.js');
const SRC = process.argv[2] || process.env.EDGE_TTS_SRC || '';

if (!SRC) {
  console.error('No upstream source given.');
  console.error('');
  console.error('  node tools/vendor-edge-tts.mjs <path-to-upstream-edge-tts.js>');
  console.error('  EDGE_TTS_SRC=<path> node tools/vendor-edge-tts.mjs');
  console.error('');
  console.error('Fetch it from https://github.com/lemonhall/dsh-tts-reader (lib/edge-tts.js).');
  console.error('The vendored copy is already committed, so this only needs running');
  console.error('when updating to a newer upstream revision.');
  process.exit(2);
}

if (!existsSync(SRC)) {
  console.error('upstream source not found:', SRC);
  process.exit(2);
}

const body = readFileSync(SRC, 'utf8');
const sha = createHash('sha256').update(body).digest('hex');

const header = `/**
 * Edge TTS client — vendored.
 *
 * @license MIT
 * @source  https://github.com/lemonhall/dsh-tts-reader (lib/edge-tts.js)
 * @copyright Copyright (c) the dsh-tts-reader authors
 *
 * This file is copied from the upstream project above, which is MIT licensed,
 * so it may be redistributed provided the copyright notice and permission
 * notice are retained. The upstream MIT text is reproduced in
 * THIRD-PARTY-NOTICES.md at the repository root; read it before redistributing.
 *
 * Upstream content SHA-256 (of the body below this header):
 *   ${sha}
 *
 * Why Edge TTS lives on the host
 * ------------------------------
 * The Edge Read Aloud endpoint refuses the upgrade unless the request carries a
 * current browser \`User-Agent\`, and a browser cannot set that header on a
 * WebSocket. The synthesis therefore has to happen on the host, which can.
 *
 * Local changes in this repository: none. Only this header was added, so
 * \`npm\`-style diffing against upstream still works.
 */

`;

if (!body.startsWith('/**')) {
  console.error('unexpected upstream shape (does not start with a doc comment)');
  process.exit(2);
}

writeFileSync(DEST, header + body, 'utf8');
console.log('wrote lib/edge-tts.js');
console.log('  upstream bytes:', body.length);
console.log('  upstream sha256:', sha);
console.log('  with header   :', readFileSync(DEST).length);
