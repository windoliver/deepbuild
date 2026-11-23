# #2668: blind redrafts of #1463 AC1's drawn-row judge, #992 AC3, and #1463 AC6's run of #992 AC3

Three acceptance cases read what #1461 and #2018 changed. This kit redrafts each one to the current design. Each
redraft runs in its first draft's place only once a signed approval tag names the swap (#2668 Scope). Nothing here is
swapped, waived or wired into a lane by this job.

The kit was written blind at current main `b9ba2eba8765df31be72ad4d087ba8d3f9558e98`. Its inputs were issue #2668 and
the original issues #1463, #992 and #1461 (each as handed to this job: body only, no comments), `AGENTS.md`,
`docs/technical-design.md` and main itself. From the design it read: States people see (the table, the rows' one order,
one name per session), One list and one page, Replica, Needs-you view, Hooks are evidence and Dogfooding.

Main was read only for its surfaces:
- `packages/hub/src/{rows,list,status,sections,plant}.ts`, `packages/cli/src/main.ts`
- `crates/deep-app/src/{list,views,states,plain,setup}.rs`, `crates/deep-replica/src/{replica,snapshot}.rs`,
  `drive/mod.rs` (`launch`, `see`), `crates/deep-replica/Cargo.toml`
- `scripts/{lanes,proof-change}.mjs`, `scripts/known-failures.json`
- the suites `tests/acceptance/{1463,992,1461}` (README, helpers, the tests concerned)

This job saw no implementing work, proposed diff, dispute, other checkout or history. One disclosure: a directory
listing of the job folder above the checkout showed other files' names (logs, other jobs' folders). None was opened.

## Files

| File | What it is |
|---|---|
| `judges.ts` | Pure judges, no I/O. `drawnRowFailures` is the redrafted drawn-row judge for #1463 AC1. `statusTextWord` and `appSessionWord` give each reader's word for a session (#992 AC3). `disagreements` names each session the two readers name differently. |
| `judges.test.ts` | Holds each judge to the window and listing main draws, and to every wrong program below. No hub, CLI or replica. No criterion tag: it passes on main, as #1463's `judges.test.ts` does. |
| `agree-readers.ts` | The I/O for #992 AC3: `deep status --json` and `deep status` with HOME the replay's home, and the app's list from the real `deep-drive` over a copy of that hub's record. |
| `proposed/tests/acceptance/1463/list.test.ts.proposed` | The complete replacement for `tests/acceptance/1463/list.test.ts`. |
| `proposed/tests/acceptance/992/agree.test.ts.proposed` | The complete replacement for `tests/acceptance/992/agree.test.ts`. |
| `tsconfig.json` | The same as #1463's. |

**Why the `.proposed` suffix.** The brief asks for each replacement at `proposed/<original repo path>`.
`scripts/lanes.mjs` (`testPaths`, `testGlobs`) collects every `tests/**/*.test.ts` into the unit lane. A file at
`proposed/tests/acceptance/1463/list.test.ts` would therefore run there now, out of place, with `./helpers.ts`
unresolved, and fail on main. This job may not change `lanes.mjs`, so each proposal keeps its path and adds
`.proposed`. The swap drops the suffix. The bytes are otherwise exactly what lands.

## Criteria, tests and wrong programs

Criterion IDs are `scripts/proof-change.mjs`'s `criterionId` of each issue's criterion text, recomputed from the issue
bodies; they match the suites' own tags.

