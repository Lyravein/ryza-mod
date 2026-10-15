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
 * CJK that is NOT attached to an i18n attribute, and fail. CJK can hide in
 * two places and both are covered:
 *   - text nodes between tags
 *   - ANY attribute value. An earlier version only looked at title and
 *     placeholder while its comment claimed to cover attributes generally,
 *     leaving aria-label, alt and data-* silently unchecked. A review
 *     caught that gap; the attribute list is now a deny-list of the few
 *     attributes that cannot hold prose, so new ones are covered by default.
 *
 * Two rules, kept separate on purpose:
 *   - data-i18n        rewrites the element's TEXT   -> conflicts with a
 *                        runtime text writer, so JS-owned elements must
 *                        NOT have it
 *   - data-i18n-title  rewrites an ATTRIBUTE, which
 *                        the runtime writers usually leave alone -> always
 *                        required when the markup ships a CJK tooltip
 *
 * Deliberately allowed: HTML comments, and the text of elements listed in
 * JS_OWNED (app.js redraws those from I18n keys on every render).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { CJK_SOURCE, MATHS, hasCjk } = require('./lib/i18n_cjk.js');

const WEB = path.join(__dirname, '..', 'web');
const HTML = path.join(WEB, 'index.html');

/* Text app.js sets itself (via I18n.t/tc/tf) on every render, so a static
   data-i18n there would be overwritten a moment later. Their live output is
   covered by scripts/verify_i18n_electron.js. */
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

/* Attributes that cannot hold user-facing prose. Everything else is
   scanned, so a future aria-label / data-tip / alt with CJK fails here
   instead of slipping through. */
const NON_TEXT_ATTRS = new Set([
  'class', 'id', 'type', 'name', 'rel', 'charset', 'content', 'src', 'href',
  'width', 'height', 'accept', 'autocomplete', 'lang', 'style',
  'data-action', 'data-bag', 'data-mode', 'data-style', 'data-view',
  'data-i18n', 'data-i18n-title', 'data-i18n-ph',
]);

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
const attrRe = /([a-zA-Z_:][\w:.-]*)\s*=\s*"([^"]*)"/g;
let m, lastTag = null;

while ((m = re.exec(clean)) !== null) {
  if (m[1] !== undefined) {
    const raw = m[1];
    const idm = /id="([^"]+)"/.exec(raw);
    const id = idm ? idm[1] : null;
    const owned = id && JS_OWNED.has(id);
    const hasTextKey = /data-i18n="/.test(raw);
    const hasAttrKey = /data-i18n-title="/.test(raw);

    /* Every attribute, not just the two the old version knew about. */
    for (const a of raw.matchAll(attrRe)) {
      const attr = a[1].toLowerCase();
      const val = a[2].trim();
      if (!val || NON_TEXT_ATTRS.has(attr)) continue;
      if (!hasCjk(val)) continue;

      if (attr === 'placeholder') {
        /* #input is the only placeholder in the app and app.js owns it via
           I18n.tc('input.hint') in three places (init, _relocalize, the
           mode switch). A CJK literal here would show before boot and
           would stay if that key ever went missing, so it is banned
           outright rather than given an attribute. */
        failures.push(`line ${lineOf(m.index)}: ${id ? '#' + id : 'element'} has a CJK ` +
                      `placeholder literal — app.js owns this attribute -> ` +
                      JSON.stringify(val.slice(0, 30)));
      } else if (!hasAttrKey) {
        failures.push(`line ${lineOf(m.index)}: ${id ? '#' + id : 'element'} ships CJK in ` +
                      `"${attr}" with no data-i18n-title -> ` + JSON.stringify(val.slice(0, 30)));
      }
    }

    /* Only a TEXT key can fight a runtime text writer. */
    if (owned && hasTextKey) {
      failures.push(`line ${lineOf(m.index)}: #${id} text is written by app.js at runtime ` +
                    `but also carries data-i18n — two writers on one node`);
    }
    lastTag = { raw, id, owned };
    continue;
  }

  const text = m[2].trim();
  if (!text || !hasCjk(text)) continue;

  if (lastTag && lastTag.owned) {
    notes.push(`line ${lineOf(m.index)}: #${lastTag.id} text left to app.js (expected)`);
    continue;
  }
  if (lastTag && /data-i18n="/.test(lastTag.raw)) continue;  // migrated

  failures.push(`line ${lineOf(m.index)}: visible CJK not wired to i18n -> ` +
                JSON.stringify(text.slice(0, 40)) +
                (lastTag && lastTag.id ? ` (in #${lastTag.id})` : ''));
}

console.log('# index.html: CJK not wired to an i18n attribute');
console.log(`  ${clean.split('\n').length} lines; text nodes AND every attribute value`);
console.log(`  ranges ${CJK_SOURCE}  (＋/－ exempt via lib/i18n_cjk.js)`);
for (const n of notes) console.log('  note ' + n);
if (failures.length) {
  console.log('');
  for (const f of failures) console.log('  FAIL ' + f);
  console.log(`\nHTML I18N GUARD: FAILED (${failures.length})`);
  process.exit(1);
}
console.log('\nHTML I18N GUARD: ALL PASS');
