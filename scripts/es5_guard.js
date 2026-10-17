#!/usr/bin/env node
/* ES5 syntax guard for web/js.
   The web bundle is loaded by the Electron shell and by an old Android
   webview, so these files have to stay ES5: an arrow function, a template
   literal or a `let` in one of them is a load-time SyntaxError on the older
   engine, not a style question. Nothing checked that before this guard, and
   the rule only lived in prose, so a single modern token could ship.
   Comments and string literals are blanked before the scan: prose about `=>`
   is not syntax, and neither is the word "const" inside a message. */
'use strict';
const fs = require('fs');
const path = require('path');

const JS_DIR = path.join(__dirname, '..', 'web', 'js');

/* Patterns that cannot be transpiled away at runtime. Each is a whole-token
   match so identifiers such as `constant` or `classify` do not trip it. */
const BANNED = [
  ['arrow function', /=>/],
  ['template literal', /`/],
  ['let/const declaration', /\b(?:let|const)\b/],
  ['class', /\bclass\b/],
  ['async/await', /\b(?:async|await)\b/],
  ['optional chaining', /\?\./],
  ['nullish coalescing', /\?\?/],
  ['spread/rest', /\.\.\./],
  ['for-of', /\bfor\s*\([^)]*\bof\b/],
  /* Runtime APIs, not syntax: these parse fine on an old engine and then throw
     at the call site, which is the failure this guard exists to catch. Only
     APIs with no polyfill anywhere in the tree belong here. */
  ['Object.assign', /\bObject\s*\.\s*assign\b/],
  ['Array.from', /\bArray\s*\.\s*from\b/],
  ['String.padStart/padEnd', /\.\s*pad(?:Start|End)\s*\(/]
];

/* Blank out comments, string bodies and regex literals, keeping every newline
   so reported line numbers still point at the real file. Regex literals need
   the same treatment as strings: /^```(?:json)?/ contains backticks that are
   not template literals. */
function blank(src) {
  const out = src.split('');
  let i = 0;
  let prev = '';                               /* last significant character */
  const keep = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };
  /* A '/' starts a regex only where a value cannot already have ended, which is
     the usual heuristic: after an operator, a bracket, a comma or a semicolon. */
  const regexOk = () => prev === '' || '(,=:[!&|?{};+-*%<>~^'.indexOf(prev) >= 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      keep(i, stop); i = stop;
    } else if (c === '/' && d === '/') {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? src.length : end;
      keep(i, stop); i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) { j++; break; }
        if (src[j] === '\n') break;            /* unterminated: stop at the line */
        j++;
      }
      keep(i + 1, j - 1); i = j; prev = c;
    } else if (c === '/' && regexOk()) {
      let j = i + 1, inClass = false;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) { j++; break; }
        else if (src[j] === '\n') break;       /* not a regex after all */
        j++;
      }
      keep(i + 1, j - 1); i = j; prev = '/';
    } else {
      if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') prev = c;
      i++;
    }
  }
  return out.join('');
}

/* Files that run in their own worker, where the worker's own scripts may use
   modern syntax: only the transferred .bin is injected into the game's context,
   so a violation there cannot reach a game page. Keep this list tiny and say
   why per file. */
const WORKER = {
  'ttswork.js': 'runs in its own Web Worker; its modern syntax cannot reach the game page'
};

/* Known exemptions are also COUNTED: if the count for a file changes, the guard
   fails, so a new violation in an exempt file cannot quietly join the list. */
const KNOWN_BUDGET = {
  'crfstore.js': 2,     /* async/await, contained by the window.CrfStore check */
  'alarm.js': 4,        /* padStart on hours/minutes: always two digits anyway */
  'app.js': 5,          /* 4 padStart + 1 Object.assign (app.js:253, boot path) */
  'daily.js': 1,        /* Object.assign on the daily state */
  'game.js': 2          /* Object.assign on save load, the two worth fixing first */
};

/* Violations that already existed before this guard and are not mine to fix in
   this change. They are printed, never hidden, and they do not fail the run:
   a guard that blocks the suite on someone else's old code gets deleted, and
   then it protects nothing. Each entry needs a reason. */
const KNOWN = {
  'crfstore.js': 'upstream import (ryza-ai-revive v1.2.23) uses async/await; ' +
                 'contained by the window.CrfStore check in app.js, so only the ' +
                 'clothing import is lost on an engine without async',
  'alarm.js': 'padStart predates this guard; hours and minutes always render as ' +
              'two digits here, so a userland padLeft is a straight swap',
  'app.js': 'pre-existing Object.assign plus the same padStart pair; the ' +
            'Object.assign call is on the chat path and is the one to fix next',
  'daily.js': 'pre-existing Object.assign when loading the daily state',
  'game.js': 'pre-existing Object.assign on save load (lines 132 and 450); ' +
             'no polyfill exists anywhere in the tree'
};

const files = fs.readdirSync(JS_DIR).filter((f) => f.endsWith('.js')).sort();
const known = [];

