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

    var PUDDING_ARTWORK_JS = "__PUDDING_ARTWORK_JS__";
    var PUDDING_ARTWORK_CSS = "__PUDDING_ARTWORK_CSS__";

    var artworkEvaluated = false;

    /** Evaluate the baked-in controller once, inside this bundle. */
    function ensureArtwork() {
      if (artworkEvaluated) return !!window.PuddingCat;
      artworkEvaluated = true;
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
        'set.pitch': '变声强度',
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
        'hint.pitchMax': '2.00 已是浏览器上限',
        'hint.noVoice': '本机没有中文语音，已回退',
        'hint.drag': '按住拖动 · 右键设置',
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
        'set.pitch': 'Pitch',
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
        'hint.pitchMax': '2.00 is the browser ceiling',
        'hint.noVoice': 'No local voice; falling back',
        'hint.drag': 'Drag to move · right-click for settings',
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
      morph: true,         // raise the pitch
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

      return {
        get available() { return !!synth; },
        get voices() { return voices; },
        refresh: refresh,
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
          var finish = function () {
            if (settled) return;
            settled = true;
            if (current === utterance) current = null;
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
      '.pudding-warn{color:#e8a85c}'
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
      this.speech.speak(next, {
        voiceURI: this.preferences.voiceURI,
        pitch: this.preferences.morph ? this.preferences.pitch : 1,
        rate: this.preferences.rate,
        volume: this.preferences.volume
      }, function () {
        if (self.disposed) return;
        self.speaking = false;
        // A short gap between sentences reads more naturally than a hard cut.
        setTimeout(function () { if (!self.disposed) self.pump(); }, 90);
      });
    };

    PetWidget.prototype.stopSpeaking = function () {
      this.speechQueue.length = 0;
      this.speaking = false;
      this.speech.cancel();
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

      // ---- Speech ----
      section(t('sec.voice'));
      check(t('set.readReply'), 'readReply');
      check(t('set.readInput'), 'readInput');
      check(t('set.morph'), 'morph');

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
          // `stream` carries the visible reply body (not reasoning, not tools).
          var stream = data.stream;
          var body = '';
          if (typeof stream === 'string') body = stream;
          else if (stream && typeof stream.text === 'string') body = stream.text;
          else if (data.message && typeof data.message.text === 'string') body = data.message.text;
          if (!body) return;
          var tail = pending ? pending + '\n' + body : body;
          pending = '';
          onText(tail);
          return;
        }

        if (event.type === 'assistant/chunk') {
          // Incremental text: buffer until a sentence boundary appears.
          var chunk = data.chunk || {};
          var piece = '';
          if (chunk.type === 'text' && typeof chunk.text === 'string') piece = chunk.text;
          else if (typeof data.text === 'string') piece = data.text;
          if (!piece) return;
          pending += piece;
          var split = takeSentences(pending, false);
          pending = split.rest;
          for (var i = 0; i < split.sentences.length; i++) onText(split.sentences[i]);
          return;
        }

        if (event.type === 'user/message') {
          var userText = '';
          var ustream = data.stream;
          if (typeof ustream === 'string') userText = ustream;
          else if (ustream && typeof ustream.text === 'string') userText = ustream.text;
          else if (typeof data.text === 'string') userText = data.text;
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
          if (!item || item.type !== 'event') continue;
          var event = item.event;
          if (!event || !Number.isFinite(event.seq)) continue;
          if (event.seq <= seen) continue;
          seen = event.seq;
          emitFromEvent(event);
        }
      }

      function attach() {
        if (disposed) return;
        var sessions = null;
        try { sessions = ctx.get ? ctx.get('sessions') : null; } catch (error) { sessions = null; }
        if (!sessions || typeof sessions.retain !== 'function') return;

        // Follow the session the main view is showing.
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
        if (!target) return;

        try {
          reference = sessions.retain(target, { source: 'puddingPet' });
        } catch (error) {
          reference = null;
          return;
        }
        if (!reference) return;

        var start = function () {
          if (disposed) return;
          readWindow();
          var session = reference.binding && reference.binding.session;
          var source = session && session.eventSource;
          if (source && typeof source.subscribe === 'function') {
            try { unsubscribe = source.subscribe(function () { readWindow(); }); } catch (error) {}
          }
        };

        if (reference.ready && typeof reference.ready.then === 'function') {
          reference.ready.then(start, function () { /* the session never opened */ });
        } else {
          start();
        }
      }

      attach();

      return {
        dispose: function () {
          if (disposed) return;
          disposed = true;
          try { if (unsubscribe) unsubscribe(); } catch (error) {}
          try { if (reference && reference.release) reference.release(); } catch (error) {}
          reference = null;
        }
      };
    }

    /* ------------------------------------------------------------------ *
     * 9. Plugin entry
     * ------------------------------------------------------------------ */

    function createPetHost(ctx, translate) {
      var speech = createSpeech();
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
        mount: function (container) {
          var prefs = loadPreferences();
          widget = new PetWidget(container, {
            translate: translate,
            speech: speech,
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
