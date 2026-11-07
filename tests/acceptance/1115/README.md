# Acceptance tests for #1115: a skip is never PASS, a test's own state stands, every lane writes evidence (T9b)

I drafted these tests blind from these sources:

- issue #1115, as saved verbatim for this job
- `docs/parallel-proof.md`, sections 3, 6, 8, 10, 10a, 11, 12 and 12a
- the Dogfooding part of `docs/technical-design.md`
- AGENTS.md
- the base commit `58862789`, which has no implementation

At the base I also read `scripts/lanes.mjs`, `affected.mjs`, `proof-guard.mjs`, `proof-change.mjs`, `proof-reporter.mjs`,
`proof-vitest-reporter.mjs`, `throttle.mjs` and `known-failures.json`, the real skip sites the issue names, and
`tests/acceptance/1114/`, `1113/` and `569/helpers.mjs` for their conventions. The helpers are written here, never
imported from another suite. Per AGENTS.md, the implementing agent doesn't edit these tests. A dispute goes to a
blind redraft by this job.

Run them with:

```sh
npm ci                                   # once, if node_modules is missing
node --test 'tests/acceptance/1115/*.test.mjs'
```

They're `*.test.mjs` under `tests/acceptance/`, so the unit lane doesn't pick them up. All are offline and run on real
processes: the real `runLanes` on the real `unit` lane, real `affected.mjs`, real `throttle.mjs`, real vitest, real
`node --test`, real `proof.mjs guard` and real `ssh-keygen` signatures. Stubbed, all at boundaries #1115 doesn't own:

- `cargo`, first on `PATH`. `metadata` reports no crates, and `test` prints what the test gives it.
- the lint lane's own scripts, in the scratch trees.
- `sysctl -n hw.model`, in the one test that needs a machine that isn't a reference Mac (below).
- 880's `helpers.ts`, in that same test. Its two real test files skip before they reach a helper.
- the length of the test class's grant wait (No grant, below).

**Every test points `HOME` at a temporary folder**, so `~/.deepbuild` is the sandbox's, never the real one. The sandbox
also unsets `DEEP_THROTTLE`, `DEEP_PERF_LOCK`, `NODE_TEST_CONTEXT`, `DEEP_PREFLIGHT`, `DEEP_OPEN_ISSUES`,
`CARGO_TARGET_DIR`, `DEEP_PROOF_ISSUES` and `DEEP_APPROVERS`, as 1114 does, and `DEEP_880_TOUCH_ID`, `DEEP_PI_CLI`,
`DEEPBUILD_M1_RECORD` and `DEEP_PROOF_VITEST_REPORT`. Each process a test starts gets its own process group, and the
test stops that group by its PID when it ends. Nothing is killed by name or port.

No test needs an idle machine, so none skips under load. See Timed runs, below.

There are 41 tests and 8 subtests. On the base, 35 tests fail at their assertions and 6 pass, as `BASE-FAILURE.txt`
shows; each of the 6 is named below with the wrong program that fails it. The suite takes about a minute at a load of 60
to 100 on the 12-core reference Mac this was drafted on.

## Criteria to tests

