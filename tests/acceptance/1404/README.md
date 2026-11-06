# Acceptance tests for #1404: a budget's instructions include its children

These tests were drafted blind from issue #1404 (its text of November 5), `AGENTS.md` ("Proof"), `docs/technical-design.md` ("Dogfooding", "Wrong programs", "Every task carries its own budgets") and the base commit `80ba48fe`, which has no implementation. I also read that commit's `scripts/benchmark.mjs`, `scripts/perf.mjs`, `benchmarks/budgets.json`, how `benchmarks/*.mjs` start children, and `tests/acceptance/724/` as the model. Sibling #1405 is out of scope. Per AGENTS.md, the implementing agent doesn't edit these. A dispute goes to a blind redraft by this job.

Run them with:

```
node --test 'tests/acceptance/1404/*.test.mjs'
```

Don't pass the folder: Node treats it as one test file. They need macOS, its `/usr/bin/time -l` and `cc`; off macOS each real-counter test fails as `BLOCKED`, never passes. The suite took 39 to 57 s on the base and 49 to 82 s with a sample fix, at load averages of 45 to 80, on battery. On the base 9 of the 12 tests fail, each for the expected reason, as `BASE-FAILURE.txt` shows; the other 3 hold by the issue's own words and fail on the mutants below.

## Surfaces and expected values

The issue names `measureOnce`, `judgeInstructions`, `parseInstructions`, `measure` and perf's verdicts. The tests reach the code only through those. They don't say how children get counted.

| Criterion | Test | Expected |
|---|---|---|
| A child retiring N reads at least 95% of N | `child-count.test.mjs`, four tests | `measureOnce(['node', 'wrap.mjs'], cwd).instructions >= 0.95 * N`, N being the test's own reading of the child under `/usr/bin/time -l`. One test each for `spawnSync`, `spawn` and `execFileSync`, the ways the benches start a child, and one for Node, then Node, then the child. Status stays 0 and the child's stdout still reaches the wrapper. |
| A child with 3 times the merge base's work reads FAIL | `judge.test.mjs`, and `tripled` in `no-count.test.mjs` | `judgeInstructions` on three alternated rounds of `measureOnce` reads `FAIL`, and an unchanged child in the same rounds reads `PASS`. Through perf: a line `FAIL perf: … tripled …`, a non-zero exit, each current count at least 95% of the child's. |
| Proof | `proof.test.mjs` | `measure(['node', 'wrap.mjs'], current, { command, cwd: merged })`, 20 pairs, `judgeInstructions` reads `FAIL`, each current count at least 95% of the tripled child's. On the base it reads `PASS`. |
| A started child with no count reads INCONCLUSIVE, naming the budget, never PASS | `shell-parent` and `left-running` in `no-count.test.mjs` | A line `INCONCLUSIVE perf: … <budget> …` followed by its `  Fix: ` line, no `PASS perf` line and a non-zero exit. `shell-parent` has one alternative, below. A budget that started nothing, in the same run, reads no verdict line and `PASS`. |
| A host with no counter still reads INCONCLUSIVE | `no-counter.test.mjs`, three tests | `parseInstructions` gives `null`, never 0, for a report with no counter, and the count for one with it. `judgeInstructions` reads `INCONCLUSIVE` for no pairs or any `null` side, and `PASS` and `FAIL` on complete pairs. perf on the stand-in below reads as the row above, with all 20 pairs `{ current: null, base: null }`. |

Naming a budget needs perf: `judgeInstructions(pairs)` has no name to give, and only perf prints one. The third and fourth criteria's lane tests therefore read perf's printed lines, the surface #724's README fixed. How a mechanism carries the missing count to perf (a `null` in `instructions`, or something beside it) is left to it.

`parseInstructions`'s comment is a scope item no test can reach: check it by reading the diff.

## Which child has no count

The third criterion needs a command that really starts a child no mechanism reports on, and the mechanism is the implementer's. There are three broad kinds, and they differ in which parents they can reach:

- **A Node preload** (`NODE_OPTIONS`) runs in Node parents only.
- **An injected library** (`DYLD_INSERT_LIBRARIES`) runs in ordinary binaries, but not in a platform binary: dyld strips `DYLD_*` from `/bin/sh` and so from everything it starts. Checked here: `DYLD_FOO=1 /bin/sh -c 'env | grep -c DYLD_FOO'` prints 0, and Node sees the variable.
- **A watcher outside the process tree** can see any parent's children, but only by racing them to their exit.

So a Node parent is a poor plant for a child with no count: every kind reaches it, and a test expecting INCONCLUSIVE there would fail a correct fix. And a platform binary is a poor *child*: `/usr/bin/awk` under Node can't be injected, so a correct injecting fix would fail a test that isn't about it. Hence the planted child is a C program built by `cc` (`fixtures/spin.c`), as the issue's reproduction used and as ordinary as a budget's Rust binary, and two parents:

