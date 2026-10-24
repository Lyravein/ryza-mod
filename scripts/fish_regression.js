/* fish.js: cue tables and the roleplay action rewriter.

   Two things are checked here, both of which produced a real, audible defect
   in the old app before they were written down:

   1. ACTION REWRITING. Fish performs [bracketed] spans and reads *asterisk*
      spans out loud, as the words "asterisk giggles asterisk". So a line the
      model wrote as an action has to be converted before synthesis. Two ways
      to get this wrong are pinned below, one in each direction:

        - OVER-REACH: rewriting a normal aside such as "(he left. I stayed)"
          would delete real dialogue from the audio, so spans holding sentence
          punctuation are refused.
        - UNDER-REACH: two actions written back to back with no space between
          ("（笑）（泣く）", "(a)(b)") are both actions, and an earlier version of
          the rule rewrote only the first. The second was left intact, and
          because Fish reads that markup aloud as words, the tail of the line
          got narrated as "kakko warau" instead of performed.

      The two rules that come out of that: a span's body may not contain the
      same parens (so nesting is never mistaken for two actions), and the
      opening delimiter needs no preceding character (so adjacent spans are
      both seen). They look contradictory and are not: nesting is excluded by
      what is INSIDE the span, adjacency by what is OUTSIDE it.

   2. CUE SELECTION. The shipped reference clip is a calm line, so a clone
      with no cue inherits that flat energy. Mode beats emotion (a whole-line
      delivery style is more specific than a momentary feeling), an unknown
      emotion contributes nothing rather than throwing, and `neutral` maps to
      the empty string instead of to a cue that would say "be neutral" and
      flatten the line further.

   Run: node scripts/fish_regression.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let failures = 0;
const bad = (m) => { failures++; console.log('  FAIL ' + m); };
const ok = (c, m) => { if (c) console.log('  PASS ' + m); else bad(m); };
const eq = (got, want, m) => ok(got === want, m + (got === want ? '' :
  '  (got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')'));

/* Load the real file into a sandbox, the same way the browser does: it is a
   plain script that attaches itself to a global. Nothing here re-implements
   the logic under test: every assertion below calls the shipped functions.

   The sandbox deliberately contains NO Avatar: fish.js is in the io layer and
   is fed the emotion as an argument, so a regression that reached back out to
   renderer state would show up here as a cue that never arrives. */
function loadFish(sandbox) {
  const src = fs.readFileSync(path.join(ROOT, 'web', 'js', 'fish.js'), 'utf8');
  const ctx = Object.assign({ console: console }, sandbox || {});
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  if (!ctx.Fish) throw new Error('fish.js did not attach global.Fish');
  return ctx;
}

console.log('=== 1. action markup is rewritten so Fish performs it ===');
{
  const F = loadFish().Fish;
  const cases = [
    ['*giggles*', '[giggles]', 'single asterisk span'],
    ['*tangan ke wajah, menutupi pipi yang panas*', '[tangan ke wajah, menutupi pipi yang panas]', 'long roleplay action from reported chat'],
    ['*' + 'x'.repeat(120) + '*', '[' + 'x'.repeat(120) + ']', 'action at the expanded cap'],
    ['*' + 'x'.repeat(121) + '*', '*' + 'x'.repeat(121) + '*', 'over-cap aside remains text'],
    ['へへ、*giggles* そう？', 'へへ、[giggles] そう？', 'span inside a sentence'],
    ['（こっそり）ねえ', '[こっそり]ねえ', 'full-width CJK parens'],
    ['(sighs)', '[sighs]', 'short half-width span'],
    ['a *b* and *c* here', 'a [b] and [c] here', 'two spans'],
    ['*nested * inner*', '[nested ] inner*', 'unbalanced asterisks: only the pair closes'],
    /* Markdown emphasis is not an action, and the safe response to ambiguity
       is to leave the span alone. Rewriting the inner pair of `**bold**`
       would emit `*[bold]*`, turning `[bold]` into a cue while the leftover
       asterisks are read aloud; leaving the whole span verbatim costs only a
       missed cue. These two fail if the rewrite ever becomes greedy again. */
    ['**giggles**', '**giggles**', 'double asterisks left untouched'],
    ['***x***', '***x***', 'triple asterisks left untouched'],
    ['**bold** and *giggles*', '**bold** and [giggles]', 'emphasis survives beside a real action'],
    ['*multi\nline*', '*multi\nline*', 'a span cannot cross a newline'],
    ['****', '****', 'empty span is not an action'],
    ['plain text', 'plain text', 'no markup is untouched'],
    ['', '', 'empty string'],
    [null, '', 'null does not throw'],
    [undefined, '', 'undefined does not throw']
  ];
  cases.forEach(([inp, want, what]) => eq(F.actionsToCues(inp), want, what));
}

