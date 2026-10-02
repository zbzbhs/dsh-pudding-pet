// Vendor the known-working Edge TTS client, with provenance.
//
// The upstream file is MIT-licensed, so it can be redistributed with
// attribution. A header is prepended and the original body is copied byte for
// byte, so a future diff against upstream stays meaningful.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)));
const ROOT = resolve(HERE, '..');
const SRC = 'D:\\Deepseek Harness file\\_research\\_raw\\tts\\lib\\edge-tts.js';
const DEST = resolve(ROOT, 'lib/edge-tts.js');

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
