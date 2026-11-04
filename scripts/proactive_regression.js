/* Headless unit and regression suite for Proactive Idle Spark (proactive.js)
   Run: node scripts/proactive_regression.js
*/
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS = path.join(__dirname, '..', 'web', 'js');
let failures = 0;
function ok(cond, name) {
  if (cond) console.log('  PASS ' + name);
  else { failures++; console.log('  FAIL ' + name); }
}

const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  Math, JSON, Date, Object, Array, String, Number, isFinite, parseInt, parseFloat,
  RegExp, Infinity, NaN
};
sandbox.window = sandbox;
sandbox.global = sandbox;

function load(file) {
  const code = fs.readFileSync(path.join(JS, file), 'utf8');
  vm.runInNewContext(code, sandbox, { filename: file });
}

load('util.js');
load('proactive.js');

const Proactive = sandbox.Proactive;
ok(!!Proactive, 'Proactive module loaded');

/* Mock game state generator */
function makeMockGame(opts) {
  opts = opts || {};
  const s = {
    stamina: opts.stamina != null ? opts.stamina : 10,
    affection: opts.affection != null ? opts.affection : 0,
    mood: opts.mood || 'normal'
  };
  return {
    s: s,
    faint: () => s.stamina <= 0,
    mood: () => s.mood,
    affection: () => s.affection,
    affectionTierKey: (val) => {
      const a = val != null ? val : s.affection;
      if (a >= 80) return 'soulmate';
      if (a >= 50) return 'close';
      if (a >= 20) return 'companion';
      return 'acquaintance';
    }
  };
}

console.log('# Timing & Inactivity Gates');
{
  const game = makeMockGame();
  const now = 1000000;

  // 1. User active recently (< 60s)
  const rActive = Proactive.evaluate(now, {
    game: game,
    lastActivityTime: now - 30000,
    idleWindowMs: 60000,
    lastSparkTime: 0
  });
  ok(rActive === null, 'returns null when user was active within idle window');

  // 2. User idle >= 60s, cooldown clear -> fires
  const rIdle = Proactive.evaluate(now, {
    game: game,
    lastActivityTime: now - 65000,
    idleWindowMs: 60000,
    lastSparkTime: 0
  });
  ok(rIdle !== null && rIdle.trigger === 'idle_casual', 'fires idle_casual when idle window elapsed');

  // 3. User idle >= 60s, but spark on cooldown (< 90s)
  const rCooldown = Proactive.evaluate(now, {
    game: game,
    lastActivityTime: now - 120000,
    idleWindowMs: 60000,
    lastSparkTime: now - 40000,
    cooldownMs: 90000
  });
  ok(rCooldown === null, 'returns null when spark cooldown has not elapsed');

  // 4. Busy flag (speaking / thinking / modal)
  const rBusy = Proactive.evaluate(now, {
    game: game,
    lastActivityTime: now - 120000,
    busy: true
  });
  ok(rBusy === null, 'returns null when external busy flag is set');

  // 5. Disabled flag
  const rDisabled = Proactive.evaluate(now, {
    game: game,
    lastActivityTime: now - 120000,
    enabled: false
  });
  ok(rDisabled === null, 'returns null when enabled is false');
}

console.log('# Trigger Priority & Precedence');
{
  const now = 1000000;
  const baseOpts = {
    lastActivityTime: now - 100000,
    lastSparkTime: now - 100000,
    idleWindowMs: 60000,
    cooldownMs: 90000
  };

  // Rule 1: Faint (stamina 0)
  const faintGame = makeMockGame({ stamina: 0, mood: 'sulk' });
  const rFaint = Proactive.evaluate(now, Object.assign({}, baseOpts, { game: faintGame }));
  ok(rFaint && rFaint.trigger === 'stamina_faint' && rFaint.priority === 4,
     'stamina_faint has highest priority over mood sulk');

  // Rule 1 repetition check: once faint fired, does not repeat until reset
  const rFaintRepeat = Proactive.evaluate(now, Object.assign({}, baseOpts, {
    game: faintGame,
    lastFaintFired: true
  }));
  ok(rFaintRepeat === null, 'stamina_faint does not repeat while already fired');

  // Rule 2: Low stamina (stamina <= 2)
  const lowGame = makeMockGame({ stamina: 2, mood: 'happy' });
  const rLow = Proactive.evaluate(now, Object.assign({}, baseOpts, { game: lowGame }));
  ok(rLow && rLow.trigger === 'stamina_low' && rLow.priority === 3,
     'stamina_low has priority over mood happy');

  // Rule 3: TOD change
  const normalGame = makeMockGame({ stamina: 10, mood: 'normal' });
  const rTod = Proactive.evaluate(now, Object.assign({}, baseOpts, {
    game: normalGame,
    world: { tod: () => 'ngt' },
    lastTod: 'aft'
  }));
  ok(rTod && rTod.trigger === 'tod_change' && rTod.key === 'spark.tod.ngt' && rTod.emotion === 'tired',
     'tod_change detects transition from aft to ngt');

  // Rule 4: Mood sulk
  const sulkGame = makeMockGame({ stamina: 10, mood: 'sulk' });
  const rSulk = Proactive.evaluate(now, Object.assign({}, baseOpts, { game: sulkGame }));
  ok(rSulk && rSulk.trigger === 'mood_sulk' && rSulk.emotion === 'angry',
     'mood_sulk triggers angry/pout remark');

  // Rule 5: Mood tired
  const tiredGame = makeMockGame({ stamina: 10, mood: 'tired' });
  const rTired = Proactive.evaluate(now, Object.assign({}, baseOpts, { game: tiredGame }));
  ok(rTired && rTired.trigger === 'mood_tired' && rTired.emotion === 'sad',
     'mood_tired triggers tired remark');

  // Rule 6: Daily claim reminder
  const dailyGame = makeMockGame({ stamina: 10, mood: 'normal' });
  const rDaily = Proactive.evaluate(now, Object.assign({}, baseOpts, {
    game: dailyGame,
    world: { tod: () => 'mor' },
    daily: { available: () => true }
  }));
  ok(rDaily && rDaily.trigger === 'daily_reminder' && rDaily.key === 'spark.daily',
     'daily_reminder triggers when claim is available during daytime');

  // Rule 7: Mood happy
  const happyGame = makeMockGame({ stamina: 10, mood: 'happy' });
  const rHappy = Proactive.evaluate(now, Object.assign({}, baseOpts, { game: happyGame }));
  ok(rHappy && rHappy.trigger === 'mood_happy' && rHappy.emotion === 'happy',
     'mood_happy triggers cheerful remark');
}

