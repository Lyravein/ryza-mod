/* Context meter: the number on screen must be the number that ships.

   Why this file exists
   --------------------
   Api.chat() trims history when it overruns the context window, and the trim
   was silent: `while (hist.length > 2 && used > budget) hist = hist.slice(2)`
   drops the oldest turns with no toast, no marker, nothing. The player's read
   of that is "the character forgot", which reads like a model problem and is
   not one. Worse, resolvedContext() falls back to 32768 for any model it
   does not recognise, so a 8K endpoint loses history twice as fast as the
   settings screen claims.

   The meter was added to make that visible. It works by calling the same
   builder chat() calls rather than keeping its own estimate, which is the
   only version of this that cannot drift — a second copy of the trim rule
   would be free to disagree with the one that ships, and would do so silently,
   which is the exact failure being fixed.

   The drift test below is the load-bearing one: it asserts the array the meter
   reports on is identical to the array chat() actually posts. If someone later
   re-inlines the trim inside chat(), this fails.

   Run: node scripts/context_meter_regression.js */
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

/* One sandbox holding config.js + api.js, which is all the builder touches.
   request() posts through XMLHttpRequest, not fetch, so that is what gets
   captured here; a fetch stub would never be reached. */
function sandbox(llmOverrides, capture) {
  const store = {};
  store[KEY] = JSON.stringify({
    llm: Object.assign({
      baseUrl: 'http://gw.test/v1', apiKey: 'k', model: 'my-model',
      contextWindow: 0, maxTokens: 400, temperature: 0.9, historyTurns: 12
    }, llmOverrides || {}),
    state: { mode: 'chat', style: 'text' }
  });
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  /* localProxy() rewrites loopback origins onto /_proxy; a foreign origin keeps
     it out of the way and on the direct path, which is the one under test. */
  const win = {
    localStorage, console,
    location: { origin: 'https://app.test', href: 'https://app.test/' },
    XMLHttpRequest: function () {
      this.open = function () {};
      this.setRequestHeader = function () {};
      this.abort = function () {};
      this.send = function (raw) {
        if (capture) capture.body = JSON.parse(raw);
        this.status = 200;
        this.responseText = JSON.stringify({ choices: [{ message: { content: 'ok' } }] });
        if (this.onload) this.onload();
      };
    }
  };
  win.window = win;
  const ctx = vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'web/js/config.js'), 'utf8'), ctx, { filename: 'config.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'web/js/api.js'), 'utf8'), ctx, { filename: 'api.js' });
  return win;
}

/* A history big enough to overrun a small window. */
function bigHistory(turns, size) {
  const h = [];
  for (let i = 0; i < turns; i++) {
    h.push({ role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(size) + ' #' + i });
  }
  return h;
}

console.log('\n=== previewContext reports what chat() would trim ===');

{
  const win = sandbox({ contextWindow: 4096 });
  const Api = win.Api;
  const hist = bigHistory(20, 900);
  const f = Api.previewContext(hist, { mode: 'chat', style: 'text' }, 'hello');
  ok(f && typeof f.used === 'number' && f.used > 0, 'used is a number');
  ok(f.ctx === 4096, 'ctx honours the configured window, got ' + f.ctx);
  ok(f.budget === 4096 - 400 - 96, 'budget reserves maxTokens + 96, got ' + f.budget);
  ok(f.dropped > 0, 'a 4096 window overrun by 20 turns drops something');
  ok(f.dropped % 2 === 0, 'drops are whole turns (even), got ' + f.dropped);
  ok(f.kept === hist.length - f.dropped, 'kept + dropped === original length');
  ok(f.used <= f.budget, 'what is sent fits the budget');
}

console.log('\n=== a roomy window drops nothing ===');

{
  const win = sandbox({ contextWindow: 131072 });
  const Api = win.Api;
  const hist = bigHistory(20, 900);
  const f = Api.previewContext(hist, { mode: 'chat', style: 'text' }, 'hello');
  ok(f.dropped === 0, '128K window keeps every turn, dropped=' + f.dropped);
  ok(f.kept === hist.length, 'kept === original length');
}

console.log('\n=== the slice drop is counted, not swallowed ===');

{
  /* keep = historyTurns*2 = 4. The trim loop never fires here, so a regression
     that only counts trim drops reports dropped=0 while six turns vanish. */
  const win = sandbox({ contextWindow: 131072, historyTurns: 2 });
  const Api = win.Api;
  const hist = bigHistory(10, 200);
  const f = Api.previewContext(hist, { mode: 'chat', style: 'text' }, 'hi');
  ok(f.kept === 4, 'keep window is respected, kept=' + f.kept);
  ok(f.dropped === 6, 'the 6 turns the slice dropped are counted, got ' + f.dropped);
  ok(f.kept + f.dropped === hist.length,
    'kept + dropped === original length even with a short keep');
}

console.log('\n=== cue changes the prompt, so the meter must pass it ===');

