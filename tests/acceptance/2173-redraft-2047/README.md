# Acceptance tests for #2173: the repo rules pass on main, and a dependency with no entry still fails them

Written blind at base commit `a3db8f131256664d75a46bc876e7aed3ae9cce89` ("blind base for #2173: main without the
accesskit_macos row in scripts/repo-rules.json"), from the issue, the design and that base. #2047's closed-issue sweep
reopened #2173 because no test on main names its criteria's IDs. This folder is that suite's blind redraft (design:
Dogfooding), and its tests name both IDs. The drafting job saw no fix, no earlier suite for the issue and no test of
the fix; it read no other commit, branch, worktree, stash or pull request, and nothing on GitHub. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job. There is no taste criterion.

## Sources

- **The issue**, #2173, its body as the brief gave it: the title, the account (the `deps` lane's FAIL line for
  `accesskit_macos`, the KISS audit that found it, #1462 adding the dependency, the reason in the manifest's comment),
  the Scope, the two criteria, the Proof line and Depends on; and the sweep's IDs `#2173.222063e6` and `#2173.2db46adb`.
- **The design**, `docs/technical-design.md`: in How we know version 0 works, Criteria to tests, both ways; Closed issues
  stay proven; Criteria in a checked shape; Wrong programs; The edit guard; Dogfooding; Tests written first; and How
  runs become one of five verdicts. **AGENTS.md.**
- **The base, for surfaces only**: `scripts/repo-rules.mjs` (every lane, its result lines, its exit), `scripts/repo-rules.json`
  (its `deps` and `allowedFindings` shape), `scripts/physics-build.mjs` (the lane that runs `cargo tree`),
  `crates/deep-app/Cargo.toml` (its macOS table and the issue's line), `scripts/proof-change.mjs` (`criterionId`, the
  test paths, tags), `scripts/closed-sweep.mjs`, `scripts/proof.mjs`, `scripts/proof-runs.mjs` and
  `scripts/proof-reporter.mjs` (the before lane, twins, how a proof copy gets its own `.git`, a failure at its
  assertion), `scripts/lanes.mjs` (`testPaths`, `alone`, `slow`, `timed`, lane files), and the lints a new file meets
  (`size-ratchet.mjs`, `wait-ratchet.mjs`, `repo-rules.mjs`, `public-text.mjs`). For the house format:
  `tests/acceptance/2256-redraft-2047/`, `689-redraft-2047/` and `2470/`; for where rustup's cargo sits on this Mac,
  `tests/acceptance/2009/helpers.ts`.

## Run

```sh
node --test tests/acceptance/2173-redraft-2047/ac1-exits-0.test.mjs tests/acceptance/2173-redraft-2047/ac2-missing-entry.test.mjs
```

Node 24, git and cargo, Node built-ins only: no `npm ci`, no build. AC1's checker runs cargo as the lint lane does,
against the cargo caches the machine holds (`cargo metadata` there is already `--offline`); AC2's runs offline. The checker runs `cargo metadata` and
`cargo tree`, so the tests need cargo: on PATH, or rustup's proxies in `/opt/homebrew/opt/rustup/bin`, which the tests
put first on PATH when that folder exists, as `tests/acceptance/2009/helpers.ts` does. Without cargo each test fails
`INCONCLUSIVE:`. The two files hold four tests: AC1's runs the checker once in the checkout; AC2's three share one
scratch copy of the checkout and one run of the checker there. Each command is bounded (the checker at 15 minutes, git
and `cargo --version` at 5): one that can't start, overruns or is killed fails its test with a plain error starting
`INCONCLUSIVE:`, never at an assertion, and so does a run whose failing line says a tool it runs couldn't start
(`spawn … ENOENT`). The tests write nothing in the checkout; AC2's copy is a temporary folder removed when its file ends.
Run times are under What was run.

## The surface

The criteria name one command, `node scripts/repo-rules.mjs`, its exit and its `deps` lane. What they leave open is
marked *(chosen)*.

