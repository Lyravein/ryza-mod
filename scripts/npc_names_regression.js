/* Regression guard for NPC display names.

   The bug this exists to catch: the injection read
   `(lg === 'zh') ? NPC_ZH_CN : NPC_NAMES.en`, so ja fell through to the
   English names and the Japanese UI showed "Ryza" instead of ライザ. There
   was no ja list at all; one was added from docs/official/official-data-
   schema.md (npc_placement.json, scanned from the shipped APK), which this
   file treats as the authority.

   Assertions are BIDIRECTIONAL and resolve through the real lookup on
   purpose. An earlier draft iterated only the keys already present in T.ja
   and compared those to the doc, which passes when entries are merely
   DELETED: drop npc.lent and the guard stayed green while the UI fell back to
   showing "Lent". Falling through to English is silent: the key still
   resolves to something, so a missing value is invisible unless the lookup
   itself is asserted.

   RUNTIME MODEL, which the first draft got wrong: NPC names are NOT looked
   up as fixed key strings. World.npcName (web/js/world.js:289) builds the key
   from the id in web/assets/world_map/npc_placement.json and calls
   I18n.tc(key, hit.name), where tc (web/js/i18n.js:2077) substitutes the
   JSON's own Japanese name when the key is missing. So a missing dict entry
   does NOT surface a raw "npc.agate", it surfaces the kana name from the
   placement file, which is the shipped wording anyway. The gap below is
   therefore real but benign, and is reported rather than asserted. */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { hasCjk } = require('./lib/i18n_cjk.js');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'web/js/i18n.js'), 'utf8')
  .replace('})(window);', '  window.__T = T; window.__N = NPC_NAMES; window.__C = CONTENT;\n})(window);');
const ctx = { console: console };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx);
const T = ctx.__T, I = ctx.I18n, N = ctx.__N, CONTENT = ctx.__C;

const ALL = ['ja', 'zh', 'zh-tw', 'en', 'hi', 'id', 'pt-br'];

const doc = fs.readFileSync(
  path.join(root, 'docs/official/official-data-schema.md'), 'utf8');
const official = {};
for (const m of doc.matchAll(/\|\s*`npc_([a-z_]+)`\s*\|\s*([^|]+?)\s*\|/g)) {
  official[m[1]] = m[2].trim();
}
const ids = Object.keys(official);

/* What the placement file would show for each character: the tc() fallback,
   and the source of truth for "does this character render at all". */
const placement = JSON.parse(fs.readFileSync(
  path.join(root, 'web/assets/world_map/npc_placement.json'), 'utf8'));
const shipName = {};
for (const n of placement.npcs || []) {
  shipName[String(n.id).replace(/^npc_/, '')] = n.name;
}

/* Characters the shipped English dict defines. NOT the doc's full 34: seven
   are background cast absent from NPC_NAMES.en, and tc() covers them from
   the placement file instead. */
const shippedIds = ids.filter((id) => ('npc.' + id) in T.en);

let fails = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  PASS ' + name); return; }
  fails++;
  console.log('  FAIL ' + name + (detail ? '\n       ' + detail : ''));
}
function t(lg, key) { I.setLang(lg); return I.t(key); }
/* Mirrors World.npcName (web/js/world.js:289-292): the key is built from the
   raw id, and the fallback is that same raw id WITH the npc_ prefix, which is
   what world.js passes. Falling back to the stripped id instead would model a
   failure the app never has. */
function rendered(lg, id) { I.setLang(lg); return I.tc('npc.' + id, shipName[id] || 'npc_' + id); }

console.log('NPC NAME GUARD\n');
check('official source parsed (' + ids.length + ' names)', ids.length >= 30,
  'only ' + ids.length + ' parsed from the doc');
check('placement file parsed (' + Object.keys(shipName).length + ' characters)',
  Object.keys(shipName).length >= 30);
/* Doc and placement file must describe the same cast, or shipName[id] is
   undefined and rendered() would stop mirroring World.npcName. */
const notPlaced = ids.filter((id) => !(id in shipName));
check('every official name appears in the placement file', notPlaced.length === 0,
  notPlaced.join(', '));

