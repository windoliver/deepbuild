# Blind redraft of `#56.31f12028`'s budgets test

Dispute: windoliver/deepbuild#697. The test "both variants have a budget in benchmarks/budgets.json that perf measures against the merge base" in `decision.test.mjs` ran perf's `validateBudgets(current, base)` with `base` set to `benchmarks/budgets.json` at the fixed base `dcfd7b8`. That file already had the repo-wide `preflight` entry, which #56 doesn't own. Once an approved change on main moved `preflight.limits.elapsedMs` from 300 s to 900 s, the test failed with `Budget preflight changed or disappeared; restore its frozen definition`. #56's own tasks were untouched. Only this test changed. No other test, and no helper behavior another test uses, was edited.

## What this job read

- Issue #56 with its comments, and dispute #697.
- `docs/technical-design.md` at `dcfd7b8`, mainly "Every task carries its own budgets".
- `scripts/benchmark.mjs` and `benchmarks/budgets.json` at `dcfd7b8`.
- `scripts/benchmark.mjs` in this worktree, for `validateBudgets`'s signature and messages only.
- `benchmarks/budgets.json` in this worktree, and its `git log -S` history for the two task IDs.
- This suite's own files.

This job didn't read #56's implementation, other issues' tests, other branches or PRs. To install the spike's locked packages for the bench tests, it listed `spikes/hub-core/` by name and ran `npm ci --ignore-scripts` there. It ran the hub once and read only the error saying `effect` was missing.

## The reading chosen, and why

The test now makes two checks, and both use perf's own `validateBudgets`:

1. **Against the merge base.** It runs `validateBudgets(current, budgets at git merge-base HEAD origin/main)`. The criterion says the budgets are "compared with the merge base". The design says each task's budgets are "measured … by a benchmark in the local preflight, and compared with the merge base". The fixed base `dcfd7b8` was a stand-in for the merge base, and it was the wrong one. Any entry another approved change moves on main, such as `preflight` or another issue's task, is on both sides of the merge base, so it no longer fails this test. A change under test that moves an entry still fails, as it fails perf itself.
2. **#56's own tasks against the commit that added them.** For `hub-core-plain` and `hub-core-effect`, the test finds the oldest commit whose `benchmarks/budgets.json` changes that ID's count (`git log --reverse -S'"<id>"'`). It reads the task as it was in that commit and runs `validateBudgets(current, { tasks: [thatTask] })`. Check 1 alone can't catch an edit to one of #56's tasks that has already landed on main, because the merge base would then hold the edited task too. The design says "The change being judged never moves its own budget". `validateBudgets` treats every established task as frozen. Holding only #56's own entries puts that rule on what #56 owns and on nothing else. A task with no commit yet is a first measurement, as on the #56 branch before it's committed. Check 1 judges it, along with the shape assertions below.

The old fixed-base reading was dropped for two reasons. It froze entries #56 doesn't own. It also never froze #56's own tasks, since `dcfd7b8` has neither of them.

Every assertion the old test made on the two tasks is kept unchanged: each task exists, runs `node`, runs `spikes/hub-core/bench.mjs --variant <variant>`, has an `initialReason` naming #56, and has a positive `limits.peakBytes`. A missing merge base or unreadable history is `BLOCKED`, never a pass.

## Assertion → source sentence → wrong program

| Assertion | Source | Wrong program it fails on |
|---|---|---|
| `validateBudgets(current, mergeBase)` throws nothing | Criterion: "Budgets … compared with the merge base". Design: "compared with the merge base" | An uncommitted edit or removal of `hub-core-plain` or `hub-core-effect`. A budgets file perf can't run (bad command, limits, margin or reason) |
| For each #56 task, `validateBudgets(current, { tasks: [taskAtItsAddingCommit] })` throws nothing | Design: "The change being judged never moves its own budget". Perf freezes established tasks | An edit or removal of a #56 task that has landed on main |
| `budgets.json has a task hub-core-<variant>` | Criterion: each variant's numbers are recorded by budgets in the local preflight | No budget for a variant |
| The command is `node spikes/hub-core/bench.mjs --variant <variant>` | Criterion: each variant's hold latency, memory and leaked handles | A budget that times the other variant, or something other than the bench |
| `initialReason` matches `/#56/` | Design: "A budget's value comes from its issue". Perf: "first measurement requires a reason" | A first measurement with no #56 reason |
| `limits.peakBytes` is positive | Criterion: memory is budgeted | A budget with no memory cap |
| `BLOCKED` when there's no merge base or no history | Invariant 2: nothing missing passes | A clone with no `origin/main` passing silently |

## Wrong-program evidence

This was run in a throwaway clone of this worktree at `a50d6c5`, with the clone's `origin/main` set by hand. The script is `wrong-programs.sh` in the job's scratchpad. Nothing was committed here. Each case edits `benchmarks/budgets.json` in the clone. An uncommitted case leaves the edit in the working tree. A "landed on main" case commits the edit and moves `origin/main` to that commit. Each case then runs only this test:

```
control: current budgets.json, new test => pass 1 fail 0
control: current budgets.json, old test (fixed base dcfd7b8) => pass 0 fail 1 | Error: Budget preflight changed or disappeared; restore its frozen definition
uncommitted: hub-core-plain peakBytes raised => pass 0 fail 1 | Error: Budget hub-core-plain changed or disappeared; restore its frozen definition
landed on main: hub-core-plain peakBytes raised => pass 0 fail 1 | Error: Budget hub-core-plain changed or disappeared; restore its frozen definition
uncommitted: hub-core-effect removed => pass 0 fail 1 | Error: Budget hub-core-effect changed or disappeared; restore its frozen definition
landed on main: hub-core-effect removed => pass 0 fail 1 | Error: Budget hub-core-effect changed or disappeared; restore its frozen definition
uncommitted: hub-core-effect reason edited => pass 0 fail 1 | Error: Budget hub-core-effect changed or disappeared; restore its frozen definition
landed on main: hub-core-effect reason edited => pass 0 fail 1 | Error: Budget hub-core-effect changed or disappeared; restore its frozen definition
uncommitted: hub-core-plain margin raised => pass 0 fail 1 | Error: Budget hub-core-plain changed or disappeared; restore its frozen definition
landed on main: hub-core-plain margin raised => pass 0 fail 1 | Error: Budget hub-core-plain changed or disappeared; restore its frozen definition
uncommitted: hub-core-effect runs the plain bench => pass 0 fail 1 | Error: Budget hub-core-effect changed or disappeared; restore its frozen definition
landed on main: hub-core-effect runs the plain bench => pass 0 fail 1 | Error: Budget hub-core-effect changed or disappeared; restore its frozen definition
landed on main: hook-startup margin and preflight limit changed (not #56's) => pass 1 fail 0
uncommitted: hook-startup margin and preflight limit changed (not #56's) => pass 0 fail 1 | Error: Budget preflight changed or disappeared; restore its frozen definition
```

The last two rows show the boundary. An entry #56 doesn't own passes once an approved change has put it on main. The same edit, uncommitted in the change under test, still fails, as perf's own merge-base check refuses it.

Not shown: a #56 task that is only uncommitted while the merge base and history both lack it. A clone at `a50d6c5` always has `b200ef3` in its history. That path is the first-measurement case. Check 1 and the unchanged shape assertions cover it, as before.
