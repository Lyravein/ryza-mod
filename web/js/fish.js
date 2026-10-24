/* fish.js: Fish Audio expressiveness, in the io layer.

   Fish only performs TWO kinds of markup, and both are handled here rather
   than in api.js. Both are pure string handling: no DOM, no network, and no
   renderer state.

   This file exists because the old app shipped the same logic inside its own
   fishfree.js provider. That provider was a whole separate TTS backend; this
   app has one provider registry, so the two things actually worth keeping (the
   cue tables and the action rewriter) are kept, and the duplicate
   transport is not. Re-adding a second provider to carry 40 lines of string
   handling would have re-created the exact duplication the registry was
   built to remove.

   ---- what Fish reads, and what it performs ---------------------------

     1. CUES. s2.1-pro reads an inline natural-language instruction in
        [brackets] and changes delivery accordingly. The shipped reference
        clip is a calm line, so a clone with no cue inherits that flat
        energy. The caller (api.js) already knows the character's current
        emotion and the talk mode and passes both in, so this file reads
        neither Avatar nor Config.

     2. ACTIONS. Models write roleplay actions as *giggles* or （giggles）.
        Fish reads those LITERALLY: it says "asterisk giggles asterisk".
        Written as [giggles] it performs them. So the spans are rewritten
        before synthesis. Only the text sent to TTS is touched; the on-screen
        bubble keeps the original markup. */
(function (global) {
  'use strict';

  /* Delivery styles, keyed by talk mode. A mode cue is a style for the whole
     line, so it takes priority over the momentary emotion. */
  var MODE_CUE = {
    asmr:      '[whispering softly and intimately, close to the ear]',
    immersive: '[breathy and emotional]',
    story:     '[gentle expressive narration]'
  };

  /* Momentary emotion, keyed by the emotion string the caller passes in. */
  var EMOTION_CUE = {
    neutral:  '',
    happy:    '[cheerful and warm]',
    laughing: '[laughing brightly]',
    tease:    '[teasing and playful]',
    shy:      '[clear, natural conversational voice, slightly flustered, steady breath, no sighs or gasps]',
    cuddle:   '[soft, affectionate and sweet]',
    sad:      '[sad and downcast]',
    crying:   '[crying, voice trembling]',
    angry:    '[annoyed and pouting]'
  };

  /* Resolve the cue for a line. Mode wins over emotion: the mode is a
     delivery style for the whole line, the emotion is momentary. */
  function cueFor(mode, emotion) {
    if (mode && MODE_CUE[mode]) return MODE_CUE[mode];
    if (emotion && EMOTION_CUE[emotion]) return EMOTION_CUE[emotion];
    return '';
  }

  /* Rewrite roleplay action markup into Fish's instruction syntax.

     Three things must hold at once here, and they pull in different
     directions, so each is spelled out rather than left to the regex alone:

     - ADJACENT spans are both actions. `（笑）（泣く）` and `(a)(b)` are two
       deliveries in a row, and models do write them with no space between.
       So the rule matches the span on its own and never captures a character
       in front of it. Capturing one would make the first span consume the
       position the second one needs, which is how the second span used to
       survive into the audio and get read aloud as the words "kakko warau".

     - NESTED parens are never an action. `（（こういうの））` is one aside, not
       two. The span body refuses both parens, and a span whose closer is
       followed by another closer is refused. The third case is a span sitting
       directly inside an outer pair, `（（内緒）です）`, which the body rule
       cannot catch on its own, so the callback looks at the character before
       the match and refuses when it is an opening paren. That check is done
       against the offset rather than in the pattern because a lookbehind is
       not available on every WebView the APK can land on, and a pattern that
       fails to parse takes the whole file down, not just this rule.

       One case stays open on purpose: a span nested in an outer pair that is
       ALSO longer than one span, `（これは（とても）長い）`, still settles on
       the inner pair. Refusing it needs "no closer between opener and
       closer", and JavaScript has no spanning negative lookahead to say that
       the way PCRE does. The damage is bounded to losing the outer delimiters:
       the words are performed, and the outer （ ） is read aloud as a short
       pause, while the alternative this replaced, a captured lead character,
       silently dropped a whole action from the audio. Prose of this shape
       barely occurs, because the sentence-punctuation rule below already
       keeps real asides out of the way.

     A span holding sentence punctuation is left alone: `(quietly. then he
     left)` is narration, not a delivery instruction.

     Asterisk spans keep their `[^*]` lead guard on purpose: `**bold**` and
     `***x***` are emphasis, and `*a**b*` is left alone rather than rewritten
     into something that reads worse. */
  function actionsToCues(s) {
    s = String(s == null ? '' : s);
    s = s.replace(/(^|[^*])\*([^*\n]{1,120}?)\*(?!\*)/g, '$1[$2]');
    s = s.replace(/（([^（）\n]{1,40}?)）(?!）)/g, function (m, inner, off, whole) {
      if (off > 0 && whole.charAt(off - 1) === '（') return m;
      return /[.!?。！？]/.test(inner) ? m : '[' + inner + ']';
    });
    s = s.replace(/\(([^()\n]{1,30}?)\)(?!\))/g, function (m, inner, off, whole) {
      if (off > 0 && whole.charAt(off - 1) === '(') return m;
      return /[.!?。！？]/.test(inner) ? m : '[' + inner + ']';
    });
    return s;
  }

  /* Full preparation for one line: actions first, then the cue, because a
     cue prepended before rewriting would have its own brackets examined as
     if they were authored markup. */
  function prepare(text, mode, emotion) {
    var spoken = actionsToCues(text);
    var cue = cueFor(mode, emotion);
    return cue ? cue + ' ' + spoken : spoken;
  }

  global.Fish = {
    EMOTION_CUE: EMOTION_CUE,
    MODE_CUE: MODE_CUE,
    cueFor: cueFor,
    actionsToCues: actionsToCues,
    prepare: prepare
  };
})(typeof window !== 'undefined' ? window : globalThis);
