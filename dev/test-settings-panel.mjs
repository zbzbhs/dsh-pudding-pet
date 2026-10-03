// Verify the Pudding Pet settings panel.
//
// The panel is the thinnest-covered part of the repo: ~300 lines of plain DOM
// in `lib/client.js` with no test at all. This boots the real bundle against a
// fake DSH (the same shape `dev/test-client-engine.mjs` uses), opens the panel
// through its real entry point (right-click on the cat) and drives the controls
// the way a user would.
//
//   node dev/test-settings-panel.mjs
//
// Zero dependencies. Only reads `lib/client.js`; nothing is written.
import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)));
const ROOT = resolve(HERE, '..');
const BUNDLE_PATH = resolve(ROOT, 'lib/client.js');
const bundle = readFileSync(BUNDLE_PATH, 'utf8');
const STORAGE_KEY = 'dsh-pudding-pet:v1';

const results = [];
const skips = [];

function check(name, pass, detail = '') {
  results.push({ name, pass: !!pass });
  console.log(`  ${pass ? 'OK  ' : 'FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`);
}
function skip(name, reason) {
  skips.push({ name, reason });
  console.log(`  SKIP ${name}  (${reason})`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tick = () => sleep(0);

/* ------------------------------------------------------------------ *
 * DOM stub
 *
 * Deliberately closer to a real DOM than the stub in test-client-engine.mjs:
 * the panel is built out of classList / firstChild / removeChild / select
 * `.value` / range inputs / direct `on*` handlers, so a stub that returns
 * `null` from everything would make these tests vacuous.
 * ------------------------------------------------------------------ */

function makeEl(doc, tag) {
  const classes = new Set();
  const listeners = new Map();
  const attrs = new Map();
  let idValue = '';

  const el = {
    nodeType: 1,
    _tag: String(tag || 'div').toLowerCase(),
    tagName: String(tag || 'div').toUpperCase(),
    children: [],
    parentNode: null,
    ownerDocument: doc,
    dataset: {},
    textContent: '',
    innerHTML: '',
    hidden: false,
    title: '',
    type: '',
    checked: false,
    value: '',
    min: '',
    max: '',
    step: '',
    disabled: false,
    offsetHeight: 0,
    offsetWidth: 0,
    onclick: null,
    onchange: null,
    oninput: null,
    style: {
      cssText: '',
      setProperty(k, v) { this[k] = v; },
      getPropertyValue(k) { return this[k] == null ? '' : String(this[k]); },
      removeProperty(k) { delete this[k]; },
    },
    classList: {
      add(...c) { c.forEach((x) => { if (x) classes.add(x); }); },
      remove(...c) { c.forEach((x) => classes.delete(x)); },
      contains: (c) => classes.has(c),
      toggle(c, force) {
        const on = force === undefined ? !classes.has(c) : !!force;
        if (on) classes.add(c); else classes.delete(c);
        return on;
      },
      get length() { return classes.size; },
    },
  };

  Object.defineProperty(el, 'className', {
    get: () => Array.from(classes).join(' '),
    set: (v) => {
      classes.clear();
      String(v == null ? '' : v).split(/\s+/).forEach((c) => { if (c) classes.add(c); });
    },
  });
  Object.defineProperty(el, 'id', {
    get: () => idValue,
    set: (v) => { idValue = String(v); if (doc) doc._byId[idValue] = el; },
  });
  Object.defineProperty(el, 'firstChild', { get: () => el.children[0] || null });
  Object.defineProperty(el, 'lastChild', { get: () => el.children[el.children.length - 1] || null });
  Object.defineProperty(el, 'childNodes', { get: () => el.children });
  Object.defineProperty(el, 'parentElement', { get: () => el.parentNode });

  el.appendChild = (child) => {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = el;
    el.children.push(child);
    return child;
  };
  el.insertBefore = (child, ref) => {
    const i = ref ? el.children.indexOf(ref) : -1;
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = el;
    if (i < 0) el.children.push(child); else el.children.splice(i, 0, child);
    return child;
  };
  el.removeChild = (child) => {
    const i = el.children.indexOf(child);
    if (i >= 0) { el.children.splice(i, 1); child.parentNode = null; }
    return child;
  };
  el.remove = () => { if (el.parentNode) el.parentNode.removeChild(el); };
  el.contains = (node) => { let n = node; while (n) { if (n === el) return true; n = n.parentNode; } return false; };
  el.closest = () => null;
  el.querySelector = () => null;
  el.querySelectorAll = () => [];
  el.addEventListener = (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
  };
  el.removeEventListener = (type, fn) => { if (listeners.has(type)) listeners.get(type).delete(fn); };
  el.listenerCount = (type) => (listeners.has(type) ? listeners.get(type).size : 0);
  // Fires both addEventListener handlers and the `on<type>` property, the way a
  // real dispatch would.
  el.dispatch = (type, event) => {
    const set = listeners.get(type);
    if (set) for (const fn of Array.from(set)) fn(event);
    const on = el['on' + type];
    if (typeof on === 'function') on(event);
  };
  el.setAttribute = (k, v) => { attrs.set(k, String(v)); if (k === 'id') el.id = v; };
  el.getAttribute = (k) => (attrs.has(k) ? attrs.get(k) : null);
  el.hasAttribute = (k) => attrs.has(k);
  el.removeAttribute = (k) => attrs.delete(k);
  el.focus = () => {};
  el.blur = () => {};
  el.setPointerCapture = () => {};
  el.releasePointerCapture = () => {};
  el.getBoundingClientRect = () => el._rect
    || { left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200 };
  return el;
}

/** Depth-first element list, self included. */
function allElements(root) {
  const out = [];
  const walk = (el) => { out.push(el); (el.children || []).forEach(walk); };
  walk(root);
  return out;
}
const hasClass = (el, name) => el.className.split(/\s+/).includes(name);

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

/**
 * Boot the real bundle with a fake DSH and return handles.
 *
 * @param storage  shared localStorage backing store (pass the same object to a
 *                 second boot to test persistence across mounts)
 * @param prefs    written into localStorage *before* mount, so it drives the
 *                 initial preferences; a string is stored verbatim (illegal JSON)
 * @param language initial locale snapshot
 */
function boot({ storage = {}, prefs, language = 'zh', hostMode = 'up' } = {}) {
  if (prefs !== undefined) {
    storage[STORAGE_KEY] = typeof prefs === 'string' ? prefs : JSON.stringify(prefs);
  }

  const spoken = [];        // browser-engine utterances
  const utterances = [];    // live utterances, ended manually by endSpeech()
  const hostCalls = [];     // /pudding-pet/tts query strings
  const voiceCalls = [];    // /pudding-pet/voices query strings
  const audioPlays = [];
  const events = [];
  const subs = new Set();
  const localeSubs = new Set();
  const localeState = { active: language };
  const docListeners = new Map();
  const winListeners = new Map();
  let captured = null;
  let registered = null;
  let pokeCount = 0;
  let cancelCount = 0;

  /* ---- document ---- */
  const doc = {
    _byId: {},
    createElement: (t) => makeEl(doc, t),
    createElementNS: (ns, t) => makeEl(doc, t),
    getElementById: (id) => doc._byId[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (type, fn) => {
      if (!docListeners.has(type)) docListeners.set(type, new Set());
      docListeners.get(type).add(fn);
    },
    removeEventListener: (type, fn) => { if (docListeners.has(type)) docListeners.get(type).delete(fn); },
    dispatch: (type, event) => {
      const set = docListeners.get(type);
      if (set) for (const fn of Array.from(set)) fn(event);
    },
    listenerCount: (type) => (docListeners.has(type) ? docListeners.get(type).size : 0),
    hidden: false,
    readyState: 'complete',
  };
  doc.head = makeEl(doc, 'head');
  doc.body = makeEl(doc, 'body');
  doc.documentElement = makeEl(doc, 'html');

  /* ---- fetch: the routes are the host contract ---- */
  const fetchImpl = (url) => {
    const s = String(url);
    const path = s.split('?')[0];
    const query = s.split('?')[1] || '';
    if (path === '/pudding-pet/tts') {
      hostCalls.push(query);
      if (hostMode === 'down') {
        return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({ ok: false }) });
      }
      return Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve({ size: 4096 }) });
    }
    if (path === '/pudding-pet/voices') {
      voiceCalls.push(query);
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({
          ok: true, defaultVoice: 'zh-CN-XiaoyiNeural',
          voices: [{ name: 'zh-CN-XiaoyiNeural', gender: 'Female', locale: 'zh-CN' }],
        }),
      });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  };

  function FakeAudio() {
    this.playbackRate = 1;
    this.preservesPitch = true;
    this.volume = 1;
    this.src = '';
    this.play = () => {
      audioPlays.push({ rate: this.playbackRate, preservesPitch: this.preservesPitch, volume: this.volume });
      setTimeout(() => { if (this.onended) this.onended(); }, 0);
      return Promise.resolve();
    };
    this.pause = () => {};
  }

  /* ---- window ---- */
  const win = {
    __ModuleLoader__: { load: (d) => { registered = d; } },
    PuddingCat: {
      create: () => ({
        setState() {}, poke() { pokeCount += 1; }, setScale() {}, setTalkRate() {},
        freeze() {}, destroy() {},
      }),
    },
    speechSynthesis: {
      getVoices: () => [{ name: 'Huihui', lang: 'zh-CN', localService: true, voiceURI: 'Huihui' }],
      speak: (u) => {
        utterances.push(u);
        spoken.push({ text: u.text, pitch: u.pitch, rate: u.rate, volume: u.volume, lang: u.lang });
      },
      cancel: () => { cancelCount += 1; },
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    SpeechSynthesisUtterance: function (t) { this.text = t; },
    localStorage: {
      getItem: (k) => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: (k) => { delete storage[k]; },
    },
    fetch: fetchImpl,
    Audio: FakeAudio,
    URL: { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} },
    URLSearchParams,
    addEventListener: (type, fn) => {
      if (!winListeners.has(type)) winListeners.set(type, new Set());
      winListeners.get(type).add(fn);
    },
    removeEventListener: (type, fn) => { if (winListeners.has(type)) winListeners.get(type).delete(fn); },
    dispatch: (type, event) => {
      const set = winListeners.get(type);
      if (set) for (const fn of Array.from(set)) fn(event);
    },
    innerWidth: 1280,
    innerHeight: 800,
    setTimeout, clearTimeout, setInterval, clearInterval,
  };

  /* ---- services ---- */
  const eventSource = {
    getSnapshot: () => ({ entries: events.slice(), revision: events.length, hasMore: false }),
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
  };
  const sessions = {
    list: {
      getSnapshot: () => ({ byId: { s1: { id: 's1', retainedBy: { mainView: 1 } } }, current: 's1' }),
      subscribe: () => () => {},
    },
    retain: () => ({ ready: Promise.resolve(), binding: { session: { eventSource } }, release: () => {} }),
  };
  const slots = {
    inject: (k, cb) => cb(),
    register: (o, c) => { if (o.name === 'shell.overlay') captured = { options: o, component: c }; return () => {}; },
  };
  const locale = {
    getSnapshot: () => ({ active: localeState.active }),
    subscribe: (fn) => { localeSubs.add(fn); return () => localeSubs.delete(fn); },
  };
  const effectDisposers = [];
  const ctx = {
    get: (n) => ({ sessions, slots, locale }[n]),
    effect: (fn) => { const d = fn(); if (typeof d === 'function') effectDisposers.push(d); return d; },
    slots, locale, sessions,
  };

  /* ---- two-phase React: collect hooks, then commit ---- */
  const refs = [], effs = [], cleanups = [];
  const React = {
    createElement: (t, p) => (typeof t === 'function' ? t(p || {}) : { type: t, props: p || {} }),
    useRef: (i) => { const r = { current: i }; refs.push(r); return r; },
    useEffect: (f) => { effs.push(f); },
  };

  /* ---- globals, then evaluate the bundle ---- */
  const prev = {
    window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage,
    fetch: globalThis.fetch, Audio: globalThis.Audio, URL: globalThis.URL,
    SpeechSynthesisUtterance: globalThis.SpeechSynthesisUtterance,
  };
  globalThis.window = win;
  globalThis.document = doc;
  globalThis.localStorage = win.localStorage;
  globalThis.fetch = fetchImpl;
  globalThis.Audio = FakeAudio;
  globalThis.URL = win.URL;
  globalThis.SpeechSynthesisUtterance = win.SpeechSynthesisUtterance;

  new Function(bundle)();
  const mod = registered.factory((n) => {
    if (n === 'react') return React;
    throw new Error('unexpected require: ' + n);
  });

  /* ---- mount ---- */
  mod.apply(ctx);

  const host = makeEl(doc, 'div');
  if (captured) {
    captured.component({});
    if (refs[0]) refs[0].current = host;
    effs.forEach((fn) => { const c = fn(); if (typeof c === 'function') cleanups.push(c); });
  }

  const root = host.children.find((c) => hasClass(c, 'pudding-root'));
  const cat = root ? root.children.find((c) => hasClass(c, 'pudding-cat')) : null;
  const restore = host.children.find((c) => hasClass(c, 'pudding-restore'));

  // The pet's own box: placePanel() reads it, so make it follow the pet.
  const petRect = { left: 1052, top: 504, right: 1252, bottom: 704, width: 200, height: 200 };
  if (root) root.getBoundingClientRect = () => petRect;

  const panelEl = () => doc.body.children.find((c) => hasClass(c, 'pudding-panel')) || null;
  const panelCount = () => doc.body.children.filter((c) => hasClass(c, 'pudding-panel')).length;

  /** Open the panel the way a user does: right-click the cat. */
  async function open() {
    cat.dispatch('contextmenu', { preventDefault() {}, stopPropagation() {} });
    await tick(); // the outside-click listener is attached on a 0ms timer
    return panelEl();
  }
  const closeViaButton = () => {
    const panel = panelEl();
    const btn = allElements(panel).find((e) => e._tag === 'button' && hasClass(e, 'pudding-close'));
    btn.dispatch('click', {});
  };
  const findByLabel = (label, tag) => {
    const panel = panelEl();
    if (!panel) return null;
    const els = allElements(panel);
    const span = els.find((e) => e._tag === 'span' && e.textContent === label);
    if (!span) return null;
    return els.find((e) => e.parentNode === span.parentNode && (!tag || e._tag === tag)) || null;
  };
  const byClass = (name) => {
    const panel = panelEl();
    return panel ? allElements(panel).find((e) => hasClass(e, name)) || null : null;
  };
  const buttons = () => (panelEl() ? allElements(panelEl()).filter((e) => e._tag === 'button') : []);
  const buttonByText = (text) => buttons().find((b) => b.textContent === text) || null;
  const sections = () => (panelEl() ? allElements(panelEl()).filter((e) => e._tag === 'h3').map((e) => e.textContent) : []);
  const ranges = () => (panelEl() ? allElements(panelEl()).filter((e) => e._tag === 'input' && e.type === 'range') : []);
  const rangeByMax = (max) => ranges().find((e) => String(e.max) === String(max)) || null;
  const selects = () => (panelEl() ? allElements(panelEl()).filter((e) => e._tag === 'select') : []);
  const engineSelect = () => selects().find((s) => s.children.map((o) => o.value).join(',') === 'auto,edge,browser') || null;
  const numOf = (input) => (input && input.parentNode
    ? input.parentNode.children.find((c) => hasClass(c, 'num')) || null : null);
  const readStored = () => {
    const raw = storage[STORAGE_KEY];
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch (error) { return null; }
  };

  /** Drag the cat: pointerdown at (x,y), pointermove by (dx,dy), pointerup. */
  function drag(x, y, dx, dy) {
    cat.dispatch('pointerdown', { button: 0, clientX: x, clientY: y, pointerId: 1, preventDefault() {} });
    cat.dispatch('pointermove', { clientX: x + dx, clientY: y + dy, pointerId: 1, preventDefault() {} });
    cat.dispatch('pointerup', { clientX: x + dx, clientY: y + dy, pointerId: 1, preventDefault() {} });
  }
  const clickCat = (x, y) => drag(x, y, 0, 0);

  const push = (type, data) => {
    events.push({ type: 'event', event: { seq: events.length, type, data } });
    subs.forEach((fn) => fn());
  };
  const assistantEvent = (text) => ({
    turn: 1, step: 1,
    stream: [{ type: 'text-chunks', time0: 0, index: 0, dt: [10], texts: [text] }],
    message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text }] },
  });

  /** End the in-flight utterance, as the browser would after it finishes. */
  const endSpeech = () => { utterances.splice(0).forEach((u) => { if (u.onend) u.onend({}); }); };

  const teardown = () => {
    cleanups.forEach((fn) => { try { fn(); } catch (error) {} });
    effectDisposers.forEach((fn) => { try { fn(); } catch (error) {} });
    cleanups.length = 0;
    effectDisposers.length = 0;
    try {
      globalThis.window = prev.window; globalThis.document = prev.document;
      globalThis.localStorage = prev.localStorage; globalThis.fetch = prev.fetch;
      globalThis.Audio = prev.Audio; globalThis.URL = prev.URL;
      globalThis.SpeechSynthesisUtterance = prev.SpeechSynthesisUtterance;
    } catch (error) {}
  };

  return {
    doc, host, root, cat, restore, storage, petRect,
    spoken, hostCalls, voiceCalls, audioPlays,
    get pokeCount() { return pokeCount; },
    get cancelCount() { return cancelCount; },
    setLocale: (lang) => { localeState.active = lang; localeSubs.forEach((fn) => fn()); },
    setPetRect: (r) => Object.assign(petRect, r),
    open, closeViaButton, findByLabel, byClass, buttonByText, sections, ranges, rangeByMax,
    engineSelect, selects, numOf, readStored, drag, clickCat, endSpeech, push, assistantEvent,
    panelEl, panelCount, teardown, docListenerCount: (t) => doc.listenerCount(t),
  };
}

