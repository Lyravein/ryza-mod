/*
 * One definition of "this text is in a CJK script", shared by every i18n
 * check, so the three of them cannot drift apart.
 *
 * Why this file exists: scripts/html_i18n_guard.js and
 * scripts/verify_i18n_electron.js both need the same two regexes. They used
 * to carry their own copies. There is no build step here and the scripts are
 * run straight by node, so nothing caught the duplication; an independent
 * review flagged it as a real risk, because adding one new icon glyph to the
 * exemption list in one file and forgetting the other makes one check report
 * false failures and the other false passes.
 *
 * The subtlety worth keeping in one place: U+FF0B (＋) and U+FF0D (－) are
 * FULLWIDTH MATHS SIGNS, not language. They are the zoom buttons' icon
 * glyphs and stay identical in every locale, so a naive "is there CJK here"
 * test reports them as untranslated text on every run. They are stripped
 * before the test rather than removed from the ranges, because U+FF01..FF5E
 * is otherwise full of real CJK prose punctuation.
 */
'use strict';

/* Everything from kana through the CJK ideographs, plus fullwidth forms. */
const CJK_SOURCE = '[\\u3000-\\u303f\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\uff01-\\uff5e]';

/* The two icon glyphs that carry no language. */
const MATHS_SOURCE = '[\\uFF0B\\uFF0D]';

const CJK = new RegExp(CJK_SOURCE);
const MATHS = new RegExp(MATHS_SOURCE, 'g');

/* Drop the exempt glyphs, then ask whether any CJK is left. */
function hasCjk(text) {
  if (!text) return false;
  return CJK.test(String(text).replace(MATHS, ''));
}

module.exports = { CJK_SOURCE, MATHS_SOURCE, CJK, MATHS, hasCjk };
