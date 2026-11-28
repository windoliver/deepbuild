# Acceptance suite for #3289: #25's twins counted by the before lane, once wake, session-end and flags are redrafted

Written blind at base `254bdc87c` (origin/main, "Merge pull request #3751") from issue #3289's body, #25's body, the
design and the base, by a fresh run of the blind acceptance-test job (AGENTS.md, Proof; design, Dogfooding). It edits no
file outside this folder.

## The criteria

| ID | Criterion (short) | Test (`lane.test.ts`) |
|---|---|---|
| `#3289.4d4ebb87` | with `waiter-never-wakes` laid on main, the redrafted AC2 test fails at its assertion, naming the session that never woke within 30 s; without the twin it doesn't fail (p95 may be INCONCLUSIVE) | `#3289.4d4ebb87 with waiter-never-wakes laid on main, …` |
| `#3289.0057f123` | with `waiter-outlives-session` laid, the redrafted AC3 test fails at its assertion, naming the waiter's pid and that it still ran 10 s after its session ended; without it, it passes | `#3289.0057f123 with waiter-outlives-session laid on main, …` |
| `#3289.4932b560` | with only `routes-from-settings` laid, the redrafted AC5 test fails at its assertion, naming the ask whose `next_prompt` `delivered` outcome by A's next prompt is missing; without it, it passes | `#3289.4932b560 with only routes-from-settings laid on main, …` |
| `#3289.1de37162` | with only `routes-kept-across-sessions` laid, the redrafted AC5 test still fails at its assertion | `#3289.1de37162 with only routes-kept-across-sessions laid on main, …` |
| `#3289.24701d6f` | the before lane on main reads each of these twins, laid alone, as `failed on <twin> at its assertion`, never "fails on neither" | `#3289.24701d6f the before lane on main reads …` |

All five IDs were recomputed from the body with `criterionId` of `scripts/proof-change.mjs` (SHA-256 of the checkbox
line's text, trimmed, white space collapsed, first 8 hex digits): they match the expected IDs, in the body's order.

## What was read

- AGENTS.md; #3289's body; #25's body (its AC2, AC3 and AC5 lines).
- `docs/technical-design.md`: Dogfooding (a disputed test goes to a fresh run of the blind job), and "Fail before, pass
  after" / "Failing on an assertion" (what counts as a failure at an assertion).
- At the base: `scripts/proof-runs.mjs` (`prepareRuns`, `twinsOf`, `twinOverlay` — how a twin's `lines.json` is laid —
  `atAssertion`, `wrongProgram`, `before` and its lines), `scripts/proof.mjs`, `scripts/proof-change.mjs` (`readChange`,
  `listFiles`, `tagsWithImports`, `criterionId`), `scripts/lanes.mjs` / `scripts/lanes-lists.mjs` (`byHand`,
  `redrafted`, `listed`, `LANE_FILE`, `alone`), `scripts/proof-guard.mjs` (lane.json shape), `scripts/bays.mjs`
  (`claimPair`), `scripts/throttle.mjs` (`acquire`), `scripts/proof-binaries.mjs` (head);
  `tests/acceptance/25/twins.json`, `twins/*/lines.json`, `twins/REDRAFT-1832.md`, `routes/wake.test.ts`,
  `routes/session-end.test.ts`, `fallbacks/flags.test.ts`, parts of `routes/helpers.ts` (`answerEach`, `newSession`,
  `outcomes`); `tests/acceptance/3178/` (README, `suites.test.ts`, `lane.json`, `tsconfig.json`) and
  `tests/acceptance/1832/` (`plant.test.mjs`, `helpers.mjs`) for conventions.

## How to run

Node 24 first on `PATH`, macOS, from the checkout's root, after `npm ci` and `npm run build --workspaces` (the lane
installs and builds its own copies, and builds deep-hook through the throttle as its runs need):

```sh
node scripts/throttle.mjs test --wait 720 -- node node_modules/vitest/vitest.mjs run tests/acceptance/3289/lane.test.ts --no-file-parallelism
npx tsc --noEmit -p tests/acceptance/3289
```

`lane.json` runs this folder alone (`binary`). Before a redraft lands the file takes about a second: each test stops at
its first assertion. Once one lands, the first test that finds it starts the before lane once (`run-lane.mjs`, a
process group of its own, stopped by its PID when the file ends or after 5.5 h), and all five read that one run: hours
on a loaded Mac, as the lane runs each redraft file on main, on the merge base and on each of the four twins, each in an
installed and built copy. Its report goes to a fresh `$TMPDIR/dh3289-*` folder, removed after.

## The surface, and what the implementation must provide