console.log('# Idle Casual Affection Tier Variations');
{
  const now = 1000000;
  const baseOpts = {
    lastActivityTime: now - 100000,
    lastSparkTime: now - 100000
  };

  const g0 = makeMockGame({ affection: 0, mood: 'normal' });
  const r0 = Proactive.evaluate(now, Object.assign({}, baseOpts, { game: g0 }));
  ok(r0 && r0.key === 'spark.idle.acquaintance', 'affection 0 maps to spark.idle.acquaintance');

  const g20 = makeMockGame({ affection: 20, mood: 'normal' });
  const r20 = Proactive.evaluate(now, Object.assign({}, baseOpts, { game: g20 }));
  ok(r20 && r20.key === 'spark.idle.companion', 'affection 20 maps to spark.idle.companion');

  const g50 = makeMockGame({ affection: 50, mood: 'normal' });
  const r50 = Proactive.evaluate(now, Object.assign({}, baseOpts, { game: g50 }));
  ok(r50 && r50.key === 'spark.idle.close', 'affection 50 maps to spark.idle.close');

  const g80 = makeMockGame({ affection: 80, mood: 'normal' });
  const r80 = Proactive.evaluate(now, Object.assign({}, baseOpts, { game: g80 }));
  ok(r80 && r80.key === 'spark.idle.soulmate', 'affection 80 maps to spark.idle.soulmate');
}

console.log('# Invariant: Read-Only Discipline (Zero Game State Mutation)');
{
  const initial = { stamina: 8, affection: 42, mood: 'normal' };
  const game = {
    s: Object.assign({}, initial),
    faint: () => false,
    mood: () => game.s.mood,
    affection: () => game.s.affection,
    affectionTierKey: () => 'companion'
  };

  sandbox.Game = game;
  Proactive.reset();
  let fakeClock = 200000;
  Proactive.setClock(() => fakeClock);

  // Set user active at t = 100,000
  Proactive.touch(100000);
  // Advance to t = 200,000 (100s idle)
  let receivedSpark = null;
  Proactive.setPresenter((sp) => { receivedSpark = sp; });

  const spark = Proactive.tick(200000);
  ok(!!spark, 'tick produced a spark');
  ok(!!receivedSpark && receivedSpark === spark, 'presenter received the exact spark');
  ok(JSON.stringify(game.s) === JSON.stringify(initial),
     'game.s is completely unmodified after evaluate & tick');

  // Verify text resolved
  ok(typeof spark.text === 'string' && spark.text.length > 0,
     'spark.text is resolved with non-empty text: ' + spark.text);

  // Immediate next tick must be blocked by cooldown
  const spark2 = Proactive.tick(200001);
  ok(spark2 === null, 'consecutive tick immediately blocked by cooldown');
}

