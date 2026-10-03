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

    /**
     * Bounds of the Edge pitch offset, shared by the preference validator and
     * the settings slider so the two can never disagree.
     *
     * The upper bound is the measured ceiling of the service: payloads stop
     * changing past ~+90Hz (and above it the mapping is not even monotonic), so
     * a larger value would be stored, displayed, and then have no effect.
     */
    var EDGE_PITCH_MIN = 0;
    var EDGE_PITCH_MAX = 90;

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
      // Bounds must match the slider in the settings panel, or a stored value
      // could be unreachable: the panel would display one number while the
      // slider could only produce another. The upper bound is the measured
      // service ceiling, so a value above it has no effect anyway.
      out.edgePitch = clamp(
        source.edgePitch != null ? source.edgePitch : DEFAULTS.edgePitch,
        EDGE_PITCH_MIN,
        EDGE_PITCH_MAX,
      );
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
    /** Locally-installed character art, served by the host (see lib/index.js). */
    var ART_ROUTE = '/pudding-pet/art';

    /**
     * How long to wait for the art manifest before falling back.
     *
     * The slot registration waits on this, so it is a delay in the pet appearing.
     * The route is local and answers in milliseconds; this ceiling only exists so
     * a wedged host cannot leave the pet missing entirely.
     */
    var ART_TIMEOUT_MS = 2000;

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
      /**
       * Invalidates in-flight attempts.
       *
       * Without this, aborting a fetch runs its `AbortError` handler, which
       * reported `handled === false` — and `false` means "fall back to the
       * browser engine". Pressing Stop therefore spoke the sentence anyway
       * through the Web Speech API, and a reply that superseded another could
       * be read twice, once by each engine. Bumping the generation makes a
       * cancelled attempt stay silent instead of reporting a failure.
       */
      var generation = 0;

      function release() {
        if (currentUrl) {
          try { URL.revokeObjectURL(currentUrl); } catch (error) { /* already gone */ }
          currentUrl = null;
        }
        currentAudio = null;
      }

      function cancel() {
        // Bump first: every handler below checks the generation it started with,
        // so an attempt that is cancelled here will not report a failure (which
        // the caller would treat as "fall back and speak anyway").
        generation += 1;
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
        // The route wants the SSML prosody offset (a percentage string), which is
        // a different thing from the element's 0..1 volume level.
        if (options.volumeOffset) params.set('volume', options.volumeOffset);
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

        /**
         * Speak through the host.
         *
         * @param done - `true` when the host spoke; `false` to fall back to the
         *   browser engine; `null` when the attempt was superseded, which means
         *   "say nothing at all" — see the note on `generation`.
         */
        speak: function (text, options, done) {
          var content = String(text == null ? '' : text).trim();
          if (!content || typeof fetch !== 'function' || !this.ready) {
            if (done) done(false);
            return false;
          }

          cancel();
          // `cancel()` bumped the generation; capture the one this attempt owns.
          var mine = generation;
          var finished = false;
          var settle = function (handled) {
            if (finished) return;
            finished = true;
            // When superseded, `cancel()` already released this attempt's audio
            // and the resources now belong to the newer attempt — so this must
            // not touch them, or a late rejection would silence the new reply.
            if (generation === mine) release();
            // A superseded attempt must not report a failure: `false` would make
            // the caller speak the sentence through the other engine. Report
            // `null` instead, which the caller reads as "say nothing at all".
            // Reporting it (rather than staying silent) also lets the caller
            // clear its own in-flight flag, so the queue cannot stall.
            var outcome = generation !== mine ? null : handled;
            if (done) { try { done(outcome); } catch (error) { /* ignore */ } }
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
              // Superseded while the audio was downloading: play nothing.
              if (finished || generation !== mine) return;

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
              // Element volume, as a 0..1 level. This is NOT the same value the
              // route takes: `pump()` passes a prosody offset string ("0%") for
              // the SSML, and reading that here gave Number("0%") === NaN, which
              // `clamp` resolves to its LOW bound — so every host-engine
              // utterance played at volume 0 and the pet moved without sound.
              // The offset travels as `volumeOffset`; the level arrives as
              // `volume`.
              var level = options && options.volume != null ? Number(options.volume) : 1;
              try { audio.volume = clamp(Number.isFinite(level) ? level : 1, 0, 1); } catch (error) { /* ignore */ }

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
          destroy: function () {
            try { cat.destroy(); } catch (error) { /* already gone */ }
            // PuddingCat's own destroy() detaches listeners and drops the instance
            // but leaves its <svg> in the DOM, so the element must be removed here
            // — otherwise replacing the character leaves both on screen.
            try { if (cat.el && cat.el.remove) cat.el.remove(); } catch (error) { /* gone */ }
          }
        };
      }
    };

    /* ------------------------------------------------------------------ *
     * 5b. Visual adapter for a locally-supplied character
     * ------------------------------------------------------------------ */

    /**
     * Build a visual adapter from a locally-installed character manifest.
     *
     * The clips are game-derived and never ship with this project, so they are
     * served by the host from a git-ignored directory rather than bundled. This
     * factory is what turns such a manifest into the same interface the built-in
     * character implements, so speech, dragging, and preferences are untouched.
     *
     * Two constraints shape the implementation:
     *
     *   - An animated WebP inside an `<img>` cannot be paused or seeked, so a
     *     state that should hold one pose uses the still PNG the installer
     *     produced, and `still: true` in the manifest is authoritative for that.
     *   - Only the height is set, and the width follows from the aspect ratio, so
     *     a differently-shaped character is not distorted.
     *
     * @param art - the manifest returned by the host's art route.
     * @returns a visual adapter, or null when the manifest is unusable.
     */
    function createClipVisual(art) {
      if (!art || !art.clips) return null;
      var clips = art.clips;
      var states = art.states || {};
      var talkVariants = Array.isArray(art.talkVariants) ? art.talkVariants : [];
      var character = art.character || {};
      var canvas = art.canvas || {};
      var AR = (canvas.width && canvas.height) ? (canvas.width / canvas.height) : (322 / 430);

      /** The URL a clip or still is fetched from. */
      function artUrl(file) {
        return ART_ROUTE + '?name=' + encodeURIComponent(file);
      }

      /** Resolve the file for one state, preferring the still when asked for. */
      function fileFor(stateName, variantIndex) {
        var spec = states[stateName];
        if (!spec) return null;

        var name = spec.clip;
        // While speaking, rotate through the mouth shapes so a long reply does
        // not repeat one gesture.
        if (stateName === 'talk' && talkVariants.length > 1) {
          name = talkVariants[variantIndex % talkVariants.length];
        }
        var clip = clips[name];
        if (!clip) return null;

        if (spec.still) return clip.still ? { file: clip.still, still: true } : null;
        return { file: clip.file, still: false };
      }

      return {
        id: character.id || 'local',
        label: character.label || 'Local',

        mount: function (host, options) {
          var img = document.createElement('img');
          img.className = 'pudding-clip';
          img.alt = character.label ? String(character.label) : '';
          img.draggable = false;
          img.decoding = 'async';

          var currentState = 'idle';
          var variant = 0;
          var failed = false;

          /** Show nothing rather than a broken-image icon. */
          img.onerror = function () {
            if (failed) return;
            failed = true;
            try { console.warn('[pudding-pet] art failed to load:', img.src); } catch (e) { /* ignore */ }
            img.style.visibility = 'hidden';
          };

          var applySize = function (px) {
            var height = clamp(px || 200, 60, 900);
            img.style.height = Math.round(height) + 'px';
            img.style.width = Math.round(height * AR) + 'px';
          };

          var show = function (choice) {
            if (!choice) return;
            // Only touch `src` when it actually changes: reassigning it restarts
            // the animation, which would make an idle clip stutter on every
            // unrelated preference change.
            var next = artUrl(choice.file);
            if (img.getAttribute('src') !== next) img.setAttribute('src', next);
            img.style.visibility = '';
            failed = false;
          };

          host.appendChild(img);
          applySize(options && options.scale);

          // Start on the initial state.
          show(fileFor('idle', 0));

          return {
            setState: function (name) {
              currentState = name;
              // Show, then advance: the first utterance starts on the primary
              // mouth shape rather than skipping to the second.
              show(fileFor(name, variant));
              variant += 1;
            },
            poke: function () {
              // A short squash reads as a reaction without needing a clip for it.
              img.classList.remove('is-poked');
              // Force a reflow so the animation restarts on a repeated poke.
              void img.offsetWidth;
              img.classList.add('is-poked');
              var clear = function () { img.classList.remove('is-poked'); };
              setTimeout(clear, 420);
            },
            setScale: applySize,
            /** The mouth-shape rotation already varies with time; nothing to do. */
            setTalkRate: function () {},
            freeze: function (on) {
              img.classList.toggle('is-frozen', !!on);
            },
            destroy: function () {
              img.onerror = null;
              try { img.remove(); } catch (error) { /* already gone */ }
            }
          };
        }
      };
    }

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
      '.pudding-note{margin:2px 0 10px;color:var(--pudding-muted);font-size:11px;line-height:1.55}',
      // A locally-supplied character is a still or animated image. Height is set
      // from the size preference and width follows the aspect ratio, so the pet
      // is never stretched.
      '.pudding-clip{display:block;image-rendering:auto;user-select:none;-webkit-user-drag:none}',
      '.pudding-clip.is-frozen{animation-play-state:paused}',
      // A brief squash, so a click has feedback even without a clip for it.
      '.pudding-clip.is-poked{animation:pudding-poke .42s ease-out}',
      '@keyframes pudding-poke{0%{transform:scale(1,1)}35%{transform:scale(1.12,.88)}',
      '70%{transform:scale(.96,1.04)}100%{transform:scale(1,1)}}'
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
      // Kept so the character can be replaced after mount, once the host reports
      // whether local art is installed.
      this.visualAdapter = visual;

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
        // Two distinct quantities: the SSML offset string for the request, and the
        // element's 0..1 level for playback. Conflating them silenced all audio.
        volumeOffset: Math.round((this.preferences.volume - 1) * 100) + '%',
        volume: this.preferences.volume,
        morphSpeed: this.preferences.morph ? this.preferences.morphSpeed : 1
      }, function (spoken) {
        if (self.disposed) return;
        // `null` means this attempt was superseded (Stop was pressed, or a newer
        // sentence replaced it). Stay silent — falling back here would speak
        // through the browser engine exactly what the user cancelled. Clear the
        // in-flight flag so the queue is not left stalled.
        if (spoken === null) {
          self.speaking = false;
          return;
        }
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

    /**
     * Replace the character in place.
     *
     * Used when the host reports a locally-installed character after the pet has
     * already mounted. The old adapter is destroyed and the new one mounts into
     * the same container, then the current state is re-applied so the swap is not
     * visible as a reset. The bubble lives beside the adapter, not inside it, so
     * it survives the swap.
     *
     * @param next - a visual adapter, or a falsy value to do nothing.
     */
    PetWidget.prototype.setVisual = function (next) {
      if (this.disposed || !next || typeof next.mount !== 'function') return;
      if (next === this.visualAdapter) return;

      var previous = this.instance;
      try { if (previous && previous.destroy) previous.destroy(); } catch (error) { /* gone */ }

      // Defensive: the bubble is also a child of this container, so anything that
      // is not the bubble and not ours is a leftover character. An adapter whose
      // destroy() forgets to remove its element would otherwise leave two
      // characters on screen.
      try {
        var children = Array.prototype.slice.call(this.cat.children);
        for (var i = 0; i < children.length; i += 1) {
          if (children[i] !== this.bubble) children[i].remove();
        }
      } catch (error) { /* ignore */ }

      this.visualAdapter = next;
      try {
        this.instance = next.mount(this.cat, {
          eyeTracking: this.root.ownerDocument,
          hover: true,
          scale: this.preferences.size
        });
      } catch (error) {
        // A failed swap must not leave the pet invisible.
        try { console.warn('[pudding-pet] character swap failed:', error && error.message); } catch (e) { /* ignore */ }
        this.instance = previous || { setState: function () {}, poke: function () {}, setScale: function () {}, destroy: function () {} };
        return;
      }
      // Re-apply state and size so the new adapter matches what was on screen.
      try { this.instance.setState(this.state); } catch (error) { /* ignore */ }
      try { if (this.instance.freeze) this.instance.freeze(!this.preferences.motion); } catch (error) { /* ignore */ }
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
      // Idempotent: the panel's text is written into the DOM once, at creation,
      // so a second call would append a duplicate that `closePanel()` cannot
      // reach (it only removes the one it points at). Callers that want a fresh
      // panel must close it first.
      if (this.panel) return this.panel;

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
      slider(t('set.edgePitch'), 'edgePitch', EDGE_PITCH_MIN, EDGE_PITCH_MAX, 5, function (v) {
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
      // The panel writes every label into the DOM once, at creation, so an open
      // panel would keep the previous language until it was reopened. Rebuild it
      // in place instead — DSH can change locale while the panel is on screen.
      if (this.panel) {
        this.closePanel();
        this.openPanel();
      }
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
      // Replaced once the host reports locally-installed art. Until then the
      // built-in character is shown, so a clone with no local art is unaffected.
      var visual = PuddingVisual;

      function loadPreferences() {
        var saved = null;
        try { saved = safeParse(window.localStorage.getItem(STORAGE_KEY)); } catch (error) {}
        return cleanPreferences(saved);
      }

      return {
        speech: speech,
        hostSpeech: hostSpeech,
        /**
         * Choose the character.
         *
         * Safe to call before or after mount: before, it becomes the initial
         * character; after, the mounted pet swaps to it in place.
         */
        useVisual: function (next) {
          if (!next || typeof next.mount !== 'function') return;
          visual = next;
          if (widget) widget.setVisual(next);
        },
        get visual() { return visual; },
        mount: function (container) {
          var prefs = loadPreferences();
          widget = new PetWidget(container, {
            translate: translate,
            speech: speech,
            hostSpeech: hostSpeech,
            visual: visual,
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

        /**
         * Ask the host whether a local character is installed.
         *
         * Resolves to the manifest, or null. A timeout is not optional: the slot
         * registration waits on this, and a host that never answers must not
         * leave the pet missing entirely — the built-in character is the right
         * fallback for a slow or absent route.
         */
        function loadLocalArt() {
          if (typeof fetch !== 'function') return Promise.resolve(null);
          var timer = null;
          var request = fetch(ART_ROUTE, { cache: 'no-store' })
            .then(function (response) {
              if (!response.ok) throw new Error('HTTP ' + response.status);
              return response.json();
            })
            .then(function (payload) {
              if (!payload || !payload.available || !payload.clips) return null;
              return payload;
            })
            .catch(function () { return null; });
          var timeout = new Promise(function (resolve) {
            timer = setTimeout(function () { resolve(null); }, ART_TIMEOUT_MS);
          });
          return Promise.race([request, timeout]).then(function (result) {
            if (timer) clearTimeout(timer);
            return result;
          });
        }

        // Register the slot synchronously: the pet must appear on the first
        // render, and a host that answers slowly must not delay it. The local
        // character is applied afterwards, by swapping the visual in place.
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

        // Ask the host for a locally-installed character. If one arrives, swap it
        // in; if not, the built-in character simply stays.
        loadLocalArt().then(function (art) {
          if (!art) return;
          var local = createClipVisual(art);
          if (!local) return;
          try {
            console.info('[pudding-pet] local character:', local.label);
          } catch (error) { /* ignore */ }
          pet.useVisual(local);
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