- **`node scripts/repo-rules.mjs`**, as written, by the Node that runs the suite (`process.execPath`), from the root of
  the checkout the test file sits in. It reads the working tree and git's index and writes nothing (its header). The
  observables: its exit status and its result lines, `<STATE> <lane>: <message>`, one per check. FAIL, INVALID and
  BLOCKED fail its run (its header), so those three are the *failing* states.
- **"Exits 0 on main"** *(chosen)*: exit 0, or exit 1 where every failing line is one open issue #3139 holds. At the base
  the checker prints 147 failing lines: the issue's, and 146 about files under `tests/acceptance/` (home paths in other
  suites' run records, two key-shaped strings, and dependencies of twins' and fixtures' manifests). #3139 holds those
  146 and waits on an owner decision about how the lints treat `tests/acceptance/`; the issue says every other lane
  passed when it was filed, and its criterion is about the line it quotes. So a failing line is set apart as #3139's
  when its message's first word holding a `/` starts with `tests/acceptance/` (the file the line is about; a line whose first
  path is `scripts/repo-rules.json`, such as a stale entry for a manifest under `tests/acceptance/`, is not set apart). Any other failing
  line, or a nonzero exit with no failing line at all (a crash), fails the test. Once #3139 is settled the reading is
  the criterion's own: exit 0. The test reports how many lines it set apart.
- **"A dependency a manifest names with no entry"** *(chosen)*: three, planted in one scratch copy of the checkout
  (below), never in the checkout: (1) the issue's own dependency, deep-app's `accesskit_macos`, with every entry for it
  under `crates/deep-app/Cargo.toml` taken out of the copy's `scripts/repo-rules.json`; (2) `blind-planted-2173 = "0.1"`
  planted on the line after `[target.'cfg(target_os = "macos")'.dependencies]` in the copy's
  `crates/deep-app/Cargo.toml`, the issue's manifest and table (added at the file's end if that table is gone); (3) a
  new `blind-2173-planted/package.json` naming `blind-planted-2173-npm` `1.0.0` under `dependencies`.
- **"Still fails the lane, naming the manifest and the dependency"** *(chosen)*: the run exits other than 0, and a line
  of the `deps` lane in a failing state names the manifest's repository path and the dependency's name, each as a
  whole word (not part of a longer name or path). In a full copy #3139's lines also make the exit 1, so the named line
  is what tells; the exit is checked too, so a checker that prints the line and exits 0 still fails.
- **The scratch copy** *(chosen)*: every file git lists in the checkout (tracked, and new files it doesn't ignore;
  links kept as links), copied into a fresh temporary folder, never the checkout's `.git`. After the planting, the copy
  gets a git repository of its own whose index lists every copied and planted file (`git update-index --add
  --info-only`), so the checker lists the same files there as in the checkout, tracked files git's ignore rules match
  included. The checker runs there with `CARGO_NET_OFFLINE=true` *(chosen)*, so cargo never reaches the network for the
  planted crate; the physics-build lane fails in the copy for want of it, which no AC2 test reads.
- The children get the suite's environment less `NODE_OPTIONS`, `NODE_TEST_CONTEXT` and every `GIT_*` variable
  *(chosen)*, so git in the checkout or the copy finds that folder's own repository. Messages print the checkout's path
  as `<checkout>` and the copy's as `<copy>`, and leave out every line of a quoted output that reads as a stack frame,
  since the proof lane places a failure by the first frame in its stack, message included.

No test imports the checker; each runs it by the command the criteria name.

## Criteria to tests

Each ID is `#2173.` and the first 8 hex digits of the SHA-256 of the criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs` and `scripts/closed-sweep.mjs`), computed here from the body as given. Both
match the sweep's: `#2173.222063e6` and `#2173.2db46adb`.

