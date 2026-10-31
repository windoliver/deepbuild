# Acceptance tests for #875: the hub judges a base run by where it failed, not only by its exit

Written first and blind, from issue #875 (its Scope and its 4 checkbox criteria), `docs/technical-design.md` (Fail before,
pass after; Failing on an assertion; Check health; Whose checks count, for a check's own files; the checks-command row),
`AGENTS.md`, the acceptance tests of #29 and #31 for their conventions and helpers, and base commit `0d97024f` (main at
`6f637e33` with #31's branch merged), by a job that never saw an implementation of #875. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

| AC | Tag | Criterion, in short | Test |
| --- | --- | --- | --- |
| AC1 | `#875.15f7a4ab` | a test importing a helper only the fix adds: INVALID, `failed on the base before its tests ran` | `hub.test.ts` |
| AC2 | `#875.b3b1e7e3` | a base run failing with a `TypeError` from a function the fix adds: INVALID, `failed on the base only elsewhere` | `hub.test.ts` |
| AC3 | `#875.efd89fb9` | the sample repo's real fix, failing its assertion on the base: PASS | `hub.test.ts` |
| AC4 | `#875.758d1556` | a hub that counts any non-zero base exit as proof fails these tests | `hub.test.ts` |

Tags are derived as `scripts/proof-change.mjs` derives them: `#875.` and the first 8 hex of SHA-256 of the criterion's text
after `- [ ] `, trimmed, white space collapsed. Each `describe` carries its tag.

```sh
npm ci                                    # once, if node_modules is missing
npm run build --workspaces                # the deep CLI the hub runs from
cargo build -p deep-hook                  # the hook binary (the suite builds it once if it's missing)
npx vitest run --root tests/acceptance/875
node node_modules/typescript/bin/tsc -p tests/acceptance/875/tsconfig.json
```

Use the repo's Node (`.node-version`, 24.22.0). With `--root` here Vitest writes its cache to `tests/acceptance/875/.vite/`;
delete it before committing. Each test starts its own hub, one after another (one file); on a loaded machine a test takes
a few minutes, mostly the copy-on-write clones of the install and the two Vitest runs.

## The surface under test

"Through a real hub" is the `deep hub run` process with deep-hook and a Claude Code stand-in, as
`tests/acceptance/29/h-d.ts` drives them (`startHub`, `Session`, `settle`, `control`, `cleanup` are imported from there). The
hub is handed the definition through `DEEP_HUB_TEST_DRAFTS` and the planted program through `DEEP_HUB_PLANT`. Nothing stands
in for DeepBuild: the hub, deep-hook, the record and Vitest are real; no network and no model.

Each test, through `claimFix` in `helpers.ts`:

1. Makes a world under `/tmp/dh875-*` laid out as #29's `makeWorld` lays one out (the shipped default guards, your ask
   settings, the OS-confirmation stub), whose repo is #31's sample (`SEEDED` from `tests/acceptance/31/helpers.ts`: the cart
   total ignores the discount) on `main`, one commit holding the seeded bug and the drafted check file, with Vitest cloned
   in from the repo's install (ignored by the sample's `.gitignore`). `installVitest` clones only the packages the repo's
   `package-lock.json` reaches from `vitest` (about 60, against the 540 #31's `install` clones): the hub clones the
   worktree's `node_modules` again into every checkout, and on a loaded machine the whole install made a claim's checkouts
   take minutes.
2. Starts the hub, opens a session, types `make the cart total take the discount off`, and waits for the task's definition
   to lock. The definition handed for that prompt has one requirement, `R1`, with `check: .deepbuild/checks/cart-discount.sh`,
   `on_base: fails` and the fix's `asserts`, and `deliverables: ['src/cart.ts']`.
3. The session reads `src/cart.ts`, writes the fix's files (Edit for a file the base has, Write for a new one), leaving
   them uncommitted, and stops. The stop makes the claim: a snapshot on the base commit, whose merge base is that commit.
4. Waits until the claim's checks settle (a verdict on it, or its hold replied with every run finished and, when its head
   run passed, a run on the merge base finished), reads the record once more 2 s later, and reads back: every
   `verdict.made` whose subject is the claim (its `outcome` and `reasons`), every `run.started`/`run.finished` of the claim
   (its `commit`, `outcome` and `tests_run`), the stop's reply, and the claim's line from `changes.read`.

### The check file

`.deepbuild/checks/cart-discount.sh`, committed on the base, holds one line:

```
node_modules/.bin/vitest run test/cart.test.ts
```

Why this form: the issue asks the hub to run its checks through check kinds, starting with the command check kind, whose
`runner` is a command line (`packages/checks-command`, #30). A drafted check is a command a check kind runs as it is, through
the repo's own test entry (the design's drafting job: "through the repo's own test entry"). One line with no `#!` line,
because the command kind reads any second line as a command after the tool, a mask (`maskIn`); and it names the test file,
as a drafted check names the test it adds. `test/cart.test.ts` is the check's own test: on the base it comes
from the claim's commit (Fail before, pass after), and it's what the issue's "each check's own files" means here. The same
bytes also run under the base hub's `/bin/sh <file>`, so on the base the tests show exactly the issue's bug rather than a
check that can't start.

The same check file serves all three fixes; only the fix and the requirement's `asserts` differ:

| Fix | Files the session writes | `asserts` | On the merge base |
| --- | --- | --- | --- |
| `HELPER` (AC1) | `src/discount.ts` (new: `discounted`), `src/cart.ts` (uses it), `test/cart.test.ts` importing `../src/discount.ts` | `test/cart.test.ts:7` | the test file can't load (`src/discount.ts` is missing): none of its tests starts |
| `ADDED_FUNCTION` (AC2) | `src/cart.ts` (adds `discountedTotal`), `test/cart.test.ts` calling it in its expect | `test/cart.test.ts:5` | the test starts and throws `TypeError: … is not a function` on the named line while working out the expect's operand: nothing was compared |
| `REAL` (AC3) | #31's `REAL_FIX`: the fixed `src/cart.ts` and `test/cart.test.ts` | `test/cart.test.ts:5` | `expect(total(…)).toBe(90)` fails there, 100 is not 90: the framework's assertion at the named line |

AC2's TypeError is on the very line `asserts` names, so the hub must tell the framework's assertion failure from an error
thrown there (Failing on an assertion: "both hold"), not only compare places. AC1's helper lives in `src/`, the code under
test, never an own file, so it isn't brought over to the base.

## What each test proves

- **AC1** `test/cart.test.ts imports src/discount.ts, which only the fix adds`: the claim has a `verdict.made` with
  outcome `INVALID` whose `reasons` include `failed on the base before its tests ran`.
- **AC2** `test/cart.test.ts's named expect calls discountedTotal, which only the fix adds`: a `verdict.made` `INVALID`
  whose `reasons` include `failed on the base only elsewhere`.
- **AC3** `the real fix … is PASS`: its check passed on the snapshot; on the merge base it ran and failed with `tests_run`
  at least 1 (Check health: "each run records how many tests actually ran"; the criterion's test "fails its assertion on
  the base", so it ran there); no `verdict.made` about the claim is anything but `PASS`; the stop isn't sent back; and the
  claim's line counts its one requirement passed and nothing unverified.
- **AC4**, with the hub started with `DEEP_HUB_PLANT=any-nonzero-base-exit` (a hub whose base runs prove a fix by any
  non-zero exit, as the base hub's do):
  - on AC1's claim, the check passed on the snapshot, failed on the merge base and the claim has no INVALID verdict (the
    plant read the failure as proof), and AC1's judgement then fails (`mustFail`);
  - the same on AC2's claim and AC2's judgement;
  - the real fix stays PASS under the plant (AC3's judgement holds), so the plant changes only what a base exit proves and
    the two failures above are its doing.

  The first two guards keep `mustFail` from passing on a scenario that never reached the base judgement. The base hub is
  itself a hub that counts any non-zero base exit as proof, and AC1 to AC3 fail on it (BASE-FAILURE.txt), which is AC4 on
  the real wrong program; the plant keeps that proof once the hub is fixed.

## Readings and open points

- **What "PASS" is through the hub (AC3).** At the base commit the hub records `verdict.made` only for INVALID and
  INCONCLUSIVE; a claim whose checks pass has no verdict event, and its line, read from the record's runs, says
  `says done 1/1`. The test accepts a PASS verdict (`PASS 1/1`) or that reading, never a verdict other than PASS. The issue
  doesn't ask the hub to start recording PASS verdicts, so this suite doesn't require one.
- **`tests_run` on the base run (AC3).** The base hub records `tests_run: 0` for every run (`finish` in
  `packages/hub/src/core.ts`). Through a check kind the run's count comes from the tool's report, and the record's
  `run.finished` field is where a reader sees it. This is the assertion AC3 fails on at the base.
- **Which runs are the base runs.** A run of the claim whose `commit` is the merge base (here the commit the definition
  locked on); the others ran on the snapshot. The check's ID on a base run isn't read.
- **The reasons' wording.** The tests read the phrases the criteria quote, as substrings of the INVALID verdict's
  `reasons`; what follows them (the place, such as `TypeError at test/cart.test.ts:5`) is the implementer's.
- **Deadline.** The check file names none; the hub picks the run's deadline.
- **Opaque scripts.** The issue's third scope line (what an opaque script's base exit proves, without making #29's plain
  scripts INVALID) has no criterion of its own and is not tested here; the check file above is a command a check kind runs,
  never an opaque script. #29's and `packages/hub/test/gate-stop.test.ts`'s hub tests cover the plain scripts.
- **Temp folders.** Worlds are under `/tmp/dh875-*`, removed after each test. Importing #31's helpers makes their own
  temp home under `/tmp/dh31-home-*`, which their `afterAll` removes.
- **Load.** On a loaded machine the snapshot and its checkout can outlast the stop's 10 s fast-lane budget, and the check
  then goes to the slow lane, which starts after the reply; the wait covers both, up to 10 minutes for the claim to settle
  and 15 for a test. On the base hub, when the snapshot and checkout outlast the 60 s hold as well, the slow checks were
  never queued at all: the claim stayed `says done` with no run (`runs []`, and `held` shows `snapshot_start` near the
  hold). deep-hook also dropped a Stop it couldn't spool within its 50 ms under load (BLOCKED: no claim). At load 40 to
  100 on 12 cores this happened to AC1 and AC2 in some runs; neither is the behavior under test, so rerun such a test
  alone on a quieter machine before calling it a regression. BASE-FAILURE.txt keeps runs where the claims got their runs.

## Proof on a wrong program

No `twins.json` here: a twin is an overlay on the implementation, which this job never saw. The plant
`any-nonzero-base-exit` is the wrong program the criteria name; the implementer adds it to the hub's plants
(`packages/hub/src/plant.ts`) so the hub starts with it. On the base the hub refuses the name (`DEEP_HUB_PLANT=… names no
planted program`), so the AC4 tests are BLOCKED there, never a pass. See `BASE-FAILURE.txt` for each test's failure on the
base.
