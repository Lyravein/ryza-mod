#!/usr/bin/env node
/*
 * Unit test for scripts/lib/i18n_cjk.js, the shared definition of "this
 * text is in a CJK script".
 *
 * It exists because two checks depend on this one answer, and the case that
 * makes it non-obvious is the fullwidth maths signs: U+FF0B (＋) and
 * U+FF0D (－) sit inside the fullwidth-forms block but are the zoom buttons'
 * icon glyphs, not language. If someone "simplifies" the ranges and drops
 * the exemption, the guard and the Electron probe would both start
 * reporting the zoom buttons as untranslated text on every run, and the
 * noise would likely get the check disabled rather than fixed.
 */
'use strict';
const { hasCjk, CJK_SOURCE, MATHS_SOURCE } = require('./lib/i18n_cjk.js');

let pass = 0, fail = 0;
function check(input, want, why) {
  const got = hasCjk(input);
  if (got === want) { pass++; return; }
  fail++;
  console.log(`  FAIL hasCjk(${JSON.stringify(input)}) = ${got}, want ${want}  (${why})`);
}

/* Real text that must be caught. */
check('ライザ', true, 'katakana');
check('和莱莎说点什么…', true, 'han + CJK ellipsis');
check('縮小', true, 'han tooltip');
check('保存しました', true, 'kana + han');
check('オンライン', true, 'katakana');
check('說', true, 'traditional');
check('。', true, 'ideographic full stop');
check('？', true, 'fullwidth question mark');

/* Text that must NOT be caught. */
check('Talk with Ryza', false, 'latin');
check('', false, 'empty');
check(null, false, 'null');
check(undefined, false, 'undefined');
check('Tap to wake Ryza', false, 'latin');
check('＋', false, 'U+FF0B is the zoom-in glyph, not language');
check('－', false, 'U+FF0D is the zoom-out glyph, not language');
check('＋－', false, 'both glyphs together');
check('A＋B', false, 'glyph embedded in latin');

/* The exemption must be narrow: it may not swallow real prose that happens
   to sit next to a maths sign. */
check('＋ 設定', true, 'real text beside a glyph is still caught');
check('放大－', true, 'glyph beside real text is still caught');

/* The exported sources must actually be regex sources, since the Electron
   probe builds RegExp objects from them at runtime. */
try { new RegExp(CJK_SOURCE); pass++; }
catch (e) { fail++; console.log('  FAIL CJK_SOURCE is not a valid regex source: ' + e.message); }
try { new RegExp(MATHS_SOURCE); pass++; }
catch (e) { fail++; console.log('  FAIL MATHS_SOURCE is not a valid regex source: ' + e.message); }

console.log(`I18N_CJK: ${fail ? 'FAILED' : 'ALL PASS'} (${pass} ok, ${fail} failed)`);
process.exit(fail ? 1 : 0);
