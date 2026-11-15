# Acceptance tests for #2574: affected.mjs takes hours (shards on Linux, one grant a run, wide through another package's process)

Written first, blind, from issue #2574 (its text on 2026-11-14), AGENTS.md, the Dogfooding part of
`docs/technical-design.md`, `docs/parallel-proof.md` sections 6, 7 and 7a, and the base commit `2252dfd6f` (whose
`scripts/shards.mjs`, `affected.mjs` and `throttle.mjs` are `1e08d48fa`'s), by a job that never saw an implementation;
none existed. At the base I read `scripts/shards.mjs`, `affected.mjs`, `throttle.mjs`, parts of `lanes.mjs`,
`proof-binaries.mjs` and `proof-runs.mjs`, and `tests/acceptance/1113/`, `1114/` and `1841/` for their conventions. The
helpers are written here, never imported from another suite. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft by this job.

**AC2 was redrafted after the owner amended it on 2026-11-15** (the grant waits 30 minutes, not 180, and is taken
through `scripts/throttle.mjs test --wait`; a run with no grant prints an INCONCLUSIVE line per file and its
`INCONCLUSIVE affected:` summary, as #1115's no-grant cases expect). The redraft is again blind: it saw the amended
issue, the same design sections, `tests/acceptance/1115/` for its throttle shim, and the base `1e3b798c5`, whose
`scripts/` differ from `1e08d48fa`'s in `config-eval.mjs`, `known-failures.json`, `lanes.mjs`, `repo-rules.json`
and `size-ceilings.json`, never in `throttle.mjs`, `shards.mjs` or `affected.mjs`. Only `grant.test.mjs`, its part of `helpers.mjs` (the shim and
`throttleCalls`), this file's AC2 parts and `BASE-FAILURE.txt`'s AC2 run changed; AC1 and AC3 stand as first drafted.

```sh
npm ci                                   # once, if node_modules is missing (affected.mjs and shards.mjs import typescript)
node --test tests/acceptance/2574/shards.test.mjs
node --test tests/acceptance/2574/grant.test.mjs
node --test tests/acceptance/2574/select.test.mjs
```

15 tests, about 25 s in all on the Spark; no cargo build, no vitest. They're `*.test.mjs` under `tests/acceptance/`.
**Every test builds its own small git repository in a temporary folder and points `HOME` and `TMPDIR` there**, so the
shards are the sandbox's `deepbuild-shards/`, the throttle's table and log its `.deepbuild/throttle/`, and nothing
selects or runs the real repository's tests. The sandbox unsets `DEEP_THROTTLE`, `DEEP_SHARDS`, `DEEP_TEST_GRANT_WAIT`
and the proof lanes' other variables, and sets `DEEP_TEST_SHARD_FLOOR=0`. Each process a test starts has its own
process group, and the test stops it by that PID when it ends.

## Criteria to tests

The issue's criteria are bullets under AC headings, not `- [ ]` lines, so `criterionId` gives them no ID; each test's
name starts `#2574 AC<n>` and repeats its bullet.

| Criterion bullet | Test (file) | On the base |
|---|---|---|
| AC1: returns `want` shards; `say` gets `SHARD <k> <dir>: made, at tree <hash>, node_modules cloned` for each, no `not used` line | `shards.test.mjs` 1 | fails: two `not used: Try 'cp --help'` lines, no shard |
| AC1: each shard holds the committed and the untracked file with the worktree's bytes, `node_modules/` and `packages/<p>/dist/` | `shards.test.mjs` 2 | fails the same way |
| AC1: a second claim after an edit in `root` says `reused` and holds the edited bytes | `shards.test.mjs` 3 | fails the same way |
| AC1: off macOS a new shard holds no `target/` of the worktree's | `shards.test.mjs` 4 (skipped on macOS) | fails, but only the same way; its own wrong program is the planted `copies-target` |
| AC1: on macOS the clone stays `cp -c` | `shards.test.mjs` 5 (macOS only): a new shard holds the worktree's `target/` | not run: no Mac. It guards what the base does there |
| AC2: one top-level `granted` of class `test`, logged with `wait` 30, a `passed` for each job that asks, no `build` request; held from before the first job until the last untimed job ended; with shards or without | `grant.test.mjs` 1 (one alone group, no shard) and 2 (two alone groups, `DEEP_SHARDS=2`) | fail: 14 build requests of the table |
| AC2: while every `test` slot is held by other live processes the run starts no job; it starts once a slot frees | `grant.test.mjs` 3 | fails: the build starts at once |
| AC2: the grant waits 30 minutes and is taken through `scripts/throttle.mjs test --wait`; on no grant `INCONCLUSIVE no grant: no test grant came within 30 min`, a line naming each file, the `INCONCLUSIVE affected:` summary, exit 2, no job | `grant.test.mjs` 4, behind the throttle shim | fails: the first throttle call is `build --wait 30 -- … npm run build --workspaces` |
| AC2: `DEEP_TEST_GRANT_WAIT` sets the wait in minutes; the same no-grant output with its wait | `grant.test.mjs` 5 (`0.05`) | fails: the build starts at once |
| AC2: the timed files still run after the grant is released, under their own `timed` grant | `grant.test.mjs` 6, skipped as INCONCLUSIVE when the load is at or above the cores | fails, but only on its precondition: no single test grant (11 build requests). It guards what the base does once the run has one grant |
| AC3: table, row `packages/b/src/index.ts` | `select.test.mjs` 1 | fails: t1 in `tests`, `wide` empty |
| AC3: table, row `packages/a/src/main.ts` | `select.test.mjs` 2 | passes, as it must; its wrong program is the planted `nothing-close` |
| AC3: tests that import the changed file, name its path or run a changed crate are selected as before | `select.test.mjs` 3 | passes, as it must: it guards what the base does |
| AC3: a wide test is listed on the `WIDE` line | `select.test.mjs` 4, `affected.mjs --list` | fails: no WIDE line |
| AC4 | none: docs only | |

`BASE-FAILURE.txt` holds the run on the base and the runs on the two planted wrong programs, which are scratch edits
described there and not kept in the tree.

## The surface, and readings where the issue leaves a choice

- **Nothing is imported from `scripts/`.** `claimShards` and `select` are called in a child process (`helpers.mjs`,
  `claim` and `select`), with the arguments the issue gives; `affected.mjs` and `throttle.mjs` are run.
- **AC1's repository**: `src/kept.txt` committed, `notes/new.txt` untracked, and `node_modules/`, `packages/p/dist/`
  and `target/` left out by `.gitignore`, as the real ones are. `want` is 2. A shard's folder is what `claimShards`
  returned as `dir`; its line is the one starting `SHARD <k> <dir>: `, `k` the folder's name. The hash is 40 to 64 hex
  digits. A `reused` line is read up to `reused, at tree <hash>`; what follows is not judged. "The same shard": the
  second claim returns the same folders.
- **"Holds no `target/` of the worktree's"**: the shard has no file under `target/`. An empty `target/` folder passes.
- **The affected.mjs tree** (`helpers.mjs`, `affectedTree`): a copy of this checkout's `scripts/` in a fresh
  repository, with a `node_modules/` of its own holding only a link to this checkout's `typescript`, an empty
  `known-failures.json`, and probe test files that note their start, end and `DEEP_THROTTLE`. Stubbed, at boundaries
  #2574 doesn't own: `npm` and `cargo` on `PATH` (each notes its start and passes; `cargo metadata` reports one
  library crate), the lint lane's own scripts (each notes its start and passes), and `deep`, whose `lease --` runs its
  command, so `scripts/lease` reaches no hub. The run is given a package's source (so it builds first), the crate's
  Rust (so `cargo test`, `cargo fmt` and clippy run), a plain probe and one or two probes in folders of `lanes.mjs`'s
  `alone` list. Each AC2 test first requires that every one of those jobs ran.
- **"One top-level `granted` event of class `test`"**: in a HOME only the run used, the log has exactly one `granted`
  line outside the `timed` class, and it is `top-level`, class `test`. **"No `build` request"**: no `granted` or
  `timeout` line of class `build`, which is what a request that entered the table leaves. A `passed` line whose class
  is `build` is not counted against it: a job that asks for build and passes through on the run's grant is what the
  criterion's first sentence describes. **"A `passed` event for each job that asks"**: at least one `passed` line, and
  every one's `through` is the run's grant; which jobs ask is the implementer's, so they aren't counted. The build,
  `cargo test`, the `node --test` block and each alone group must have run with `DEEP_THROTTLE` naming the run's grant.
- **"Before its first job … until its last untimed job has ended"**: every event a job noted, the lint scripts'
  too, is at or after the grant's `granted` line and at or before its `released` line.
- **"Starts no job" while the slots are held**: the machine's test slots (4, or 2 on macOS) are each held by
  `throttle.mjs test --wait 1 -- node note.mjs holder-<n> hold 120000` (this checkout's throttle, never the shim) under the same HOME. The test waits 3 s after the run
  prints its selection, or 15 s if it prints nothing while it waits, and requires that no job noted a start and the run
  is alive. Then one holder gets SIGTERM, by its PID; the run must finish with every job started after that, one
  grant logged after it, and `PASS`.
- **Taken through `scripts/throttle.mjs test --wait`** (test 4): the tree's `scripts/throttle.mjs` is a shim of
  #1115's kind (`helpers.mjs`, `THROTTLE_SHIM`) over the real one, moved to `throttle-real.mjs`. It notes each call's
  arguments, runs a `test` request with `--wait 0.02` (1.2 s) in place of the wait asked, and writes the real
  throttle's `came within 0.02 min` back as the wait asked, so it stands for a throttle whose clock runs fast; its
  module exports are the real one's. With every slot held and no `DEEP_TEST_GRANT_WAIT`, the run's first call of the
  shim must read `test --wait 30 -- …`, the run must have ended within 60 s (a run waiting on a clock of its own, as an
  in-process `acquire`, waits the full 30 minutes), and it must print the issue's line with 30, the rest below, and
  have started no job. The 30 is read in two places: the asked `--wait` here and the `wait` of the run's `granted` line
  in test 1, where the real throttle logs what it was asked.
- **The no-grant output** (tests 4 and 5): a line `INCONCLUSIVE no grant: no test grant came within <n> min` with
  `<n>` the wait as a number (30, or `DEEP_TEST_GRANT_WAIT`'s 0.05, which is 3 s, in test 5); for each file given (a
  plain probe and an alone one) some line starting `INCONCLUSIVE` that contains its path, read as #1115's
  `expectFilesInconclusive` reads it; a last summary line starting `INCONCLUSIVE affected: `; exit 2; no job noted a
  start. The run is also given a package's source, so a run that starts anything before its grant starts the build.
  Test 5 also requires the log to show one `timeout`, of class `test`.
- **The timed files**: `--timed` with a probe at a path `lanes.mjs`'s `timed` list names. It must start after the
  run's test grant is released, with `DEEP_THROTTLE=timed:<id>`, inside a top-level timed grant the log shows.
- **AC3** uses the issue's fixture as written, with `packages/b/src/main.ts` importing `./index.js` so that b's build
  reaches the changed file, `files` the fixture's own list and `workspace` empty. The lists are compared whole and in
  `select`'s sorted order.

## What these tests can't see

- A Mac: the macOS test and the Mac's two slots were not run.
- The 30-minute wait run out in real time: test 4 runs it as 1.2 s through the shim. Also the last table row of the issue (about 115 files in place of 1,205 on the real tree).
- "At most as many runs as the machine has test slots are at work at once" is read through one run and the holders;
  two real runs side by side are not started.