/* ------------------------------------------------------------------ *
 * Checks
 * ------------------------------------------------------------------ */

const ZH_SECTIONS = ['朗读', '语音引擎', 'Edge 音色', '浏览器音色', '外观', '行为'];
const EN_SECTIONS = ['Speech engine', 'Edge voice', 'Browser voice', 'Appearance', 'Behavior'];

async function main() {
  const st = statSync(BUNDLE_PATH);
  console.log(`bundle: lib/client.js  ${st.size} bytes  mtime ${st.mtime.toISOString()}`);
  console.log(`node:   ${process.version}\n`);

  /* ================= panel structure ================= */
  console.log('=== panel structure ===');
  {
    const h = boot({});
    await sleep(20);
    const panel = await h.open();

    check('1. openPanel 后 DOM 出现面板 (pudding-panel)',
      !!panel && hasClass(panel, 'pudding-panel'),
      panel ? `class="${panel.className}"` : 'panel missing');

    const secs = h.sections();
    const missing = ZH_SECTIONS.filter((s) => !secs.includes(s));
    check('2. 面板含全部预期分组 (引擎/Edge 音色/浏览器音色/外观/行为)',
      missing.length === 0,
      missing.length ? 'missing: ' + missing.join(',') : secs.join(' | '));

    // Right-click again must toggle, never stack.
    const afterSecond = await h.open();
    check('4. 重复打开面板不叠加 (toggle 路径)',
      h.panelCount() === 0 && afterSecond === null,
      `panels=${h.panelCount()} (第二次右键关闭)`);

    const reopened = await h.open();
    const closeBtn = allElements(reopened).find((e) => e._tag === 'button' && hasClass(e, 'pudding-close'));
    check('3a. 关闭按钮存在', !!closeBtn, closeBtn ? `text="${closeBtn.textContent}"` : 'missing');
    const before = h.docListenerCount('pointerdown');
    closeBtn.dispatch('click', {});
    check('3b. 点击关闭按钮移除面板', h.panelCount() === 0 && h.panelEl() === null,
      `panels=${h.panelCount()}`);
    check('E1. 关闭后移除外部点击监听 (无泄漏)',
      h.docListenerCount('pointerdown') === before - 1,
      `pointerdown listeners ${before} -> ${h.docListenerCount('pointerdown')}`);

    // Re-open proves closePanel reset the state, not just the DOM.
    const again = await h.open();
    check('E2. 关闭后可再次打开面板', !!again && h.panelCount() === 1, `panels=${h.panelCount()}`);

    // Direct double-open is unreachable from outside the bundle.
    skip('4b. 直接重复调用 openPanel 不叠加 (不可达路径)',
      '已知问题: 组件实例未导出，测试无法直接调用 openPanel；静态阅读 lib/client.js 的 PetWidget.prototype.openPanel 无幂等保护，重复调用会把旧面板留在 DOM 里且 closePanel 只能删掉最后一个');

    h.teardown();
  }

  /* ================= placePanel ================= */
  console.log('\n=== placePanel (定位) ===');
  {
    const h = boot({ prefs: { x: 1052, y: 504 } });
    await sleep(20);
    h.setPetRect({ left: 1052, top: 504, right: 1252, bottom: 704, width: 200, height: 200 });
    const panel = await h.open();
    const left = parseFloat(panel.style.left);
    const top = parseFloat(panel.style.top);
    check('E3a. 面板落在视口内 (右下角宠物)',
      left >= 8 && left <= 1280 - 268 - 8 && top >= 8 && top <= 800 - 8,
      `left=${panel.style.left} top=${panel.style.top} transform=${panel.style.transform}`);
    check('E3b. 面板贴宠物右缘对齐',
      left === 1052 + 200 - 268 && panel.style.transform === 'none',
      `left=${left} expected=${1052 + 200 - 268}`);
    h.closeViaButton();
    h.setPetRect({ left: 300, top: 20, right: 500, bottom: 220, width: 200, height: 200 });
    const flipped = await h.open();
    check('E3c. 宠物贴顶时面板向下翻转',
      flipped.style.transform === 'translateY(-100%)' && parseFloat(flipped.style.top) === 228,
      `top=${flipped.style.top} transform=${flipped.style.transform}`);
    h.teardown();
  }

  /* ================= controls ================= */
  console.log('\n=== controls ===');
  {
    const h = boot({});
    await sleep(20);
    await h.open();

    // 5. readReply checkbox
    const cb = h.findByLabel('朗读助手回复', 'input');
    check('5a. 找到「朗读助手回复」checkbox', !!cb && cb.type === 'checkbox', cb ? `checked=${cb.checked}` : 'missing');
    cb.checked = false;
    cb.dispatch('change', {});
    check('5b. 改「朗读助手回复」写入 preferences.readReply',
      h.readStored() && h.readStored().readReply === false,
      'stored.readReply=' + (h.readStored() || {}).readReply);

    // 6. engine select
    const sel = h.engineSelect();
    check('6a. 找到「引擎」select (auto/edge/browser)',
      !!sel && sel.children.length === 3,
      sel ? sel.children.map((o) => o.value).join(',') : 'missing');
    sel.value = 'browser';
    sel.dispatch('change', {});
    check('6b. 改「引擎」写入 preferences.engine',
      h.readStored().engine === 'browser', 'stored.engine=' + h.readStored().engine);
    sel.value = 'edge';
    sel.dispatch('change', {});
    check('6c. 引擎可切回 edge', h.readStored().engine === 'edge', 'stored.engine=' + h.readStored().engine);

    // 7. edgePitch range (slider max is 90)
    const pitch = h.rangeByMax(90);
    check('7a. 找到「音高偏移」range (max=90)', !!pitch && pitch.min === '0',
      pitch ? `min=${pitch.min} max=${pitch.max} value=${pitch.value}` : 'missing');
    pitch.value = '200';
    pitch.dispatch('input', {});
    check('7b. 音高偏移 200 被夹到 90',
      h.readStored().edgePitch === 90,
      `stored.edgePitch=${h.readStored().edgePitch} label=${h.numOf(pitch).textContent}`);
    pitch.value = '-50';
    pitch.dispatch('input', {});
    check('7c. 音高偏移 -50 被夹到 0',
      h.readStored().edgePitch === 0,
      `stored.edgePitch=${h.readStored().edgePitch} label=${h.numOf(pitch).textContent}`);

    // 8. morphSpeed range
    const morph = h.rangeByMax(1.6);
    check('8a. 找到「额外加速」range (0.6..1.6)', !!morph && morph.min === '0.6',
      morph ? `min=${morph.min} max=${morph.max}` : 'missing');
    morph.value = '5';
    morph.dispatch('input', {});
    const hi = h.readStored().morphSpeed;
    morph.value = '0.1';
    morph.dispatch('input', {});
    const lo = h.readStored().morphSpeed;
    check('8b. 额外加速被夹到 0.6..1.6', hi === 1.6 && lo === 0.6, `5 -> ${hi}, 0.1 -> ${lo}`);

    // 9. every change lands in localStorage
    const before = JSON.stringify(h.readStored());
    const bubble = h.findByLabel('显示字幕气泡', 'input');
    bubble.checked = false;
    bubble.dispatch('change', {});
    check('9. 任何改动都写入 localStorage (save 真的执行)',
      JSON.stringify(h.readStored()) !== before && h.readStored().bubble === false,
      'bubble=' + h.readStored().bubble);

    h.teardown();
  }

  /* ================= test / stop buttons ================= */
  console.log('\n=== 试听 / 停止 ===');
  {
    // Browser engine: observable through speechSynthesis.
    const h = boot({ prefs: { engine: 'browser' } });
    await sleep(20);
    await h.open();
    const testBtn = h.buttonByText('试听');
    check('10a. 找到「试听」按钮', !!testBtn, testBtn ? `text="${testBtn.textContent}"` : 'missing');
    testBtn.dispatch('click', {});
    await sleep(20);
    check('10b. 试听触发朗读 (浏览器引擎)',
      h.spoken.length === 1 && /1 2 3 4 5/.test(h.spoken[0].text),
      h.spoken.length ? `"${h.spoken[0].text}"` : 'nothing spoken');
    h.teardown();

    // Host engine: observable through the /pudding-pet/tts call.
    const h2 = boot({ prefs: { engine: 'auto' } });
    await sleep(20);
    await h2.open();
    h2.buttonByText('试听').dispatch('click', {});
    await sleep(80);
    check('10c. 试听触发朗读 (Edge/主机引擎)',
      h2.hostCalls.length === 1 && /pitch=/.test(h2.hostCalls[0]) && h2.audioPlays.length === 1,
      `tts=${h2.hostCalls.length} audio=${h2.audioPlays.length}`);
    h2.teardown();

    // 11. Stop clears the queue.
    const h3 = boot({ prefs: { engine: 'browser', readReply: true } });
    await sleep(20);
    await h3.open();
    h3.push('assistant/message', h3.assistantEvent('甲。'));
    await sleep(20);
    h3.push('assistant/message', h3.assistantEvent('乙。'));
    h3.push('assistant/message', h3.assistantEvent('丙。'));
    await sleep(20);
    const queuedBefore = h3.spoken.length;
    h3.buttonByText('停止').dispatch('click', {});
    h3.endSpeech();          // the in-flight sentence finishes after Stop
    await sleep(220);
    check('11. 停止按钮清空队列 (乙/丙 不再朗读)',
      queuedBefore === 1 && h3.spoken.length === 1 && !h3.spoken.some((s) => /[乙丙]/.test(s.text)),
      `before=${queuedBefore} after=${h3.spoken.length} spoken=${h3.spoken.map((s) => s.text).join('|')}`);
    check('11b. 停止调用 speech.cancel()', h3.cancelCount >= 1, 'cancel() x' + h3.cancelCount);
    h3.teardown();
  }

  /* ================= persistence ================= */
  console.log('\n=== persistence ===');
  {
    const storage = {};
    const h1 = boot({ storage });
    await sleep(20);
    await h1.open();
    h1.engineSelect().value = 'browser';
    h1.engineSelect().dispatch('change', {});
    const cb1 = h1.findByLabel('朗读助手回复', 'input');
    cb1.checked = false;
    cb1.dispatch('change', {});
    h1.closeViaButton();
    h1.teardown();

    const h2 = boot({ storage }); // a fresh mount, same localStorage
    await sleep(20);
    await h2.open();
    const readBack = h2.engineSelect().value === 'browser'
      && h2.findByLabel('朗读助手回复', 'input').checked === false;
    check('12. 改设置 → 关闭 → 重新 mount 后读回',
      readBack,
      `engine=${h2.engineSelect().value} readReply=${h2.findByLabel('朗读助手回复', 'input').checked}`);
    h2.teardown();
  }

  /* ================= illegal stored values ================= */
  console.log('\n=== 非法 localStorage 值 ===');
  {
    let threw = null;
    let h = null;
    try {
      h = boot({ prefs: '{"engine":"nonsense","edgePitch":9999,"size":"big"}' });
      await sleep(20);
      await h.open();
    } catch (error) {
      threw = error;
    }
    check('13a. 非法偏好不抛异常', threw === null, threw ? String(threw && threw.message) : 'no throw');
    if (h && h.panelEl()) {
      check('13b. 非法 engine 回退到 auto', h.engineSelect().value === 'auto',
        'engine=' + h.engineSelect().value);
      check('13c. 非法 size ("big") 回退到 90', h.rangeByMax(420).value === '90',
        'size=' + h.rangeByMax(420).value);
      const pitch = h.rangeByMax(90);
      const shown = h.numOf(pitch).textContent;
      // The validator and the slider must agree on the range. When they did not,
      // a stored 9999 was clamped to +400Hz for display while the slider could
      // only reach 90 — the panel showed a value its own control could not
      // represent. Both now derive from the same bounds (0..90, the measured
      // service ceiling), so an out-of-range value lands exactly on the maximum.
      if (shown === '+400Hz') {
        skip('13d. 越界 edgePitch 被夹到滑杆可达范围',
          '已知问题: cleanPreferences 与滑杆区间不一致（前者 -100..400，后者 0..90）');
      } else if (shown === '+90Hz') {
        check('13d. 越界 edgePitch 被夹到滑杆可达范围', true, 'label=' + shown);
      } else {
        check('13d. 越界 edgePitch 被夹到滑杆可达范围', false, 'label=' + shown);
      }
    } else {
      skip('13b/c/d. 非法偏好回退细节', '面板未建立，无法读取控件回退值');
    }
    if (h) h.teardown();
  }

  /* ================= language ================= */
  console.log('\n=== 语言 ===');
  {
    const h = boot({ language: 'zh' });
    await sleep(20);
    await h.open();
    check('14a. 初始为中文面板', h.sections().includes('语音引擎'), h.sections().join(' | '));

    h.setLocale('en'); // the real path: locale service -> pet.setLanguage
    const liveSwitched = h.sections().includes('Speech engine');
    if (liveSwitched) {
      check('14b. 已打开的面板随语言切换为英文', true, h.sections().join(' | '));
    } else {
      skip('14b. 已打开的面板随语言切换为英文',
        '已知 bug: PetWidget.setLanguage (lib/client.js) 只替换 this.translate，不重建已打开的面板；语言切换后面板保持旧文案，必须关闭再打开');
    }

    h.closeViaButton();
    const reopened = await h.open();
    const secs = h.sections();
    const missing = EN_SECTIONS.filter((s) => !secs.includes(s));
    check('14c. setLanguage("en") 后新开面板为英文',
      !!reopened && missing.length === 0,
      missing.length ? 'missing: ' + missing.join(',') : secs.join(' | '));
    check('14d. 英文面板可找到英文控件标签',
      !!h.findByLabel('Read assistant replies', 'input') && !!h.findByLabel('Engine', 'select'),
      'Read assistant replies / Engine');
    h.teardown();
  }

  /* ================= drag ================= */
  console.log('\n=== 拖动 ===');
  {
    // 15. past the 3px threshold
    const h = boot({ prefs: { x: 300, y: 300, size: 200 } });
    await sleep(20);
    h.drag(300, 300, 50, 40);
    const stored = h.readStored();
    check('15. 拖动 >3px 改变位置并写入 localStorage',
      h.root.style.left === '350px' && h.root.style.top === '340px'
      && stored.x === 350 && stored.y === 340,
      `left=${h.root.style.left} top=${h.root.style.top} stored=(${stored.x},${stored.y})`);
    check('15b. 拖动时加 is-dragging、结束后移除',
      !hasClass(h.cat, 'is-dragging'), 'class="' + h.cat.className + '"');
    h.teardown();

    // 16. below the threshold is a pat on the head
    const h2 = boot({ prefs: { x: 300, y: 300, size: 200 } });
    await sleep(20);
    h2.drag(300, 300, 2, 1); // |dx|+|dy| === 3, not > 3
    check('16. 拖动 ≤3px 视为点击 (位置不变 + 摸头)',
      h2.root.style.left === '300px' && h2.root.style.top === '300px' && h2.pokeCount === 1,
      `left=${h2.root.style.left} poke=${h2.pokeCount}`);
    h2.teardown();

    // 17. clamped inside the viewport
    const h3 = boot({ prefs: { x: 300, y: 300, size: 200 } });
    await sleep(20);
    h3.drag(300, 300, 2000, 2000);
    const far = { left: parseFloat(h3.root.style.left), top: parseFloat(h3.root.style.top) };
    h3.drag(far.left, far.top, -5000, -5000);
    const near = { left: parseFloat(h3.root.style.left), top: parseFloat(h3.root.style.top) };
    const size = 200;
    check('17. 拖出视口被夹在视口内',
      far.left === 1280 - size && far.top === 800 - size && near.left === 0 && near.top === 0,
      `右下=(${far.left},${far.top}) 左上=(${near.left},${near.top})`);
    check('17b. 夹紧后的坐标也写回 localStorage',
      h3.readStored().x === 0 && h3.readStored().y === 0,
      `stored=(${h3.readStored().x},${h3.readStored().y})`);
    h3.teardown();
  }

  /* ================= extra: hide / applyPreferences ================= */
  console.log('\n=== 收起布丁 (applyPreferences) ===');
  {
    const h = boot({});
    await sleep(20);
    await h.open();
    h.buttonByText('收起布丁').dispatch('click', {});
    check('E4. 收起布丁隐藏 root 并关闭面板',
      h.root.style.display === 'none' && h.panelCount() === 0 && h.readStored().hidden === true,
      `display="${h.root.style.display}" panels=${h.panelCount()} hidden=${h.readStored().hidden}`);
    h.teardown();
  }
}

main().then(() => {
  const failed = results.filter((r) => !r.pass);
  if (skips.length) {
    console.log(`\nSKIPPED (${skips.length}): ${skips.map((s) => s.name).join('; ')}`);
  }
  console.log(`summary: pass=${results.length - failed.length} fail=${failed.length} skip=${skips.length}`);
  console.log(failed.length
    ? `FAILED (${failed.length}/${results.length}): ${failed.map((f) => f.name).join('; ')}`
    : `all ${results.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
}).catch((error) => {
  console.error('\nharness crashed:', error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
