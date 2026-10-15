#!/usr/bin/env node
/*
 * Guard against the class of bug the existing suite could not see.
 *
 * scripts/i18n_coverage.js works "inside out": it reads index.html, pulls
 * out every data-i18n / data-i18n-title key, and checks each one has a
 * translation in every UI language. That is a good check, but it can never
 * fail on work that was never migrated — a visible string with no i18n
 * attribute at all is invisible to it.
 *
 * That is how ~36 Chinese/Japanese strings survived in the topbar, the
 * drawer, the tooltips and the input placeholder through 19 green test
 * scripts: with lang=en the app still showed ライザ and 离线重建版.
 *
 * This check works the other way round ("outside in"): scan index.html for
 * visible CJK text that is NOT attached to an i18n attribute, and fail.
 *
 * Two rules, kept separate on purpose:
 *   - data-i18n        rewrites the element's TEXT   -> conflicts with a
 *                        runtime text writer, so JS-owned elements must
 *                        NOT have it
 *   - data-i18n-title / data-i18n-ph rewrite an
 *                        ATTRIBUTE, which the runtime writers usually
 *                        leave alone -> always required when the markup
 *                        ships a CJK tooltip or placeholder, JS-owned or not
 *
 * Deliberately allowed: HTML comments, and the text of elements listed in
 * JS_OWNED (app.js redraws those from I18n keys on every render).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'web');
const HTML = path.join(WEB, 'index.html');

/* Text app.js sets itself (via I18n.t/tc/tf) on every render, so a static
   data-i18n there would be overwritten a moment later. Their live output is
   covered by the headless-Chrome probe. */
const JS_OWNED = new Set([
  'drawer-day',        // I18n.tf('drawer.days', …)
  'log-name',          // I18n.tc('chara.ryza', …)
  'log-sub',           // I18n.t of the mode subtitle
  'voice-pill-label',  // I18n.t of the voice/text mode label
  'btn-tod-label',     // World.todLabel -> I18n.t('tod.' + tod)
  'btn-posture',       // glyph, redrawn by the posture logic
  'btn-sit-variant',
  'hud-place', 'hud-tod', 'hud-mode',
]);

/* CJK scripts, but NOT the fullwidth blocks wholesale: U+FF0B (＋) and
   U+FF0D (－) are the maths signs used on the zoom buttons, and flagged as
   "untranslated text" they would be pure noise. U+FF1A/U+FF08 etc. still
   count, since those only appear in real prose. */
/* CJK scripts. Fullwidth punctuation counts, since it only shows up in real
   Chinese/Japanese prose — except the two maths signs on the zoom buttons,
   U+FF0B (＋) and U+FF0D (－), which carry no language. */
const MATHS_GLYPH = /[\uFF0B\uFF0D]/g;
const CJK = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff01-\uff5e]/;

const src = fs.readFileSync(HTML, 'utf8');

/* Blank out comments WITHOUT touching newlines: replacing a multi-line
   comment with same-length spaces collapsed its line breaks and shifted
   every line number after it. */
const clean = src.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));

const lineOf = idx => clean.slice(0, idx).split('\n').length;

const failures = [];
const notes = [];

/* Walk tags and the text between them, so every check has one clear owner. */
const re = /<([a-zA-Z][^>]*)>|([^<]+)/g;
let m, lastTag = null;
while ((m = re.exec(clean)) !== null) {
  if (m[1] !== undefined) {
    const raw = m[1];
    const idm = /id="([^"]+)"/.exec(raw);
    const id = idm ? idm[1] : null;
    const owned = id && JS_OWNED.has(id);

    const hasTextKey = /data-i18n="/.test(raw);
    const hasAttrKey = /data-i18n-(?:title|ph)="/.test(raw);

    // A CJK tooltip or placeholder must always be wired, even on an element
    // whose text the JS redraws.
    const attrCjk = [...raw.matchAll(/(?:title|placeholder)="([^"]*[\u3000-\u9fff][^"]*)"/g)]
      .map(x => x[1].trim());
    if (attrCjk.length && !hasAttrKey) {
      failures.push(`line ${lineOf(m.index)}: ${id ? '#' + id : 'element'} ships a CJK ` +
                    `tooltip/placeholder with no i18n attribute -> ` +
                    attrCjk.slice(0, 2).map(s => JSON.stringify(s.slice(0, 30))).join(', '));
    }

    // Only a TEXT key can fight a runtime text writer.
    if (owned && hasTextKey) {
      failures.push(`line ${lineOf(m.index)}: #${id} text is written by app.js at runtime ` +
                    `but also carries data-i18n — two writers on one node`);
    }
    lastTag = { raw, id, owned };
    continue;
  }

  const text = m[2].trim();
  if (!text || !CJK.test(text.replace(MATHS_GLYPH, ''))) continue;

  if (lastTag && lastTag.owned) {
    notes.push(`line ${lineOf(m.index)}: #${lastTag.id} text left to app.js (expected)`);
    continue;
  }
  if (lastTag && /data-i18n="/.test(lastTag.raw)) continue;  // migrated

  failures.push(`line ${lineOf(m.index)}: visible CJK not wired to i18n -> ` +
                JSON.stringify(text.slice(0, 40)) +
                (lastTag && lastTag.id ? ` (in #${lastTag.id})` : ''));
}

console.log('# index.html: visible CJK that is not wired to an i18n attribute');
console.log(`  scanned ${clean.split('\n').length} lines`);
for (const n of notes) console.log('  note ' + n);
if (failures.length) {
  console.log('');
  for (const f of failures) console.log('  FAIL ' + f);
  console.log(`\nHTML I18N GUARD: FAILED (${failures.length})`);
  process.exit(1);
}
console.log('\nHTML I18N GUARD: ALL PASS');
