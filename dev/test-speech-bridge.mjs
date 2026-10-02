// Regression test for the "pet renders but never speaks" bug.
//
// The bug: `assistant/message.data.stream` is an ARRAY of compact
// AssistantStreamRecord entries, but the bridge read it as a `{text}` object.
// All three fallbacks missed, so the text was always empty and the bridge
// returned silently — no speech, no error.
//
// This test drives the real bundle with payloads shaped exactly like DSH's
// documented types, so it fails if the extraction regresses.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)));
const ROOT = resolve(HERE, '..');
const bundle = readFileSync(resolve(ROOT, 'lib/client.js'), 'utf8');

// ---------------------------------------------------------------- harness
function boot({ sessionsReadyAtMount = true } = {}) {
  const spoken = [];
  const events = [];
  const subs = new Set();
  const catalogSubs = new Set();
  let captured = null;
  let sessionsProvided = sessionsReadyAtMount;

  const eventSource = {
    getSnapshot: () => ({ entries: events.slice(), revision: events.length, hasMore: false }),
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
  };
  const sessions = {
    list: {
      getSnapshot: () => ({ byId: { 'sess-1': { id: 'sess-1', retainedBy: { mainView: 1 } } }, current: 'sess-1' }),
      subscribe: (fn) => { catalogSubs.add(fn); return () => catalogSubs.delete(fn); },
    },
    retain: () => ({
      ready: Promise.resolve(),
      binding: { session: { eventSource } },
      release: () => {},
    }),
  };
  const slots = {
    inject: (key, cb) => cb(),
    register: (options, component) => {
      if (options.name === 'shell.overlay') captured = { options, component };
      return () => {};
    },
  };
  const locale = { getSnapshot: () => ({ active: 'zh' }), subscribe: () => () => {} };

  const effects = [];
  const ctx = {
    get: (name) => {
      if (name === 'sessions') return sessionsProvided ? sessions : undefined;
      if (name === 'slots') return slots;
      if (name === 'locale') return locale;
      return undefined;
    },
    effect: (fn) => { effects.push(fn); return fn; },
  };
  ctx.slots = slots;
  ctx.locale = locale;

  const refs = [];
  const effs = [];
  const React = {
    createElement: (t, p) => (typeof t === 'function' ? t(p || {}) : {}),
    useRef: (i) => { const r = { current: i }; refs.push(r); return r; },
    useEffect: (f) => effs.push(f),
  };

  // A DOM stub that is rich enough for the artwork controller to mount.
  function makeEl(tag = 'div') {
    const el = {
      tagName: tag,
      style: {},
      dataset: {},
      className: '',
      textContent: '',
      innerHTML: '',
      hidden: false,
      children: [],
      classList: {
        _set: new Set(),
        add(...c) { c.forEach((x) => this._set.add(x)); },
        remove(...c) { c.forEach((x) => this._set.delete(x)); },
        contains: (c) => el.classList._set.has(c),
      },
      setAttribute() {}, getAttribute: () => null, removeAttribute() {},
      addEventListener() {}, removeEventListener() {},
      appendChild(child) { el.children.push(child); return child; },
      removeChild() {}, remove() {}, insertBefore() {},
      querySelector: () => null,
      querySelectorAll: () => [],
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, x: 0, y: 0 }),
      contains: () => false,
      closest: () => null,
      focus() {}, blur() {}, click() {},
      setPointerCapture() {}, releasePointerCapture() {},
      ownerDocument: null,
    };
    return el;
  }

  const documentStub = {
    createElement: (tag) => makeEl(tag),
    createElementNS: (ns, tag) => makeEl(tag),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    head: makeEl('head'),
    documentElement: makeEl('html'),
    body: makeEl('body'),
    addEventListener() {}, removeEventListener() {},
    hidden: false,
    readyState: 'complete',
  };
  documentStub.head.ownerDocument = documentStub;
  documentStub.body.ownerDocument = documentStub;

  const localStorageStub = { getItem: () => null, setItem() {}, removeItem() {} };

  let registered = null;
  globalThis.window = {
    __ModuleLoader__: { load: (d) => { registered = d; } },
    // Stub the artwork controller. This test targets the speech bridge, and
    // `ensureArtwork()` skips evaluating the real controller when
    // `window.PuddingCat` already exists — so the bridge is exercised without
    // needing a full DOM renderer.
    PuddingCat: {
      create: () => ({
        setState() {}, poke() {}, setScale() {}, setTalkRate() {},
        freeze() {}, destroy() {},
      }),
    },
    speechSynthesis: {
      getVoices: () => [{ name: 'Huihui', lang: 'zh-CN', localService: true, voiceURI: 'Huihui' }],
      speak: (u) => { spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 0); },
      cancel() {}, addEventListener() {}, removeEventListener() {},
    },
    SpeechSynthesisUtterance: function (text) { this.text = text; },
    localStorage: localStorageStub,
    addEventListener() {}, removeEventListener() {},
    innerWidth: 1280, innerHeight: 800,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: () => {},
    getComputedStyle: () => ({ pointerEvents: 'auto', position: 'fixed' }),
    setTimeout, clearTimeout,
  };
  globalThis.document = documentStub;
  globalThis.localStorage = localStorageStub;
  globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
  globalThis.SpeechSynthesisUtterance = globalThis.window.SpeechSynthesisUtterance;
  globalThis.getComputedStyle = globalThis.window.getComputedStyle;

  new Function(bundle)();
  const mod = registered.factory((n) => {
    if (n === 'react') return React;
    throw new Error('unexpected require: ' + n);
  });
  mod.apply(ctx);

  // Commit the overlay component the way React would.
  if (captured) {
    refs.length = 0; effs.length = 0;
    captured.component({});
    const host = makeEl('div');
    host.ownerDocument = documentStub;
    if (refs[0]) refs[0].current = host;
    effs.forEach((fn) => fn());
  }

  return {
    spoken,
    effects,
    provideSessions: () => { sessionsProvided = true; },
    /** Push an event and notify subscribers, like the real event window does. */
    push(type, data) {
      events.push({ type: 'event', event: { seq: events.length, type, data } });
      subs.forEach((fn) => { try { fn(); } catch (e) { console.error('subscriber threw:', e.message); } });
    },
    subscriberCount: () => subs.size,
  };
}

