/* Headless regression for sentence-level speech chunking (turn.js).
   Run:  node scripts/tts_chunk_regression.js

   Why this exists
   ---------------
   One reply used to be one synthesis request, so the first sound arrived
   only after the whole paragraph had been rendered. The turn layer now
   splits a reply into sentences and plays them back to back. Two things
   break silently if that is done carelessly, and both are asserted below:
   the utterance must stay ONE intent (a fake `end` per sentence re-arms the
   microphone cooldown and releases the bubble), and `speak` must fire once
   (Voice.noteAssistantSpeechStarted restarts the 700 ms first-sentence
   guard, which would block barge-in for the whole reply).
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms || 0));

/* turn.js needs Promise, URL, AbortController and a global object; no DOM and
   no storage, which is the whole point of its port design. */
function boot() {
  const sandbox = {
    console: console, setTimeout: setTimeout, clearTimeout: clearTimeout,
    Promise: Promise, JSON: JSON, Math: Math, String: String, Number: Number,
    Object: Object, Array: Array, RegExp: RegExp, Error: Error,
    URL: { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} },
    AbortController: AbortController
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(WEB, 'turn.js'), 'utf8'),
                  sandbox, { filename: 'turn.js' });
  return sandbox.Turn;
}

/* Synthesis resolves immediately and records what it was handed. The player is
   hand-driven, so "while clip 1 plays" is a real state to assert on. */
function rig(Turn) {
  Turn.setChunking(true);
  const synths = [];
  const plays = [];
  const events = [];
  Turn.setSynth(function (text, meta) {
    synths.push({ text: text, meta: meta });
    return Promise.resolve('blob:' + synths.length);
  });
  Turn.setPlayer(function (url, signal) {
    return new Promise(function (resolve) {
      const p = { url: url, signal: signal, end: resolve };
      plays.push(p);
      if (signal && signal.addEventListener) signal.addEventListener('abort', resolve);
    });
  });
  Turn.on(function (ev) { events.push(ev); });
  return { synths: synths, plays: plays, events: events };
}

/* Let the hand-driven player finish every clip the turn layer asks for. The
   first clip is not playing yet when speak() returns, so wait before looking. */
async function drain(r, Turn) {
  let guard = 0;
  while (guard++ < 200) {
    await sleep();
    if (r.plays.length) { r.plays.shift().end(); continue; }
    if (Turn.state() === Turn.IDLE) return;
  }
}