**Finding the redraft (every test's first assertion).** As the lanes find one, through the checkout's
`scripts/lanes.mjs`: for each first draft (`tests/acceptance/25/routes/wake.test.ts` for AC2,
`routes/session-end.test.ts` for AC3, `fallbacks/flags.test.ts` for AC5),

- the first draft no longer runs in the lanes: `byHand` lists it (or it is gone), as `prepareRuns` leaves out "a first
  draft that a blind redraft replaced";
- the redraft's folder is the one `redrafted[<first draft>]` names, which must exist; when `redrafted` names none, any
  folder of suite 25 with a `redraft` segment under `tests/acceptance/25/`, or a sibling `tests/acceptance/25-…redraft…/`
  (3178's convention);
- its test files (`*.test.{ts,mjs,js}`, `twins/`, `fixtures/`, `node_modules/` left out) that the lanes run (not
  `byHand`) and that carry the criterion's tag (`tagsWithImports`, so a tag held in an imported constant counts):
  `#25.ee0f30b0` (AC2), `#25.008fdf08` (AC3), `#25.c5d6abef` (AC5). File names are free.

**The lane run.** `run-lane.mjs` imports the checkout's own `prepareRuns` and `before` and gives them a change that adds
those files to the checkout's HEAD (`base` = `head` = HEAD, `issue: null`, so the files the change touches are the
tagged ones). So "main" is the checkout's own code; the merge base runs the same code; and each twin that the redraft
folder's `twins.json` names for a test's criterion is laid alone over a copy of main by its `lines.json`, exactly as the
lane lays it. The lane's own readings are kept: each result's status and `failure` (`atAssertion`, `cause` = the
error's name and first line), and the lines `before` prints.

The implementation must provide, for each criterion:

1. **AC2 (`#3289.4d4ebb87`).** A redraft test carrying `#25.ee0f30b0` that doesn't fail on main (it passes, or skips
   INCONCLUSIVE on its p95), and fails on `waiter-never-wakes` at its assertion (`atAssertion` as the lane reads it),
   with the failure's first line naming the session by its ID (a UUID, as Claude Code's session IDs are), a wake, and
   `30 s`.
2. **AC3 (`#3289.0057f123`).** A redraft test carrying `#25.008fdf08` that passes on main and fails on
   `waiter-outlives-session` at its assertion, its first line naming the waiter's `pid <n>`, `10 s` and its session.
3. **AC5 (`#3289.4932b560`).** A redraft test carrying `#25.c5d6abef` that passes on main and fails on
   `routes-from-settings` at its assertion, its first line naming the ask (`ask:<id>`), `next_prompt` and `delivered`.
4. **AC5 (`#3289.1de37162`).** A redraft test carrying `#25.c5d6abef` that passes on main and fails on
   `routes-kept-across-sessions` at its assertion.
5. **The lane (`#3289.24701d6f`).** For each of `waiter-never-wakes` (AC2), `waiter-outlives-session` (AC3) and
   `routes-from-settings` (AC5): `before` prints `PASS before: <test>: failed on <twin> at its assertion` for a redraft
   test of that criterion, and every redraft test of the criterion that passes on main and fails on the twin reads
   `PASS … failed on <twin> at its assertion` — never `fails on neither the merge base nor its planted wrong program`,
   and no `BLOCKED … does not apply` for the twin. A test that passes on the twin (a wrong-program test, which sets the
   plant itself) is not judged here.

In every test, a twin the lane laid from the redraft's own folder (a sibling folder has its own `twins.json`, which
`twinsOf` reads) must be #25's twin of that name file for file (`tests/acceptance/25/twins/<twin>/`): "the twins'
`lines.json` stay as they are". A twin that doesn't apply (`stale`), is refused, or isn't named for the criterion
fails the test.

## Not a verdict: INCONCLUSIVE and BLOCKED

A run the machine keeps from a verdict is skipped, with INCONCLUSIVE or BLOCKED first in the note, never passed: the
lane wrote nothing or threw (BLOCKED, or INCONCLUSIVE when stopped at 5.5 h), a file the lane couldn't run on main or on
a twin's copy (`unrunnable`, as a timed grant that never came, a build or an install that failed), or a test that fails
on the twin as named but was skipped on main (INCONCLUSIVE under load), so whether it passes without the twin is
unread. A skip only stands when no twin of the test failed outright.

## Wrong programs

The merge base is this suite's wrong program: it holds no redraft of the three tests (`redrafted` names none for
them, and `byHand` still runs neither of the first drafts out of the lanes), so every test fails at its first
assertion, `#3289 no blind redraft of <AC> replaces <first draft>: …`, at an `expect` in this file. No twin of this
folder's own is needed (BASE-RESULTS.txt). That failure is also what any program lacking the redraft gets, and a
program whose every function returns nothing finds no file and fails the same assertion; a lane run that returns
nothing gives no proven twin and fails (or, with no result file at all, is skipped as INCONCLUSIVE, never passed).

## Readings and assumptions

- "Laid on main": over the checkout the test runs in, as the lane lays a twin over the change's copy. The change is
  made of the redraft files alone, so the lane runs those and nothing else of suite 25.
- "Fails at its assertion": the lane's own `atAssertion` (design, "Failing on an assertion"); "naming": in the
  failure's first line, the `cause` the lane keeps and prints. A redraft that names these only in later lines of its
  message fails these tests.
- AC5's two twins: the lane prints only the first twin a test fails on, so `#3289.1de37162` reads
  `routes-kept-across-sessions`' run from the lane's results, not from its lines; `#3289.24701d6f` checks the three
  twins the issue's summary names.
- The p95 reading: a redraft AC2 test skipped as INCONCLUSIVE on main still counts as "doesn't fail" for
  `#3289.4d4ebb87`; the lane prints nothing for a skipped test, so `#3289.24701d6f` then reads INCONCLUSIVE for
  `waiter-never-wakes` unless another AC2 test that passed on main is the one that failed on the twin.
- #25's tags are put together at runtime in `lane.test.ts`, so this file carries no #25 tag a lane could read as its own.