console.log('\n=== 1b. back-to-back actions are ALL rewritten (under-reach guard) ===');
{
  const F = loadFish().Fish;
  const cases = [
    /* These three are the regression that motivated the rule change. With no
       space between the spans, a "must be preceded by a non-paren char" guard
       let one span consume the position the next one needed, and the second
       span reached Fish as literal markup. */
    ['（笑）（泣く）', '[笑][泣く]', 'adjacent full-width spans, no space'],
    ['(a)(b)', '[a][b]', 'adjacent half-width spans, no space'],
    ['*giggles*（笑）', '[giggles][笑]', 'a mixed pair, touching'],
    ['（笑） と（泣く）', '[笑] と[泣く]', 'adjacent spans with text between'],
    ['（笑）（泣く）（怒る）', '[笑][泣く][怒る]', 'three adjacent spans'],
    /* Nesting pulls the other way and must not be broken by the fix above:
       an inner pair must never be lifted out of its outer one. */
    ['（（こういうの））', '（（こういうの））', 'nested full-width -> left whole'],
    ['((x))', '((x))', 'nested half-width -> left whole'],
    /* KNOWN LIMIT, asserted so it cannot quietly get worse: when the outer
       aside is longer than one span, the matcher still settles on the inner
       pair. Refusing it needs a spanning negative lookahead ("no closer
       between opener and closer"), which JavaScript does not have. What is
       lost is the outer delimiters, not the words. If this ever becomes a
       clean pass, the limit is gone and the header comment should say so. */
    ['（これは（とても）長い）', '（これは[とても]長い）', 'LIMIT: long span nesting still settles inward'],
    /* Adjacent AND nested in one line: the two rules have to coexist. */
    ['（笑）（（内緒）です）', '[笑]（（内緒）です）', 'adjacent span beside a nested one']
  ];
  cases.forEach(([inp, want, what]) => eq(F.actionsToCues(inp), want, what));
}

console.log('\n=== 2. a real aside must survive (over-reach guard) ===');
{
  const F = loadFish().Fish;
  const cases = [
    ['(he left. I stayed)', '(he left. I stayed)', 'period inside -> prose, kept'],
    ['（これは文です。です）', '（これは文です。です）', 'CJK period inside -> kept, not a cue'],
    ['(really?)', '(really?)', 'question mark inside -> kept'],
    ['(まじで！)', '(まじで！)', 'full-width bang -> kept'],
    /* A long span is prose even without punctuation: the cap is 30 chars for
       the half-width form, so this cannot be swallowed as an action. */
    ['(' + 'x'.repeat(31) + ')', '(' + 'x'.repeat(31) + ')', 'over-length span -> kept'],
    ['(' + 'x'.repeat(29) + ')', '[' + 'x'.repeat(29) + ']', 'just under the cap -> rewritten']
  ];
  cases.forEach(([inp, want, what]) => eq(F.actionsToCues(inp), want, what));
}

console.log('\n=== 3. cue selection ===');
{
  const F = loadFish().Fish;
  eq(F.cueFor('asmr', ''), F.MODE_CUE.asmr, 'mode cue wins');
  eq(F.cueFor('story', 'happy'), F.MODE_CUE.story, 'mode beats emotion');
  eq(F.cueFor('chat', 'happy'), F.EMOTION_CUE.happy, 'emotion used when mode has none');
  eq(F.EMOTION_CUE.shy, '[clear, natural conversational voice, slightly flustered, steady breath, no sighs or gasps]',
     'shy cue avoids breathy/sighing direction');
  eq(F.cueFor('chat', 'shy'), F.EMOTION_CUE.shy, 'shy cue is selected in chat mode');
  eq(F.cueFor('', 'happy'), F.EMOTION_CUE.happy, 'empty mode falls through to emotion');
  eq(F.cueFor('chat', 'neutral'), '', 'neutral maps to the empty cue');
  eq(F.cueFor('chat', 'nonexistent'), '', 'unknown emotion contributes nothing');
  eq(F.cueFor(undefined, undefined), '', 'nothing known -> no cue, no throw');
  /* Music-mode 'chat' is the default talk mode and has no cue, so a plain
     line must not silently gain one. */
  eq(F.cueFor('chat', ''), '', 'chat + no emotion -> no cue');
}

