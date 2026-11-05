# Acceptance tests for #1016: one compile job pool per machine

Written first, blind, by a job that never saw an implementation of #1016; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- Issue #1016 as of 2026-11-04: Scope, the five acceptance criteria, Proof, Depends on (#1015, #236).
- `docs/technical-design.md`: Lease, Scale later: fleets and teams (a pool counts on each host), Dogfooding. The design
  names no jobserver surface yet: no hub method reads the pool, so the tests read the named pipe itself.
- At the base (`79d98cbc`): `packages/hub/src/heavy.ts` (`deep lease`, the queue, `lease.wait` / `lease.started` /
  `lease.exited`, the command run under `nice -n 10` in a process group of its own, `DEEP_LEASED`),
  `packages/hub/src/core.ts` (`DEEP_HUB_TEST_CORES`, the heavy tick every 500 ms), `packages/hub/src/plant.ts`,
  `packages/contracts/schemas/heavy.command@1.json` (`jobs`: `jobserver`, `none` or a number), `crates/deep-hook/src/heavy.rs`
  and `heavy.json` (shipped entries: `cargo build` is `jobs: jobserver`, `npm test` is `jobs: none`; done.yaml's
  `heavy_commands`), `scripts/lanes.mjs` (`alone`), `scripts/proof-change.mjs` (criterion IDs), and
  `tests/acceptance/1015/` and `tests/acceptance/18/mapping/helpers.ts` for format and helpers (the latter imported).

What the base does: `deep lease` leases a `cpu.slot` and runs the command with no jobserver; cargo then starts one
rustc per core, so four leased builds ran 48 rustc at once on this 12-core Mac (BASE-FAILURE.txt). The pinned
toolchain does honor the named-pipe form: given a pipe of 3 tokens, cargo 1.99.1 ran at most 4 rustc.

## Run them

```sh
npm ci                            # once, if node_modules is missing
npm run build --workspaces        # every file starts `deep hub run` and `deep lease` from packages/cli/dist
node node_modules/vitest/vitest.mjs run tests/acceptance/1016/<file>.test.ts   # one file at a time
node node_modules/typescript/bin/tsc -p tests/acceptance/1016/tsconfig.json
```

Use the repo's Node (`.node-version`, 24.22.0) and the pinned Rust toolchain (`rust-toolchain.toml`, 1.99.1, found with
`rustup which --toolchain`; its own `bin` folder goes first on `PATH`, so cargo and rustc are the real programs, not
rustup's proxies). `toolchain.test.ts` and `pool.test.ts` run real cold cargo builds (one, then 4 + 4 + 4), so every
file belongs on the one-at-a-time line: `scripts/lanes.mjs` needs `'tests/acceptance/1016/'` added to its `alone`
list. This README is the instruction; the implementer makes that edit. Rough times at load 35 on the reference Mac:
`toolchain.test.ts` 30 s, `pool.test.ts` 2 to 4 min, `recovery.test.ts` and `workers.test.ts` under 1 min each.

Nothing needs the network or a model. sccache is off for every build (`RUSTC_WRAPPER=` and
`CARGO_BUILD_RUSTC_WRAPPER=`), each build has a fresh `CARGO_TARGET_DIR`, and no `MAKEFLAGS`, `CARGO_MAKEFLAGS` or
`MFLAGS` of the test's own reaches the hub or `deep lease`. Folders are under `/tmp/dh1016-*` and are removed after
each file. Every process a test starts (the hub, each `deep lease`, each build's and stand-in's process group, as the
sampler and the stand-ins' log saw them) is stopped by its PID or process group ID, never by name or port; every go
file is written first so the stand-ins end on their own.

### The sample workspace

Generated per test (`writeWorkspace`): 24 independent library crates `leaf01` … `leaf24`, each 240 generic and plain
functions (about 1 s of rustc each), and `app`, a binary using them all (one link at the end). An unlimited cold build
runs 12 rustc at once on 12 cores; four run 48. For AC2 it is a git repo with four worktrees `wt-1` … `wt-4`.

### Counting jobs

`ps -A -o pid=,ppid=,pgid=,rss=,ucomm=` is sampled every 100 ms (each sample starts once the last is read, so under
load the gap is what `ps` allows; each reading prints its median gap, 100 to 120 ms at load 35). Only processes
descended from the test's own builds count. A job is a `rustc`, or a linker (`cc`, `clang`, `ld`, `ld64`, `lld` …)
with no rustc or linker above it: a linker a rustc runs (`rustc` → `cc` → `ld`) is that rustc's one job, holding one
token. Memory is the sum of those processes' resident size, read once a second.

### How commands are stood in for

`fixtures/standin.mjs`, installed in the world's bin folder as `holder` and `npm`:

- `holder`, a build that joins the jobserver from `CARGO_MAKEFLAGS` (else `MAKEFLAGS`) as a make or cargo client does
  and holds tokens until its go file exists: `DH1016_TAKE=<n>` reads n tokens, waiting for each; `DH1016_LEAVE=<n>`
  reads every token in the pipe without waiting and writes n back. On its go file it writes every token back and
  exits 0; killed, it gives nothing back. It logs what both variables held, its PID and process group.
- `npm`, a test runner: logs the words it was given and exits 0.

## Criteria to tests

Each test's name starts with its criterion's ID and tag (`#1016.<first 8 hex of the SHA-256 of the criterion's
text>`, as `scripts/proof-change.mjs` computes it from the checkbox line). Each named wrong program runs through the
same assertions and must fail them, naming what the criterion says.

| ID | File | Tests |
|---|---|---|
| AC1 `#1016.b32141c1` | `toolchain.test.ts` | the probe (BLOCKED if the toolchain ignores the named pipe), then `deep lease -- cargo build` with the hub's 4 tokens: at most 4 rustc in every sample |
| AC2 `#1016.33bb2666` | `pool.test.ts` | four worktrees' `deep lease -- cargo build --workspace`: four slots at once, no sample over 11, all four done no later than without the pool; its wrong program (`DEEP_HUB_PLANT=jobserver-per-build`), naming the sample |
| AC3 `#1016.4d1dc510` | `recovery.test.ts` | a holder of 6 tokens killed with SIGKILL beside a holder of 2: no token added while the second runs, never more than 11 in flight; all 11 back within 2 s once none runs; its wrong program (`DEEP_HUB_PLANT=refills-while-running`), naming the sample |
| AC4 `#1016.37903724` | `workers.test.ts` | `deep lease -- npm test` (`jobs: n`, `jobs_flag: --maxWorkers`) beside a build holding 8 tokens gets 3 workers, alone 11; its wrong program (`DEEP_HUB_PLANT=share-ignores-running-build`), starting 11 |
| AC5 `#1016.16cfab87` | `pool.test.ts` | the four builds' combined peak memory, read once a second, reported with and without the pool (AC2's runs) |

