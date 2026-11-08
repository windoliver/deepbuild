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
| A run of `perf.mjs` or `preflight.mjs` from a copy of `scripts/` on the machine's table, which claims timed for 60 minutes and, inside a block's test grant, drains the table for every session | The files `tests/timed-list.test.mjs` finds | The timed list, where the claim passes through on the block's grant |
| A resource it shares, such as #236's shared sandbox log stream | Any folder sharing one, whatever its other reasons | Stays alone |

A folder moves only when its sole reason is the binary rewrite, and only after its wrong program fails in the parallel block, before it leaves `alone`. Roughly 70–80 acceptance files spawn `cargo` themselves. An acceptance test is never edited by the agent fixing the tooling, so each needs a blind redraft (AGENTS.md, Proof) before it can read `DEEP_BIN_DIR`. Those are separate small blind jobs; T4 lands the mechanism and moves only the folders whose files need no redraft or whose redraft has merged.

## 8. Remote lanes

`scripts/lane-remote.mjs --host spark-ts <lane>` (T7) runs a lane for a Mac session on the Spark:

- **Ship the exact tree.** A `git push` of the commit, a bundle of the uncommitted changes and a tarball of the untracked non-ignored files, plus the merge base computed on the Mac. The Spark sets its worktree's `refs/remotes/origin/main` to the shipped merge base and refuses the run, naming both, if the merge base it computes differs.
- **One Spark worktree per session**, `~/deepbuild/.claude/worktrees/<name>`, never relocated during its life. Proof lanes run from there into a Spark bay pair, under the Spark's throttle.
- **The record comes back.** It names the host, the platform, the tree hash, the bundle hash and, for composite trees, their recipe, in the evidence record every lane writes (T9b).
- **Merged per test.** A PR's unit verdict is the Spark run merged with a Mac `--only` run of the test IDs the Spark skipped, plus those that reach a platform-branching source: tests reaching `process.platform` sources, crates with `cfg(target_os)`, and platform-branching helpers. Any FAIL wins: a Spark FAIL and a Mac pass of one test ID merge to FAIL. The merged verdict must equal a full Mac run of the same tree.

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

Whatever the answers, a skip is unrun and never PASS (invariant 2): an unlisted skip makes its lane INCONCLUSIVE, one whose note starts with BLOCKED makes it BLOCKED, and platform and GPU skips are never listed and leave the lane INCONCLUSIVE (platform). A change to the `skips` key of `scripts/known-failures.json` needs a signed approval tag; the approver, not a parser, confirms that a gate is an opt-in variable or a retirement.

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

- **What it measures.** Every commit merged since the last window, each against its own merge base, 20 samples a side, with each issue's budget numbers unchanged. A commit merged during a window is measured in the next one. Merged means on the first-parent line of `origin/main`. A merge commit is measured by its branch tip against `git merge-base` of its parents, so a branch never answers for what landed on main beside it; a commit with one parent, against that parent. The window judges the tasks of `benchmarks/budgets.json` as perf does. A mark under `~/.deepbuild/budget-window/` says how far it got and moves only past a commit it recorded, so a window that dies loses nothing. The first window on a machine only sets the mark. Any record moves it: an INCONCLUSIVE commit isn't measured again, and its issue stays open with the reason on the record.
- **What it records.** One evidence record per commit, in T9b's record shape, with `commit` and `base` added. A pass closes that commit's issue when its other criteria are already proven: every line under `### Acceptance criteria` is ticked, except the budget criteria, so a `Part of #n` merge ticks those it proved. A miss leaves the issue open, naming the regression and the commit, and files a budget follow-up. A commit not yet measured leaves its issue open, never closed, so a pass leaves the issue open while a later commit of it waits in the same window. A load at or above the cores during a task makes that task INCONCLUSIVE.
- **PRs.** A PR whose issue has reference-Mac budget criteria merges as `Part of #n` on its other criteria; the window proves the rest.
- **Who runs it.** Agents never run or edit the window. `budget-window.mjs` joins the guard's list, so a change to it needs a signed approval tag.

**Reading rule.** An existing budget criterion that says "in the local preflight" is met by the scheduled budget window's record for its commit. On 2026-11-02, 258 open issues carried that phrase, 238 times in the criterion lines of 236 of them (not all of those are budgets; the rule reads only the budget ones), and several already have tagged tests, such as the budget tests under `tests/acceptance/104`, `159`, `331` and `365`. A criterion's ID is the hash of its normalized text, so rewording those lines would change their IDs and break the tags that prove them. Their text stays as written, and this rule reads it.

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
