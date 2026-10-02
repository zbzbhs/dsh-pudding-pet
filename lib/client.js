/**
 * Pudding Pet — client half.
 *
 * Renders a cat into DSH's `shell.overlay` slot, reads assistant text from the
 * session event stream, and speaks it through the Web Speech API with a raised
 * pitch.
 *
 * Design notes
 * ------------
 * - Plain browser JavaScript loaded through DSH's module loader. React comes
 *   from the module table; nothing else is required.
 * - No host route, no network request, no model call. Everything happens in the
 *   page, so editing this file needs only a refresh.
 * - The pet is mounted into `shell.overlay`, whose layer is
 *   `pointer-events: none`; the pet container explicitly opts back into pointer
 *   events and nothing else in the layer does.
 * - The visual sits behind a small adapter so the artwork can be swapped later
 *   without touching any behaviour.
 *
 * This is the authored source. `lib/client.js` is generated from it by
 * `tools/build.mjs`, which substitutes the two artwork placeholders.
 */
window.__ModuleLoader__.load({
  id: 'dsh-pudding-pet',
  factory: function (require) {
    'use strict';

    var React = require('react');
    var h = React.createElement;

    /* ------------------------------------------------------------------ *
     * 0. Baked-in artwork
     *
     * DSH serves a plugin's browser code through a `/plugins/<id>/<file>` route
     * that only accepts files named `client.*.js`, so assets under `assets/`
     * cannot be fetched at runtime. The artwork controller (a self-contained
     * IIFE that publishes `window.PuddingCat`) and its stylesheet are therefore
     * substituted in at build time.
     * ------------------------------------------------------------------ */

    var PUDDING_ARTWORK_JS = "/* =============================================================================\r\n   布丁 / Pudding — DSH desktop-pet cat · zero-dependency browser controller\r\n   -----------------------------------------------------------------------------\r\n   Original work, dedicated to the public domain (CC0-1.0).\r\n   See LICENSE-ASSETS.md.  Not affiliated with Outfit7's \"Talking Tom\".\r\n\r\n   Plain browser JavaScript. No `import` / `export`, no bundler required, no\r\n   runtime dependencies. Load with a plain <script> tag, or concatenate it into\r\n   a DSH plugin client bundle — it only touches `window` / `document`.\r\n\r\n   Quick start\r\n   -----------\r\n     <link rel=\"stylesheet\" href=\"cat.css\">\r\n     <script src=\"cat.js\"></script>\r\n     <div id=\"pet\"></div>\r\n     <script>\r\n       const cat = PuddingCat.create('#pet');\r\n       cat.attachEyeTracking(document);   // pupils follow the mouse\r\n       cat.attachHover();                 // ears perk on hover\r\n       cat.setState('think');\r\n       cat.poke();\r\n     </script>\r\n\r\n   Or declaratively — no JS needed at the call site:\r\n     <div data-pudding-cat data-eye-tracking data-hover></div>\r\n\r\n   API\r\n   ---\r\n     PuddingCat.create(host, [options]) -> Controller\r\n     PuddingCat.mount(host, [options])  -> Controller   (alias)\r\n     PuddingCat.svg()                   -> string       (inline SVG markup)\r\n     PuddingCat.STATES                  -> string[]     (the 10 state names)\r\n\r\n   Controller\r\n     setState(name)                  switch state; unknown names are ignored\r\n     getState()                      current state name\r\n     poke([returnTo])                one-shot poke reaction, auto-restores state\r\n     setTalkRate(ms|wpm)             mouth speed while talking\r\n     attachEyeTracking(targetEl)     pupils follow the pointer over `targetEl`\r\n     detachEyeTracking()\r\n     attachHover(el)                 add `is-hover` on pointer enter/leave\r\n     detachHover()\r\n     freeze(bool)                    add/remove `.no-anim` (static pose render)\r\n     destroy()                       remove listeners, drop the instance\r\n     el                              the root <svg> element\r\n     host                            the host element\r\n   ========================================================================== */\r\n(function (global) {\r\n  'use strict';\r\n\r\n  /* ---------------------------------------------------------------------- */\r\n  /* Inlined artwork.                                                       */\r\n  /* Source of truth: cat.svg — regenerate this constant with             */\r\n  /*   python tools/inline-svg.py                                           */\r\n  /* ---------------------------------------------------------------------- */\r\n  var CAT_SVG = \"<svg xmlns=\\\"http://www.w3.org/2000/svg\\\" viewBox=\\\"0 0 200 200\\\" class=\\\"cat is-idle\\\" role=\\\"img\\\" aria-label=\\\"布丁 (Pudding) — 原创卡通猫咪桌宠\\\" stroke-linejoin=\\\"round\\\" stroke-linecap=\\\"round\\\"><defs><clipPath id=\\\"catClipHead\\\"><ellipse cx=\\\"100\\\" cy=\\\"78\\\" rx=\\\"48\\\" ry=\\\"43\\\"/><\\/clipPath><clipPath id=\\\"catClipEyeL\\\"><ellipse cx=\\\"79\\\" cy=\\\"70\\\" rx=\\\"15\\\" ry=\\\"15.5\\\"/><\\/clipPath><clipPath id=\\\"catClipEyeR\\\"><ellipse cx=\\\"121\\\" cy=\\\"70\\\" rx=\\\"15\\\" ry=\\\"15.5\\\"/><\\/clipPath><clipPath id=\\\"catClipMouth\\\"><ellipse cx=\\\"100\\\" cy=\\\"109\\\" rx=\\\"10.5\\\" ry=\\\"8.5\\\"/><\\/clipPath><\\/defs><g class=\\\"stage\\\" id=\\\"stage\\\"><ellipse class=\\\"shadow\\\" id=\\\"shadow\\\" cx=\\\"100\\\" cy=\\\"189\\\" rx=\\\"56\\\" ry=\\\"8\\\" fill=\\\"#2B1B14\\\" opacity=\\\"0.13\\\"/><g class=\\\"tail\\\" id=\\\"tail\\\"><path class=\\\"ink-stroke\\\" d=\\\"M 130 178 C 156 182 176 168 176 146 C 176 128 164 118 150 120\\\" fill=\\\"none\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"21\\\"/><path class=\\\"patch-stroke\\\" d=\\\"M 130 178 C 156 182 176 168 176 146 C 176 128 164 118 150 120\\\" fill=\\\"none\\\" stroke=\\\"#E8A85C\\\" stroke-width=\\\"15\\\"/><path class=\\\"fur-light-stroke\\\" d=\\\"M 172.02 130.21 C 167.36 122.47 159.1 118.7 150 120\\\" fill=\\\"none\\\" stroke=\\\"#FFF6E6\\\" stroke-width=\\\"15\\\"/><\\/g><g class=\\\"body\\\" id=\\\"body\\\"><ellipse class=\\\"haunch fur\\\" cx=\\\"52\\\" cy=\\\"164\\\" rx=\\\"21\\\" ry=\\\"23\\\" fill=\\\"#FFE9C9\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"3\\\"/><ellipse class=\\\"haunch fur\\\" cx=\\\"148\\\" cy=\\\"164\\\" rx=\\\"21\\\" ry=\\\"23\\\" fill=\\\"#FFE9C9\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"3\\\"/><path class=\\\"torso fur\\\" d=\\\"M 100 104 C 126 104 144 128 146 156 C 148 178 132 188 100 188 C 68 188 52 178 54 156 C 56 128 74 104 100 104 Z\\\" fill=\\\"#FFE9C9\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"3\\\"/><path class=\\\"chest fur-light\\\" d=\\\"M 100 112 C 118 112 128 132 128 154 C 128 174 116 184 100 184 C 84 184 72 174 72 154 C 72 132 82 112 100 112 Z\\\" fill=\\\"#FFF6E6\\\"/><\\/g><g class=\\\"scarf\\\" id=\\\"scarf\\\"><path class=\\\"scarf-band\\\" d=\\\"M 70 112 Q 100 128 130 112 Q 132 126 100 142 Q 68 126 70 112 Z\\\" fill=\\\"#4FB6A6\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"3\\\"/><ellipse class=\\\"scarf-knot\\\" cx=\\\"100\\\" cy=\\\"136\\\" rx=\\\"10\\\" ry=\\\"8\\\" fill=\\\"#3E9C8D\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"3\\\"/><\\/g><g class=\\\"head\\\" id=\\\"head\\\"><g class=\\\"ear ear-l\\\" id=\\\"ear-left\\\"><path class=\\\"fur-patch\\\" d=\\\"M 94 38 L 54.95 11.38 Q 50 8 50.74 13.95 L 56 56 Z\\\" fill=\\\"#E8A85C\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"3\\\"/><path class=\\\"ear-inner\\\" d=\\\"M 56.67 18.4 L 83.07 36.4 L 60.27 47.2 Z\\\" fill=\\\"#F7B8AE\\\"/><\\/g><g class=\\\"ear ear-r\\\" id=\\\"ear-right\\\"><path class=\\\"fur-patch\\\" d=\\\"M 106 38 L 145.05 11.38 Q 150 8 149.26 13.95 L 144 56 Z\\\" fill=\\\"#E8A85C\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"3\\\"/><path class=\\\"ear-inner\\\" d=\\\"M 143.33 18.4 L 116.93 36.4 L 139.73 47.2 Z\\\" fill=\\\"#F7B8AE\\\"/><\\/g><ellipse class=\\\"head-shape fur\\\" cx=\\\"100\\\" cy=\\\"78\\\" rx=\\\"48\\\" ry=\\\"43\\\" fill=\\\"#FFE9C9\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"3\\\"/><path class=\\\"cap\\\" clip-path=\\\"url(#catClipHead)\\\" d=\\\"M 46 82 C 46 44 70 26 100 26 C 130 26 154 44 154 82 C 144 58 124 46 100 46 C 76 46 56 58 46 82 Z\\\" fill=\\\"#E8A85C\\\"/><path class=\\\"mark\\\" d=\\\"M 100 29 Q 102 35 108 37 Q 102 39 100 45 Q 98 39 92 37 Q 98 35 100 29 Z\\\" fill=\\\"#FFF6E6\\\"/><ellipse class=\\\"muzzle fur-light\\\" cx=\\\"100\\\" cy=\\\"104\\\" rx=\\\"27\\\" ry=\\\"16\\\" fill=\\\"#FFF6E6\\\"/><g class=\\\"eye eye-l\\\" id=\\\"eye-left\\\"><ellipse class=\\\"sclera\\\" cx=\\\"79\\\" cy=\\\"70\\\" rx=\\\"15\\\" ry=\\\"15.5\\\" fill=\\\"#FFFFFF\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"2.6\\\"/><g clip-path=\\\"url(#catClipEyeL)\\\"><g class=\\\"gaze-state\\\"><g class=\\\"gaze-track\\\"><circle class=\\\"iris\\\" cx=\\\"79\\\" cy=\\\"70\\\" r=\\\"10.5\\\" fill=\\\"#3E7C8F\\\"/><ellipse class=\\\"pupil\\\" cx=\\\"79\\\" cy=\\\"70\\\" rx=\\\"4.6\\\" ry=\\\"7.6\\\" fill=\\\"#241A16\\\"/><circle class=\\\"glint\\\" cx=\\\"75.2\\\" cy=\\\"66.4\\\" r=\\\"3.1\\\" fill=\\\"#FFFFFF\\\"/><circle class=\\\"glint2\\\" cx=\\\"82.6\\\" cy=\\\"75.4\\\" r=\\\"1.6\\\" fill=\\\"#FFFFFF\\\" opacity=\\\"0.7\\\"/><\\/g><\\/g><rect class=\\\"lid\\\" x=\\\"62\\\" y=\\\"52\\\" width=\\\"34\\\" height=\\\"36\\\" fill=\\\"#FFE9C9\\\"/><path class=\\\"lash lash-blink\\\" d=\\\"M 66 72 Q 79 77 92 72\\\" fill=\\\"none\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"2.8\\\" opacity=\\\"0\\\"/><path class=\\\"lash lash-happy\\\" d=\\\"M 66 76 Q 79 64 92 76\\\" fill=\\\"none\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"2.8\\\" opacity=\\\"0\\\"/><path class=\\\"lash lash-sleep\\\" d=\\\"M 66 68 Q 79 78 92 68\\\" fill=\\\"none\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"2.8\\\" opacity=\\\"0\\\"/><\\/g><ellipse class=\\\"eye-rim\\\" cx=\\\"79\\\" cy=\\\"70\\\" rx=\\\"15\\\" ry=\\\"15.5\\\" fill=\\\"none\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"2.6\\\"/><\\/g><g class=\\\"eye eye-r\\\" id=\\\"eye-right\\\"><ellipse class=\\\"sclera\\\" cx=\\\"121\\\" cy=\\\"70\\\" rx=\\\"15\\\" ry=\\\"15.5\\\" fill=\\\"#FFFFFF\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"2.6\\\"/><g clip-path=\\\"url(#catClipEyeR)\\\"><g class=\\\"gaze-state\\\"><g class=\\\"gaze-track\\\"><circle class=\\\"iris\\\" cx=\\\"121\\\" cy=\\\"70\\\" r=\\\"10.5\\\" fill=\\\"#3E7C8F\\\"/><ellipse class=\\\"pupil\\\" cx=\\\"121\\\" cy=\\\"70\\\" rx=\\\"4.6\\\" ry=\\\"7.6\\\" fill=\\\"#241A16\\\"/><circle class=\\\"glint\\\" cx=\\\"117.2\\\" cy=\\\"66.4\\\" r=\\\"3.1\\\" fill=\\\"#FFFFFF\\\"/><circle class=\\\"glint2\\\" cx=\\\"124.6\\\" cy=\\\"75.4\\\" r=\\\"1.6\\\" fill=\\\"#FFFFFF\\\" opacity=\\\"0.7\\\"/><\\/g><\\/g><rect class=\\\"lid\\\" x=\\\"104\\\" y=\\\"52\\\" width=\\\"34\\\" height=\\\"36\\\" fill=\\\"#FFE9C9\\\"/><path class=\\\"lash lash-blink\\\" d=\\\"M 108 72 Q 121 77 134 72\\\" fill=\\\"none\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"2.8\\\" opacity=\\\"0\\\"/><path class=\\\"lash lash-happy\\\" d=\\\"M 108 76 Q 121 64 134 76\\\" fill=\\\"none\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"2.8\\\" opacity=\\\"0\\\"/><path class=\\\"lash lash-sleep\\\" d=\\\"M 108 68 Q 121 78 134 68\\\" fill=\\\"none\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"2.8\\\" opacity=\\\"0\\\"/><\\/g><ellipse class=\\\"eye-rim\\\" cx=\\\"121\\\" cy=\\\"70\\\" rx=\\\"15\\\" ry=\\\"15.5\\\" fill=\\\"none\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"2.6\\\"/><\\/g><path class=\\\"brow brow-l\\\" d=\\\"M 68 52 Q 79 47 90 51\\\" fill=\\\"none\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"2.4\\\" opacity=\\\"0\\\"/><path class=\\\"brow brow-r\\\" d=\\\"M 110 51 Q 121 47 132 52\\\" fill=\\\"none\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"2.4\\\" opacity=\\\"0\\\"/><ellipse class=\\\"blush\\\" cx=\\\"66\\\" cy=\\\"94\\\" rx=\\\"10\\\" ry=\\\"6\\\" fill=\\\"#F79A86\\\" opacity=\\\"0.38\\\"/><ellipse class=\\\"blush\\\" cx=\\\"134\\\" cy=\\\"94\\\" rx=\\\"10\\\" ry=\\\"6\\\" fill=\\\"#F79A86\\\" opacity=\\\"0.38\\\"/><path class=\\\"nose\\\" d=\\\"M 93.5 92 L 106.5 92 Q 108.5 92 107.3 93.6 L 101.6 101 Q 100 103 98.4 101 L 92.7 93.6 Q 91.5 92 93.5 92 Z\\\" fill=\\\"#F2907E\\\"/><g class=\\\"mouth mouth-closed\\\" id=\\\"mouth-closed\\\" opacity=\\\"1\\\"><path d=\\\"M 100 102 L 100 105.5\\\" fill=\\\"none\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"2.6\\\"/><path d=\\\"M 100 105.5 C 100 111 95.8 113 91.5 109.8\\\" fill=\\\"none\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"2.6\\\"/><path d=\\\"M 100 105.5 C 100 111 104.2 113 108.5 109.8\\\" fill=\\\"none\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"2.6\\\"/><\\/g><g class=\\\"mouth mouth-open\\\" id=\\\"mouth-open\\\" opacity=\\\"0\\\"><g class=\\\"jaw\\\"><g clip-path=\\\"url(#catClipMouth)\\\"><ellipse class=\\\"mouth-inner\\\" cx=\\\"100\\\" cy=\\\"109\\\" rx=\\\"10\\\" ry=\\\"7.5\\\" fill=\\\"#7A3B36\\\"/><ellipse class=\\\"tongue\\\" cx=\\\"100\\\" cy=\\\"114.5\\\" rx=\\\"6.5\\\" ry=\\\"4.5\\\" fill=\\\"#F2907E\\\"/><\\/g><\\/g><\\/g><path class=\\\"mouth mouth-smile\\\" d=\\\"M 87 105 Q 100 117 113 105\\\" fill=\\\"none\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"3.2\\\" opacity=\\\"0\\\"/><path class=\\\"mouth mouth-frown\\\" d=\\\"M 91 112 Q 100 105 109 112\\\" fill=\\\"none\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"3.2\\\" opacity=\\\"0\\\"/><path class=\\\"mouth mouth-flat\\\" d=\\\"M 92 108 Q 100 111 108 108\\\" fill=\\\"none\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"3\\\" opacity=\\\"0\\\"/><ellipse class=\\\"mouth mouth-sleep\\\" cx=\\\"100\\\" cy=\\\"108\\\" rx=\\\"4.5\\\" ry=\\\"3.8\\\" fill=\\\"#7A3B36\\\" opacity=\\\"0\\\"/><path class=\\\"tear\\\" d=\\\"M 70 88 Q 77 97 77 101 Q 77 106 70 106 Q 63 106 63 101 Q 63 97 70 88 Z\\\" fill=\\\"#7FC8E8\\\" opacity=\\\"0\\\"/><\\/g><g class=\\\"leg leg-l\\\" id=\\\"leg-left\\\"><rect class=\\\"fur\\\" x=\\\"70\\\" y=\\\"138\\\" width=\\\"20\\\" height=\\\"48\\\" rx=\\\"9\\\" fill=\\\"#FFE9C9\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"3\\\"/><path class=\\\"paw-line\\\" d=\\\"M 76 172 L 76 182 M 84 172 L 84 182\\\" fill=\\\"none\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"2\\\"/><\\/g><g class=\\\"leg leg-r\\\" id=\\\"leg-right\\\"><rect class=\\\"fur\\\" x=\\\"110\\\" y=\\\"138\\\" width=\\\"20\\\" height=\\\"48\\\" rx=\\\"9\\\" fill=\\\"#FFE9C9\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"3\\\"/><path class=\\\"paw-line\\\" d=\\\"M 116 172 L 116 182 M 124 172 L 124 182\\\" fill=\\\"none\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"2\\\"/><\\/g><g class=\\\"fx\\\" id=\\\"fx\\\"><g class=\\\"zzz\\\" id=\\\"zzz\\\" opacity=\\\"0\\\"><path class=\\\"z z1\\\" d=\\\"M 152 40 L 164 40 L 152 54 L 164 54\\\" fill=\\\"none\\\" stroke=\\\"#3E9C8D\\\" stroke-width=\\\"3.6\\\"/><path class=\\\"z z2\\\" d=\\\"M 162 26 L 172 26 L 162 38 L 172 38\\\" fill=\\\"none\\\" stroke=\\\"#3E9C8D\\\" stroke-width=\\\"3.2\\\"/><path class=\\\"z z3\\\" d=\\\"M 170 12 L 178 12 L 170 22 L 178 22\\\" fill=\\\"none\\\" stroke=\\\"#3E9C8D\\\" stroke-width=\\\"2.8\\\"/><\\/g><g class=\\\"sparkles\\\" id=\\\"sparkles\\\" opacity=\\\"0\\\"><path class=\\\"sparkle s1\\\" d=\\\"M 40 33 Q 42 39 48 41 Q 42 43 40 49 Q 38 43 32 41 Q 38 39 40 33 Z\\\" fill=\\\"#F2C14E\\\"/><path class=\\\"sparkle s2\\\" d=\\\"M 162 40 Q 163.5 45 168 46.5 Q 163.5 48 162 53 Q 160.5 48 156 46.5 Q 160.5 45 162 40 Z\\\" fill=\\\"#F2C14E\\\"/><path class=\\\"sparkle s3\\\" d=\\\"M 152 10 Q 153.5 15 158 16.5 Q 153.5 18 152 23 Q 150.5 18 146 16.5 Q 150.5 15 152 10 Z\\\" fill=\\\"#F2C14E\\\"/><\\/g><g class=\\\"dots\\\" id=\\\"dots\\\" opacity=\\\"0\\\"><circle class=\\\"dot d1\\\" cx=\\\"142\\\" cy=\\\"60\\\" r=\\\"2.6\\\" fill=\\\"#4FB6A6\\\"/><circle class=\\\"dot d2\\\" cx=\\\"153\\\" cy=\\\"52\\\" r=\\\"3.8\\\" fill=\\\"#4FB6A6\\\"/><circle class=\\\"dot d3\\\" cx=\\\"166\\\" cy=\\\"42\\\" r=\\\"5\\\" fill=\\\"#4FB6A6\\\"/><\\/g><g class=\\\"surprise\\\" id=\\\"surprise\\\" opacity=\\\"0\\\"><path d=\\\"M 43 22 L 49 22 L 47 38 L 45 38 Z\\\" fill=\\\"#F2C14E\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"2\\\"/><circle cx=\\\"46\\\" cy=\\\"45\\\" r=\\\"2.8\\\" fill=\\\"#F2C14E\\\" stroke=\\\"#4A342A\\\" stroke-width=\\\"2\\\"/><\\/g><g class=\\\"work-marks\\\" id=\\\"work-marks\\\" opacity=\\\"0\\\"><path class=\\\"wm wm-l\\\" d=\\\"M 58 158 Q 62 164 58 170\\\" fill=\\\"none\\\" stroke=\\\"#4FB6A6\\\" stroke-width=\\\"3\\\"/><path class=\\\"wm wm-r\\\" d=\\\"M 142 158 Q 138 164 142 170\\\" fill=\\\"none\\\" stroke=\\\"#4FB6A6\\\" stroke-width=\\\"3\\\"/><\\/g><\\/g><\\/g><\\/svg>\";\r\n\r\n  var STATES = [\r\n    'idle', 'listen', 'think', 'work', 'waiting',\r\n    'talk', 'happy', 'sad', 'sleep', 'poke'\r\n  ];\r\n\r\n  /* States where the eyes stay shut on purpose — never auto-blink these. */\r\n  var EYES_SHUT = { happy: 1, sleep: 1 };\r\n  /* Blink is driven by CSS for `idle` (so it still works with JS disabled). */\r\n  var CSS_BLINKS = { idle: 1 };\r\n\r\n  var POKE_MS = 620;\r\n  var GAZE_MAX_X = 3.4;   // px of travel inside the 200x200 viewBox\r\n  var GAZE_MAX_Y = 2.8;\r\n  var IDLE_DRIFT_AFTER_MS = 3500;\r\n\r\n  var instances = [];\r\n\r\n  /* ---------------------------------------------------------------------- */\r\n  /* helpers                                                                */\r\n  /* ---------------------------------------------------------------------- */\r\n\r\n  function resolveHost(host) {\r\n    if (!host) return null;\r\n    if (typeof host === 'string') return document.querySelector(host);\r\n    if (host.nodeType === 1) return host;\r\n    if (host.el && host.el.nodeType === 1) return host.el;\r\n    return null;\r\n  }\r\n\r\n  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }\r\n\r\n  function raf(fn) {\r\n    if (typeof global.requestAnimationFrame === 'function') {\r\n      return global.requestAnimationFrame(fn);\r\n    }\r\n    return global.setTimeout(fn, 16);\r\n  }\r\n\r\n  function now() {\r\n    return (global.performance && global.performance.now)\r\n      ? global.performance.now() : Date.now();\r\n  }\r\n\r\n  /* ---------------------------------------------------------------------- */\r\n  /* Controller                                                             */\r\n  /* ---------------------------------------------------------------------- */\r\n\r\n  function Controller(host, options) {\r\n    options = options || {};\r\n\r\n    this.host = host;\r\n    this.options = options;\r\n    this.state = 'idle';\r\n    this._prevState = 'idle';\r\n    this._pokeTimer = null;\r\n    this._pokeActive = false;\r\n    this._blinkTimer = null;\r\n    this._destroyed = false;\r\n\r\n    /* eye tracking */\r\n    this._eyeTarget = null;\r\n    this._gazeRaf = 0;\r\n    this._pointer = null;          // {x, y}\r\n    this._lastMoveAt = 0;\r\n    this._driftRaf = 0;\r\n    this._driftStart = 0;\r\n\r\n    /* hover */\r\n    this._hoverEl = null;\r\n    this._onEnter = null;\r\n    this._onLeave = null;\r\n\r\n    /* --- build DOM ----------------------------------------------------- */\r\n    host.classList.add('pudding-cat-host');\r\n    host.innerHTML = CAT_SVG;\r\n    this.el = host.querySelector('svg.cat') || host.querySelector('svg');\r\n\r\n    if (!this.el) throw new Error('PuddingCat: artwork failed to mount');\r\n    if (this.el.parentNode !== host) host.appendChild(this.el);\r\n\r\n    this.el.classList.remove('is-idle');\r\n    this.el.classList.add('is-idle');\r\n\r\n    if (options.scale) this.setScale(options.scale);\r\n    if (options.talkRate) this.setTalkRate(options.talkRate);\r\n    if (options.freeze) this.freeze(true);\r\n\r\n    this._scheduleBlink();\r\n\r\n    if (options.eyeTracking) this.attachEyeTracking(options.eyeTracking === true ? document : options.eyeTracking);\r\n    if (options.hover) this.attachHover(options.hover === true ? host : options.hover);\r\n\r\n    instances.push(this);\r\n  }\r\n\r\n  /* --------------------------- state machine --------------------------- */\r\n\r\n  Controller.prototype.setState = function (name) {\r\n    if (this._destroyed) return this;\r\n    if (STATES.indexOf(name) === -1) {\r\n      if (global.console && console.warn) {\r\n        console.warn('[PuddingCat] unknown state: ' + name);\r\n      }\r\n      return this;\r\n    }\r\n    /* Poking is a one-shot; an explicit setState cancels its restore. */\r\n    if (this._pokeTimer) { global.clearTimeout(this._pokeTimer); this._pokeTimer = null; }\r\n    this._pokeActive = false;\r\n\r\n    this._applyState(name);\r\n    return this;\r\n  };\r\n\r\n  Controller.prototype._applyState = function (name) {\r\n    var el = this.el;\r\n    var i;\r\n    for (i = 0; i < STATES.length; i++) el.classList.remove('is-' + STATES[i]);\r\n    el.classList.add('is-' + name);\r\n    el.classList.remove('is-blink');\r\n    this.state = name;\r\n    if (!EYES_SHUT[name]) this._scheduleBlink();\r\n    this._syncDrift();\r\n  };\r\n\r\n  Controller.prototype.getState = function () { return this.state; };\r\n\r\n  /* --------------------------- one-shot poke --------------------------- */\r\n\r\n  Controller.prototype.poke = function (returnTo) {\r\n    if (this._destroyed) return this;\r\n    var self = this;\r\n    var target = (typeof returnTo === 'string' && STATES.indexOf(returnTo) !== -1)\r\n      ? returnTo\r\n      : (this._pokeActive ? this._prevState : this.state);\r\n\r\n    this._prevState = target;\r\n    this._pokeActive = true;\r\n\r\n    if (this._pokeTimer) { global.clearTimeout(this._pokeTimer); this._pokeTimer = null; }\r\n\r\n    /* restart the CSS animation even on a rapid double-click */\r\n    this.el.classList.remove('is-poke');\r\n    void this.el.getBoundingClientRect();\r\n    this._applyState('poke');\r\n    this._pokeActive = true;\r\n\r\n    this._pokeTimer = global.setTimeout(function () {\r\n      self._pokeTimer = null;\r\n      self._pokeActive = false;\r\n      self._applyState(target);\r\n    }, POKE_MS);\r\n\r\n    return this;\r\n  };\r\n\r\n  /* --------------------------- talk speed ------------------------------ */\r\n\r\n  /* Accepts a millisecond cycle length, or { wpm } for words-per-minute feel. */\r\n  Controller.prototype.setTalkRate = function (v) {\r\n    var ms;\r\n    if (typeof v === 'number') {\r\n      ms = v;\r\n    } else if (v && typeof v === 'object' && typeof v.wpm === 'number') {\r\n      ms = clamp(60000 / (v.wpm * 1.6), 90, 600);\r\n    } else {\r\n      return this;\r\n    }\r\n    this.el.style.setProperty('--talk-duration', clamp(ms, 70, 900) + 'ms');\r\n    return this;\r\n  };\r\n\r\n  Controller.prototype.setScale = function (px) {\r\n    if (typeof px === 'number') {\r\n      this.host.style.width = px + 'px';\r\n    } else if (typeof px === 'string') {\r\n      this.host.style.width = px;\r\n    }\r\n    return this;\r\n  };\r\n\r\n  /* --------------------------- eye tracking ---------------------------- */\r\n\r\n  Controller.prototype.attachEyeTracking = function (targetEl) {\r\n    if (this._destroyed) return this;\r\n    this.detachEyeTracking();\r\n    var self = this;\r\n    this._eyeTarget = targetEl || document;\r\n\r\n    this._onPointerMove = function (ev) {\r\n      self._pointer = { x: ev.clientX, y: ev.clientY };\r\n      self._lastMoveAt = now();\r\n      /* Leading-edge update: keeps latency at zero for the common case, and\r\n         still works in environments where requestAnimationFrame is throttled\r\n         (background tabs, headless screenshot runs).  The rAF pass below only\r\n         coalesces bursts of moves. */\r\n      self._applyGaze();\r\n      if (!self._gazeRaf) {\r\n        self._gazeRaf = raf(function () {\r\n          self._gazeRaf = 0;\r\n          self._applyGaze();\r\n        });\r\n      }\r\n    };\r\n    this._onPointerOut = function () {\r\n      self._pointer = null;\r\n      self._setGaze(0, 0);\r\n    };\r\n\r\n    this._eyeTarget.addEventListener('mousemove', this._onPointerMove, { passive: true });\r\n    this._eyeTarget.addEventListener('pointermove', this._onPointerMove, { passive: true });\r\n    this._eyeTarget.addEventListener('mouseleave', this._onPointerOut, { passive: true });\r\n\r\n    this._syncDrift();\r\n    return this;\r\n  };\r\n\r\n  Controller.prototype.detachEyeTracking = function () {\r\n    if (this._eyeTarget) {\r\n      this._eyeTarget.removeEventListener('mousemove', this._onPointerMove);\r\n      this._eyeTarget.removeEventListener('pointermove', this._onPointerMove);\r\n      this._eyeTarget.removeEventListener('mouseleave', this._onPointerOut);\r\n    }\r\n    if (this._gazeRaf) {\r\n      if (global.cancelAnimationFrame) global.cancelAnimationFrame(this._gazeRaf);\r\n      this._gazeRaf = 0;\r\n    }\r\n    if (this._driftRaf) {\r\n      if (global.cancelAnimationFrame) global.cancelAnimationFrame(this._driftRaf);\r\n      this._driftRaf = 0;\r\n    }\r\n    this._eyeTarget = null;\r\n    this._pointer = null;\r\n    return this;\r\n  };\r\n\r\n  Controller.prototype._applyGaze = function () {\r\n    if (this._destroyed || !this._pointer || !this.el) return;\r\n    var r = this.el.getBoundingClientRect();\r\n    if (!r.width || !r.height) return;\r\n    var cx = r.left + r.width / 2;\r\n    var cy = r.top + r.height / 2;\r\n    /* normalise to -1..1 across half the rendered box, then ease */\r\n    var nx = clamp((this._pointer.x - cx) / (r.width * 0.62), -1, 1);\r\n    var ny = clamp((this._pointer.y - cy) / (r.height * 0.62), -1, 1);\r\n    this._setGaze(nx * GAZE_MAX_X, ny * GAZE_MAX_Y);\r\n  };\r\n\r\n  Controller.prototype._setGaze = function (x, y) {\r\n    if (!this.el) return;\r\n    this.el.style.setProperty('--gaze-x', x.toFixed(2) + 'px');\r\n    this.el.style.setProperty('--gaze-y', y.toFixed(2) + 'px');\r\n  };\r\n\r\n  /* --------------------------- gaze (public) --------------------------- */\r\n\r\n  /* Aim the pupils at an explicit direction without a pointer, e.g.\r\n     cat.lookAt(-1, -1) for \"up-left\", cat.lookAt(0, 0) to recentre.\r\n     nx / ny are normalised to -1..1. */\r\n  Controller.prototype.lookAt = function (nx, ny) {\r\n    this._setGaze(clamp(nx, -1, 1) * GAZE_MAX_X, clamp(ny, -1, 1) * GAZE_MAX_Y);\r\n    return this;\r\n  };\r\n\r\n  /* Current pupil offset in viewBox user units, read back from the element. */\r\n  Controller.prototype.getGaze = function () {\r\n    var cs = global.getComputedStyle(this.el);\r\n    return {\r\n      x: parseFloat(cs.getPropertyValue('--gaze-x')) || 0,\r\n      y: parseFloat(cs.getPropertyValue('--gaze-y')) || 0\r\n    };\r\n  };\r\n\r\n  /* Gentle wander when the pointer has been still for a while, so the cat\r\n     does not look frozen between mouse moves. */\r\n  Controller.prototype._syncDrift = function () {\r\n    var self = this;\r\n    var wantDrift = !!this._eyeTarget && !this._pokeActive;\r\n    if (!wantDrift || this._driftRaf) return;\r\n    this._driftStart = now();\r\n\r\n    var step = function (t) {\r\n      if (self._destroyed || !self._eyeTarget) { self._driftRaf = 0; return; }\r\n      var idleFor = now() - self._lastMoveAt;\r\n      if (!self._pointer || idleFor > IDLE_DRIFT_AFTER_MS) {\r\n        var s = (now() - self._driftStart) / 1000;\r\n        var ax = Math.sin(s * 0.62) * 0.55 + Math.sin(s * 0.23 + 1.1) * 0.3;\r\n        var ay = Math.sin(s * 0.41 + 2.0) * 0.34;\r\n        self._setGaze(ax * GAZE_MAX_X, ay * GAZE_MAX_Y);\r\n      }\r\n      self._driftRaf = raf(step);\r\n    };\r\n    this._driftRaf = raf(step);\r\n  };\r\n\r\n  /* --------------------------- hover ----------------------------------- */\r\n\r\n  Controller.prototype.attachHover = function (el) {\r\n    if (this._destroyed) return this;\r\n    this.detachHover();\r\n    var self = this;\r\n    this._hoverEl = el || this.host;\r\n\r\n    this._onEnter = function () { self.el.classList.add('is-hover'); };\r\n    this._onLeave = function () { self.el.classList.remove('is-hover'); };\r\n\r\n    this._hoverEl.addEventListener('pointerenter', this._onEnter);\r\n    this._hoverEl.addEventListener('mouseenter', this._onEnter);\r\n    this._hoverEl.addEventListener('pointerleave', this._onLeave);\r\n    this._hoverEl.addEventListener('mouseleave', this._onLeave);\r\n    return this;\r\n  };\r\n\r\n  Controller.prototype.detachHover = function () {\r\n    if (this._hoverEl) {\r\n      this._hoverEl.removeEventListener('pointerenter', this._onEnter);\r\n      this._hoverEl.removeEventListener('mouseenter', this._onEnter);\r\n      this._hoverEl.removeEventListener('pointerleave', this._onLeave);\r\n      this._hoverEl.removeEventListener('mouseleave', this._onLeave);\r\n    }\r\n    this._hoverEl = null;\r\n    if (this.el) this.el.classList.remove('is-hover');\r\n    return this;\r\n  };\r\n\r\n  /* --------------------------- blinking -------------------------------- */\r\n\r\n  /* CSS handles `idle`; JS covers the other eyes-open states so the cat keeps\r\n     blinking while it listens / thinks / works / talks. */\r\n  Controller.prototype._scheduleBlink = function () {\r\n    var self = this;\r\n    if (this._blinkTimer) { global.clearTimeout(this._blinkTimer); this._blinkTimer = null; }\r\n    if (this._destroyed) return;\r\n    if (EYES_SHUT[this.state] || CSS_BLINKS[this.state]) return;\r\n\r\n    var gap = 2600 + Math.random() * 3200;\r\n    this._blinkTimer = global.setTimeout(function () {\r\n      self._blinkTimer = null;\r\n      if (self._destroyed || EYES_SHUT[self.state] || CSS_BLINKS[self.state]) return;\r\n      var el = self.el;\r\n      el.classList.remove('is-blink');\r\n      void el.getBoundingClientRect();\r\n      el.classList.add('is-blink');\r\n      global.setTimeout(function () {\r\n        if (!self._destroyed) el.classList.remove('is-blink');\r\n      }, 170);\r\n      self._scheduleBlink();\r\n    }, gap);\r\n  };\r\n\r\n  /* --------------------------- misc ------------------------------------ */\r\n\r\n  Controller.prototype.freeze = function (on) {\r\n    this.el.classList.toggle('no-anim', on !== false);\r\n    return this;\r\n  };\r\n\r\n  Controller.prototype.destroy = function () {\r\n    this._destroyed = true;\r\n    this.detachEyeTracking();\r\n    this.detachHover();\r\n    if (this._blinkTimer) global.clearTimeout(this._blinkTimer);\r\n    if (this._pokeTimer) global.clearTimeout(this._pokeTimer);\r\n    this._blinkTimer = this._pokeTimer = null;\r\n    var i = instances.indexOf(this);\r\n    if (i !== -1) instances.splice(i, 1);\r\n    return this;\r\n  };\r\n\r\n  /* ---------------------------------------------------------------------- */\r\n  /* public surface                                                         */\r\n  /* ---------------------------------------------------------------------- */\r\n\r\n  var PuddingCat = {\r\n    version: '1.0.0',\r\n    STATES: STATES.slice(),\r\n    POKE_MS: POKE_MS,\r\n\r\n    create: function (host, options) {\r\n      var el = resolveHost(host);\r\n      if (!el) throw new Error('PuddingCat: host element not found');\r\n      return new Controller(el, options);\r\n    },\r\n\r\n    svg: function () { return CAT_SVG; },\r\n\r\n    /* every live controller */\r\n    all: function () { return instances.slice(); },\r\n\r\n    /* convenience: setState on every mounted instance */\r\n    setState: function (name) {\r\n      instances.forEach(function (c) { c.setState(name); });\r\n      return PuddingCat;\r\n    },\r\n\r\n    /* Auto-mount: [data-pudding-cat]. Optional data-eye-tracking / data-hover\r\n       / data-state / data-scale attributes configure the instance. */\r\n    autoMount: function (root) {\r\n      var scope = root || document;\r\n      var nodes = scope.querySelectorAll('[data-pudding-cat]');\r\n      var out = [];\r\n      for (var i = 0; i < nodes.length; i++) {\r\n        var n = nodes[i];\r\n        if (n.__puddingCat) { out.push(n.__puddingCat); continue; }\r\n        var opts = {};\r\n        if (n.hasAttribute('data-eye-tracking')) {\r\n          opts.eyeTracking = n.getAttribute('data-eye-tracking') || true;\r\n        }\r\n        if (n.hasAttribute('data-hover')) opts.hover = true;\r\n        if (n.hasAttribute('data-scale')) opts.scale = n.getAttribute('data-scale');\r\n        if (n.hasAttribute('data-freeze')) opts.freeze = true;\r\n        var c = PuddingCat.create(n, opts);\r\n        var st = n.getAttribute('data-state');\r\n        if (st) c.setState(st);\r\n        n.__puddingCat = c;\r\n        out.push(c);\r\n      }\r\n      return out;\r\n    }\r\n  };\r\n\r\n  global.PuddingCat = PuddingCat;\r\n\r\n  if (typeof document !== 'undefined') {\r\n    if (document.readyState === 'loading') {\r\n      document.addEventListener('DOMContentLoaded', function () { PuddingCat.autoMount(); });\r\n    } else {\r\n      PuddingCat.autoMount();\r\n    }\r\n  }\r\n\r\n  /* CommonJS / AMD interop so the file can also be consumed by a bundler. */\r\n  if (typeof module !== 'undefined' && module.exports) module.exports = PuddingCat;\r\n  if (typeof define === 'function' && define.amd) define(function () { return PuddingCat; });\r\n\r\n})(typeof window !== 'undefined' ? window : this);\r\n";
    var PUDDING_ARTWORK_CSS = "/* =============================================================================\n   布丁 / Pudding — DSH desktop-pet cat · state animation stylesheet\n   -----------------------------------------------------------------------------\n   Original work, dedicated to the public domain (CC0-1.0).\n   See LICENSE-ASSETS.md.  Not affiliated with Outfit7's \"Talking Tom\".\n\n   Contract\n   --------\n   The root <svg> carries `class=\"cat is-<state>\"`.  Exactly one `is-*` state\n   class is present at a time; `.is-hover` may be added on top of it.\n\n   Every state defines BOTH\n     (a) a static pose  (plain transform/opacity), and\n     (b) an animation layered on top that repeats (a) in its keyframes.\n   So `.cat.no-anim` — which force-disables animations — still renders the\n   characteristic pose of each state.  That is what makes screenshot\n   verification possible and is also a graceful degradation path.\n\n   All transform origins use `transform-box: view-box` with explicit user-unit\n   coordinates from the 200x200 viewBox, which is deterministic for SVG (unlike\n   `fill-box`, whose box depends on stroke/child geometry).\n   ========================================================================== */\n\n/* ---------- palette (override these to re-skin the cat) ------------------ */\n.cat {\n  --fur:        #FFE9C9;   /* cream body            */\n  --fur-light:  #FFF6E6;   /* chest / muzzle        */\n  --fur-patch:  #E8A85C;   /* caramel cap, ears, tail */\n  --ink:        #4A342A;   /* outline / features    */\n  --iris:       #3E7C8F;   /* teal-blue iris        */\n  --pupil:      #241A16;\n  --accent:     #4FB6A6;   /* mint scarf            */\n  --accent-dk:  #3E9C8D;\n  --blush:      #F79A86;\n  --nose:       #F2907E;\n  --mouth:      #7A3B36;\n  --tongue:     #F2907E;\n  --gold:       #F2C14E;\n  --tear:       #7FC8E8;\n\n  /* driven by JS (cat.js) — mouse gaze, normalised then scaled to px */\n  --gaze-x: 0px;\n  --gaze-y: 0px;\n  /* driven by state rules below */\n  --gaze-state-x: 0px;\n  --gaze-state-y: 0px;\n  /* driven by setTalkRate() */\n  --talk-duration: 230ms;\n\n  display: block;\n  width: 100%;\n  height: auto;\n  overflow: visible;\n}\n\n/* ---------- shared transform plumbing ----------------------------------- */\n.cat .stage,\n.cat .head,\n.cat .tail,\n.cat .ear,\n.cat .leg,\n.cat .jaw,\n.cat .lid,\n.cat .iris,\n.cat .pupil,\n.cat .shadow,\n.cat .gaze-state,\n.cat .gaze-track,\n.cat .zzz .z,\n.cat .sparkle,\n.cat .dot,\n.cat .surprise,\n.cat .tear,\n.cat .work-marks {\n  transform-box: view-box;\n}\n\n.cat .stage       { transform-origin: 100px 188px; }\n.cat .head        { transform-origin: 100px 114px; }\n.cat .tail        { transform-origin: 130px 178px; }\n.cat .ear-l       { transform-origin: 56px 56px; }\n.cat .ear-r       { transform-origin: 144px 56px; }\n.cat .leg-l       { transform-origin: 80px 140px; }\n.cat .leg-r       { transform-origin: 120px 140px; }\n.cat .jaw         { transform-origin: 100px 101px; }\n.cat .eye-l .lid  { transform-origin: 79px 54px; }\n.cat .eye-r .lid  { transform-origin: 121px 54px; }\n.cat .eye-l .iris,\n.cat .eye-l .pupil { transform-origin: 79px 70px; }\n.cat .eye-r .iris,\n.cat .eye-r .pupil { transform-origin: 121px 70px; }\n.cat .shadow      { transform-origin: 100px 189px; }\n.cat .z1 { transform-origin: 158px 47px; }\n.cat .z2 { transform-origin: 167px 32px; }\n.cat .z3 { transform-origin: 174px 17px; }\n.cat .s1 { transform-origin: 40px 41px; }\n.cat .s2 { transform-origin: 162px 46.5px; }\n.cat .s3 { transform-origin: 152px 16.5px; }\n.cat .d1 { transform-origin: 142px 60px; }\n.cat .d2 { transform-origin: 153px 52px; }\n.cat .d3 { transform-origin: 166px 42px; }\n.cat .surprise { transform-origin: 46px 33px; }\n.cat .tear { transform-origin: 70px 97px; }\n\n/* gaze layers: state offset (inner) + mouse offset (outer) compose */\n.cat .gaze-state { transform: translate(var(--gaze-state-x), var(--gaze-state-y)); }\n.cat .gaze-track { transform: translate(var(--gaze-x), var(--gaze-y)); }\n\n/* ---------- default (idle) resting values -------------------------------- */\n.cat .lid      { transform: scaleY(0); }          /* 0 = open            */\n.cat .jaw      { transform: scaleY(0.2); }\n.cat .mouth    { opacity: 0; }\n.cat .mouth-closed { opacity: 1; }\n.cat .zzz,\n.cat .sparkles,\n.cat .dots,\n.cat .surprise,\n.cat .work-marks { opacity: 0; }\n.cat .tear     { opacity: 0; }\n.cat .lash     { opacity: 0; }\n.cat .brow     { opacity: 0; }\n\n/* =========================================================================\n   1. idle — breathing + tail sway + periodic blink\n   ========================================================================= */\n.cat.is-idle .stage {\n  transform: translateY(0) scale(1, 1);\n  animation: breathe 3.6s ease-in-out infinite;\n}\n@keyframes breathe {\n  0%, 100% { transform: translateY(0) scale(1, 1); }\n  50%      { transform: translateY(-2px) scale(1.012, 1.022); }\n}\n\n.cat.is-idle .tail { transform: rotate(0deg); animation: tailSway 3.2s ease-in-out infinite; }\n@keyframes tailSway {\n  0%, 100% { transform: rotate(0deg); }\n  50%      { transform: rotate(9deg); }\n}\n\n.cat.is-idle .shadow { animation: shadowBreathe 3.6s ease-in-out infinite; }\n@keyframes shadowBreathe {\n  0%, 100% { transform: scale(1); opacity: 0.13; }\n  50%      { transform: scale(0.965); opacity: 0.10; }\n}\n\n/* blink: lid drops for ~8% of a 4.4s cycle; lash fades in on the same clock */\n.cat.is-idle .lid       { animation: blink 4.4s linear infinite; }\n.cat.is-idle .lash-blink { animation: lashBlink 4.4s linear infinite; }\n@keyframes blink {\n  0%, 91%, 100% { transform: scaleY(0); }\n  93.5%, 95.5%  { transform: scaleY(1); }\n  98%           { transform: scaleY(0.12); }\n}\n@keyframes lashBlink {\n  0%, 91%, 100% { opacity: 0; }\n  93.5%, 95.5%  { opacity: 1; }\n  98%           { opacity: 0; }\n}\n\n/* JS-driven blink for every eyes-open state except `idle` (which blinks in\n   pure CSS so it keeps working without JS).  cat.js toggles `.is-blink`. */\n.cat.is-blink .lid       { transform: scaleY(1) !important; }\n.cat.is-blink .lash-blink { opacity: 1 !important; }\n\n/* =========================================================================\n   2. listen — ears up, pupils dilated, body leans toward the screen\n   ========================================================================= */\n.cat.is-listen .ear-l { transform: rotate(18deg) translateY(-3px); }\n.cat.is-listen .ear-r { transform: rotate(-18deg) translateY(-3px); }\n.cat.is-listen .stage {\n  transform: translateY(-4px) scale(1.04, 1.035);\n  animation: listenLean 2.4s ease-in-out infinite;\n}\n@keyframes listenLean {\n  0%, 100% { transform: translateY(-4px) scale(1.04, 1.035); }\n  50%      { transform: translateY(-6px) scale(1.05, 1.042); }\n}\n.cat.is-listen .head  { transform: translateY(-2px); }\n.cat.is-listen .iris,\n.cat.is-listen .pupil { transform: scale(1.15); }\n.cat.is-listen .brow  { opacity: 1; transform: translateY(-1.5px); }\n.cat.is-listen .mouth-closed { opacity: 0; }\n.cat.is-listen .mouth-flat   { opacity: 1; }\n.cat.is-listen .shadow { transform: scale(0.97); opacity: 0.11; }\n\n/* =========================================================================\n   3. think — head tilt + eyes rolled up + thought dots\n   ========================================================================= */\n.cat.is-think .head {\n  transform: rotate(-9deg) translateY(-1px);\n  animation: thinkTilt 3.4s ease-in-out infinite;\n}\n@keyframes thinkTilt {\n  0%, 100% { transform: rotate(-9deg) translateY(-1px); }\n  50%      { transform: rotate(-4deg) translateY(-1px); }\n}\n.cat.is-think .gaze-state { --gaze-state-x: 1.5px; --gaze-state-y: -3.5px; }\n.cat.is-think .mouth-closed { opacity: 0; }\n.cat.is-think .mouth-flat   { opacity: 1; }\n.cat.is-think .brow-l { opacity: 1; transform: translateY(-2px) rotate(-6deg); }\n.cat.is-think .dots   { opacity: 1; }\n.cat.is-think .dot    { animation: dotPulse 1.5s ease-in-out infinite; }\n.cat.is-think .d2     { animation-delay: 0.22s; }\n.cat.is-think .d3     { animation-delay: 0.44s; }\n@keyframes dotPulse {\n  0%, 100% { opacity: 0.25; transform: scale(0.75); }\n  50%      { opacity: 1;    transform: scale(1.18); }\n}\n.cat.is-think .tail { transform: rotate(-6deg); animation: tailThink 2.6s ease-in-out infinite; }\n@keyframes tailThink {\n  0%, 100% { transform: rotate(-6deg); }\n  50%      { transform: rotate(3deg); }\n}\n\n/* =========================================================================\n   4. work — front paws tap alternately, like typing\n   ========================================================================= */\n.cat.is-work .leg-l {\n  transform: translateY(-9px) rotate(-11deg);\n  animation: typeA 0.42s ease-in-out infinite;\n}\n.cat.is-work .leg-r {\n  transform: translateY(-9px) rotate(11deg);\n  animation: typeB 0.42s ease-in-out infinite;\n  animation-delay: 0.21s;\n}\n@keyframes typeA {\n  0%, 100% { transform: translateY(-2px) rotate(-2deg); }\n  50%      { transform: translateY(-12px) rotate(-14deg); }\n}\n@keyframes typeB {\n  0%, 100% { transform: translateY(-2px) rotate(2deg); }\n  50%      { transform: translateY(-12px) rotate(14deg); }\n}\n.cat.is-work .head { transform: rotate(-3deg) translateY(2px); }\n.cat.is-work .gaze-state { --gaze-state-y: 2.5px; }\n.cat.is-work .mouth-closed { opacity: 0; }\n.cat.is-work .mouth-flat   { opacity: 1; }\n.cat.is-work .brow-l { opacity: 1; transform: translateY(1.5px) rotate(5deg); }\n.cat.is-work .brow-r { opacity: 1; transform: translateY(1.5px) rotate(-5deg); }\n.cat.is-work .work-marks { opacity: 1; }\n.cat.is-work .wm { animation: wmPulse 0.42s ease-in-out infinite; }\n.cat.is-work .wm-r { animation-delay: 0.21s; }\n@keyframes wmPulse {\n  0%, 100% { opacity: 0.2; transform: translateY(2px); }\n  50%      { opacity: 1;   transform: translateY(-2px); }\n}\n.cat.is-work .tail { transform: rotate(4deg); animation: tailWork 1.1s ease-in-out infinite; }\n@keyframes tailWork {\n  0%, 100% { transform: rotate(2deg); }\n  50%      { transform: rotate(9deg); }\n}\n\n/* =========================================================================\n   5. waiting — left paw raised and waving, ears up, looking at you\n   ========================================================================= */\n.cat.is-waiting .leg-l {\n  transform: translateY(-6px) rotate(-72deg);\n  animation: pawWave 1.15s ease-in-out infinite;\n}\n@keyframes pawWave {\n  0%, 100% { transform: translateY(-6px) rotate(-72deg); }\n  50%      { transform: translateY(-6px) rotate(-58deg); }\n}\n.cat.is-waiting .leg-r { transform: translateY(-1px); }\n.cat.is-waiting .ear-l { transform: rotate(11deg); }\n.cat.is-waiting .ear-r { transform: rotate(-11deg); }\n.cat.is-waiting .head  {\n  transform: translateY(-2px) rotate(2deg);\n  animation: waitNod 1.6s ease-in-out infinite;\n}\n@keyframes waitNod {\n  0%, 100% { transform: translateY(-2px) rotate(2deg); }\n  50%      { transform: translateY(-4px) rotate(0.5deg); }\n}\n.cat.is-waiting .iris,\n.cat.is-waiting .pupil { transform: scale(1.1); }\n.cat.is-waiting .brow  { opacity: 1; transform: translateY(-2px); }\n.cat.is-waiting .mouth-closed { opacity: 0; }\n.cat.is-waiting .mouth-smile  { opacity: 1; }\n.cat.is-waiting .blush { opacity: 0.5; }\n\n/* =========================================================================\n   6. talk — jaw flaps; speed follows --talk-duration (set by cat.js)\n   ========================================================================= */\n.cat.is-talk .mouth-closed { opacity: 0; }\n.cat.is-talk .mouth-open   { opacity: 1; }\n.cat.is-talk .ear-l { transform: rotate(6deg); }\n.cat.is-talk .ear-r { transform: rotate(-6deg); }\n.cat.is-talk .jaw {\n  transform: scaleY(0.85);\n  animation: jawTalk var(--talk-duration) ease-in-out infinite;\n}\n@keyframes jawTalk {\n  0%, 100% { transform: scaleY(0.28); }\n  50%      { transform: scaleY(1); }\n}\n.cat.is-talk .head {\n  transform: translateY(0);\n  animation: talkBob 0.9s ease-in-out infinite;\n}\n@keyframes talkBob {\n  0%, 100% { transform: translateY(0) rotate(0deg); }\n  50%      { transform: translateY(-1.5px) rotate(-1.2deg); }\n}\n.cat.is-talk .tail { animation: tailSway 1.6s ease-in-out infinite; }\n\n/* =========================================================================\n   7. happy — eyes squeezed shut, big smile, fast tail, bouncing, sparkles\n   ========================================================================= */\n.cat.is-happy .lid        { transform: scaleY(1); }\n.cat.is-happy .lash-happy { opacity: 1; }\n.cat.is-happy .iris,\n.cat.is-happy .pupil,\n.cat.is-happy .glint,\n.cat.is-happy .glint2     { opacity: 0; }\n.cat.is-happy .mouth-closed { opacity: 0; }\n.cat.is-happy .mouth-smile  { opacity: 1; }\n.cat.is-happy .blush        { opacity: 0.62; }\n.cat.is-happy .brow-l       { opacity: 1; transform: translateY(-2px) rotate(-8deg); }\n.cat.is-happy .brow-r       { opacity: 1; transform: translateY(-2px) rotate(8deg); }\n.cat.is-happy .ear-l        { transform: rotate(10deg); }\n.cat.is-happy .ear-r        { transform: rotate(-10deg); }\n.cat.is-happy .stage {\n  animation: happyBounce 0.62s ease-in-out infinite;\n}\n@keyframes happyBounce {\n  0%, 100% { transform: translateY(0) scale(1, 1); }\n  30%      { transform: translateY(-9px) scale(0.985, 1.035); }\n  55%      { transform: translateY(0) scale(1.025, 0.975); }\n  78%      { transform: translateY(-4px) scale(0.992, 1.018); }\n}\n.cat.is-happy .tail { animation: tailHappy 0.34s ease-in-out infinite; }\n@keyframes tailHappy {\n  0%, 100% { transform: rotate(-8deg); }\n  50%      { transform: rotate(16deg); }\n}\n.cat.is-happy .shadow { animation: shadowHappy 0.62s ease-in-out infinite; }\n@keyframes shadowHappy {\n  0%, 55%, 100% { transform: scale(1);    opacity: 0.13; }\n  30%, 78%      { transform: scale(0.86); opacity: 0.08; }\n}\n.cat.is-happy .sparkles { opacity: 1; }\n.cat.is-happy .sparkle  { animation: sparklePop 1.15s ease-in-out infinite; }\n.cat.is-happy .s2       { animation-delay: 0.24s; }\n.cat.is-happy .s3       { animation-delay: 0.48s; }\n@keyframes sparklePop {\n  0%, 100% { opacity: 0; transform: scale(0.35) rotate(0deg); }\n  50%      { opacity: 1; transform: scale(1.15) rotate(45deg); }\n}\n\n/* =========================================================================\n   8. sad — ears droop, gaze down, frown, a tear\n   ========================================================================= */\n.cat.is-sad .ear-l { transform: rotate(-19deg) translateY(4px); }\n.cat.is-sad .ear-r { transform: rotate(19deg)  translateY(4px); }\n.cat.is-sad .head  { transform: rotate(-4deg) translateY(3px); }\n.cat.is-sad .stage { transform: scale(0.985) translateY(1px); }\n.cat.is-sad .gaze-state { --gaze-state-y: 3.5px; }\n.cat.is-sad .iris,\n.cat.is-sad .pupil { transform: scale(0.93); }\n.cat.is-sad .brow-l { opacity: 1; transform: translateY(2px) rotate(9deg); }\n.cat.is-sad .brow-r { opacity: 1; transform: translateY(2px) rotate(-9deg); }\n.cat.is-sad .mouth-closed { opacity: 0; }\n.cat.is-sad .mouth-frown   { opacity: 1; }\n.cat.is-sad .blush        { opacity: 0.2; }\n.cat.is-sad .tear {\n  opacity: 1;\n  animation: tearDrop 3.2s ease-in infinite;\n}\n@keyframes tearDrop {\n  0%   { opacity: 0; transform: translateY(-3px) scale(0.55); }\n  22%  { opacity: 1; transform: translateY(0)    scale(1); }\n  78%  { opacity: 1; transform: translateY(7px)  scale(1); }\n  100% { opacity: 0; transform: translateY(12px) scale(0.85); }\n}\n.cat.is-sad .tail { transform: rotate(-13deg); animation: tailSad 4.2s ease-in-out infinite; }\n@keyframes tailSad {\n  0%, 100% { transform: rotate(-13deg); }\n  50%      { transform: rotate(-9deg); }\n}\n\n/* =========================================================================\n   9. sleep — eyes shut, slow deep breathing, snore bubbles\n   ========================================================================= */\n.cat.is-sleep .lid       { transform: scaleY(1); }\n.cat.is-sleep .lash-sleep { opacity: 1; }\n.cat.is-sleep .iris,\n.cat.is-sleep .pupil,\n.cat.is-sleep .glint,\n.cat.is-sleep .glint2    { opacity: 0; }\n.cat.is-sleep .mouth-closed { opacity: 0; }\n.cat.is-sleep .mouth-sleep  { opacity: 1; }\n.cat.is-sleep .head { transform: rotate(-5deg) translateY(4px); }\n.cat.is-sleep .ear-l { transform: rotate(-8deg) translateY(2px); }\n.cat.is-sleep .ear-r { transform: rotate(8deg)  translateY(2px); }\n.cat.is-sleep .blush { opacity: 0.24; }\n.cat.is-sleep .stage { animation: breatheSlow 5.4s ease-in-out infinite; }\n@keyframes breatheSlow {\n  0%, 100% { transform: translateY(0) scale(1, 1); }\n  50%      { transform: translateY(-1px) scale(1.022, 1.038); }\n}\n.cat.is-sleep .shadow { animation: shadowBreathe 5.4s ease-in-out infinite; }\n.cat.is-sleep .tail   { transform: rotate(-4deg); }\n.cat.is-sleep .zzz    { opacity: 1; }\n.cat.is-sleep .zzz .z { animation: zzzFloat 3.4s ease-in-out infinite; }\n.cat.is-sleep .z2     { animation-delay: 1.13s; }\n.cat.is-sleep .z3     { animation-delay: 2.26s; }\n@keyframes zzzFloat {\n  0%   { opacity: 0; transform: translateY(7px)  scale(0.75); }\n  22%  { opacity: 1; transform: translateY(0)    scale(1); }\n  75%  { opacity: 0.9; transform: translateY(-11px) scale(1.06); }\n  100% { opacity: 0; transform: translateY(-19px) scale(1.12); }\n}\n\n/* =========================================================================\n   10. poke — one-shot squash-and-rebound + startle\n   ========================================================================= */\n.cat.is-poke .stage {\n  animation: pokeSquash 0.62s cubic-bezier(0.22, 0.9, 0.3, 1) 1 both;\n}\n@keyframes pokeSquash {\n  0%   { transform: translateY(0) scale(1, 1); }\n  16%  { transform: translateY(5px) scale(1.15, 0.84); }\n  44%  { transform: translateY(-4px) scale(0.93, 1.09); }\n  68%  { transform: translateY(1px) scale(1.045, 0.965); }\n  100% { transform: translateY(0) scale(1, 1); }\n}\n.cat.is-poke .ear-l { transform: rotate(17deg) translateY(-3px); }\n.cat.is-poke .ear-r { transform: rotate(-17deg) translateY(-3px); }\n.cat.is-poke .iris,\n.cat.is-poke .pupil { transform: scale(1.22); }\n.cat.is-poke .brow  { opacity: 1; transform: translateY(-3px); }\n.cat.is-poke .mouth-closed { opacity: 0; }\n.cat.is-poke .mouth-open   { opacity: 1; }\n.cat.is-poke .jaw          { transform: scaleY(0.5); }\n.cat.is-poke .surprise {\n  opacity: 1;\n  animation: surprisePop 0.62s ease-out 1 both;\n}\n@keyframes surprisePop {\n  0%   { opacity: 0; transform: scale(0.3) rotate(-16deg); }\n  28%  { opacity: 1; transform: scale(1.2) rotate(6deg); }\n  62%  { opacity: 1; transform: scale(1) rotate(0deg); }\n  100% { opacity: 0; transform: scale(0.95) rotate(0deg); }\n}\n.cat.is-poke .tail { animation: tailPoke 0.62s ease-out 1 both; }\n@keyframes tailPoke {\n  0%   { transform: rotate(0deg); }\n  30%  { transform: rotate(-22deg); }\n  70%  { transform: rotate(12deg); }\n  100% { transform: rotate(0deg); }\n}\n.cat.is-poke .shadow { animation: shadowPoke 0.62s ease-out 1 both; }\n@keyframes shadowPoke {\n  0%, 100% { transform: scale(1); opacity: 0.13; }\n  16%      { transform: scale(1.06); opacity: 0.16; }\n  44%      { transform: scale(0.9);  opacity: 0.09; }\n}\n\n/* =========================================================================\n   HOVER reaction — ears perk + pupils dilate.  `.cat.is-hover` is set by\n   cat.js on the host element (larger hit area than the artwork); the plain\n   `:hover` selector keeps the pure-CSS path working too.\n   Specificity is deliberately one class higher than the state rules above\n   so it layers on top of any state; eye states that are meant to be shut\n   (sleep / happy) keep their eyes shut.\n   ========================================================================= */\n.cat.is-hover .ear-l,\n.cat:hover .ear-l { transform: rotate(15deg) translateY(-2px); }\n.cat.is-hover .ear-r,\n.cat:hover .ear-r { transform: rotate(-15deg) translateY(-2px); }\n.cat.is-hover:not(.is-sleep):not(.is-happy):not(.is-poke) .iris,\n.cat.is-hover:not(.is-sleep):not(.is-happy):not(.is-poke) .pupil,\n.cat:hover:not(.is-sleep):not(.is-happy):not(.is-poke) .iris,\n.cat:hover:not(.is-sleep):not(.is-happy):not(.is-poke) .pupil { transform: scale(1.14); }\n.cat.is-hover:not(.is-sleep):not(.is-happy) .brow,\n.cat:hover:not(.is-sleep):not(.is-happy) .brow { opacity: 1; }\n\n/* =========================================================================\n   Freeze / accessibility\n   ========================================================================= */\n.cat.no-anim,\n.cat.no-anim * { animation: none !important; }\n\n@media (prefers-reduced-motion: reduce) {\n  .cat, .cat * { animation: none !important; }\n  .cat .lid { transform: scaleY(0); }   /* never leave the eyes stuck shut */\n  .cat.is-sleep .lid,\n  .cat.is-happy .lid { transform: scaleY(1); }\n}\n";

    var artworkEvaluated = false;

    /** Evaluate the baked-in controller once, inside this bundle. */
    function ensureArtwork() {
      if (artworkEvaluated) return !!window.PuddingCat;
      artworkEvaluated = true;
      // Respect an artwork controller that is already present. This keeps the
      // visual layer replaceable (a test double, or another character shipped
      // separately) without editing this bundle.
      if (window.PuddingCat) return true;
      try {
        // The controller is an IIFE with no imports and no dependencies; running
        // it here keeps it inside the bundle rather than leaking into the page.
        new Function(PUDDING_ARTWORK_JS)();
      } catch (error) {
        try { console.warn('[pudding-pet] artwork failed to load:', error && error.message); } catch (ignored) {}
      }
      return !!window.PuddingCat;
    }

    /* ------------------------------------------------------------------ *
     * 1. Messages (own dictionary; the resolved language comes from DSH)
     * ------------------------------------------------------------------ */

    var MESSAGES = {
      zh: {
        'panel.title': '布丁桌宠',
        'panel.subtitle': '一只住在窗口里的猫',
        'panel.close': '关闭',
        'sec.voice': '朗读',
        'set.readReply': '朗读助手回复',
        'set.readInput': '朗读我发的话',
        'set.morph': '搞怪变声（升调）',
        'set.voiceName': '音色',
        'set.pitch': '变声强度（浏览器）',
        'set.rate': '语速',
        'set.volume': '音量',
        'sec.look': '外观',
        'set.size': '大小',
        'set.bubble': '显示字幕气泡',
        'set.motion': '轻微动作',
        'sec.behavior': '行为',
        'set.poke': '点击时做出反应',
        'btn.test': '试听',
        'btn.stop': '停止',
        'btn.reset': '重置位置',
        'btn.hide': '收起布丁',
        'btn.restore': '叫回布丁',
        'hint.pitchMax': '2.00 已是浏览器上限，想更强请用 Edge 引擎',
        'hint.noVoice': '本机没有中文语音，已回退',
        'hint.drag': '按住拖动 · 右键设置',
        'hint.needsClick': '先点一下页面，我才能出声哦',
        'sec.engine': '语音引擎',
        'set.engine': '引擎',
        'set.engineAuto': '自动（优先 Edge，失败回退）',
        'set.engineEdge': 'Edge TTS（音质好，变声强）',
        'set.engineBrowser': '浏览器（离线，变声上限 2.0）',
        'set.engineNote': 'Edge 走网络合成：音色自然，变声可超过浏览器上限；不可用时自动回退浏览器。',
        'sec.hostVoice': 'Edge 音色',
        'set.edgeVoice': '音色',
        'set.edgeVoiceDefault': '默认（晓伊 · 女声）',
        'set.edgePitch': '音高偏移',
        'set.morphSpeed': '额外加速',
        'hint.hostFallback': '额外加速会同时改变音高与时长（花栗鼠效果），这是突破服务端音高上限的方式。',
        'sec.browserVoice': '浏览器音色',
        'state.muted': '已静音',
        'state.talk': '正在念…',
        'bubble.hello': '你好呀，我是布丁。'
      },
      en: {
        'panel.title': 'Pudding Pet',
        'panel.subtitle': 'A little cat living in your window',
        'panel.close': 'Close',
        'sec.voice': 'Speech',
        'set.readReply': 'Read assistant replies',
        'set.readInput': 'Read my messages',
        'set.morph': 'Silly voice (raise pitch)',
        'set.voiceName': 'Voice',
        'set.pitch': 'Pitch (browser)',
        'set.rate': 'Rate',
        'set.volume': 'Volume',
        'sec.look': 'Appearance',
        'set.size': 'Size',
        'set.bubble': 'Caption bubble',
        'set.motion': 'Gentle motion',
        'sec.behavior': 'Behavior',
        'set.poke': 'React when clicked',
        'btn.test': 'Test',
        'btn.stop': 'Stop',
        'btn.reset': 'Reset position',
        'btn.hide': 'Tuck away',
        'btn.restore': 'Bring back',
        'hint.pitchMax': '2.00 is the browser ceiling; use the Edge engine for more',
        'hint.noVoice': 'No local voice; falling back',
        'hint.drag': 'Drag to move · right-click for settings',
        'hint.needsClick': 'Click the page once so I can speak',
        'sec.engine': 'Speech engine',
        'set.engine': 'Engine',
        'set.engineAuto': 'Auto (Edge first, then fall back)',
        'set.engineEdge': 'Edge TTS (better voice, stronger morph)',
        'set.engineBrowser': 'Browser (offline, pitch capped at 2.0)',
        'set.engineNote': 'Edge synthesizes over the network: natural voices and a morph beyond the browser ceiling. Falls back to the browser automatically.',
        'sec.hostVoice': 'Edge voice',
        'set.edgeVoice': 'Voice',
        'set.edgeVoiceDefault': 'Default (Xiaoyi · female)',
        'set.edgePitch': 'Pitch offset',
        'set.morphSpeed': 'Extra speed',
        'hint.hostFallback': 'Extra speed changes pitch and duration together (the chipmunk effect) — that is what pushes past the service pitch ceiling.',
        'sec.browserVoice': 'Browser voice',
        'state.muted': 'Muted',
        'state.talk': 'Reading…',
        'bubble.hello': "Hi there, I'm Pudding."
      }
    };

    function normalizeLanguage(value) {
      return typeof value === 'string' && /^zh(?:$|[-_])/i.test(value.trim()) ? 'zh' : 'en';
    }

    function makeTranslator(language) {
      var lang = normalizeLanguage(language);
      return function (key, values) {
        var table = MESSAGES[lang] || MESSAGES.en;
        var text = table[key] != null ? table[key] : (MESSAGES.en[key] != null ? MESSAGES.en[key] : key);
        if (values) {
          text = text.replace(/\{(\w+)\}/g, function (m, name) {
            return Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : m;
          });
        }
        return text;
      };
    }

    function readLanguage(ctx) {
      try {
        var snap = ctx.locale && ctx.locale.getSnapshot && ctx.locale.getSnapshot();
        return normalizeLanguage(snap && snap.active);
      } catch (error) {
        return 'en';
      }
    }

    function observeLanguage(ctx, onLanguage) {
      var previous;
      var publish = function () {
        var next = readLanguage(ctx);
        if (next !== previous) {
          previous = next;
          onLanguage(next);
        }
      };
      var unsubscribe = function () {};
      try {
        if (ctx.locale && typeof ctx.locale.subscribe === 'function') {
          unsubscribe = ctx.locale.subscribe(publish) || function () {};
        }
      } catch (error) { /* language is cosmetic; never fail the pet for it */ }
      publish();
      return function () {
        try { unsubscribe(); } catch (error) { /* already gone */ }
      };
    }

    /* ------------------------------------------------------------------ *
     * 2. Markdown cleaning — speak the listener's version, not the screen's
     * ------------------------------------------------------------------ */

    function cleanMarkdown(source) {
      var text = String(source == null ? '' : source);
      text = text.replace(/\r\n?/g, '\n');

      // Fenced code blocks are dropped entirely: reading code aloud is noise.
      text = text.replace(/```[\s\S]*?```/g, ' ');
      text = text.replace(/~~~[\s\S]*?~~~/g, ' ');
      // Inline code keeps its content.
      text = text.replace(/`([^`]+)`/g, '$1');
      // Images keep alt text; links keep only their label.
      text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
      text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
      // Bare URLs become a spoken word.
      text = text.replace(/https?:\/\/\S+/g, '链接');

      // Tables: drop separator rows, join cells with a comma.
      text = text.split('\n').map(function (line) {
        if (/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.indexOf('-') >= 0) return '';
        if (line.indexOf('|') >= 0) {
          var cells = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|')
            .map(function (cell) { return cell.trim(); })
            .filter(function (cell) { return cell.length > 0; });
          return cells.length ? cells.join('，') + '。' : '';
        }
        return line;
      }).join('\n');

      // Headings, quotes, list bullets, horizontal rules.
      text = text.replace(/^\s{0,3}#{1,6}\s*/gm, '');
      text = text.replace(/^\s{0,3}>\s?/gm, '');
      text = text.replace(/^\s{0,3}[-*+]\s+/gm, '');
      text = text.replace(/^\s{0,3}\d+[.)]\s+/gm, '');
      text = text.replace(/^\s{0,3}([-*_])\s*(\1\s*){2,}$/gm, '');
      // Emphasis markers.
      text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
      text = text.replace(/__([^_]+)__/g, '$1');
      text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2');
      text = text.replace(/(^|[^_])_([^_\n]+)_/g, '$1$2');
      text = text.replace(/~~([^~]+)~~/g, '$1');
      // Collapse whitespace.
      text = text.replace(/[ \t]+/g, ' ');
      text = text.replace(/\n{2,}/g, '\n');
      return text.replace(/^\s+|\s+$/g, '');
    }

    /**
     * Split cleaned text into speakable sentences as it streams in.
     * Returns the complete sentences plus whatever tail is still incomplete.
     */
    function takeSentences(buffer, force) {
      var out = [];
      var rest = String(buffer == null ? '' : buffer);
      // A sentence ends at CJK/latin terminal punctuation, optionally followed
      // by a closing quote or bracket.
      var re = /[^。！？!?；;\n]*[。！？!?；;]+[”’"'）)\]】]*/g;
      var match;
      var consumed = 0;
      while ((match = re.exec(rest)) !== null) {
        var piece = match[0].trim();
        if (piece) out.push(piece);
        consumed = match.index + match[0].length;
      }
      rest = rest.slice(consumed);
      if (force) {
        var tail = rest.trim();
        if (tail) out.push(tail);
        rest = '';
      }
      return { sentences: out, rest: rest };
    }

    /* ------------------------------------------------------------------ *
     * 3. Preferences
     * ------------------------------------------------------------------ */

    var STORAGE_KEY = 'dsh-pudding-pet:v1';

    var DEFAULTS = {
      readReply: true,     // speak assistant replies as they stream
      readInput: false,    // speak what the user sends
      // Which engine speaks. `edge` synthesizes on the host (Neural voices, a
      // real pitch parameter, and audio bytes we can shift further); `browser`
      // uses the Web Speech API; `auto` prefers the host and silently falls
      // back when it is unavailable.
      engine: 'auto',
      edgeVoice: '',       // empty = the host's default Neural voice
      edgePitch: 50,       // Hz offset sent to the service
      morphSpeed: 1.0,     // extra playback speed (chipmunk effect) on top
      morph: true,         // raise the pitch (browser engine)
      pitch: 2.0,          // the value chosen by the user
      rate: 1.05,
      volume: 1.0,
      voiceURI: '',        // empty = pick the best local Chinese voice
      size: 200,
      bubble: true,
      motion: true,
      poke: true,
      hidden: false,
      x: null,
      y: null
    };

    function clamp(value, low, high) {
      var n = Number(value);
      if (!Number.isFinite(n)) return low;
      return n < low ? low : (n > high ? high : n);
    }

    function cleanPreferences(raw) {
      var source = (raw && typeof raw === 'object') ? raw : {};
      var out = {};
      for (var key in DEFAULTS) {
        if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) continue;
        out[key] = DEFAULTS[key];
      }
      out.readReply = source.readReply !== false;
      out.readInput = source.readInput === true;
      out.engine = (source.engine === 'edge' || source.engine === 'browser' || source.engine === 'auto')
        ? source.engine
        : DEFAULTS.engine;
      out.edgeVoice = typeof source.edgeVoice === 'string' ? source.edgeVoice : '';
      out.edgePitch = clamp(source.edgePitch != null ? source.edgePitch : DEFAULTS.edgePitch, -100, 400);
      out.morphSpeed = clamp(source.morphSpeed != null ? source.morphSpeed : DEFAULTS.morphSpeed, 0.6, 1.6);
      out.morph = source.morph !== false;
      out.pitch = clamp(source.pitch != null ? source.pitch : DEFAULTS.pitch, 0.5, 2);
      out.rate = clamp(source.rate != null ? source.rate : DEFAULTS.rate, 0.5, 2);
      out.volume = clamp(source.volume != null ? source.volume : DEFAULTS.volume, 0, 1);
      out.voiceURI = typeof source.voiceURI === 'string' ? source.voiceURI : '';
      out.size = clamp(source.size != null ? source.size : DEFAULTS.size, 90, 420);
      out.bubble = source.bubble !== false;
      out.motion = source.motion !== false;
      out.poke = source.poke !== false;
      out.hidden = source.hidden === true;
      out.x = Number.isFinite(source.x) ? source.x : null;
      out.y = Number.isFinite(source.y) ? source.y : null;
      return out;
    }

    function safeParse(text) {
      try { return JSON.parse(text || 'null'); } catch (error) { return null; }
    }

    /* ------------------------------------------------------------------ *
     * 4. Speech engine (Web Speech API)
     * ------------------------------------------------------------------ */

    function createSpeech() {
      var synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
      var voices = [];
      var listeners = [];
      var current = null;

      function emit() {
        for (var i = 0; i < listeners.length; i++) {
          try { listeners[i](); } catch (error) { /* a listener cannot break speech */ }
        }
      }

      function refresh() {
        if (!synth) return;
        var next = [];
        try { next = synth.getVoices() || []; } catch (error) { next = []; }
        // Keep object identity stable when the list has not changed, so the
        // settings panel does not re-render on every poll.
        if (next.length === voices.length && next.every(function (v, i) { return v === voices[i]; })) return;
        voices = next;
        emit();
      }

      /** Prefer a local Chinese voice, then any Chinese voice, then anything. */
      function bestVoice(preferredURI) {
        if (!voices.length) return null;
        if (preferredURI) {
          var exact = voices.filter(function (v) { return (v.voiceURI || v.name) === preferredURI; })[0];
          if (exact) return exact;
        }
        var zh = voices.filter(function (v) { return /^zh/i.test(v.lang || ''); });
        var zhLocal = zh.filter(function (v) { return v.localService; });
        // Prefer the first local Chinese voice. On the user's machine the list
        // is Huihui / Kangkang / Yaoyao, and Huihui is the chosen default.
        return zhLocal[0] || zh[0] || voices[0] || null;
      }

      /**
       * Speech is gated by the browser's autoplay policy: speaking before any
       * user gesture fails with `not-allowed` and is otherwise silent, which
       * looks exactly like "the pet renders but never talks". A short utterance
       * inside the first gesture unlocks the channel for the rest of the page's
       * life. We also track whether that has happened so the UI can explain the
       * silence instead of just doing nothing.
       */
      var unlocked = false;
      var lastError = null;

      function unlock() {
        if (!synth || unlocked) return;
        try {
          var u = new SpeechSynthesisUtterance(' ');
          u.volume = 0;
          u.rate = 10;
          synth.speak(u);
          synth.cancel();
          unlocked = true;
        } catch (error) {
          // Not fatal: the first real utterance will retry the unlock path.
        }
      }

      function attachUnlock() {
        if (typeof document === 'undefined') return function () {};
        var handler = function () {
          unlock();
          // Keep listening until it actually succeeds once.
          if (unlocked) {
            document.removeEventListener('pointerdown', handler, true);
            document.removeEventListener('keydown', handler, true);
          }
        };
        try {
          document.addEventListener('pointerdown', handler, true);
          document.addEventListener('keydown', handler, true);
        } catch (error) { /* no document; nothing to unlock */ }
        return function () {
          try {
            document.removeEventListener('pointerdown', handler, true);
            document.removeEventListener('keydown', handler, true);
          } catch (error) { /* already gone */ }
        };
      }

      return {
        get available() { return !!synth; },
        get voices() { return voices; },
        get unlocked() { return unlocked; },
        get lastError() { return lastError; },
        refresh: refresh,
        unlock: unlock,
        attachUnlock: attachUnlock,
        onChange: function (fn) {
          listeners.push(fn);
          return function () {
            var i = listeners.indexOf(fn);
            if (i >= 0) listeners.splice(i, 1);
          };
        },
        bestVoice: bestVoice,
        get speaking() { return !!current; },
        speak: function (text, options, done) {
          if (!synth) { if (done) done(); return false; }
          var content = String(text == null ? '' : text).trim();
          if (!content) { if (done) done(); return false; }
          var utterance;
          try { utterance = new SpeechSynthesisUtterance(content); } catch (error) { if (done) done(); return false; }
          var voice = bestVoice(options && options.voiceURI);
          if (voice) {
            utterance.voice = voice;
            utterance.lang = voice.lang || 'zh-CN';
          }
          utterance.pitch = clamp(options && options.pitch != null ? options.pitch : 1, 0.5, 2);
          utterance.rate = clamp(options && options.rate != null ? options.rate : 1, 0.5, 2);
          utterance.volume = clamp(options && options.volume != null ? options.volume : 1, 0, 1);
          var settled = false;
          var finish = function (event) {
            if (settled) return;
            settled = true;
            if (current === utterance) current = null;
            // `not-allowed` means the autoplay policy blocked us. Record it so
            // the UI can say so, and try to unlock for next time.
            var reason = event && event.error;
            if (reason && reason !== 'interrupted' && reason !== 'canceled') {
              lastError = reason;
              if (reason === 'not-allowed') unlocked = false;
              try { console.warn('[pudding-pet] speech failed:', reason); } catch (ignored) {}
            }
            if (done) { try { done(); } catch (error) { /* ignore */ } }
          };
          utterance.onend = finish;
          utterance.onerror = finish;
          current = utterance;
          try { synth.speak(utterance); } catch (error) { finish(); return false; }
          return true;
        },
        cancel: function () {
          if (!synth) return;
          current = null;
          try { synth.cancel(); } catch (error) { /* nothing to cancel */ }
        }
      };
    }

    /* ------------------------------------------------------------------ *
     * 4b. Host speech engine (Edge TTS, through this bundle's own route)
     * ------------------------------------------------------------------ */

    /** Routes registered by the host half of this bundle. */
    var TTS_ROUTE = '/pudding-pet/tts';
    var VOICES_ROUTE = '/pudding-pet/voices';

    /** How long to stop asking the host after it reports the service is down. */
    var HOST_RETRY_MS = 60000;

    /**
     * Speak through the host route.
     *
     * The route returns an MP3, so the audio is ours to play and shape. That is
     * the whole point: the browser engine caps `pitch` at 2.0 and hides its
     * output, while a real audio buffer can be sped up as well, which shifts
     * pitch *and* shortens the phrase — the classic chipmunk effect.
     *
     * `speak` reports back through `done(handled)`: `handled === false` means
     * the caller should fall back to the browser engine. Failing loudly enough
     * to fall back matters more than any single utterance.
     */
    function createHostSpeech() {
      var currentAudio = null;
      var currentUrl = null;
      var aborter = null;
      var lastError = null;
      var downUntil = 0;
      var voices = [];
      var voiceListeners = [];

      function release() {
        if (currentUrl) {
          try { URL.revokeObjectURL(currentUrl); } catch (error) { /* already gone */ }
          currentUrl = null;
        }
        currentAudio = null;
      }

      function cancel() {
        if (aborter) {
          try { aborter.abort(); } catch (error) { /* already aborted */ }
          aborter = null;
        }
        if (currentAudio) {
          try { currentAudio.pause(); } catch (error) { /* not playing */ }
        }
        release();
      }

      function markDown(error) {
        lastError = String((error && error.message) || error || 'unavailable');
        downUntil = Date.now() + HOST_RETRY_MS;
      }

      function buildUrl(text, options) {
        var params = new URLSearchParams();
        params.set('text', text);
        if (options.voice) params.set('voice', options.voice);
        if (options.pitch) params.set('pitch', options.pitch);
        if (options.rate) params.set('rate', options.rate);
        if (options.volume) params.set('volume', options.volume);
        return TTS_ROUTE + '?' + params.toString();
      }

      return {
        /** Whether asking the host is worth attempting right now. */
        get ready() {
          if (typeof fetch !== 'function') return false;
          return Date.now() >= downUntil;
        },
        get lastError() { return lastError; },
        get voices() { return voices; },
        onChange: function (fn) {
          voiceListeners.push(fn);
          return function () {
            var i = voiceListeners.indexOf(fn);
            if (i >= 0) voiceListeners.splice(i, 1);
          };
        },

        /** Load the Neural voice list for the settings panel. */
        refreshVoices: function () {
          if (typeof fetch !== 'function') return Promise.resolve([]);
          return fetch(VOICES_ROUTE + '?locale=zh', { cache: 'no-store' })
            .then(function (response) {
              if (!response.ok) throw new Error('HTTP ' + response.status);
              return response.json();
            })
            .then(function (payload) {
              voices = (payload && payload.voices) || [];
              for (var i = 0; i < voiceListeners.length; i++) {
                try { voiceListeners[i](); } catch (error) { /* a listener cannot break this */ }
              }
              return voices;
            })
            .catch(function () { return voices; });
        },

        cancel: cancel,

        /** @param done - called with `true` when the host spoke, `false` to fall back. */
        speak: function (text, options, done) {
          var content = String(text == null ? '' : text).trim();
          if (!content || typeof fetch !== 'function' || !this.ready) {
            if (done) done(false);
            return false;
          }

          cancel();
          var finished = false;
          var settle = function (handled) {
            if (finished) return;
            finished = true;
            release();
            if (done) { try { done(handled); } catch (error) { /* ignore */ } }
          };

          aborter = typeof AbortController === 'function' ? new AbortController() : null;
          var url = buildUrl(content, options || {});

          fetch(url, aborter ? { signal: aborter.signal, cache: 'no-store' } : { cache: 'no-store' })
            .then(function (response) {
              if (response.status === 503) {
                // The service is unreachable; stop paying for it for a while.
                markDown(new Error('synthesis-unavailable'));
                settle(false);
                return null;
              }
              if (!response.ok) throw new Error('HTTP ' + response.status);
              return response.blob();
            })
            .then(function (blob) {
              if (!blob) return;
              if (!blob.size) throw new Error('empty audio');
              if (finished) return;

              var audio = new Audio();
              currentAudio = audio;
              currentUrl = URL.createObjectURL(blob);
              audio.src = currentUrl;

              // Extra morph: speed changes pitch too, so this is what pushes the
              // voice past anything the service's own `pitch` can reach.
              var speed = clamp(options && options.morphSpeed != null ? options.morphSpeed : 1, 0.6, 1.6);
              try {
                audio.playbackRate = speed;
                // Without this the browser compensates and the pitch never moves.
                audio.preservesPitch = false;
                audio.mozPreservesPitch = false;
                audio.webkitPreservesPitch = false;
              } catch (error) { /* older engine; speed stays 1 */ }
              try { audio.volume = clamp(options && options.volume != null ? options.volume : 1, 0, 1); } catch (error) { /* ignore */ }

              audio.onended = function () { settle(true); };
              audio.onerror = function () { settle(false); };

              var played = audio.play();
              if (played && typeof played.catch === 'function') {
                played.catch(function (error) {
                  // Autoplay policy, or the object URL is gone.
                  markDown(error);
                  settle(false);
                });
              }
            })
            .catch(function (error) {
              if (error && error.name === 'AbortError') { settle(false); return; }
              markDown(error);
              settle(false);
            });
          return true;
        }
      };
    }

    /* ------------------------------------------------------------------ *
     * 5. Visual adapter — swap the artwork here, not the behaviour
     * ------------------------------------------------------------------ */

    /**
     * The pet's visual sits behind this interface so a different character can
     * be dropped in later (a more realistic one, or the original sprite clips)
     * without touching speech, dragging, or preferences.
     *
     * Required methods: mount(host, options) -> { setState, poke, setScale, destroy }
     */
    var PuddingVisual = {
      id: 'pudding',
      label: '布丁 / Pudding',
      mount: function (host, options) {
        var Cat = ensureArtwork() ? window.PuddingCat : null;
        if (!Cat || typeof Cat.create !== 'function') {
          // Fail soft: show something readable rather than blanking the slot.
          var fallback = document.createElement('div');
          fallback.textContent = '🐱';
          fallback.style.cssText = 'font-size:64px;line-height:1;user-select:none';
          host.appendChild(fallback);
          return {
            setState: function () {}, poke: function () {},
            setScale: function () {}, setTalkRate: function () {},
            freeze: function () {}, destroy: function () { fallback.remove(); }
          };
        }
        var cat = Cat.create(host, {
          eyeTracking: options && options.eyeTracking,
          hover: options && options.hover !== false,
          scale: (options && options.scale) || 200,
          state: 'idle'
        });
        return {
          setState: function (name) { try { cat.setState(name); } catch (error) {} },
          poke: function () { try { cat.poke(); } catch (error) {} },
          setScale: function (px) { try { cat.setScale(px); } catch (error) {} },
          setTalkRate: function (ms) { try { cat.setTalkRate(ms); } catch (error) {} },
          freeze: function (on) { try { cat.freeze(!!on); } catch (error) {} },
          destroy: function () { try { cat.destroy(); } catch (error) {} }
        };
      }
    };

    /* ------------------------------------------------------------------ *
     * 6. Styles for the pet's own chrome (bubble, panel, restore button)
     * ------------------------------------------------------------------ */

    var CSS = [
      '.pudding-root{position:fixed;z-index:40;pointer-events:none;user-select:none;',
      '--pudding-ink:var(--dsw-alias-label-primary,#0f1115);',
      '--pudding-muted:var(--dsw-alias-label-secondary,#61666b);',
      '--pudding-line:var(--dsw-alias-border-l2,rgba(0,0,0,.14));',
      '--pudding-surface:var(--dsw-specific-menu,light-dark(rgba(248,249,250,.97),rgba(48,49,54,.97)));',
      '--pudding-hover:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));',
      'font-family:var(--dsw-font-family,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif);}',
      '.pudding-root *{box-sizing:border-box}',
      '.pudding-cat{position:relative;pointer-events:auto;cursor:grab;touch-action:none;',
      'filter:drop-shadow(0 8px 18px rgba(0,0,0,.22));transition:filter .18s}',
      '.pudding-cat:hover{filter:drop-shadow(0 10px 22px rgba(0,0,0,.3))}',
      '.pudding-cat.is-dragging{cursor:grabbing}',
      '.pudding-bubble{position:absolute;pointer-events:none;max-width:260px;min-width:54px;',
      'left:50%;transform:translate(-50%,-100%);top:-6px;padding:7px 11px;border-radius:11px;',
      'background:var(--pudding-surface);border:1px solid var(--pudding-line);color:var(--pudding-ink);',
      'font-size:12.5px;line-height:1.5;box-shadow:0 6px 18px rgba(0,0,0,.18);',
      'backdrop-filter:blur(12px) saturate(140%);word-break:break-word;white-space:pre-wrap}',
      '.pudding-bubble[hidden]{display:none}',
      '.pudding-bubble::after{content:"";position:absolute;left:50%;bottom:-6px;margin-left:-6px;',
      'width:11px;height:11px;background:var(--pudding-surface);border-right:1px solid var(--pudding-line);',
      'border-bottom:1px solid var(--pudding-line);transform:rotate(45deg)}',
      '.pudding-restore{position:fixed;z-index:40;pointer-events:auto;display:flex;align-items:center;',
      'justify-content:center;width:38px;height:38px;border-radius:50%;cursor:pointer;',
      'background:var(--pudding-surface);border:1px solid var(--pudding-line);font-size:19px;line-height:1;',
      'box-shadow:0 4px 14px rgba(0,0,0,.2);transition:transform .14s}',
      '.pudding-restore:hover{transform:scale(1.08)}',
      '.pudding-panel{position:fixed;z-index:41;pointer-events:auto;width:268px;padding:13px 14px 14px;',
      'border-radius:13px;background:var(--pudding-surface);border:1px solid var(--pudding-line);',
      'color:var(--pudding-ink);box-shadow:0 12px 34px rgba(0,0,0,.26);',
      'backdrop-filter:blur(20px) saturate(150%);font-size:12.5px}',
      '.pudding-panel h2{margin:0 0 1px;font-size:13.5px;font-weight:650;display:flex;',
      'align-items:center;justify-content:space-between;gap:8px}',
      '.pudding-panel .sub{color:var(--pudding-muted);font-size:11.5px;margin-bottom:11px}',
      '.pudding-panel h3{margin:12px 0 7px;font-size:11px;font-weight:650;letter-spacing:.05em;',
      'text-transform:uppercase;color:var(--pudding-muted)}',
      '.pudding-row{display:flex;align-items:center;gap:8px;margin-bottom:8px}',
      '.pudding-row>span{flex:none;min-width:74px;color:var(--pudding-muted)}',
      '.pudding-row input[type=range]{flex:1;min-width:0;accent-color:#4FB6A6}',
      '.pudding-row .num{flex:none;min-width:34px;text-align:right;font-variant-numeric:tabular-nums;',
      'color:#4FB6A6;font-weight:600}',
      '.pudding-row select{flex:1;min-width:0;background:transparent;color:inherit;',
      'border:1px solid var(--pudding-line);border-radius:7px;padding:4px 6px;font:inherit;font-size:12px}',
      '.pudding-check{display:flex;align-items:center;gap:8px;margin-bottom:7px;cursor:pointer}',
      '.pudding-check input{accent-color:#4FB6A6;margin:0;cursor:pointer}',
      '.pudding-btns{display:flex;flex-wrap:wrap;gap:6px;margin-top:11px}',
      '.pudding-btns button{flex:1 1 auto;background:var(--pudding-hover);color:inherit;',
      'border:1px solid var(--pudding-line);border-radius:7px;padding:6px 9px;font:inherit;',
      'font-size:12px;cursor:pointer;transition:background .12s}',
      '.pudding-btns button:hover{background:var(--dsw-alias-interactive-bg-active,rgba(38,49,72,.1))}',
      '.pudding-close{flex:none;width:22px;height:22px;border-radius:6px;border:1px solid transparent;',
      'background:transparent;color:var(--pudding-muted);cursor:pointer;font-size:15px;line-height:1;',
      'padding:0;display:flex;align-items:center;justify-content:center}',
      '.pudding-close:hover{background:var(--pudding-hover);color:var(--pudding-ink)}',
      '.pudding-hint{margin-top:9px;padding-top:9px;border-top:1px solid var(--pudding-line);',
      'color:var(--pudding-muted);font-size:11px;line-height:1.55}',
      '.pudding-warn{color:#e8a85c}',
      // Explanatory line under a control group; wraps rather than clipping.
      '.pudding-note{margin:2px 0 10px;color:var(--pudding-muted);font-size:11px;line-height:1.55}'
    ].join('');

    function injectStyle(doc, id, css) {
      if (doc.getElementById(id)) return function () {};
      var tag = doc.createElement('style');
      tag.id = id;
      tag.textContent = css;
      (doc.head || doc.documentElement).appendChild(tag);
      return function () { try { tag.remove(); } catch (error) {} };
    }

    /* ------------------------------------------------------------------ *
     * 7. The pet widget (plain DOM — the overlay slot hands us a plain node)
     * ------------------------------------------------------------------ */

    function PetWidget(host, options) {
      var doc = host.ownerDocument;
      var t = options.translate;
      var visual = options.visual;

      this.preferences = options.preferences;
      this.disposed = false;
      this.state = 'idle';
      this.translate = options.translate;
      // Store collaborators on the instance: prototype methods cannot see the
      // constructor's local variables.
      this.speech = options.speech;
      this.hostSpeech = options.hostSpeech || null;

      this.root = doc.createElement('div');
      this.root.className = 'pudding-root';
      this.root.setAttribute('data-pudding-pet', 'root');

      this.cat = doc.createElement('div');
      this.cat.className = 'pudding-cat';
      this.cat.setAttribute('role', 'img');
      this.cat.setAttribute('aria-label', t('panel.title'));
      this.root.appendChild(this.cat);

      this.bubble = doc.createElement('div');
      this.bubble.className = 'pudding-bubble';
      this.bubble.hidden = true;
      this.cat.appendChild(this.bubble);

      this.instance = visual.mount(this.cat, {
        eyeTracking: doc,
        hover: true,
        scale: this.preferences.size
      });

      this.restore = doc.createElement('div');
      this.restore.className = 'pudding-restore';
      this.restore.textContent = '🐱';
      this.restore.title = t('btn.restore');
      this.restore.setAttribute('role', 'button');
      this.restore.setAttribute('tabindex', '0');
      this.restore.hidden = true;

      this.panel = null;
      this.speechQueue = [];
      this.speaking = false;
      this.bubbleTimer = null;

      host.appendChild(this.root);
      host.appendChild(this.restore);

      this.bindDrag();
      this.bindInteractions();
      this.applyPreferences();

      this.onStorage = function (event) {
        if (event.key !== STORAGE_KEY) return;
        self.preferences = cleanPreferences(safeParse(event.newValue));
        self.applyPreferences();
      };
      window.addEventListener('storage', this.onStorage);

      this.onResize = function () {
        if (self.disposed) return;
        self.reposition();
      };
      window.addEventListener('resize', this.onResize);
    }

    PetWidget.prototype.bindDrag = function () {
      var self = this;
      var t = this.translate;
      var drag = null;

      var onDown = function (event) {
        if (event.button !== 0) return;
        drag = {
          startX: event.clientX,
          startY: event.clientY,
          originX: self.position ? self.position.x : 0,
          originY: self.position ? self.position.y : 0,
          moved: false
        };
        self.cat.classList.add('is-dragging');
        try { self.cat.setPointerCapture(event.pointerId); } catch (error) {}
      };

      var onMove = function (event) {
        if (!drag) return;
        var dx = event.clientX - drag.startX;
        var dy = event.clientY - drag.startY;
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (!drag.moved) return;
        self.setPosition(drag.originX + dx, drag.originY + dy);
        event.preventDefault();
      };

      var onUp = function (event) {
        if (!drag) return;
        var moved = drag.moved;
        drag = null;
        self.cat.classList.remove('is-dragging');
        try { self.cat.releasePointerCapture(event.pointerId); } catch (error) {}
        if (moved) {
          self.preferences.x = self.position.x;
          self.preferences.y = self.position.y;
          self.save();
        } else if (self.preferences.poke) {
          // A click that never moved is a pat on the head.
          self.instance.poke();
          self.say(t('bubble.hello'), 1400);
        }
      };

      this.cat.addEventListener('pointerdown', onDown);
      this.cat.addEventListener('pointermove', onMove);
      this.cat.addEventListener('pointerup', onUp);
      this.cat.addEventListener('pointercancel', onUp);
      this.cat.addEventListener('contextmenu', function (event) {
        event.preventDefault();
        event.stopPropagation();
        self.togglePanel();
      });
      this.cat.addEventListener('dragstart', function (event) { event.preventDefault(); });
    };

    PetWidget.prototype.bindInteractions = function () {
      var self = this;
      var t = this.translate;
      this.restore.addEventListener('click', function () {
        self.preferences.hidden = false;
        self.applyPreferences();
        self.save();
        self.say(t('bubble.hello'), 1600);
      });
      this.restore.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        self.preferences.hidden = false;
        self.applyPreferences();
        self.save();
      });
    };

    /** Speech is queue-based so replies never overlap or clip each other. */
    PetWidget.prototype.enqueue = function (text) {
      var cleaned = cleanMarkdown(text);
      if (!cleaned) return;
      var parts = cleaned.split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
      for (var i = 0; i < parts.length; i++) this.speechQueue.push(parts[i]);
      this.pump();
    };

    PetWidget.prototype.pump = function () {
      var self = this;
      if (this.disposed || this.speaking) return;
      var next = this.speechQueue.shift();
      if (next == null) {
        this.setState('idle');
        return;
      }
      this.speaking = true;
      this.setState('talk');
      this.say(next, Math.max(1400, next.length * 110));
      if (this.instance.setTalkRate) {
        this.instance.setTalkRate(Math.round(clamp(600 / clamp(this.preferences.rate, 0.5, 2), 180, 900)));
      }

      var finish = function () {
        if (self.disposed) return;
        self.speaking = false;
        // A short gap between sentences reads more naturally than a hard cut.
        setTimeout(function () { if (!self.disposed) self.pump(); }, 90);
      };

      /** The Web Speech API path: no audio bytes, so pitch is capped at 2.0. */
      var speakBrowser = function () {
        self.speech.speak(next, {
          voiceURI: self.preferences.voiceURI,
          pitch: self.preferences.morph ? self.preferences.pitch : 1,
          rate: self.preferences.rate,
          volume: self.preferences.volume
        }, function () {
          if (self.disposed) return;
          // Explain a blocked utterance once, rather than failing silently: the
          // browser refuses to speak until the page has seen a user gesture.
          var failure = self.speech.lastError;
          if (failure === 'not-allowed' && !self.warnedAboutGesture) {
            self.warnedAboutGesture = true;
            self.say(self.translate('hint.needsClick'), 5200);
          }
          finish();
        });
      };

      var engine = this.preferences.engine;
      var host = this.hostSpeech;
      var wantHost = engine !== 'browser' && host && host.ready;

      if (!wantHost) {
        speakBrowser();
        return;
      }

      // The host speaks a real audio buffer, so `morphSpeed` can push the voice
      // past anything the service's own pitch reaches.
      var handled = host.speak(next, {
        voice: this.preferences.edgeVoice,
        pitch: '+' + Math.round(this.preferences.edgePitch) + 'Hz',
        // The browser rate is a multiplier; the service wants a percentage offset.
        rate: (this.preferences.rate >= 1 ? '+' : '') + Math.round((this.preferences.rate - 1) * 100) + '%',
        volume: Math.round((this.preferences.volume - 1) * 100) + '%',
        morphSpeed: this.preferences.morph ? this.preferences.morphSpeed : 1
      }, function (spoken) {
        if (self.disposed) return;
        if (spoken) finish();
        else speakBrowser();
      });

      // A synchronous refusal (no fetch, or the host is in its retry cooldown)
      // still has to produce speech.
      if (!handled) speakBrowser();
    };

    PetWidget.prototype.stopSpeaking = function () {
      this.speechQueue.length = 0;
      this.speaking = false;
      this.speech.cancel();
      // Both engines must stop: the host one plays an Audio element, which the
      // Web Speech API's cancel() knows nothing about.
      if (this.hostSpeech) {
        try { this.hostSpeech.cancel(); } catch (error) { /* nothing playing */ }
      }
      this.setState('idle');
    };

    PetWidget.prototype.setState = function (name) {
      this.state = name;
      this.instance.setState(name);
    };

    PetWidget.prototype.say = function (text, ms) {
      if (!this.preferences.bubble) return;
      var self = this;
      this.bubble.textContent = String(text);
      this.bubble.hidden = false;
      if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
      this.bubbleTimer = setTimeout(function () {
        if (!self.disposed) self.bubble.hidden = true;
      }, ms || 2600);
    };

    PetWidget.prototype.setPosition = function (x, y) {
      var size = this.preferences.size;
      this.position = {
        x: clamp(x, 0, Math.max(0, window.innerWidth - size)),
        y: clamp(y, 0, Math.max(0, window.innerHeight - size))
      };
      this.root.style.left = this.position.x + 'px';
      this.root.style.top = this.position.y + 'px';
      if (this.panel) this.placePanel();
    };

    PetWidget.prototype.reposition = function () {
      var size = this.preferences.size;
      var x = this.preferences.x;
      var y = this.preferences.y;
      if (x == null || y == null) {
        // Default: bottom-right, clear of the composer.
        x = Math.max(16, window.innerWidth - size - 28);
        y = Math.max(16, window.innerHeight - size - 96);
      }
      this.setPosition(x, y);
      this.restore.style.left = Math.max(10, window.innerWidth - 56) + 'px';
      this.restore.style.top = Math.max(10, window.innerHeight - 150) + 'px';
    };

    PetWidget.prototype.applyPreferences = function () {
      var p = this.preferences;
      this.root.style.display = p.hidden ? 'none' : '';
      this.restore.hidden = !p.hidden;
      this.instance.setScale(p.size);
      this.instance.freeze(!p.motion);
      this.reposition();
      if (!p.bubble) this.bubble.hidden = true;
    };

    PetWidget.prototype.save = function () {
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.preferences)); } catch (error) {}
    };

    PetWidget.prototype.togglePanel = function () {
      if (this.panel) this.closePanel();
      else this.openPanel();
    };

    PetWidget.prototype.placePanel = function () {
      if (!this.panel) return;
      var rect = this.root.getBoundingClientRect();
      var width = 268;
      var left = clamp(rect.left + rect.width - width, 8, Math.max(8, window.innerWidth - width - 8));
      var panelHeight = this.panel.offsetHeight || 340;
      var top = rect.top - 8;
      var flipped = top - panelHeight < 8;
      if (flipped) top = Math.min(window.innerHeight - 8, rect.bottom + 8);
      this.panel.style.left = left + 'px';
      this.panel.style.top = top + 'px';
      this.panel.style.transform = flipped ? 'translateY(-100%)' : 'none';
    };

    PetWidget.prototype.openPanel = function () {
      var self = this;
      var p = this.preferences;
      var t = this.translate || function (k) { return k; };
      var doc = this.root.ownerDocument;

      var panel = doc.createElement('div');
      panel.className = 'pudding-panel';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', t('panel.title'));

      var head = doc.createElement('h2');
      var title = doc.createElement('span');
      title.textContent = t('panel.title');
      var close = doc.createElement('button');
      close.className = 'pudding-close';
      close.textContent = '×';
      close.title = t('panel.close');
      close.onclick = function () { self.closePanel(); };
      head.appendChild(title);
      head.appendChild(close);
      panel.appendChild(head);

      var sub = doc.createElement('div');
      sub.className = 'sub';
      sub.textContent = t('panel.subtitle');
      panel.appendChild(sub);

      var section = function (label) {
        var el = doc.createElement('h3');
        el.textContent = label;
        panel.appendChild(el);
      };

      var check = function (label, key, onChange) {
        var wrap = doc.createElement('label');
        wrap.className = 'pudding-check';
        var input = doc.createElement('input');
        input.type = 'checkbox';
        input.checked = !!p[key];
        input.onchange = function () {
          p[key] = input.checked;
          self.save();
          self.applyPreferences();
          if (onChange) onChange(input.checked);
        };
        var text = doc.createElement('span');
        text.textContent = label;
        wrap.appendChild(input);
        wrap.appendChild(text);
        panel.appendChild(wrap);
        return input;
      };

      var slider = function (label, key, min, max, step, format, onInput) {
        var row = doc.createElement('div');
        row.className = 'pudding-row';
        var name = doc.createElement('span');
        name.textContent = label;
        var input = doc.createElement('input');
        input.type = 'range';
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.value = String(p[key]);
        var num = doc.createElement('span');
        num.className = 'num';
        num.textContent = format(p[key]);
        input.oninput = function () {
          p[key] = clamp(input.value, min, max);
          num.textContent = format(p[key]);
          self.save();
          if (onInput) onInput(p[key]);
          else self.applyPreferences();
        };
        row.appendChild(name);
        row.appendChild(input);
        row.appendChild(num);
        panel.appendChild(row);
        return input;
      };

      /** A labelled <select> bound to one preference. */
      var selectRow = function (label, key, options, onReady) {
        var row = doc.createElement('div');
        row.className = 'pudding-row';
        var name = doc.createElement('span');
        name.textContent = label;
        var sel = doc.createElement('select');
        var fill = function (items, currentValue, labelOf) {
          while (sel.firstChild) sel.removeChild(sel.firstChild);
          items.forEach(function (item) {
            var opt = doc.createElement('option');
            opt.value = item.value;
            opt.textContent = labelOf(item);
            sel.appendChild(opt);
          });
          sel.value = currentValue;
        };
        fill(options, p[key], function (o) { return o.label; });
        sel.onchange = function () {
          p[key] = sel.value;
          self.save();
          self.applyPreferences();
        };
        row.appendChild(name);
        row.appendChild(sel);
        panel.appendChild(row);
        if (onReady) onReady({ select: sel, fill: fill, row: row, label: name });
        return sel;
      };

      // ---- Speech ----
      section(t('sec.voice'));
      check(t('set.readReply'), 'readReply');
      check(t('set.readInput'), 'readInput');
      check(t('set.morph'), 'morph');

      // ---- Which engine speaks ----
      section(t('sec.engine'));
      selectRow(t('set.engine'), 'engine', [
        { value: 'auto', label: t('set.engineAuto') },
        { value: 'edge', label: t('set.engineEdge') },
        { value: 'browser', label: t('set.engineBrowser') }
      ]);

      var engineNote = doc.createElement('div');
      engineNote.className = 'pudding-note';
      engineNote.textContent = t('set.engineNote');
      panel.appendChild(engineNote);

      // ---- Host (Edge TTS) ----
      section(t('sec.hostVoice'));
      selectRow(t('set.edgeVoice'), 'edgeVoice', [{ value: '', label: t('set.edgeVoiceDefault') }],
        function (handle) {
          var populate = function () {
            var list = (self.hostSpeech && self.hostSpeech.voices) || [];
            if (!list.length) return;
            handle.fill(
              [{ value: '', label: t('set.edgeVoiceDefault') }].concat(
                list.map(function (v) {
                  return { value: v.name, label: v.name + (v.gender ? ' · ' + v.gender : '') };
                })
              ),
              p.edgeVoice,
              function (o) { return o.label; }
            );
          };
          if (self.hostSpeech) {
            self.hostSpeech.refreshVoices().then(populate, populate);
          }
        });

      // Measured ceiling: the service stops honouring larger offsets. Beyond
      // ~+90Hz the payloads stop changing (and above that the mapping is not
      // even monotonic), so the slider stops where the effect still does.
      slider(t('set.edgePitch'), 'edgePitch', 0, 90, 5, function (v) {
        return '+' + Math.round(Number(v)) + 'Hz';
      });
      slider(t('set.morphSpeed'), 'morphSpeed', 0.6, 1.6, 0.02, function (v) {
        return Number(v).toFixed(2) + '×';
      });

      var hostNote = doc.createElement('div');
      hostNote.className = 'pudding-note';
      hostNote.textContent = t('hint.hostFallback');
      panel.appendChild(hostNote);

      // ---- Browser engine ----
      section(t('sec.browserVoice'));

      var voiceRow = doc.createElement('div');
      voiceRow.className = 'pudding-row';
      var voiceLabel = doc.createElement('span');
      voiceLabel.textContent = t('set.voiceName');
      var select = doc.createElement('select');
      var list = self.speech.voices;
      var zh = list.filter(function (v) { return /^zh/i.test(v.lang || ''); });
      var pool = zh.length ? zh : list;
      if (!pool.length) {
        var none = doc.createElement('option');
        none.textContent = t('hint.noVoice');
        none.value = '';
        select.appendChild(none);
      } else {
        pool.forEach(function (v) {
          var opt = doc.createElement('option');
          opt.value = v.voiceURI || v.name;
          opt.textContent = v.name + (v.localService ? ' · 离线' : '');
          select.appendChild(opt);
        });
        var current = self.speech.bestVoice(p.voiceURI);
        if (current) select.value = current.voiceURI || current.name;
      }
      select.onchange = function () {
        p.voiceURI = select.value;
        self.save();
      };
      voiceRow.appendChild(voiceLabel);
      voiceRow.appendChild(select);
      panel.appendChild(voiceRow);

      slider(t('set.pitch'), 'pitch', 0.5, 2, 0.05, function (v) { return Number(v).toFixed(2); });
      slider(t('set.rate'), 'rate', 0.5, 2, 0.05, function (v) { return Number(v).toFixed(2); });
      slider(t('set.volume'), 'volume', 0, 1, 0.05, function (v) { return Number(v).toFixed(2); });

      var buttons = doc.createElement('div');
      buttons.className = 'pudding-btns';
      var testBtn = doc.createElement('button');
      testBtn.textContent = t('btn.test');
      testBtn.onclick = function () {
        self.stopSpeaking();
        self.enqueue(t('bubble.hello') + ' 1 2 3 4 5。');
      };
      var stopBtn = doc.createElement('button');
      stopBtn.textContent = t('btn.stop');
      stopBtn.onclick = function () { self.stopSpeaking(); };
      buttons.appendChild(testBtn);
      buttons.appendChild(stopBtn);
      panel.appendChild(buttons);

      // ---- Appearance ----
      section(t('sec.look'));
      slider(t('set.size'), 'size', 90, 420, 5, function (v) { return String(Math.round(v)); });
      check(t('set.bubble'), 'bubble');
      check(t('set.motion'), 'motion');

      // ---- Behavior ----
      section(t('sec.behavior'));
      check(t('set.poke'), 'poke');

      var actions = doc.createElement('div');
      actions.className = 'pudding-btns';
      var resetBtn = doc.createElement('button');
      resetBtn.textContent = t('btn.reset');
      resetBtn.onclick = function () {
        p.x = null;
        p.y = null;
        self.save();
        self.reposition();
        self.placePanel();
      };
      var hideBtn = doc.createElement('button');
      hideBtn.textContent = t('btn.hide');
      hideBtn.onclick = function () {
        p.hidden = true;
        self.save();
        self.applyPreferences();
        self.closePanel();
      };
      actions.appendChild(resetBtn);
      actions.appendChild(hideBtn);
      panel.appendChild(actions);

      var hint = doc.createElement('div');
      hint.className = 'pudding-hint';
      hint.innerHTML = t('hint.drag') + '<br><span class="pudding-warn">' + t('hint.pitchMax') + '</span>';
      panel.appendChild(hint);

      doc.body.appendChild(panel);
      this.panel = panel;
      this.placePanel();

      // Close on outside click, but not on the pet itself (that toggles it).
      this.onOutside = function (event) {
        if (!self.panel) return;
        if (self.panel.contains(event.target)) return;
        if (self.cat.contains(event.target)) return;
        self.closePanel();
      };
      setTimeout(function () {
        if (!self.disposed) doc.addEventListener('pointerdown', self.onOutside, true);
      }, 0);
    };

    PetWidget.prototype.closePanel = function () {
      if (this.onOutside) {
        try { this.root.ownerDocument.removeEventListener('pointerdown', this.onOutside, true); } catch (error) {}
        this.onOutside = null;
      }
      if (this.panel) {
        try { this.panel.remove(); } catch (error) {}
        this.panel = null;
      }
    };

    PetWidget.prototype.setLanguage = function (language) {
      this.translate = makeTranslator(language);
    };

    PetWidget.prototype.dispose = function () {
      if (this.disposed) return;
      this.disposed = true;
      this.stopSpeaking();
      this.closePanel();
      if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
      window.removeEventListener('storage', this.onStorage);
      window.removeEventListener('resize', this.onResize);
      try { this.instance.destroy(); } catch (error) {}
      try { this.root.remove(); } catch (error) {}
      try { this.restore.remove(); } catch (error) {}
    };

    /* ------------------------------------------------------------------ *
     * 8. Assistant text bridge
     * ------------------------------------------------------------------ */

    /**
     * Watch the session event stream and hand new assistant text to `onText`.
     *
     * The event window is read through the client-side session controller. Only
     * assistant text is ever forwarded; reasoning, tool arguments, and
     * attachments are never spoken.
     */
    /**
     * Spoken text of one compact assistant stream.
     *
     * `assistant/message.stream` is an ARRAY of compact `AssistantStreamRecord`
     * entries, not a `{text}` object. The visible answer lives in
     * `text-chunks` records (`texts` joined) or in expanded `chunk` records of
     * type `text-delta`. Reasoning and tool-call records are never included.
     */
    function textsFromStream(stream) {
      if (!Array.isArray(stream)) return '';
      var parts = [];
      for (var i = 0; i < stream.length; i++) {
        var record = stream[i];
        if (!record || typeof record !== 'object') continue;
        if (record.type === 'text-chunks' && Array.isArray(record.texts)) {
          parts.push(record.texts.join(''));
        } else if (record.type === 'chunk' && record.chunk
          && record.chunk.type === 'text-delta' && typeof record.chunk.text === 'string') {
          parts.push(record.chunk.text);
        }
      }
      return parts.join('');
    }

    /**
     * Fallback for a settlement whose compact stream is absent: the message's
     * own text blocks. `AssistantMessage.content` is a block array, so the text
     * lives in blocks with `type === 'text'`.
     */
    function textFromMessage(message) {
      if (!message || !Array.isArray(message.content)) return '';
      var parts = [];
      for (var i = 0; i < message.content.length; i++) {
        var block = message.content[i];
        if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
      }
      return parts.join('\n');
    }

    /** The speakable text of one `assistant/message` event, or an empty string. */
    function messageTextOf(event) {
      if (!event || event.type !== 'assistant/message' || !event.data) return '';
      var fromStream = textsFromStream(event.data.stream);
      return fromStream.trim().length > 0 ? fromStream : textFromMessage(event.data.message);
    }

    /** The speakable text of one `user/message` event, or an empty string. */
    function userTextOf(event) {
      if (!event || event.type !== 'user/message' || !event.data) return '';
      var data = event.data;
      var fromStream = textsFromStream(data.stream);
      if (fromStream.trim().length > 0) return fromStream;
      var fromMessage = textFromMessage(data.message);
      if (fromMessage.trim().length > 0) return fromMessage;
      // `user/message` is itself a message-shaped payload in some paths.
      return textFromMessage(data);
    }

    function createTextBridge(ctx, onText, onUserText) {
      var disposed = false;
      var reference = null;
      var unsubscribe = null;
      var seen = -1;
      var pending = '';

      function emitFromEvent(event) {
        if (!event || typeof event.type !== 'string') return;
        var data = event.data || {};

        if (event.type === 'assistant/message') {
          var body = messageTextOf(event);
          if (!body) return;
          var tail = pending ? pending + '\n' + body : body;
          pending = '';
          onText(tail);
          return;
        }

        // Client-only live increment. `data.chunk` is a `StreamChunk`, whose
        // text discriminator is `text-delta`. This is what makes speech start
        // before the reply finishes rendering.
        if (event.type === 'assistant/live-chunk') {
          var chunk = data.chunk;
          if (!chunk || chunk.type !== 'text-delta' || typeof chunk.text !== 'string') return;
          pending += chunk.text;
          var split = takeSentences(pending, false);
          pending = split.rest;
          for (var i = 0; i < split.sentences.length; i++) onText(split.sentences[i]);
          return;
        }

        // Legacy/回放 format: only present when replaying an old session log.
        if (event.type === 'assistant/chunk') {
          var legacy = data.chunk;
          if (legacy && legacy.type === 'text-delta' && typeof legacy.text === 'string') {
            pending += legacy.text;
            var s2 = takeSentences(pending, false);
            pending = s2.rest;
            for (var j = 0; j < s2.sentences.length; j++) onText(s2.sentences[j]);
          }
          return;
        }

        if (event.type === 'user/message') {
          var userText = userTextOf(event);
          if (userText) onUserText(userText);
        }
      }

      function readWindow() {
        if (disposed || !reference) return;
        var session;
        try { session = reference.binding && reference.binding.session; } catch (error) { session = null; }
        var source = session && session.eventSource;
        if (!source || typeof source.getSnapshot !== 'function') return;

        var snapshot;
        try { snapshot = source.getSnapshot(); } catch (error) { return; }
        var entries = (snapshot && snapshot.entries) || [];
        for (var i = 0; i < entries.length; i++) {
          var item = entries[i];
          if (!item) continue;
          // `transient` entries are live-only rows; `event` entries are durable.
          if (item.type !== 'event' && item.type !== 'transient') continue;
          var event = item.event;
          if (!event || !Number.isFinite(event.seq)) continue;
          if (event.seq <= seen) continue;
          // Advance the watermark only after the event has been handled, so a
          // failure here does not silently discard the message forever.
          try {
            emitFromEvent(event);
          } catch (error) {
            try { console.warn('[pudding-pet] event handling failed:', error && error.message); } catch (ignored) {}
            return;
          }
          seen = event.seq;
        }
      }

      var retryTimer = null;
      var stopCatalog = null;

      function clearRetry() {
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      }

      /** Try again shortly: the service or the session may not exist yet. */
      function scheduleRetry() {
        if (disposed || retryTimer || reference) return;
        retryTimer = setTimeout(function () {
          retryTimer = null;
          attach();
        }, 1200);
      }

      /**
       * Bind to the session the main view is showing.
       *
       * The pet lives in `shell.overlay`, which does not hand out an
       * authoritative session id, so the target is discovered from the session
       * catalog. That catalog may be empty at mount time, so this must be
       * retried rather than attempted once: a one-shot attempt that gives up
       * silently would leave the pet mute forever.
       */
      function attach() {
        if (disposed || reference) return;

        var sessions = null;
        try { sessions = ctx.get ? ctx.get('sessions') : null; } catch (error) { sessions = null; }
        if (!sessions || typeof sessions.retain !== 'function') {
          // The session controller has not provided its service yet.
          scheduleRetry();
          return;
        }

        // Watch the catalog so a later-opened session can be picked up.
        if (!stopCatalog && sessions.list && typeof sessions.list.subscribe === 'function') {
          try {
            stopCatalog = sessions.list.subscribe(function () {
              if (!disposed && !reference) attach();
            });
          } catch (error) { stopCatalog = null; }
        }

        var catalog = null;
        try { catalog = sessions.list && sessions.list.getSnapshot && sessions.list.getSnapshot(); } catch (error) {}
        var target = null;
        if (catalog && catalog.byId) {
          var rows = catalog.byId;
          for (var id in rows) {
            var row = rows[id];
            if (row && row.retainedBy && row.retainedBy.mainView > 0) { target = id; break; }
          }
        }
        if (!target && catalog && catalog.current) target = catalog.current;
        if (!target) {
          scheduleRetry();
          return;
        }

        var ref = null;
        try {
          ref = sessions.retain(target, { source: 'puddingPet' });
        } catch (error) {
          ref = null;
        }
        if (!ref) {
          scheduleRetry();
          return;
        }
        reference = ref;

        var start = function () {
          if (disposed || reference !== ref) return;
          readWindow();
          var session = ref.binding && ref.binding.session;
          var source = session && session.eventSource;
          if (source && typeof source.subscribe === 'function') {
            try {
              unsubscribe = source.subscribe(function () { readWindow(); });
            } catch (error) { unsubscribe = null; }
          }
        };

        var fail = function () {
          // The session never opened (deleted, or the retain was superseded).
          if (reference !== ref) return;
          try { if (ref.release) ref.release(); } catch (error) {}
          reference = null;
          scheduleRetry();
        };

        if (ref.ready && typeof ref.ready.then === 'function') {
          ref.ready.then(start, fail);
        } else {
          start();
        }
      }

      attach();

      return {
        dispose: function () {
          if (disposed) return;
          disposed = true;
          clearRetry();
          try { if (stopCatalog) stopCatalog(); } catch (error) {}
          try { if (unsubscribe) unsubscribe(); } catch (error) {}
          try { if (reference && reference.release) reference.release(); } catch (error) {}
          stopCatalog = null;
          unsubscribe = null;
          reference = null;
        }
      };
    }

    /* ------------------------------------------------------------------ *
     * 9. Plugin entry
     * ------------------------------------------------------------------ */

    function createPetHost(ctx, translate) {
      var speech = createSpeech();
      var hostSpeech = createHostSpeech();
      var widget = null;
      var bridge = null;
      var language = 'zh';

      function loadPreferences() {
        var saved = null;
        try { saved = safeParse(window.localStorage.getItem(STORAGE_KEY)); } catch (error) {}
        return cleanPreferences(saved);
      }

      return {
        speech: speech,
        hostSpeech: hostSpeech,
        mount: function (container) {
          var prefs = loadPreferences();
          widget = new PetWidget(container, {
            translate: translate,
            speech: speech,
            hostSpeech: hostSpeech,
            visual: PuddingVisual,
            preferences: prefs
          });
          widget.setLanguage(language);
          widget.say(translate('bubble.hello'), 2600);

          bridge = createTextBridge(ctx, function (text) {
            if (!widget || !widget.preferences.readReply) return;
            widget.enqueue(text);
          }, function (text) {
            if (!widget || !widget.preferences.readInput) return;
            widget.enqueue(text);
          });
        },
        setLanguage: function (next) {
          language = normalizeLanguage(next);
          if (widget) widget.setLanguage(language);
        },
        dispose: function () {
          try { if (bridge) bridge.dispose(); } catch (error) {}
          try { if (widget) widget.dispose(); } catch (error) {}
          try { speech.cancel(); } catch (error) {}
          bridge = null;
          widget = null;
        }
      };
    }

    return {
      inject: ['slots', 'locale'],
      apply: function (ctx) {
        var translate = makeTranslator(readLanguage(ctx));
        var pet = createPetHost(ctx, translate);

        // Pet chrome first, then the artwork's own stylesheet.
        var chromeDispose = injectStyle(document, 'dsh-pudding-pet-chrome', CSS);
        var artworkCssDispose = injectStyle(document, 'dsh-pudding-pet-artwork', PUDDING_ARTWORK_CSS);

        // Browsers populate the voice list asynchronously; poll briefly.
        if (pet.speech.available) {
          pet.speech.refresh();
          try { window.speechSynthesis.addEventListener('voiceschanged', pet.speech.refresh); } catch (error) {}
          var tries = 0;
          var timer = setInterval(function () {
            tries += 1;
            pet.speech.refresh();
            if (tries > 20 || pet.speech.voices.length) clearInterval(timer);
          }, 300);
        }

        // Speech is blocked until the page sees a user gesture, so arm the
        // unlock listeners immediately rather than waiting for the first reply.
        var stopUnlock = pet.speech.attachUnlock();

        var stopLanguage = observeLanguage(ctx, function (next) {
          pet.setLanguage(next);
        });

        ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register({
            name: 'shell.overlay',
            id: 'pudding-pet',
            order: 95
          }, function PuddingOverlay() {
            var ref = React.useRef(null);
            React.useEffect(function () {
              var node = ref.current;
              if (!node) return undefined;
              pet.mount(node);
              return function () { pet.dispose(); };
            }, []);
            return h('div', { ref: ref, 'data-pudding-pet': 'slot' });
          });
        });

        ctx.effect(function () {
          return function () {
            try { stopUnlock(); } catch (error) {}
            try { stopLanguage(); } catch (error) {}
            try { artworkCssDispose(); } catch (error) {}
            try { chromeDispose(); } catch (error) {}
            try { pet.dispose(); } catch (error) {}
          };
        }, 'pudding-pet: teardown');
      }
    };
  }
});
