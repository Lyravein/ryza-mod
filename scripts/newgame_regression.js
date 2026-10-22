/* New Game: wipe the run, keep the setup.

   Why this file exists
   --------------------
   The request was "reset everything but the settings", and the only reset
   that existed — Config.reset(), wired to the button next to this one —
   hands the WHOLE blob back to DEFAULTS. llm/stt/tts live in that same JSON
   as the day counter, so pressing it throws away the endpoint, the key and
   the model, and the next message goes nowhere. That failure is silent and
   looks like the network broke.

   So the split has to be asserted, not assumed: a value typed into the
   settings has to come out the far side of a new game untouched. That is the
   whole point of the feature, and it is exactly what a future edit to the
   SETUP list would quietly break.

   Run: node scripts/newgame_regression.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const KEY = 'ryza.settings.v1';

let failures = 0;
const ok = (cond, name) => {
  if (cond) console.log('  PASS ' + name);
  else { failures++; console.log('  FAIL ' + name); }
};

/* A save with a run worth losing and a setup worth keeping. */
function seedStore() {
  return {
    [KEY]: JSON.stringify({
      llm:   { baseUrl: 'http://gw.test/v1', apiKey: 'sk-test-123', model: 'my-model' },
      stt:   { baseUrl: 'http://gw.test/v1', model: 'dg/nova-3', engine: 'auto' },
      tts:   { baseUrl: 'http://tts.test', apiKey: 'tts-key', mode: 'clone' },
      audio: { bgm: 0.11, voice: 0.22 },
      app:   { lang: 'id', nsfwEnabled: true },
      memory: { enabled: true },
      voice:  { favourite: 'v1' },
      chara:  { skin: 'crf_skn_002' },
      profile: { name: 'Finn', storyStart: 'a whole backstory' },
      state:   { day: 412, gameHour: 21, onboardingDone: true, welcome: { a: true } }
    }),
    'ryza.game.v1':    '{"money":9}',
    'ryza.memory.v1':  '{"turns":[1,2,3]}',
    'ryza.history.v1': '[{"role":"user","content":"lama"}]',
    'ryza.longmem.v1': '{"cards":[]}',
    'ryza.longterm.v1':'{"facts":["x"]}',
    'ryza.daily.v1':   '{"day":412}',
    'ryza.saves.v1':   '[{"id":1}]',
    'ryza.alarms.v1':  '[{"id":"a1"}]',
    /* the run's birthday: Daily.dayIndex() is derived from it, and app.js:202
       pushes that straight into Welcome.bumpDay() at boot */
    'ryza.firstLaunch.v1': '2026-9-20',
    /* not part of a run: an imported outfit and a starred voice */
    'ryza.crf.imported.v1': '{"packs":["p1"]}',
    'ryza.voicefav.v1':     '{"favs":["v1"]}'
  };
}

function runConfig(store, fn) {
  const sandbox = {
    console, JSON, Object, Array, String, Number, Boolean, Date, Math, isFinite,
    parseInt, parseFloat, RegExp, Error, Promise, Set, Map, Infinity, NaN,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      key: (i) => Object.keys(store)[i] === undefined ? null : Object.keys(store)[i],
      get length() { return Object.keys(store).length; }
    },
    fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve(null) }),
    addEventListener() {}, removeEventListener() {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'web/js/config.js'), 'utf8'), sandbox, { filename: 'config.js' });
  fn(sandbox.Config, store);
}

console.log('# new game: keep the setup');

runConfig(seedStore(), (Config) => {
  Config.newGame();                       /* the assertion is AFTER the wipe */
  const s = Config.section('llm');
  ok(s.baseUrl === 'http://gw.test/v1' && s.apiKey === 'sk-test-123' && s.model === 'my-model',
     'the endpoint, the key and the model survive');
  ok(Config.section('stt').model === 'dg/nova-3', 'the transcription model survives');
  ok(Config.section('tts').apiKey === 'tts-key' && Config.section('tts').mode === 'clone',
     'the voice setup survives');
  ok(Config.section('audio').bgm === 0.11 && Config.section('audio').voice === 0.22,
     'the volume sliders survive');
  ok(Config.section('app').lang === 'id' && Config.section('app').nsfwEnabled === true,
     'the interface language and permissions survive');
  ok(Config.section('memory').enabled === true && Config.section('voice').favourite === 'v1'
     && Config.section('chara').skin === 'crf_skn_002',
     'memory, voice and character settings survive');
});