/* --- 1. ja coverage, both directions: deletion must fail, not shrink. --- */
const jaKeys = Object.keys(T.ja).filter((k) => k.indexOf('npc.') === 0);
check('ja name count matches the doc exactly (' + jaKeys.length + ')',
  jaKeys.length === ids.length, 'ja ' + jaKeys.length + ' vs doc ' + ids.length);

const absent = ids.filter((id) => !('npc.' + id in T.ja));
check('every official name is present in ja', absent.length === 0,
  absent.map((id) => 'npc.' + id).join(', '));

const extra = jaKeys.filter((k) => !(k.slice(4) in official));
check('ja carries no name the doc does not list', extra.length === 0, extra.join(', '));

const wrong = ids.filter((id) => 'npc.' + id in T.ja && T.ja['npc.' + id] !== official[id]);
check('every ja name matches the official doc verbatim', wrong.length === 0,
  wrong.map((id) => 'npc.' + id + ' = ' + JSON.stringify(T.ja['npc.' + id]) +
    ' want ' + JSON.stringify(official[id])).join('\n       '));

/* --- 2. The failure mode itself, through the real lookup. A deleted name
       resolves to English here and this goes red. --- */
const leaked = shippedIds.filter((id) => rendered('ja', id) === T.en['npc.' + id]);
check('ja renders no shipped name as the English spelling', leaked.length === 0,
  leaked.map((id) => 'npc.' + id + ' -> ' + JSON.stringify(rendered('ja', id))).join(', '));

/* --- 3. zh / zh-tw kept their own forms rather than collapsing to en. --- */
check('zh kept its own npc.ryza', T.zh['npc.ryza'] !== T.en['npc.ryza'],
  JSON.stringify(T.zh['npc.ryza']));
check('zh-tw kept the traditional form',
  T['zh-tw']['npc.ryza'] !== T.en['npc.ryza'] && /[萊]/.test(T['zh-tw']['npc.ryza']),
  JSON.stringify(T['zh-tw']['npc.ryza']));

/* --- 4. Nothing may render as a raw key in any language. Uses the real
       tc() path, so a missing dict entry is covered by the placement
       fallback rather than reported as a defect. --- */
const rawKey = [];
for (const lg of ALL) {
  for (const id of ids) {
    const v = rendered(lg, id);
    if (v === 'npc.' + id || v === 'npc_' + id) rawKey.push(lg + ':npc.' + id);
  }
}
check('no language renders a raw key for any official name', rawKey.length === 0,
  rawKey.slice(0, 8).join(', '));

/* --- 4b. The merge list itself. Dropping a language from the
       mergeContent forEach leaves it with en's keys via inherit(), so every
       per-language check still passes. Assert the list structurally: a
       language in ALL must appear in that array. */