// --------------------------------------------------------------- fixtures
// Shaped exactly like DSH's AssistantStreamRecord / AssistantMessage.
const TEXT_CHUNKS_EVENT = {
  turn: 1, step: 1,
  stream: [
    { type: 'reasoning-chunks', time0: 0, index: 0, dt: [10], texts: ['这是推理，不该被念出来。'] },
    { type: 'text-chunks', time0: 0, index: 1, dt: [10, 20], texts: ['你好，这是第一句。', '这是第二句！'] },
    { type: 'tool-call-chunks', time0: 0, index: 2, id: 'call-1', name: 'search', args: ['{}'] },
  ],
  message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: '你好，这是第一句。这是第二句！' }] },
};

const CONTENT_ONLY_EVENT = {
  turn: 1, step: 2,
  stream: [],
  message: { id: 'm2', role: 'assistant', content: [{ type: 'text', text: '只走 message.content 的回退路径。' }] },
};

// ---------------------------------------------------------------- checks
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'OK  ' : 'FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`);
};

console.log('=== case 1: compact text-chunks stream (the shape that used to fail) ===');
{
  const h = boot();
  // `retain(...).ready` is a promise, so the subscription is established on a
  // microtask; give it a tick before asserting.
  await new Promise((r) => setTimeout(r, 50));
  check('bridge subscribed to the event window', h.subscriberCount() === 1, 'subs=' + h.subscriberCount());
  h.push('assistant/message', TEXT_CHUNKS_EVENT);
  await new Promise((r) => setTimeout(r, 120));
  const joined = h.spoken.join(' ');
  check('speech produced', h.spoken.length > 0, 'count=' + h.spoken.length);
  check('visible text extracted', joined.includes('你好，这是第一句'), joined.slice(0, 60));
  check('reasoning NOT spoken', !joined.includes('推理'), joined.slice(0, 60));
  check('tool call NOT spoken', !joined.includes('search') && !joined.includes('call-1'));
}

console.log('\n=== case 2: message.content fallback (empty stream) ===');
{
  const h = boot();
  h.push('assistant/message', CONTENT_ONLY_EVENT);
  await new Promise((r) => setTimeout(r, 120));
  const joined = h.spoken.join(' ');
  check('fallback text spoken', joined.includes('只走 message.content'), joined.slice(0, 60));
}

console.log('\n=== case 3: sessions service not ready at mount (retry path) ===');
{
  const h = boot({ sessionsReadyAtMount: false });
  check('no subscriber yet', h.subscriberCount() === 0, 'subs=' + h.subscriberCount());
  h.provideSessions();
  // The retry is on a 1200ms timer; wait for it.
  await new Promise((r) => setTimeout(r, 1600));
  check('retried and subscribed after the service appeared', h.subscriberCount() === 1, 'subs=' + h.subscriberCount());
  h.push('assistant/message', TEXT_CHUNKS_EVENT);
  await new Promise((r) => setTimeout(r, 120));
  check('speaks after a late service mount', h.spoken.length > 0, 'count=' + h.spoken.length);
}

console.log('\n=== case 4: user text stays silent by default ===');
{
  const h = boot();
  const before = h.spoken.length;
  h.push('user/message', { message: { id: 'u1', role: 'user', content: [{ type: 'text', text: '这是我说的话。' }] } });
  await new Promise((r) => setTimeout(r, 120));
  check('user text not spoken (readInput=false)', h.spoken.length === before,
    'before=' + before + ' after=' + h.spoken.length);
}

const failed = results.filter((r) => !r.pass);
console.log('\n' + (failed.length
  ? `FAILED (${failed.length}/${results.length}): ${failed.map((f) => f.name).join('; ')}`
  : `all ${results.length} checks passed`));
process.exitCode = failed.length ? 1 : 0;
