# #1621 evidence: one listed failure was a real one, the other's test passes

These runs were on the owner's Mac (Node 24.22.2, cargo 1.99.1) on 2026-11-23, at main `c52dc3e73`. Each run is a file run alone under `node scripts/throttle.mjs test`. Its first line gives the load (`sysctl vm.loadavg`, 1, 5 and 15 minutes) and its last line gives the exit code. `<worktree>` stands for this worktree.

Neither entry is in `scripts/known-failures.json` on main any more, so this change touches no guarded file:

- 9da45676a (#2333, Nov 15) took out the memory-overrule entry when it lapsed. Its test has read as a new failure since then.
- d47431a6d (Nov 14) retired #350's first-draft AC4 file `tests/acceptance/350/staged.test.ts` together with its entry. The blind redraft `tests/acceptance/350/ac4-redraft/` is now AC4's test.

## Requirement → change → proof

| Issue sentence | Change | Proof |
|---|---|---|
| Run each alone on main; one that passes reads load-sensitive and its entry goes | None. #350 AC4's entry is already gone with its file | `350-ac4-redraft-main-{1,2,3}.txt`: AC4's test passes 7/7 in each of three runs at 1-minute load 127 to 172 |
| One that holds needs a fix | `packages/hub/test/memory-overrule.test.ts` types its second prompt as Claude Code does. The hub is unchanged | `memory-overrule-main-{1,2,3,4}.txt`: on main the case fails in every run, at load 74, 66, 78 and 28, at `expected [] to deeply equal [ 'kafka' ]` (line 35). `memory-overrule-fixed-{1,2,3}.txt`: with the change, 2/2 pass in each of three runs at load 31, 30 and 30. `memory-overrule-wrong-program.txt`: on a hub whose live prompt skips a direction overruled before, the fixed case fails at the same assertion (line 39) |

## The cause

The case overrules a rejection of `kafka`, re-reads the transcript, and then types "Again no. rejected: \`kafka\`." It expects the new prompt to reject `kafka` again.

c5628da27 (Nov 14, "require person origin before saving typed rules") made the hub save a prompt's `rejected:` only when the prompt's origin is `person`. The hub reads the origin from `adapters/claude-code.facts.json`: it joins the hook's `prompt_id` to the transcript entry with that `promptId`, and the entry's `turnOrigin: human` means a person typed it. Anything it can't place is `unknown`.

The case was written on Oct 30, before that change. Its prompt had no `prompt_id`, and its transcript was empty, so the hub read the origin as `unknown` and never saved the rejection. No wait helps, which is why it failed at load 28 just as it did at load 78.

The gate is deliberate (invariant 3: an agent can't make a decision), so the hub stays as it is. The case now writes the prompt's transcript entry and sends its `prompt_id`, as `ask-tasks.test.ts` and `continues.test.ts` already do. Its assertions are unchanged.

The case still guards what it was written for. On the wrong program, where a live prompt checks every decision with the key and not only active ones, the overruled decision keeps `kafka` from being said again, and the case fails.

## The captures

- `build-main.txt`: `npm run build --workspaces` and `cargo build --locked -q -p deep-hook` in this worktree before the runs, both exit 0.
- `memory-overrule-main-{1,2,3}.txt`: main's test, three runs.
- `memory-overrule-main-4.txt`: main's file, unchanged, run once more from a copy beside it (removed after). It was run in the same quiet window as the fixed runs to rule out load.
- `memory-overrule-fixed-{1,2,3}.txt`: the changed test, three runs.
- `memory-overrule-wrong-program.txt`: the wrong program's diff, its build, its run, and the restore and rebuild.
- `350-ac4-redraft-main-{1,2,3}.txt`: `tests/acceptance/350/ac4-redraft`, three runs.

One earlier attempt at the fixed and wrong-program runs is discarded and not kept here. Its script left cargo off PATH, so the test helper's `cargo build -p deep-hook` failed with ENOENT and every case timed out at 300 s. Its wrong program also didn't compile (TS6133).

## Not run

- `node scripts/affected.mjs` and the typecheck lane. The change is one test file, and the test above is the only thing that can see it.
- The preflight. Both files run in its unit lane's parallel block (neither is in `scripts/lanes.mjs`'s `alone`). Until this change lands, memory-overrule fails there on every run.
