/* Resume regression.
 *
 * What it protects
 * ----------------
 * Closing the window used to take the conversation with it. App.memory (the
 * diary, ryza.memory.v1) was persisted, so the log panel came back, but
 * App.history (the role/content turns the model actually reads) started empty
 * on every launch. The player saw the old messages and she had no idea what
 * they had been talking about.
 *
 * Run: node scripts/resume_regression.js
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

function makeStore() {
  const map = {};
  return {
    map,
    getItem: (k) => (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); },
    removeItem: (k) => { delete map[k]; },
    key: (i) => Object.keys(map)[i] || null,
    get length() { return Object.keys(map).length; }
  };
}

function mkClassList() {
  const set = {};
  return {
    add(c) { set[c] = 1; },
    remove(c) { delete set[c]; },
    toggle(c) { if (set[c]) delete set[c]; else set[c] = 1; },
    contains(c) { return !!set[c]; }
  };
}

function boot() {
  const store = makeStore();
  const nodes = {};
  const el = (id) => {
    if (!nodes[id]) {
      nodes[id] = {
        id: id, textContent: '', innerHTML: '', className: '', disabled: false,
        scrollTop: 0,
        classList: mkClassList(),
        appendChild() {}, setAttribute() {}, addEventListener() {},
        querySelector() { return null; }, querySelectorAll() { return []; }
      };
    }
    return nodes[id];
  };
  const sandbox = {
    console: console, JSON: JSON, Date: Date, Math: Math, String: String,
    Number: Number, Object: Object, Array: Array, Promise: Promise,
    isNaN: isNaN, parseInt: parseInt, parseFloat: parseFloat,
    encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
    localStorage: store,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    setInterval: setInterval, clearInterval: clearInterval,
    I18n: { t: (k) => k, tf: (k) => k, lang: () => 'id' },
    document: {
      getElementById: el,
      createElement: () => el('tmp' + Math.floor(Math.random() * 1e9)),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {}, removeEventListener() {},
      body: { classList: mkClassList() }
    },
    navigator: { language: 'id' },
    location: { reload() {} }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  ['config.js', 'app.js', 'onboarding.js'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(WEB, f), 'utf8'), sandbox, { filename: f });
  });
  return { sandbox: sandbox, App: sandbox.App, store: store, el: el };
}

console.log('# the wire history survives a close');
{
  const { App, store } = boot();
  ok(typeof App.saveHistory === 'function', 'App.saveHistory exists');
  ok(typeof App.loadHistory === 'function', 'App.loadHistory exists');
  App.history = [
    { role: 'user', content: 'halo' },
    { role: 'assistant', content: 'hai [emotion:smile]' }
  ];
  ok(App.saveHistory() === true, 'saveHistory reports a write');
  ok(typeof store.map['ryza.history.v1'] === 'string', 'it lands in ryza.history.v1');

  App.history = [];
  App.loadHistory();
  ok(App.history.length === 2, 'loadHistory brings both turns back');
  ok(App.history[1].content === 'hai [emotion:smile]',
     'the emotion tags survive, they are what the columns read');
}

console.log('\n# the stored copy is capped, and junk is dropped');
{
  const { sandbox, App, store } = boot();
  App.history = [];
  for (let i = 0; i < 200; i++) App.history.push({ role: 'user', content: 'm' + i });
  App.saveHistory();
  const kept = JSON.parse(store.map['ryza.history.v1']);
  ok(kept.length === 80, 'a 200 message history is stored as the last 80');
  ok(kept[79].content === 'm199', 'and it is the newest end that is kept');

  /* api.js sends the last historyTurns * 2 messages, and the setting only has a
     lower bound, so the stored copy must follow it up or a resumed session
     reads less than the request window the player asked for. */
  sandbox.Config.set('llm.historyTurns', 100);
  App.saveHistory();
  ok(JSON.parse(store.map['ryza.history.v1']).length === 200,
     'raising historyTurns raises the cap instead of truncating the window');
  sandbox.Config.set('llm.historyTurns', 12);
  App.saveHistory();
  ok(JSON.parse(store.map['ryza.history.v1']).length === 80,
     'and lowering it back leaves the floor at 80');

  store.map['ryza.history.v1'] = JSON.stringify([
    { role: 'system', content: 'nope' }, { bad: 1 }, 'nope',
    { role: 'user', content: 'ok' }
  ]);
  App.loadHistory();
  ok(App.history.length === 1 && App.history[0].content === 'ok',
     'loadHistory keeps only well formed user/assistant turns');

  store.map['ryza.history.v1'] = 'not json';
  App.loadHistory();
  ok(Array.isArray(App.history) && App.history.length === 0, 'corrupt json loads as empty');
}

console.log('\n# the panel reopens on her last line');
{
  const { App, el } = boot();
  App.memory = [
    { who: 'user', text: 'a' }, { who: 'ryza', text: 'b' }, { who: 'ryza', text: 'c' }
  ];
  App.restoreChat();
  ok(JSON.stringify(App._pages) === JSON.stringify(['b', 'c']), '_pages holds her lines from the diary');
  ok(App._pageSel === 1, 'the ring points at the newest one');
  ok(el('bubble-text').textContent === 'c', 'the bubble shows the last thing she said');

  const off = boot();
  off.sandbox.Config.set('app.showBubble', false);
  off.App.memory = [{ who: 'ryza', text: 'hidden' }];
  off.App.restoreChat();
  ok(off.el('bubble-text').textContent === '',
     'a player who turned the bubble off does not get it back');
}

console.log('\n# a new game does not inherit the old conversation');
{
  const { sandbox, store } = boot();
  store.map['ryza.history.v1'] = '[{"role":"user","content":"lama"}]';
  sandbox.Config.newGame();
  ok(store.map['ryza.history.v1'] === undefined, 'Config.newGame removes ryza.history.v1');
}

console.log('\n# the title only stops a first launch');
{
  const { sandbox, el } = boot();
  let started = 0;
  const title = el('overlay-title');

  sandbox.Onboarding.showTitle(function () { started++; }, false);
  ok(!title.classList.contains('hidden'), 'without auto the title stays up');
  ok(started === 0, 'and the boot chain waits for the click');
  el('btn-title-start').onclick();
  ok(title.classList.contains('hidden') && started === 1, 'the click still opens the game');

  const again = boot();
  let ran = 0;
  again.sandbox.Onboarding.showTitle(function () { ran++; }, true);
  ok(again.el('overlay-title').classList.contains('hidden'),
     'with auto the title is already gone, so a resumed session is not a restart');
  ok(ran === 1, 'and the boot chain runs without a click');
  ok(!again.sandbox.document.body.classList.contains('boot'),
     'the boot class is lifted either way, or the chrome stays hidden behind it');
}

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
