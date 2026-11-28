# Blind redraft of #1427's motion-lab suite: a lab panel the base loads

Written blind at base commit `fc09a09cb` (main), from issue #1427's body, the design, the base and the first draft
(`tests/acceptance/1427/`), with the dispute's evidence: a run of the first draft on main `a1ef97760`. The drafting job
saw no work that implements anything: no other branch, worktree, pull request, transcript or note. The implementing
agent doesn't edit these files (AGENTS.md, Proof); this is the one redraft each of these tests gets (design: Dogfooding).

## Which files this replaces, and why

| First draft, now by hand | Redraft, in its place | Criterion | ID |
|---|---|---|---|
| `../1427/ac1-journeys.test.ts` | `ac1-journeys.test.ts` | 1 | `#1427.44c596cb` |
| `../1427/ac2-reader.test.ts` | `ac2-reader.test.ts` | 2 | `#1427.8eb79b07` |
| `../1427/ac3-reduced.test.ts` | `ac3-reduced.test.ts` | 3 | `#1427.de1e992b` |
| `../1427/ac5-repeat.test.ts` | `ac5-repeat.test.ts` | 5 | `#1427.3c390bf0` |
| `../1427/ac6-pacing.test.ts` | `ac6-pacing.test.ts` | 6 | `#1427.388cd750` |
| `../1427/scope-recording.test.ts` | `scope-recording.test.ts` | Scope line 1, not a criterion | none |

The dispute, as its evidence shows it: every real-replica test in those six files fails before any assertion of its
criterion, because the replica refuses the first draft's lab panel at launch:
`the panel didn't load: main.js:23 imports "gpui-kit", the toolkit under DeepBuild's module; a panel imports only
"@deepbuild/panel"`. Since #1425 a panel imports only `@deepbuild/panel` (`crates/deep-app/src/panel_module.rs`,
`check`), and `crates/deep-app/panel-catalog.json` serves `View` and `div` (from gpui-kit) and `Button` (from gpui-base)
through it. No program passes the first draft's journeys without undoing #1425, so they are redrafted, not edited.

The six files are the first draft's whole files: their data tests don't load the lab and are copied unchanged, so each
redraft file stands in for its original whole and no test runs twice.

## What changed from the first draft, and what did not

- **The fixture**, `fixtures/panels/motion-lab/main.js`, is the first draft's with its two import lines made one,
  `import { View, div, Button } from "@deepbuild/panel";`. Every button, lane, path, timer, number, id, transition and
  spring is the first draft's; what each button plants and which twin passes is the first draft's README, Fixtures, and
  its fixture's header comment.
- **`helpers.ts`** re-exports `../1427/helpers.ts` (frozen, imported) whole and overrides only `HERE`, `LAB`,
  `launchLab` and `journey`, which now name this folder's fixture; the launch (640 by 600 points, scale 2, virtual
  clock) and the journey (launch, press, wait to 6 s, expect the button visible) are the first draft's.
- **Each test file** is the first draft's code, test names, journeys, values, limits and timeouts unchanged, with each
  criterion's `describe` name carrying its ID `#1427.<sha8>` (the first eight hex digits of the SHA-256 of the
  criterion's text, whitespace folded, as `scripts/proof-change.mjs`'s `criterionId` computes it).
  `scope-recording.test.ts` holds a Scope line, not a criterion, so it carries no ID.
- **No comments.** Since #3455 a drafted suite holds no comment lines (`scripts/comment-ratchet.mjs`), so the first
  draft's comments, in the tests, helpers and fixture, are left out; what they said is the first draft's README and
  files, and this README. Nothing else changed with them.
- **`lane.json`** runs the folder alone, as `scripts/lanes-lists.mjs` runs `tests/acceptance/1427/`.

## The criteria, whole

