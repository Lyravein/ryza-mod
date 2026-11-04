/* Proactive Idle Spark & Companion Agency (web/js/proactive.js)
   Periodically evaluates companion and world state when the user is idle,
   triggering proactive remarks without requiring direct user input.
   Layer: features.
   Discipline: reads Game/World/Quests/Daily state, NEVER mutates state.
*/
(function (global) {
  'use strict';

  var DEFAULT_IDLE_WINDOW_MS = 60000;   /* 60s of user inactivity required */
  var DEFAULT_COOLDOWN_MS = 90000;      /* 90s minimum between sparks */
  var TICK_MS = 2000;                  /* 2s evaluation tick */

  var _enabled = true;
  var _idleWindowMs = DEFAULT_IDLE_WINDOW_MS;
  var _cooldownMs = DEFAULT_COOLDOWN_MS;
  var _lastActivityTime = 0;
  var _lastSparkTime = 0;
  var _lastTod = null;
  var _lastFaintFired = false;
  var _timer = null;
  var _presenter = null;               /* fn(spark) */
  var _busyChecker = null;             /* fn() -> boolean */
  var _clock = function () { return Date.now(); };

  var FALLBACK_TEXTS = {
    'spark.stamina.faint': '……ふぅ、さすがに疲れちゃった。少し休まない？',
    'spark.stamina.low': '体力が残り少ないみたい……無理しないでね。',
    'spark.tod.mor': 'おはよう！今日もいい天気になりそうだね。',
    'spark.tod.aft': 'もうお昼過ぎかぁ。錬金の調子はどう？',
    'spark.tod.eve': '夕暮れ時だね。空が綺麗に染まってるよ。',
    'spark.tod.ngt': 'もう夜遅いよ……夜更かしはお肌に良くないんだから！',
    'spark.mood.sulk': 'むぅ……さっきからずっと放置されてる気がするんだけど。',
    'spark.mood.tired': 'はぁ……ちょっと肩が凝っちゃったかも。のんびりしようよ。',
    'spark.mood.happy': 'ふふっ♪ なんだか今日はとってもいい気分！',
    'spark.daily': '今日のログイン報酬、まだ受け取ってないみたいだよ？',
    'spark.idle.acquaintance': '何か気になることでもあるの？いつでも話しかけてね。',
    'spark.idle.companion': 'ねえねえ、次はどこへ行こうか？一緒に冒険しようよ！',
    'spark.idle.close': 'ふふ、こうして一緒にいる時間、すごく落ち着くんだよね。',
    'spark.idle.soulmate': 'あなたの隣にいるだけで、どんな錬金も成功する気がするよ♪'
  };

  function isBusy(opts) {
    if (opts && opts.busy != null) return !!opts.busy;
    if (typeof _busyChecker === 'function') {
      try { if (_busyChecker()) return true; } catch (e) {}
    }
    if (global.Turn && typeof global.Turn.state === 'function' && global.Turn.state() !== 'idle') return true;
    if (typeof document !== 'undefined' && document.hidden) return true;
    return false;
  }

  /* Pure evaluation function. Returns spark descriptor or null. */
  function evaluate(now, opts) {
    opts = opts || {};
    var enabled = (opts.enabled != null) ? opts.enabled : _enabled;
    if (!enabled) return null;

    var game = opts.game || (global.Game || null);
    if (game && game.s) {
      var curStamina = (typeof game.s.stamina === 'number') ? game.s.stamina : 10;
      var curFaint = (typeof game.faint === 'function') ? game.faint() : (curStamina <= 0);
      /* Always observe recovery: if stamina is not faint, re-arm the latch immediately
         even if the current tick is suppressed by inactivity, cooldown, or busy state */
      if (!curFaint) {
        _lastFaintFired = false;
      }
    }

    var lastActivity = (opts.lastActivityTime != null) ? opts.lastActivityTime : _lastActivityTime;
    var lastSpark = (opts.lastSparkTime != null) ? opts.lastSparkTime : _lastSparkTime;
    var idleWindow = (opts.idleWindowMs != null) ? opts.idleWindowMs : _idleWindowMs;
    var cooldown = (opts.cooldownMs != null) ? opts.cooldownMs : _cooldownMs;

    /* Inactivity gate: user must be idle for >= idleWindow */
    if (lastActivity && (now - lastActivity < idleWindow)) {
      return null;
    }

    /* Cooldown gate: >= cooldown between sparks */
    if (lastSpark && (now - lastSpark < cooldown)) {
      return null;
    }

    /* External busy gate: speaking, thinking, modal open, document hidden */
    if (isBusy(opts)) return null;

    if (!game || !game.s) return null;

    var world = opts.world || (global.World || null);
    var daily = opts.daily || (global.Daily || null);

    var stamina = (typeof game.s.stamina === 'number') ? game.s.stamina : 10;
    var isFaint = (typeof game.faint === 'function') ? game.faint() : (stamina <= 0);
    var mood = (typeof game.mood === 'function') ? game.mood() : (game.s.mood || 'normal');
    var aff = (typeof game.affection === 'function') ? game.affection() : (game.s.affection || 0);
    var tier = (typeof game.affectionTierKey === 'function') ? game.affectionTierKey(aff) : 'acquaintance';
    var tod = (world && typeof world.tod === 'function') ? world.tod()
      : ((global.Config && Config.section && Config.section('state').tod) || 'aft');

    /* Rule 1: Faint (exhausted completely) */
    if (isFaint) {
      var alreadyFiredFaint = (opts.lastFaintFired != null) ? opts.lastFaintFired : _lastFaintFired;
      if (!alreadyFiredFaint) {
        return {
          trigger: 'stamina_faint',
          key: 'spark.stamina.faint',
          emotion: 'tired',
          priority: 4,
          tier: tier,
          mood: mood
        };
      }
      return null;
    }

    /* Rule 2: Low stamina warning (<= 2 and > 0) */
    if (!isFaint && stamina <= 2 && stamina > 0) {
      return {
        trigger: 'stamina_low',
        key: 'spark.stamina.low',
        emotion: 'tired',
        priority: 3,
        tier: tier,
        mood: mood
      };
    }

    /* Rule 3: Time-of-day shift (e.g. into night or evening) */
    var prevTod = (opts.lastTod !== undefined) ? opts.lastTod : _lastTod;
    if (prevTod && prevTod !== tod) {
      return {
        trigger: 'tod_change',
        key: 'spark.tod.' + tod,
        emotion: (tod === 'ngt' ? 'tired' : 'normal'),
        priority: 2,
        tod: tod,
        tier: tier,
        mood: mood
      };
    }

    /* Rule 4: Mood sulk (pouting) */
    if (mood === 'sulk') {
      return {
        trigger: 'mood_sulk',
        key: 'spark.mood.sulk',
        emotion: 'angry',
        priority: 2,
        tier: tier,
        mood: mood
      };
    }

    /* Rule 5: Mood tired */
    if (mood === 'tired') {
      return {
        trigger: 'mood_tired',
        key: 'spark.mood.tired',
        emotion: 'sad',
        priority: 2,
        tier: tier,
        mood: mood
      };
    }

    /* Rule 6: Daily claim reminder */
    var dailyAvail = daily && typeof daily.available === 'function' ? daily.available() : false;
    if (dailyAvail && (tod === 'mor' || tod === 'aft')) {
      return {
        trigger: 'daily_reminder',
        key: 'spark.daily',
        emotion: 'happy',
        priority: 2,
        tier: tier,
        mood: mood
      };
    }

    /* Rule 7: Mood happy */
    if (mood === 'happy') {
      return {
        trigger: 'mood_happy',
        key: 'spark.mood.happy',
        emotion: 'happy',
        priority: 1,
        tier: tier,
        mood: mood
      };
    }

    /* Rule 8: Casual Idle Chatter (based on affection tier) */
    return {
      trigger: 'idle_casual',
      key: 'spark.idle.' + tier,
      emotion: (tier === 'soulmate' ? 'shy' : 'normal'),
      priority: 1,
      tier: tier,
      mood: mood
    };
  }

  function resolveText(spark, i18n) {
    if (!spark || !spark.key) return '';
    var iMod = i18n || (global.I18n || null);
    if (iMod && typeof iMod.t === 'function') {
      var txt = iMod.t(spark.key);
      if (txt && txt !== spark.key) return txt;
    }
    return FALLBACK_TEXTS[spark.key] || '';
  }

  function tick(now, opts) {
    now = (typeof now === 'number') ? now : _clock();
    var spark = evaluate(now, opts);
    if (!spark) return null;

    spark.text = resolveText(spark);
    _lastSparkTime = now;

    if (spark.trigger === 'stamina_faint') {
      _lastFaintFired = true;
    }
    if (spark.tod) {
      _lastTod = spark.tod;
    }

    if (typeof _presenter === 'function') {
      _presenter(spark);
    }
    return spark;
  }

  function touch(now) {
    _lastActivityTime = (typeof now === 'number') ? now : _clock();
    if (global.Game && typeof global.Game.faint === 'function' && !global.Game.faint()) {
      _lastFaintFired = false;
    }
    if (global.World && typeof global.World.tod === 'function') {
      _lastTod = global.World.tod();
    }
  }

  var FREQ_PRESETS = {
    low: { idleWindowMs: 120000, cooldownMs: 180000 },
    normal: { idleWindowMs: 60000, cooldownMs: 90000 },
    high: { idleWindowMs: 30000, cooldownMs: 45000 }
  };

  function applyConfig() {
    if (!global.Config || typeof global.Config.section !== 'function') return;
    var appCfg = global.Config.section('app') || {};
    _enabled = appCfg.proactiveEnabled !== false;
    var freqKey = String(appCfg.proactiveFreq || '');
    var preset = Object.prototype.hasOwnProperty.call(FREQ_PRESETS, freqKey)
      ? FREQ_PRESETS[freqKey] : FREQ_PRESETS.normal;
    _idleWindowMs = preset.idleWindowMs;
    _cooldownMs = preset.cooldownMs;
  }

  function start(presenter, opts) {
    opts = opts || {};
    applyConfig();
    if (typeof presenter === 'function') _presenter = presenter;
    if (opts.idleWindowMs != null) _idleWindowMs = Number(opts.idleWindowMs);
    if (opts.cooldownMs != null) _cooldownMs = Number(opts.cooldownMs);
    stop();
    if (!_lastActivityTime) _lastActivityTime = _clock();
    if (global.World && typeof global.World.tod === 'function') {
      _lastTod = global.World.tod();
    }
    _timer = setInterval(function () {
      tick();
    }, opts.tickMs || TICK_MS);
  }

  function stop() {
    if (_timer) {
      clearInterval(_timer);
      _timer = null;
    }
  }

  function reset() {
    stop();
    _enabled = true;
    _idleWindowMs = DEFAULT_IDLE_WINDOW_MS;
    _cooldownMs = DEFAULT_COOLDOWN_MS;
    _lastActivityTime = _clock();
    _lastSparkTime = 0;
    _lastTod = null;
    _lastFaintFired = false;
    _presenter = null;
  }

  var Proactive = {
    evaluate: evaluate,
    resolveText: resolveText,
    tick: tick,
    touch: touch,
    start: start,
    stop: stop,
    reset: reset,
    applyConfig: applyConfig,
    enabled: function () { return _enabled; },
    setEnabled: function (v) { _enabled = !!v; },
    setPresenter: function (fn) { _presenter = (typeof fn === 'function') ? fn : null; },
    setBusyChecker: function (fn) { _busyChecker = (typeof fn === 'function') ? fn : null; },
    setClock: function (fn) { _clock = (typeof fn === 'function') ? fn : function () { return Date.now(); }; },
    state: function () {
      return {
        enabled: _enabled,
        idleWindowMs: _idleWindowMs,
        cooldownMs: _cooldownMs,
        lastActivityTime: _lastActivityTime,
        lastSparkTime: _lastSparkTime,
        lastTod: _lastTod,
        lastFaintFired: _lastFaintFired,
        running: !!_timer
      };
    }
  };

  global.Proactive = Proactive;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
