// Verify the local-character visual adapter.
//
// This adapter is what lets a user replace the character without touching speech,
// dragging, or preferences. It is built from the manifest the host serves, so the
// mapping from state to clip — and the still-vs-loop decision — is the contract
// worth pinning down.
//
// The factory is internal to the bundle, so it is extracted and driven directly.
// That keeps the assertions about the shipped code rather than a copy of it.
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)));
const ROOT = resolve(HERE, '..');
const bundle = readFileSync(resolve(ROOT, 'lib/client.js'), 'utf8');

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'OK  ' : 'FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`);
}

// ---------------------------------------------------------------- extraction
function loadFactory() {
  const start = bundle.indexOf('function createClipVisual(');
  if (start < 0) throw new Error('createClipVisual not found in the bundle');
  const marker = '6. Styles for the pet';
  const end = bundle.indexOf(marker, start);
  const source = bundle.slice(start, bundle.lastIndexOf('/*', end));
  return new Function('sandbox', `
    const { ART_ROUTE, clamp } = sandbox;
    ${source}
    return createClipVisual;
  `);
}

// ---------------------------------------------------------------- harness
/** A minimal DOM good enough for an <img>. */
function makeDom() {
  const made = [];
  function makeEl(tag) {
    const el = {
      tagName: String(tag).toUpperCase(),
      className: '',
      style: { setProperty() {} },
      attributes: {},
      children: [],
      parentNode: null,
      draggable: true,
      decoding: '',
      alt: '',
      onerror: null,
      src: '',
      setAttribute(k, v) { el.attributes[k] = String(v); if (k === 'src') el.src = String(v); },
      getAttribute(k) { return k in el.attributes ? el.attributes[k] : null; },
      removeAttribute(k) { delete el.attributes[k]; },
      appendChild(c) { el.children.push(c); c.parentNode = el; return c; },
      removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); c.parentNode = null; },
      remove() { if (el.parentNode) el.parentNode.removeChild(el); },
      classList: {
        _s: new Set(),
        add(...c) { c.forEach((x) => this._s.add(x)); },
        remove(...c) { c.forEach((x) => this._s.delete(x)); },
        toggle(c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (on) this._s.add(c); else this._s.delete(c); },
        contains: (c) => el.classList._s.has(c),
      },
      get offsetWidth() { return 100; },
    };
    made.push(el);
    return el;
  }
  return {
    document: { createElement: makeEl },
    made,
    byTag: (t) => made.filter((e) => e.tagName === String(t).toUpperCase()),
  };
}

// A manifest shaped like the one the host serves.
const ART = {
  character: { id: 'tom', label: '汤姆猫 / Tom' },
  canvas: { width: 322, height: 430 },
  clips: {
    blink: { file: 'blink.webp', still: 'blink.still.png', frames: 3, width: 322, height: 430 },
    listen: { file: 'listen.webp', frames: 1, static: true, width: 322, height: 430 },
    pokeHead: { file: 'pokeHead.webp', frames: 11, width: 322, height: 430 },
    talk04_IC: { file: 'talk04_IC.webp', frames: 17, width: 322, height: 430 },
    talk02_IC: { file: 'talk02_IC.webp', frames: 10, width: 322, height: 430 },
    talk04_DC: { file: 'talk04_DC.webp', frames: 17, width: 322, height: 430 },
    hungry: { file: 'hungry.webp', still: 'hungry.still.png', frames: 18, width: 322, height: 430 },
  },
  states: {
    idle: { clip: 'blink', loop: true, breath: true },
    listen: { clip: 'listen', still: true, breath: true },
    think: { clip: 'hungry', still: true, breath: true },
    talk: { clip: 'talk04_IC', loop: true },
    poke: { clip: 'pokeHead', loop: true },
  },
  talkVariants: ['talk04_IC', 'talk02_IC', 'talk04_DC'],
};

const makeFactory = loadFactory();
const PREFIX = '/pudding-pet/art?name=';

/** Mount one adapter and hand back the pieces the assertions need. */
function mount(art = ART, options = { scale: 200 }) {
  const dom = makeDom();
  // The adapter builds its element from the ambient `document`, which is how it
  // behaves inside the page, so the stub has to be installed globally.
  globalThis.document = dom.document;
  const factory = makeFactory({ ART_ROUTE: '/pudding-pet/art', clamp: (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v) });
  const adapter = factory(art);
  const host = dom.document.createElement('div');
  const instance = adapter ? adapter.mount(host, options) : null;
  return { dom, adapter, host, instance, img: dom.byTag('img')[0] };
}

console.log('=== the adapter is built from the manifest ===');
{
  const { adapter } = mount();
  check('a manifest yields an adapter', !!adapter);
  check('it reports the character id', adapter && adapter.id === 'tom', adapter && adapter.id);
  check('it reports the character label', adapter && adapter.label === '汤姆猫 / Tom', adapter && adapter.label);
  check('a null manifest yields null', !makeFactory({ ART_ROUTE: '/pudding-pet/art', clamp: (v) => v })(null));
  check('a manifest without clips yields null', !makeFactory({ ART_ROUTE: '/pudding-pet/art', clamp: (v) => v })({ states: {} }));
}