| Criterion | Redraft | What it holds now | Wrong programs it fails, naming the row or session |
|---|---|---|---|
| #1463 AC1 `#1463.f9ab70a8` (and AC12 `#1463.17f151eb`, same file, unchanged) | `list.test.ts.proposed`. Only the drawn-row judge changes, from `drawnFailures` to `drawnRowFailures`; every other line is the first draft's. | The app's list and `deep status --json` hold the same rows, ids, order, words and the compared fields at one `log_pos` (unchanged). The window draws see's rows as the one list lays them out: (1) heading Needs you first, then the ask rows in the rows' order of the asks, above every project's heading; each ask node carries its question, its entry (or how it waits), and a word in its state-word slot. (2) Then each session under its own project's heading, a project's sessions in the rows' order; each node carries its title, its entry and, in its word slot, the row's word. (3) A quiet session is folded into its project's `quiet:…` row, which counts it and reads quiet. | In the test (unchanged): `status-second-order` and `status-own-word`, naming each row; for AC12, `status-unread-flipped`. On the judge (`judges.test.ts`): the rows drawn in their one order (asks under the projects); a second order of the asks; an ask with no slot word, title or entry; no Needs you heading; a session under another project, out of its project's order or missing; the planted app's `working` for a session that needs you; a quiet session not folded or miscounted; no list. |
| #992 AC3 `#992.45c506d1` | `agree.test.ts.proposed`. One test, as before. | The same twelve recordings, replayed and read at the same moments as the first draft, with the same BLOCKED when one is missing. `deep status` names a session by its `--json` row's word, found by its `session`. Its text line, found by the row's one name, must say the same word; a quiet session is read from the folded `<n> quiet, by repo:` line. The app names it by its row's state-word slot in the real replica's list over the same record; a quiet session by its project's quiet row. The two must agree for all twelve, and between them cover needs you, flagged, working, says done and quiet. | `DEEP_HUB_PLANT=waiting-as-working` (the replica's env-plants app) must disagree on every session `deep status` reads needs you, naming it. Run the whole test with `DEEP_HUB_PLANT=waiting-as-working` and the plain read is planted too, so it fails at the first expectation, naming that session. |
| #1463 AC6 `#1463.cc5d1e3f` | No new bytes. `tests/acceptance/1463/words.test.ts` stays byte for byte. Its first test runs `tests/acceptance/992/agree.test.ts` as it then stands, so after #992's swap it runs the redraft above. | `992/agree` still holds: the child run exits 0 with `1 passed` and no failure. The proposal keeps AC3 one test so this check holds. "Every word comes from `states::TABLE`" is AC6's second test, unaffected and unchanged. | Run `words.test.ts -t "992/agree still holds"` with `DEEP_HUB_PLANT=waiting-as-working`. The child vitest inherits it, the redraft fails naming the needs-you session, and AC6 fails with that output's tail. |

#2668's own criteria (`#2668.bf15d1ca` each redraft passes on main and fails each planted program;
`#2668.1ee40686` signed swaps, entries gone; `#2668.8bbff04b` `node scripts/known-failures-check.mjs` passes) are
proven by the proof runs below and by the swap itself, not by a test file here.

## The swap (needs the owner's signed approval tag naming it)

1. `tests/acceptance/2668/proposed/tests/acceptance/1463/list.test.ts.proposed` →
   `tests/acceptance/1463/list.test.ts` (replace the file whole).
2. `tests/acceptance/2668/proposed/tests/acceptance/992/agree.test.ts.proposed` →
   `tests/acceptance/992/agree.test.ts` (replace the file whole).
3. `tests/acceptance/1463/words.test.ts`: no change. AC6's redraft is (2) in place.
4. Delete `tests/acceptance/2668/proposed/` once (1) and (2) land, so no stale copy remains.
5. `scripts/known-failures.json`: remove the three entries #2333 added for these cases when each swap lands (#2668
   Scope). This checkout's `known-failures.json` holds **no** entry naming `1463/list`, `992/agree`, `1463/words`,
   `#2668` or `#2333`. Either #2333's entries aren't on this main, or they're keyed differently. The integrator must
   find them on the branch that has them. Then run `node scripts/known-failures-check.mjs` (not run here).

Nothing else changes: not `scripts/lanes.mjs` (the kit's `judges.test.ts` falls under the unit lane's
`tests/**/*.test.ts`; `tests/acceptance/1463/` and `tests/acceptance/992/agree.test.ts` are already in a macOS lane), not
`tests/acceptance/992/twins.json` (AC3 still maps to `waiting-as-working`), and not Cargo, settings, hooks or approvers.

### Protected files whose swap needs the owner's signature