Each criterion's ID is `#1115.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space
collapsed>`, as `scripts/proof-change.mjs` (`criterionId`) works it out; I took them by running `readIssue` on the
issue's text. Each test carries its tag at the start of its name. The "Depends" tests are in `decisions.test.mjs`.

| Criterion | Tests (file) | What they require |
|---|---|---|
| AC1 `#1115.dbbdd753` A `lanes.mjs` unit run with an unlisted skip reports the lane INCONCLUSIVE and lists the skip; one whose note starts with BLOCKED reports BLOCKED | 5 in `skips.test.mjs`, 1 depends on answer 1(a) | One run each: vitest (`ctx.skip`, `it.skip`, `describe.skipIf`), node (`t.skip`, `{ skip: note }`, `{ skip: true }`, nested), a node suite skipped whole, BLOCKED under vitest beside an INCONCLUSIVE skip, BLOCKED under node. The lane's state, a non-zero exit, and a line naming each id with its note |
| AC2 `#1115.3a2181d7` A test failing with `INCONCLUSIVE: …` reads INCONCLUSIVE in `lanes.mjs`, not FAIL | 4 in `failing-states.test.mjs` | vitest by `expect.fail`, a message on `expect` as `requireGpu()` has, and a thrown Error; node by `assert.fail`; BLOCKED takes its state too; a real failure in a later command leaves the lane FAIL |
| AC3 `#1115.67b0561c` A listed id skipping under a different note …; with `DEEP_880_TOUCH_ID` set on a machine that is not the reference Mac, 880's listed opt-in entry does not cover its `notReference()` skip and the lane is INCONCLUSIVE | 6 in `notes.test.mjs`, 1 in `affected.test.mjs`, 4 depend on answer 2(a) | Another note reads INCONCLUSIVE and is listed; another id doesn't cover; the listed id and prefix leave PASS and are printed; a listed skip beside an unlisted one; a noteless entry covers only a noteless skip; 880's real entries on its real test files, covering the opt-in skip with the variable unset, and not `notReference()`'s with it set; the same note rule in `affected.mjs` |
| AC4 `#1115.0eeb3f9a` With `--timed`, a run in which any budget skips INCONCLUSIVE summarises INCONCLUSIVE, never PASS | 3 in `affected.test.mjs` | A timed vitest file and a timed node file, each with one budget that measured and one that skipped: summary `INCONCLUSIVE affected: `, exit 2, the skip listed. With no flag, an untimed file's skip does the same (Scope, Skips) |
| AC5 `#1115.82b1c824` A change to the `skips` key without a signed approval tag fails the guard; an `affected.mjs --record` rewrite of the other keys passes it | 8 in `guard.test.mjs`, 8 subtests | No tag, on six kinds of edit; a really unsigned tag; a stranger's signature; a maintainer's signature passes by that proposal; a signed tag on a commit carrying another file; an uncommitted edit; a conflict resolved by editing `skips`, beside one that keeps it; a real `--record` rewrite |
| AC6 `#1115.1f2f1fa0` A vitest job ended with no grant reads INCONCLUSIVE, not FAIL | 3 in `no-grant.test.mjs` | In `affected.mjs`, each of the job's files reads INCONCLUSIVE, with no FAIL and no "reported no test", and a later run with a grant reads PASS; the same when a line of output came first; a unit lane with no grant reads INCONCLUSIVE |
| AC7 `#1115.b81207df` Each lane's evidence record names host, platform, tree hash and every test's state | 3 in `evidence.test.mjs` | The unit lane's record holds each state from vitest, node and cargo, with its lane's state; a passing lane's holds PASS; a lane that passes, one that fails and one with no commands each write one |
| AC8 `#1115.07ca71fc` Failures on main equal today's | 3 in `failures.test.mjs` | Below |

## The surface (my choice where the issue leaves it open)

- **The lanes** are reached by a small driver that imports the tree's `scripts/lanes.mjs` in a child process and calls
  `runLanes(checks.filter(unit), { cwd })`. So the commands are the real `unit` lane's, however the change adds its
  reporters. A lane's state is the last line starting `<STATE> <lane name>`, as at the base. An INCONCLUSIVE or BLOCKED
  lane exits non-zero, as any lane not PASS does at the base.
- **A test's id** is `<repo path> › <suite> › <test>`, as `known-failures.json` and `affected.mjs` write it. A node
  suite skipped whole is listed by the suite's id, since node never reports the tests inside it.
- **"Lists the skip"** means a printed line holds the id, and the note when there is one. The runners' own output
  doesn't hold ` › ` ids, so it can't satisfy this. Nothing fixes the rest of the line. A listed skip is printed the same
  way, in `lanes.mjs` and in `affected.mjs`.
- **A `skips` entry** is an object in the array under the `skips` key of `scripts/known-failures.json`:
  `{ "id": "<test id>", "note": "<exact note prefix>", "reason": "…", "approval": "…" }`. A test skipped with no note
  (`it.skip`, `describe.skipIf`, as the issue's 327 and pi entries are) gives the note `""`, and an entry with `"note": ""`
  covers only that. An empty prefix never covers a skip that has a note.
- **The evidence record** is a JSON file, under any name ending `.json`, anywhere below `~/.deepbuild/lanes/`, beside the
  throttle's `~/.deepbuild/throttle/`. (`~/.deepbuild/evidence/` is the product's evidence store, so not there.) One object: `{ lane, state, host, platform, tree, tests: [{ id, state }] }`.
  `host` is `os.hostname()`, `platform` starts with `process.platform`, and `tree` on a clean checkout is
  `git rev-parse HEAD^{tree}`. `state` is the lane's, since section 11 makes the record the verdict. Test states are
  `PASS`, `FAIL`, `BLOCKED` and `INCONCLUSIVE`. A listed skip's state may be any word but `PASS`. A lane with no per-test
  results writes `tests: []`. Each cargo test's id contains its name. The tests read no other field.
