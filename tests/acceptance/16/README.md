# Acceptance tests for #16: the hub daemon on a Unix socket

Written first, from issue #16 (its text as of October 21, 2026: Scope, the 22 checkbox criteria, Proof, Depends on,
"Added Oct 9" and Done when, plus the one criterion in the comment "Moved here from #311: AC14's end-to-end half"),
the design sections it links (One hub per user, a tiny hook client, and extensions in-process; Socket roles and
contract versions; How it installs; Threats, and what stops each one; Hook protocol (deep-hook and the hub)) and
those around them (One event log, with tables built from it; Evidence; Privacy; Numbers version 0 has to hold; How
we know version 0 works, with Fault injection, Hook edge cases, Criteria to tests both ways, Wrong programs and
Dogfooding; the Event, Evidence and Lease primitives, all in `docs/technical-design.md`), the text of #1, #14, #15,
#17, #19, #26, #34, #56, #311 and #315, the acceptance tests of #14, #15, #56, #311 and #313, and base commit
`4f6dec5` (origin/main), by a job that never saw an implementation. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

The issue has 22 checkbox criteria and the comment adds one, so there are 23: AC1 to AC22 in the body's order and
AC23 for the comment's. (The brief that started this job said 23 boxes and 24 criteria; the issue has 22 and 23.)

## How to run

