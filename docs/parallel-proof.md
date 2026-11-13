# DeepBuild: parallel proof

> How this repository's own proof tooling shares two machines between many agent sessions without letting one session's load, build or stale copy change another's verdict. It covers what runs on the Mac and what on the Spark, fixed-path build workspaces called bays, the cost cuts inside one proof run, a per-machine throttle table, the split of the unit lane's `alone` block, remote lanes, machine hygiene, how the tooling issues are shaped, and the budget windows that measure every merged commit on a reference Mac. It is the design the proof tooling issues T0–T10 build on.

This is the repository's tooling, not the product. The product's own lease for builds in users' repos is #1015, and nothing here imports it. The checks and their verdicts are those of [How we know version 0 works](technical-design.md#how-we-know-version-0-works); this page changes where and when they run, never what they accept. Each step's issue holds its criteria; this page holds the reasons.

## 1. Goal

Many sessions work in this repository at once, each in its own worktree, and each proves its change before it merges. Today every proof starts cold, every lane runs on the session's own machine, and two proofs on one machine turn each other's budgets INCONCLUSIVE. The goal is shorter proofs and budgets that count, with no verdict weaker than today's except where a step says so, names the trust it gives up, and records it.

## 2. Measured baseline

Readings from the Mac and the Spark before any tooling change, which the steps are measured against:

- **Load.** With nothing building, the Mac sat at a 1-minute load of 14–18 with swap 97% used. A budget refuses to count at a load above the core count (invariant 2), so at that load every budget reads INCONCLUSIVE. This is the largest slowdown measured, and hygiene (section 9) comes first for it.
- **Worktrees.** 47 worktrees on the Mac had merged branches. Several worktrees on open branches held large `target/` folders.
- **Cold copies.** The proof lane makes a cold copy per use (the base, the change, each twin, crash, replay) and runs `npm ci` plus a 26-package build in each. Copies made by git archive start with no `target/`, and the preflight deletes `CARGO_TARGET_DIR`.
- **perf.** perf keys its kept copies by worktree path, so every new session worktree starts both sides cold.
- **The `alone` block.** The unit lane's `alone` block runs 125 entries one at a time, 557 s in the recorded run.
- **Stryker.** Each mutant rebuilds all 26 packages.
- **The Spark.** 20 cores and 121 GB of memory, running nothing for a Mac session. 21 of the 27 crates build there.

## 3. Placement: what runs where

The Mac is the only machine whose results can count as budgets, and the only one that runs macOS and Metal. The Spark is Linux on aarch64 with most of the cores and memory. Placement follows from that:

| Work | Runs on | Why |
|---|---|---|
| Budgets, perf, timing gates | The reference Mac, in a budget window (section 12a) | A budget counts only on a reference Mac's fingerprint, at load below its cores |
| GPU, Metal and macOS-only tests | The Mac | The Spark has neither |
| Tests that reach a platform-branching source | The Mac, always, beside any Spark run | A Spark pass says nothing about the macOS branch (section 8) |
| The lint verdict | The Mac | A Spark lint record is a reading, never the lint verdict |
| Unit lanes, `cargo test`, proof lanes and Stryker for a Mac session | The Spark, by remote lane, once T7 and T8 land | Cores and memory, without loading the Mac |
| Docs-only changes | The Mac | Nothing to build |

A Spark `cargo test` is never PASS on its own: its record lists the tests absent by platform, by comparison with the Mac's reference list (`cargo test -- --list` per target, written into the Mac's evidence record), and the lane is INCONCLUSIVE (platform). First the whole workspace has to build and test on Linux aarch64 (T8): deep-app and its five dependents fail because `image` sits in deep-app's macOS-only dependencies while `picture()` uses it unguarded, `lsof` is hardcoded at its macOS path, and deep-hook's `O_NOFOLLOW` is the x86_64 value, so on aarch64 its symlink refusal does nothing.

## 4. Build reuse: fixed-path workspaces, not relocated targets

Moving a warm `target/` to a new path does not work: a target keeps the old path baked in through `CARGO_MANIFEST_DIR` and `CARGO_BIN_EXE_*` (21 files in 10 crates use them), so a relocated target would run the base's binaries against the change's tests. Instead the path stays fixed and the tree moves into it.

A **bay** is a fixed-path workspace, `~/deepbuild-bays/<k>/`, claimed in pairs: one bay for the base and one for the change. The Mac has one pair and the Spark three, claimed through the throttle's `bay pair` class (section 6), whose grant index names `<k>`. The rules:

- **Replaced in place.** Each use writes only the files whose bytes differ from disk, from the run's exact tree: a git archive of the tree hash, the bundle of uncommitted changes and the untracked non-ignored files, with all three hashes recorded. Files absent from the tree are deleted, and no mtime is ever backdated, so cargo and tsc see every change. Comparing blob IDs instead of bytes is a planted wrong program the tests show failing.
- **What stays.** Only `target/` and `node_modules/` are kept across runs. `.git` is recreated each run, with `alternates` to the root's common directory, and `packages/*/dist` is deleted before the workspace build.
- **One role each.** The base bay holds the merge base, plus the before lane's overlaid test paths; the change bay holds the change and, in turn, each twin. Crash and replay reuse the pair in the same roles. A bay never flips between base and change, and before every use it is replaced to that use's exact recipe, written into the record per use.
- **Its own target.** A bay build or test runs with `CARGO_TARGET_DIR` removed from its environment, so it always writes `<bay>/target`.
- **`undoBuild`.** In a bay, it skips `.git`, `target/` and `node_modules/`, and its copy-back skips files whose bytes match.
- **The seal.** At release, the bay records a stat listing (path, size, mtime in ns, inode) of all of `target/` and `node_modules/`, plus the tree hash. At claim, any mismatch deletes both and builds cold, and the record says so. `npm ci` is keyed on the lock file's bytes and a post-install marker.
- **Who gets one.** Only a proof rooted in a worktree of the machine's repository, with no ancestor holding a pair. `tests/proof.test.mjs`, the #569 scene proofs and other test-started proofs keep temporary copies. A lock holder's death releases its bay.

There is no fallback flag: rollback is reverting the PR.

### Trust boundary

Bays are weaker than today's proof lane, and equal to today's perf kept copies. A temporary checkout cannot carry anything from a previous run; a bay carries its `target/` and `node_modules/`, guarded by the seal. The record binds the sources, not the target. This replaces #569's "runs on the merge base in a temporary checkout" for the base copy, and the record names the bay's seal check so the weaker trust is visible on every verdict that used it. `bays.mjs` joins the guard's list of the proof lanes' own code from its first PR.

### Dependencies shared across worktrees: sccache, per machine

Twenty worktrees on the Spark each build the workspace cold into their own `target/`. What they can share, and what they can't:

- **Not a shared `CARGO_TARGET_DIR`.** One target directory for every worktree has the relocated target's flaw above, across branches: `target/debug/<bin>` is rewritten by whichever worktree built last, with `CARGO_MANIFEST_DIR` and `CARGO_BIN_EXE_*` pointing into it. `parity.mjs`, `agent-eval-run.mjs`, the `alone` block (section 7) and the 70–80 acceptance files that spawn `cargo` read `<worktree>/target/debug/<bin>`, which a shared target leaves empty; `DEEP_BIN_DIR` will cover a lane's own runs once T4 lands, and an acceptance file only once its blind redraft reads it. Cargo's target lock would also hold every worktree's build behind every other's, under the throttle. The preflight and the bays delete the variable for these reasons, and keep doing so.
- **sccache as the machine's `rustc-wrapper`.** A dependency from the registry or a git source compiles to the same bytes in every worktree: same source, same flags, same toolchain. sccache keys each `rustc` call on those and writes the cached artifact into the worktree's own `target/`. The workspace's crates compile incrementally, which sccache passes through, so each worktree's own crates and binaries are built in place and found where everything above reads them; `DEEP_BIN_DIR`, the bays and the throttle are untouched. The setting is the machine's, in `~/.cargo/config.toml`, never the repository's `.cargo/config.toml`: a machine without sccache would fail every build, and the reference Mac's budgets stay unwrapped. The Spark has run this since 2026-11-07, re-applied after the 2026-11-02 disk cleanup removed the line with the cache.

  ```toml
  [build]
  rustc-wrapper = "sccache"
  ```

  The cache, under `~/.cache/sccache`, is capped at 40 GiB in `~/.config/sccache/config` (sccache's own default is 10 GiB; the full dependency set in both the check and the codegen form needs more):

  ```toml
  [cache.disk]
  size = 42949672960
  ```

- **The server is the machine's, so start it as the owner.** Cargo's `sccache` calls are clients of one server per machine, which the first client starts with its own environment and which then serves every later client from that environment's `HOME`. On 2026-11-07 a test's child with a temporary `HOME` under a session's scratchpad started it: the machine's server then kept its cache in that scratchpad at the 10 GiB default, with the owner's config and warm cache unread. A server reads its config only at start. So after editing the config, and after any session could have started one, the owner stops and restarts it from a login shell, kept alive so no child's environment replaces it:

  ```
  sccache --stop-server; SCCACHE_IDLE_TIMEOUT=0 sccache --start-server
  ```

- **What defeats a hit: `CARGO_TARGET_DIR` in the environment.** sccache hashes every `CARGO_*` variable the compile sees, and cargo passes that one through. A build whose environment names a target directory misses on every crate, even the same worktree rebuilding the same leaf crate into a second directory; the `--target-dir` flag, which cargo doesn't export, is harmless. In this repository `perf.mjs`, `benchmark.mjs`, `api-surface.mjs` and `budget-window.mjs` set the variable, so their cold builds never hit and never seed; the bays delete it, so theirs do. The machine's counter read 9 Rust hits in 1,802 compiles between 22:36 and 23:00 on 2026-11-07, under the scratchpad server above; how much of that is the variable and how much is cold builds nothing had seeded needs the server's log (`SCCACHE_LOG`), a reading not yet taken.
- **Off where a build must be bare.** `RUSTC_WRAPPER=` (empty) in a child's environment is no wrapper, over the config, and `CARGO_BUILD_RUSTC_WRAPPER=` likewise; `tests/acceptance/1016` and `1017` set them for their cold builds. `594` is bare by pointing `CARGO_HOME` at an empty folder. `1117`–`1119` only delete the variable, so with the config in place their builds run under the wrapper, which changes how long a compile takes, never which crates compile, and their criteria count crates. cargo-mutants and cargo-semver-checks run under the wrapper like any build. Toggling the wrapper on a warm `deep-hook` build recompiled 0 units either way (a reading, 2026-11-07), so a warm worktree stays warm the day the setting lands.
- **Readings** (Spark, 2026-11-07, `cargo test --no-run -p deep-text-gpui`, 876 crates, each build into an empty target; 1-minute load 37–58 throughout, so the wall times are readings against each other, never budgets). 532 of each build's compiles are cacheable; the other 129 are binaries, proc-macros and the workspace's incremental crates.

  | Build | Target named by | Wall | Rust compiles from the cache |
  |---|---|---|---|
  | Two detached worktrees of one commit, the first then the second | in-tree `target/` | 73 s, then 56 s | 417 of 532 on the second |
  | Three real worktrees on three branches, two lockfiles | `CARGO_TARGET_DIR` in the environment | 85, 101, 91 s | 0 of 532 on each |
  | Two of those worktrees again, two branches, two lockfiles | `--target-dir` flag | 59 s, then 66 s | 411 of 532 on each |

  The 121 misses with the flag are the workspace's and `vendor/` crates and what depends on them, whose path is in their metadata hash. The two lockfiles differed by 13 added packages outside this closure, so a branch's lockfile drift costs only the crates it changes. `cargo clippy --all-targets -p deep-hook` took 7–8 s with or without the cache: its two crates are the workspace's own, with nothing to take. A first worktree pays nothing measurable for the wrapper: without it the small builds took 7, 8 and 18 s, as with it.
- **What stays.** Build scripts' runs, proc-macros, binaries, linking and the workspace's own crates are never cached, and they are most of what a cached build still pays. Each worktree still keeps its own `target/`, so section 9's rule on idle worktrees' targets still applies. The cache is itself what a disk cleanup may delete; the next build repopulates it, and a missing cache is never a failure.

## 5. Proof-run cost cuts inside one run

Once bays exist, most of a proof run's cost is work it repeats:

- **`npm ci` only when the lock changed** (T2). Per proof run it is 0 without a lock change, 1 when the change edits the lock, and 1 more in the base bay only when the merge base moved past a lock change. Stryker's `node_modules` relink walk is skipped in a bay.
- **perf's kept copies per machine** (T3). They are keyed per machine and clone, `deepbuild-perf/<machine>-<clone>/{base,without-tests}`, not per worktree path: every worktree of a clone shares them, and another repository on the machine, such as a test's fixture, gets its own. `<clone>` hashes the clone's git directory, and `<machine>` is the first label of the machine's name, which macOS and a router's DHCP extend with a domain that changes with the network (`.local`, `.attlocal.net`). They sit under one lock for the clone on the machine, taken only under the `timed` class, and their trees are replaced by the bays' byte-compare rule. The one rebuild left on the base side is deep-show and its dependents when the canvas-kit lane rewrote `kit-ledger.json` with different bytes, and the record names it.
- **Stryker scoped to the mutated package** (T6). Per mutant, build the mutated package and its dependents, read from the reverse workspace graph: `tsc -b packages/<p>` alone builds p and its dependencies, while tests read the dependents' `dist`. `undoBuild` still restores every touched source file. A planted scope that builds the mutated package without its dependents changes the kill set; the real scope leaves the killed and survived sets equal to an unscoped reference run's.

### Binaries for tests

Test binaries are built once per run into a run-private `bin/`, named by `DEEP_BIN_DIR` (T4). The before lane sets it per side from each bay's own build, so base and change never share binaries. `childEnv` drops an inherited value before it merges its `extra` argument, so a per-side value survives and a shell's value never leaks in. `lanes.mjs` and `affected.mjs` always set it from their own build, never from the shell. This is what lets folders leave the `alone` block (section 7).

## 6. Scheduling: a per-machine throttle table

Budgets refuse to count at a load above the core count, so two sessions proving at once turn each other's budgets INCONCLUSIVE. `scripts/throttle.mjs` (T5) is a host-local, flock-based lock table under `~/.deepbuild/throttle/` with four classes:

| Class | Mac | Spark | Holds |
|---|---|---|---|
| build | 1 | 2 | Top-level builds outside proofs: cargo build, `cargo test`, `npm run build`, clippy. The default for an unlisted command |
| bay pair | 1 | 3 | A counting semaphore whose grant index k names `~/deepbuild-bays/<k>/`; `bays.mjs` is its only caller |
| test | 2 | 4 | The vitest parallel block and `node --test` |
| timed | 1 | 1 | Exclusive of every class; waits for load below the core count |

`throttle.mjs <class> [--wait <min>] -- <command>` acquires, runs, releases and exits with the child's status, or 128 plus the signal when the child is killed. An importable `acquire(class)` and `release(grant)` serve `proof-runs.mjs`, `preflight.mjs` and `perf.mjs`. `lanes.mjs` wraps each of its commands by this classification, and `affected.mjs` routes its own commands the same way: the workspace build, clippy and `cargo test -p` as build, the vitest block and `node --test` as test.

- **Inherited grants.** A held grant is exported as `DEEP_THROTTLE=<class>:<id>`. Descendants pass through for build and test. timed never passes through, unless an ancestor holds timed. `DEEP_THROTTLE` is verified against the lock table, a live holder pid and the holder's place in the requester's parent-pid chain, never trusted; a forged one is ignored and a fresh grant is requested.
- **Drain.** A timed request stops new top-level grants, then waits for every holder outside its own chain to finish or to have a descendant blocked in a throttle wait. A bay-pair holder never counts as idle for a top-level timed request, and does for a nested one. Nested requests from current holders go before new top-level ones, so two chains that each hold a grant and each ask for timed both finish, in request order.
- **Measured runs.** `preflight.mjs` and `perf.mjs` claim timed before their timers start and hold it to the end, so a measured time contains no throttle wait. perf's lock is taken only under timed and accepts a lock held by an ancestor (`DEEP_PERF_LOCK=<pid>`, verified like `DEEP_THROTTLE`).
- **Tests that start a measured run.** A test that starts `perf.mjs` or `preflight.mjs` (or `tests/preflight.test.mjs`) from a copy of the whole `scripts/` folder, with the machine's own table, makes that request itself; inside an `affected.mjs` block it is nested under the block's test grant, and while it is pending no top-level grant on the machine starts, until the block's neighbours finish. Such a file is in `lanes.mjs`'s `timed` list, where the request passes through on the block's grant; `tests/takes-timed.test.mjs` finds them by reading the tree. A test with a HOME of its own has a table of its own, and a copy of `perf.mjs` with no `throttle.mjs` beside it takes no grant.
- **#1015.** Once `deep lease` runs in this repository, a timed drain also waits on `deep lease` holders on the machine. Until then #1015 leaves commands under this script alone, so the two never meet.

Each caller waits for its grant at most:

| Caller | Grant wait |
|---|---|
| A lane command | 30 min |
| timed inside a `proof-runs.mjs` spawn | 15 min |
| A measured run's top-level timed | 60 min |
| An `affected.mjs` job | 30 min |

On a timeout the first line is `INCONCLUSIVE no grant` and the exit is non-zero. A wait never eats into a run's own timeout: in the before and trace lanes the timed set spawns only after its grant, so after a 14-minute wait it still has its full 20-minute `TIMEOUT`.

`throttle.mjs` and `perf.mjs` join the guard's list of the proof lanes' own code, so a change to either needs a signed approval tag.

## 7. The `alone` block, split by reason

The `alone` block in `lanes.mjs` exists for three different reasons, and each gets its own treatment:

| Why a folder is alone | Share | Where it goes |
|---|---|---|
| A sibling's cargo build rewrites `target/debug/<bin>` under it | Up to 29 of 85 folders | The parallel block, reading its binary from `DEEP_BIN_DIR` (section 5) |
| A load or timing gate | 56 folders | The timed list (T9a), run only under a timed grant |
| A resource it shares, such as #236's shared sandbox log stream | Any folder sharing one, whatever its other reasons | Stays alone |

A folder moves only when its sole reason is the binary rewrite, and only after its wrong program fails in the parallel block, before it leaves `alone`. Roughly 70–80 acceptance files spawn `cargo` themselves. An acceptance test is never edited by the agent fixing the tooling, so each needs a blind redraft (AGENTS.md, Proof) before it can read `DEEP_BIN_DIR`. Those are separate small blind jobs; T4 lands the mechanism and moves only the folders whose files need no redraft or whose redraft has merged. For #1123, the owner subsequently requested one PR: independently drafted redrafts may instead land as separately reviewable adoption commits before the scheduling commit within #2321. This packaging exception retains the approval guard and every moved file's wrong-program-before-removal proof; it waives no acceptance criterion. On 2026-11-12 the owner also made Spark optional for #1123: its required proof is on the Mac, with any Spark or Linux run supplemental and labelled by its actual platform. This host exception changes no acceptance threshold or required Mac reading. On 2026-11-13 the owner moved two lines of #1123 from its acceptance criteria to its Proof, word for word: that the parallel block absorbs the folders, each moved file's wrong program failing there before it leaves `alone`, and that the alone block's wall time before and after is a reading. Saved output proves both, the reading taken on the folders that move through the unit lane's own two blocks on one commit; the trace lane reads the two criteria that remain, each with its tagged test.

### 7a. Shards, exclusive folders and slow files in `affected.mjs` (owner decision, 2026-11-07)

Measured over the last 80 merged PRs on 2026-11-07, `affected.mjs` took about 3.3 hours a PR on the Mac, at the fastest run recorded for each file. Three quarters of that was the `alone` block: a median PR selects 389 of its 1,047 files, run one at a time. The owner decided, to bring the average PR under 10 minutes, that until T4 and the blind redrafts land:

- **Shards.** The alone block's folders run side by side, each in a shard: a fixed-path workspace, `~/deepbuild-shards/<k>/`, holding the worktree's exact tree written in place by the bays' rule (section 4), its own `target/` kept across runs, and the worktree's `node_modules/` and package builds cloned copy-on-write each use. A folder still runs one file at a time, and only in one shard at once, so its files and its builds never meet another's: a sibling's cargo build rewrites `target/debug/<bin>` only in the shard it runs in. The shards run beside the parallel block, holding one test grant between them, and `DEEP_SHARDS` sets how many, half the cores by default. A shard is taken, new or reused, only while the disk holds 5 GB for it above #1017's 30 GB floor, since its tests' builds grow it; with none, the block runs in the worktree as before. A new shard's first builds compile the workspace crates its tests build at its own path: deep-hook and deep-show took 2.4 minutes and 3.4 GB, the whole workspace about 3.5 minutes and 6 GB.
- **Exclusive folders.** The folders whose reason is the machine itself, `lanes.mjs`'s `exclusive` list (#16's and #315's socket timing, #236's sandbox log stream), run after the shards, one at a time, in the worktree, with nothing beside them.
- **Slow files.** `lanes.mjs`'s `slow` list names the files whose fastest recorded run took over two minutes. `affected.mjs` leaves them, as it leaves the timed ones, unless `--slow` or the change adds or edits the file, and an unrun slow file makes the run INCONCLUSIVE, never PASS (invariant 2). The release preflight runs them all. The budget window runs none: it runs only the tasks of `benchmarks/budgets.json` (section 12a), so a budget criterion that only a slow or timed test judges is never the window's to prove, and its record lists it as unmeasured.

The trust a shard gives up is a bay's: it carries its `target/` from run to run, so its build is only as good as cargo's fingerprints. Lint scripts that build nothing run under no throttle grant, since in the build class they waited up to 30 minutes behind a neighbour's cargo build and ran nothing.

## 8. Remote lanes

`scripts/lane-remote.mjs --host spark-ts <lane>` (T7) runs a lane for a Mac session on the Spark:

- **Ship the exact tree.** A `git push` of the commit, a bundle of the uncommitted changes and a tarball of the untracked non-ignored files, plus the merge base computed on the Mac. The Spark sets its worktree's `refs/remotes/origin/main` to the shipped merge base and refuses the run, naming both, if the merge base it computes differs.
- **One Spark worktree per session**, `~/deepbuild/.claude/worktrees/<name>`, never relocated during its life. Proof lanes run from there into a Spark bay pair, under the Spark's throttle.
- **The record comes back.** It names the host, the platform, the tree hash, the bundle hash and, for composite trees, their recipe, in the evidence record every lane writes (T9b).
- **Merged per test.** A PR's unit verdict is the Spark run merged with a Mac `--only` run of the test IDs the Spark skipped, plus those that reach a platform-branching source: tests reaching `process.platform` sources, crates with `cfg(target_os)`, and platform-branching helpers. Any FAIL wins: a Spark FAIL and a Mac pass of one test ID merge to FAIL. The merged verdict must equal a full Mac run of the same tree.

### 8a. The x86_64 lane (#1983)

No x86_64 machine exists, so `node scripts/lane-x86.mjs` on the reference Mac is the other CPU architecture for CPU checks:

- **The host.** A linux/amd64 container of the Rust toolchain image of `rust-toolchain.toml`'s channel, pinned by its index digest in `scripts/lane-x86.json`. The pin is the full image, not the slim one, because it carries `git`: cargo 1.99 runs `git gc --auto` before each git fetch and starts its git database over when that can't run, so without `git` the cache never holds two commits of one repository (gpui-shell's quickjs-jit and the workspace's) at once, and an offline build there, such as #2012's run of Rapier's own tests, fails. The lane builds `deep-logic` there with `cargo build --locked`, the checkout mounted read-only and its caches under `target/lane-x86/`, then runs the golden's replay (`golden_verify` calls on stdin) in a second container with `--network none`. It never pulls: with no runtime, or no linux/amd64 image of the pin, its record is BLOCKED with one ask, naming `docker pull --platform linux/amd64 <image>@<digest>` for the image.
- **The record.** `~/.deepbuild/lanes/<tree>-x86_64.json`, #1115's fields plus `recording_machine` (the golden's machine), `lane_arch` (what the replay's own `deep-logic` reports), `host_arch`, `emulated`, `image_digest`, `network` (from the container's own interfaces), `bake_key`, Golden's `report` on FAIL and the `ask` on BLOCKED.
- **What counts.** logic.determinism `cross_machine` reads that record by tree and bake key: PASS only on a PASS record naming every field, on another architecture than the golden's and with no network; FAIL naming the step, item and field; BLOCKED with one ask without a record. A run on aarch64, natively or in a linux/arm64 container, reads `machines: same` and never passes. A reading taken in the lane is never a timing or a budget: logic.budget refuses each, naming the lane and `emulated: true`.
- **Merged as remote lanes merge.** `mergeRecords(tree)` in `lanes.mjs` takes the worst state of a tree's records and names the lanes holding it, so the lane's FAIL wins over the Mac's pass.
- **What emulation proves.** Our code compiled for x86_64 gives the same bits as the arm64 build; not real x86 hardware, and timings there mean nothing. A real x86_64 host that writes the same record with `emulated: false` replaces the container without changing any check that reads it.

## 9. Hygiene (do first, no design needed)

The baseline's load and swap make every budget INCONCLUSIVE, and no tooling change can be measured on top of them. T0 cleans up first, with readings only: no script, option or config key.

- Prune worktrees whose branches are merged, down to those with open PRs, on the Mac and the Spark alike.
- Delete `target/` in worktrees idle more than three days. Worktrees on open branches with large targets are listed for the owner, never deleted by an agent.
- Remove orphaned proof-run copies under the temp directory whose creating process is gone, checked by PID, never by name.
- At most three resident sessions on the Mac, one of them proving.
- Free disk before and after is a reading. One bay pair on the Mac needs about 40 GB.

The bar is the Mac idle (no cargo, vitest or proof running) under 50% of swap used and under a 1-minute load of 8, read three times five minutes apart, with no worktree on an open branch and no uncommitted edit removed.

## 10. Issue shaping

Each step is one issue and one PR, following AGENTS.md:

- **Under about 400 handwritten lines.** A step that would pass it splits: T9 became T9a (the timed list and its routing) and T9b (skip states and the evidence record).
- **`Runs on:`** names the machines a step's proof needs: Mac, Spark, or both.
- **Criteria are measured, and wall time is a reading.** Each criterion is a behavior a test or a saved output proves. Each tooling test runs on real processes and real bays, and shows its planted wrong program failing first: a wrapper that exits 0, a timed grant that passes through, a trusted `DEEP_THROTTLE`, a blob-ID comparison, a relocated target, a trusted seal, a copy that keeps the previous use's overlay. Speed-ups are readings, before and after on one commit, never criteria, since they depend on the machine's load.
- **Guarded files carry a signed tag.** A step that adds to or changes the proof lanes' own code, `lanes.mjs`, a file the guard reads, or a key the guard protects, carries a signed approval tag naming its files. Each new tooling script that decides a verdict (`bays.mjs`, `throttle.mjs`, `perf.mjs`, `affected.mjs`, `budget-window.mjs`) joins the guard's list in the PR that adds or first guards it.
- **Failures on main stay as they are.** A step that changes how a lane reads results lists the FAIL IDs on main before and after, and they match.
- **No option, flag or fallback** beyond what a step names; rollback is reverting its PR.

### 10a. Owner decision (gates T9)

Two questions for the owner, asked once, gate T9b. Before T9b lands, a run of the unit lane on main lists every pass the new skip rule turns INCONCLUSIVE, with its skip site, and that list goes to the owner with these questions.

**Answered on 2026-11-06: (a) on both.** The `skips` list holds seven BLOCKED-by-design tests, in `380/cts-exact`, `39/app.live`, `45/baseline` and `45/classify`. It holds no reading-only skip. Each site is in a timed file or carries a criterion tag, except the three in `160/budgets.test.ts`, whose notes hold a measurement that changes every run, so a full note can't key them.

1. **An approved BLOCKED-by-design test.** `380/cts-exact.test.ts` skips with `BLOCKED: no record from an M1 …` unless `DEEPBUILD_M1_RECORD` is set.
   - **(a, recommended)** A `skips` entry may list an approved BLOCKED-by-design test. The lane keeps the state its other tests give, and every summary prints the listed BLOCKED test.
   - **(b)** The lane stays BLOCKED until the record exists.
2. **Reading-only skips.** About 218 skip sites, many of them `ctx.skip('INCONCLUSIVE (reading only)…')`.
   - **(a, recommended)** A reading-only skip is listable, keyed on its test ID and its full note. It is never listable for a file in the timed list or a test carrying a criterion tag.
   - **(b)** Each makes its lane INCONCLUSIVE when it fires.

Whatever the answers, a skip is unrun and never PASS (invariant 2): an unlisted skip makes its lane INCONCLUSIVE, one whose note starts with BLOCKED makes it BLOCKED, and platform and GPU skips are never listed and leave the lane INCONCLUSIVE (platform). A change to the `skips` key of `scripts/known-failures.json` needs a signed approval tag, and so does an entry added to any other key, or changed there in any way but a `lint` count that falls, while a removed entry or a lowered count needs none; the approver, not a parser, confirms that a gate is an opt-in variable or a retirement.

Each lane writes its evidence record to `~/.deepbuild/lanes/<tree>-<lane>.json`: the lane, its state, the host, the platform, the tree hash and each test's ID, state and note, with `skipped` on a test that never ran. The tree hash is of what is on disk, uncommitted and untracked files too, so a clean checkout's is `HEAD^{tree}`.

## 11. Invariants

The four invariants of AGENTS.md, as the tooling keeps them:

1. **An agent's word is never evidence.** `DEEP_THROTTLE`, `DEEP_PERF_LOCK`, a bay's seal and a shipped merge base are each verified, never trusted. A remote lane's verdict is its evidence record, fetched back, not the Spark's summary line.
2. **Nothing missing or unrun passes.** A skip, a missing grant, a platform-absent test and a budget at a load above the cores are each INCONCLUSIVE or BLOCKED, never PASS, and a commit the budget window has not yet measured leaves its issue open. A Spark lint record is a reading. A merged unit verdict takes any FAIL.
3. **Agents can't change checks or decisions.** Each tooling script that decides a verdict joins the guard's list, so its change needs a signed approval tag. Agents never run or edit the budget window. Acceptance files are redrafted blind, never edited to read `DEEP_BIN_DIR`.
4. **A person sees only what needs a person, and never the same question twice.** The owner is asked the two questions of section 10a once, with the list that answers what they change. Large worktrees on open branches are listed for the owner, never deleted by an agent.

And for the machine: processes are stopped only by the PID that started them, never by name or port; no hooks go into a repo's settings; nothing runs on push or pull request.

## 12. Rollout, and proof of each step

Each step lands as its own issue, in this order of dependencies, with one criterion that shows it works:

| Step | Issue | Depends on | Criterion that shows it works |
|---|---|---|---|
| TD | #1111 | none | This page exists and every link from T0–T10 lands on a heading; budgets are measured in the scheduled budget window |
| T0 | #1112 | none | The idle Mac is under 50% swap and a load of 8, read three times |
| T5 | #1113 | TD, T0 | No top-level timed grant starts at a load above the cores, by the throttle log |
| T1 | #1117 | T5, T0 | A second run of the same tree in a bay compiles 0 crates |
| T2 | #1118 | T1 | `npm ci` per proof run is 0 without a lock change |
| T3 | #1119 | T5, T1 | A perf run from a second worktree compiles 0 crates on its base side |
| T6 | #1120 | T2 | Scoped Stryker's killed and survived sets equal an unscoped reference run's |
| T9a | #1114 | T5 | Timed files run only under a timed grant, and without `--timed` the summary is INCONCLUSIVE, listing them |
| T9b | #1115 | T9a, section 10a | An unlisted skip makes its lane INCONCLUSIVE, not PASS |
| T4 | #1123 | T2, the blind redrafts | Each moved folder's wrong program still fails in the parallel block |
| T8 | #1121 | T9b | 27 of 27 crates build on the Spark, and its `cargo test` is INCONCLUSIVE (platform), not PASS |
| T7 | #1122 | T8, T9b, T1, T2 | A PR's merged unit verdict equals a full Mac run on the same tree |
| T10 | #1116 | TD, T5, T9a, T9b | Three commits merged between windows get three records, each against its own merge base |

T9 is one design step split in two issues to stay under 400 lines: T9a names the timed tests and routes them through the throttle, and T9b holds the skip rules and the evidence record.

### 12a. Budget windows (owner decision, 2026-11-02)

Agents run day and night, so no idle period exists for budgets, and a per-PR budget queue was the efficiency bottleneck. The owner decided on 2026-11-02 that budgets leave the PR's path but stay tied to each commit. [How we know version 0 works](technical-design.md#how-we-know-version-0-works) says so: each issue's budgets are measured on a reference Mac by a benchmark in the scheduled budget window, compared with the merge base, with the samples, margins and reference Macs it sets.

- **The window.** A few times a day `throttle.mjs` opens a budget window on each reference Mac: it stops granting build, test and bay pair, lets running grants finish, runs `scripts/budget-window.mjs`, then reopens. Agents keep thinking and editing; only their next build or test waits. `throttle.mjs window [--wait <min>]` is a top-level timed grant with a measured run's 60-minute wait that takes no holder as waiting, so every slot empties, and a caller's grant wait doesn't run down while a window is pending or open. The throttle log marks it with `window-open` and `window-close`.
- **What starts it.** A schedule on each reference Mac, in a checkout of main that no session works in, such as this crontab line. It is installed by hand, and only there: a window elsewhere drains the machine for readings.

  ```
  0 3,9,15,21 * * * zsh -lc 'cd ~/doneright && node scripts/throttle.mjs window' >> ~/.deepbuild/budget-window.log 2>&1
  ```

- **What it measures.** Every commit merged since the last window, each against its own merge base, 20 samples a side, with each issue's budget numbers unchanged. A commit merged during a window is measured in the next one. Merged means on the first-parent line of `origin/main`. A merge commit is measured by its branch tip against `git merge-base` of its parents, so a branch never answers for what landed on main beside it; a commit with one parent, against that parent. The window judges the tasks of `benchmarks/budgets.json` as perf does, and for each commit only those that reach a file the commit changed, by the selection `scripts/affected.mjs` makes for tests. A task the selection can't place, or marks wide, runs on every commit; one the commit can't reach isn't run, and the commit's record lists it as not reached, never PASS. The window has no cap on its length, since a commit longer than a cap would never be measured. A mark under `~/.deepbuild/budget-window/` says how far it got and moves only past a commit it recorded, so a window that dies loses nothing. The first window on a machine only sets the mark. Any record moves it: an INCONCLUSIVE commit isn't measured again, and its issue stays open with the reason on the record.
- **What it records.** One evidence record per commit, in T9b's record shape, with `commit` and `base` added, and `unmeasured`: the unticked criteria of the commit's issues that no task names. Each task of `benchmarks/budgets.json` names the criteria it proves, as `criteria`, a list of criterion IDs (`#<issue>.<h8>`, the trace lane's), and only a task's numbers are frozen once main has it, so naming one is no change to its budget. A pass closes that commit's issue only on criteria it measured: the issue has a `### Acceptance criteria` section, at least one line under it is unticked, and a task names each unticked line, so a `Part of #n` merge ticks the others. An unticked criterion no task names keeps the issue open and is named in the record as unmeasured, whatever its words: a budget only a timed test judges, or a line that says "in the local preflight" and is no budget. An issue with no such section, such as an umbrella, is never closed by the window. A miss leaves the issue open, naming the regression and the commit, and files a budget follow-up. A commit not yet measured leaves its issue open, never closed, so a pass leaves the issue open while a later commit of it waits in the same window. A load at or above the cores during a task makes that task INCONCLUSIVE.
- **PRs.** A PR whose issue has reference-Mac budget criteria merges as `Part of #n` on its other criteria; the window proves the rest.
- **Who runs it.** Agents never run or edit the window. `budget-window.mjs` joins the guard's list, so a change to it needs a signed approval tag.

**Reading rule.** An existing budget criterion that says "in the local preflight" is met by the scheduled budget window's record for its commit, once a task of `benchmarks/budgets.json` names it (#1874). On 2026-11-02, 258 open issues carried that phrase, 238 times in the criterion lines of 236 of them (not all of those are budgets; the rule reads only the budget ones), and several already have tagged tests, such as the budget tests under `tests/acceptance/104`, `159`, `331` and `365`. A criterion's ID is the hash of its normalized text, so rewording those lines would change their IDs and break the tags that prove them. Their text stays as written, and this rule reads it.

### 12b. Main is watched (#1333)

Nothing else runs after a merge, so `scripts/main-watch.mjs` does, on the run's host, in a checkout of main that no session works in:

```
0 * * * * zsh -lc 'cd ~/doneright && node scripts/main-watch.mjs tick' >> ~/.deepbuild/main-watch.log 2>&1
```

- **When.** A tick runs the unit and lint lanes of main's head, from that head's own `lanes.mjs`, once 5 landings reached main or 6 hours passed since its last run, and at every tick while landings are paused. A landing is a commit on main's first-parent line. Its lanes go through `runLanes`, so the throttle and `deep lease` hold them like any other. It calls no model and starts no hosted workflow.
- **A new failure** is one `known-failures.json` doesn't list. It runs again alone, up to three times. One that passes on a repeat reads INCONCLUSIVE and is filed once, with its runs, and nothing pauses. One that holds pauses landings and is bisected, running only that test, over the landings since the last clean run, which names the landing and its issue.
- **Recovery.** A pull request reverts that landing. It is merged once the failing test passes on it and nothing that passed on main fails there, and then the issue reopens naming the failure and landings open again. A revert that conflicts or doesn't clear main starts an attempt on the issue, a headless `claude` or `codex` run. Only once that attempt has ended with main still red is a person asked, once, by an issue titled `Ask: …`.
- **The gate.** `node scripts/main-watch.mjs status` prints `landings open` (exit 0) or `landings paused: …` (exit 1) from the job's state under `~/.deepbuild/main-watch/`, without fetching. The landing queue (#1331), and anyone landing by hand, reads it first.
- **Listed failures lapse.** Each `failures` entry of `known-failures.json` ends `(#<issue>, added <YYYY-MM-DD>)`. The lint lane's `scripts/known-failures-check.mjs` fails an entry that names no issue, names one that isn't open, or was added more than 14 days ago.

## 13. Capacity

What each machine holds at once, with the throttle and the bays in place:

| | Mac | Spark |
|---|---|---|
| Resident sessions | At most 3, one of them proving | One worktree per remote session |
| build grants | 1 | 2 |
| test grants | 2 | 4 |
| Bay pairs | 1, about 40 GB of disk | 3 |
| timed | 1, exclusive of everything; budgets count only in a budget window on a reference Mac | 1, exclusive of everything; its timings are readings |

A session waiting for a grant keeps thinking and editing; only its next build, test or proof waits. When the Mac's single bay pair is held, a second Mac session's proof waits for it or runs on the Spark by remote lane. The limits are the starting values T5 sets; a change to them is a change to `throttle.mjs` and needs a signed approval tag.