- **The marker** isn't read. The test holds only to what it means: the job's files read INCONCLUSIVE, whatever the
  throttle leaves. "Those files read" means a line starting `INCONCLUSIVE` names each file of the job.
- **The guard's approval item** is the path: `Approves: scripts/known-failures.json`, as a proposal names any file
  (`Approves: <path>`). A refusal is a line starting `FAIL guard:` naming that path, and an approved edit a line starting
  `PASS guard:` naming it and "by approved proposal", as the guard's `judge` prints them.

### The scratch trees

`lanes.mjs` and `affected.mjs` run in a scratch git repository holding a copy of `scripts/` (this checkout's, or the
merge base's), with the lint lane's scripts stubbed, a fixture `known-failures.json`, a folder of links to
`node_modules` so vitest's cache lands in the scratch folder, and one passing test for each runner command of the unit
lane. The vitest config is a fixture with the repo's include written out, since the repo's own imports `lanes.mjs`,
which needs the workspace packages built. Fixture files that must be timed sit at a real path of the `timed` list, read
by a child process. Node fixtures for the unit lane sit at `tests/*.test.mjs`, the only place its node command reads
under `tests/`.

### Timed runs

A `--timed` run runs under `throttle.mjs build -- node scripts/affected.mjs …` in the sandbox's table. Its timed request
is then nested, which section 6 lets start at any load, so these tests read the same at a load of 100 as on an idle Mac.

### No grant

Waiting out 30 minutes isn't practical, so the tree's `scripts/throttle.mjs` is a shim around the real file. It passes
the real script the same arguments, with a `test`-class `--wait` of 0.02 minutes. Holders from another chain fill the test
class in the sandbox's real table: 2 grants on the Mac, 4 on the Spark, by section 6. The real throttle then ends the job
with no grant and exits 3. One test has the shim print a warning line first, because a job's stdout and stderr share one
log. The base's reading matches only the output's first line, so there it reads the job as FAIL "reported no test".

### The real 880 entries

AC3 names them, so this one test reads the real `skips` key. It needs exactly one entry for each of
`tests/acceptance/880/touch-id.test.ts` and `redraft/touch-id.test.ts`, whose ids are those files' real test names. Both
real files are copied byte for byte into the tree, with a stand-in `helpers.ts` that throws if reached. The Mac this was
drafted on is a reference Mac (`Mac15,7`), so a `sysctl` stub answers `hw.model` with `Mac00,0`. Their real
`notReference()` then runs. Off macOS it returns `platform <name>` and the stub isn't reached.

### The guard

`node scripts/proof.mjs guard` from this checkout runs in a scratch repository whose main holds a `proof-guard.mjs`, so
the lanes count as on main, as 1113's guard test does. The issue is planted through `DEEP_PROOF_ISSUES`. Keys are
throwaway ed25519 keys made per test with `ssh-keygen`; `DEEP_APPROVERS` names an allowed-signers file listing only the
maintainer's. `--record` runs for real in a scratch tree, and its output bytes are committed in the guard's scene. The
one-line `skips` of the bytes before it makes the rewrite touch that key's lines without changing its value.

## The owner's two answers

Section 10a's questions were unanswered when I drafted this, so (a) and (a) are the recommended, unconfirmed readings.
Everything outside `decisions.test.mjs` holds under either answer: an unlisted skip, a BLOCKED note, the note rule on opt-in
and retired entries, and 880's entries.

| Test in `decisions.test.mjs` | Depends on | If the answer is (b) |
|---|---|---|
| A listed BLOCKED-by-design test leaves the lane as its other tests give it, and is printed | Answer 1(a) | Drop it; the lane stays BLOCKED, as AC1's tests hold |
| A reading-only skip is listable by id and full note | Answer 2(a) | Drop it; the skip makes its lane INCONCLUSIVE |
| A reading-only entry holding only a prefix doesn't cover: the key is the full note | Answer 2(a) | Drop it |
| A reading-only entry is refused for a file in the timed list | Answer 2(a) | Drop it |
| A reading-only entry is refused for a test carrying a criterion tag | Answer 2(a) | Drop it |

A note counts as reading-only when it starts `INCONCLUSIVE (reading only)`, as the issue writes it. The refusals hold only
for those. 880's opt-in entries sit on timed, tagged tests and stay listable, as AC3 needs.

## Failures on main, before and after

"Before" is the merge base's `scripts/`, from `git archive`. "After" is this checkout's. One fixture set runs under each.
On the base they are one program, so all three tests pass there. That is a limit of the base, not a proof. Each has a
wrong program that fails it:

| Test | What it compares | Wrong program, run in `BASE-FAILURE.txt` |
|---|---|---|
| `affected.mjs` | The sorted FAIL, NEW FAIL and KNOWN ids of `--timed` runs: two vitest failures, one a test comparing the word INCONCLUSIVE, a known node failure and a timed failure, beside skips | `unanchored-state`: the state is matched anywhere in the message, so the comparing test drops out |
| The unit lane | The lane's state and exit, and each failing test named in the output | `quiet-reporter`: the new reporter replaces the runner's output, so the lane stops naming what failed |
| `known-failures.json` | `failures`, `lint` and `timing` equal the merge base's | `moved-a-failure`: an entry leaves `failures` |

## The other tests that pass on the base

| Test | Why it passes on the base | Wrong program, run in `BASE-FAILURE.txt` |
|---|---|---|
| AC2: a real failure beside a test failing with `INCONCLUSIVE: …` leaves the lane FAIL | Every failure reads FAIL there | `first-state-wins`: an INCONCLUSIVE test stands for the lane |
| AC5: a `--record` rewrite passes the guard | The guard doesn't read this file there | `whole-file-rule` and `line-rule` |
| AC6: a unit lane with no grant reads INCONCLUSIVE | `runLanes` finds the throttle's line in the output | `empty-report-fails`: a vitest command with no report reads FAIL |

The subtest "the resolution keeps skips" passes on the base too, as the control of the merge test beside it.

## What the tests can't see

- **Real main (AC8).** The fixture's planted failures aren't main's. The implementer runs the unit lane and
  `node scripts/affected.mjs` on main before and after, by hand, on one machine and paths, and compares the sorted FAIL
  ids. The issue's before-landing list of passes the new rule turns INCONCLUSIVE, and sending it to the owner, is also by hand.
- **The real `skips` list.** Apart from 880's entries, no test reads it. That 327's, the pi package's and any other entry
  are right, and that `684/lean.test.ts` stays unlisted, is for the PR's scan and the approver. That a gate is an opt-in
  or a retirement is the approver's call, as the issue says, and no parser checks it.
- **Platform and GPU skips.** A test can't tell an approved entry for one apart from any other, since no parser judges
  entries. An unlisted one reads INCONCLUSIVE like any skip. The `(platform)` label itself isn't asserted, since no
  criterion names it.
- **Real main's budgets.** The timed fixture stands for a budget by its note. A real budget's helper isn't run.
- **A 30-minute wait.** The grant wait is shrunk (No grant, above), so a job that really waits isn't seen.
- **The Spark.** I ran these on a Mac. The Linux branches (four test grants, `platform linux` in 880's note, no `sysctl`)
  are written but unrun.
- **`cargo test`'s ignored tests.** The stub prints passes and failures only. No criterion names `ignored`.
- **Records on dirty trees and remote lanes.** `tree` is checked only on a clean checkout. The bundle hash, composite
  recipes and the Spark's comparison belong to T7 and T8.
- **Where a stale record goes.** Each test has one sandbox HOME. Keeping or naming records across runs isn't tested.
- **A real tag on `skips`.** The guard runs with a throwaway approver, so the real change's own tag is the implementer's.

## How I checked the tests can pass

No implementation was written into the repo. To tell a test bug from a real failure, I wrote a throwaway implementation in
this job's scratch folder, ran this suite against it (49 of 49 passed), and planted faults in it. `BASE-FAILURE.txt` lists each
fault and the tests it failed. It isn't kept, so it isn't the program under test and proves nothing about the real change.

## Files

- `helpers.mjs`: the sandbox, launching, the scratch trees, the lanes driver, reading records, keys and the guard's scene.
- `skips.test.mjs`: AC1.
- `failing-states.test.mjs`: AC2.
- `notes.test.mjs`: AC3, and 880's real entries.
- `affected.test.mjs`: AC4, and AC3's note rule in `affected.mjs`.
- `guard.test.mjs`: AC5.
- `no-grant.test.mjs`: AC6.
- `evidence.test.mjs`: AC7.
- `failures.test.mjs`: AC8.
- `decisions.test.mjs`: the tests that depend on the owner's answers.
- `BASE-FAILURE.txt`: the run on the base and the planted wrong programs, with paths redacted.

No fixture holds a secret or personal data. Issue 9115 is made up.