| ID | Criterion | Test | What it asserts | Wrong programs it fails on | On the base |
|---|---|---|---|---|---|
| `#2173.222063e6` | AC1: `node scripts/repo-rules.mjs` exits 0 on main | `ac1-exits-0.test.mjs`: `AC1 #2173.222063e6 node scripts/repo-rules.mjs exits 0 on main, apart from the lines under tests/acceptance/ open issue #3139 holds` | exit 0, or exit 1 with every failing line #3139's | the base; the twin `no-reasons` | **fails** at its assertion: exit 1, one failing line outside `tests/acceptance/`, the issue's |
| `#2173.2db46adb` | AC2: a dependency a manifest names with no entry still fails the lane, naming the manifest and the dependency | `ac2-missing-entry.test.mjs`: `AC2 #2173.2db46adb with its entry taken out of scripts/repo-rules.json, deep-app's accesskit_macos fails the deps lane, naming crates/deep-app/Cargo.toml and accesskit_macos` | a nonzero exit and a failing `deps` line naming `crates/deep-app/Cargo.toml` and `accesskit_macos` | the twins `hollow` and `unnamed`; the mutant `carve-out` (not kept) | passes |
| `#2173.2db46adb` | AC2 | `AC2 #2173.2db46adb a dependency planted in crates/deep-app/Cargo.toml's macOS table with no entry fails the deps lane, naming the manifest and the dependency` | a nonzero exit and a failing `deps` line naming `crates/deep-app/Cargo.toml` and `blind-planted-2173` | `hollow`, `unnamed`; the mutant `skip-target` (not kept) | passes |
| `#2173.2db46adb` | AC2 | `AC2 #2173.2db46adb a package.json planted with a dependency and no entry fails the deps lane, naming the manifest and the dependency` | a nonzero exit and a failing `deps` line naming `blind-2173-planted/package.json` and `blind-planted-2173-npm` | `hollow`, `unnamed`; the mutant `skip-npm` (not kept) | passes |

AC2 guards against a regression: at the base the checker already fails a missing entry, so the base is not its wrong
program. Its wrong programs are the twins. In the proof lane the merge base is main, which holds the fix, so AC1 is
proven there by its twin too.

## The wrong programs

- **The base.** At `a3db8f131`, `scripts/repo-rules.json` has no entry for deep-app's `accesskit_macos`, so the deps
  lane prints the issue's line and the checker exits 1. AC1 fails at its assertion, naming that line
  (BASE-FAILURE.txt).
- **The twin `no-reasons`** (AC1): `twins/no-reasons/scripts/repo-rules.json`, a rules file that holds no reason at all,
  `{"deps": {}, "allowedFindings": []}`. The real checker reads it, every dependency (deep-app's `accesskit_macos`
  among them) and every allowed finding fails, and AC1 fails at its assertion. It holds nothing of the checkout, so laid
  over a later main it is still the same wrong program.
- **The twin `hollow`** (AC2): `twins/hollow/scripts/repo-rules.mjs`, a checker that no longer fails a missing entry: it
  prints a PASS line for the deps lane and exits 0. All three AC2 tests fail at their assertion; AC1 passes on it.
- **The twin `unnamed`** (AC2): `twins/unnamed/scripts/repo-rules.mjs`, a checker whose deps lane still fails and exits
  1, but whose line names neither manifest nor dependency. All three AC2 tests fail at their assertion (AC1 fails on it
  too: its one line is about no file under `tests/acceptance/`).
- **Three mutants, run but not kept** (a twin replaces a file whole, and a whole copy of the 467-line checker is no
  small twin): each a one-line change to the base's `scripts/repo-rules.mjs`, laid over a stand-in fix (the base's
  rules file with an `accesskit_macos` entry added, in a scratch copy). `carve-out` skips any dependency named
  `accesskit_macos`, a way to turn the lane green that invariant 3 forbids: AC1 passes on it and only the first AC2
  test fails. `skip-target` drops Cargo's target-specific dependencies: the first two AC2 tests fail (and AC1, since
  deep-app's listed macOS entries then name dependencies the manifest doesn't declare). `skip-npm` reads no
  package.json: the third AC2 test fails (and AC1, for the same reason). So each AC2 test fails on a wrong program the
  other two pass.

`twins.json` maps each ID to its twins.

## Readings where the issue leaves a choice

- **"On main"**: the tests judge the checkout they run in. On main that is main.
- **"Exits 0"** with #3139's lines, as under The surface. The literal reading fails on main until #3139 is settled,
  whatever #2173's fix does, so it couldn't tell a fix from no fix; the chosen one fails on the issue's line and on any
  other failing line outside `tests/acceptance/`.
