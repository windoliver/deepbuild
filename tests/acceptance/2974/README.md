# Acceptance tests for #2974: a drain is a lease, it shows while it holds, and `deep hub promote` lifts its own

I drafted these tests blind, at base commit `40f05472b` (origin/main, no implementation), from these sources:

- issue #2974, as saved verbatim for this job: its problem, Scope, six criteria, Budgets and Proof
- `docs/technical-design.md`: Threats, and what stops each one (Agents switching off what watches them, What a
  command's children do); Dogfooding; Criteria to tests, both ways; Criteria in a checked shape; Wrong programs
- AGENTS.md

At the base I also read the hub's `hub-control.ts` (`hub.drain`, `start.session`, `health`, `rows.read`),
`server.ts` (the hello and its `peer`, `hub.health`, `hub.stop`, `hub.restart`, `RESTART_AFTER_MS`), `promote.ts`
(the drain loop, its 10 s control timeout), `service.ts` (`control`), `starts.ts` (`startSession`), `session-state.ts`
(how a turn reads working, and `states`), `hub-readings.ts` (`health`), `list.ts` (`deep status`), `wire.ts`
(`startOf`), the CLI's `main.ts` (first-run setup), `scripts/proof-change.mjs` (`criterionId`); and, for their shape
only, `tests/acceptance/1865/` and `tests/acceptance/1334/` (the launcher stand-in, the watched repository, the planted
builds, the played turn, twins). The helpers are written here, never imported from another suite. Per AGENTS.md, the
implementing agent doesn't edit these tests; a dispute goes to a blind redraft by this job.

## How to run

```sh
npm ci && npm run build --workspaces       # the deep CLI and the hub the tests start
cargo build --locked -p deep-hook          # target/debug/deep-hook: the played turn's hooks and the builds' deep-hook
node --test --test-concurrency=3 'tests/acceptance/2974/*.test.mjs'   # on Node 24.22
```

There are 7 tests in 6 files, all offline, on macOS. They're `*.test.mjs` under `tests/acceptance/`, so the unit lane
doesn't pick them up. Each test starts a hub of its own in a sandbox of its own, so files can run side by side. Seen on
this Mac at 1-minute loads of 20 to 180: `design` at once; `lease` 2 to 2.5 min (three tests of 35 to 46 s); `shown`
10 to 30 s; `interrupted`, `timeout` and `promote` 2 to 3.5 min each (a first promotion, five landings, two main watch
ticks, then the promotion under test; `promote` holds its turn 40 s). Split long runs per file: a shell that dies at
10 minutes kills a whole run.

They run real components: this checkout's built `deep` CLI and hub (`deep hub start`, `deep status`, `deep hub
promote`, `deep hub run` as the login service runs it), main watch's real job (`scripts/main-watch.mjs tick` and
`status`), the real `deep-hook` (`target/debug/deep-hook claude-code <event>`) for a session's turn, real git, and the
hub's socket reached by a process holding the control token (`fixtures/client.mjs`).

### Stand-ins, all at boundaries the repo doesn't own

- **launchd, or systemd, behind the base's `DEEP_HUB_LAUNCHER` seam** (`fixtures/launcher.mjs`, the same stand-in as
  #1865's, written again here): each call is a load, as at a login; its supervisor keeps the job as the base's
  definition says (KeepAlive with SuccessfulExit false: a non-zero exit starts again after launchd's 10 s throttle).
- **The OS confirmation**, behind `DEEP_HUB_TEST_CONFIRM`: a stub that notes each ask in `asks.log` and cancels it.
  Nothing in this issue may ask, so any ask is a failure where a test checks it.
- **`launchctl` and `systemctl`**, first on `PATH`: each records the call and exits 1.
- **A hub too slow to answer** (AC4's timeout): the hub's own process paused with SIGSTOP, by the PID its `hub.health`
  gave, for 14 s, and resumed with SIGCONT, as a heavy load stalls it. It is the OS scheduler's boundary, not the
  repo's; nothing in the hub is changed.
- **Claude Code**: a session's turn is played through the real deep-hook with payloads and transcript entries shaped as
  Claude Code writes them (its newest covered version, from `adapters/claude-code.facts.json`). The test's process is
  the agent; no model runs.

**Every test points `HOME`, `TMPDIR` and `XDG_*` at a temporary folder** under `/tmp/d2974-*` (short, because the
hub's socket path must fit in 104 bytes), so the installed hub of each test is that sandbox's `~/.deepbuild` hub, never
the real `~/.deepbuild` or launchd job. The sandbox drops every `DEEP_*`, `CLAUDE*`, `CODEX_*`, `GH_*`, `GITHUB_*`,
`ANTHROPIC*`, `OPENAI*`, `AWS_*`, `GIT_*` and `XDG_*` variable, `NODE_OPTIONS` and `NODE_TEST_CONTEXT`, and its `PATH`
is its own `bin`, `/usr/bin`, `/bin`, `/usr/sbin` and `/sbin`. Each process a test starts gets its own process group,
and the test stops that group by its PID at the end (a paused hub is resumed first), with the stand-in's supervisor and
every job it started (by the PIDs it logged), then removes the sandbox. Nothing is killed by name or port. No model is
called and no network is used. Assertion messages redact the token and the sandbox's path.

## The surface (my choice where the issue leaves it open)

- **The installed hub** is the hub of `~/.deepbuild` (no `--root`), started through its login service by `deep hub
  start` or by `deep hub promote`.
- **A process that holds the control token** (`fixtures/client.mjs`, run as a process of its own, a command's child)
  says hello as the CLI does, `{"hello":"cli","token":…}`, naming its own process as `peer` (its PID and `ps -o lstart=`
  start, as the base's deep commands do), and sends `{"method":"hub.drain","params":{}}`. A word only its command
  line holds (`--mark d2974-holder-<hex>`) lets a test find its command line where the hub shows it. Renewing, it sends
  the same call on a new connection once a second, as `deep hub promote` renews its drain while it waits for turns.
- **A session start** is `start.session` as `deep start` sends it: the CLI's credential, its process as `peer`, a repo
  (a git repository in the sandbox), an issue, `claude-code` and a prompt. **Served** means the reply is a `result`:
  the start's own checks answered it. No run is approved in a sandbox, so a served start is answered
  `{"status":"refused","bound":"approval"}` and starts nothing, as on the base with no drain. **Refused by a drain**
  means an `error` whose words name a drain or a pause.
- **"Within 35 s"** (AC1) is from the drain's reply to the send of the first start served; starts go once a second.
- **"Past 30 s"** (AC2): starts at 5, 15 and 25 s after the first drain's reply, then one after another, each sent as
  soon as the last came back, from 28 to 42 s; every one must be refused by the drain. Back to back, so a lapse the next
  renewal takes again within a second still shows.
- **"Within 1 s of its exit"** (AC4): from promote's process exit, starts are sent one after another; one sent within
  1 s of the exit must be served. **"The build that was in"**: the hub keeps the start ID and PID it had, and
  `~/.deepbuild/versions/current` still names c1's build.
- **"A running turn"** (AC4, AC5): a session of the installed hub whose prompt you typed began a shell call with no
  end yet (SessionStart, UserPromptSubmit, PreToolUse of `sleep 600`), which the hub counts as a running turn: promote
  prints "waiting for 1 running turn(s)". It ends with PostToolUse and Stop.
- **"Interrupted (SIGINT)"**: SIGINT to promote's process group, as Ctrl-C sends it, once it said it waits.
- **"Whose drain call times out"**: once promote said it waits, the hub is paused for 14 s, past promote's 10 s control
  timeout, so its next drain call meets a hub that can't answer; resumed at 14 s, or as soon as promote exits if
  sooner. Promote must then exit, on its drain (its stderr names the drain), within 180 s.
- **"With no session started during its drain"** (AC5): a start each second from promote's wait until it ends; of those
  the hub that was in answered (by the start ID of the hello on that connection), none may be served. The promoted
  build's hub, after the restart, holds no drain of the promotion's, so its answers don't count. At least three starts
  past 30 s into the wait must have been refused by the drain, or the test is BLOCKED. The turn runs 40 s into the
  wait, so the drain must outlast a 30 s lapse by promote's own renewals.
- **The good promotion** (AC5), as #1334 and #1865 have it: exit 0, no ask of the OS, `versions/current` names c2's
  build under `versions/`, the hub answers with a new start ID, the old process is gone, the new one is c2's `bin/deep
  hub run` started since the promotion began, and it keeps its start ID 5 s later.

### Readings (AC3)

- **The hub's health** is `hub.health`'s result (what `deep hub status` prints). It must hold one object that holds,
  deep within it, the holder's PID (a number, or a word in a string), a string holding the holder's command line's
  mark, and a time between 1 s before the first drain was sent and the read (epoch ms or s, or ISO-8601); and that
  object's JSON must say `paus` or `drain`.
- **`deep status`** is its text output. The lines naming a pause or a drain, the holder's PID or its mark, together,
  must say `paus`, hold the PID as a word and the mark, and a time in that window: ISO-8601, epoch ms, a UTC clock time
  (`HH:MM`, the sandbox's TZ is UTC) or an age such as "12 s ago".
- **A start refused under it** must name the holder's PID, and when the drain lapses: a time 25 to 35 s after the
  refusal (renewed each second, it lapses 30 s after the last renewal), as epoch ms or s, ISO-8601 to the second, a UTC
  `HH:MM:SS`, or "in N s". It must not say `promot`: no `deep hub promote` holds this drain.
- **"Since when"** may be the first drain or the last renewal; both fall in the window.

### The promotions' fixture

`watched()` builds `origin.git` (a bare repository standing for GitHub's), `work` (where the test lands commits) and
`mac` (the clone main watch ticks in and promote runs in), as #1865's suite does: its first commit holds this
checkout's `scripts/` with `lanes.mjs` moved to `lanes-real.mjs` and a `scripts/lanes.mjs` that cuts `checks` to two
tiny lanes, an empty `known-failures.json`, `lib/sum.mjs` and its test, with `node_modules/typescript` linked above it.
A good build's `bin/deep` notes each run in `starts.jsonl` and runs this checkout's CLI; its `bin/deep-hook` is a copy
of `target/debug/deep-hook`. Issues 9871 on are made up. `promotedWithTurn()` promotes c1's build with no hub running,
lands five commits, ticks main watch to pass c2, plants c2's build, and begins the running turn.

## Criteria to tests

Each criterion's ID is `#2974.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space
collapsed>`, as `scripts/proof-change.mjs` (`criterionId`) works it out. Each test's name starts with its tag.

| Criterion | Test (file) | Fails on |
|---|---|---|
| AC1 `#2974.aaa94086` a token holder's one `hub.drain()`, its process gone, lapses within 35 s with no restart | `lease.test.mjs`, the peer test, and the no-peer test (a drain naming no process lapses too, or is refused) | the base (naming `hub.drain`: start.session still refused 45 s on, "A promotion is draining the hub") |
| AC2 `#2974.be96e768` renewed once a second, a drain keeps starts paused past 30 s | `lease.test.mjs`, the renewed test | twin `lease-from-first-drain` (passes on the base, whose drain holds for good) |
| AC3 `#2974.2d1e88a4` while it holds, `deep status` and health name it, its holder's PID and command line and since when; a refused start names the holder and when it lapses, no promotion | `shown.test.mjs` | the base (hub.health names no drain; then deep status, the refusal) |
| AC4 `#2974.b5722acf` promote interrupted (SIGINT) while it waits for a running turn, or whose drain call times out, leaves no drain: starts served within 1 s of its exit, hub still on the build that was in | `interrupted.test.mjs` (SIGINT), `timeout.test.mjs` (the drain call times out) | the base (no start served within 1 s of promote's exit: the drain still holds) |
| AC5 `#2974.b18056cd` promote of a good build still moves the hub to it with no prompt, no session started during its drain | `promote.test.mjs` | twins `promote-renews-late`, `drain-asks-confirm` (passes on the base) |
| AC6 `#2974.5ff069d9` the design's threat table names a held drain and its mitigation | `design.test.mjs` | the base (no row names a drain) |

**AC6's reading:** a row of the table under "Threats, and what stops each one" whose threat or mitigation names a
drain, and whose mitigation says it lapses unless renewed (`laps`, `lease` or `renew`), that you can see it (`status`,
`health`, `show` or `see`), and that `deep hub promote` lifts its own (`promote`): the issue's Scope, in the doc.

## Not tested

- The real launchd's `KeepAlive` (the stand-in reads the base's definition as launchd would) and the app's view of a
  drain: the issue names `deep status` and the hub's health only.
- Promote stopped by anything but SIGINT, or between the drain and `hub.restart` other than on its drain call.
- The Budgets line: none of its own, not measured.

## Files

- `helpers.mjs`: the sandbox, launching, the socket, the installed hub, the holder, starts, readings of a holder and a
  time, the played turn, the watched repository and main watch's ticks, the builds, promote.
- `fixtures/launcher.mjs`: the login service's stand-in. `fixtures/client.mjs`: the process holding the control token.
- `lease.test.mjs`, `shown.test.mjs`, `interrupted.test.mjs`, `timeout.test.mjs`, `promote.test.mjs`,
  `design.test.mjs`: the tests above.
- `twins.json`, `twins/`: the planted wrong programs (`twins/README.md`).
- `BASE-FAILURE.txt`: the run on the base, the throwaway implementation's run, and which test caught each twin.

No fixture holds a secret or personal data.