console.log('# Live Scheduler Busy Suppression & Faint Recovery Lifecycle');
{
  Proactive.reset();
  const game = makeMockGame({ stamina: 10, mood: 'normal' });
  sandbox.Game = game;

  let presenterCalls = 0;
  Proactive.setPresenter(() => { presenterCalls++; });
  Proactive.touch(100000);

  // 1. Live busy checker suppresses scheduled tick
  Proactive.setBusyChecker(() => true);
  const sparkBusy = Proactive.tick(200000);
  ok(sparkBusy === null, 'scheduled tick blocked by live busy checker');
  ok(presenterCalls === 0, 'presenter never called while live busy');

  // Clear busy checker, but set Turn.state() = 'speaking'
  Proactive.setBusyChecker(null);
  sandbox.Turn = { state: () => 'speaking' };
  const sparkSpeaking = Proactive.tick(200000);
  ok(sparkSpeaking === null, 'scheduled tick blocked by Turn.state speaking');
  ok(presenterCalls === 0, 'presenter never called while speaking');

  // Clear speaking in Turn
  sandbox.Turn.state = () => 'idle';
  const sparkFree = Proactive.tick(200000);
  ok(sparkFree !== null, 'scheduled tick fires when live busy clears');
  ok(presenterCalls === 1, 'presenter called once on clear');

  // 2. Faint -> Recovery -> Faint Lifecycle
  Proactive.reset();
  let calls = 0;
  let lastSpark = null;
  Proactive.setPresenter((sp) => { calls++; lastSpark = sp; });
  Proactive.touch(100000);

  // Faint 1
  game.s.stamina = 0;
  const f1 = Proactive.tick(200000);
  ok(f1 && f1.trigger === 'stamina_faint', 'faint 1 triggers stamina_faint');
  ok(calls === 1, 'presenter called for faint 1');

  // Immediate next tick while still fainted -> suppressed
  const f1Suppressed = Proactive.tick(350000); // 150s later, past cooldown
  ok(f1Suppressed === null, 'faint remark does not repeat while continuously fainted');
  ok(calls === 1, 'presenter not called during continuous faint');

  // Recovery without manual touch
  game.s.stamina = 10;
  const recovered = Proactive.tick(500000); // 150s later
  ok(recovered !== null && recovered.trigger !== 'stamina_faint', 'recovers and fires normal spark');
  ok(calls === 2, 'presenter called for recovered spark');

  // Faint 2: stamina drops back to 0 -> automatically re-armed without manual touch
  game.s.stamina = 0;
  const f2 = Proactive.tick(650000); // 150s later
  ok(f2 && f2.trigger === 'stamina_faint', 'faint 2 automatically re-arms after recovery');
  ok(calls === 3, 'presenter called for faint 2');

  // 3. Faint -> Gated recovery tick (suppressed by busy/cooldown) -> Faint -> Eligible tick
  Proactive.reset();
  calls = 0;
  Proactive.setPresenter((sp) => { calls++; });
  Proactive.touch(100000);

  // Initial faint
  game.s.stamina = 0;
  const fA = Proactive.tick(200000);
  ok(fA && fA.trigger === 'stamina_faint', 'gated lifecycle: initial faint fires');
  ok(calls === 1, 'presenter called for initial faint');

  // Recovery happens while app is busy (speaking) and during cooldown (t = 210000)
  game.s.stamina = 10;
  sandbox.Turn.state = () => 'speaking';
  const suppressedRecoveryTick = Proactive.tick(210000);
  ok(suppressedRecoveryTick === null, 'recovery tick was suppressed by busy & cooldown');
  ok(calls === 1, 'presenter not called during suppressed tick');

  // Immediately faint again while still busy
  game.s.stamina = 0;
  const suppressedFaintTick = Proactive.tick(220000);
  ok(suppressedFaintTick === null, 'faint tick while busy is suppressed');

  // Now busy clears and cooldown elapses (t = 350000) -> eligible tick
  sandbox.Turn.state = () => 'idle';
  const fReArmed = Proactive.tick(350000);
  ok(fReArmed && fReArmed.trigger === 'stamina_faint',
     'faint latch was cleared during gated recovery tick, allowing eligible faint to fire');
  ok(calls === 2, 'presenter called for re-armed eligible faint');

  // 4. Inactivity-only and busy-only isolated recovery
  Proactive.reset();
  calls = 0;
  Proactive.setPresenter(() => { calls++; });
  Proactive.touch(100000);
  // Initial faint
  game.s.stamina = 0;
  Proactive.tick(200000);
  ok(calls === 1, 'isolated test: initial faint fired');

  // Inactivity-only recovery: cooldown past, but user active 5s ago (now - 5000 < 60000)
  game.s.stamina = 10;
  Proactive.touch(495000);
  const inactTick = Proactive.tick(500000); // 300s since last spark, but user active
  ok(inactTick === null, 'inactivity-only tick suppressed');
  // Drop back to faint and wait for idle window
  game.s.stamina = 0;
  const inactReArmed = Proactive.tick(600000); // 105s idle
  ok(inactReArmed && inactReArmed.trigger === 'stamina_faint',
     'faint latch was cleared during inactivity-only suppressed recovery tick');
  ok(calls === 2, 'presenter called for inactivity-isolated re-armed faint');
}

if (failures > 0) {
  console.error('\nPROACTIVE REGRESSION: FAILED (' + failures + ' failures)');
  process.exit(1);
} else {
  console.log('\nPROACTIVE REGRESSION: ALL PASS');
}