/* The accounting behind the budget check, as a pure function so the self-test
   can drive the real thing instead of a copy of it. Returns the per-file count
   of known hits plus every file whose count grew past its reviewed budget. */
function knownByFile(rows, budget) {
  budget = budget || KNOWN_BUDGET;
  const seen = {};
  rows.forEach((k) => { const f = k.split(':')[0]; seen[f] = (seen[f] || 0) + 1; });
  const grew = Object.keys(seen).filter((f) => seen[f] > (budget[f] || 0));
  return { seen: seen, grew: grew };
}
let problems = [];
for (const f of files) {
  const raw = fs.readFileSync(path.join(JS_DIR, f), 'utf8');
  const lines = blank(raw).split('\n');
  lines.forEach((line, n) => {
    for (const [what, re] of BANNED) {
      if (re.test(line)) {
        const where = `${f}:${n + 1}: ${what} -> ${raw.split('\n')[n].trim().slice(0, 90)}`;
        /* Keep the whole line, not just the rule name: two violations from the
           same rule collapsed into one key otherwise, and the budget count then
           stayed at the old number when a new one joined the file. */
        if (WORKER[f] || KNOWN[f]) known.push(`${f}:${n + 1}: ${what} | ${raw.split('\n')[n].trim().slice(0, 80)}`);
        else problems.push(where);
      }
    }
  });
}

/* Counted here, after the scan has filled `known`. An earlier version of this
   patch computed it next to the function definition, before the loop ran, so it
   always saw an empty list and the budget silently stopped biting — the exact
   failure this mechanism exists to prevent, caught by mutating a budget to a
   wrong number and watching the guard stay green. */
const counted = knownByFile(known);

/* One direction only: the count may fall (someone fixed one) but never rise,
   because a new violation in an exempt file is a new violation and not
   history. Failing on the way down as well would punish the fix. */
if (counted.grew.length) {
  counted.grew.forEach((f) => {
    console.log(`ES5 GUARD: FAIL ${f} added ${counted.seen[f] - KNOWN_BUDGET[f]} exempt violation(s)`);
  });
  /* No exit here any more: the self-test at the bottom has to run even when the
     scan failed, so the two signals stay independent. This exit is what made
     the CI-isolation fix look like it worked while it did not. */
  problems = problems.concat(counted.grew.map((f) => `${f}: exempt budget exceeded`));
}
Object.keys(KNOWN_BUDGET).forEach((f) => {
  const seen = counted.seen[f] || 0;
  if (seen < KNOWN_BUDGET[f]) console.log(`ES5 GUARD: ${f} is down to ${seen}/${KNOWN_BUDGET[f]} known hits`);
});
if (known.length) {
  console.log(`ES5 GUARD: ${known.length} pre-existing / worker-hosted, not from this change:`);
  known.forEach((k) => console.log('  ' + k));
  /* The reason was written for every entry and then never printed: the list
     said which lines were exempt but not why, so the next person to read it saw
     a pile of tolerated violations and no argument. Print it above the lines. */
  console.log('  why these files are exempt at all:');
  Object.keys(KNOWN_BUDGET).forEach((f) => {
    console.log(`    ${f}: ${KNOWN[f]}`);
  });
}
if (problems.length) {
  console.log(`ES5 GUARD: FAIL (${problems.length})`);
  problems.forEach((p) => console.log('  ' + p));
}
console.log(problems.length ? '' : `ES5 GUARD: OK (${files.length} files scanned)`);

/* ---------------------------------------------------------------------------
   Self-test. The guard spent three rounds passing while blind: a token pattern
   that demanded trailing whitespace missed `await(`, and whole-file exemptions
   quietly absorbed new violations. A syntax rule enforced by a checker nobody
   checks is prose. Each case below is a shape a real violation takes, plus the
   property that matters for each one: a violation in a normal file must FAIL,
   the same violation in an exempted file must FAIL only when the count grows,
   and a violation that only exists inside a comment or a string must pass.
   This runs after the scan, so a failure here is exit 1 with the reason.

   Known residue, deliberately not asserted green: `/* ... *​/` swallowing the
   lines in between means code inside a block comment is not read at all. That
   direction is safe for this rule (a false negative needs real code written
   inside a comment) and I would rather record it than claim it is handled. */
