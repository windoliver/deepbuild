# Acceptance tests for #3239: a budget's own builds turn the compile cache off themselves

I drafted these tests blind from these sources only:

- issue #3239 (`gh issue view 3239` showed the body this job was given). It asks for an owner decision and recommends
  option (a), the four scripts set `RUSTC_WRAPPER` empty for every cargo they start. Its body records no answer. Its
  criteria are written for (a), and these tests rest on those criteria, not on a decision. This job's brief said the
  owner had decided (a); the session that wrote the brief has withdrawn that. I read the issue's one comment
  (2026-11-23T09:19:47Z) only for this correction, after the tests were written: posted through the owner's account and
  signed as written by an agent, it is headed as the owner's decision, takes a general instruction it quotes as (a), and
  says itself that this is no separate, explicit answer to the question. I haven't verified the quote.
- `docs/parallel-proof.md`, section 4 (Build reuse; in particular "Dependencies shared across worktrees: sccache, per
  machine" and "Off where a build must be bare"), section 6 (the throttle's timed grant and the window) and section 12a
  (Budget windows); `docs/technical-design.md` (Dogfooding; How we know version 0 works). `node
  scripts/design-section.mjs --issue 3239` printed the two linked sections.
- AGENTS.md
- the base commit `f8c6cff82` (origin/main), which has no implementation. There I read `scripts/perf.mjs`,
  `budget-window.mjs`, `benchmark.mjs`, `preflight.mjs`, `throttle.mjs`, `lease`, `lanes.mjs` (the `unit` lane,
  `runLanes`, `reporting`, `testsOf`, `reportResults`), `lanes-lists.mjs`, `affected.mjs`, `known-failures.json`,
  `checks.mjs`, `bays.mjs`'s exports, `wait-ratchet.mjs`, `rust-toolchain.toml`, `.cargo/config.toml`,
  `tests/takes-timed.test.mjs`, and `tests/acceptance/2665/`, `1116/`, `1874/`, `3137/`, `1016/` and `1017/` for their
  shape.

The helpers are written here; nothing is imported from another suite. The tests reach the four scripts only by running
them. AC3 imports `scripts/lanes.mjs`'s public entry to run and read tests the way the unit lane does. Per AGENTS.md, the
implementing agent doesn't edit these tests. A dispute goes to a blind redraft by this job.

## Criteria and tests

Each criterion's ID is `#3239.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space
collapsed>`, as `criterionId` in `scripts/proof-change.mjs` and `scripts/budget-window.mjs` works it out. Each test's
name starts with its tag and its `AC<n>`.

| Criterion | ID | Test (file) | What it requires |
|---|---|---|---|
| AC1: With a test's own cargo home whose config names a wrapper that logs each call, a build each of the four scripts starts logs none. On the merge base it logs every compile. A planted script that sets the variable for its first cargo only fails, naming the second | `#3239.ce662817` | `ac1-bare-builds.test.mjs` | Each of the four scripts, run in its own sandbox, starts at least one cargo build. Those builds compile units into their target folders, and the wrapper logs no call from any cargo the script started. A cargo build started outside the script afterwards, in the same sandbox, still logs its compiles. Each finding names the script, the cargo's place in the order it started them (`its cargo 2 of 2`), its arguments and folder, and what the wrapper logged from it |
| AC2: The same wrapper logs a call for each compile of a `cargo build` started outside the four scripts, so the fixture tells the two apart | `#3239.9d1b4fd0` | `ac2-outside-build.test.mjs` | In the same fixture as AC1, which carries the checkout's own cargo `[build]` settings, `cargo build --workspace --locked --message-format=json` started by the test compiles at least the fixture's two crates. The wrapper logs a compile for each unit cargo's report names as compiled (`compiler-artifact`, `fresh: false`), by crate name |
| AC3: The FAIL IDs of the unit lane on main are the same before and after | `#3239.cb760c49` | `ac3-unit-lane.test.mjs` | The unit lane's own `node --test` files for the four scripts (below) run on this checkout as the lane runs and reads them. Their FAIL IDs equal main's known failures for those files, as the merge base's `scripts/known-failures.json` lists them: none added, none gone. No test is BLOCKED or INCONCLUSIVE, and every file reports a test |
| AC4: Section 4 states the rule | `#3239.cd5b51c3` | `ac4-design.test.mjs` | `docs/parallel-proof.md` section 4 at this checkout has a paragraph or bullet that names `RUSTC_WRAPPER` with `perf.mjs`, `budget-window.mjs`, `benchmark.mjs` and `preflight.mjs` and says it is empty. It also has a sentence naming the reference Mac, "may" or "can", and the cache, sccache or the wrapper |

The **reading, not a criterion** (section 4's table for a Mac with the cache) has no test. It needs the owner's cache on
a Mac.

## How each criterion is read (my choices where the issue leaves them open)

### AC1

- **"A test's own cargo home"** is a `CARGO_HOME` folder in the test's sandbox. Its `config.toml` holds
  `[build] rustc-wrapper = "<sandbox>/log-wrapper"`, as section 4 has a machine's `~/.cargo/config.toml` name sccache.
  The wrapper appends one line per call (the cargo that called it, the crate after `--crate-name`, the tool) and then
  runs the call. A compile is a call naming a crate. Cargo's own probes (`rustc -vV`, and `___` for the target's file
  names) are calls too.
- **"Logs none"** is strict. No wrapper call of any kind may come from a cargo the script started. With `RUSTC_WRAPPER`
  empty, cargo never starts the wrapper, probes included.
- **Which cargo a call came from.** A `cargo` first on `PATH` in the sandbox appends one line per call: its process ID,
  folder, `RUSTC_WRAPPER`, `CARGO_BUILD_RUSTC_WRAPPER` and `CARGO_TARGET_DIR` as given, and its arguments. It exports
  its process ID as `T3239_CARGO` and becomes the pinned toolchain's real cargo with `exec`. cargo passes the variable to
  the wrapper, including through `cargo clippy`'s inner `cargo check`. It changes no argument and no other variable.
- **"A build each of the four scripts starts."** Every cargo started while the script runs, by the script or by what
  it starts. That covers the warm-up builds (`benchmark.mjs`'s `warm`, which `prepareCopy` and the preflight call), the
  check workload the preflight and perf time, and a budget task's own command that builds with cargo, as
  `benchmarks/canvas.mjs` and `physics.mjs` do. Each script runs in a fixture as it starts on a machine:
  - **`scripts/benchmark.mjs`** is a module that other scripts import (perf, the window, the preflight, and also
    `release-budgets.mjs`). Its own cargos are `warm()`'s: `cargo test --workspace --locked --no-run`, then
    `cargo clippy --workspace --all-targets --locked -- -D warnings`. A two-line driver imports the fixture's copy and
    calls `warm(<fixture>)`, with no other script in the process. So the module answers for its own cargos, whatever
    its importers set.
  - **`scripts/perf.mjs`**: `node scripts/perf.mjs '<observation>'` in the fixture, with a passing observation, as the
    preflight hands it. It builds its merge-base copy (`prepareCopy`, so `warm`), times the copy's check workload, and
    judges the fixture's one task on both sides.
  - **`scripts/budget-window.mjs`**: `node scripts/throttle.mjs window --wait 5` in a clone of the fixture's origin, as
    the schedule starts it. A first window marks main. Then one commit lands (a comment line in `Cargo.toml`, a file
    every task reads, so the task runs whatever `affected.mjs` can place). The next window builds both sides
    (`prepareCopy`) and judges the task.
  - **`scripts/preflight.mjs`**: `node scripts/preflight.mjs` in the fixture: its warm-up builds, its timed check
    workload, then perf through `scripts/lease`.
- **The fixture** is a git repository with a bare `origin`, holding this checkout's `scripts/` folder whole. Its
  `scripts/checks.mjs` is replaced by the fixture's check workload, one `cargo build --workspace --locked --profile
  checks`, standing in for the check lanes' builds: the real lanes run the whole repository's suites. It holds a
  two-crate workspace (`fixture-core`, a library, and `fixture-app`, a binary using it), with no registry dependency, so
  nothing is fetched. It has a hand-written `Cargo.lock`, `rust-toolchain.toml` with the checkout's channel, and
  `benchmarks/budgets.json`. That file holds a `preflight` budget and one task, `fixture-build`:
  `["node", "bench.mjs"]`, which runs `cargo build --locked --release -p fixture-app`, with empty limits, so it runs
  only `measure`'s rounds. Profiles `checks` and `outside` keep those builds cold.
- **"On the merge base it logs every compile"**: on the base, every build cargo each script starts logs its compiles
  (`BASE-FAILURE.txt`), and the test fails, naming each.
- **"A planted script that sets the variable for its first cargo only fails, naming the second"**: twin
  `first-cargo-only`, a `benchmark.mjs` whose `warm()` empties the variable for its first cargo (`cargo test`) only.
  The test fails, naming `scripts/benchmark.mjs: its cargo 2 of 2, \`cargo clippy …\``.
- **A silence that proves nothing is a failure too.** A script that starts no cargo build fails. So does a target
  folder its builds named that holds no compiled unit (cargo's fingerprints) after the script ends. So does an outside
  build afterwards, in the same sandbox, that logs no compile: a script that turned the wrapper off for the machine
  rather than for its own cargos fails here.

### AC2

- **"The same wrapper"** is AC1's sandbox and fixture: the same cargo home, wrapper and `PATH`. **"A cargo build
  started outside the four scripts"** is one the test starts itself in the fixture's checkout.
- **"For each compile"**: each unit cargo's JSON report names as compiled (`reason: compiler-artifact`, `fresh:
  false`) has a wrapper compile line from that cargo with its crate name. The match is by multiset, so two units of one
  crate need two lines.
- **The checkout's cargo settings.** The fixture's `.cargo/config.toml` holds the `[build]` table of the checkout's
  `.cargo/config.toml`, if it has one (the base has none). Its `[patch]` tables name sources the fixture doesn't have.
  So a change that turns the wrapper off for every build in the repository, instead of for the four scripts' builds,
  fails AC2. Twin `repo-wide-off` fails AC1 too, at the build started outside each script: in that run no cargo a script
  started ran under the wrapper, and no outside build logged a call (`TWINS-RUN.txt`).
- **The base is not a wrong program for AC2**: it passes (`BASE-FAILURE.txt`). Twin `repo-wide-off` (the checkout's
  `.cargo/config.toml` with `[build] rustc-wrapper = ""`) fails it, naming the units the wrapper didn't log
  (`TWINS-RUN.txt`).

### AC3

The issue doesn't say which surface "the unit lane on main" is, and the whole lane takes hours (its alone block is
about 7 h serial). I chose the least surface its words support:

- **"The unit lane"** is `lanes.mjs`'s `unit` lane. Of its commands, the test takes its `node --test` block
  (`tests/!(*.live).test.mjs`; the test fails if the lane no longer has it). From that block it takes the files named
  for the four scripts: `tests/<perf|budget-window|benchmark|preflight>[-…].test.mjs`. It drops those `lanes.mjs` lists
  as `timed`, `slow` or `byHand`. At the base the files left are `tests/perf.test.mjs`, `tests/budget-window.test.mjs`,
  `tests/preflight-selection.test.mjs` and `tests/preflight-exclusion.test.mjs`. `tests/benchmark.test.mjs` and
  `tests/preflight.test.mjs` are on the timed list: they take the machine's timed grant, which a test must not start.
  No vitest file of the lane outside `tests/acceptance/` names the four scripts. The vitest budget files that import
  `benchmark.mjs` are timed budgets on the reference Mac.
- **"On main … before"** is main's own record of the lane's failures: `scripts/known-failures.json`'s `failures`, as
  the merge base (`git merge-base HEAD origin/main`) holds it, restricted to those files. **"After"** is a run of the
  files on this checkout, through `lanes.mjs`'s `reporting` (the lane's reporter, `scripts/proof-reporter.mjs`) and
  `testsOf`/`reportResults`, as the unit lane reads them. A FAIL ID is a failure whose state is `FAIL`.
- **"The same"**: no FAIL ID the merge base doesn't list, and no listed one that passes. A test that proved nothing
  (`BLOCKED`, `INCONCLUSIVE`) fails the test, as does a file that reported no test.
- **The run's environment.** `HOME` is a folder of the run's own, so nothing reaches the machine's throttle table. Each
  node process reads a pinned 1-minute load of 2: `tests/perf.test.mjs` takes a top-level timed grant in its own
  table, and the throttle waits for a load under the cores, which a shared Mac at 20–110 rarely has.
- **What this leaves out**: the timed files above, the vitest and cargo blocks, and the acceptance suites that read the
  four scripts. They run in the implementer's `node scripts/affected.mjs` run under a timed grant, which AGENTS.md's
  Proof asks for anyway. Its FAIL lines are the rest of this criterion.
- **The base is not a wrong program for AC3**: before and after are the same tree, and the base run passed. It printed no
  counts. The counts come from the throwaway's run at the same merge base: 24 tests passed in the four files, and main
  lists none of them (`BASE-FAILURE.txt`). Twin `requires-caller` (a `perf.mjs` that refuses to run unless its caller
  emptied the variable) fails it, naming the new FAIL IDs (`TWINS-RUN.txt`).

### AC4

- **"Section 4"** is `docs/parallel-proof.md` from its `## 4.` heading to the next `## ` heading, with its `###`
  parts.
- **"The rule"** is what the issue's Design line says section 4 states: "that a budget is bare by the script's setting
  and that a reference Mac may run the cache". The test reads two things, and the base has neither:
  - **Bare by the script's setting**: one paragraph or bullet that names `RUSTC_WRAPPER` and the four scripts' file
    names, and says it is empty (the word "empty", or `RUSTC_WRAPPER=` followed by no value).
  - **A reference Mac may run the cache**: one sentence naming the reference Mac, "may" or "can", and the cache,
    sccache or the wrapper.
- Wording beyond that is free. The base's sentence "the reference Mac's budgets stay unwrapped" may stay or go.

## The sandbox and the stand-ins

All at boundaries the repository doesn't own, as 1116's and 2665's are:

- **`HOME`**, `XDG_CACHE_HOME`, `XDG_CONFIG_HOME`, `TMPDIR` and `CARGO_HOME` are folders of the sandbox. A throttle
  grant or window started under `node --test` keeps its table under that `HOME` (section 6, a test's own table), so it
  never drains the machine's. perf's kept copies, the window's copies, marks and records, and the count library all
  live there. `RUSTUP_HOME` stays the owner's (the password database's home, `~/.rustup`), with `RUSTUP_TOOLCHAIN` the
  checkout's channel and `RUSTUP_AUTO_INSTALL=0`, so no toolchain is downloaded.
- The sandbox unsets every `CARGO_*`, `RUSTC*`, `RUSTUP_*`, `RUSTFLAGS`, `GIT_*`, `DEEP_*`, `XDG_*` and `SCCACHE_*`
  variable, `NODE_TEST_CONTEXT`, `NODE_OPTIONS`, `MAKEFLAGS`, `MFLAGS` and `PWD` it was given. So the only wrapper
  setting a cargo sees is the script's own. `GIT_CONFIG_NOSYSTEM=1`.
- **`PATH`** is the sandbox's stand-ins, the pinned toolchain's own `bin` (from `rustup which --toolchain <channel>
  cargo`), node's folder, then `/usr/bin:/bin:/usr/sbin:/sbin`. The user's other folders are left out, so no `deep` or
  `sccache` of theirs is found.
- **`cargo`**: the logging cargo above, which becomes the real one.
- **`npm`** exits 0: the fixture has no packages. **`gh`** refuses every call and notes it: nothing reaches GitHub,
  and no fixture commit names an issue. **`deep`** runs `lease -- <command>` as the command itself, as `scripts/lease`
  does with no hub. **`osascript`** answers 0, so `fingerprint()` reads Low Power Mode off and the thermal state
  nominal.
- **The load.** Each node process starts with `--import` of a module that pins `os.loadavg()` at 2. Otherwise perf's
  and the preflight's top-level timed grant and the window would wait for this Mac's load (20–110 here) to fall under
  its 18 cores. The cores stay the machine's.

Every process a test starts has its own process group, which the test stops by its PID if it outlives its bound.
Nothing is killed by name or port. Each sandbox is removed after its test.

## Wrong programs

`twins.json` maps AC1, AC2 and AC3 to one planted wrong program each, under `twins/`. The base is itself a wrong program
for AC1 and AC4, which fail on it. AC1 has a twin as well because the issue names that planted script, and AC4 has none.
The base is none for AC2 and AC3, which pass on it, so their twins are what shows they can fail.

Each twin replaces one file and has a header line naming the fault. `first-cargo-only` and `requires-caller` are the
throwaway change's (below) `scripts/benchmark.mjs` and `scripts/perf.mjs` with one line changed. `repo-wide-off` is the
base's `.cargo/config.toml`, which the throwaway leaves alone, with a `[build]` table added. I ran each over the
throwaway change:

| Criterion | Twin | The planted fault | Fails at |
|---|---|---|---|
| `#3239.ce662817` (AC1) | `first-cargo-only` (`scripts/benchmark.mjs`) | `warm()` empties `RUSTC_WRAPPER` for its first cargo only | `scripts/benchmark.mjs: its cargo 2 of 2, \`cargo clippy --workspace --all-targets --locked -- -D warnings\` …, ran under the wrapper: 4 compiles` |
| `#3239.9d1b4fd0` (AC2) | `repo-wide-off` (`.cargo/config.toml`) | the repository's cargo config turns the wrapper off for every build in it | `the cargo home's wrapper logged no call for 2 of the 2 units the outside build compiled (fixture_core, fixture_app)` |
| `#3239.cb760c49` (AC3) | `requires-caller` (`scripts/perf.mjs`) | perf throws unless its caller emptied `RUSTC_WRAPPER`, instead of emptying it itself | new FAIL IDs in `tests/perf.test.mjs` |

A twin isn't confined to its criterion's test. On AC1, `repo-wide-off` fails at the build started outside each of the four
scripts, and `requires-caller` fails because perf starts no cargo build (`TWINS-RUN.txt`). Beyond those two pairs, each
twin was run only on its own criterion's file.

AC1's other wrong program is the merge base itself, which fails it naming every cargo of each script. AC4's is the
base's section 4. Both are in `BASE-FAILURE.txt`.

**The throwaway change** (in a scratch copy, not kept): `benchmark.mjs` gives `warm()`'s cargos, `measureOnce`'s
command and `judgeTargets`'s two runs `{ ...process.env, RUSTC_WRAPPER: '' }`. `perf.mjs`, `budget-window.mjs` and
`preflight.mjs` set `process.env.RUSTC_WRAPPER = ''` near their top. Section 4 gains a sentence in "Off where a build
must be bare" naming the four scripts, and "a reference Mac may run the cache too" in place of "the reference Mac's
budgets stay unwrapped". All four tests passed on it (`BASE-FAILURE.txt`).

## Running them

```sh
node --test tests/acceptance/3239/ac4-design.test.mjs        # milliseconds
node --test tests/acceptance/3239/ac2-outside-build.test.mjs # a second or two
node --test tests/acceptance/3239/ac1-bare-builds.test.mjs   # 11-19 s, later 133-134 s: four sandboxes, about 140 cargo calls
node --test tests/acceptance/3239/ac3-unit-lane.test.mjs     # about a minute, 191 s on its twin: four of the unit lane's files
```

Times as `node --test` printed them, with the machine's 1-minute load at the start and the end where I have it:

| Run | Time | Load |
|---|---|---|
| AC1 on the base, beside the other three files | 11 s | 28 to 30 |
| AC1 on the base, alone | 15 s | 50 to 52 |
| AC1 on the throwaway, with AC2 and AC4 | 15 s for the three files | 66 to 73 |
| AC1 on `first-cargo-only` | 19 s | 52 to 66 |
| AC1 on `repo-wide-off`, under a throttle grant | 134 s | not recorded |
| AC1 on `requires-caller`, under a throttle grant | 133 s | not recorded |
| AC3 on the base, beside the other three files | 56 s | 28 to 30 |
| AC3 on the throwaway | 57 s | 22 to 14 |
| AC3 on `requires-caller` | 191 s | 14 to 57 |

I haven't found out what made the last AC1 runs slower.

They need the pinned toolchain (`rust-toolchain.toml`) installed with clippy, `cc` and `/usr/bin/time`, and no
`node_modules`. On a shared machine, through its throttle: `node scripts/throttle.mjs test --wait 30 -- scripts/lease
node --test 'tests/acceptance/3239/*.test.mjs'`. The folder alone (`node --test tests/acceptance/3239/`) runs no test on
Node v24.22.2: it ends in `MODULE_NOT_FOUND`. I checked the quoted glob with `node --test` itself, where it finds the
four files, and not through the throttle. The tests run on macOS, where the issue runs. Nothing in them is specific to
the reference Mac.

**Lanes.** By `scripts/lanes.mjs`'s own reasons the suite belongs on none of its lists. AC1's and AC2's cargo builds
write only into their sandboxes' target folders, never the checkout's `target/`, so no sibling file's binary goes
missing under them (the `alone` reason). No file holds a resource another suite uses: each sandbox has its own `HOME`,
throttle table, caches and records. AC3's run has its own `HOME`. No file times a budget, takes the machine's timed
grant or reads its load or fingerprint. `slow` is a file whose fastest recorded run takes over two minutes: AC1's fastest
in the table above is 11 s and AC3's 56 s, though three runs there took longer than two minutes. The suite runs in the
parallel `node --test` block, as 1116, 1874 and 2665 do. `tests/takes-timed.test.mjs` reads the helpers as handling the
table themselves: they name `HOME`.

## Known limits

- **Only `RUSTC_WRAPPER` and `CARGO_BUILD_RUSTC_WRAPPER` are read** for the messages. A change that turns the
  wrapper off some other way, such as a `--config build.rustc-wrapper=''` argument, passes AC1 if no wrapper call
  comes from its cargos. That is the criterion: the wrapper logs none.
- **The window's task placement.** The fixture can't load `affected.mjs` (no `typescript` above it), so the window runs
  every task, as section 12a has it for a task it can't place. The measured commit changes `Cargo.toml`, a file every
  task reads, so the task runs either way.
- **The check workload is the fixture's.** The real `scripts/checks.mjs` runs every lane of the repository, so the
  fixture stands it in with one cargo build. A change that empties the variable in `checks.mjs` or `lanes.mjs` instead
  of the four scripts is judged on that stand-in, not on its own code.
- **AC3 is a part of the lane** (above). Its run is a proxy for the lane's: a pinned load and its own `HOME`. A file
  that fails at random under load reads as a new FAIL ID.
- **AC3 reads git.** Its "before" is `git merge-base HEAD origin/main` in this checkout, as perf's is; a checkout
  with no `origin/main` makes it fail, BLOCKED, naming that.
- **AC4 reads words.** A section that states the rule without the four file names, or says "is allowed to" instead of
  "may" or "can", fails it. The words checked are the issue's own.

## Files

- `helpers.mjs`: the toolchain, the sandbox and its stand-ins, the fixture repository, the logs' readers.
- `ac1-bare-builds.test.mjs`, `ac2-outside-build.test.mjs`, `ac3-unit-lane.test.mjs`, `ac4-design.test.mjs`: one test
  each.
- `twins.json`, `twins/`: the planted wrong programs.
- `BASE-FAILURE.txt`: each test's run on the base, and the throwaway's runs. `TWINS-RUN.txt`: each twin's run.

Of the suite's about 2,200 added lines, about 1,050 are the twins, each a whole copy of the file it replaces, as
the house form has them, and about 370 are the two run records.

No fixture holds a secret or personal data. Messages write the sandbox as `<sandbox>`, a home folder as `~` and the
machine's name as `<host>`.