const mergeList = (src.match(/\['ja'[\s\S]{0,200}?\]\.forEach\(function \(lg\)/) || [''])[0];
const listed = [...mergeList.matchAll(/'([^']+)'/g)].map((m) => m[1]);
const notListed = ALL.filter((lg) => listed.indexOf(lg) === -1);
check('every shipped language is in the NPC merge list (' + listed.length + ')',
  notListed.length === 0,
  'missing from mergeContent: ' + notListed.join(', '));
check('merge list has no language outside ALL',
  listed.every((lg) => ALL.indexOf(lg) !== -1), listed.join(', '));

/* --- 4c. The mergeContent call sites. The injection array at i18n.js:1927 is
       asserted above, but mergeContent itself is invoked separately further
       down; deleting one of those calls leaves every other check green
       because inherit() supplies the same values. Assert each shipped language
       reaches mergeContent at least once. */
/* Both call shapes are real: four are invoked directly, and hi / id / pt-br
   go through a forEach array. Matching only the direct form reports three
   languages as never merged when they are. */
const mergeDirect = [...src.matchAll(/mergeContent\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
const mergeLoop = [];
for (const m of src.matchAll(/\[([^\]]*)\]\.forEach\(function \(lg\) \{ mergeContent\(lg\)/g)) {
  const inner = m[1].match(/'([^']+)'/g) || [];
  for (const q of inner) mergeLoop.push(q.slice(1, -1));
}
const merged = mergeDirect.concat(mergeLoop).filter((v, i, a) => a.indexOf(v) === i);
const neverMerged = ALL.filter((lg) => merged.indexOf(lg) === -1);
check('mergeContent is invoked for every shipped language', neverMerged.length === 0,
  'not called for: ' + neverMerged.join(', '));
/* The loop form is easy to break silently, since the values still come from
   inherit(). Pin the languages it is responsible for. */
check('the merge loop covers hi, id and pt-br',
  ['hi', 'id', 'pt-br'].every((lg) => mergeLoop.indexOf(lg) !== -1),
  'loop covers: ' + mergeLoop.join(', '));

/* --- 5. Latin-script languages must be able to resolve what ships. Asserted
       on PRESENCE in T.en, not on what t() returns: those ids are in T.en by
       construction, so testing the resolver could never fail. Emptying
       NPC_NAMES.en would otherwise turn this into a loop over nothing. --- */
check('shipped name list is not empty (' + shippedIds.length + ')', shippedIds.length >= 25,
  'NPC_NAMES.en defines ' + shippedIds.length + ' names; expected ~27');
check('every shipped name is present in T.en',
  shippedIds.every((id) => ('npc.' + id) in T.en), shippedIds.join(', '));
/* Guard against a wholesale loss of the English dict. The two checks above
   are self-referential: they derive the list from T.en and then assert it is
   in T.en, so emptying NPC_NAMES.en leaves them green and the loop iterates
   over nothing. Pin the count to the dict's own shape instead. */
check('NPC_NAMES.en still defines a full cast (' + Object.keys(N.en).length + ')',
  Object.keys(N.en).length >= 25, 'NPC_NAMES.en has ' + Object.keys(N.en).length + ' keys');
check('every NPC_NAMES.en key maps to a non-empty string',
  Object.keys(N.en).every((k) => typeof N.en[k] === 'string' && N.en[k].length > 0));
/* Every language must end up with an npc.* entry for every official name,
   whether through its own dict, the English one, or the placement fallback.
   Deriving the need from T[lg] rather than from T.en is the point: the earlier
   version filtered the shippedIds list (itself derived from T.en) with
   `!('npc.' + id in T.en)`, whose first term is always false by construction,
   so the check could never fail. Dropping a language from the merge list was
   therefore invisible. */
/* Assert CONTENT[lg]'s npc.* entries reached T[lg] with identical values.
   I18n.t cannot be used for this: it falls back to T.en, so a language whose
   merge was dropped still resolves every name and looks fine. Comparing the
   two tables directly is immune to that, because inherit() copies en's values
   but never creates CONTENT entries. Dropping a language from the injection
   list, or a mergeContent call, empties CONTENT[lg] and fails here. */
for (const lg of ALL) {
  const fromContent = Object.keys(CONTENT[lg] || {}).filter((k) => k.indexOf('npc.') === 0);
  const notMerged = fromContent.filter((k) => !(k in T[lg]) || T[lg][k] !== CONTENT[lg][k]);
  check(lg + ' merged its CONTENT names into T (' + fromContent.length + ')', notMerged.length === 0,
    notMerged.slice(0, 6).join(', '));
  /* And the merge must have produced something: a language with an empty
     CONTENT[lg] means its dict was never injected at all. */
  check(lg + ' has non-empty NPC CONTENT (' + fromContent.length + ')',
    fromContent.length >= 17, 'CONTENT.' + lg + ' has ' + fromContent.length + ' npc.* keys');
  /* A floor, not equality. A language dropped from the injected list still ends
     up with 27 keys because inherit(T.en) copies them, so key counts cannot
     distinguish "merged" from "inherited". The merge list is asserted
     structurally instead, below. */
  const owned = ids.filter((id) => ('npc.' + id) in T[lg]).length;
  check(lg + ' has an injected name dict (' + owned + '/' + ids.length + ')',
    owned >= 17, 'only ' + owned + ' npc.* keys in T.' + lg);

}

/* --- 5b. The zh / zh-tw English leak. Same class as the ja bug, one language
       over: a character with no entry in T.zh falls back to T.en
       (web/js/i18n.js:2064-2066), and tc() only reaches the placement fallback
       when the key is absent from en TOO, so the English spelling is what a
       Chinese UI shows. Eight of the ten that used to leak here are now filled
       from the publisher's Chinese character pages; npc.samuel and npc.alberta
       stay, because no publisher source names them and a guess would be worse
       than the leak. Asserted as an exact set, so it can neither grow nor
       shrink silently. --- */
const KNOWN_ENGLISH_LEAK = {
  samuel: 'no publisher-page zh form; only secondary Chinese sources name him',
  alberta: 'no publisher-page zh form found',
};
const englishLeak = (lg) => shippedIds.filter((id) =>
  !('npc.' + id in T[lg]) && ('npc.' + id in T.en));
for (const lg of ['zh', 'zh-tw']) {
  const leak = englishLeak(lg);
  const known = Object.keys(KNOWN_ENGLISH_LEAK);
  const unexpected = leak.filter((id) => known.indexOf(id) === -1);
  const resolved = known.filter((id) => leak.indexOf(id) === -1);
  console.log('\n  ' + lg + ' still renders ' + leak.length + ' name(s) in English: ' +
    (leak.map((id) => 'npc.' + id + '=' + JSON.stringify(t(lg, 'npc.' + id))).join(', ') || 'none'));
  check(lg + ' English leak is exactly the documented residual (' + leak.length + ')',
    unexpected.length === 0 && resolved.length === 0,
    'unexpected: ' + (unexpected.join(', ') || 'none') +
    ' | no longer leaking: ' + (resolved.join(', ') || 'none'));
}

/* --- 6. chara.player must be PRESENT, not merely truthy. I18n.t returns the
       key itself when missing (web/js/i18n.js:2064), so a truthiness test
       passes even for a language that has no entry at all. --- */
/* PRESENT, not merely truthy: I18n.t returns the key itself when missing
   (web/js/i18n.js:2064), so a truthiness test passes even for a language with
   no entry. Presence alone is also not enough for the inherited languages,
   since inherit() (i18n.js:1082) copies en's keys into them and `'chara.player'
   in T.hi` is then true either way.

       What distinguishes the two is whether the value came from the language's
       OWN source block: a key that is identical to en's in a language that
       inherits from en has not been translated, and asserting presence there
       would report green for a block that silently lost the key. So each
       language must EITHER own a distinct translation, OR be one of the
       documented untranslated set, which is checked explicitly rather than
       assumed. */
/* Languages whose block intentionally carries no own chara.player and relies
   on inherit() from en: only hi and pt-br. zh-tw and id are NOT among them,
   both have their own text (你（玩家設定）, Kamu (setelan pemain)), which is
   what a Traditional Chinese and an Indonesian UI must show. */
const UNTRANSLATED = { hi: true, 'pt-br': true };
for (const lg of ALL) {
  const owns = T[lg]['chara.player'] !== undefined;
  check('chara.player present in ' + lg, owns);
  const v = t(lg, 'chara.player');
  check('chara.player renders non-key text in ' + lg, v !== 'chara.player' && v.length > 0,
    JSON.stringify(v));
  if (UNTRANSLATED[lg]) {
    /* Must still equal en, i.e. genuinely inherited rather than half-done. */
    check(lg + ' inherits chara.player from en by design',
      T[lg]['chara.player'] === T.en['chara.player'], JSON.stringify(T[lg]['chara.player']));
  } else if (lg === 'en') {
    /* en is the source of the inheritance, so there is nothing to compare. */
    check('en defines the source text for chara.player',
      T.en['chara.player'] === 'You (player settings)', JSON.stringify(T.en['chara.player']));
  } else {
    /* A language that claims its own translation must differ from en, or the
       block lost the key and fell back silently. */
    check(lg + ' has its own chara.player text, not the English one',
      T[lg]['chara.player'] !== T.en['chara.player'],
      lg + ' is identical to en: ' + JSON.stringify(T[lg]['chara.player']));
  }
}

/* --- 7. No CJK heading literal may reappear in settings.js. The argument list
       is scanned with a depth counter rather than a lazy regex, because the
       call contains nested parens: `_title(w, T('x') + 'あ')` stops a
       non-greedy match at T('x')'s own closing paren and misses the literal
       behind it. Only quotes outside a comment or an identifier count. --- */
function _titleArgs(src) {
  const out = [];
  const re = /_title\(/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 1, i = m.index + m[0].length, start = i;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '/' && src[i + 1] === '/') {           // line comment
        const nl = src.indexOf('\n', i);
        i = nl === -1 ? src.length : nl;
        continue;
      }
      if (c === '/' && src[i + 1] === '*') {           // block comment
        const close = src.indexOf('*/', i + 2);
        i = close === -1 ? src.length : close + 1;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        const q = c; i++;
        while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      } else if (c === '(') {
        depth++;
      } else if (c === ')') {
        depth--;
        if (!depth) break;
      }
      i++;
    }
    out.push(src.slice(start, i));
  }
  return out;
}
const settingsSrc = fs.readFileSync(path.join(root, 'web/js/settings.js'), 'utf8');
const hard = [];
for (const args of _titleArgs(settingsSrc)) {
  for (const lit of args.matchAll(/(["'`])([^"'`\\]*(?:\\.[^"'`\\]*)*)\1/g)) {
    if (hasCjk(lit[2])) hard.push(lit[2]);
  }
}
check('no CJK literal left in settings.js _title', hard.length === 0, hard.join(', '));

/* --- 8. The zh -> simplified conversion table (i18n.js) has no coverage.
       zh is the default UI language, so dropping one replacement silently
       reintroduces traditional forms. Assert every table entry actually fires
       on a known traditional character. --- */
const convBlock = src.match(/NPC_ZH_CN\[k\] = NPC_ZH_TW\[k\][\s\S]*?;/);
/* Parsed by hand rather than by a regex over the source: the entries contain
   CJK characters and nested quoting that a character class mis-handles. */
const pairs = [];
if (convBlock) {
  const re = /\.replace\(\/([^/]+)\/g,/g;
  let mm;
  while ((mm = re.exec(convBlock[0]))) {
    const after = convBlock[0].slice(re.lastIndex);
    const q = after.indexOf("'");
    const end = after.indexOf("'", q + 1);
    if (q === -1 || end === -1) break;
    pairs.push([mm[1], after.slice(q + 1, end)]);
  }
}
check('zh conversion table parsed (' + pairs.length + ' entries)', pairs.length >= 10,
  'only ' + pairs.length + ' replacements found in the NPC_ZH_CN table');
/* A traditional key may not appear in its own simplified target: that would
   mean the "simplified" form still carries the traditional character, which is
   the whole thing the table exists to prevent. */
const selfTraditional = pairs.filter(([trad, simp]) => simp.includes(trad));
check('every zh conversion targets a non-traditional form', selfTraditional.length === 0,
  selfTraditional.map(([a, b]) => a + ' -> ' + b).join(', '));
/* And each key must be a single CJK run, not a regex fragment that would
   silently match nothing. */
check('every zh conversion key is CJK', pairs.every(([, k]) => /[\u3400-\u9fff]/.test(k)),
  pairs.filter(([, k]) => !/[\u3400-\u9fff]/.test(k)).map(([k]) => k).join(', '));
       /* Applied to the RAW traditional dict, not to T.zh vs T['zh-tw']. Comparing
       the two injected tables proves nothing: both are produced from the same
       NPC_NAMES.zh at load time, so deleting a replacement changes both sides
       identically and they still agree. The table has to be exercised against
       the source strings it is supposed to rewrite. */
/* The table must be exercised against the RAW traditional dict AND checked
   against an independent expectation. Comparing the table's output to T.zh is
   circular: T.zh is itself produced by running that same table at load time,
   so deleting a replacement makes both sides wrong in the same way and they
   still agree. Dropping /萊/g, for example, left T.zh.npc.ryza as 萊莎 and the
   check passed.

       Two independent anchors catch that:
         1. the pair count, pinned to the table's real size
         2. a simplified-character assertion over T.zh itself, using a table of
            traditional forms and their simplified counterparts held HERE, not
            read back from the code under test. */
/* Independent oracle, written by hand from standard simplified Chinese and
   NOT read back from i18n.js. Deriving it from the table would defeat the
   point: the earlier version compared the table's output against T.zh, which
   the table itself produces at load time, so removing a replacement left both
   sides identically wrong and the check passed. This literal is the anchor
   that breaks that circularity.

       PROVENANCE, stated honestly: these are standard simplified forms, not
       a transcription from another file in this repo.
       docs/official/official-data-schema.md holds kana only, so it cannot
       corroborate them, and NPC_NAMES.zh is the same source the table reads.
       What this catches is a DROP, an INVERSION, or a corrupted entry in the
       table. What it cannot catch is a shared mistake, since there is no
       second authority in-tree to diff against. */
const SIMPLIFIED = {
  '萊': '莱', '卡爾': '卡尔', '塔奧': '塔奥', '米奧': '米奥', '安佩爾': '安佩尔', '羅密': '罗密',
  '賽莉': '赛莉', '科洛蒂婭': '科洛蒂娅', '菲德麗卡': '费德丽卡', '薩維里奧': '萨维里奥',
  '多爾特': '多尔特', '沃爾卡': '沃尔卡', '蘭托': '兰托', '潔菲娜': '洁菲娜',
};
check('independent oracle covers the table (' + Object.keys(SIMPLIFIED).length + ' pairs)',
  Object.keys(SIMPLIFIED).length === pairs.length,
  'oracle ' + Object.keys(SIMPLIFIED).length + ' vs table ' + pairs.length);
const oracleMissing = pairs.filter(([trad, simp]) => SIMPLIFIED[trad] !== simp);
check('every table entry agrees with the independent oracle', oracleMissing.length === 0,
  oracleMissing.map(([a, b]) => a + ': table=' + b + ' oracle=' + SIMPLIFIED[a]).join(', '));
check('every oracle entry is present in the table',
  Object.keys(SIMPLIFIED).every((trad) => pairs.some(([t]) => t === trad)),
  Object.keys(SIMPLIFIED).filter((t) => !pairs.some(([x]) => x === t)).join(', '));

/* Finally the end-to-end assertion that the traditional form does not survive
       into the shipped zh UI. */
const survivors = [];
for (const k of Object.keys(T.zh).filter((x) => x.indexOf('npc.') === 0)) {
  for (const trad of Object.keys(SIMPLIFIED)) {
    if (T.zh[k].indexOf(trad) !== -1) survivors.push(k + '=' + T.zh[k] + ' still holds ' + trad);
  }
}
check('no traditional form survives into T.zh NPC names', survivors.length === 0,
  survivors.join('\n       '));

/* --- Known gaps, reported not hidden, and split by what the user actually
       sees, because the two classes are not equivalent. tc() (i18n.js:2077)
       only reaches the placement file's name when the key is absent from
       T.en as well; otherwise I18n.t hands back the English spelling.
         class A: missing from the language dict AND from T.en
                  -> renders placement-file kana, i.e. the shipped wording
         class B: missing from the language dict but present in T.en
                  -> renders ENGLISH inside a localized UI (the ja bug, one
                     language over). Eight of these were filled from the
                     publisher's Chinese character pages; npc.samuel and
                     npc.alberta are the only two left, and they are left on
                     purpose, see 5b.
       Naming ids and which class they fall in, so neither can be forgotten. */
const gapClass = (lg) => {
  const A = ids.filter((id) => !('npc.' + id in T[lg]) && !('npc.' + id in T.en));
  const B = ids.filter((id) => !('npc.' + id in T[lg]) && ('npc.' + id in T.en));
  return { A, B };
};
console.log('\n  KNOWN GAPS (reported, not hidden):');
for (const lg of ['zh', 'zh-tw']) {
  const { A, B } = gapClass(lg);
  console.log('    ' + lg + ' has a dict entry for ' + (ids.length - A.length - B.length) +
    '/' + ids.length);
  console.log('      A, missing here and in en -> renders kana via tc(): ' +
    (A.map((id) => 'npc.' + id).join(', ') || 'none'));
  console.log('      B, missing here only -> RENDERS ENGLISH in a ' + lg +
    ' UI: ' + (B.map((id) => 'npc.' + id).join(', ') || 'none'));
}

console.log(fails ? '\nNPC NAME GUARD: ' + fails + ' FAIL' : '\nNPC NAME GUARD: ALL PASS');
process.exit(fails ? 1 : 0);