### AC1, `toolchain.test.ts`

1. The probe, with no hub: a named pipe the test makes holds 3 tokens; the pinned cargo builds a fresh sample
   workspace cold with `MAKEFLAGS` and `CARGO_MAKEFLAGS` both `-j --jobserver-auth=fifo:<pipe>`. A make client has one
   implicit job besides the tokens it reads, so a toolchain that honors the pipe runs at most 4 rustc; a sample over 4
   (or a failed probe build) fails the test with a message starting `BLOCKED:` that names `rustc -V` and `cargo -V`,
   never PASS, and the hub half isn't run.
2. The criterion: the hub is told 5 cores (`DEEP_HUB_TEST_CORES=5`), so by the issue's rule (one token per core less
   one) its pool is 4 tokens. `deep lease -- cargo build` in a fresh sample repo must exit 0, its rustc must be seen,
   and no 100 ms sample may count more than 4 jobs.

### AC2 and AC5, `pool.test.ts`

The hub is told 12 cores (`DEEP_HUB_TEST_CORES=12`): the pool is 11 tokens and the `cpu.slot` pool 6 (5 for slow work),
so four builds each hold their own slot at once. The same four builds run twice, on the same hub, each start together:

- **Without the pool** first: `deep lease -- /usr/bin/env -u MAKEFLAGS -u CARGO_MAKEFLAGS -u MFLAGS cargo build
  --workspace`. The merge base has no pool; its `deep lease` leases the slot and runs cargo at nice 10 with no
  jobserver, and this is that: the same lease, priority and folders, cargo given no jobserver (README, Open points 1).
- **With the pool**: `deep lease -- cargo build --workspace`, matched by the shipped `cargo build` entry (`jobs: jobserver`).

AC2 asserts, in order: each build exits 0; the record held 4 `cpu.slot` leases at once (folded from `lease.acquired`
and `lease.released` after the round's first log position); rustc was seen; no sample counts more than 11 jobs, else
the failure names the sample (`sample <i> of <n> (+<s> s): <k> rustc and linker processes … over the 11 tokens`); the
builds without the pool exit 0. Last, the four builds' wall time with the pool must be no more than without it; on a
machine whose 1-minute load is past its cores, at either round's start or the judging, that reading is INCONCLUSIVE
(skipped with both times), never PASS or FAIL. A count over 11 always fails. The wrong program runs the pooled round
only and must fail naming "sample" and "over the 11 tokens".

AC5 reads both rounds' memory: at least one read a second in each, both peaks above 0, and prints them side by side.
No threshold: the criterion asks for a reading.

### AC3, `recovery.test.ts`

A repo whose done.yaml names `holder` (`jobs: jobserver`). A, `deep lease -- holder` with `DH1016_TAKE=6`, holds 6
tokens; B, with `DH1016_TAKE=2`, holds 2. Both must have received the pool in `MAKEFLAGS` and `CARGO_MAKEFLAGS`, the
same pipe. The pipe's count is read (the Proof's "before"). A's process group gets SIGKILL; once A's `deep lease` has
exited, the pipe is read every 250 ms for 3 s while B runs. Each read: the pipe's tokens plus B's 2 must be at most 11
jobs in flight, else the failure names the sample ("more than the pool's 11"); and no read may hold more tokens than
the first, since the hub never adds a token while a leased build runs. Then B is let end (it writes its 2 back); from
the moment its `deep lease` exits, the pipe is read every 200 ms and must hold exactly 11 within 2 s. The wrong program
must fail naming "sample" and "more than the pool's 11".

