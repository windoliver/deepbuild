# Acceptance tests for #3282: an open taste call's time is drawn in the list

Written first and blind, at base commit `8c984adb9` (origin/main), from issue #3282 (its problem, Why, Why no test
catches it now, the owner's decision of 2026-11-19, the two acceptance criteria and the open point from #2883's review),
the design and the base, before any implementation. The implementing agent does not edit these files (AGENTS.md, Proof);
a dispute goes to a blind redraft of this job (design: Dogfooding).

| AC | ID | Criterion | Test |
| --- | --- | --- | --- |
| AC1 | `#3282.c198443a` | At a 260-wide list, each open taste call's row draws its time in a slot with width that holds the time's text. A planted row that draws it 0 wide fails, naming the row | `time.test.ts`, `AC1 …` (two tests) |
| AC2 | `#3282.d93e985c` | Session rows still show at least 12 characters of title beside their state word (#1808 AC7 unchanged) | `time.test.ts`, `AC2 …` (two tests) |

IDs are `criterionId` in `scripts/proof-change.mjs` (`#3282.` and the first 8 hex digits of SHA-256 of the criterion's
text, white space collapsed), checked against the live issue with its `readIssue`. Each test's name starts `AC<n> <ID>`;
no test uses subtests.

## What was read

- Issue #3282 (`gh issue view 3282 --comments`: one comment, the Mac round 1345e result that a test on the time slot's
  width fails on main). #1808, #1345, #1458 and #1620 only for the words #3282 cites (the 12-character title floor and
  AC7; AC8's time on each row; the time slot an ask row names; the replica's tree keeping a slot drawn with no width).
  Not read: PR #2883, its diff, branch `claude/1345-ask-row-time`, or any other work for #3282.
- `docs/technical-design.md`: How we know version 0 works (Wrong programs, Dogfooding, Tests written first). `node
  scripts/design-section.mjs --issue 3282` prints nothing: the issue links no section.
