# Acceptance tests for #2078: a stop after nothing but reads reuses the last snapshot without reading the worktree

Written first and blind, at base commit `1c4d1f0e2aaad8c6a6573848823566d04ff73d17` ("Merge pull request #2236 …"),
from issue #2078 (its account of the bug, Scope, both acceptance criteria and Proof), the design and the base, before
any implementation. The drafting job saw no fix, diff, other branch, other worktree or pull request. The implementing
agent does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).
There is no taste criterion, so no `TASTE.json`.

## What was read

- **The issue**: #2078 as handed to this job (`issue.json`).
- **The design**, `docs/technical-design.md`: How runs become one of five verdicts, all of it, and in it Pinned to a
  commit ("the same tree on the same HEAD is the same commit, and a stop whose tree and HEAD equal the last snapshot's
  reuses it and writes nothing"; "on a clean worktree the snapshot is HEAD"; "An edit after the snapshot makes its
  verdict stale"), the verdict table (a check that failed on every real run of the commit is FAIL; up to two more runs
  after a failed one) and Carried across sessions; Fast and slow lanes; and, in How we know version 0 works, Snapshots
  ("a stop whose tree and HEAD equal the last snapshot's writes no object and reuses its commit"), Criteria to tests,
  Criteria in a checked shape and Wrong programs.
- **The base code, to learn how to drive it**: `packages/hub/src/stop-judging.ts` (`runClaim`, where `same` is the
  hooks' word: no call but reads since the session's last claim; the issue names this as `runClaim` in `core.ts`),
  `packages/hub/src/gate-runner.ts` (`stop`), `packages/hub/src/core.ts` (the stop rule and `workedSinceClaim`),
  `packages/hub/src/ask-tasks.ts` (`claim`, `judge`), `packages/hub/src/open-items.ts` and
  `packages/gate/src/checkouts.ts` (`snapshot`, its budget and "snapshot over budget").