### AC4, `workers.test.ts`

The same repo's done.yaml also has `{name: npm test, argv_prefix: [npm, test], kinds: [], jobs: n, jobs_flag:
--maxWorkers}`. A leased `holder` with `DH1016_LEAVE=3` takes every token in the pipe and writes 3 back, so it holds 8
of the 11 (with whatever `deep lease` itself holds for it). Then `deep lease -- npm test` must start the stand-in npm
with `--maxWorkers` set to 3. The holder is let end; 2 s after its `deep lease` exits (AC3's refill window), `deep lease
-- npm test` again must give 11. The worker count is the number after the flag, as `--maxWorkers=<n>` or `--maxWorkers
<n>`, anywhere in the runner's words (the last one counts). The wrong program runs the first half and must fail naming
"with 11 workers".

## Surfaces and plants the implementation must provide

None exists at the base except where said.

- **The pool**, served by the hub, one per host: a named pipe in the make jobserver protocol, holding one byte per free
  token; one token per core of the hub's cores (`DEEP_HUB_TEST_CORES` in tests, at the base) less one: 11 for 12, 4 for 5.
- **`deep lease [kind...] -- <command>`** (#1015, at the base) finds the command's `heavy.command@1` entry itself: the
  shipped entries and the `heavy_commands` of `.deepbuild/done.yaml` in its folder or above (up to the worktree's
  root), as deep-hook's matcher does. The tests start `deep lease` directly, with no agent session; its holder is then
  `cli`, as at the base.
- **`jobs: jobserver`**: the command's environment carries `MAKEFLAGS` and `CARGO_MAKEFLAGS`, each containing
  `--jobserver-auth=fifo:<the pool's pipe>`, the same pipe for every build on the host.
- **`jobs: n` with `jobs_flag: <flag>`**: a new value of `jobs`, the literal `n` as the issue writes it, and a new field
  `jobs_flag`, the flag that sets the runner's worker count (this suite's name for "the flag the entry names"). `deep
  lease` adds the flag with the runner's share of the free tokens, as `<flag>=<n>` or `<flag> <n>` in the command's
  words. A repo entry for `npm test` takes the place of the shipped one (`jobs: none`).
- **The pipe's count, as the tests read it**: open the path `MAKEFLAGS` gave (read and write, without waiting), read
  every byte there is, write each byte back. Read only while the pipe is quiet: while a leased build runs (no refill
  then) or after the last one ended.
- **Plants**, `DEEP_HUB_PLANT=<name>` in the environment of the hub and every `deep lease` the tests start; the hub lists
  each, so it starts with it, and whichever program implements a plant acts on it:
  - `jobserver-per-build` (AC2): each build gets a jobserver of its own, with the pool's 11 tokens.
  - `refills-while-running` (AC3): the hub tops the pipe up to its full count while a leased build runs.
  - `share-ignores-running-build` (AC4): a `jobs: n` runner's share is the whole pool, whatever the running builds hold.

## Open points (choices the issue leaves open; the tests assert the least they can)

1. **"Compared with the merge base".** The merge base has no pool, so the comparison is the same four builds under
   this build's `deep lease` with the jobserver variables removed from cargo's environment: what the base's `deep
   lease` gives cargo. Building the base's CLI beside this one would cost a full workspace build for no difference in
   what cargo sees.
2. **One timing pair.** At the base, two identical rounds at load 35 differed by 25% (24.1 s, 30.4 s), so the timing is
   read only on a machine within its cores; on this shared Mac it reads INCONCLUSIVE.
3. **The implicit job.** A make client runs one job without a token. Whether the pool keeps a token for each leased
   build's first job, or counts it some other way, is the implementation's; the tests count processes (AC1, AC2),
   tokens in flight (AC3), free tokens (AC4) and the full pipe (AC3), each against the issue's number.
4. **"Holds 8 tokens".** Read as: 8 of the 11 are out of the pipe while it runs (it leaves 3 free).
5. **"While another leased build runs, no token is added"** is read as: no read of the pipe after the killed build's
   `deep lease` ended holds more than the first such read, and the pipe plus what B holds never passes 11.
6. **`jobs: n`**: the issue's literal `n`; the schema's fixed numbers are left as they are.
7. **Gate checks** (`cpu.slot`, their own job count) aren't exercised: the criteria don't ask for it.
8. **Not covered**: the dogfood week's split (#43), memory thresholds, other hosts.