- At the base, for surfaces only: `crates/deep-app/src/rows.rs` (`RowDrawn::of`, the `timed` rule, `row_element`'s time
  slot `<row>:time` and an ask's `<row>:applies` inside it), `crates/deep-app/src/plain.rs` (`planted`),
  `crates/deep-app/Cargo.toml` (`env-plants`, the `plant-*` features), `packages/hub/src/rows.ts` (an ask's row),
  `scripts/proof-change.mjs`; the suites `1808` (README, helpers, `window.test.ts`), `1345` (README, helpers,
  `batch.test.ts`: AC8's `timeFailures`, which reads `ask:<ULID>:time` by name), `3234` (README), `1461`, `1463` and `26`
  helpers as `1808` imports them.

## How to run

With Node 24.22 and cargo first on `PATH`, on macOS:

```sh
npm ci --ignore-scripts && npm run build --workspaces
node node_modules/vitest/vitest.mjs run --root tests/acceptance/3282 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/3282/tsconfig.json
```

- **Builds.** #1808's `driveBins`: `deep-drive` with `--features deep-app/test-confirm` (plain) and
  `--features env-plants,deep-app/test-confirm` (planted), with #1172's build environment, copied to
  `$TMPDIR/dd1808-bin-<uid>-<first 8 hex of SHA-256 of the checkout path>/`. `deep-hook` is built when missing; the CLI
  and hub must be built (`npm run build`).
- **Folders and processes.** Every HOME is a temp folder (#16's `makeHome`). Nothing touches the real `~/.deepbuild`,
  `~/.claude` or `~/Library/LaunchAgents`. Only what a test started is stopped, by PID.
- **`--root` cache.** Vitest writes `tests/acceptance/3282/node_modules/.vite/`; delete it before committing.
- **Lanes.** The file starts a real hub and draws in replicas, so the folder needs a macOS lane in `scripts/lanes.mjs`
  as #1808's has; the implementer makes that edit.

## Surfaces (the implementation must provide these)

The issue names the list, its rows and #1345's `ask:<id>:time` node, and leaves the plant's name open. These are the
smallest that fit the merged surfaces; the tests use exactly these.

1. **The replica and its calls, all merged** (#124, #1461, #1808): `deep-drive --out <dir>`, `launch {from:
   "record_copy", size: [960, 640]}` in the world's HOME; `see` (the snapshot, each node's `id`, `name` and `bounds` in
   device pixels with `window.scale`; `runs`, the strings drawn with their bounds and `cut`; `rows`); `feed {session,
   event}`; `wait_for {t}`. No new call.
2. **Ids, merged and kept**: the list `list`, 260 points wide at 960×640; an open ask's row `ask:<ULID>`, its time slot
   `ask:<ULID>:time`, whose name is the time's text; a session's row `session:<id>` with its `:title` and `:word` slots.
3. **One plant**, `ask-time-0-wide`, selected by `DEEP_HUB_PLANT=ask-time-0-wide` and read through
   `crate::plain::planted("ask-time-0-wide")` in an `env-plants` build only (`deep-drive --features
   env-plants,deep-app/test-confirm`), as #1458's and #1808's row plants are: the topmost open ask row the list draws
   draws its time slot with no width (the base's `timed == false` drawing, `w(px(0.))`, its node kept in the tree with
   its name); every other row as shipped. It fails naming the row: `row ask:<ULID> ("<question>") draws its time "<time>"
   in a slot 0 wide (…)`.

## The fixture

One world, a record a real hub made (#1808's `makeWorld`, seeded with the hub stopped, then `deep hub run`): five
sessions in shop, `Look 1` to `Look 5`, finished, each with one open taste call raised by the asks core (#26's `askData`,
its deadline two days on), the questions in `helpers.ts` `QUESTIONS`; and one session in docs titled #1808's
`TITLE.twelve` ("Reconciliation of ledger exports across regions"), finished, fed INCONCLUSIVE in AC2 as the hub writes a
row that changed (#1808's `feedRow`).

## Readings

1. **"Draws its time in a slot with width that holds the time's text"** (AC1): for each of the five calls, the node
   `ask:<ULID>:time` exists, its name (the time's text) is not empty, its drawn width is more than 0, and the strings the
   replica reads drawn wholly inside its bounds spell that text (white space aside), none `cut`; the slot lies inside its
   row (2 px slack) and the strings inside the list on screen. A slot read by its name alone, as #1345 AC8's judge does,
   is not enough: at the base the slot is in the tree with its name and 0 wide.
2. **"A planted row that draws it 0 wide fails, naming the row"**: with `ask-time-0-wide`, the judgement fails for the
   topmost call row only, its failure starting `row <its id> ("<question>") draws its time "<time>" in a slot 0 wide`,
   and no other row fails. At the base every call row draws its time 0 wide, so this test fails there too.
3. **AC2** is #1808 AC7's judgement (`tests/acceptance/1808/window.test.ts`, `twelveFailures`, `#1808.98ed0a32`), which
   still runs unchanged in that suite. It is restated in `helpers.ts` `twelveFailures`, against this world, because a
   criterion of #3282 needs a test tagged with its own ID, and because this world sets session rows beside five taste
   call rows that, once fixed, keep their time: the list 260 wide, the row reading INCONCLUSIVE (the longest state word)
   in its word slot, at least 12 characters of its title drawn before its ellipsis, the start of its title, unclipped.
   Its wrong program is #1808's merged plant `title-shows-8`.
4. **The time's text** is whatever the app draws for when the call's recommended answer applies (#1458); these tests
   don't fix its words.

## What the base does

See `BASE-FAILURE.txt` (a run at `8c984adb9`). AC1's test fails at its assertion: each of the five call rows draws its
time in a slot 0 wide. AC1's wrong-program test fails at its assertion: the planted build, which knows no such plant,
fails all five rows, not only the topmost. AC2's two tests pass on the base, as a criterion that keeps a merged behaviour
must; the before lane needs a planted wrong program for `#3282.d93e985c` in `twins.json` (for instance a `rows.rs` whose
session rows keep their time as the fixed ask rows do), which depends on the implementation's `rows.rs` and is left to
the implementer.

## Scope the criteria don't cover

No criterion names these, so nothing here tests them: an ask row whose word, flag and time together exceed the row's
width (#2883's review); lists wider than 260; ask kinds other than taste; the card's rows (#1345 AC8).

## Files

- `helpers.ts`: IDs, the plant's name, the world's specs, AC1's and AC2's judgements. Reuses `../1808/helpers.ts` (and
  through it `../16`, `../26`, `../1461` and `../1463`).
- `time.test.ts` (AC1, AC2), `tsconfig.json`, `BASE-FAILURE.txt`.