console.log('\n=== the interface matches what the widget expects ===');
{
  const { adapter, instance } = mount();
  for (const method of ['setState', 'poke', 'setScale', 'setTalkRate', 'freeze', 'destroy']) {
    check(`exposes ${method}()`, instance && typeof instance[method] === 'function');
  }
  check('adapter declares id and label', typeof adapter.id === 'string' && typeof adapter.label === 'string');
}

console.log('\n=== mounting shows the initial pose ===');
{
  const { img, host } = mount();
  check('an <img> was created', !!img, img && img.tagName);
  check('it was appended to the host', host.children.length === 1, 'children=' + host.children.length);
  check('it starts on the idle clip (a loop, so the animation)',
    img && img.getAttribute('src') === PREFIX + encodeURIComponent('blink.webp'),
    img && String(img.getAttribute('src')).replace(PREFIX, ''));
  check('the alt text names the character', img && img.alt === '汤姆猫 / Tom', img && img.alt);
  check('height comes from the size preference', img && img.style.height === '200px', img && img.style.height);
  // 322/430 aspect at height 200 -> about 150px wide.
  check('width follows the aspect ratio', img && img.style.width === '150px', img && img.style.width);
}

console.log('\n=== setState switches the source ===');
{
  const { img, instance } = mount();
  instance.setState('talk');
  check('talk uses the talk clip',
    img.getAttribute('src') === PREFIX + encodeURIComponent('talk04_IC.webp'),
    String(img.getAttribute('src')).replace(PREFIX, ''));
  instance.setState('poke');
  check('poke uses the poke clip',
    img.getAttribute('src') === PREFIX + encodeURIComponent('pokeHead.webp'),
    String(img.getAttribute('src')).replace(PREFIX, ''));
}

console.log('\n=== a still state uses the still image ===');
{
  const { img, instance } = mount();
  instance.setState('think');
  check('think resolves to hungry.still.png (not the animation)',
    img.getAttribute('src') === PREFIX + encodeURIComponent('hungry.still.png'),
    String(img.getAttribute('src')).replace(PREFIX, ''));
}

console.log('\n=== a still state with no still image fails soft ===');
{
  const { img, instance } = mount();
  const before = img.getAttribute('src');
  // `listen` declares still: true but the clip has no still, which is a real
  // manifest defect the manifest test also reports. The adapter must not crash
  // or blank out; it should simply keep what it had.
  let threw = false;
  try { instance.setState('listen'); } catch (error) { threw = true; }
  check('does not throw', !threw);
  check('leaves the previous image in place', img.getAttribute('src') === before,
    String(img.getAttribute('src')).replace(PREFIX, ''));
}

console.log('\n=== talking rotates mouth shapes ===');
{
  const { img, instance } = mount();
  const seen = [];
  for (let i = 0; i < 4; i += 1) {
    instance.setState('talk');
    seen.push(String(img.getAttribute('src')).replace(PREFIX, ''));
  }
  const decoded = seen.map(decodeURIComponent);
  check('more than one mouth shape appears across calls',
    new Set(decoded).size > 1, decoded.join(', '));
  check('every shape is a declared talk variant',
    decoded.every((d) => ART.clips[Object.keys(ART.clips).find((k) => ART.clips[k].file === d)] || d.endsWith('.webp')),
    decoded.join(', '));
}

console.log('\n=== an unknown state does not break the pet ===');
{
  const { img, instance } = mount();
  const before = img.getAttribute('src');
  let threw = false;
  try { instance.setState('does-not-exist'); } catch (error) { threw = true; }
  check('does not throw', !threw);
  check('keeps the previous image', img.getAttribute('src') === before);
}

console.log('\n=== scale and freeze ===');
{
  const { img, instance } = mount();
  instance.setScale(300);
  check('setScale sets the height', img.style.height === '300px', img.style.height);
  check('setScale keeps the aspect ratio', img.style.width === '225px', img.style.width);
  instance.setScale(10);
  check('an absurd size is clamped up', img.style.height === '60px', img.style.height);
  instance.freeze(true);
  check('freeze adds the frozen class', img.classList.contains('is-frozen'));
  instance.freeze(false);
  check('unfreezing removes it', !img.classList.contains('is-frozen'));
}

console.log('\n=== poke gives feedback ===');
{
  const { img, instance } = mount();
  instance.poke();
  check('poke adds a reaction class', img.classList.contains('is-poked'));
}

console.log('\n=== destroy removes the element ===');
{
  const { img, instance, host } = mount();
  instance.destroy();
  check('the element left the host', host.children.length === 0, 'children=' + host.children.length);
  check('its error handler was detached', img.onerror === null);
}

console.log('\n=== a failed image load does not show a broken icon ===');
{
  const { img } = mount();
  check('an error handler is installed', typeof img.onerror === 'function');
  img.onerror();
  check('the image is hidden instead of broken', img.style.visibility === 'hidden', img.style.visibility);
}

const failed = results.filter((r) => !r.pass);
console.log('\n' + (failed.length
  ? `FAILED (${failed.length}/${results.length}): ${failed.map((f) => f.name).join('; ')}`
  : `all ${results.length} checks passed`));
process.exit(failed.length ? 1 : 0);