- `tests/acceptance/1463/list.test.ts` (replaced)
- `tests/acceptance/992/agree.test.ts` (replaced)
- `tests/acceptance/2668/judges.ts` and `tests/acceptance/2668/agree-readers.ts`: both replacements import them, so they
  become part of those suites and are protected as they are
- `tests/acceptance/2668/judges.test.ts`, `tests/acceptance/2668/tsconfig.json`, this README
- `scripts/known-failures.json` (the three entries' removal)
- Read by the redrafts and so frozen with them, though unchanged: `tests/acceptance/1463/{helpers.ts,words.test.ts}`,
  `tests/acceptance/992/helpers.ts`, `tests/acceptance/16/helpers.ts`, `tests/acceptance/26/helpers.ts`,
  `tests/acceptance/1551/helpers.ts`

## Reused, and not reused

Reused because it implements the current contract:
- #992's replay, stand-in agent, homes, `run`, `childEnv`, `stepClock`, `recorded`, `mustTag`, `callOf`, `answerOf`,
  `label` and cleanup
- #1463's `makeWorld`, `atOneLogPos`, `rowFailures`, `shapeFailures`, `jsonRows`, `Drive`, `driveBinaries` and cleanup
- the tree's ids, as #1459 and #1461's own suite pin them: `list`, `heading:needs-you`, `heading:<project>`,
  `quiet:<project>`, `<row id>:word`

Not reused, because #2018 and #1461 left them behind:
- #1463's `drawnFailures`
- #992's `statusOf` (a row by its short ID), `WORDS` and `wordOf` (six words), `appRows` and `app.rs` (a sidebar row by
  `session:<id>` alone, so a folded quiet session reads nothing)

No mock of an owned component and no source-pattern assertion. Every reading in the proposals comes from the real hub,
CLI and replica.

## How to run (builds required)

On macOS with Node 24.22, `npm ci --ignore-scripts; npm run build --workspaces`, and cargo on PATH:

- `cargo build --locked -p deep-hook`
- The replica's `deep-drive`, built by #1463's `driveBinaries` with `--features env-plants` and plain, into
  `$TMPDIR/dh1463-bin-<uid>`. This is a cold Rust build of gpui: minutes.

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2668                     # the judges, anywhere, no build
node node_modules/typescript/bin/tsc -p tests/acceptance/2668/tsconfig.json
# After the swap (or in a scratch copy with the proposals in place, as below):
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1463 --no-file-parallelism list.test.ts
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/992 --no-file-parallelism agree.test.ts
DEEP_HUB_PLANT=waiting-as-working NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/992 --no-file-parallelism agree.test.ts   # must fail, naming the needs-you session
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1463 --no-file-parallelism words.test.ts
DEEP_HUB_PLANT=waiting-as-working NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1463 --no-file-parallelism words.test.ts -t "992/agree still holds"   # must fail
```

**Proof before the swap, with no repo edit.** Copy the checkout's root `package.json`, `tsconfig.json`, and
`tests/acceptance/{16,26,1359,1551,1463,992,2668}` into a scratch tree. Symlink `node_modules`, `packages`, `adapters`
and (for builds) `crates`, `Cargo.*`, `target` into it. Copy the two `.proposed` files to their paths without the
suffix and run the commands above there. That is how the typecheck and BLOCKED runs below were observed.

Without a build, every case here ends BLOCKED and fails, never skips or passes: no CLI, no `deep-hook`, no `deep-drive`,
not macOS, or a missing recording.

## Observed here (no build exists in this checkout: no `dist/`, no `target/`)

- `vitest run --root tests/acceptance/2668`: 13 passed (13).
- `tsc -p tests/acceptance/2668/tsconfig.json`: exit 0.
- In the scratch copy with both proposals in place: `tsc -p …/1463/tsconfig.json` exit 0 and
  `tsc -p …/992/tsconfig.json` exit 0, with `--listFiles` showing both replaced files and `2668/*.ts` compiled.
- In the scratch copy, the proposed `list.test.ts` ran: all 4 tests fail
  `BLOCKED: no built CLI at packages/cli/dist/main.js`.
- In the scratch copy, the proposed `agree.test.ts` ran. It passed its corpus check (all twelve recordings are on main)
  and failed `BLOCKED: the CLI isn't built`.
- In a scratch-only test (not in the repo), the first draft's `drawnFailures` on the list as main draws it failed. It
  named the two ask nodes reading "Pick one" or "How it looks" (which lack "needs you") and the ask row drawn above the
  row before it: #2668's description. `drawnRowFailures` passed the same window.
- A vitest cache, `tests/acceptance/2668/node_modules/.vite/`, was left by the judges' run. Removing it wasn't approved
  here. It is git-ignored (`.gitignore:1`).

## Not run (needs the builds above on a Mac; the proof bay's job)

- Every redraft once on main.
- Each planted program:
  - `status-second-order`, `status-own-word` and `status-unread-flipped` inside `list.test.ts`.
  - `waiting-as-working` inside `agree.test.ts`, and as the whole run's `DEEP_HUB_PLANT`.
  - `words.test.ts`' first test, plain and with that plant.
- `node scripts/known-failures-check.mjs` and `node scripts/affected.mjs`.
- So it is unconfirmed that main passes: that the twelve read the five covered words, and that the replica's list
  shows the fixture with the ids above. Main's code, read by hand, says it should.

## Readings and open points the owner may decide

1. **The stop's word in AC3's coverage.** The first draft's coverage listed `finished`. Under the current design every
   stop is judged ("a turn with no claim yet gets one", `stop-judging.ts`), so a recorded stop reads `says done`.
   #2668 reports six of the twelve read `says done`. `finished` ("stopped with no claim to judge") is reachable by none
   of the recordings. This redraft therefore covers needs you, flagged, working, says done and quiet. If the owner
   reads "every state" to still need `finished`, the corpus needs a recording that reaches it, and main fails until then.
   If the stops' checks reached a verdict before the read, coverage would fail on main. That is unconfirmed until run.
2. **An ask row's word.** For an ask, the window says "needs you" in the heading (#1461) and the kind in the slot. The
   judge requires the ask under Needs you, its node's value its entry (or folded, later or held), and some word in its
   slot. It doesn't pin the kind's text, and it doesn't reject "needs you" there: those are #1461's AC2 and AC27, not
   #1463 AC1.
3. **Project order** isn't judged (neither issue nor the design orders projects; main sorts them by name). A
   project's sessions are held to the rows' order.
4. **Quiet sessions must fold** into their project's quiet row, as the design says. A window that draws a quiet session
   as a row of its own fails, naming it.
5. **`deep status`'s word** for AC3 is the JSON row's word where its text line says the same. A CLI whose text and JSON
   disagree fails, naming the session. AC3 needs no single `log_pos` (its criterion names none), but the status read
   used is the one at the app's copy's `log_pos` when it has it.
6. **AC6 has no file of its own to swap.** Its entry clears with #992's swap. Its check relies on AC3 staying one test
   (`1 passed`).
7. **Time.** The proposed AC3 builds `deep-drive` twice and launches it twice per recording. Its timeout is 40 min,
   under `words.test.ts`' 45-minute kill of the child run. A cold build on a slow machine could reach that kill, and
   AC6 would then fail, not pass.

## Left as they are, noted separately (not commissioned here)

- `tests/acceptance/1463/judges.test.ts` still self-tests the first draft's `drawnFailures`. It passes, and after the
  swap no criterion uses that judge.
- `tests/acceptance/992/README.md` and `1463/README.md` still describe the old AC3 and AC1 surfaces. A README edit
  isn't proposed here.
- `tests/acceptance/992/app.rs` and its `[[test]] acceptance_992_app` remain for AC2's sidebar test.
- #992's `quiet.test.ts`, `gone.test.ts` and `notification.test.ts` (AC1, AC2, AC4) also read `deep status` through
  `statusOf`, by short ID. By #2668's own account of #2018, they may find no row on main. They have no entry in this
  checkout's `known-failures.json`. Unverified here and outside #2668's scope.
