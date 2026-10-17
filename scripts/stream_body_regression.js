/* Gateway bodies that are not plain JSON: the "Chat failed: HTTP 200: {...}"
   report.

   The gateway this was reported against defaults to streaming whenever a
   request omits `stream`. It answers `content-type: text/event-stream` and
   appends its SSE terminator straight onto the payload, with no newline in
   between. Captured verbatim from it (REAL_BODY below):

       {"choices":[…full completion…]}data: [DONE]\n\ndata: [DONE]\n\n

   JSON.parse rejects that with "Extra data", the reader ended up with a null
   body, and the player was shown the entire response in a toast reading
   `Chat failed: HTTP 200: {"choices":…`. Two separate defects were behind it,
   and this suite pins both:
     * the client never sent `stream: false`, so every chat call came back as a
       stream body this non-streaming reader could not parse;
     * a cue line without its enclosing brackets (the shape this model emits)
       was never parsed, so emotion/attitude were lost AND the raw cue was read
       aloud as dialogue.
   Run: node scripts/stream_body_regression.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.join(__dirname, '..', 'web');
let failures = 0;
const bad = (msg) => { failures++; console.log('  FAIL ' + msg); };
const ok = (cond, name) => { if (cond) console.log('  PASS ' + name); else bad(name); };
const eq = (got, want, name) => {
  if (got === want) console.log('  PASS ' + name);
  else bad(name + ' (got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')');
};

/* Captured byte-for-byte from the gateway named in the header. The completion
   is trimmed to its skeleton; the framing after it is untouched. */
const REAL_BODY = JSON.stringify({
  choices: [{
    finish_reason: 'stop', index: 0,
    message: {
      role: 'assistant',
      content: '|emotion:happy |attitude:agree| undress:off| stage:stage_01\n'
             + '\u30e9\u30a4\u30b6 : Oh, hey! Good morning!\n\u30e9\u30a4\u30b6 : You slept okay?'
    }
  }],
  created: 1792114483, id: 'chatcmpl-a3a4a46c', model: 'cb/deepseek-v4.1-flash',
  object: 'chat.completion',
  usage: { prompt_tokens: 168, completion_tokens: 42, total_tokens: 210 }
}) + 'data: [DONE]\n\ndata: [DONE]\n\n';

const HTML_BODY = '<!DOCTYPE html><html><head><title>502</title></head><body>bad gateway</body></html>';

/* -------------------------------------------------------------- harness */