const CASES = [
  { why: 'arrow function', src: 'var f = (a) => a;\n', want: 1 },
  { why: 'return arrow', src: 'return (x) => x;\n', want: 1 },
  { why: 'array arrow', src: 'var f = [].map((x) => x);\n', want: 1 },
  { why: 'arrow after regex literal', src: 'var t = a / b;\nvar f = (a) => a;\n', want: 1 },
  { why: 'let / const with no trailing space', src: 'let[0] = 1;\n', want: 1 },
  { why: 'const declaration', src: 'const x = 1;\n', want: 1 },
  { why: 'await used as a call', src: "var s = '' + await(x);\n", want: 1 },
  { why: 'async with no trailing space', src: 'var a = async(x);\n', want: 1 },
  { why: 'class declaration', src: 'class A {}\n', want: 1 },
  { why: 'template literal', src: 'var s = `x${y}`;\n', want: 1 },
  { why: 'optional chaining', src: 'var v = a?.b;\n', want: 1 },
  { why: 'spread', src: 'f(...args);\n', want: 1 },
  { why: 'for-of', src: 'for (var x of arr) {}\n', want: 1 },
  { why: 'Object.assign', src: 'Object.assign(a, b);\n', want: 1 },
  { why: 'Array.from', src: 'Array.from(s);\n', want: 1 },
  { why: 'padStart', src: "n.padStart(2, '0');\n", want: 1 },
  { why: 'Object.assign with spaces', src: 'Object . assign(a, b);\n', want: 1 },
  /* NOT COVERED, recorded rather than wished away: these four are ES6+ shapes
     this guard has no rule for, so a violation written this way is invisible to
     it. Two of them are used nowhere in web/js today; the other two are the
     reason this list is written down instead of assumed empty. */
  { why: 'NOT COVERED generator star', src: 'function* gen() {}\n', want: 0 },
  { why: 'NOT COVERED destructuring', src: 'var { a, b } = o;\n', want: 0 },
  { why: 'NOT COVERED exponent operator', src: 'var n = 2 ** 8;\n', want: 0 },
  { why: 'NOT COVERED shorthand method', src: 'var o = { m() {} };\n', want: 0 },
  /* The directions that must stay green. A guard that fails on prose is a
     guard someone deletes. */
  { why: 'the words inside a line comment', src: '// const f = (a) => `x${a}`;\n', want: 0 },
  { why: 'the words inside a string', src: "var s = 'const f = (a) => `x${a}`';\n", want: 0 },
  { why: 'the words inside a regex literal', src: 'var r = /class let await/;\n', want: 0 },
  { why: 'the words inside a block comment', src: '/*\nconst f = (a) => a;\n*/\n', want: 0 },
  { why: 'plain division', src: 'var t = a / b;\n', want: 0 }
];

const wouldFlag = (src) => {
  const lines = blank(src).split('\n');
  let hits = 0;
  lines.forEach((line) => {
    for (const [, re] of BANNED) {
      if (re.test(line)) hits++;
    }
  });
  return hits;
};

let selftest = 0;
/* Counted, not hardcoded: the budget cases loop over every exempt file, so a
   literal here would drift the moment one is added or removed. */
const budgetSelfTests = Object.keys(KNOWN_BUDGET).length * 2;
CASES.forEach((c) => {
  const hits = wouldFlag(c.src);
  if (hits !== c.want) {
    console.log(`ES5 GUARD: FAIL self-test "${c.why}" scored ${hits}, wanted ${c.want}`);
    selftest++;
  }
});

/* And the budget has to bite, or an exempted file is a place violations go to
   live. Driven through the real accounting — knownByFile() — and not a copy of
   it: the first version of this check built a local `counted` object, so it
   asserted `1 > 0` and would have passed with any exemption list at all. A
   check that cannot fail is worse than no check, because it reports green. */
const budgetFiles = Object.keys(KNOWN_BUDGET);
budgetFiles.forEach((f) => {
  const reviewed = KNOWN_BUDGET[f];
  const over = reviewed + 1;
  const synthOver = [];
  for (let i = 0; i < over; i++) synthOver.push(`${f}:${i + 1}: Object.assign | synthetic`);
  /* One hit above the reviewed number, against the REAL budget: the accounting
     must name this file. An earlier version of this check passed the synthetic
     count in as the budget as well, so it compared 3 > 3 and proved nothing. */
  const grew = knownByFile(synthOver).grew;
  if (grew.indexOf(f) < 0) {
    console.log(`ES5 GUARD: FAIL self-test a ${f} budget of ${reviewed} would accept ${over} violations`);
    selftest++;
  }
  /* And the other direction: a fix has to be allowed to land. One hit below
     the reviewed number, against the real budget, must report nothing. */
  const few = reviewed > 0 ? reviewed - 1 : 0;
  const synthFew = [];
  for (let i = 0; i < few; i++) synthFew.push(`${f}:${i + 1}: Object.assign | synthetic`);
  if (knownByFile(synthFew).grew.length) {
    console.log(`ES5 GUARD: FAIL self-test a fix to ${f} would be rejected`);
    selftest++;
  }
});

/* The self-test runs even when the scan already failed. It used to sit behind
   `process.exit(1)` in the scan, so in CI the only signal a broken rule could
   produce was the scan failing for an unrelated reason — and a green scan on a
   broken rule could never be told apart from a green scan on a working one. */
console.log(selftest ? `ES5 GUARD: FAIL (${selftest} self-test case(s))`
                     : `ES5 GUARD: self-test OK (${CASES.length + budgetSelfTests} cases)`);
process.exit((selftest || problems.length) ? 1 : 0);
