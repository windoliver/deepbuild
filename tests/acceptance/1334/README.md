# Acceptance tests for #1334: the run's own code doesn't move with main

I drafted these tests blind from these sources:

- issue #1334, as saved verbatim for this job: its Scope, its five criteria and its Proof
- `docs/technical-design.md`: Landing in turn (its last sentences, on promotion), Socket roles and contract versions
  (Version skew and What a minor may change), How it installs (`ship`: Installs and updates, The hub, Platforms),
  How we know version 0 works and Dogfooding
- `docs/parallel-proof.md` (the throttle table, 12b on main watch) and AGENTS.md
- the base commit `f1e8736e`, which has no implementation. This worktree's HEAD, `42319109`, adds only #531's logic
  crates and suites on top of it; nothing this suite reaches changed.

At the base I also read the hub's `service.ts` (the login service, `DEEP_HUB_LAUNCHER`), `paths.ts`
(`installedPrograms`, the versions folder's `current` link), `installer.ts` (#41's versions folders), `doctor.ts`,
`compat.ts`, `wire.ts` (`CONTRACT`, `FEATURES`), `server.ts` (the hello, hook lines, `hub.health`, `hub.stop`,
`events.read`), `core.ts` (turns, claims, `verdict.made`, the spool's replay), `plant.ts`, `hub-command.ts` and
`hook-programs.ts`; `crates/deep-hook/src/main.rs` (`exchange`, `FEATURES`, the request line, what it does with the
hub down or refusing: the `fail_closed` entries, the spool); `hook.request@3`, `doctor.item@1`, `notice.sent@1`;
`scripts/main-watch.mjs` (#1333) and `scripts/proof-change.mjs` (`criterionId`); and, for their shape only,
`tests/acceptance/1333/`, `315/`, `16/`, `1523/` and `993/`. The helpers are written here, never imported from
another suite. Per AGENTS.md, the implementing agent doesn't edit these tests. A dispute goes to a blind redraft by
this job.

## How to run

```sh
npm ci && npm run build --workspaces       # the deep CLI and the hub the tests start
cargo build --locked -p deep-hook          # target/debug/deep-hook, which every session's hooks run
node --test --test-concurrency=2 'tests/acceptance/1334/*.test.mjs'   # with the official Node 24.22 build first on PATH
```

A fresh worktree has no `node_modules`, so it needs `npm ci` first. **Run it on the official Node 24.22 build**
(`.node-version`; here fnm's `~/.local/share/fnm/node-versions/v24.22.0`), not Homebrew's `node@24`. The suite's
Node is the one every process in the sandbox runs, the hub's check runs included, and Homebrew's links `libuv` and other
libraries from kegs of their own, which the check sandbox doesn't grant: every `node --test` check then reads
`uncounted` (`sandbox.denied` on `/opt/homebrew/Cellar/libuv/…`), and AC5's control never reads PASS. That's a
product finding, not this suite's (Readings).

For this job, `node_modules` and `packages/*/dist` were cloned from a sibling worktree built at the same base, and
deep-hook was built **outside the machine's throttle**, at low priority (`nice -n 10`, `CARGO_INCREMENTAL=0`,
`CARGO_PROFILE_DEV_DEBUG=0`): the one build slot had been held for hours by another session's stalled
`deep lease -- cargo test` (pid 13877), which this job didn't touch, and the owner's standing rule is not to stall on a
busy machine.

**The load rule.** On this Mac at a load of 200 to 320 on 18 cores, the hub sometimes answers a hook past
deep-hook's 50 ms budget, and deep-hook spools it, or can't. A judgement that needs such a hook reads
`INCONCLUSIVE`, naming the load, never FAIL or PASS: the rollback scene, when deep-hook couldn't spool one of the
session's hooks (`could not spool`); AC5's control, when the hub took any of its hooks late (it tries three
sessions); and an older-session hook that was late and names no contract. There are 10 tests in 5 files, all offline, on
macOS (Linux reads the systemd unit instead of the plist, and isn't run here). They're `*.test.mjs` under
`tests/acceptance/`, so the unit lane doesn't pick them up. Each file starts hubs of its own, so the folder belongs on
`scripts/lanes.mjs`'s one-at-a-time list (`alone`); the implementer adds it.

**Timings seen** on this Mac (18 cores) at 1-minute loads of 130 to 320, from other sessions' work:
- On the base, the whole suite took 503 s, two files at a time; everything but AC5 fails within 30 s of its scene's
  first promotion.
- On the blind job's throwaway implementation, each file alone: `hold.test.mjs` 65 s, `crash.test.mjs` 54 s,
  `misjudge.test.mjs` 38 s, `doctor.test.mjs` 28 s, `contract.test.mjs` 195 s. A tick of main watch on the fixture
  takes 5 to 30 s (a red one, with its bisection and revert, the most).
- The rollback, measured as the bound is (the planted build's first run to the last good build answering): 30.4 s for
  the crash build at a load of 128, the throwaway waiting 30 s for a hub before rolling back. That leaves about half
  the bound for a loaded Mac; a promoter that waits longer for a new hub than about 40 s will miss it under load.
- A twin whose build never comes back keeps the scene polling for three times the bound, so its file takes 4 to
  6 minutes.

They run real components: this checkout's built `deep` CLI and hub (`deep hub promote`, `deep hub start`,
`deep hub run`, `deep doctor`), its `target/debug/deep-hook` as every session's hook client, real git, and main
watch's real job (`scripts/main-watch.mjs tick` and `status`), copied with the rest of `scripts/` into the watched
repository, whose real `runLanes` runs its lanes under the real throttle.

### Stand-ins, all at boundaries the repo doesn't own

- **launchd, or systemd, behind the base's `DEEP_HUB_LAUNCHER` seam** (`fixtures/launcher.mjs`). The hub's service
  code runs `$DEEP_HUB_LAUNCHER <definition file>` where it would run `launchctl bootstrap` and `kickstart`. The
  stand-in's first call loads the definition into a supervisor of its own and starts the job; a later call starts the
  job if it isn't running and does nothing if it is. The supervisor keeps the job as the base's definition says
  (`KeepAlive` with `SuccessfulExit` false, systemd's `Restart=on-failure`): a job that exits non-zero, or on a signal,
  starts again 10 s after its last start, as launchd's throttle does; one that exits 0 stays stopped until the next
  call. It reads the definition file again at each start, and starts the job with the definition's environment, the
  sandbox's `TMPDIR`, and `DEEP_HUB_LAUNCHER` itself, so a job that starts the service again reaches the stand-in, never
  the real launchd. Every load, start and exit is a line of its log.
- **`launchctl` and `systemctl`**, first on `PATH`: each records the call and exits 1. Nothing a test starts may call
  them; the Scope test of `crash.test.mjs` checks that none did.
- **`gh`**, for GitHub (`fixtures/gh.mjs`): main watch calls it only on a red run, to open and merge its revert. It
  prints a URL for `issue create` and `pr create`, exits 1 for `pr view`, and does nothing else, so the "merged"
  revert never reaches origin and main stays red.
- **Claude Code**, played by the test: each hook is this checkout's deep-hook run as an agent's entry runs it,
  `deep-hook claude-code <event>`, with the hook JSON on stdin (shaped like the corpus's) and the session's folder as
  its working folder. The test process is the agent, so the session's parent lives as long as the test.

**Every test points `HOME`, `TMPDIR` and `XDG_*` at a temporary folder** under `/tmp/d1334-*` (short, because the
hub's socket path must fit in 104 bytes), so the record, the versions folder, the login service's definition, main
watch's state, the throttle table and Claude Code's settings are the sandbox's, never the real `~/.deepbuild`, launchd
jobs or `~/.claude`. The sandbox drops every `DEEP_*`, `CLAUDE*`, `CODEX_*`, `GH_*`, `GITHUB_*`, `ANTHROPIC*`,
`OPENAI*`, `AWS_*`, `GIT_*` and `XDG_*` variable, `NODE_OPTIONS` and `NODE_TEST_CONTEXT`, and its `PATH` is its own
`bin` (the stand-ins and a link to this Node), `/usr/bin`, `/bin`, `/usr/sbin` and `/sbin`, so no real `claude` or
`codex` is found. `DEEP_DOCTOR_CANVAS_FAULT=render_skipped` skips the doctor's canvas render, which no test reads.
Each process a test starts gets its own process group, and the test stops that group by its PID, with the stand-in's
supervisor and every job it started, by the PIDs it logged. Nothing is killed by name or port. No model is called and
no network is used.

## The surface (my choice where the issue leaves it open)

The issue names `deep doctor` and main watch (#1333), and nothing else. Every other name below is picked here, as the
smallest surface that makes each criterion true and observable through existing entry points.

### Builds and the versions folder

- **A build** is a folder holding `build.json`, an object whose `commit` is the 40-hex commit it was built from (other
  fields free), and two executables: `bin/deep`, the CLI, whose `bin/deep hub run` runs the hub; and `bin/deep-hook`,
  the hook client. How a build is made from a commit (a clean checkout, `npm ci`, the builds, `cargo build`) is the
  implementation's, and no test runs it: the tests plant their own builds (The builds the tests plant, below).
- **The versions folder** is `~/.deepbuild/versions/`, as #41's installer has it: each promoted build in a folder of
  its own named by its commit, and `~/.deepbuild/versions/current`, a symlink to the folder of the build that is in.
  A test reads which build is in from `current`'s target's `build.json`, and that the target sits directly under
  `versions/`.
- **The login service** names `~/.deepbuild/versions/current/bin/deep` with `hub run`, as the base's `startHub`
  already writes when the versions folder exists, and is handed to the service manager through the base's `launch`
  (so through `DEEP_HUB_LAUNCHER` in the tests). A promotion never needs a new definition: it switches `current`.
  On a host with no service yet, the first promotion writes the definition and loads it.

### `deep hub promote <build folder>`

Run in a checkout main watch watches (its working folder), as `scripts/main-watch.mjs` is.

- **Refused** (exit 1 or 3, never 2, which is for a usage error) before anything else happens, with no program of the
  build run, no `current` link changed or made and no service started:
  - while main watch reads main red there (`node scripts/main-watch.mjs status` reads `landings paused`): its output
    (stdout or stderr) holds the word `red`;
  - when the build's commit isn't the commit of main watch's last clean run there: its output names the commit, by
    7 or more hex digits. How promote reads that commit (main watch's state under `~/.deepbuild/main-watch/`, or a
    new line or subcommand of `scripts/main-watch.mjs`) is the implementation's.
- **Otherwise it waits for the drain**: no turn runs. A turn runs from a session's `UserPromptSubmit` until its
  `Stop`, as the hub reads its hooks, whether it takes them live or late from deep-hook's spool. The test's turn opens
  with a prompt you typed, its Claude Code transcript entry written first, as a real session's is. While it waits, the hub keeps serving (hooks and the socket answer, its start ID
  unchanged) and `current` stays where it was. "The run pauses" isn't tested further.
- **Then the restart**: the hub stops, `current` switches to the build's folder under `versions/` (copied there by
  promote), the login service starts it, and it reconciles.
- **Then the health check**: the hub now running judges one fixture claim with its own gate, and the verdict it
  records or returns is compared with the one the fixture expects. Which claim, and how it reaches the gate, is the
  implementation's; it must be judged by the new build's running hub, not by promote's own code.
- **Kept**: exit 0, `current` on the new build, the hub answering on it.
- **Rolled back**, when the hub doesn't come up, doesn't stay up, or the health check fails: `current` switches back
  to the build that was in before, the hub runs on it and answers, and the record holds one notice. The last good build
  answers again **within 60 s of the planted build's first run** (the test measures from the first line its `bin/deep`
  notes to the first poll, every 250 ms, at which the hub answers its hello, `current` names the last good build, and
  that build's `bin/deep` has run `hub run` since). Promote exits 1 or 3.
- **The notice** is one event of a new kind, **`build.rolled_back`**, in the record (writer core), whose
  `data.commit` names the promoted commit (40 hex, or 7 or more of its first digits); other fields free (say
  `restored`, the build that came back, and why). A test reads it through `events.read`, and reads it again after one
  more restart of the hub (`hub.stop` on the socket, then `deep hub start`): still one.

### The planted programs (DEEP_HUB_PLANT, through `packages/hub/src/plant.ts`)

- **`judges-claims-wrongly`**: the hub records each claim's verdict wrong: `FAIL` where its gate would record `PASS`,
  and `PASS` where it would record anything else; and so for any verdict it returns. Whatever the fixture claim
  expects, a hub with this plant judges it wrong. The tests' misjudging build sets it in its `bin/deep`.
- **`contract-major-ahead`**: the hub speaks a contract one major above this checkout's: its hello's `contract` says
  so (`major.minor`), and it compares every hook's contract with it. This checkout's deep-hook is then a deep-hook older
  than the hub's contract.

### `deep doctor`

- A new item **`hub.service`** (agent `deepbuild`) reads the hub's login service's definition:
  `~/Library/LaunchAgents/com.deepbuild.hub.plist` on macOS, `$XDG_CONFIG_HOME/systemd/user/deepbuild-hub.service`
  on Linux, as the base writes them. Its programs are the absolute paths among `ProgramArguments` (or `ExecStart`).
- **ok** when the program sits under `~/.deepbuild/versions/` (through `current`): a promoted build, wherever the home
  is.
- **fail** when a program sits in a git worktree or a checkout, or in a temporary folder (under `$TMPDIR`, `/tmp`,
  `/private/tmp`, `/var/folders` or `/private/var/folders`): its evidence names that path and says which, with the
  word `worktree`, `checkout` or `temp` (`temporary`). A worktree or checkout is judged before the temporary folder, so
  a worktree under `/tmp` reads as a worktree. Its code is a failure code that `doctor.item@1` lists (a new one, say
  `service_unpromoted`), and its fix is free. `deep doctor` exits non-zero, as with any failed item.

### deep-hook and the hub's contract

- When a session's deep-hook and the hub disagree on the contract's major (here: the hub's is one major ahead), every
  hook run tells the session: what deep-hook prints (stdout or stderr) holds the word `contract` and the hub's
  contract as its hello names it. Which side compares, and whether the request carries deep-hook's contract, is the
  implementation's.
- **It fails closed with the reason**, as Version skew says: deep-hook does what it does with the hub away, so a call
  a `fail_closed` guard entry matches is denied (exit 2, the entry's own words), now with the contract's reason too.
- **Nothing is recorded as a PASS**: after the session's turn, a restart of the hub (which replays deep-hook's spool)
  and a quiet record, no `verdict.made` reads `PASS`. The same session against an unplanted hub records a `PASS`, so
  the claim can pass. Both hubs run with the same `DEEP_HUB_TEST_DRAFTS`, so a planted hub that took the older
  session's hooks would lock the same definition and judge the same claim PASS.

## The builds the tests plant

Each test makes its builds in its sandbox (`makeBuild`). Each `bin/deep` notes every run of it (the build's name, its
PID, the time in ms, its arguments) before it does what its kind says. `bin/deep-hook` is a copy of
`target/debug/deep-hook` in each.

| Kind | Its `bin/deep` |
|---|---|
| good | runs this checkout's CLI |
| crash | prints a line and exits 1, whatever it's asked: a build that crashes at start |
| misjudge | runs this checkout's CLI with `DEEP_HUB_PLANT=judges-claims-wrongly`: it starts, answers every ping, and judges claims wrong |

## The watched repository

`watched()` builds three repositories in the sandbox: `origin.git`, a bare repository standing for GitHub's;
`work`, the clone the tests land in; and `mac`, the clone main watch ticks in and `deep hub promote` runs in. Its
first commit, c1, holds this checkout's `scripts/` (with `lanes.mjs` moved to `lanes-real.mjs`, so its throttle and
lease are the copy's), a `scripts/lanes.mjs` that re-exports it whole and cuts `checks` to two tiny lanes (`unit`
runs `node --test tests/sum.test.mjs`; `lint` runs nothing), an empty `known-failures.json`, `lib/sum.mjs` and its
test. A landing is a commit on origin's main naming issue `#910<k>`; a broken one makes `sum` subtract. A tick is
main watch's job as the scheduler runs it; the first is due at once, the next after 5 landings. Main watch's `lease`
finds no `deep` and no built CLI in the fixture, so its lanes run unleased, saying so.

## The scenes

| File | Scene |
|---|---|
| `crash.test.mjs` | Tick (main watch passes c1); promote the good build of c1; a session starts and works a turn on it; five landings and a tick (main watch passes c2); promote the crash build of c2, polling the hub every 250 ms and working a turn every 3 s from the planted build's first run until the last good build is back; one more turn; the record; a restart; the record again |
| `misjudge.test.mjs` | The same, with the misjudge build of c2 |
| `hold.test.mjs`, main is red | Tick (c1 passes); one landing; promote a build of it (refused: not passed); four more landings, the last broken; tick (main red); promote a build of c1 (refused: red) |
| `hold.test.mjs`, a turn is running | Tick; promote the good build of c1; five landings and a tick (c2 passes); a session's turn starts; promote a good build of c2; 20 s of polls, with a tool call of the turn at 10 s; the Stop; the promotion ends; one more turn |
| `doctor.test.mjs` | The login service's definition written four times, as the base writes it, with `deep doctor --json` after each: a Node and its CLI in `$TMPDIR`; `bin/deep` in a git worktree; `bin/deep` in a checkout; `~/.deepbuild/versions/current/bin/deep` of a promoted build |
| `contract.test.mjs` | A repo whose `.deepbuild/done.yaml` has one passing command check and a drafted check under `.deepbuild/checks/`, trusted by Claude Code's own trust; the hub handed the task's definition by the prompt's text (`DEEP_HUB_TEST_DRAFTS`, the kernel's test fixture: one requirement of yours, judged by the drafted check); and a session's turn in it, each step with its Claude Code transcript entry (a prompt you typed, an edit made and committed, a kill by name offered, the final message, the stop). Once against a hub of this checkout (up to three sessions, under the load rule), once against a hub with `DEEP_HUB_PLANT=contract-major-ahead`, restarted after the turn |

## Criteria to tests

Each criterion's ID is `#1334.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space
collapsed>`, as `scripts/proof-change.mjs` (`criterionId`) works it out. Each test's name starts with its tag. The
Scope tests carry no tag, since no criterion holds them.

| Criterion | Test (file) | What it requires |
|---|---|---|
| AC1 `#1334.775c65d4` A planted build that crashes at start is rolled back within 60 s, with no attempt lost and one notice naming the commit | `crash.test.mjs` | The first promotion of c1's build holds. The crash build of c2 ran. The good build answers again within 60 s of the crash build's first run, `current` on it; promote exits 1 or 3. Every call the session made before, during and after is a `tool.before` in the record (by `tool_use_id`), every event of the session from before the promotion still is, and none ended it (`session.gone`, `session.end`). Exactly one `build.rolled_back`, its `data.commit` c2; still one after a restart |
| AC2 `#1334.14e4b3e9` A planted build that starts but judges the fixture claim wrongly is rolled back the same way. A health check that only pings the hub passes this plant and fails, naming the claim | `misjudge.test.mjs` | All of AC1's, with the misjudge build. A promote whose health check only pings the hub keeps it in, and the test fails: `the last good build … never came back: the planted build … starts and answers, so a health check that only pings the hub passes it. The fixture claim, judged by this build's gate, reads the opposite …` |
| AC3 `#1334.a6dc45e5` No promotion happens while main is red or a turn is running | `hold.test.mjs` (two tests) | Red: with main watch reading main red, promote of a build of c1 (its last clean commit) exits 1 or 3 saying `red`, runs nothing of the build, makes no `current` and starts no service. A turn: while the turn runs, the new build never runs as the installed hub, promote doesn't end, the hub answers with its old start ID and `current` stays; after the Stop, promote exits 0, `current` names c2's build, it runs as the installed hub after the Stop, the hub answers with a new start ID, and the turn's call and the next turn's are in the record |
| AC4 `#1334.32b63e42` `deep doctor` fails on a service whose program sits in a temp folder or a worktree, naming the path | `doctor.test.mjs` | `hub.service` reads ok for a promoted build's service; fails for a Node and CLI in `$TMPDIR`, naming one of them and saying `temp`; fails for `bin/deep` in a worktree, naming it and saying `worktree`; each with a failure code `doctor.item@1` lists and a fix; the doctor exits non-zero |
| AC5 `#1334.33ca60cb` A session whose deep-hook is older than the hub's contract gets a clear refusal, and nothing is recorded as a PASS | `contract.test.mjs` | The control records a `PASS`. The planted hub's hello names its contract. Each of the session's six hook runs prints `contract` and that contract. No `verdict.made` reads `PASS` after the turn, a restart and a quiet record |

| Scope line | Test (file) | What it requires |
|---|---|---|
| "The hub and hooks run from a promoted build in a versioned folder" | `crash.test.mjs` | After the first promotion, the service's program is `~/.deepbuild/versions/current/bin/deep`, resolving into a build's folder under `versions/`, and nothing called `launchctl` or `systemctl` |
| "A build is promoted only from a commit main watch passed" | `hold.test.mjs` | With main clean, promote of a build of a landing main watch hasn't run on exits 1 or 3 naming its commit, runs nothing of it, makes no `current` and starts no service |
| "never from a worktree, a checkout or a temp path" (the checkout) | `doctor.test.mjs` | `hub.service` fails for `bin/deep` in a checkout, naming it and saying `checkout` |
| "a mismatch fails closed with a reason" | `contract.test.mjs` | The kill by name the shipped `kill:by-name` entry holds `fail_closed` is denied with exit 2 in its own words and the contract's reason; the control denies it too |

## Readings where the issue leaves a choice

- **"A commit main watch passed."** Main watch's state keeps only its last clean run, so the promotable commit is
  that one, and only while landings read open. A promote of that same commit while main is red is refused: AC3's red
  test plants exactly that, so a promoter that checks the commit alone fails it.
- **"Promotion waits for a drain."** Read as waiting, not refusing: a promote that exits while a turn runs fails the
  turn test, as does one that never promotes after the Stop. A smoke run of the new build in a scratch root before the
  drain isn't a promotion: only its `bin/deep hub run` as the installed hub (no `--root`) counts.
- **"Within 60 s."** From the planted build's first run to the last good build answering again. A promoter that
  smoke-runs the build first and never switches still has to leave the good build answering and send one notice.
- **"No attempt lost."** An attempt is a session's work as the record holds it: its calls, its events from before
  the promotion, and its session left unended. The session works turns while the planted build is in, so with the
  hub down its calls are spooled and must come back in the record.
- **"One notice."** A record event, so it's counted, and so the app and the inbox can show it from the record. Its
  kind, `build.rolled_back`, is picked here. A notice of the restored commit instead of the promoted one fails.
- **"Judges the fixture claim wrongly."** The tests can't know the implementation's fixture, so the planted build's
  plant judges every claim wrong: whatever the fixture expects, it reads the opposite. A health check that judges the
  fixture in promote's own process, not on the new build's hub, misses the plant, as one that only pings does.
- **"Older than the hub's contract."** A minor only adds (What a minor may change), so an older minor stays served;
  the mismatch is a major below. The tests plant the hub one major ahead rather than an older deep-hook: either way
  the session's deep-hook is the older side, and no older Rust build is needed. A design adapter that serves the
  previous major would conflict with this criterion; the issue's words win here, and the dispute starts there.
- **"A clear refusal."** What the session sees is what deep-hook prints, so every hook run must name the contract
  and the hub's version. It may be stdout (a SessionStart's context) or stderr.
- **What a PASS takes, for AC5's control.** At the base a claim reads PASS only on a task whose definition locked: a
  prompt the transcript shows you typed opens the task, and the kernel locks only a definition it is handed
  (`DEEP_HUB_TEST_DRAFTS`) or one from a work item. With neither, the spec's check runs and passes but no verdict is
  made. The control hands one requirement of yours; on this Mac at a load of 240 it read PASS.
- **Not tested:** a build that starts and then won't stay up; the run's own pause (no runner dispatches turns at the
  base); setup pointing the agents' hook entries at `versions/current/bin/deep-hook`; making a build from a commit;
  Linux's systemd unit; the issue's Proof on the run's real host, which is for the implementer to run once and report.

## Files

- `helpers.mjs`: the sandbox, launching, the watched repository and main watch's ticks, the builds, promote, the
  socket, the played sessions, the readers, the rollback scene AC1 and AC2 share and its judgement.
- `fixtures/launcher.mjs`, `fixtures/gh.mjs`: the stand-ins for launchd (or systemd) and gh.
- `crash.test.mjs`, `misjudge.test.mjs`, `hold.test.mjs`, `doctor.test.mjs`, `contract.test.mjs`: the scenes above.
- `twins.json`, `twins/`: the planted wrong programs (`twins/README.md`).
- `BASE-FAILURE.txt`: the run on the base, and which test caught each planted program.

No fixture holds a secret or personal data. Issues 9101 on and 9901 on, and pull requests 9901 on, are made up.