console.log('\n=== 4. the emotion arrives as an argument and nowhere else ===');
{
  /* The io layer may not read renderer state, so the emotion is a parameter.
     A hostile global must not change the answer: if fish.js ever reaches for
     an Avatar again, these stop being empty. */
  const F = loadFish({ Avatar: { _emotion: 'shy' } }).Fish;
  eq(F.cueFor('chat', ''), '', 'a present Avatar._emotion is ignored, not read');
  eq(F.cueFor('chat', 'angry'), F.EMOTION_CUE.angry, 'the passed emotion is what counts');
  const broken = loadFish({ Avatar: {} }).Fish;
  eq(broken.cueFor('chat', ''), '', 'no _emotion on Avatar -> still no cue, no throw');
  /* The sole caller passes it through from the turn: app.js -> Api.speak ->
     _fishSpeak -> here. This is the wiring that replaces the global it used
     to read, so it is asserted rather than assumed. */
  const api = fs.readFileSync(path.join(ROOT, 'web', 'js', 'api.js'), 'utf8');
  ok(/Fish\.prepare\(text, mode, emotion\)/.test(api),
     'api.js passes mode and emotion into prepare()');
}

console.log('\n=== 5. prepare() composes both, in the right order ===');
{
  const F = loadFish().Fish;
  eq(F.prepare('*tangan ke wajah, menutupi pipi yang panas*', 'chat', 'shy'),
     F.EMOTION_CUE.shy + ' [tangan ke wajah, menutupi pipi yang panas]',
     'reported long roleplay action is rewritten before Fish synthesis');
  eq(F.prepare('*' + 'x'.repeat(121) + '*', 'chat', 'neutral'),
     '*' + 'x'.repeat(121) + '*', 'over-cap text remains unchanged');
  eq(F.prepare('*giggles* hello', 'chat', 'happy'),
     F.EMOTION_CUE.happy + ' [giggles] hello', 'cue is prepended AFTER rewriting');
  eq(F.prepare('hello', 'chat', 'neutral'), 'hello', 'no cue -> text unchanged');
  eq(F.prepare('', 'asmr', ''), F.MODE_CUE.asmr + ' ', 'empty text still cues');
  /* The cue must not be rewritten as if it were authored markup: it is
     prepended last, so a bracketed cue survives verbatim. */
  const withCue = F.prepare('x', 'chat', 'happy');
  ok(withCue.indexOf(F.EMOTION_CUE.happy) === 0, 'the cue appears verbatim, first');
}

console.log('\n=== 6. the file is wired into the page ===');
{
  const html = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');
  ok(/<script src="js\/fish\.js/.test(html), 'index.html loads fish.js');
  /* Load order matters: api.js reads window.Fish at synthesis time, so a
     missing script tag would silently disable cues with no error anywhere. */
  const apiAt = html.indexOf('js/api.js');
  const fishAt = html.indexOf('js/fish.js');
  ok(apiAt !== -1 && fishAt !== -1, 'both api.js and fish.js are referenced');
  const api = fs.readFileSync(path.join(ROOT, 'web', 'js', 'api.js'), 'utf8');
  ok(/window\.Fish && window\.Fish\.prepare/.test(api),
     'api.js guards on window.Fish, so a load-order miss degrades to raw text');
  ok(/text: spoken/.test(api), 'the modern Fish surface sends the prepared text');
  const legacy = api.slice(api.indexOf('function synthLegacy'));
  ok(/text: spoken/.test(legacy), 'the legacy Fish surface also sends the prepared text');
}

console.log('\n=== 7. the architecture guard can see this file ===');
{
  /* The boundary guard only scans modules declared in config/layers.json, so
     an undeclared file is invisible to it: the file was correct and unchecked
     at the same time. Declared as io, the guard also proves the io layer does
     not read Avatar. */
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'layers.json'), 'utf8'));
  eq(cfg.modules.fish, 'io', 'fish is declared, as io');
  ok(Array.isArray(cfg.globals.fish) && cfg.globals.fish.indexOf('Fish') !== -1,
     'the Fish global is declared');
  const src = fs.readFileSync(path.join(ROOT, 'web', 'js', 'fish.js'), 'utf8');
  /* Strip block comments and line comments before looking for the name: the
     header deliberately says "reads neither Avatar nor Config", and a plain
     word search would count that sentence as a violation. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/Avatar\b/.test(code), 'fish.js mentions Avatar only in comments, never in code');
}

console.log('\n' + (failures ? 'FISH: ' + failures + ' FAILURES' : 'FISH: ALL PASS'));
process.exit(failures ? 1 : 0);