console.log('# new game: lose the run');

runConfig(seedStore(), (Config) => {
  ok(Config.section('state').day === 412, 'sanity: the run is there before the wipe');
  Config.newGame();
  /* Read through a guard: a section that comes back undefined after the wipe
     is a real failure, and letting it throw here would abort the file and
     hide every assertion that follows. */
  var st = Config.section('state') || {};
  var pf = Config.section('profile') || {};
  ok(st.day !== 412 && st.onboardingDone !== true,
     'the day counter and the tutorial flags are gone');
  ok(!!Config.section('state'), 'the state section keeps its shape (not undefined)');
  ok(!pf.name && !pf.storyStart,
     'the player profile is blank again (onboarding will ask)');
});

console.log('# new game: a reset even when the values were written in this session');

/* The bug this pins: deepMerge shallow-copied DEFAULTS, so after a wipe
   data.state pointed at DEFAULTS.state. Every later Config.set() then wrote
   into DEFAULTS, and the next new game "restored" the values it was meant to
   drop, so the questionnaire and the prologue never came back. */
/* The default, read from an empty store so it is DEFAULTS itself and not the
   seeded run. */
let dayDefault = null;
runConfig({}, (Config) => { dayDefault = Config.section('state').day; });

runConfig(seedStore(), (Config) => {
  Config.set('state.day', 412);
  Config.set('state.onboardingDone', true);
  Config.set('profile.name', 'Finn');
  Config.newGame();
  ok(Config.section('state').day === dayDefault,
     'a day written in this session resets (got ' + Config.section('state').day + ', want ' + dayDefault + ')');
  ok(Config.section('state').onboardingDone === false,
     'onboardingDone is false again, so the questionnaire and prologue return');
  ok(!Config.section('profile').name, 'the name written in this session is gone');

  /* twice in a row, with no reload in between */
  Config.set('state.day', 412);
  Config.set('state.onboardingDone', true);
  Config.newGame();
  ok(Config.section('state').day === dayDefault && Config.section('state').onboardingDone === false,
     'a second new game in the same session still resets');
});

console.log('# new game: the module-owned stores');

runConfig(seedStore(), (Config, store) => {
  Config.newGame();
  const RUN = ['ryza.game.v1', 'ryza.memory.v1', 'ryza.history.v1', 'ryza.longmem.v1', 'ryza.longterm.v1',
               'ryza.daily.v1', 'ryza.saves.v1', 'ryza.alarms.v1', 'ryza.firstLaunch.v1'];
  const left = RUN.filter((k) => k in store);
  ok(left.length === 0, 'every run store is removed' + (left.length ? ' (left: ' + left.join(', ') + ')' : ''));
  /* A surviving first-launch date is invisible in the settings screen and only
     shows up days later as welcome missions that were already unlocked. */
  ok(!('ryza.firstLaunch.v1' in store),
     'the first-launch date goes, so the 0/3/5 welcome gate restarts');
  ok('ryza.crf.imported.v1' in store && 'ryza.voicefav.v1' in store,
     'the imported outfit and the starred voice are NOT run state, so they stay');
});

console.log('# new game: the old reset really did lose the settings');

runConfig(seedStore(), (Config) => {
  Config.reset();
  const s = Config.section('llm');
  ok(!(s.baseUrl === 'http://gw.test/v1' && s.apiKey === 'sk-test-123'),
     'Config.reset() still wipes the endpoint and key — that is why newGame exists');
});

console.log(failures ? '\n' + failures + ' FAILURES' : '\nALL PASS');
process.exit(failures ? 1 : 0);