- **Sibling suites, for their conventions and helpers**: tests/acceptance/82 (the hub as a process, the record read
  through `events.read`, the Claude Code stand-in, the load rule), 875 and 1018 (#31's sample repo with Vitest cloned
  in, a fix claim made through a real hub) and 31 (the store read with git; the snapshot's budget).
- **The base, run**: before the tests were fixed, a throwaway diagnostic drove this scenario on the base with the same
  things done through hooked calls (the session's own Edit, its own `git commit`, its own Bash leaving the big file),
  where the base does read the worktree. Every expectation below held there, so each is what the base already does
  once it reads the tree. The diagnostic is not part of the suite.

## The surface under test

The tests reach DeepBuild only through these:

- **`deep hub run`** (`packages/cli/dist/main.js`), started on a temp home with #82's `startHub` and the shipped 60 s
  hold (no `DEEP_HUB_TEST_STOP_HOLD_MS`).
- **deep-hook** (`target/debug/deep-hook`), run as Claude Code runs our hook entries, each a child of the session's own
  process (#82's `Session` and `fixtures/agent.mjs`): SessionStart, UserPromptSubmit, PreToolUse and PostToolUse for
  Read and Edit, and Stop.
- **The record**, through the hub's socket method `events.read`: `claim.made`, `run.started`, `run.finished` and
  `verdict.made`. A claim's snapshot is the commit its `verdict.made` names (`data.commit`; design: "A verdict covers
  exactly one commit … A claim on a worktree with uncommitted changes covers a snapshot"), and a run's is
  `run.started`'s `commit`.
- **DeepBuild's object store**, `~/.deepbuild/objects` in the world's home: a file's bytes at a commit
  (`git show <commit>:<file>`, the repo's objects as alternates), a commit's parent, and the files its own object
  folder holds (each loose object and each pack).

No source file of the code under test is imported or read by a test.

## The scenario

#875's world with one change: #31's sample repo on `main`, one commit holding the seeded bug (`src/cart.ts`'s total
leaves the discount on), the drafted check `.deepbuild/checks/cart-discount.sh`
(`node_modules/.bin/vitest run test/cart.test.ts`) and the check's test file `test/cart.test.ts`, with Vitest cloned
into the ignored `node_modules`. The handed definition has one requirement, R1, checked by that file as a fix check
(`on_base: fails`, asserting `test/cart.test.ts:5`). The test file is on the base commit, where #875's fix adds it,
because a claim that changes a file its check loads is judged on the agent's own check and is INCONCLUSIVE, never PASS
(design: Whose checks count), and the criterion starts from a claim whose checks passed.

1. **The first claim, whose check passes.** The session types the prompt, its definition locks, it Reads
   `src/cart.ts`, Edits it to #31's fix, left uncommitted, and stops. The claim's check passes on its snapshot and fails
   on the merge base, so the verdict is PASS. Every test asserts this first: the verdict is PASS, names a commit that
   isn't HEAD, and `src/cart.ts` at that commit in the store is the fix.
2. **Something no hook saw.** The test's own process, with no hook fired, does one of: rewrite the tracked file
   `src/cart.ts` (AC1); nothing (AC2); commit the worktree as it stands (Scope, HEAD); leave a 32 GiB sparse untracked
   file (Scope, budget).
3. **The second stop, with only a read in its turn.** The session Reads `src/cart.ts` and stops, with no prompt between:
   the stop is one more of the same turn, as when a background command's end wakes the agent. The stop rule reads it as
   a claim (the turn did work, and its prompt opened the task), and it is the task's second `claim.made`.

A stop that makes no claim, a hub that can't start or a definition that never locks is BLOCKED (thrown), never a pass.

## Criteria to tests

All in `reuse.test.ts`.

| Criterion | Test | What it asserts, in order |
|---|---|---|
| AC1 `#2078.f33c092f` | `AC1 … src/cart.ts rewritten by a process no hook saw …` | `src/cart.ts` at the second claim's commit, read from the store, is the rewritten file (the Proof); that commit isn't the first claim's and its parent is HEAD; a run of the check started on that commit and every run of it there failed (the rewritten total leaves the discount on, so the test reads 100, not 90); the second claim's verdict is FAIL |
| AC2 `#2078.f4160036` | `AC2 … nothing changed, then a Read and a stop …` | the second claim's commit is the first claim's snapshot; the store's object folder holds no loose object or pack after the second stop that it didn't hold before it; no `run.started` after the second stop |
| Scope, line 1 (HEAD) | `Scope #2078 HEAD …` | with the worktree committed as it stands, the tree is the first snapshot's and HEAD is not: the second claim's commit is the new HEAD (design: "on a clean worktree the snapshot is HEAD"), not the first claim's snapshot |
| Scope, line 1 (budget) | `Scope #2078 budget …` | with a file no snapshot takes inside its budget in the worktree, the second claim is INCONCLUSIVE naming "snapshot over budget" and none of its checks runs |

Scope's second line ("what the hooks saw … may only skip work the tree read proves is the same") is AC1 and the two
Scope tests together: in each the hooks saw only a read and the tree read doesn't prove the same. Its third line
("with the tree unchanged, nothing is written and nothing runs, as today") is AC2.

**Why HEAD and the budget have tests of their own.** #31's suite proves both for the snapshot service
(`tests/acceptance/31/snapshot.test.ts`, AC13: the same tree on the same HEAD is the same commit and writes nothing;
`budget-snapshot.test.ts`, AC16 and AC17: past its budget the claim is INCONCLUSIVE naming "snapshot over budget" and
the count). Neither sees the hub's decision to reuse: on the base that decision never calls the service, and a fix
that compared trees alone, or read the tree with a git call of its own outside the budget, would pass all of #31's
tests. The expected values of the budget test (INCONCLUSIVE, "snapshot over budget", no run) are #31's, as the base's
own budgeted path gives them.

## The wrong program

For a fix, the merge base is the wrong program (design: Wrong programs). On `1c4d1f0e2` the hub takes the first claim's
snapshot as the second claim's whenever the hooks saw no call but reads, so:

- AC1 fails at its first assertion about the second claim, naming the file: `src/cart.ts` at the second claim's commit
  is the fix, not the rewritten file, because that commit is the first claim's snapshot. This is the issue's Proof,
  "the changed file missing from the second claim's snapshot on the merge base".
- The HEAD test fails: the second claim's commit is the first claim's snapshot, not the new HEAD.
- The budget test fails: the second claim carries PASS.
- AC2 passes, as the issue says ("as today"): it guards the fix against taking a snapshot, or running, when nothing
  changed.

The run on the base, `node scripts/affected.mjs tests/acceptance/2078/reuse.test.ts`, made once after the tests were
fixed, is in `BASE-FAILURE.txt`: 3 failed, 1 passed, as above. `affected.mjs` selected this one file and printed no WIDE
line; it was stopped at a 10-minute limit while its lint jobs still ran, before its summary, so the file holds the
vitest job's own log and no summary line. No test was skipped, so the run had no INCONCLUSIVE of this suite's.

## How to run

With Node 24.22 (`.node-version`) first on `PATH` and the Rust toolchain (`affected.mjs` reads `cargo metadata`, so
`cargo` must be on `PATH` too):

```sh
npm run build --workspaces               # the hub and the deep CLI the tests start
cargo build --locked -q -p deep-hook     # target/debug/deep-hook, which every hook runs
node scripts/affected.mjs tests/acceptance/2078/reuse.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/2078/tsconfig.json
```

- Every test starts a hub of its own and real Vitest runs, so the folder belongs on `scripts/lanes.mjs`'s
  one-at-a-time list (`alone`), beside #82's and #1018's. The implementer adds it (a new suite's own lane entry lands
  unsigned; design: The edit guard).
- Every test makes its folders under `/tmp/dh875-*` (a Unix socket path must fit in 104 bytes on macOS), sets `HOME`
  to `<tmp>/h` for every process it starts, and never touches the real `~/.deepbuild` or `~/.claude`.
- It stops only processes it started, by PID (#82's `cleanup`), never by name or port.
- No network, no model, no `claude` binary. Fixtures use synthetic identities only (`T <t@example.test>`).
- **Load.** A hook deep-hook couldn't hand to the hub within its budget, a definition that didn't lock within 180 s
  and a claim with no verdict 900 s after its stop are INCONCLUSIVE (a skip, never a pass) when the 1-minute load is
  past the core count, as in #82's suite; with no such load they fail or are BLOCKED.

## What this suite could not encode

- **"Read at the claim"**: the tests see what the second claim covers, not when the worktree was read. A hub that read
  the tree before the unhooked change and again at the claim is not told from one that read it once.
- **The budget's time**: the budget test asserts the verdict and that no check ran, not that the stop's reply came
  within #31's 11 s; that reading is #31's (`budget-snapshot.test.ts`) and needs a timed lane. A hub that reads the
  tree with no budget still fails the test, since it ends with a verdict other than INCONCLUSIVE "snapshot over
  budget", or with none inside the wait.
- **The budget fixture** is one 32 GiB sparse file, not #31's 300,000 small files: git must read all of it to add it,
  which no machine does in 8 s, and it takes no disk. On a file system that keeps no sparse file the test is BLOCKED
  and removes the file.
- **A background command still writing** is played by the test's own process writing the file between the two stops;
  no hooked call starts it.
- **The second claim's verdict in the HEAD test** is not asserted: whether its results carry by tree or its checks run
  again on the new HEAD is the design's to say elsewhere; only the commit the claim covers is.

## Files

- `helpers.ts`: the world, the scenario (`passingClaim`, `stopsAgain`), what the process no hook saw does
  (`rewritesFile`, `commits`, `leavesBigFile`), and the readings of the record and the store. It imports #82's hub and
  session, #875's check, definition and Vitest clone, and #31's sample files and git helpers; nothing in it stands in
  for DeepBuild.
- `reuse.test.ts`: the four tests.
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit, machine paths redacted.
