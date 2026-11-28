# Acceptance tests for #3510: a test-binary build keeps its place in the build line while it moves

I drafted these tests blind from these sources:

- issue #3510, as `gh issue view 3510` printed it on 2026-11-25
- `docs/parallel-proof.md`, section 6 (Scheduling: the grant-wait table, a wait bounded by a stall, Drain and a stuck
  drain, Inherited grants, tables of a test's own) and "Binaries for tests" in section 5
- the Dogfooding part of `docs/technical-design.md`, and its Repo guards (the wait ratchet, home paths)
- AGENTS.md
- the base commit `b48a47db7`, where `buildBinaries` asks `acquire('build', { wait: 30 })` and throws
  `INCONCLUSIVE no grant: no build grant came within 30 min for test binaries`

At the base I also read `scripts/proof-binaries.mjs`, `scripts/throttle.mjs` (`acquire`, its log entries, the table's
folder), `scripts/lease`, `scripts/proof-change.mjs` (tags), `scripts/proof-runs.mjs` (twins), `scripts/wait-ratchet.mjs`,
and `tests/acceptance/3334/`, `2820/` and `1115/` for their conventions. `helpers.mjs` imports their helpers and edits
none. Per AGENTS.md, the implementing agent doesn't edit these tests; a dispute goes to a blind redraft by this job.

Run them with Node 24 and cargo, as a test run (the throttle reads `DEEP_THROTTLE_TABLE` only under `node --test`):

```sh
npm ci                                   # once, if node_modules is missing (proof-binaries.mjs imports typescript)
node --test 'tests/acceptance/3510/*.test.mjs'
```

There are 5 tests in five files, which `node --test` runs side by side. Against a throwaway implementation on the
20-core Linux machine they were drafted on, at a 1-minute load of 130 to 150, the suite took 24 s. On the merge base
`stalled-line.test.mjs` waits out its 5-minute bound (the base waits 30 minutes), so the suite there takes about 5
minutes. Every wait in a test is bounded (at most 18 minutes in one test, `drain.test.mjs`, when every bound in it runs out, under the 20-minute limit each test carries). No test
needs an idle machine and none holds a port, so there is no `lane.json`: every test has its own HOME and its own
throttle table, and never reads or writes the machine's `~/.deepbuild/throttle`.

## Criteria to tests

Each test's name starts with its criterion's tag.

| Criterion | Test (file) | What it requires | Wrong program |
|---|---|---|---|
| `#3510.7fd1b181` Setting unset, table empty: the call returns its `bin` holding the binary; its top-level `granted` entry carries `stall: 720` and no `wait` | `default-stall.test.mjs` | On an empty table, with `DEEP_TEST_GRANT_STALL` unset, the call returns `bin`, and `bin` holds a binary that prints the fixture's own token. The log holds one `granted` entry of class `build` for the calling process: `grant: "top-level"`, `stall: 720`, no `wait` key | The base (`wait: 30`, no `stall`) |
| `#3510.a06361ca` Setting 0.05: a call behind a line whose grants change hands every 2 s for 20 s gets its grant and returns its `bin` holding the binary; a planted fixed 0.05-min wait fails | `moving-line.test.mjs` | #3334's moving line runs on the test's table for 20 s, six holders a slot waiting ahead at every moment. Once a grant has changed hands the call starts; it is seen in line, throws nothing, returns `bin` holding the binary, and at least 3 holders' grants a slot (6 s of hand-overs, twice the bound) are logged between its joining the line and its own grant | Twin `fixed-wait`. The base passes this test: its 30-minute wait outlasts the line |
| `#3510.9618ba88` Setting 0.05, every build slot held past the bound: within 5 minutes the call throws a message starting `INCONCLUSIVE no grant: no build grant changed hands within 0.05 min for test binaries`; cargo never started, `bin` holds no binary; the `timeout` entry carries `stall: 0.05` | `stalled-line.test.mjs` | Every build slot of the test's table is held for ten minutes and nothing else changes. The calling process ends within 5 minutes having thrown that message and returned nothing. Its `run` argument was never called, the fixture repository holds no `target/`, and `bin` holds nothing. The log holds one `timeout` entry of class `build` for the calling process, with `stall: 0.05` and no `wait`, and no `granted` entry for it | The base (it waits 30 minutes, so the call is still waiting at the 5-minute bound) |
| `#3510.87170af2` Every build slot held by others, the call made by the command of `node scripts/throttle.mjs build -- <command>` that holds one of them: returns its `bin` holding the binary without waiting; `passed` for its request, no second `granted` for its process | `under-grant.test.mjs` | Other holders keep every build slot but one for ten minutes (none on the Mac's one slot). `node scripts/throttle.mjs build -- <the caller>` takes the last, so every slot is held, and its command makes the call. The wrapper exits 0, the call returns `bin` holding the binary. The log holds as many `granted` build entries as the machine has build slots and no more, one of them the wrapper's; a `passed` entry of class `build` for the calling process whose `through` names the wrapper's grant; no `granted` or `timeout` entry for the calling process; and no `released` entry for another holder, so no slot came free meanwhile | None: regression protection. The base passes this test, as the issue says |
| `#3510.773f906e` Setting 0.2, every build slot held for 8 s, a top-level `timed --wait 0.05` request made after the call joined the line: the timed request ends `INCONCLUSIVE no grant`, and the call then gets its grant and returns its `bin` holding the binary; a planted fixed 0.05-min wait fails | `drain.test.mjs` | Holders keep every build slot until the call is seen in line and for 8 s after. Then `node scripts/throttle.mjs timed --wait 0.05 -- <command>` starts: it exits 3 with a line starting `INCONCLUSIVE no grant`, its command unrun. The call throws nothing and returns `bin` holding the binary. In the log, the timed request's `timeout` entry and a holder's `released` entry both come before the call's one `granted` entry | Twin `fixed-wait`. The base passes this test: its 30-minute wait outlasts the holders |
| `#3510.a05824a6` `tests/cargo-no-grant-lane.test.mjs`, `tests/acceptance/3333/` and `tests/acceptance/2820/` pass unchanged | none | Existing suites, run unchanged by the implementing job | — |
| `#3510.e477ece5` Section 6's grant-wait table has a row for this caller | none | By diff review, as the criterion says | — |

`twins.json` names the twin for the two criteria the issue gives one, and `twins/README.md` says what it plants.
`twins/fixed-wait/scripts/proof-binaries.mjs` is the base's file with that one rule changed.

## The surfaces (my choice where the design leaves it open)

- **The call**: `buildBinaries(cwd, bin, names, run)` imported from this checkout's `scripts/proof-binaries.mjs` by a
  process of its own, the caller (`helpers.mjs`, `CALLER`), whose working folder and `cwd` are the fixture repository.
  The tests import nothing of the code under test, so a call that waits is a child that hasn't exited, never a test
  that hangs. The caller prints `CALLING <pid>` before the call and `RETURNED <bin>` or `THREW <message>` after.
  `names` is the fixture's one binary; `options` is left at its default.
- **`run`**, the surface's fourth argument, is node's `spawnSync` behind a wrapper that first notes that the build was
  started. "cargo never started" is read three ways: that note is absent, the fixture repository holds no `target/`
  (where `buildBinaries` puts cargo's build directory), and `bin` holds nothing.
- **The fixture repository**: a git repository in the sandbox with a Cargo workspace of one bin crate, no dependencies,
  and its `Cargo.lock` (#2820's `workspace()`), committed. The binary prints a token only that fixture's source holds,
  so "`bin` holds the binary" is: `bin/fixture-3510` runs and prints the token.
- **Under no throttle grant**: the caller's environment has no `DEEP_THROTTLE`, and its table is the test's own, which
  holds no grant of its chain. In `under-grant.test.mjs` it is the command of `throttle.mjs build --`, as the issue says.
- **The table**: `DEEP_THROTTLE_TABLE` names a folder of the sandbox's, under a HOME of the sandbox's. Read: its `log`
  (`granted`, `passed`, `timeout` and `released` entries, by `class`, `pid` and `id`), and its `table.json`'s
  `requests`, by `pid`, to see that the call has joined the line (the log has no entry for a request joining).
- **A request's process**: the log's `pid` is the pid of the process that asked, so the call's entries are those with
  the caller's pid and a holder's or the wrapper's those with the pid of the `throttle.mjs` process the test started.
- **Other holders**: `node scripts/throttle.mjs build --wait 10 -- <command>`, as another session's build would be.
- **cargo** is real, with a `CARGO_HOME` of the sandbox's (#2820's sandbox), so no user cargo config applies.

### Waits

Every wait is for an event: a line of a child's output, a child's exit, or a change of the table's folder (`fs.watch`).
The only timer is #3334's `within`, which bounds a wait and is marked `// deadline:`. The holders' `sleep`s are the
fixture's own hold times, in shell commands the tests start.

## Assumptions, where the issue is silent

1. **"Every build slot held"** is both slots on the Spark and the one on the Mac (`SLOTS`, from the platform, as
   #3334's tests have it).
2. **"Held for 8 s"** (`#3510.773f906e`): the 8 s are counted from the moment the call is seen in line, not from the
   holders' own grants. Counted from their grants, a caller slow to start on a loaded machine would join with under
   3 s left, and the planted fixed wait would pass. The holders so hold for the call's start-up plus 8 s; behind the
   call they hold 8 s, well inside the 0.2-minute (12 s) bound.
3. **"The call then gets its build grant"** is read from the log's order: the timed request's `timeout`, then the
   call's `granted`. The test also requires a holder's `released` before the call's `granted`.
4. **"No second `granted` for its process"** (`#3510.87170af2`): the wrapper's own grant is the first; the calling
   process has no `granted` entry, and the log holds no build `granted` entry beyond the holders' and the wrapper's.
   "Without waiting" is not timed (an assertion on a clock difference judges the machine); it is read as: `passed`,
   and no other holder's slot released before the call returned.
5. **`stall: 0.05` and `stall: 720`** are the numbers, as the throttle logs a `--stall` request's bound.
6. **A fractional `DEEP_TEST_GRANT_STALL`** is read as minutes, 0.05 being 3 s, as the criteria use it.

## What stays unproven here

- **`#3510.a05824a6` and `#3510.e477ece5`**: no new test; existing suites and diff review.
- **`#3510.87170af2` has no wrong program**: the issue names none and the base passes it. The before lane will ask
  for one unless a mutant fails it.
- **`DEEP_TEST_GRANT_STALL` set to something that is no number**, and **a lane's second build after a cleanup
  (#3296)** and **a proof's and a mutation run's builds**: in the issue's Why or Scope, in no criterion. Only a direct
  `buildBinaries` call is driven.
- **The two tests the base passes** (`#3510.a06361ca`, `#3510.773f906e`) fail only on the twin.
- **Timing on a very loaded machine**: the moving line's hand-overs must stay under 3 s apart (#3334's README), and
  in `drain.test.mjs` the holders' release must reach the call within 12 s of its joining the line (8 s of holding,
  the rest hand-over). At a load of 130 to 150 on 20 cores both held with seconds to spare.

## How I checked the tests can pass

No implementation was written into the repository. In a copy of the checkout in this job's scratch folder I changed
`buildBinaries` to ask `acquire('build', { stall })` with `DEEP_TEST_GRANT_STALL` or 720 and to throw the stall's
words, ran this suite against it (5 of 5 passed), and ran it against a second copy holding the `fixed-wait` twin (it
failed the two tests that name it, at their assertions). The throwaway isn't kept and proves nothing about the real
change. `BASE-FAILURE.txt` is the suite's run on the merge base, then a summary of those two runs.

## Comments removed

Main's comment ratchet holds these files to no comment lines, so their comments were removed with no code token
changed; `// deadline:` markers stay. What they said is above: the surfaces (the caller's `CALLING`/`RETURNED`/`THREW`
lines, `run`'s started note, the fixture's token, the table read by `fs.watch`), assumption 2 (the drain holders' 8 s
count from the call being seen in line), and `LONG`, the 20-minute bound each test carries so a hang reads as a failed
assertion. A planted twin replaces `scripts/proof-binaries.mjs` (`PROOF_BINARIES`) in its own checkout.

## Files

- `helpers.mjs`: the sandbox, the fixture repository, the caller, the look for a request in line, the holders.
- `default-stall.test.mjs`, `moving-line.test.mjs`, `stalled-line.test.mjs`, `under-grant.test.mjs`, `drain.test.mjs`:
  one criterion each.
- `twins.json`, `twins/README.md`, `twins/fixed-wait/scripts/proof-binaries.mjs`: the planted wrong program.
- `BASE-FAILURE.txt`: the run on the base, home paths written as `~`.

No fixture holds a secret or personal data.
