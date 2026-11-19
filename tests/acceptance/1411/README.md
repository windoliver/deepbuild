# Acceptance tests for #1411: the compile job pool gives tokens back under memory pressure while builds run

Written first, blind, by a job that never saw an implementation of #1411; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- Issue #1411 as of 2026-11-18: Scope, the four acceptance criteria, Proof, Not in scope, Depends on (#1016).
- `docs/technical-design.md`: Lease (the compile job pool, and how it follows memory pressure: "on the hub's tick it
  holds back half its tokens at warn and all but one at critical as they come back, and returns them at normal with
  hysteresis, while a job in flight keeps its token") and Dogfooding.
- At the base (`f6ddd396f`): `packages/hub/src/heavy.ts` (the memory-pressure reading and `DEEP_TEST_MEMORY_PRESSURE_FILE`,
  `JobPool`, `HeavyQueue` and its `tick()`, `deep lease` and how a command takes jobs), `packages/hub/src/core.ts`
  (`DEEP_HUB_TEST_CORES`, one token per core less one, the heavy tick every 500 ms), `packages/hub/src/plant.ts`,
  `packages/contracts/schemas/heavy.command@1.json` (`jobs`: `jobserver`, `n`, `none` or a fixed number),
  `crates/deep-hook/src/heavy.rs` and `heavy.json` (done.yaml's `heavy_commands`), `scripts/lanes.mjs` (`alone`),
  `scripts/proof-change.mjs` (criterion IDs), and the suites `tests/acceptance/1016/` (its world, pipe read and `ps`
  sampler, imported) and `tests/acceptance/1015/memory.test.ts` (a level planted through the test seam).

What the base does: memory pressure acts only when a heavy command starts. `warn` changes nothing, and `critical` only
keeps new `deep lease` commands waiting. A build that started holds every token it reads, whatever the level: with 8
tokens and the level at `warn` or `critical`, all 8 stay out (BASE-FAILURE.txt). A command whose entry gives a fixed job
count runs as `jobs: none` does, outside the pool, and nothing names it.

## Run them

```sh
npm ci                            # once, if node_modules is missing
npm run build --workspaces        # every file starts `deep hub run` and `deep lease` from packages/cli/dist
cargo build --locked -p deep-hook # the hub stops at start without it, and `deep lease` asks it for a command's entry
                                  # (add --features env-plants if a plant below is implemented in deep-hook, #1408)
node node_modules/vitest/vitest.mjs run tests/acceptance/1411/<file>.test.ts --testTimeout=600000   # one file at a time
node node_modules/typescript/bin/tsc -p tests/acceptance/1411/tsconfig.json
```

Use the repo's Node (`.node-version`, 24.22.0) with rustup's `bin` on `PATH`: #1016's world, which these tests build
on, finds the pinned toolchain (`rust-toolchain.toml`, 1.99.1) with `rustup which` and puts its own `bin` first, so
`cargo` and `rustc` are the real programs. Every file starts a hub and holds builds while it changes the level, and
`real-build.test.ts` runs a cold 65-crate build, so the folder belongs on the one-at-a-time line: `scripts/lanes.mjs`
needs `'tests/acceptance/1411/'` added to its `alone` list. This README is the instruction; the implementer makes that
edit. Rough times on an 18-core Mac at load 260-390: against the base 12 to 44 s a file, 139 s in all; as built,
`restored.test.ts` up to 4 min (it waits out a hysteresis window twice, and its `restores-only-when-idle` run waits the
full 70 s), `real-build.test.ts` 1 to 4 min (most of the build runs one job at a time), the others about a minute each.

Nothing needs the network or a model. Folders are #1016's, under `/tmp/dh1016-*`, removed after each file. Every process
a test starts (the hub, each `deep lease`, each stand-in's and build's process group) is stopped by its PID or process
group ID, never by name or port; every go file is written first so the stand-ins end on their own.

### The world and the scripted pressure source

#1016's world (a temp home, the hub as a process, a bin folder, `deep lease` started as a caller starts it), with the
hub told 9 cores (`DEEP_HUB_TEST_CORES=9`): its pool is the issue's 8 tokens. The memory-pressure level is #1015's test
seam: the hub and every `deep lease` get `DEEP_TEST_MEMORY_PRESSURE_FILE`, a file the test writes `normal`, `warn` or
`critical` into (a new file renamed over the old, so no read sees half a word). Each test's output prints its script
(the level in brackets) beside the tokens out over time.

### How commands are stood in for

`fixtures/standin.mjs`, installed in the world's bin folder as `jobbuild` and `steadyrun`; neither prints anything. The
sample repo's `.deepbuild/done.yaml` names them: `jobbuild` with `jobs: jobserver`, `steadyrun` with `jobs: 3`.

- `jobbuild`, a build that joins the jobserver from `CARGO_MAKEFLAGS` (else `MAKEFLAGS`) as make and cargo do: one job
  always runs on its implicit token, and each further job reads one token from the pipe and writes that byte back when
  it ends. It wants every token there is (up to 32 jobs), each job 100 to 300 ms (200 on average), so its jobs end one
  by one as a build's do and the pipe is empty while it runs. A byte a job gives back stays in the pipe 1 ms before the
  build reads again: a reader the write woke (the hub's) has the first go at it, as it has against cargo's own reader
  thread. Until its go file it starts jobs without end; then it runs `DH1411_TAIL` more (0, or 10 in AC3), gives every
  token back and exits 0. It writes what it holds on every change and every 250 ms.
- `steadyrun`, a runner with a fixed job count of its own (3): it never joins a jobserver and writes a heartbeat every
  100 ms until its go file, then exits 0.

### Counting tokens

While `jobbuild` runs, the tokens out are the ones its jobs read plus the one the hub took for its first job (#1016:
"one token the hub takes for the build's first job"); the pipe is empty at each reading, since the build has just
taken every free token. At the base, at `normal`, that reads 8: 7 read and the first job's. With no build running, the
tokens out are those in the pipe, read as #1016 reads them (every byte taken without waiting, each written back).

## Criteria to tests

Each test's name starts with its criterion's ID and tag (`#1411.<first 8 hex of the SHA-256 of the criterion's text>`,
as `scripts/proof-change.mjs` computes it from the checkbox line). Each named wrong program runs through the same
assertions and must fail them, naming what the criterion says.

| ID | File | Criterion words | Tests |
|---|---|---|---|
| AC1 `#1411.5cf27caa` | `held-back.test.ts` | "With 8 tokens and a simulated `warn`, no more than 4 are out once running jobs return theirs; at `critical`, no more than 1" | the stand-in build at `normal` (8 out), then `warn`: no more than 4 out within 15 s and for the next 5 s; then `critical`: no more than 1, the same way |
| AC2 `#1411.a9c42261` | `restored.test.ts` | "Back at `normal`, all 8 are available again, and a flapping level doesn't change the pool more than once in its hysteresis window" | held back at `warn`, then `normal`: all 8 out within 70 s; then the level flaps `warn`, `normal`, `warn`, `normal`, `warn` (700 ms each): at most one change of the pool in the 4 s from the first flap, and all 8 out within 70 s once it stays `normal`; wrong programs `restores-only-when-idle` (fails "must be out again") and `no-hysteresis` (fails "changed the pool") |
| AC3 `#1411.36f7169d` | `floor.test.ts` | "A held-back pool never reaches 0 tokens, so a running build always finishes" | held back at `critical` (no more than 1 out within 15 s); the build let go there runs its last 10 jobs and exits 0 within 120 s, the level still critical; then, no build running, every read of the pipe for 3 s holds at least one token; wrong program `holds-back-every-token` (fails "never reaches 0 tokens") |
| AC4 `#1411.50e54eec` | `fixed-count.test.ts` | "A command leased with a fixed job count is unaffected and is named in the output" | beside the stand-in build, at `warn`, `deep lease -- steadyrun` (`jobs: 3`): starts without waiting for a token, given no jobserver and no words, runs on through 3 s of `warn` and 3 s of `critical`, exits 0 there; a printed line names `steadyrun`; wrong program `pool-holds-fixed-count` (fails "a command leased with a fixed job count … the pool") |
| AC1, AC3 (the Proof's real build) | `real-build.test.ts` | Proof: "a real build under a planted level, with its token counts over time" | a cold `deep lease -- cargo build --workspace` of 64 crates and `app`, the level planted at `warn` before it starts and turned `critical` while it runs: no 100 ms sample over 4 jobs at `warn` and over 1 at `critical` once running jobs have returned their tokens, and exit 0 at `critical` |

The Proof's "pool driven by a scripted pressure source" is every stand-in file: the hub's own pool, driven by the
level the test writes, its tokens out printed over time.

### AC1, `held-back.test.ts`

`deep lease -- jobbuild` must give the build the pool (`--jobserver-auth=fifo:<path>` in `MAKEFLAGS` or
`CARGO_MAKEFLAGS`), and all 8 tokens must be out at `normal`. The level turns `warn`: within 15 s the tokens out must
come to 4 or fewer, and no reading of the next 5 s may be over 4. Then `critical`: 1 or fewer within 15 s, none over 1
for 5 s. The failure names the level, the count and the time since the change.

### AC2, `restored.test.ts`

As AC1 to `warn` (no more than 4 out within 15 s, held 2 s), else there is nothing to give back and the test fails
there, saying so. Then `normal`: all 8 out within 70 s. After a second with all 8 out, the flapping, then `normal` to
stay. The readings of the 4 s from the first flap are counted in changes (Open points 4); more than one fails, naming
the path of tokens out (as `8 → 4 → 8 → 4`). Then all 8 out again within 70 s.

### AC3, `floor.test.ts`

As AC1, with `critical` instead of `warn`: no more than 1 out within 15 s, held 3 s, else no pool is held back to read.
The build is let go: it runs 10 more jobs on what the pool leaves it, and its `deep lease` must exit 0 within 120 s.
From that exit, with the level still `critical`, the pipe is read every 200 ms for 3 s; a read of 0 fails, naming it.

### AC4, `fixed-count.test.ts`

The build at `normal` with all 8 out; the level turns `warn`; 2 s later `deep lease -- steadyrun`. Unaffected: no
`deep lease: waiting` line, its command started within 60 s, no `--jobserver-auth` in its `MAKEFLAGS` or
`CARGO_MAKEFLAGS`, its words as typed (none), no heartbeat gap over 3 s from its start to its go, a heartbeat after the
level turned `critical`, and its `deep lease` exits 0 within 60 s of its go, the level still `critical`. Named: a line
of what the test's `deep lease` commands printed (its own and the build's, stdout and stderr) or of the hub's stderr
contains `steadyrun`, other than a line saying it waits (`deep lease: waiting`) or runs with no lease.

### The real build, `real-build.test.ts`

A cargo workspace of 64 library crates (each about a second of rustc, as #1016's sample) and `app` using them all,
built with one codegen unit, no debug info and no incremental cache, so each rustc runs on the one token it was started
with. #1016's sampler counts its jobs (each rustc, and each linker no rustc started) every 100 ms. The level is `warn`
1.5 s before the build starts. Once the jobs seen in the first second have ended and 20 jobs have ended in all, the warn
window runs until 12 more have ended and 3 s have passed: no sample over 4. Then `critical`; once the jobs running at
the switch have ended and 16 have ended since it, the rest of the build is the critical window: no sample over 1. Then
exit 0. The windows are counted in jobs ended, not seconds, so a faster or slower machine reads the same part of the
build: a pool that wins half its races with cargo's reader for a returned token takes its 4 within 20 endings in all
but about 1 run in 800, and its 3 at critical within 16 in all but about 1 in 500. A window with fewer than 10 samples
taken while the build ran is INCONCLUSIVE (skipped with the reason), never a pass. The output prints the most jobs in
any sample of each second, with the level.

## Surfaces and plants the implementation must provide

- **The pool's hold-back**, served by the hub, on the pool `deep lease` already gives a `jobs: jobserver` build: as
  tokens come back to the pipe, the pool keeps them until no more than 4 of its 8 are out at `warn` and 1 at `critical`,
  and gives them back at `normal`, so that a build blocked on the pipe reads them.
- **The level**, read as at the base: `DEEP_TEST_MEMORY_PRESSURE_FILE` in the hub's environment (and every `deep
  lease`'s) names a file holding `normal`, `warn` or `critical`, read afresh on each tick.
- **Output naming a fixed-count command**: a line printed by `deep lease` (any leased command's, stdout or stderr) or by
  the hub (stderr) that contains the command (`steadyrun` here).
- **Plants**, `DEEP_HUB_PLANT=<name>` in the environment of the hub and of every `deep lease` the tests start; the hub
  lists each, so it starts with it, and whichever program implements a plant acts on it:
  - `restores-only-when-idle` (AC2): the pool gives back the tokens it held back only once no leased command runs, as
    the base's refill does, so a build still running at `normal` never gets them back.
  - `no-hysteresis` (AC2): the pool follows each reading at the next tick, holding back at every `warn` and giving back
    at every `normal`.
  - `holds-back-every-token` (AC3): at `critical` the pool holds back every token it can, the last one too, so once the
    build that ran on the one left has ended, none is out.
  - `pool-holds-fixed-count` (AC4): a command whose entry gives a fixed job count runs as a `jobs: jobserver` build
    does: the hub takes a token for it and gives it the pool in `MAKEFLAGS` and `CARGO_MAKEFLAGS`.

## Open points (choices the issue leaves open; the tests assert the least they can)

1. **"Out" and "available".** Of the pool's 8, the tokens not held back: free in the pipe, read by a running build's
   jobs, and the one the hub takes for each running build's first job (#1016). "Available again" is read as out again:
   a held-back token is not available to any build. While the stand-in build runs it holds every token out; with no
   build running, the tokens out are those in the pipe.
2. **8 tokens** is the hub told 9 cores (one token per core less one), as #1016's suite sets its pool.
3. **"Once running jobs return theirs".** The design has the pool hold tokens back on its tick "as they come back", so a
   level's bound is reached as the stand-in's jobs (100 to 300 ms) give theirs back, not after a hysteresis window:
   within 15 s of the change, then held 5 s. Against the stand-in, a reader the returned byte wakes wins it in its
   first millisecond; against cargo, the real build gives the pool 20 job endings at `warn` and 16 at `critical` before
   its bound is read.
4. **The hysteresis window.** Its length is the implementation's. It is read as at least 5 s, so a level that flaps for
   3.5 s may change the pool at most once in the 4 s counted, whether the window delays the return at normal or follows
   any change; and at most 60 s, so all 8 are out within 70 s of the level's return to normal. A change of the pool is a
   move of the tokens out by 2 or more one way, however many readings it takes as tokens come back one by one; a single
   token back the other way is one in transit between the pool and the build, not a change (each change the issue
   names moves 3 or more: 8 to 4, 4 to 1, and back).
5. **The flapping** is `warn`, `normal`, `warn`, `normal`, `warn`, 700 ms each, from a pool with all 8 out for a
   second: a pool with no hysteresis moves at each of the hub's 500 ms ticks that reads a new level.
6. **A fixed job count** is a `heavy.command@1` entry whose `jobs` is a number (the schema's fixed count), here
   `steadyrun` with `jobs: 3` in the repo's done.yaml. "Unaffected" is read as: it starts at `warn` without waiting for a
   token, is given no jobserver and no words, runs on through `warn` and `critical`, and exits 0 when let go at
   `critical`.
7. **"The output"** is read as what is printed: by `deep lease` (the fixed-count command's own and the build's, stdout
   and stderr) and by the hub (stderr). The record's events and `deep status` are not read. A line that names the
   command only because it waits for a lease or runs with no lease doesn't count; the stand-ins print nothing.
8. **"Never reaches 0 tokens"**: a build's first job runs on the token the hub took for it, so a pool held back while a
   build runs always has that one out; what's left to read is the pool once the build has ended, still at `critical`.
   "So a running build always finishes" is read on the stand-in (its last 10 jobs) and on the real build, both let end
   at `critical`.
9. **New starts at `critical`** keep waiting, as at the base: no test starts a command at `critical`.
10. **Not covered**: the Scope's reading of how long the machine spends at each level over a working day (a reading
    for the PR, not a behavior), real memory pressure (a real allocator would press every other session on this shared
    machine), `jobs: n` runners, and other hosts.