(async function () {
  const watchdog = setTimeout(function () {
    console.log('  FAIL watchdog: the test itself hung');
    process.exit(1);
  }, 15000);

  console.log('\n=== 0. off unless the host asks for it ===');

  {
    const Turn = boot();
    const r = rig(Turn);
    /* The shipped default: one request per reply, exactly as before chunking
       existed. A provider that prefixes a delivery cue per request (Fish) is
       unusable any other way. */
    Turn.setChunking(false);
    Turn.speak('はい。うん。そう。', { mode: 'chat' });
    await drain(r, Turn);
    ok(r.synths.length === 1 && r.synths[0].text === 'はい。うん。そう。',
       'A0 chunking is off by default, so a reply is one request');
  }

  console.log('\n=== A. how a reply is cut ===');

  {
    const Turn = boot();
    const r = rig(Turn);
    Turn.speak('ひとつだけ', { mode: 'chat' });
    await sleep();
    ok(r.synths.length === 1 && r.synths[0].text === 'ひとつだけ',
       'A1 a one-sentence reply is one clip, unchanged');
    ok(!('chunk' in r.synths[0].meta), 'A2 and its meta carries no chunk index');
    await drain(r, Turn);
  }

  {
    const Turn = boot();
    const r = rig(Turn);
    Turn.speak('はい。うん。そう。', { mode: 'chat' });
    await sleep();
    ok(r.synths.length === 2,
       'A3 the second clip is already being synthesized while the first plays');
    await drain(r, Turn);
    ok(r.synths.map((s) => s.text).join('|') === 'はい。|うん。|そう。',
       'A4 three Japanese sentences become three clips, in order');
    ok(r.synths.map((s) => s.text).join('') === 'はい。うん。そう。',
       'A5 no character is lost at a boundary');
    ok(r.synths[0].meta.chunk === 0 && r.synths[2].meta.chunk === 2 &&
       r.synths[0].meta.chunkCount === 3,
       'A6 a multi-clip reply tells the synth port which clip it is');
  }

  {
    const Turn = boot();
    const r = rig(Turn);
    Turn.speak('3.5 リットル。Hello there. How are you?', { mode: 'chat' });
    await drain(r, Turn);
    ok(r.synths.map((s) => s.text).join('|') ===
       '3.5 リットル。|Hello there.|How are you?',
       'A7 a decimal point is not a sentence end, an English full stop is');
  }

  {
    const Turn = boot();
    const r = rig(Turn);
    const long = 'あ'.repeat(400) + '。';
    Turn.speak(long, { mode: 'chat' });
    await drain(r, Turn);
    ok(r.synths.length === 3 && r.synths.every((s) => s.text.length <= 160),
       'A8 a 400-character sentence with no punctuation is cut at 160 characters');
    ok(r.synths.map((s) => s.text).join('') === long,
       'A9 and the long reply loses nothing');
  }

  {
    const Turn = boot();
    const r = rig(Turn);
    Turn.speak('「そう。」って言った。', { mode: 'chat' });
    await drain(r, Turn);
    ok(r.synths.length === 2 && r.synths[0].text === '「そう。」' &&
       r.synths[1].text === 'って言った。',
       'A10 a closing quote stays with the clip it closes, not the next one');
  }

  console.log('\n=== B. one utterance, not three ===');

  {
    const Turn = boot();
    const r = rig(Turn);
    Turn.speak('いち。に。さん。', { mode: 'chat' });
    await sleep();
    ok(Turn.waiting() === 0, 'B1 the clips are not queued intents');
    ok(Turn.state() === Turn.SPEAKING, 'B2 the turn stays speaking across a boundary');
    ok(r.events.filter((e) => e.type === 'speak').length === 1,
       'B3 speak fires once, so the first-sentence guard is not re-armed per clip');
    ok(r.events.filter((e) => e.type === 'state' && e.state === 'idle').length === 0,
       'B4 no idle flicker between clips');
    await drain(r, Turn);
    ok(r.events.filter((e) => e.type === 'end').length === 1 &&
       Turn.state() === Turn.IDLE,
       'B5 exactly one end, when the last clip finishes');
  }

  console.log('\n=== C. an interruption still cuts the whole reply ===');

  {
    const Turn = boot();
    const r = rig(Turn);
    Turn.speak('いち。に。さん。よん。', { mode: 'chat' });
    await sleep();
    r.plays[0].end();
    await sleep();
    ok(r.plays.length === 2, 'C1 the second clip is playing');
    const before = r.plays.length;
    Turn.stopAll('barge-in');
    await sleep();
    ok(r.events.filter((e) => e.type === 'cancel').length === 1, 'C2 one cancel');
    ok(r.events.filter((e) => e.type === 'end').length === 0,
       'C3 a cancelled utterance reports cancel, never end');
    ok(r.plays.length === before, 'C4 the prefetched clip is not played');
    ok(Turn.state() === Turn.IDLE, 'C5 and the turn is idle');
  }

  console.log('\n=== D. a clip that fails to synthesize ===');

  {
    const Turn = boot();
    const plays = [];
    let n = 0;
    Turn.setChunking(true);
    Turn.setSynth(function () {
      n++;
      if (n === 2) return Promise.reject(new Error('NO_KEY'));
      return Promise.resolve('blob:' + n);
    });
    Turn.setPlayer(function (url) {
      return new Promise(function (res) { plays.push({ url: url, end: res }); });
    });
    const events = [];
    Turn.on((e) => events.push(e));
    Turn.speak('いち。に。さん。', { mode: 'chat' });
    await sleep();
    plays[0].end();
    await sleep();
    ok(events.filter((e) => e.type === 'error').length === 1,
       'D1 the failing clip reports an error');
    ok(plays.length === 1, 'D2 the clip after the failure is never played');
    ok(Turn.state() === Turn.IDLE,
       'D3 and the turn is idle, so the microphone is not deaf for the session');
  }

  console.log('\n=== E. a failed clip is reported before the turn moves on ===');

  {
    const Turn = boot();
    const synths = [];
    const events = [];
    let n = 0;
    Turn.setSynth(function (t) {
      synths.push(t);
      n++;
      if (n === 1) return Promise.reject(new Error('NO_KEY'));
      return Promise.resolve('blob:' + n);
    });
    Turn.setPlayer(function () { return new Promise((r) => setTimeout(r, 5)); });
    Turn.on(function (e) {
      events.push(e);
      /* A listener starting something new from the error event must get a
         real intent, not one silently swallowed by the turn moving on. */
      if (e.type === 'error') Turn.speak('つぎのひとこと', { mode: 'chat' });
    });
    Turn.speak('いち。に。', { mode: 'chat' });
    await sleep(150);
    const errAt = events.findIndex((e) => e.type === 'error');
    const endAt = events.findIndex((e) => e.type === 'end');
    ok(errAt >= 0 && endAt >= 0 && errAt < endAt,
       'E1 error is reported before the end it explains');
    ok(synths.indexOf('つぎのひとこと') === 1,
       'E2 an intent started from the error listener still runs');
    ok(Turn.state() === Turn.IDLE && Turn.waiting() === 0,
       'E3 and the queue drains');
  }

  console.log('\n--- 汇总 ---');
  clearTimeout(watchdog);
  console.log(failures ? '结果: FAIL (' + failures + ' 项)' : '结果: OK');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('tts_chunk_regression crashed: ' + (e && e.stack || e));
  process.exit(1);
});
