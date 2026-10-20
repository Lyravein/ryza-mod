/* Onboarding intro regression.
 *
 * What it protects
 * ----------------
 * The intro is title -> 9 questions -> 9-clip prologue -> 5-line tutorial ->
 * chat, and `state.onboardingDone` is only written at the very end. Two ways to
 * break that were both live at once:
 *
 *   skip() hid the prologue too and marked the intro done, so one press on
 *   "Lewati" dropped the player into the chat with the opening never shown.
 *   Starting a new game then looked like it had no prologue at all.
 *
 *   Config.newGame() did not clear ryza.firstLaunch.v1, so the day gate on the
 *   welcome missions came back at the old day count. That one is asserted in
 *   newgame_regression.js.
 *
 * Run: node scripts/onboarding_intro_regression.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.join(__dirname, '..', 'web', 'js');

let failures = 0;
function ok(cond, name) {
  if (cond) console.log('  PASS ' + name);
  else { failures++; console.log('  FAIL ' + name); }
}
function eq(a, b, name) {
  ok(a === b, name + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');
}

/* ------------------------------------------------------------- stubs */
const store = {};
const els = {};
function el(id) {
  if (!els[id]) {
    const e = {
      id: id, textContent: '', value: '', onclick: null, style: {},
      _cls: {},
      classList: {
        add: (c) => { e._cls[c] = true; },
        remove: (c) => { delete e._cls[c]; },
        contains: (c) => !!e._cls[c]
      },
      appendChild: () => {}, setAttribute: () => {},
      querySelector: () => el('_q'),
      querySelectorAll: () => []
    };
    els[id] = e;
  }
  return els[id];
}
const hidden = (id) => el(id).classList.contains('hidden');

const sandbox = { console: console };
sandbox.window = sandbox;
sandbox.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
sandbox.document = {
  getElementById: (id) => el(id),
  querySelectorAll: () => [],
  createElement: () => el('_created'),
  addEventListener: () => {}
};
sandbox.I18n = { lang: 'id', t: (k) => k, tc: (k) => k, tf: (k) => k };
sandbox.Sound = { unlock: () => {}, setRoute: () => {}, setPlace: () => {}, prologue: (n) => 'prologue/' + n + '.mp3' };
sandbox.Avatar = { setTalking: () => {}, setEmotion: () => {} };
sandbox.World = { backgroundFor: () => 'stage-1' };
sandbox.Audio = function () {
  return { play: () => Promise.resolve(), pause: () => {}, volume: 1, onended: null };
};
vm.createContext(sandbox);

function load(f) {
  vm.runInContext(fs.readFileSync(path.join(WEB, f), 'utf8'), sandbox, { filename: f });
}
load('util.js');
load('config.js');
load('onboarding.js');

const Config = sandbox.Config;
const Onboarding = sandbox.Onboarding;

/* index.html ships the questionnaire and the prologue hidden and the title
   visible, so the stub has to start in the same state. */
el('overlay-onboard').classList.add('hidden');
el('overlay-prologue').classList.add('hidden');

/* ------------------------------------------------------------------ test */
console.log('\n1. a fresh run starts on the questions');
Config.set('state.onboardingDone', false);
let entered = 0;
Onboarding.start(() => { entered++; });
ok(!hidden('overlay-onboard'), 'the questionnaire is on screen after start()');
ok(hidden('overlay-prologue'), 'the prologue is still hidden while answering');
eq(Onboarding.step, 0, 'the questionnaire starts at question 1');

console.log('\n2. Skip leaves the story in, the questions out');
Onboarding.skip();
ok(hidden('overlay-onboard'), 'skip closes the questionnaire');
ok(!hidden('overlay-prologue'), 'skip lands on the prologue instead of the chat');
eq(Onboarding._proIdx, 1, 'the prologue starts at clip 1');
eq(el('pro-step').textContent, '1 / 9', 'the clip counter renders "1 / 9"');
eq(Config.section('state').onboardingDone, false, 'the intro is not marked done by skip');
eq(entered, 0, 'the chat is not entered straight from skip');

console.log('\n3. the prologue runs into the tutorial and only then finishes');
for (let i = 1; i <= 8; i++) Onboarding.prologueNext();
eq(Onboarding._proIdx, 9, 'all 9 clips are reachable');
ok(!hidden('overlay-prologue'), 'clip 9 is still on screen before the last tap');
Onboarding.prologueNext();
ok(hidden('overlay-prologue'), 'the last tap closes the prologue');
eq(Onboarding._tutIdx, 1, 'the tutorial took over');
eq(Config.section('state').onboardingDone, false, 'the tutorial has not finished yet');

let guard = 0;
while (!Onboarding.isDone() && guard++ < 20) Onboarding.tutorialAdvance();
ok(Onboarding.isDone(), 'finishing the tutorial marks the intro done');
eq(entered, 1, 'the chat is entered once, at the end');

console.log('\n4. quitting mid-intro offers it again');
Config.set('state.onboardingDone', false);
Onboarding._tutIdx = 3;
ok(!Onboarding.isDone(), 'a half-finished intro does not count as done');

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
