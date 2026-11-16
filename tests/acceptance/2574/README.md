# Acceptance tests for #2574, AC1: Shards are made on Linux

A blind job wrote this test before any fix for #2574 existed, from issue #2574's AC1 only (AC2 to AC4 are out of
scope here), AGENTS.md, the design's Dogfooding section, `docs/parallel-proof.md` section 7a, and base commit
`1e3b798c5`'s `scripts/shards.mjs`. The implementing agent does not edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job.

`shards-linux.test.mjs` (AC1, all four bullets) builds a scratch git repository with a committed file, an untracked
file that isn't ignored, `node_modules/`, `packages/p/package.json` with `packages/p/dist/`, and `target/`, then calls
`claimShards(root, want, say)` in a child node with `HOME` a temporary folder and `DEEP_TEST_SHARD_FLOOR=0`. It checks:

- `want` (2) shards come back, `say` gets `SHARD <k> <dir>: made, at tree <hash>, node_modules cloned` for each, and no
  `not used` line;
- each shard holds the committed and untracked files with the worktree's bytes, `node_modules/` and
  `packages/p/dist/`;
- after an edit in `root`, a second claim of the same shard says `reused` and holds the edited bytes;
- the new shard holds no `target/` file of the worktree's (skipped on macOS, where the clone stays `cp -c`).

Run: `node --test tests/acceptance/2574/*.test.mjs` (Node 24 reads a bare directory argument as a file). It takes seconds and removes its temporary folders.
`BASE-FAILURE.txt` is its output at the base, where it fails as expected (`cp -c` is macOS-only).

# Acceptance tests for #2574, AC3: A process started through another package is wide

A blind job wrote `wide.test.mjs` before any fix, from issue #2574's AC3 only (with the owner's 2026-11-15 acceptance
of its trade-off; AC1, AC2 and AC4 are out of scope), AGENTS.md, the design's Dogfooding section and base commit
`1ab891283`'s `scripts/affected.mjs`, read only to learn what `select` reads. The expected values are the issue's.

It builds the issue's fixture in a temporary folder: `@deepbuild/a` depending on `@deepbuild/b`,
`packages/a/src/main.ts` importing `@deepbuild/b`, `packages/b/src/index.ts`, and `tests/t1.test.mjs` and
`packages/b/test/t2.test.mjs` starting `packages/a/dist/main.js`, `tests/t3.test.mjs` starting
`packages/b/dist/main.js`. It calls `select(root, changed, { files, workspace: [] })`:

- AC3, the table's first row: a change to `packages/b/src/index.ts` gives `tests` exactly `packages/b/test/t2.test.mjs`,
  `tests/t3.test.mjs` and `wide` exactly `tests/t1.test.mjs`;
- AC3, the table's second row: a change to `packages/a/src/main.ts` gives `tests` exactly `packages/b/test/t2.test.mjs`,
  `tests/t1.test.mjs` and no `wide`;
- AC3, "tests that import the changed file ... are selected as before": with a fourth test importing
  `packages/b/src/index.ts`, a change to that file selects it, and it is not wide;
- AC3, informative (the issue says "about"): `node scripts/affected.mjs --list packages/hub/src/log-reads.ts` on the
  real tree selects under 250 test files (about 115 expected) and its `WIDE` line counts over 800 (about 1,090).

`BASE-FAILURE-AC3.txt` is its output at the base: the first row fails as expected (`tests/t1.test.mjs` is selected, not
wide; `tests/t3.test.mjs` isn't selected), and the real-tree check selects 1,275 files with no `WIDE` line.


## AC2: A run queues once, before it starts anything

A blind job wrote `grant.test.mjs` and `helpers.mjs` before any fix for AC2 existed, from issue #2574's AC2 only (with
the 2026-11-15 amendment: the run's grant waits 30 minutes; AC1, AC3 and AC4 are out of scope here), AGENTS.md, the
design's Dogfooding section and `docs/parallel-proof.md` section 6, at base commit `1ab891283`. The implementing agent
does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

The tests run the real `scripts/affected.mjs` of this checkout in a scratch git repository, as #1115's do, with a
sandboxed HOME (so the throttle table and `~/.deepbuild/throttle/log` are the sandbox's), a cargo stub on PATH and the
run's TMPDIR in the sandbox. Every job the run can start is a probe that notes when it started and the
`DEEP_THROTTLE` it ran under: each lint script of `lanes.mjs`'s lint lane, the build script of a workspace package
`packages/p` (the change names `packages/p/src/index.mjs`, so `npm run build --workspaces` runs), a vitest file and a
node `--test` file. The real `scripts/throttle.mjs` sits behind a shim that records each CLI call's arguments and the
pid of the real throttle process; with `T2574_SHRINK` it gives a `test --wait` 0.02 minutes, as #1115's shim does, and
with `T2574_IDLE` the throttle reads a load of 0, so a top-level timed request doesn't wait on the machine's load.
Other sessions' holders are #1115's: `throttle.mjs test --wait 1 -- node stub.mjs`, one per test slot (4 on Linux, 2
on macOS).

- `#2574.AC2a` (bullet 1): for one run with no neighbour, the log shows exactly one top-level `granted` event of class
  `test`, no other `granted` or `timeout` event and no `build` event but `passed`; every `passed` event came through
  that grant, there are at least as many as the run's build and test job logs and no more than its job logs; the build,
  vitest and node jobs ran under the run's grant.
- `#2574.AC2c` (bullet 3): in the same run, the run's top-level test grant has `wait` 30 in the log and came from a
  `scripts/throttle.mjs test --wait 30 -- ...` call.
- `#2574.AC2b` (bullet 2): with every test slot held, the run, once its selection is printed and ten seconds more,
  has started no probe and opened no job log and is still waiting; once one holder is stopped, the build, vitest and
  node jobs start, none before the slot freed, and its grant comes after.
- `#2574.AC2d` (bullet 4): with every test slot held and `DEEP_TEST_GRANT_WAIT=0.02` (and the shim's 0.02 minutes),
  the run prints `INCONCLUSIVE no grant: no test grant came within 0.02 min`, an `INCONCLUSIVE` line naming each test
  file, an `INCONCLUSIVE affected:` summary, exits 2, and started no probe and opened no job log.
- `#2574.AC2e` (bullet 5): with `--timed` and a file of the real `timed` list, the timed file runs under a timed grant
  of its own (its `DEEP_THROTTLE` is `timed:<id>` of the log's one timed grant), granted after every top-level test
  grant of the run was released.

Run: `node --test tests/acceptance/2574/grant.test.mjs`. It takes a few minutes and removes its temporary folders.
`BASE-FAILURE-AC2.txt` holds its output at the base: AC2a fails (the run took 2 top-level test grants, and build
grants for the package build and the lints), AC2b fails (the build and lint jobs started while all 4 test slots were
held), AC2d fails (no `INCONCLUSIVE no grant: no test grant came within 0.02 min` line; the build and lints ran).
AC2c and AC2e pass on the base, which already takes each job's test grant through `throttle.mjs test --wait 30` and
runs the timed block under its own timed grant after its test grants are released; they guard those behaviours.