{
  /* buildTurn hands opts.cue to LongTerm.promptBlock(), which picks entries by
     keyword. Dropping the cue made the meter measure a different system prompt
     than chat() builds, and the trim point moved with it. */
  const win = sandbox({ contextWindow: 4096 });
  const Api = win.Api;
  win.LongTerm = {
    promptBlock: function (cue) { return cue ? 'LOGBOOK:' + cue : ''; }
  };
  const hist = bigHistory(20, 900);
  const withCue = Api.previewContext(hist, { mode: 'chat', style: 'text', cue: 'boat' }, 'boat');
  const without = Api.previewContext(hist, { mode: 'chat', style: 'text' }, 'boat');
  /* Compared on a window with no trimming: once the loop trims, both prompts
     converge to the same surviving turns and `used` hides the difference that
     `messages` below still shows. */
  const roomy = sandbox({ contextWindow: 131072 });
  roomy.LongTerm = { promptBlock: function (c) { return c ? 'LOGBOOK:' + c : ''; } };
  const h2 = bigHistory(20, 900);
  const rc = roomy.Api.previewContext(h2, { mode: 'chat', style: 'text', cue: 'boat' }, 'boat');
  const rw = roomy.Api.previewContext(h2, { mode: 'chat', style: 'text' }, 'boat');
  ok(rc.used !== rw.used,
    'cue is load-bearing: used differs with and without it');
  ok(JSON.stringify(withCue.messages) !== JSON.stringify(without.messages),
    'and the posted prompt differs, which is the whole drift risk');

  /* _ctxFit lives in app.js, which needs a full DOM to load. Asserting on the
     source is ugly but it guards the one thing no api-level test can reach:
     that the field is actually forwarded from the UI. */
  const appSrc = fs.readFileSync(path.join(ROOT, 'web/js/app.js'), 'utf8');
  const fit = appSrc.slice(appSrc.indexOf('_ctxFit: function'),
                           appSrc.indexOf('_renderCtxMeter: function'));
  ok(/cue:\s*pending/.test(fit),
    '_ctxFit forwards cue to previewContext (App.say passes `cue: text`)');
  ok(!/catch\s*\(e\)\s*\{\s*return null;\s*\}/.test(fit),
    '_ctxFit does not swallow errors without a trace');

  /* Same reach problem for the colour logic: a history shedding 76 of 100 turns
     still measures a low percentage, so dropped>0 has to drive the crit state
     on its own or the meter reports "fine" while it eats the conversation. */
  const render = appSrc.slice(appSrc.indexOf('_renderCtxMeter: function'),
                              appSrc.indexOf('showView: function'));
  ok(/crit\s*=\s*f\.dropped\s*>\s*0\s*\|\|/.test(render),
    'the crit state triggers on dropped>0, not only on the percentage');
}

console.log('\n=== the trim floor is honest about itself ===');

{
  /* The loop stops at hist.length > 2, so a window too small for even two
     turns still ships an over-budget request. That is a deliberate floor (keep
     the last exchange rather than nothing), but the test must not imply the
     budget is always respected. */
  const win = sandbox({ contextWindow: 2048, maxTokens: 2000 });
  const Api = win.Api;
  /* Fat enough that the two surviving turns cannot fit a 1024 budget. */
  const hist = bigHistory(20, 4000);
  const f = Api.previewContext(hist, { mode: 'chat', style: 'text' }, 'hello');
  ok(f.budget === 1024, 'budget floors at 1024, got ' + f.budget);
  ok(f.kept === 2, 'the floor keeps the last exchange, kept=' + f.kept);
  ok(f.used > f.budget,
    'over-budget is possible at the floor and is reported, not hidden');
  ok(f.dropped > 0, 'and it is reported as drops, dropped=' + f.dropped);
}

console.log('\n=== used is the sum over what is actually sent ===');

{
  /* The invariant that would have caught a real bug: passing the system prompt
     as a raw string to a helper that expected a message object made estTokens
     read undefined, so the system prompt counted as zero bytes and `used`
     under-reported. Every drift check compares two paths, so both can be wrong
     the same way; only an absolute check catches that. */
  const win = sandbox({ contextWindow: 131072 });
  const Api = win.Api;
  const hist = bigHistory(8, 700);
  const f = Api.previewContext(hist, { mode: 'chat', style: 'text' }, 'hello');
  const sum = f.messages.reduce(function (t, m) { return t + 8 + Api.estTokens(m.content); }, 0);
  ok(sum === f.used,
    'used (' + f.used + ') equals the sum over the posted messages (' + sum + ')');
  const sys = f.messages[0];
  ok(Api.estTokens(sys.content) > 50,
    'the system prompt contributes real weight, got ' + Api.estTokens(sys.content));
}

console.log('\n=== the drift guard: meter and chat agree exactly ===');

{
  const capture = {};
  const win = sandbox({ contextWindow: 4096 }, capture);
  const Api = win.Api;
  const hist = bigHistory(20, 900);
  const f = Api.previewContext(hist, { mode: 'chat', style: 'text' }, 'hello');

  Promise.resolve()
    .then(() => Api.chat(hist, 'hello', { mode: 'chat', style: 'text', standalone: true }))
    .catch((e) => { failures++; console.log('  FAIL chat() rejected: ' + (e && e.message)); })
    .then(() => {
      ok(!!capture.body, 'chat() actually issued a request');
      if (!capture.body) return;
      ok(JSON.stringify(capture.body.messages) === JSON.stringify(f.messages),
        'the meter measured exactly the array that was posted');
      const mUser = f.messages.filter((m) => m.role === 'user');
      const sUser = capture.body.messages.filter((m) => m.role === 'user');
      ok(mUser.length === sUser.length && mUser[0].content === sUser[0].content,
        'the pending turn is the one the meter counted');

      /* The dropped turns must actually be absent from what goes out. 20
         alternating messages means 10 user turns, plus the pending one. */
      ok(sUser.length === 11 - f.dropped / 2,
        'exactly the user turns the meter reported are gone, got ' + sUser.length);
      const stillThere = capture.body.messages.filter(
        (m) => / #\d+$/.exec(m.content) && Number(/#(\d+)$/.exec(m.content)[1]) < f.dropped);
      ok(stillThere.length === 0,
        'no dropped turn survived into the request, leaked ' + stillThere.length);
      ok(f.messages.length === 1 + (20 - f.dropped) + 1,
        'posted length matches kept + system + pending');
    })
    .then(() => {
      console.log(failures ? '\nFAILED: ' + failures : '\nall context-meter assertions hold');
      process.exit(failures ? 1 : 0);
    });
}