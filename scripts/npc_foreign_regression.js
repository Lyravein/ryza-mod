/* Guard: a reply whose second half is written in another script.

   What went wrong (2026-10-23): the prompt says "do not rewrite the same thing in
   another language", and the model did it anyway — an Indonesian answer followed
   by the same content in Chinese, no 译文 label, so both halves showed up in the
   bubble and both went to TTS. npc.js now drops a sentence when more than half of
   its characters are CJK, and only when the reply language is not CJK.

   What this asserts: the drop happens, it does not eat ordinary Indonesian that
   merely mentions a Japanese name, ja/zh/zh-tw are untouched, a reply that is
   Chinese *only* still shows (empty bubble is worse), and 译文 beats are left
   alone because _sayReply falls back to them. */
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'web/js/npc.js'), 'utf8');

let lang = 'id';
const ctx = { console: console, Langs: { llm: () => lang } };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx);
const Npc = ctx.Npc;

let fails = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  PASS ' + name); return; }
  fails++;
  console.log('  FAIL ' + name + (detail ? '\n       ' + detail : ''));
}
function say(text, lg) {
  lang = lg || 'id';
  return Npc.split(text);
}

console.log('NPC FOREIGN-SCRIPT GUARD\n');

/* 1. The observed shape: her line, then the same line in Chinese. */
let b = say('*senyum lebar* itu sudah cukup bikin aku seneng kok.\n' +
            '不是"直接交往"的意思啦……只是……*脸红*\n' +
            '但放心啦，我不会追着你跑或者逼你现在回答的！');
check('a Chinese line after an Indonesian one is dropped', b.length === 1,
  JSON.stringify(b.map((x) => x.text)));
check('the Indonesian line survives verbatim',
  b[0] && b[0].text === '*senyum lebar* itu sudah cukup bikin aku seneng kok.',
  JSON.stringify(b[0] && b[0].text));

/* 2. Same leak inside one line, split by a full-width stop. */
b = say('Aku siap kalau kamu mau! 但放心啦，我不会逼你的！');
check('a Chinese sentence glued to an Indonesian one is dropped',
  b[0] && b[0].text === 'Aku siap kalau kamu mau!', JSON.stringify(b[0] && b[0].text));

/* 3. A Japanese name inside an Indonesian sentence is not "foreign text". */
b = say('Aku ingat クーケン島, tempat kita bertemu pertama kali.');
check('an Indonesian line with a Japanese name is kept',
  b[0] && b[0].text.indexOf('クーケン島') !== -1, JSON.stringify(b[0] && b[0].text));

/* 4. CJK reply languages are untouched. */
b = say('おはよう、いい朝ね。\n今日も錬金日和だよ！', 'ja');
check('ja keeps both lines', b.length === 2 && b[1].text.indexOf('錬金') !== -1,
  JSON.stringify(b.map((x) => x.text)));
b = say('早上好，今天也适合炼金。', 'zh');
check('zh keeps Chinese', b[0] && b[0].text === '早上好，今天也适合炼金。',
  JSON.stringify(b[0] && b[0].text));

/* 5. Nothing but Chinese: keep it rather than show an empty bubble. */
const only = '只有译文没有台词';
b = say(only);
check('a Chinese-only reply still reaches the bubble', b[0] && b[0].text === only,
  JSON.stringify(b[0] && b[0].text));

/* 6. 译文 beats are not filtered: _sayReply falls back to them. */
b = say('莱莎：おはよう\n译文：早上好');
check('the 译文 beat keeps its text',
  b.some((x) => x.speaker === 'translation' && x.text === '早上好'),
  JSON.stringify(b));

/* 7. Her spoken line stays clean, so TTS never reads the Chinese half. */
b = say('Selamat pagi!\n早上好！');
check('spokenText carries no Chinese', Npc.spokenText(b) === 'Selamat pagi!',
  JSON.stringify(Npc.spokenText(b)));

console.log(fails ? '\nNPC FOREIGN-SCRIPT: ' + fails + ' FAIL'
                   : '\nNPC FOREIGN-SCRIPT: ALL PASS');
process.exit(fails ? 1 : 0);