function makeEnv() {
  const store = {};
  const inflight = [];
  class FakeXHR {
    constructor() { this.headers = {}; inflight.push(this); }
    open(m, u) { this.method = m; this.url = u; }
    setRequestHeader(k, v) { this.headers[k] = v; }
    send(b) { this.sent = true; this.body = b; }
    abort() { if (this.onabort) this.onabort(); }
  }
  const sandbox = {
    console, Math, JSON, Date, Object, Array, String, Number, isFinite, parseInt, parseFloat,
    RegExp, Promise, Set, Map, Infinity, NaN, Error, TextDecoder,
    XMLHttpRequest: FakeXHR,
    location: { origin: 'http://127.0.0.1:8765' },
    navigator: {}, fetch: () => Promise.reject(new Error('no fetch in this suite')),
    document: { getElementById: () => null, createElement: () => ({ style: {} }) }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  vm.createContext(sandbox);
  const load = (f) => vm.runInContext(fs.readFileSync(path.join(WEB, 'js', f), 'utf8'),
                                      sandbox, { filename: f });
  for (const f of ['util.js', 'i18n.js', 'config.js', 'api.js']) load(f);
  sandbox.Config.set('llm.baseUrl', 'https://api.example.test/v1');
  sandbox.Config.set('llm.apiKey', 'sk-test');
  sandbox.Config.set('llm.model', 'test-model');
  return { sandbox, inflight, store };
}

/* Fire a prepared response at the newest in-flight XHR and settle the promise. */
async function drive(env, status, body) {
  const p = env.sandbox.Api.chat([], 'halo', { standalone: true });
  const xhr = env.inflight[env.inflight.length - 1];
  xhr.status = status;
  xhr.responseText = body;
  xhr.getResponseHeader = () => 'application/json';
  xhr.onload();
  try { return { reply: await p }; } catch (e) { return { err: e }; }
}

(async () => {
  console.log('# 1. framing SSE yang ditempel ke body JSON tetap terbaca');
  {
    const env = makeEnv();
    const { reply, err } = await drive(env, 200, REAL_BODY);
    ok(!err, 'the captured body no longer rejects' + (err ? ': ' + err.message : ''));
    if (reply) {
      ok(!/HTTP 200/.test(String(reply.text)), 'the toast wording is gone');
      ok(/\u3088\u3046\u3054\u3056/.test(String(reply.text)) || /Good morning/.test(String(reply.text)),
         'the completion text survived the parse');
    }
    ok(JSON.parse(JSON.stringify(reply || {})).text !== undefined || err, 'a reply object comes back');
  }

  console.log('\n# 2. cue tanpa kurung tidak lagi dibacakan sebagai dialog');
  {
    const env = makeEnv();
    const r = env.sandbox.Api.parseTaggedReply(
      '|emotion:happy |attitude:agree| undress:off| stage:stage_01\n\u30e9\u30a4\u30b6 : \u304a\u306f\u3088\u3046\uff01');
    eq(r.emotion, 'happy', 'emotion read from the bare cue line');
    eq(r.attitude, 'agree', 'attitude read from the bare cue line');
    eq(r.nsfw, false, 'undress:off read from the bare cue line');
    ok(r.state && r.state.current_stage === 'stage_01', 'stage read from the bare cue line');
    ok(!/\|emotion/.test(r.text), 'the raw cue is stripped from the spoken text');
    ok(/\u304a\u306f\u3088\u3046/.test(r.text), 'the dialogue itself is kept');
  }

  console.log('\n# 3. bentuk kurung lama masih jalan (tanpa regresi)');
  {
    const env = makeEnv();
    const r = env.sandbox.Api.parseTaggedReply('[emotion:happy|attitude:agree]\n\u30e9\u30a4\u30b6 : \u3084\u3042');
    eq(r.emotion, 'happy', 'bracket cue still parses');
    eq(r.attitude, 'agree', 'bracket cue still parses attitude');
    ok(!/\[emotion/.test(r.text), 'bracket cue still stripped from the text');
  }

  console.log('\n# 4. baris dialog biasa tidak dimakan');
  {
    const env = makeEnv();
    const prose = env.sandbox.Api.parseTaggedReply('\u30e9\u30a4\u30b6 : \u304a\u306f\u3088\u3046\uff01emotion: happy');
    eq(prose.emotion, null, 'prose with a field name inside it is not treated as a cue');
    ok(/\u304a\u306f\u3088\u3046/.test(prose.text), 'that line survives whole');
    const piped = env.sandbox.Api.parseTaggedReply('\u306f\u3044 | \u3044\u3044\u3048');
    ok(/\u306f\u3044/.test(piped.text) && /\u3044\u3044\u3048/.test(piped.text),
       'a dialogue line with a pipe keeps both halves');
  }

  console.log('\n# 5. setiap permintaan chat mengirim stream:false');
  {
    const env = makeEnv();
    const calls = [
      ['chat', () => env.sandbox.Api.chat([], 'hi', { standalone: true })],
      ['complete', () => env.sandbox.Api.complete('sys', 'hi', {})],
      ['translate', () => env.sandbox.Api.translate('hi', 'ja')]
    ];
    for (const [name, fire] of calls) {
      const before = env.inflight.length;
      fire().catch(() => {});
      const xhr = env.inflight[before];
      let parsed = null;
      try { parsed = JSON.parse(xhr.body); } catch (e) {}
      ok(parsed && parsed.stream === false, name + ' sends stream:false (' +
         (parsed ? JSON.stringify(parsed.stream) : 'body not JSON') + ')');
    }
  }

  console.log('\n# 6. body 200 yang benar-benar tidak terbaca: pesan jelas, bukan dump body');
  {
    const env = makeEnv();
    env.sandbox.I18n.setLang('en');
    const { err } = await drive(env, 200, HTML_BODY);
    ok(!!err, 'an unreadable 200 body rejects');
    const msg = err ? String(err.message) : '';
    ok(!/<!DOCTYPE/.test(msg), 'the raw body is not pasted into the message');
    eq(msg, env.sandbox.I18n.t('api.badBody'), 'the message is the localised explanation');
    ok(!/api\.badBody/.test(msg), 'the key itself is not leaked');
  }

  console.log('\n# 7. pesan transport itu ada di setiap bahasa');
  {
    const env = makeEnv();
    const { I18n } = env.sandbox;
    const live = I18n.lang;
    for (const lg of I18n.LANGS.map((l) => l.id)) {
      I18n.setLang(lg);
      ok(I18n.t('api.badBody') !== 'api.badBody', lg + ': api.badBody is translated');
    }
    I18n.setLang(live);
  }

  console.log('\n# 8. kegagalan non-2xx masih melaporkan status (tanpa regresi)');
  {
    const env = makeEnv();
    const { err } = await drive(env, 500, JSON.stringify({ foo: 1 }));
    ok(!!err, 'a 500 rejects');
    ok(/^HTTP 500/.test(String(err && err.message)), 'the status is still in the message');
  }

  /* The three cases below came out of the first review of this fix, which
     rejected it: each one was a way for the reader to accept something it
     should have refused, or to drop a reply without saying so. */
  console.log('\n# 9. satu field mesin tanpa pemisah BUKAN cue');
  {
    const env = makeEnv();
    for (const line of ['emotion:happy', 'tod: morning', 'stage: 2']) {
      const r = env.sandbox.Api.parseTaggedReply(line);
      eq(r.emotion, null, JSON.stringify(line) + ': not read as a cue');
      eq(r.text, line, JSON.stringify(line) + ': the line survives whole');
    }
    const piped = env.sandbox.Api.parseTaggedReply('|emotion:happy\n\u30e9\u30a4\u30b6 : \u3084\u3042');
    eq(piped.emotion, 'happy', 'a lone field IS a cue when the line opens with a pipe');
    ok(!/\|emotion/.test(piped.text), 'and that cue is stripped from the text');
  }

  console.log('\n# 10. objek yang tersembunyi di body tak terbaca tidak diterima diam-diam');
  {
    const env = makeEnv();
    env.sandbox.I18n.setLang('en');
    const shapes = [
      ['a JSON array with junk after it', '[{"text":"x"}]junk'],
      ['an HTML page with an object inside', '<!DOCTYPE html><html><body>{"a":1}</body></html>']
    ];
    for (const [label, body] of shapes) {
      const { reply, err } = await drive(env, 200, body);
      ok(!!err, label + ': rejected instead of accepted');
      ok(!reply, label + ': no empty reply is handed back');
      eq(err ? String(err.message) : '', env.sandbox.I18n.t('api.badBody'),
         label + ': the localised explanation');
    }
  }

  console.log('\n# 11. stream delta dirakit, bukan diambil potongan terakhirnya');
  {
    const env = makeEnv();
    const delta = [
      { choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] },
      { choices: [{ index: 0, delta: { content: 'ha' } }] },
      { choices: [{ index: 0, delta: { content: 'lo' } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }
    ].map((c) => 'data: ' + JSON.stringify(c) + '\n\n').join('') + 'data: [DONE]\n\n';
    const { reply, err } = await drive(env, 200, delta);
    ok(!err, 'a delta stream does not reject' + (err ? ': ' + err.message : ''));
    ok(reply && reply.text === 'halo',
       'the deltas are concatenated into the full reply (got ' +
       JSON.stringify(reply && reply.text) + ')');
  }

  /* Round two of the review: the remaining ways a line or a reply could still
     be lost, plus the two assembly rules that were previously undocumented. */
  console.log('\n# 12. cue tanpa kurung tidak boleh menghapus baris utuh');
  {
    const env = makeEnv();
    const only = env.sandbox.Api.parseTaggedReply('stage:2, emotion:happy');
    eq(only.text, 'stage:2, emotion:happy',
       'a reply that is nothing but machine fields stays visible');
    const withLine = env.sandbox.Api.parseTaggedReply('stage:2, emotion:happy\n\u30e9\u30a4\u30b6 : \u3084\u3042');
    eq(withLine.emotion, 'happy', 'the same line IS a cue when dialogue follows it');
    eq(withLine.text, '\u30e9\u30a4\u30b6 : \u3084\u3042', 'and only the cue line is removed');
  }

  console.log('\n# 13. aturan perakitan SSE deterministik');
  {
    const env = makeEnv();
    const mixed = [
      { choices: [{ index: 0, delta: { content: 'Hel' } }] },
      { choices: [{ index: 0, delta: { content: 'lo' } }] },
      { choices: [{ index: 0, message: { content: 'Hello' }, finish_reason: 'stop' }] }
    ].map((c) => 'data: ' + JSON.stringify(c) + '\n\n').join('') + 'data: [DONE]\n\n';
    let r = await drive(env, 200, mixed);
    ok(r.reply && r.reply.text === 'Hello',
       'a finished message wins over accumulated deltas (got ' + JSON.stringify(r.reply && r.reply.text) + ')');

    const multi = [
      { choices: [{ index: 0, delta: { content: 'satu' } }, { index: 1, delta: { content: 'DUA' } }] },
      { choices: [{ index: 0, delta: { content: '!' } }, { index: 1, delta: { content: '!' } }] }
    ].map((c) => 'data: ' + JSON.stringify(c) + '\n\n').join('') + 'data: [DONE]\n\n';
    r = await drive(env, 200, multi);
    ok(r.reply && r.reply.text === 'satu!',
       'only choices[0] is assembled, matching the reader (got ' + JSON.stringify(r.reply && r.reply.text) + ')');
  }

  console.log('\n# 14. array di level atas selalu ditolak, dengan atau tanpa sampah');
  {
    const env = makeEnv();
    env.sandbox.I18n.setLang('en');
    const bad = env.sandbox.I18n.t('api.badBody');
    /* An array parses cleanly but carries no choices, and xhrJsonOk accepts any
       truthy value, so returning it as a success produced an empty reply with no
       error anywhere. Refusing it turns that silence into a visible error.
       (Round two asserted the opposite; round four proved that wrong.) */
    const shapes = [
      ['an array that is the whole body', '[{"text":"x"}]'],
      ['an array with junk after it', '[{"text":"x"}]junk'],
      ['a bare scalar', '42']
    ];
    for (const [label, body] of shapes) {
      const { err } = await drive(env, 200, body);
      eq(err ? String(err.message) : '', bad, label + ': refused, not silently emptied');
    }
    const good = await drive(env, 200, '{"choices":[{"message":{"content":"halo"}}]}');
    ok(good.reply && good.reply.text === 'halo', 'a plain object still parses');
  }

  console.log('\n# 16. baris cue harus menghasilkan minimal satu field');
  {
    const env = makeEnv();
    const none = env.sandbox.Api.parseTaggedReply('|emotion:zzz\nHello');
    eq(none.emotion, null, 'an invalid value sets nothing');
    eq(none.text, '|emotion:zzz\nHello',
       'so the line is kept: stripping it would delete text and gain nothing');
    const one = env.sandbox.Api.parseTaggedReply('stage:banana, emotion:happy\nHello');
    eq(one.emotion, 'happy', 'one real field is enough to accept the line');
    eq(one.text, 'Hello', 'and then the cue line is removed');
    const real = env.sandbox.Api.parseTaggedReply(
      '|emotion:happy |attitude:agree| undress:off| stage:stage_01\n\u30e9\u30a4\u30b6 : \u3084\u3042');
    eq(real.emotion, 'happy', 'the shape captured from the real gateway still parses');
    eq(real.text, '\u30e9\u30a4\u30b6 : \u3084\u3042', 'and its dialogue survives');
  }

  console.log('\n# 17. event akhir dengan message.content berbentuk array');
  {
    const env = makeEnv();
    const arr = [
      { choices: [{ index: 0, delta: { content: 'lama' } }] },
      { choices: [{ index: 0, message: { content: [{ text: 'final' }] }, finish_reason: 'stop' }] }
    ].map((c) => 'data: ' + JSON.stringify(c) + '\n\n').join('') + 'data: [DONE]\n\n';
    const { reply, err } = await drive(env, 200, arr);
    ok(!err, 'array-form content does not reject' + (err ? ': ' + err.message : ''));
    ok(reply && reply.text === 'final',
       'the parts array is read as authoritative (got ' + JSON.stringify(reply && reply.text) + ')');
  }

  /* Round five. A 2xx body is not automatically a completion: a proxy can answer
     200 with an error object, and a wrong endpoint answers 200 with anything at
     all. Both used to arrive as an empty reply, which reads as the character
     silently saying nothing. */
  console.log('\n# 18. 2xx tanpa completion bukan balasan kosong');
  {
    const env = makeEnv();
    env.sandbox.I18n.setLang('en');
    const bad = env.sandbox.I18n.t('api.badBody');
    const cases = [
      ['an error object answered with 200', '{"error":{"message":"upstream failed"}}', 'upstream failed'],
      ['a string error answered with 200', '{"error":"boom"}', 'boom'],
      ['an unrelated object', '{"foo":"bar"}', bad],
      ['an empty choices array', '{"choices":[]}', bad]
    ];
    for (const [label, body, want] of cases) {
      const { err } = await drive(env, 200, body);
      eq(err ? String(err.message) : '', want, label + ': surfaces an error, not an empty reply');
    }
    const empty = await drive(env, 200, '{"choices":[{"message":{"content":""}}]}');
    ok(!empty.err && empty.reply && empty.reply.text === '',
       'a genuinely empty completion is still allowed');
  }

  /* Round five, again. `choiceText()` has always read content-parts, but joinSse
     only recognised the string shape, in both directions: a final event written
     as parts lost to the deltas, and a parts-shaped delta was dropped entirely. */
  console.log('\n# 19. content berbentuk parts dibaca di kedua arah');
  {
    const env = makeEnv();
    const ev = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
    const imgOnly = ev({ choices: [{ index: 0, delta: { content: 'kata ' } }] })
      + ev({ choices: [{ index: 0, message: { content: [{ type: 'image_url', image_url: { url: 'x' } }] }, finish_reason: 'stop' }] })
      + 'data: [DONE]\n\n';
    const a = await drive(env, 200, imgOnly);
    ok(!a.err && a.reply && a.reply.text === 'kata',
       'a final event carrying no text does not win over the deltas (got '
       + JSON.stringify(a.reply && a.reply.text) + ')');

    const deltaParts = ev({ choices: [{ index: 0, delta: { content: [{ type: 'text', text: 'ha' }] } }] })
      + ev({ choices: [{ index: 0, delta: { content: [{ type: 'text', text: 'lo' }] } }] })
      + 'data: [DONE]\n\n';
    const b = await drive(env, 200, deltaParts);
    ok(!b.err && b.reply && b.reply.text === 'halo',
       'array-form deltas are accumulated (got ' + JSON.stringify(b.reply && b.reply.text) + ')');

    const mixed = ev({ choices: [{ index: 0, delta: { content: 'lama' } }] })
      + ev({ choices: [{ index: 0, message: { content: [{ type: 'text', text: 'final' }] } }] })
      + 'data: [DONE]\n\n';
    const c = await drive(env, 200, mixed);
    ok(!c.err && c.reply && c.reply.text === 'final',
       'a final event with real text still wins (got ' + JSON.stringify(c.reply && c.reply.text) + ')');
  }

  /* Round six. requireCompletion() only checked that `choices` was non-empty, so
     a choice with no usable content still slipped through and produced a blank
     bubble. The rule is now exactly what choiceText() can read. */
  console.log('\n# 20. choices ada tapi isinya tidak terbaca tetap ditolak');
  {
    const env = makeEnv();
    env.sandbox.I18n.setLang('en');
    const bad = env.sandbox.I18n.t('api.badBody');
    const shapes = [
      ['a choice with an empty message', '{"choices":[{"message":{}}]}'],
      ['a choice with null content', '{"choices":[{"message":{"content":null}}]}'],
      ['a choice with numeric content', '{"choices":[{"message":{"content":42}}]}'],
      ['a choice with no message at all', '{"choices":[{}]}']
    ];
    for (const [label, body] of shapes) {
      const { err } = await drive(env, 200, body);
      eq(err ? String(err.message) : '', bad, label + ': refused instead of shown blank');
    }
    /* The one shape that must stay allowed. */
    const empty = await drive(env, 200, '{"choices":[{"message":{"content":""}}]}');
    ok(!empty.err && empty.reply && empty.reply.text === '',
       'an explicitly empty string is still a real answer');
    /* And the shape the app actually receives. */
    const real = await drive(env, 200, '{"choices":[{"message":{"content":"halo"}}]}');
    ok(!real.err && real.reply && real.reply.text === 'halo', 'a normal completion is untouched');

    /* complete() reads the same guard, so it gets the same case. */
    const p = env.sandbox.Api.complete('sys', 'user');
    const xhr = env.inflight[env.inflight.length - 1];
    xhr.status = 200;
    xhr.responseText = '{"choices":[{"message":{}}]}';
    xhr.getResponseHeader = () => 'application/json';
    xhr.onload();
    let cerr = null;
    try { await p; } catch (e) { cerr = e; }
    eq(cerr ? String(cerr.message) : '', bad, 'complete() refuses it too');
  }

  console.log(failures ? '\nSTREAM BODY: ' + failures + ' FAILURES' : '\nSTREAM BODY: ALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
