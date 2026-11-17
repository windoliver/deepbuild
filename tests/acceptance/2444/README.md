# #2444 acceptance suite

Base commit: `1c4d1f0e2aaad8c6a6573848823566d04ff73d17`. Written blind, before any implementation, from the issue, AGENTS.md,
the design and the base source/tests. Nothing outside this folder was changed.

## Run

    node --test tests/acceptance/2444/

## Criterion to proof

| Criterion | Tag | Proof | Rejects the base by |
|---|---|---|---|
| AC1: the unit lane prints a listed failure as `LISTED` with its issue and doesn't fail on it; an unlisted one still fails it | `#2444.3bfdfb07` | `preflight-known-failures.test.mjs`: the real `runLanes` (scripts/lanes.mjs, the runner the preflight uses) on a lane named `unit` over real `node --test` files, with a scratch `scripts/known-failures.json` whose `failures` key lists one test (message names `#90441`). Cases: listed only; listed plus unlisted; unlisted only; a passing control. | The base reads only `skips`, so the listed-only lane prints `FAIL unit`, exits 1 and prints no `LISTED` line: assertions "the lane fails on a listed test", "…is not printed as LISTED with the issue…", "…does not PASS…", "…exits non-zero…". Tests "a unit lane failing only on a listed test…" and "beside a listed failure…" fail on the base. |
| AC1 wrong-program contrast | same | "wrong runners fail these assertions": six canned wrong outputs (fails on listed, lists the unlisted too, hides the listed, omits the issue, passes an unlisted failure, lists an unnamed test) each must throw `AssertionError`; the right output passes. The control test fails with a `setup:` message if the fixture itself cannot run. | n/a (judge check) |
| AC2: a full reference-Mac `scripts/preflight` on clean main exits 0, every lane PASS, checks within the budget, output recorded with date, machine, load, elapsed | `#2444.1bff92b0` | **Unmeasured.** Only real output of a full run can prove it. The test reads the file named by `DEEP_2444_FULL_RUN`; unset, it skips `INCONCLUSIVE: unmeasured`. | skip, never PASS |

The "evidence reader" test uses a fixture to check the reader only. It does **not** prove AC2.

## Recording the full run (AC2)

On a reference Mac, on a clean checkout of main's head, with other work idle (the issue says a run over the budget leaves it open):

    git status --porcelain | wc -l      # must print 0
    {
      echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
      echo "machine: $(sysctl -n machdep.cpu.brand_string), $(sysctl -n hw.ncpu) cores, $(sysctl -n hw.memsize) bytes"
      echo "load: $(sysctl -n vm.loadavg | tr -d '{}' | awk '{print $1}')"
      echo "commit: $(git rev-parse HEAD)"
      echo "worktree: $([ -z "$(git status --porcelain)" ] && echo clean || echo dirty)"
      scripts/preflight; code=$?
      echo "exit: $code"
    } 2>&1 | tee preflight-2444-run.txt
    DEEP_2444_FULL_RUN=$PWD/preflight-2444-run.txt node --test tests/acceptance/2444/

The reader requires: a date, machine, load, a 40-hex commit, `worktree: clean`, `exit: 0`, `Checks elapsed: N s (budget: <B s)` with
B equal to the `preflight` budget in `benchmarks/budgets.json` and N < B, no `FAIL`/`BLOCKED`/`INVALID`/`INCONCLUSIVE` line, and `PASS`
for typecheck, lint, unit and parity quick. If the budget moves, only by an approved proposal that records the measured run, B follows
`benchmarks/budgets.json`. Keep the output file as the preserved evidence. It is not produced by this job.

## Limits

- The AC1 fixture runs `runLanes` with a lane named `unit`, not the real unit lane's full command list (437 files run alone, 81 slow); that would be a full preflight. It proves the runner's reading of `failures`. If the fix special-cases only the real lane's commands, add that check at review.
- The fixture's output names the listed test via the report id form `file › test`, as the base's `reportResults` makes it. Any reading of "LISTED with its issue" beyond a line starting `LISTED <id>` containing the issue number from the entry's message is not asserted.
- The fixtures sandbox HOME and delete only their own temp folders. Each runs under a 120 s timeout.