1. **`shell-parent`: `/bin/sh benchmarks/shell-parent.sh`.** A platform binary that isn't Node: neither of the first two kinds can run in it or in what it starts. The script runs the child and then reads `$?`, because a shell whose last command is the child can exec into it, and then `/usr/bin/time` would count it directly. Its child has 3 times the merge base's work. A watcher could still count this child, so the test takes a `FAIL` if every current count holds at least 95% of the child, and otherwise requires INCONCLUSIVE. `PASS` is wrong under any mechanism, and it is what the base reads.
2. **`left-running`: a Node wrapper that starts the child detached and leaves.** The child sleeps 30 s past the end of its round. Here the strict INCONCLUSIVE is fair to every kind: Node is the parent, so all of them see the child start, and the child hasn't finished when the budget ends, so no count for it exists. The issue's scope says the reading covers the children the command waited for, so this one is outside it, and started with no count. A mechanism that waits it out runs 42 rounds of 30 s and hits the lane's 600 s timeout, as it should: a daemon must not hang a budget. Each child exits by itself after 30 s, so nothing kills anything.

## How the tests plant

Only boundaries the code doesn't own are planted: the children, the budgets, the merge base, and `/usr/bin/time` on the no-counter host.

- **The child** is `fixtures/spin.c`, built by `cc -O0` per test file. It spins a volatile counter a fixed number of iterations, about 10 instructions each, and prints `spun <n>`. This is #724's gotcha applied: a Node loop's instructions retired move under load, so a steady native program does the work and Node only starts it. Every N is the test's own reading, the median of three runs under the real `/usr/bin/time -l`.
- **The budget command** is run as a budget runs it: `node wrap.mjs` by name from `PATH`, in its own directory, with no new API, flag or environment set by the test. The wrapper is byte-identical on both sides and reads the child's work from `child.json` beside it, so what differs is the child's work alone, as with a frozen budget and its merge-base copy. A bench doesn't opt in.
- **The perf lane** (`perfLane` in `helpers.mjs`) is #724's: a scratch git repository with a copy of `scripts/`, a trivial check workload, and budgets that are the same at `origin/main` and in the working tree, run once as `node scripts/perf.mjs '<observation>'`. The merge base runs from perf's own copy of that commit. It differs from #724's in two ways. It copies `scripts/` whole, so a helper in a subfolder comes along; a helper outside `scripts/` wouldn't. It leaves out `scripts/throttle.mjs`, as perf allows, because the machine's one timed grant could otherwise hold a fixture run for an hour. Budget margins are 1000, so time and memory never produce a verdict here.
- **The no-counter host** is the stand-in #724 made: a shell script that runs the real `/usr/bin/time` and drops the `instructions retired` and `cycles elapsed` lines from its report. Every `/usr/bin/time` under the copy's `scripts/` is pointed at it, so a helper's own use of it is covered too. If nothing there runs `/usr/bin/time`, the test fails saying it can't plant. #724's frozen `missing.test.mjs` needs that literal in `scripts/benchmark.mjs` anyway.

No option, flag or environment variable is added for tests.

## Tests that hold on the base

The three tests in `no-counter.test.mjs` pass on the base because the fourth criterion says "as it does today". Each fails on a mutant of `scripts/benchmark.mjs`, run in a throwaway copy on the base:

| Mutant | Fails |
|---|---|
| `parseInstructions` returns 0 for a missing count, not `null` | the report test; the perf test (`{"current":0,"base":0}`) |
| `judgeInstructions`' `missing` is always 0 | the judge test; the perf test (reads `PASS`) |
| `measureOnce` reports `parseInstructions(…) ?? 1` | the perf test (reads `PASS`) |

The checks that pass on the base by nature sit inside tests that fail on it, so they need no mutant: the unchanged child's `PASS` in `judge.test.mjs`, and the childless budget's `PASS` in the `left-running` test.

## The suite can pass

A throwaway sample fix, kept out of the repo, passed all 12 tests: a Node preload that ran each child under `/usr/bin/time -l` and summed the reports, a missing report reading as a missing count, and CPU time that the counted cycles couldn't explain reading the same way, which is how it saw the shell's child. Two wrong fixes made from it failed where they should: with no missing-count detection `shell-parent` and `left-running` read `PASS`, and with only `spawnSync` covered the `spawn` test read 313 M of 1,013 M. No watcher or injected library was built, so `shell-parent`'s `FAIL` branch has not run.

Two traps the sample hit, both in a detached child's report: `/usr/bin/time -o` creates its file when it starts, so an orphan's report exists, empty; and it can land while the run's temp directory is being removed. A fix that throws on either reads `BLOCKED`, not INCONCLUSIVE.

## Readings where the issue leaves a choice

1. **"The children it waited for" is transitive.** That is the old comment's meaning, and `wait4`'s: a Node child's own waited-for child counts. Benches such as `benchmarks/hub.mjs` start Node as their child, so a binary under it sits a level down.
2. **"Reports no count" covers both a parent the mechanism can't reach and a child still running at the end.** The issue says only "started a child and reports no count for it".
3. **"The budget" is named by perf**, since `judgeInstructions` takes no name. The reason text isn't pinned. Today's says the host has no counter and perf's Fix line says to run on macOS, both wrong for this case; the tests don't require a new wording.
4. **95% has no upper bound.** The issue sets none, so an overcount passes the first criterion; the unchanged child's `PASS` is what catches a count that differs between sides.
5. **Not planted:** a long-lived child the wrapper stops with a signal, as `benchmarks/hub.mjs` starts one. Either a count holding it or INCONCLUSIVE would meet the criteria, and telling them apart needs another Node budget through perf. The implementer should check that real budgets of this shape don't all turn INCONCLUSIVE.