- Criterion 1 (`#1427.44c596cb`): "Planted fixtures each give exactly one finding, named with its element and time: a row that appears above 50% opacity in one step (`pop_in`); a move over 25% of the window in one 1/120 s step with no flight declared (`jump`); a move more than 12% past its target with no spring declared (`overshoot`); opacity reversing direction more than twice in 200 ms (`flicker`); anything still moving 2 s after its last input (`no_settle`)"
- Criterion 2 (`#1427.8eb79b07`): "A streaming fixture that inserts text above the reader's line gives `reader_moved`. The same fixture with the insert below gives nothing"
- Criterion 3 (`#1427.de1e992b`): "Under reduced motion, any element that changes place over more than one step gives `moved_under_reduced_motion`"
- Criterion 5 (`#1427.3c390bf0`): "The same journey recorded twice gives byte-equal findings"
- Criterion 6 (`#1427.388cd750`): "A result never reads PASS for pacing: it says "pacing not measured" until a live run has measured it"
- Scope line 1 (`scope-recording.test.ts`): "A replica journey can record, at each virtual-clock step, every element's bounds, opacity and text, keyed by stable identity"

## Not redrafted

- `../1427/ac1-planted.test.ts`, `ac4-allowances.test.ts`: data only, no lab; not in the dispute.
- `../1427/ac7-shipped.test.ts`: the shipped journeys, not the lab; not in the dispute.
- `../1427/ac8-budget.live.test.ts` and its #1830 redraft `../1427-redraft-1830/ac8-budget.live.test.ts`: the latter
  imports `launchLab` from `../1427/helpers.ts`, so it launches the first draft's lab and would be refused at launch too.
  Criterion 8's test was already redrafted once (#1830), and each test is redrafted at most once, so it is left to the
  maintainer; it runs by hand only.

## What was read

AGENTS.md; issue #1427's body; `docs/technical-design.md` (Replica, Dogfooding, Who drafts it, Proven on the base,
Failing on an assertion); the first draft whole (README, helpers, the six files above, the fixture, BASE-FAILURE.txt)
and `../1427-redraft-1830/` (README, test, tsconfig) as the house format; the dispute's base run on `a1ef97760`; at the
base `crates/deep-app/src/panel_module.rs`, `crates/deep-app/panel-catalog.json`, `crates/deep-app/panel-reach.js`,
`tests/acceptance/124/fixtures/panels/save-form/main.js`, `crates/deep-replica/tests/fixtures/canvas-panel/main.js`,
`tests/acceptance/124/helpers.ts` (the build, `Drive`, `requireMacos`), `scripts/lanes-lists.mjs` (`alone`, `byHand`,
`redrafted`, `LANE_FILE`), `.gitignore`, and the README of `../1352-redraft-3402/`.

## How to run

```sh
npm ci && npm run build --workspaces                     # once
node scripts/throttle.mjs build -- cargo build --locked -p deep-replica --bin deep-drive --features env-plants
npx tsc -p tests/acceptance/1427-redraft-panel/tsconfig.json
node scripts/throttle.mjs test -- npx vitest run --root tests/acceptance/1427-redraft-panel --no-file-parallelism
```

macOS and cargo, as the first draft's (off macOS each test fails `INCONCLUSIVE:` and never passes). Each file builds
`deep-drive` once with #124's helper (a no-op after the build above). gpui-shell writes `gpui-kit.d.ts` and
`jsconfig.json` into the fixture's folder at each load, and DeepBuild writes `@deepbuild/panel.js` there (ignored by
`**/@deepbuild/`); the first two are not ignored for this folder, so a run leaves them untracked. `.gitignore` is
outside this folder: the maintainer adds `tests/acceptance/1427-redraft-panel/fixtures/panels/*/gpui-kit.d.ts` and
`.../jsconfig.json` beside #1427's two lines.

## On the base

Run on `fc09a09cb` in a fresh worktree with only this folder copied in, 2026-11-27: `npm ci`, `npm run build
--workspaces`, `node scripts/throttle.mjs build -- cargo build --locked -p deep-replica --bin deep-drive --features
env-plants` (exit 0), then `caffeinate -dimsu node scripts/throttle.mjs test -- npx vitest run --root
tests/acceptance/1427-redraft-panel --no-file-parallelism --reporter=verbose`. A first attempt was stopped at the build
when the shared disk ran low; the run above is a clean second one. `BASE-FAILURE.txt` holds its whole output (home paths
written `~`, the checkout as `<base checkout fc09a09cb>`), named as the house names a base run's file though nothing failed.

All 6 files and 41 tests pass; none reads "the panel didn't load". The base's replica loads this lab, and the base
already has `motion` and `motion_check` (the dispute's own run shows `motion_check` answering there), so #1427's behavior
these files judge is on the base: as checks of behavior that must not change they pass, and none of them can show a
fix on this base.
