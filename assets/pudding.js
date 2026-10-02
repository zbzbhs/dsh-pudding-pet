/* =============================================================================
   布丁 / Pudding — DSH desktop-pet cat · zero-dependency browser controller
   -----------------------------------------------------------------------------
   Original work, dedicated to the public domain (CC0-1.0).
   See LICENSE-ASSETS.md.  Not affiliated with Outfit7's "Talking Tom".

   Plain browser JavaScript. No `import` / `export`, no bundler required, no
   runtime dependencies. Load with a plain <script> tag, or concatenate it into
   a DSH plugin client bundle — it only touches `window` / `document`.

   Quick start
   -----------
     <link rel="stylesheet" href="cat.css">
     <script src="cat.js"></script>
     <div id="pet"></div>
     <script>
       const cat = PuddingCat.create('#pet');
       cat.attachEyeTracking(document);   // pupils follow the mouse
       cat.attachHover();                 // ears perk on hover
       cat.setState('think');
       cat.poke();
     </script>

   Or declaratively — no JS needed at the call site:
     <div data-pudding-cat data-eye-tracking data-hover></div>

   API
   ---
     PuddingCat.create(host, [options]) -> Controller
     PuddingCat.mount(host, [options])  -> Controller   (alias)
     PuddingCat.svg()                   -> string       (inline SVG markup)
     PuddingCat.STATES                  -> string[]     (the 10 state names)

   Controller
     setState(name)                  switch state; unknown names are ignored
     getState()                      current state name
     poke([returnTo])                one-shot poke reaction, auto-restores state
     setTalkRate(ms|wpm)             mouth speed while talking
     attachEyeTracking(targetEl)     pupils follow the pointer over `targetEl`
     detachEyeTracking()
     attachHover(el)                 add `is-hover` on pointer enter/leave
     detachHover()
     freeze(bool)                    add/remove `.no-anim` (static pose render)
     destroy()                       remove listeners, drop the instance
     el                              the root <svg> element
     host                            the host element
   ========================================================================== */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------------- */
  /* Inlined artwork.                                                       */
  /* Source of truth: cat.svg — regenerate this constant with             */
  /*   python tools/inline-svg.py                                           */
  /* ---------------------------------------------------------------------- */
  var CAT_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 200 200\" class=\"cat is-idle\" role=\"img\" aria-label=\"布丁 (Pudding) — 原创卡通猫咪桌宠\" stroke-linejoin=\"round\" stroke-linecap=\"round\"><defs><clipPath id=\"catClipHead\"><ellipse cx=\"100\" cy=\"78\" rx=\"48\" ry=\"43\"/><\/clipPath><clipPath id=\"catClipEyeL\"><ellipse cx=\"79\" cy=\"70\" rx=\"15\" ry=\"15.5\"/><\/clipPath><clipPath id=\"catClipEyeR\"><ellipse cx=\"121\" cy=\"70\" rx=\"15\" ry=\"15.5\"/><\/clipPath><clipPath id=\"catClipMouth\"><ellipse cx=\"100\" cy=\"109\" rx=\"10.5\" ry=\"8.5\"/><\/clipPath><\/defs><g class=\"stage\" id=\"stage\"><ellipse class=\"shadow\" id=\"shadow\" cx=\"100\" cy=\"189\" rx=\"56\" ry=\"8\" fill=\"#2B1B14\" opacity=\"0.13\"/><g class=\"tail\" id=\"tail\"><path class=\"ink-stroke\" d=\"M 130 178 C 156 182 176 168 176 146 C 176 128 164 118 150 120\" fill=\"none\" stroke=\"#4A342A\" stroke-width=\"21\"/><path class=\"patch-stroke\" d=\"M 130 178 C 156 182 176 168 176 146 C 176 128 164 118 150 120\" fill=\"none\" stroke=\"#E8A85C\" stroke-width=\"15\"/><path class=\"fur-light-stroke\" d=\"M 172.02 130.21 C 167.36 122.47 159.1 118.7 150 120\" fill=\"none\" stroke=\"#FFF6E6\" stroke-width=\"15\"/><\/g><g class=\"body\" id=\"body\"><ellipse class=\"haunch fur\" cx=\"52\" cy=\"164\" rx=\"21\" ry=\"23\" fill=\"#FFE9C9\" stroke=\"#4A342A\" stroke-width=\"3\"/><ellipse class=\"haunch fur\" cx=\"148\" cy=\"164\" rx=\"21\" ry=\"23\" fill=\"#FFE9C9\" stroke=\"#4A342A\" stroke-width=\"3\"/><path class=\"torso fur\" d=\"M 100 104 C 126 104 144 128 146 156 C 148 178 132 188 100 188 C 68 188 52 178 54 156 C 56 128 74 104 100 104 Z\" fill=\"#FFE9C9\" stroke=\"#4A342A\" stroke-width=\"3\"/><path class=\"chest fur-light\" d=\"M 100 112 C 118 112 128 132 128 154 C 128 174 116 184 100 184 C 84 184 72 174 72 154 C 72 132 82 112 100 112 Z\" fill=\"#FFF6E6\"/><\/g><g class=\"scarf\" id=\"scarf\"><path class=\"scarf-band\" d=\"M 70 112 Q 100 128 130 112 Q 132 126 100 142 Q 68 126 70 112 Z\" fill=\"#4FB6A6\" stroke=\"#4A342A\" stroke-width=\"3\"/><ellipse class=\"scarf-knot\" cx=\"100\" cy=\"136\" rx=\"10\" ry=\"8\" fill=\"#3E9C8D\" stroke=\"#4A342A\" stroke-width=\"3\"/><\/g><g class=\"head\" id=\"head\"><g class=\"ear ear-l\" id=\"ear-left\"><path class=\"fur-patch\" d=\"M 94 38 L 54.95 11.38 Q 50 8 50.74 13.95 L 56 56 Z\" fill=\"#E8A85C\" stroke=\"#4A342A\" stroke-width=\"3\"/><path class=\"ear-inner\" d=\"M 56.67 18.4 L 83.07 36.4 L 60.27 47.2 Z\" fill=\"#F7B8AE\"/><\/g><g class=\"ear ear-r\" id=\"ear-right\"><path class=\"fur-patch\" d=\"M 106 38 L 145.05 11.38 Q 150 8 149.26 13.95 L 144 56 Z\" fill=\"#E8A85C\" stroke=\"#4A342A\" stroke-width=\"3\"/><path class=\"ear-inner\" d=\"M 143.33 18.4 L 116.93 36.4 L 139.73 47.2 Z\" fill=\"#F7B8AE\"/><\/g><ellipse class=\"head-shape fur\" cx=\"100\" cy=\"78\" rx=\"48\" ry=\"43\" fill=\"#FFE9C9\" stroke=\"#4A342A\" stroke-width=\"3\"/><path class=\"cap\" clip-path=\"url(#catClipHead)\" d=\"M 46 82 C 46 44 70 26 100 26 C 130 26 154 44 154 82 C 144 58 124 46 100 46 C 76 46 56 58 46 82 Z\" fill=\"#E8A85C\"/><path class=\"mark\" d=\"M 100 29 Q 102 35 108 37 Q 102 39 100 45 Q 98 39 92 37 Q 98 35 100 29 Z\" fill=\"#FFF6E6\"/><ellipse class=\"muzzle fur-light\" cx=\"100\" cy=\"104\" rx=\"27\" ry=\"16\" fill=\"#FFF6E6\"/><g class=\"eye eye-l\" id=\"eye-left\"><ellipse class=\"sclera\" cx=\"79\" cy=\"70\" rx=\"15\" ry=\"15.5\" fill=\"#FFFFFF\" stroke=\"#4A342A\" stroke-width=\"2.6\"/><g clip-path=\"url(#catClipEyeL)\"><g class=\"gaze-state\"><g class=\"gaze-track\"><circle class=\"iris\" cx=\"79\" cy=\"70\" r=\"10.5\" fill=\"#3E7C8F\"/><ellipse class=\"pupil\" cx=\"79\" cy=\"70\" rx=\"4.6\" ry=\"7.6\" fill=\"#241A16\"/><circle class=\"glint\" cx=\"75.2\" cy=\"66.4\" r=\"3.1\" fill=\"#FFFFFF\"/><circle class=\"glint2\" cx=\"82.6\" cy=\"75.4\" r=\"1.6\" fill=\"#FFFFFF\" opacity=\"0.7\"/><\/g><\/g><rect class=\"lid\" x=\"62\" y=\"52\" width=\"34\" height=\"36\" fill=\"#FFE9C9\"/><path class=\"lash lash-blink\" d=\"M 66 72 Q 79 77 92 72\" fill=\"none\" stroke=\"#4A342A\" stroke-width=\"2.8\" opacity=\"0\"/><path class=\"lash lash-happy\" d=\"M 66 76 Q 79 64 92 76\" fill=\"none\" stroke=\"#4A342A\" stroke-width=\"2.8\" opacity=\"0\"/><path class=\"lash lash-sleep\" d=\"M 66 68 Q 79 78 92 68\" fill=\"none\" stroke=\"#4A342A\" stroke-width=\"2.8\" opacity=\"0\"/><\/g><ellipse class=\"eye-rim\" cx=\"79\" cy=\"70\" rx=\"15\" ry=\"15.5\" fill=\"none\" stroke=\"#4A342A\" stroke-width=\"2.6\"/><\/g><g class=\"eye eye-r\" id=\"eye-right\"><ellipse class=\"sclera\" cx=\"121\" cy=\"70\" rx=\"15\" ry=\"15.5\" fill=\"#FFFFFF\" stroke=\"#4A342A\" stroke-width=\"2.6\"/><g clip-path=\"url(#catClipEyeR)\"><g class=\"gaze-state\"><g class=\"gaze-track\"><circle class=\"iris\" cx=\"121\" cy=\"70\" r=\"10.5\" fill=\"#3E7C8F\"/><ellipse class=\"pupil\" cx=\"121\" cy=\"70\" rx=\"4.6\" ry=\"7.6\" fill=\"#241A16\"/><circle class=\"glint\" cx=\"117.2\" cy=\"66.4\" r=\"3.1\" fill=\"#FFFFFF\"/><circle class=\"glint2\" cx=\"124.6\" cy=\"75.4\" r=\"1.6\" fill=\"#FFFFFF\" opacity=\"0.7\"/><\/g><\/g><rect class=\"lid\" x=\"104\" y=\"52\" width=\"34\" height=\"36\" fill=\"#FFE9C9\"/><path class=\"lash lash-blink\" d=\"M 108 72 Q 121 77 134 72\" fill=\"none\" stroke=\"#4A342A\" stroke-width=\"2.8\" opacity=\"0\"/><path class=\"lash lash-happy\" d=\"M 108 76 Q 121 64 134 76\" fill=\"none\" stroke=\"#4A342A\" stroke-width=\"2.8\" opacity=\"0\"/><path class=\"lash lash-sleep\" d=\"M 108 68 Q 121 78 134 68\" fill=\"none\" stroke=\"#4A342A\" stroke-width=\"2.8\" opacity=\"0\"/><\/g><ellipse class=\"eye-rim\" cx=\"121\" cy=\"70\" rx=\"15\" ry=\"15.5\" fill=\"none\" stroke=\"#4A342A\" stroke-width=\"2.6\"/><\/g><path class=\"brow brow-l\" d=\"M 68 52 Q 79 47 90 51\" fill=\"none\" stroke=\"#4A342A\" stroke-width=\"2.4\" opacity=\"0\"/><path class=\"brow brow-r\" d=\"M 110 51 Q 121 47 132 52\" fill=\"none\" stroke=\"#4A342A\" stroke-width=\"2.4\" opacity=\"0\"/><ellipse class=\"blush\" cx=\"66\" cy=\"94\" rx=\"10\" ry=\"6\" fill=\"#F79A86\" opacity=\"0.38\"/><ellipse class=\"blush\" cx=\"134\" cy=\"94\" rx=\"10\" ry=\"6\" fill=\"#F79A86\" opacity=\"0.38\"/><path class=\"nose\" d=\"M 93.5 92 L 106.5 92 Q 108.5 92 107.3 93.6 L 101.6 101 Q 100 103 98.4 101 L 92.7 93.6 Q 91.5 92 93.5 92 Z\" fill=\"#F2907E\"/><g class=\"mouth mouth-closed\" id=\"mouth-closed\" opacity=\"1\"><path d=\"M 100 102 L 100 105.5\" fill=\"none\" stroke=\"#4A342A\" stroke-width=\"2.6\"/><path d=\"M 100 105.5 C 100 111 95.8 113 91.5 109.8\" fill=\"none\" stroke=\"#4A342A\" stroke-width=\"2.6\"/><path d=\"M 100 105.5 C 100 111 104.2 113 108.5 109.8\" fill=\"none\" stroke=\"#4A342A\" stroke-width=\"2.6\"/><\/g><g class=\"mouth mouth-open\" id=\"mouth-open\" opacity=\"0\"><g class=\"jaw\"><g clip-path=\"url(#catClipMouth)\"><ellipse class=\"mouth-inner\" cx=\"100\" cy=\"109\" rx=\"10\" ry=\"7.5\" fill=\"#7A3B36\"/><ellipse class=\"tongue\" cx=\"100\" cy=\"114.5\" rx=\"6.5\" ry=\"4.5\" fill=\"#F2907E\"/><\/g><\/g><\/g><path class=\"mouth mouth-smile\" d=\"M 87 105 Q 100 117 113 105\" fill=\"none\" stroke=\"#4A342A\" stroke-width=\"3.2\" opacity=\"0\"/><path class=\"mouth mouth-frown\" d=\"M 91 112 Q 100 105 109 112\" fill=\"none\" stroke=\"#4A342A\" stroke-width=\"3.2\" opacity=\"0\"/><path class=\"mouth mouth-flat\" d=\"M 92 108 Q 100 111 108 108\" fill=\"none\" stroke=\"#4A342A\" stroke-width=\"3\" opacity=\"0\"/><ellipse class=\"mouth mouth-sleep\" cx=\"100\" cy=\"108\" rx=\"4.5\" ry=\"3.8\" fill=\"#7A3B36\" opacity=\"0\"/><path class=\"tear\" d=\"M 70 88 Q 77 97 77 101 Q 77 106 70 106 Q 63 106 63 101 Q 63 97 70 88 Z\" fill=\"#7FC8E8\" opacity=\"0\"/><\/g><g class=\"leg leg-l\" id=\"leg-left\"><rect class=\"fur\" x=\"70\" y=\"138\" width=\"20\" height=\"48\" rx=\"9\" fill=\"#FFE9C9\" stroke=\"#4A342A\" stroke-width=\"3\"/><path class=\"paw-line\" d=\"M 76 172 L 76 182 M 84 172 L 84 182\" fill=\"none\" stroke=\"#4A342A\" stroke-width=\"2\"/><\/g><g class=\"leg leg-r\" id=\"leg-right\"><rect class=\"fur\" x=\"110\" y=\"138\" width=\"20\" height=\"48\" rx=\"9\" fill=\"#FFE9C9\" stroke=\"#4A342A\" stroke-width=\"3\"/><path class=\"paw-line\" d=\"M 116 172 L 116 182 M 124 172 L 124 182\" fill=\"none\" stroke=\"#4A342A\" stroke-width=\"2\"/><\/g><g class=\"fx\" id=\"fx\"><g class=\"zzz\" id=\"zzz\" opacity=\"0\"><path class=\"z z1\" d=\"M 152 40 L 164 40 L 152 54 L 164 54\" fill=\"none\" stroke=\"#3E9C8D\" stroke-width=\"3.6\"/><path class=\"z z2\" d=\"M 162 26 L 172 26 L 162 38 L 172 38\" fill=\"none\" stroke=\"#3E9C8D\" stroke-width=\"3.2\"/><path class=\"z z3\" d=\"M 170 12 L 178 12 L 170 22 L 178 22\" fill=\"none\" stroke=\"#3E9C8D\" stroke-width=\"2.8\"/><\/g><g class=\"sparkles\" id=\"sparkles\" opacity=\"0\"><path class=\"sparkle s1\" d=\"M 40 33 Q 42 39 48 41 Q 42 43 40 49 Q 38 43 32 41 Q 38 39 40 33 Z\" fill=\"#F2C14E\"/><path class=\"sparkle s2\" d=\"M 162 40 Q 163.5 45 168 46.5 Q 163.5 48 162 53 Q 160.5 48 156 46.5 Q 160.5 45 162 40 Z\" fill=\"#F2C14E\"/><path class=\"sparkle s3\" d=\"M 152 10 Q 153.5 15 158 16.5 Q 153.5 18 152 23 Q 150.5 18 146 16.5 Q 150.5 15 152 10 Z\" fill=\"#F2C14E\"/><\/g><g class=\"dots\" id=\"dots\" opacity=\"0\"><circle class=\"dot d1\" cx=\"142\" cy=\"60\" r=\"2.6\" fill=\"#4FB6A6\"/><circle class=\"dot d2\" cx=\"153\" cy=\"52\" r=\"3.8\" fill=\"#4FB6A6\"/><circle class=\"dot d3\" cx=\"166\" cy=\"42\" r=\"5\" fill=\"#4FB6A6\"/><\/g><g class=\"surprise\" id=\"surprise\" opacity=\"0\"><path d=\"M 43 22 L 49 22 L 47 38 L 45 38 Z\" fill=\"#F2C14E\" stroke=\"#4A342A\" stroke-width=\"2\"/><circle cx=\"46\" cy=\"45\" r=\"2.8\" fill=\"#F2C14E\" stroke=\"#4A342A\" stroke-width=\"2\"/><\/g><g class=\"work-marks\" id=\"work-marks\" opacity=\"0\"><path class=\"wm wm-l\" d=\"M 58 158 Q 62 164 58 170\" fill=\"none\" stroke=\"#4FB6A6\" stroke-width=\"3\"/><path class=\"wm wm-r\" d=\"M 142 158 Q 138 164 142 170\" fill=\"none\" stroke=\"#4FB6A6\" stroke-width=\"3\"/><\/g><\/g><\/g><\/svg>";

  var STATES = [
    'idle', 'listen', 'think', 'work', 'waiting',
    'talk', 'happy', 'sad', 'sleep', 'poke'
  ];

  /* States where the eyes stay shut on purpose — never auto-blink these. */
  var EYES_SHUT = { happy: 1, sleep: 1 };
  /* Blink is driven by CSS for `idle` (so it still works with JS disabled). */
  var CSS_BLINKS = { idle: 1 };

  var POKE_MS = 620;
  var GAZE_MAX_X = 3.4;   // px of travel inside the 200x200 viewBox
  var GAZE_MAX_Y = 2.8;
  var IDLE_DRIFT_AFTER_MS = 3500;

  var instances = [];

  /* ---------------------------------------------------------------------- */
  /* helpers                                                                */
  /* ---------------------------------------------------------------------- */

  function resolveHost(host) {
    if (!host) return null;
    if (typeof host === 'string') return document.querySelector(host);
    if (host.nodeType === 1) return host;
    if (host.el && host.el.nodeType === 1) return host.el;
    return null;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function raf(fn) {
    if (typeof global.requestAnimationFrame === 'function') {
      return global.requestAnimationFrame(fn);
    }
    return global.setTimeout(fn, 16);
  }

  function now() {
    return (global.performance && global.performance.now)
      ? global.performance.now() : Date.now();
  }

  /* ---------------------------------------------------------------------- */
  /* Controller                                                             */
  /* ---------------------------------------------------------------------- */

  function Controller(host, options) {
    options = options || {};

    this.host = host;
    this.options = options;
    this.state = 'idle';
    this._prevState = 'idle';
    this._pokeTimer = null;
    this._pokeActive = false;
    this._blinkTimer = null;
    this._destroyed = false;

    /* eye tracking */
    this._eyeTarget = null;
    this._gazeRaf = 0;
    this._pointer = null;          // {x, y}
    this._lastMoveAt = 0;
    this._driftRaf = 0;
    this._driftStart = 0;

    /* hover */
    this._hoverEl = null;
    this._onEnter = null;
    this._onLeave = null;

    /* --- build DOM ----------------------------------------------------- */
    host.classList.add('pudding-cat-host');
    host.innerHTML = CAT_SVG;
    this.el = host.querySelector('svg.cat') || host.querySelector('svg');

    if (!this.el) throw new Error('PuddingCat: artwork failed to mount');
    if (this.el.parentNode !== host) host.appendChild(this.el);

    this.el.classList.remove('is-idle');
    this.el.classList.add('is-idle');

    if (options.scale) this.setScale(options.scale);
    if (options.talkRate) this.setTalkRate(options.talkRate);
    if (options.freeze) this.freeze(true);

    this._scheduleBlink();

    if (options.eyeTracking) this.attachEyeTracking(options.eyeTracking === true ? document : options.eyeTracking);
    if (options.hover) this.attachHover(options.hover === true ? host : options.hover);

    instances.push(this);
  }

  /* --------------------------- state machine --------------------------- */

  Controller.prototype.setState = function (name) {
    if (this._destroyed) return this;
    if (STATES.indexOf(name) === -1) {
      if (global.console && console.warn) {
        console.warn('[PuddingCat] unknown state: ' + name);
      }
      return this;
    }
    /* Poking is a one-shot; an explicit setState cancels its restore. */
    if (this._pokeTimer) { global.clearTimeout(this._pokeTimer); this._pokeTimer = null; }
    this._pokeActive = false;

    this._applyState(name);
    return this;
  };

  Controller.prototype._applyState = function (name) {
    var el = this.el;
    var i;
    for (i = 0; i < STATES.length; i++) el.classList.remove('is-' + STATES[i]);
    el.classList.add('is-' + name);
    el.classList.remove('is-blink');
    this.state = name;
    if (!EYES_SHUT[name]) this._scheduleBlink();
    this._syncDrift();
  };

  Controller.prototype.getState = function () { return this.state; };

  /* --------------------------- one-shot poke --------------------------- */

  Controller.prototype.poke = function (returnTo) {
    if (this._destroyed) return this;
    var self = this;
    var target = (typeof returnTo === 'string' && STATES.indexOf(returnTo) !== -1)
      ? returnTo
      : (this._pokeActive ? this._prevState : this.state);

    this._prevState = target;
    this._pokeActive = true;

    if (this._pokeTimer) { global.clearTimeout(this._pokeTimer); this._pokeTimer = null; }

    /* restart the CSS animation even on a rapid double-click */
    this.el.classList.remove('is-poke');
    void this.el.getBoundingClientRect();
    this._applyState('poke');
    this._pokeActive = true;

    this._pokeTimer = global.setTimeout(function () {
      self._pokeTimer = null;
      self._pokeActive = false;
      self._applyState(target);
    }, POKE_MS);

    return this;
  };

  /* --------------------------- talk speed ------------------------------ */

  /* Accepts a millisecond cycle length, or { wpm } for words-per-minute feel. */
  Controller.prototype.setTalkRate = function (v) {
    var ms;
    if (typeof v === 'number') {
      ms = v;
    } else if (v && typeof v === 'object' && typeof v.wpm === 'number') {
      ms = clamp(60000 / (v.wpm * 1.6), 90, 600);
    } else {
      return this;
    }
    this.el.style.setProperty('--talk-duration', clamp(ms, 70, 900) + 'ms');
    return this;
  };

  Controller.prototype.setScale = function (px) {
    if (typeof px === 'number') {
      this.host.style.width = px + 'px';
    } else if (typeof px === 'string') {
      this.host.style.width = px;
    }
    return this;
  };

  /* --------------------------- eye tracking ---------------------------- */

  Controller.prototype.attachEyeTracking = function (targetEl) {
    if (this._destroyed) return this;
    this.detachEyeTracking();
    var self = this;
    this._eyeTarget = targetEl || document;

    this._onPointerMove = function (ev) {
      self._pointer = { x: ev.clientX, y: ev.clientY };
      self._lastMoveAt = now();
      /* Leading-edge update: keeps latency at zero for the common case, and
         still works in environments where requestAnimationFrame is throttled
         (background tabs, headless screenshot runs).  The rAF pass below only
         coalesces bursts of moves. */
      self._applyGaze();
      if (!self._gazeRaf) {
        self._gazeRaf = raf(function () {
          self._gazeRaf = 0;
          self._applyGaze();
        });
      }
    };
    this._onPointerOut = function () {
      self._pointer = null;
      self._setGaze(0, 0);
    };

    this._eyeTarget.addEventListener('mousemove', this._onPointerMove, { passive: true });
    this._eyeTarget.addEventListener('pointermove', this._onPointerMove, { passive: true });
    this._eyeTarget.addEventListener('mouseleave', this._onPointerOut, { passive: true });

    this._syncDrift();
    return this;
  };

  Controller.prototype.detachEyeTracking = function () {
    if (this._eyeTarget) {
      this._eyeTarget.removeEventListener('mousemove', this._onPointerMove);
      this._eyeTarget.removeEventListener('pointermove', this._onPointerMove);
      this._eyeTarget.removeEventListener('mouseleave', this._onPointerOut);
    }
    if (this._gazeRaf) {
      if (global.cancelAnimationFrame) global.cancelAnimationFrame(this._gazeRaf);
      this._gazeRaf = 0;
    }
    if (this._driftRaf) {
      if (global.cancelAnimationFrame) global.cancelAnimationFrame(this._driftRaf);
      this._driftRaf = 0;
    }
    this._eyeTarget = null;
    this._pointer = null;
    return this;
  };

  Controller.prototype._applyGaze = function () {
    if (this._destroyed || !this._pointer || !this.el) return;
    var r = this.el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var cx = r.left + r.width / 2;
    var cy = r.top + r.height / 2;
    /* normalise to -1..1 across half the rendered box, then ease */
    var nx = clamp((this._pointer.x - cx) / (r.width * 0.62), -1, 1);
    var ny = clamp((this._pointer.y - cy) / (r.height * 0.62), -1, 1);
    this._setGaze(nx * GAZE_MAX_X, ny * GAZE_MAX_Y);
  };

  Controller.prototype._setGaze = function (x, y) {
    if (!this.el) return;
    this.el.style.setProperty('--gaze-x', x.toFixed(2) + 'px');
    this.el.style.setProperty('--gaze-y', y.toFixed(2) + 'px');
  };

  /* --------------------------- gaze (public) --------------------------- */

  /* Aim the pupils at an explicit direction without a pointer, e.g.
     cat.lookAt(-1, -1) for "up-left", cat.lookAt(0, 0) to recentre.
     nx / ny are normalised to -1..1. */
  Controller.prototype.lookAt = function (nx, ny) {
    this._setGaze(clamp(nx, -1, 1) * GAZE_MAX_X, clamp(ny, -1, 1) * GAZE_MAX_Y);
    return this;
  };

  /* Current pupil offset in viewBox user units, read back from the element. */
  Controller.prototype.getGaze = function () {
    var cs = global.getComputedStyle(this.el);
    return {
      x: parseFloat(cs.getPropertyValue('--gaze-x')) || 0,
      y: parseFloat(cs.getPropertyValue('--gaze-y')) || 0
    };
  };

  /* Gentle wander when the pointer has been still for a while, so the cat
     does not look frozen between mouse moves. */
  Controller.prototype._syncDrift = function () {
    var self = this;
    var wantDrift = !!this._eyeTarget && !this._pokeActive;
    if (!wantDrift || this._driftRaf) return;
    this._driftStart = now();

    var step = function (t) {
      if (self._destroyed || !self._eyeTarget) { self._driftRaf = 0; return; }
      var idleFor = now() - self._lastMoveAt;
      if (!self._pointer || idleFor > IDLE_DRIFT_AFTER_MS) {
        var s = (now() - self._driftStart) / 1000;
        var ax = Math.sin(s * 0.62) * 0.55 + Math.sin(s * 0.23 + 1.1) * 0.3;
        var ay = Math.sin(s * 0.41 + 2.0) * 0.34;
        self._setGaze(ax * GAZE_MAX_X, ay * GAZE_MAX_Y);
      }
      self._driftRaf = raf(step);
    };
    this._driftRaf = raf(step);
  };

  /* --------------------------- hover ----------------------------------- */

  Controller.prototype.attachHover = function (el) {
    if (this._destroyed) return this;
    this.detachHover();
    var self = this;
    this._hoverEl = el || this.host;

    this._onEnter = function () { self.el.classList.add('is-hover'); };
    this._onLeave = function () { self.el.classList.remove('is-hover'); };

    this._hoverEl.addEventListener('pointerenter', this._onEnter);
    this._hoverEl.addEventListener('mouseenter', this._onEnter);
    this._hoverEl.addEventListener('pointerleave', this._onLeave);
    this._hoverEl.addEventListener('mouseleave', this._onLeave);
    return this;
  };

  Controller.prototype.detachHover = function () {
    if (this._hoverEl) {
      this._hoverEl.removeEventListener('pointerenter', this._onEnter);
      this._hoverEl.removeEventListener('mouseenter', this._onEnter);
      this._hoverEl.removeEventListener('pointerleave', this._onLeave);
      this._hoverEl.removeEventListener('mouseleave', this._onLeave);
    }
    this._hoverEl = null;
    if (this.el) this.el.classList.remove('is-hover');
    return this;
  };

  /* --------------------------- blinking -------------------------------- */

  /* CSS handles `idle`; JS covers the other eyes-open states so the cat keeps
     blinking while it listens / thinks / works / talks. */
  Controller.prototype._scheduleBlink = function () {
    var self = this;
    if (this._blinkTimer) { global.clearTimeout(this._blinkTimer); this._blinkTimer = null; }
    if (this._destroyed) return;
    if (EYES_SHUT[this.state] || CSS_BLINKS[this.state]) return;

    var gap = 2600 + Math.random() * 3200;
    this._blinkTimer = global.setTimeout(function () {
      self._blinkTimer = null;
      if (self._destroyed || EYES_SHUT[self.state] || CSS_BLINKS[self.state]) return;
      var el = self.el;
      el.classList.remove('is-blink');
      void el.getBoundingClientRect();
      el.classList.add('is-blink');
      global.setTimeout(function () {
        if (!self._destroyed) el.classList.remove('is-blink');
      }, 170);
      self._scheduleBlink();
    }, gap);
  };

  /* --------------------------- misc ------------------------------------ */

  Controller.prototype.freeze = function (on) {
    this.el.classList.toggle('no-anim', on !== false);
    return this;
  };

  Controller.prototype.destroy = function () {
    this._destroyed = true;
    this.detachEyeTracking();
    this.detachHover();
    if (this._blinkTimer) global.clearTimeout(this._blinkTimer);
    if (this._pokeTimer) global.clearTimeout(this._pokeTimer);
    this._blinkTimer = this._pokeTimer = null;
    var i = instances.indexOf(this);
    if (i !== -1) instances.splice(i, 1);
    return this;
  };

  /* ---------------------------------------------------------------------- */
  /* public surface                                                         */
  /* ---------------------------------------------------------------------- */

  var PuddingCat = {
    version: '1.0.0',
    STATES: STATES.slice(),
    POKE_MS: POKE_MS,

    create: function (host, options) {
      var el = resolveHost(host);
      if (!el) throw new Error('PuddingCat: host element not found');
      return new Controller(el, options);
    },

    svg: function () { return CAT_SVG; },

    /* every live controller */
    all: function () { return instances.slice(); },

    /* convenience: setState on every mounted instance */
    setState: function (name) {
      instances.forEach(function (c) { c.setState(name); });
      return PuddingCat;
    },

    /* Auto-mount: [data-pudding-cat]. Optional data-eye-tracking / data-hover
       / data-state / data-scale attributes configure the instance. */
    autoMount: function (root) {
      var scope = root || document;
      var nodes = scope.querySelectorAll('[data-pudding-cat]');
      var out = [];
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.__puddingCat) { out.push(n.__puddingCat); continue; }
        var opts = {};
        if (n.hasAttribute('data-eye-tracking')) {
          opts.eyeTracking = n.getAttribute('data-eye-tracking') || true;
        }
        if (n.hasAttribute('data-hover')) opts.hover = true;
        if (n.hasAttribute('data-scale')) opts.scale = n.getAttribute('data-scale');
        if (n.hasAttribute('data-freeze')) opts.freeze = true;
        var c = PuddingCat.create(n, opts);
        var st = n.getAttribute('data-state');
        if (st) c.setState(st);
        n.__puddingCat = c;
        out.push(c);
      }
      return out;
    }
  };

  global.PuddingCat = PuddingCat;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { PuddingCat.autoMount(); });
    } else {
      PuddingCat.autoMount();
    }
  }

  /* CommonJS / AMD interop so the file can also be consumed by a bundler. */
  if (typeof module !== 'undefined' && module.exports) module.exports = PuddingCat;
  if (typeof define === 'function' && define.amd) define(function () { return PuddingCat; });

})(typeof window !== 'undefined' ? window : this);