- **The Scope's entry and its reason.** "One entry … with the manifest's reason" is Scope, not a criterion. No test reads
  the entry's text: AC1 holds that the lane passes, AC2's first test that the pass comes from an entry and not from a
  checker that skips `accesskit_macos`. The checker itself refuses an entry with no `why` (`readConfig`).
- **The issue's spec.** The issue quotes `^0.26`; the manifest says `"0.26"`, which cargo gives as `^0.26`. No test pins
  the spec; an entry whose spec differs fails the lane with another line, which AC1 reads.
- **Which lanes.** The issue's account says every other lane passed; AC1 reads every lane's line, the physics-build
  lane's included, since the criterion is the script's exit.

## Lanes

No `scripts/lanes.mjs` entry is needed for `slow` or `timed`: each file's run is under two minutes even at a load of
300 to 430 (What was run), and no verdict reads a clock or the load. The folder should run **alone**: AC1's checker
reads every file git lists in the checkout, untracked ones included, so another suite writing a file into the checkout
while it runs can add a finding that isn't this change's. A folder named `2173-redraft-2047` can't hold a `lane.json`
(the lane-file rule takes numeric folders), and this job edits nothing outside its folder, so the implementer would add:

```js
// #2173's blind redraft: AC1 runs scripts/repo-rules.mjs over every file git lists in the checkout, untracked ones too.
alone.push('tests/acceptance/2173-redraft-2047/');
```

## What was run

See `BASE-FAILURE.txt` for the commands and output. Node v24.22.2, cargo 1.99.1, on the shared Mac.

- **The base, once, in this checkout** (load about 170 to 210): AC1 fails at its assertion, naming the issue's line as
  the one failing line outside `tests/acceptance/`, with 146 set apart as #3139's; AC2's three tests pass. AC1 took
  29 s, AC2's file 49 s (the copy included), the whole run 55 s. The proof lane's reporter, judged as `atAssertion`
  does, places AC1's failure at its assertion in `ac1-exits-0.test.mjs`.
- **A stand-in fix** (the base's rules file with an `accesskit_macos` entry added, in a scratch copy): all four pass,
  with the same 146 lines set apart (43 s).
- **Each twin and each mutant laid over that stand-in fix**: every test its criterion maps fails at its assertion in
  its own test file, as listed under The wrong programs (26 to 56 s a run).
- **An earlier full set of the same runs**, at a load of 270 to 430 and before two edits to failure messages only, gave
  the same verdicts in 31 to 86 s a run.
- **The INCONCLUSIVE path**, by a probe outside the suite: with no cargo reachable, the cargo check throws
  `INCONCLUSIVE: cargo can't run here …`, and the checker's own run, whose physics-build line then says `spawnSync
  cargo ENOENT`, throws `INCONCLUSIVE: a tool scripts/repo-rules.mjs runs couldn't start …`, neither at an assertion.
- **The lints on this folder**: `node scripts/public-text.mjs` passes. `scripts/size-ratchet.mjs` and
  `scripts/wait-ratchet.mjs` take no path; run whole, neither names a file here (their FAIL lines at this base are
  about files elsewhere). `scripts/repo-rules.mjs` itself, run with this folder in place (the base run above), finds
  the same 146 lines under `tests/acceptance/` as without it, none here.
- **Not run**: `scripts/preflight`, `scripts/affected.mjs`, `scripts/proof.mjs` and any throttle window or timed grant,
  by the brief; the proof lane's runs were stood in for by the twin and mutant runs above, judged with its reporter.

## Files

- `ac1-exits-0.test.mjs`: AC1's test.
- `ac2-missing-entry.test.mjs`: AC2's three tests, the planting and the shared run.
- `helpers.mjs`: the checker's run and its result lines, the cargo check, the scratch copy, quoting.
- `twins.json`, `twins/no-reasons/`, `twins/hollow/` and `twins/unnamed/`: the planted wrong programs.
- `BASE-FAILURE.txt`: the run on the base, then on a stand-in fix, then each twin and mutant laid over it.
