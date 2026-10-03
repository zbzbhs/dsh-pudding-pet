// Assert the Chromium contract test passed, from a dumped DOM.
//
// dev/test-contract.html has no exit code of its own -- it runs in a browser.
// It publishes its verdict in `document.title` as
//
//     <title>RESULT:{"pass":35,"fail":0}</title>
//
// so the only way to turn that into a CI failure is to read the dumped DOM back
// and check the number. `chrome-headless-shell --dump-dom` writes the whole
// document to stdout; this script reads that (from a file or stdin), finds the
// title, and exits non-zero unless `fail` is exactly 0.
//
// Usage
//   chrome-headless-shell --headless --dump-dom dev/test-contract.html \
//     | node tools/check-contract-result.mjs
//   node tools/check-contract-result.mjs contract-dom.html
//
// Exit codes
//   0  title found and fail === 0
//   1  title found with fail > 0, or title missing / unparsable
//   2  the input itself could not be read
import { readFile } from 'node:fs/promises';

/** Chrome escapes text nodes when serializing; undo the handful that can appear. */
function decodeEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#0*39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** Everything between the tags, with nested tags dropped. */
function textOf(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).trim();
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function readInput() {
  const path = process.argv[2];
  if (path && path !== '-') return await readFile(path, 'utf8');
  if (process.stdin.isTTY) {
    throw new Error('no input: pass a dumped-DOM file path, or pipe the DOM on stdin');
  }
  return await readStdin();
}

/** Pull `{pass, fail}` out of the title, or explain exactly why we could not. */
function parseResult(dom) {
  const titleMatch = dom.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch) {
    return { ok: false, why: 'no <title> element in the dumped DOM', title: null };
  }

  const title = textOf(titleMatch[1]);

  const resultMatch = title.match(/RESULT:\s*(\{[\s\S]*?\})/);
  if (!resultMatch) {
    return { ok: false, why: 'title does not contain "RESULT:{...}"', title };
  }

  let parsed;
  try {
    parsed = JSON.parse(resultMatch[1]);
  } catch (error) {
    // Fall back to a loose read so a stray quote in the JSON still yields numbers.
    const loose = resultMatch[1].match(/"pass"\s*:\s*(\d+)\s*,\s*"fail"\s*:\s*(\d+)/);
    if (!loose) {
      return {
        ok: false,
        why: 'RESULT payload is not valid JSON: ' + (error && error.message),
        title,
      };
    }
    parsed = { pass: Number(loose[1]), fail: Number(loose[2]) };
  }

  const pass = Number(parsed.pass);
  const fail = Number(parsed.fail);
  if (!Number.isFinite(pass) || !Number.isFinite(fail)) {
    return { ok: false, why: 'RESULT payload is missing numeric pass/fail', title };
  }

  return { ok: true, pass, fail, title };
}

/** The <pre id="out"> report lists every assertion; surface the FAIL lines. */
function failedAssertions(dom) {
  const preMatch = dom.match(/<pre[^>]*id=["']?out["']?[^>]*>([\s\S]*?)<\/pre>/i);
  if (!preMatch) return [];

  return decodeEntities(preMatch[1].replace(/<[^>]*>/g, ''))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^FAIL\b/.test(line));
}

async function main() {
  let dom;
  try {
    dom = await readInput();
  } catch (error) {
    console.error('cannot read the dumped DOM: ' + (error && error.message));
    process.exitCode = 2;
    return;
  }

  if (!dom.trim()) {
    console.error('the dumped DOM is empty -- the browser probably failed to start.');
    console.error('Check the Chromium step above; --dump-dom must print the document to stdout.');
    process.exitCode = 1;
    return;
  }

  const result = parseResult(dom);

  if (!result.ok) {
    console.error('FAIL: could not read the contract result from the DOM.');
    console.error('  reason: ' + result.why);
    if (result.title === null) {
      console.error('  no <title> found. First 400 chars of the DOM:');
      console.error('  ' + dom.slice(0, 400).replace(/\n/g, '\n  '));
    } else {
      console.error('  actual <title> content: ' + JSON.stringify(result.title));
      console.error('  expected something like: RESULT:{"pass":35,"fail":0}');
    }
    console.error('  A title still reading "running…" means the test never finished');
    console.error('  (raise --virtual-time-budget or check for a script error).');
    process.exitCode = 1;
    return;
  }

  if (result.fail === 0) {
    console.log('contract test passed: pass=' + result.pass + ' fail=0');
    return;
  }

  console.error('contract test FAILED: pass=' + result.pass + ' fail=' + result.fail);

  const failures = failedAssertions(dom);
  if (failures.length) {
    console.error('failed assertions:');
    for (const line of failures) console.error('  ' + line);
  } else {
    console.error('(the <pre id="out"> report did not list the failures)');
  }

  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exitCode = 1;
});