With the repo's Node (`.node-version`, 24.22.0) and Rust toolchain:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the tests run the built CLI, packages/cli/dist/main.js
npx vitest run --root tests/acceptance/16 --no-file-parallelism
```

- `--no-file-parallelism` keeps the files from running side by side: they start real hubs and time real sockets,
  and another file's CPU would push replies past their 2, 20 and 50 ms. The hot-path file (`hotpath.test.ts`) and
  the budgets (`budgets.test.ts`) only mean something with nothing else running.
- Nothing needs the network. `features.test.ts`, `address.test.ts` run `cargo build --locked -q -p deep-hook`
  (and the planted build into `target/plant-f-test/`), and one AC2 test runs
  `cargo test --locked -q -p deep-app --test hub_client`, which builds the app's dependencies the first time.
- Long runs: the crash suite (`crash.test.ts`) cuts power at every durable write point of its scenario, one pass per
  point, and takes minutes (about three to four seconds a point); the hot-path tests take about a minute each; the
  reference-Mac idle budget seeds 30 days of history (about 90,000 events) and watches the hub for 100 s.
- Every test makes its own folders under `/tmp/dh16-*` (short paths: a Unix socket path must fit in 104 bytes on
  macOS), sets `HOME` to one of them for every process it starts, and never touches the real `~/.deepbuild`, launchd
  or systemd. It stops only processes it started, by PID (`helpers.ts`, `cleanup`), never by name or port.
- With `--root` here, Vitest writes its cache to `tests/acceptance/16/node_modules/.vite/`; delete that folder before
  committing.

The tests import `packages/contracts/src/index.ts`, `packages/record/src/index.ts` and
`packages/evidence/src/index.ts` with their `.ts` extensions, as #14 and #15 published them; `tsconfig.json` here
extends the root one with `noEmit` and `allowImportingTsExtensions`:

```sh
node node_modules/typescript/bin/tsc -p tests/acceptance/16/tsconfig.json
```

They import nothing from the hub itself: every observation goes through the commands, the socket and the files
below, so there is no declaration-only copy of a hub module to check them against (BASE-FAILURE.txt, header).

## The surface under test

The issue names a socket, a few commands and many behaviors, but no code API, so these tests define the smallest
surface that reaches every criterion, through what the issue and the design already name: `deep hub …` commands,
the socket's line protocol, files under the hub's root, `deep-hook`, `deep mcp` and the app's client. The hub's code
lives where the design puts it (`packages/hub`, `@deepbuild/hub`, a workspace package; the CLI's `hub` commands use
it), but no test imports it.

### The hub's root

The installed hub's root is `$HOME/.deepbuild`; a dev hub's is the folder given to `--root`. Each root holds, as the
design names them:

| Path | What |
|---|---|
| `hub.sock` | the socket, mode 0600 from the moment it exists, owned by you |
| `ledger.db` (and its WAL) | the record, opened with `@deepbuild/record` (#14) |
| `evidence/` | the evidence store, opened with `@deepbuild/evidence` (#15); files at `evidence/ab/cdef…` |
| `control.token` | the control token, mode 0600, random, new at each launch, never on a command line |
| `spool/*.jsonl` | deep-hook's spool: one hook.request@1 line per spooled call, as sent; the hub replays it at start and removes a file only once every event it held is in a `synchronous=FULL` commit |
| `config.json` | settings; `{"hub": {"address": "unix:<absolute path>"}}` is the one address setting (below) |

### Commands (`packages/cli`, built to `packages/cli/dist/main.js`)

```
deep hub run [--root <folder>]     the hub itself, in the foreground, in this process (what the login service runs)
deep hub start [--root <folder>]   start the hub: without --root, install the login service and start it; with --root, a dev hub
deep hub stop --root <folder>      stop a dev hub (hub.stop with its control token)
deep hub status [--root <folder>]  print hub.health's result as one JSON line; exit 0, or 3 when no hub could be read
```

- **`deep hub run`** runs the hub in its own process (no re-exec, so a `node --import` preload lands in the hub). Once
  the socket answers it prints one line to stdout: `{"v":1,"ready":true,"pid":<its pid>,"socket":"<path>","start":"<start id>"}`.
  It takes the root's lock first, through a lock the OS holds and releases when the process dies, never a PID file; a
  second hub on the same root exits non-zero at once, saying on stderr that the lock is held ("lock" or "already
  running"), without touching the first hub's socket. It removes a stale socket only after it holds the lock. It
  ignores SIGHUP. On SIGTERM, SIGINT or `hub.stop` it records why it stopped and exits.
- **`deep hub start`** without `--root` installs the per-user login service and asks the service manager to start
  it: on macOS `$HOME/Library/LaunchAgents/<label>.plist` with `RunAtLoad` true and `ProgramArguments` ending in
  `hub run`; on Linux `$XDG_CONFIG_HOME/systemd/user/<name>.service` (`$HOME/.config/systemd/user/`) with an
  `ExecStart=` that runs `… hub run`. When **`DEEP_HUB_LAUNCHER`** is set it runs `$DEEP_HUB_LAUNCHER <definition
  file>` instead of `launchctl` or `systemctl --user`, which is how the tests stand in for the service manager
  (`fixtures/launcher.mjs`). It exits 0 once a hub answers on the root's socket, whether it started one or one was
  already running.
- **`deep hub status`** without `--root` reads the hub at the address setting; with `--root`, the dev hub's socket.
  On a hub it couldn't read it exits 3 and names the address it tried.
- `deep hub use --root <folder>` (scope) isn't exercised: it takes effect only once the OS confirms you (#19).

### The address setting

deep-hook, `deep mcp`, the app and the CLI take the hub's address from one setting: `"hub": {"address": …}` in
`$HOME/.deepbuild/config.json`, a string `unix:<absolute path>`; absent, it is `unix:$HOME/.deepbuild/hub.sock`.
A forwarded socket named there (as an SSH forward would give) must work for every client: none assumes the hub is
on the same machine. A hub always listens at its own root's `hub.sock`.

### The socket

Every message, both ways, is one JSON object on one line (`\n`-terminated) with an integer version field `v` (1).
A request line without `v` is refused naming `/v`.

1. **On accept** the hub writes its hello: `{"v":1,"hello":"deep-hub","start":"<start id>","features":[…]}`, the
   features it supports, so a client turns off any feature of its own the hub doesn't list.
2. **The client's first line fixes the connection's role** from the credential it presents:
   - a hook request (`hook.request@1`, as the design shows it) makes the connection `hook`. The hub answers it with
     the ack `{"v":1,"ack":"<id>","hold_until_ms":<ms|null>}`, then the reply `{"v":1,"exit":…,"stdout":…,"stderr":…}`,
     and closes; a refused request gets one error line instead, and nothing is appended for it;
   - `{"v":1,"hello":"app"|"cli","token":"<control token>"}` makes it `app` or `cli`; the hub answers
     `{"v":1,"role":"app"|"cli"}`; a wrong or old token gets an error line with code `credential`, and the
     connection reads nothing;
   - `{"v":1,"hello":"mcp","parent":{"pid":<n>,"start":"<ps -o lstart= of that pid, LC_ALL=C>"}}` is `deep mcp`,
     presenting its parent (the agent) as #26 says. The hub binds it to the session whose verified hooks came from
     that parent process and answers `{"v":1,"role":"mcp:<session>"}`; where that parent serves several sessions (a
     Codex daemon) or none, it answers `{"v":1,"role":"mcp"}` and binds each `deep_*` call instead to the unspent
     PreToolUse stamped for it: same tool name (`mcp__deep__<tool>`), and `tool_input` equal to the call's
     arguments (their RFC 8785 digest); a call that binds to no session never claims or attaches evidence;
   - anything else (a method call with no hello, say) makes it `hook`.
3. **Method calls**: `{"v":1,"id":"<string>","method":"<name>","params":{…}}`, answered by
   `{"v":1,"id":"<same>","result":…}` or `{"v":1,"id":"<same>","error":<error@1>}`. Several calls may share a
   connection; replies carry the `id` and may come in any order.
4. **Errors** are `error@1` objects (`code`, `retryable`, `remediation`, `path`, `actual`, `evidence`), on a line that
   carries the `id` of what they answer (a hook request's ULID, a method call's `id`, or null). A refusal for role has
   code `role`, path `/method` for a method call, and names the connection's role (`hook`, `mcp:<session>`, `app`,
   `cli`) in its JSON. A `seq` refusal has path `/seq`, the code the contracts' `validate('hook.request@1', …)`
   gives (`format` for a string, `type` for a JSON number), the value as sent in `actual` for a string, and the
   reason in `remediation`. A request field the hub doesn't know is refused naming it (`/f_test`).

#### Roles and methods

| Method | params | result | hook | mcp:A | app | cli |
|---|---|---|---|---|---|---|
| (a hook request line) | hook.request@1 | ack, then reply | allowed | refused | refused | refused |
| `hub.health` | `{}` | health, below | refused | refused | allowed | allowed |
| `events.read` | `{after, limit}` | `{log_pos, events: [event]}` | refused | refused | allowed | allowed |
| `stream.subscribe` | `{after}` | `{…}`, then frames `{"v":1,"id":<its id>,"event":<event>}` | refused | refused | allowed | allowed |
| `ask.answer` | `{ask, option}` | (#22, #34) | refused | refused | allowed | allowed |
| `gates.off` | `{}` | (`deep off`; takes effect once the OS confirms you, #19) | refused | refused | allowed | allowed |
| `hub.stop` | `{}` | the hub records `requested` and exits | refused | refused | allowed | allowed |
| `mcp.call` | `{tool, arguments}` | the tool's result | refused | allowed | refused | refused |
| `evidence.paste` | `{bytes: base64, type, origin?}` | `{sha256}` | refused | refused | allowed | refused |
| `run.start` | `{check, claim, commit, argv, env?}` | `{run}` | refused | refused | allowed | allowed |
| `test.load` | `{verdicts, checkpoint, backfill?}` | `{done: true}` when done | refused | refused | allowed | allowed |

"Allowed" means not refused for its role: the reply may still be another error (an unknown ask, an unconfirmed
`deep off`), never code `role`. `test.load` is served only to a hub running with `DEEP_HUB_TEST_VFS` set.

- **`events.read`** pages the log by `log_pos`: events with `log_pos > after`, in order, at most `limit`. Each event
  is the record's JSON for it (`@deepbuild/record`'s `toJson`: `id`, `kind`, `log_pos`, `writer`, `actor`, `scope`,
  `ts`, `seq` as its decimal string, `data`, `evidence`, `session`…) plus **`verified`**: false for an event that
  claims a session it can't be checked against (its transcript under the agent's home, its working folder, its
  process tree), true otherwise. That mark is part of the record: it reads the same after a restart.
- **`hub.health`** (the endpoint `deep doctor` reads): `{pid, start, gates: {watch_only, reason}, secrets, network}`.
  `gates.reason` starts with `BLOCKED` while appends fail; `secrets` and `network` are `reachable` or `unreachable`,
  whether the hub's process can reach the OS secret store and the network.
- **`mcp.call`** serves the `deep_*` tools `deep mcp` forwards. Two are used here: `deep_claim`, arguments
  claim.made@1's data (`{task_ref, attempt, commit, scope}`), result `{session, event}` (the session it bound to and
  the `claim.made` event's ID); `deep_evidence`, arguments `{path, kind, origin?}` with `path` resolved inside the
  session's working folder, result `{sha256}`.
- **`evidence.paste`** stores an image you pasted in the app. Origin comes from the connection's writer, never the
  payload: `deep_evidence` stores `agent`, a paste `you`.
- **`run.start`** starts a process under the hub's supervisor with `env` added to its environment and the hub's run
  token injected as **`DEEP_RUN_TOKEN`**; it appends `run.started@1` (`{run, check, claim, commit}`) and, when the
  process ends, `run.finished@1` whose `data.evidence` lists the hashes of its stored output, scrubbed through the
  store's text sink with the run's values (`{env, held}`) as #15 takes them. A run in flight when the hub stopped
  without a clean stop is recorded at the next start as `run.finished` with outcome `stopped` and the finding
  `hub restarted`, and its claim's check is started again (a new `run.started` with the same `check` and `claim`).
- **`test.load`** makes the hub do, as it would for real, the work AC18 runs beside the hooks: append `verdicts`
  `verdict.made` events as the core, each in its own `synchronous=FULL` commit; run a WAL checkpoint when
  `checkpoint`; and backfill the transcript file at `backfill.transcript` for `backfill.session` of
  `backfill.agent` through its transcript path (parse, keep catalogue fields, scrub, append).

#### Events the hub appends that the base doesn't publish

`hub.stopped@1`, `data: {reason}`, one per stop: `signal:SIGTERM`, `signal:SIGINT`, `requested` (`hub.stop`), and
`crashed`, appended at the next start when the last run ended with no stop recorded (a `kill -9`). A hangup is not a
stop. The hook's `session.end` (the Claude Code facts map SessionEnd to it; Codex's facts don't list SessionEnd yet,
#39) needs a schema too. The catalogue is closed, so the implementer adds both to `packages/contracts/schemas/`.
`hook.ack@1` and `hook.reply@1` gain an optional `v` (const 1), which a minor may add: every line carries it.

### Test-only settings the hub honours

Read from the environment of `deep hub run`. None of them is set by anything but a test; the README of a redraft
may move them, but each criterion that names a wrong program needs one way to select it.

| Variable | What it does |
|---|---|
| `DEEP_HUB_PLANT=<name>` | runs the planted wrong program `<name>` (Wrong programs, below) |
| `DEEP_HUB_TEST_VFS=<JSON>` | the design's test VFS for every durable write: the ledger (SQLite through the test VFS), `log_pos` blocks, spool reads and removals, evidence renames and `rules.json` rewrites keep their writes in memory until that file's sync, and only synced writes reach the files under the root (`ledger.db` and its WAL hold the durable image). Fields: `points` (a file: each durable write point appended as it is made, one JSON line `{"n":1,"kind":"commit"|"log_pos_block"|"spool_read"|"spool_removal"|"evidence_rename"|"rules_rewrite","mode":"full"|"normal","ids":[the event IDs a commit wrote]}`, `n` from 1 in each process); `cutAfter` (right after point `n`, the hub ends as by `kill -9`, losing every unsynced write); `syncDelayMs` (every sync takes this long); `refuse` (a path: while that file exists every write fails with an I/O error, as on a full disk). `{}` is the VFS with none of these. |
| `DEEP_HUB_TEST_CLOCK=<ms>` | the hub's clock starts at this time (ms since the epoch) and moves with real time |
| `DEEP_HUB_TEST_HEADROOM=<n>` | once ready, the hub takes file descriptors until the OS refuses one, then gives `n` back: its limit is its open count plus `n` (the test starts it under `ulimit -n 256`) |
| `DEEP_HUB_LAUNCHER=<executable>` | `deep hub start` runs it with the service definition's path instead of the service manager |

### deep-hook (#315), `deep mcp` (#26) and the app's client (#34), as these tests hold them

- **deep-hook** is invoked as an agent's hook entry runs it: `deep-hook <agent> <event>`, the agent's hook JSON on
  stdin, `HOME` as the agent's. It reads the hub's address from the setting, reads the hub's hello, sends one
  hook.request@1 line with only the features both sides list, and prints the reply; with the hub down, or on a
  refusal or a reply it can't parse, it does what it does with the hub down and spools the request to
  `$HOME/.deepbuild/spool/`. Its planted build, `cargo build -p deep-hook --features plant-f-test`, lists `f_test`
  among its features, sends it (as `"f_test": true`) only when the hub lists it, and, only in that build, sends it
  whatever the hub lists when `DEEP_HOOK_FORCE_F_TEST=1`.
- **`deep mcp`** is `deep mcp`, an MCP server on stdio (newline-delimited JSON-RPC) that reaches the hub at the
  setting's address with `{"v":1,"hello":"mcp","parent":…}` and answers `tools/call deep_status` with a result.
- **The app's socket client** has its tests at `crates/deep-app/tests/hub_client.rs`, run by
  `cargo test -p deep-app --test hub_client` with `HOME` set; they reach the hub at the setting's address.

## Readings where the issue and design leave a choice

- **One role per credential.** The hook role holds no credential; app and CLI share the control token and say which
  they are in the hello (the peer check, where the OS gives one, may confirm it); `deep mcp` presents its parent.
  `evidence.paste` is the app's alone: "chosen by you in the app", and a `deep` run in an agent's process tree acts
  as that agent. `mcp.call` is `deep mcp`'s alone.
- **Unverified.** An event whose claimed session fails any one check (transcript under the agent's home, working
  folder, process tree) is unverified (AC9 tests each alone). "Takes over" is read through what the session's
  credential does: the session's own next event still verifies, its `deep mcp` still binds its claims, and an
  impostor's `deep mcp` gets no session and can't claim. Recorded means it reads the same after a restart.
- **The Codex daemon (AC17).** A hook "run by hand in session A" is a hook whose parent is a shell the daemon
  started, not the daemon; B's binding is per call, by the PreToolUse stamped for it.
- **A scrub-list value (AC19)** is the hub's own control token, a value it holds (Privacy: "its own tokens"); the
  tests have no other way to put one on the list at this base. The large call's command holds it raw; its 16 MB
  output holds it in every form.
- **The injected token (AC21)** is the run token the supervisor starts every process with, `DEEP_RUN_TOKEN`; the
  run writes both values to a side file of the test's so the test knows what to look for.
- **The round trip** is from the request line written to the reply line read, on one connection after the hello,
  measured in a process of its own (`fixtures/load.mjs`). "Within 20 ms of its request being read" is measured from
  the request written, which can only be earlier. A reply "takes 50 ms" when it arrives 50 ms or more after.
- **"Answered or refused" (AC16)**: an ack and a reply, or an error line, or the connection refused, reset or closed;
  only a hook still waiting after 10 s fails.
- **The crash suite (AC3).** The hub's batching can move its point numbers a little from pass to pass, so the
  reference pass numbers them, each `cutAfter` pass that never reaches its point is run again (three tries), and
  each pass waits for every hook of a step to be readable before the next step. The design's own extra checks for
  the crash suite (failed writes, torn writes, evidence hashes, lost claims INVALID) are its, not this criterion's,
  and aren't here; the VFS's self-proof (a cut right after a NORMAL commit loses it) is, since the design makes it
  the VFS's condition for proving anything.
- **The budgets (AC12)** count only on a reference Mac (Mac15,7 or Mac15,12) on mains power, Low Power Mode off, no
  thermal warning; elsewhere each is skipped as INCONCLUSIVE, never passed. "Compared with the merge base" is the
  perf lane's: three tasks in `benchmarks/budgets.json` (`hub-cold-start`, `hub-round-trip`, `hub-idle`, each
  `["node","benchmarks/hub.mjs","<mode>"]` with a #16 `initialReason`), valid by `validateBudgets` against the merge
  base's file. Cold start is from spawning `deep hub run` to the socket answering. Thirty days of history are seeded
  into `<root>/ledger.db` through `@deepbuild/record` before the hub starts.
- **Retention (AC22)** runs at start; the day-0 files are put through `@deepbuild/evidence` on a day-0 clock and the
  decision and `transcript.archived` events appended through `@deepbuild/record` as the core, before the hub starts
  on day 31.
- **"Every stop records its reason" (AC7)** is the `hub.stopped` event; a `kill -9` can only be recorded at the next
  start. "Secret store and network still reachable" is `hub.health` reading the same after the terminal closed as
  before, `reachable` both times; on a machine where it reads otherwise even before, the test is INCONCLUSIVE.
- **IDs.** Each `describe` names its criterion's ID, `#16.<first 8 hex of SHA-256 of the criterion's text>` (the
  text trimmed, whitespace collapsed, the `- [ ] ` dropped), as the trace lane reads tags.

## Blind redrafts that replaced first drafts

Five first drafts couldn't pass on a correct hub, so each went to a blind redraft of this job (design:
Dogfooding). On October 21 the owner approved each redraft in place of its first draft, and the first drafts
were removed:

| Criterion | First draft (removed) | Why it couldn't hold | Redraft | Notes |
|---|---|---|---|---|
| AC3 | `crash.test.ts` | compared tables with `JSON.stringify`, which throws on the record's BigInt rows; raced a killed hub's exit event | `crash-redraft.test.ts` | `AC3-REDRAFT.md` |
| AC14 | `hotpath.test.ts` AC14 | its failure message could never name the call: Vitest shortens arrays in a message | `hotpath-ac14-redraft.test.ts` | `AC14-REDRAFT.md` |
| AC15, the writer clause | the writer `describe` in `roles.test.ts` | the record refuses a `tool.before` from writer `app`, so the planted hub stored nothing and the test timed out in its setup | `writer-redraft.test.ts` | `AC15-WRITER-REDRAFT.md` |
| AC18 | `hotpath.test.ts` AC18 | timed from the request written after the hello, so a held event loop showed no late reply unless one was in flight | `hotpath-ac18-redraft.test.ts`, `fixtures/load-ac18.mjs` | `AC18-REDRAFT.md` |
| AC19 | `hotpath.test.ts` AC19 | the same, for the acknowledgements beside the 16 MB call | `hotpath-ac19-redraft.test.ts`, `fixtures/load-held.mjs` | `AC19-REDRAFT.md` |

The rest of this README describes the first drafts as written; where it names a removed file, the redraft above
holds that criterion now.

## Criteria to tests

Each test's name starts with its criterion's number. Where a criterion names a wrong program, a test headed
`(wrong program)` runs the same scenario against the planted hub and expects the same assertion to fail, naming what
the criterion says; the scenario itself must run (a plant that doesn't start fails that test, not passes it).
Every every/never/only rule that fits one is a `fast-check` property from the recorded seed 16.

| ID | Criterion (short) | Tests |
|---|---|---|
| AC1 `#16.90def3b3` | two hub starts at once leave exactly one hub | `lock.test.ts` AC1 (2): two `deep hub run` at once, 5 rounds (one ready, one exits non-zero, the socket is the survivor's); two `deep hub start` at once through the service, one launched hub left |
| AC2 `#16.818c41e7` | every client takes the address from one setting; each passes through a forwarded socket | `address.test.ts` AC2 (4): the CLI (`deep hub status` through the forward, exit 3 naming the address when it's gone); deep-hook (#315); `deep mcp` (#26); the app's client tests (#34) |
| AC3 `#16.dcb0bc5f` | cut at each durable write point of a 200-event scenario: FULL commits kept, no ID twice, no `log_pos` reused, spooled events once, projections equal rebuild, an in-flight run `stopped` (hub restarted) and run again | `crash-redraft.test.ts` (redraft; see above) |
| AC4 `#16.e6b88436` | the socket isn't readable by another user | `socket.test.ts` AC4 (2): the installed and a dev hub under umask 000: mode 0600 and your uid from the first moment the socket exists, after hooks, and on the next start |
| AC5 `#16.a89956a3` | kill -9 leaves no blocking lock; a stale PID file never stops a start | `lock.test.ts` AC5 (6): three kill -9 and restarts within 5 s with the old socket left behind; five PID-file names, each with a live and a dead PID (the live program left running) |
| AC6 `#16.a88e65ab` | a dev hub runs beside the installed one; sessions that didn't opt in reach the installed one | `address.test.ts` AC6 (2): own socket, ledger, evidence and token, each hub records only its own; with the dev hub up, the CLI, deep-hook (#315) and `deep mcp` (#26) from a worktree reach the installed hub, the dev hub records nothing |
| AC7 `#16.d8339694` | closing the terminal leaves the hub running, secrets and network reachable; every stop records its reason | `service.test.ts` AC7 (2): `deep hub start` from a shell in its own session, the service definition, a hangup and kill of the terminal's group and a hangup to the hub; SIGTERM, SIGINT, `hub.stop` and kill -9 each recorded with its reason |
| AC8 `#16.29f3d795` | when an append fails, claims aren't acknowledged and every gate turns watch-only, BLOCKED, until appends work | `blocked.test.ts` AC8 (1): refused writes, `deep_claim` refused, gates watch-only with a BLOCKED reason, both back once writes succeed |
| AC9 `#16.077ffde2` | an event claiming a session it can't be checked against is unverified and never takes it over | `sessions.test.ts` AC9 (3): another process, another working folder, a transcript outside the agent's home, each alone |
| AC10 `#16.03f71eb5` | no network port of the hub's own | `socket.test.ts` AC10 (1): no TCP or UDP socket in the hub's process, idle and after hooks, a paste and a run (plug-in half: below) |
| AC11 `#16.7fa39565` | seq "9223372036854775808", "-1", "0123" or the JSON number refused naming the field and why, nothing appended | `protocol.test.ts` AC11 (6): the four cases, the in-range stamps read back as the same strings, a 1,000-case property over canonical, out-of-range and malformed forms |
| AC12 `#16.6034dec3` | budgets on the reference Mac, against the merge base | `budgets.test.ts` AC12 (7): the perf lane's tasks valid against the merge base, each bench runs; cold start < 500 ms, round trip p95 < 2 ms, idle CPU < 0.5% and RSS < 150 MB with 30 days |
| AC13 `#16.4e090bc0` | every socket message is one JSON line with a version field | `protocol.test.ts` AC13 (4): every line to every role, refusals and frames included; no `v` refused naming `/v`; lines read whole however they arrive; a 1,000-case property over request sequences cut anywhere |
| AC14 `#16.82e2f65c` | during 1,000 hooks the main-thread preload finds no child_process call, directory read or process listing; a `git rev-parse` plant fails naming the call | `hotpath-ac14-redraft.test.ts` (redraft): the run; the wrong program |
| AC15 `#16.ffcc7e73` | the role table, every cell exercised; a hook connection refused stream, answer and `deep off`; writer `hook` whatever the payload says | `roles.test.ts` AC15 (48): 40 cells, 4 `hub.stop` cells on hubs of their own, the hook connection's three refusals, the control token; the writer and its wrong program in `writer-redraft.test.ts` (redraft) |
| AC16 `#16.689b55b1` | a second start exits on the lock and the next hook reaches the first hub; 50 hooks at open count + 4 each answered or refused | `lock.test.ts` AC16 (4): the second start, its wrong program; the burst, its wrong program |
| AC17 `#16.7d3e3988` | a hand-stamped SessionEnd for B in A on one Codex daemon is unverified, B's `deep_claim` still binds | `sessions.test.ts` AC17 (2): the daemon; the wrong program |
| AC18 `#16.0edb254f` | with every sync held 50 ms, round trip < 2 ms p95 and no reply 50 ms, beside ten FULL verdicts, a checkpoint and a 50,000-event backfill | `hotpath-ac18-redraft.test.ts` (redraft): the run; the wrong program |
| AC19 `#16.8f097301` | a 16 MB output with a scrub-list value: others' acks within 20 ms, round trip < 2 ms p95, its event once, catalogue fields only, no form of the value | `hotpath-ac19-redraft.test.ts` (redraft): the run; the wrong program |
| AC20 `#16.769081da` | `deep_evidence` with `origin: deepbuild` stores agent; a paste stores you | `evidence.test.ts` AC20 (3): the two files; the wrong program; a 40-case property over payload origins |
| AC21 `#16.dfe5f026` | a run's output has neither its injected token nor its 24-character BUILD_ID in any form #15 names | `evidence.test.ts` AC21 (2): two seeds; the wrong program |
| AC22 `#16.6e2b63bc` | on day 31 the pass removes an uncited day-0 file and keeps a decision's and an archived transcript | `evidence.test.ts` AC22 (2): the pass; the wrong program |
| AC23 `#16.6279113a` | a deep-hook built with planted `f_test` sends none, is decided as before; forced, refused naming the field, acts as with the hub down | `features.test.ts` AC23 (2): the run; the wrong program |

The first drafts had 110 tests in 13 files, each failing at the base (BASE-FAILURE.txt); each redraft's notes hold its own base run.

## Wrong programs

Each is a planted twin of the hub, selected with `DEEP_HUB_PLANT=<name>` on `deep hub run`. Exactly these, one per
"a hub that … fails" in the criteria:

| Name | Criterion | What the plant does | How the test fails on it |
|---|---|---|---|
| `writer-from-payload` | AC15 | stamps the payload's `writer` on the event | the event reads writer `app`; the failure names the event's ID |
| `unlink-before-lock` | AC16 | a second start unlinks `hub.sock` before taking the lock | the next hook can't reach the first hub |
| `accept-stops-at-emfile` | AC16 | stops its accept loop at the first EMFILE | hooks hang, or the hook after the burst isn't answered |
| `ends-binding` | AC17 | lets an unverified SessionEnd end the session's binding | B's `deep_claim` doesn't bind; the failure names B's session ID |
| `git-in-hook-handler` | AC14 | runs `git rev-parse` in its hook handler on the main thread | the preload records it; the failure names `git rev-parse` |
| `commit-on-event-loop` | AC18 | commits through the synchronous binding on the event loop | replies wait for the 50 ms syncs; the failure names the first late reply's ID |
| `parse-on-event-loop` | AC19 | parses and scrubs hook lines on the event loop | the 16 MB line holds other acks past 20 ms; the failure names the first late one's ID |
| `origin-from-payload` | AC20 | passes the payload's `origin` to the store | `shot.png` is stored with origin deepbuild; the failure names the file |
| `no-run-values` | AC21 | hands the store no run values | both values stay in the output; the failure names the run |
| `empty-cited` | AC22 | hands the retention pass an empty set of cited hashes | the decision's file is removed; the failure names its hash |
| `ignores-unknown-field` | AC23 | ignores a request field it doesn't know | no refusal naming `/f_test` |

The base itself is the wrong program for the whole suite (BASE-FAILURE.txt).

## What depends on other issues

The tests hold each part to the surface above whoever builds it; until then the part's test fails, as at the base.

- **deep-hook's forwarding (#315)**: AC2's deep-hook test, AC6's second test and AC23 (with its `plant-f-test` cargo
  feature and `DEEP_HOOK_FORCE_F_TEST`). #315 depends on this issue, so this issue's PR can't close those without it
  landing first or together; the rest of #16 is testable over the socket alone.
- **`deep mcp` (#26)**: AC2's `deep mcp` test and AC6's second test. The hub's half (the mcp hello, binding, `deep_claim`,
  `deep_evidence`) is this issue's and is exercised through the protocol stand-in in AC9, AC15, AC17 and AC20.
- **The app's socket client (#34)**: AC2's app test (`crates/deep-app/tests/hub_client.rs`).
- **Codex's SessionEnd (#39)**: Codex's facts don't list SessionEnd at this base; AC17 needs the hub to record a
  Codex SessionEnd as an event (with its `id`) either way.
- **The OS confirmation (#19)**: not needed by any criterion here; `deep hub use` and an installed hub's
  `deep hub stop` aren't exercised.
- **AC10's second half**, inbound traffic only through a plug-in you turned on exposing only the routes you chose,
  needs the extension host, which has no surface at this base. On October 21 the owner moved it to #348, the
  extension host; AC10 here holds the hub's half (no port of its own), which is tested.

## Fixtures

- `fixtures/agent.mjs`: an agent process (a Claude Code session, or Codex's shared daemon) that runs, as its own
  children, the protocol stand-ins in `fixtures/client.mjs`: `hook` (a deep-hook carrying one request, its `pid` and
  `ppid` its own) and `mcp` (a `deep mcp` connection presenting this agent as its parent); a hook can also go through a
  shell it starts ("run by hand").
- `fixtures/launcher.mjs`: the service manager's stand-in for `DEEP_HUB_LAUNCHER`.
- `fixtures/preload.mjs`: the main-thread recorder for AC14.
- `fixtures/load.mjs`: the 30 scripted sessions of AC18 and AC19, in a process of their own.
- `fixtures/print-env.mjs`: AC21's run; `fixtures/sleeper.mjs`: AC3's in-flight check run.

Sessions' transcripts, worktrees, PNGs, the 50,000-line transcript and every planted value are made at run time from
seeds; no fixture holds a secret or personal data, and no path is a real home path.

## Files

- `helpers.ts`: temp homes, the hub as a process, the line-protocol client, the agent stand-in, the forwarder, the
  forms of a scrub-list value, the reference-Mac gate and the timing judge.
- `lock.test.ts`, `socket.test.ts`, `protocol.test.ts`, `roles.test.ts`, `sessions.test.ts`, `evidence.test.ts`,
  `crash.test.ts`, `blocked.test.ts`, `hotpath.test.ts`, `budgets.test.ts`, `address.test.ts`, `service.test.ts`,
  `features.test.ts`: the criteria above.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit, where every test fails because no `deep hub` command exists.
