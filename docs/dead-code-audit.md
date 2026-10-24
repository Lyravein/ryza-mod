# Dead Code and Unused Entry-Point Audit

Date: 2026-10-24

Scope: shipped web runtime, Electron/Android host entry points, and repository
scripts. This audit is report-only; no code was removed or changed because a
function that lacks a static caller may still be a public seam or a regression
fixture.

## Findings

### Resolved: semantic-action hold was not wired

- File: `web/js/avatar.js:824`
- Symbol: `Avatar.noteSemanticAction`
- Evidence: the symbol is defined and its state (`_semanticHold`) is consumed by
  the gesture scheduler, but no production source calls `noteSemanticAction`.
  The only references outside its definition are comments and audit/regression
  context.
- Intended behavior in the source comment: an LLM semantic action should hold
  the automatic gesture scheduler for 2.3 seconds so two gestures do not
  overwrite one another.
- Impact: before this fix, if an action/gesture was emitted through the current
  chat path, the semantic hold was never armed. The avatar could continue an
  automatic gesture while the semantic action was being presented.
- Fix: [`app.js`](../web/js/app.js) now detects the same bounded `*...*` action
  syntax used by Fish and calls `Avatar.noteSemanticAction()` immediately
  before speech. Ordinary dialogue is unchanged.
- Confidence: 8/10 before the fix.

## Confirmed intentional seams, not bugs

These have no apparent production caller but are documented or exercised as
public seams:

- `App._bubbleReveal` is an intentional no-op compatibility seam after the
  persistent log-panel redesign (`web/js/app.js:2264`).
- `Turn.isBusy` and `Turn.activeIntentId` are public state APIs; current UI
  code uses more specific state methods, but removal would break callers or
  external tooling.
- `Memory.setSummarizer`, `Echo.recentCount`, `Voice.suppressFor`,
  `Voice._bargePending`, `Voice.suppressedUntil`, `CrfStore.parseZip`, and
  `Api._fishCloneLimit` / `_fishUploadCount` are used by regression or import
  tooling and must not be classified as dead from production-only search.
- `App.renderWorld`'s `onPickArea` callback is passed into `WorldMap.render`;
  its callback property name makes a simple same-name search look unused.

## Script inventory result

- All `web/js/*.js` runtime modules are included by `web/index.html`.
- The files under `scripts/` are developer/regression/build tools, not shipped
  runtime modules. They are not referenced from `package.json` scripts, but
  their standalone `node scripts/*.js` entry points are intentional.
- Probe/screenshot helpers such as `old-shots.js`, `shot-talk.js`,
  `probe-*.js`, and `ux-walkthrough.js` are operational tooling rather than
  application code. They should be archived or documented separately if the
  repository wants a clean production tree.

## Documentation drift found

`docs/ryza-unification-architecture.md:508` labels
`Api.screenTagLine`, `detectThinkingStyle`, and `QWEN_DEFAULT_BASE` as having
no consumers. That is stale: the current `api.js` uses all three internally
(`screenTagLine` and `detectThinkingStyle` are also exported). The row should
be corrected before any cleanup pass; otherwise a maintainer could delete live
TTS/prompt logic.

The same row also describes the old TTS cancellation limitation. That
limitation was fixed in the current working tree by wiring the AbortController
signal through the TTS path, so the row is now stale for that issue as well.

## Validation performed

- `node scripts/expression_coverage.js` — passed; all referenced animation
  names resolve, with only explicitly unreferenced facial clips reported.
- `node scripts/boot_smoke.js` — passed.
- `node scripts/i18n_coverage.js` — passed.
- `node scripts/html_i18n_guard.js` — passed.
- State, persistence, speech, and transport regression batches — passed.
- Static caller scan was cross-checked against runtime seams and regression
  scripts; it was not treated as proof of dead code by itself.
