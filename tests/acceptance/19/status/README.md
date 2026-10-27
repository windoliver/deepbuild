# Acceptance tests for #19: status, the debug bundle, budgets and the canary sweep

Written first, blind, from issue #19 (its body as of October 27, 2026), the design sections it links and those around
them (How it installs; One hub per user, a tiny hook client, and extensions in-process; Hooks are evidence, not a
state machine; Sessions that know about each other; States people see; Privacy; Numbers version 0 has to hold; Socket
roles and contract versions; the deep CLI row of the components table) and base commit `0350cf0`, by a job that never
saw an implementation of #19. The implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to
a blind redraft of this job.

The issue has 25 checkbox criteria, AC1 to AC25 in the body's order. **This folder covers AC7, AC8, AC17 and AC25.**
Three other blind jobs cover the rest in sibling folders under `tests/acceptance/19/`.

## How to run

With Node 24.22 first on `PATH` (`.node-version`), the workspaces built and deep-hook built:

```sh
npm ci                                            # once, if node_modules is missing
npm run build --workspaces                        # the tests run packages/cli/dist/main.js and the hub it starts
cargo build --locked -q -p deep-hook              # canary.test.ts builds it too, before its first test
npx vitest run --root tests/acceptance/19/status --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/19/status/tsconfig.json
```

- `--no-file-parallelism`: the files start real hubs, time `deep` commands and build deep-hook with cargo.
- Every test makes its folders under `/tmp/dh19t-*` (a socket path must fit in 104 bytes on macOS), sets `HOME` to
  `<tmp>/h` for every process it starts, and never touches the real `~/.deepbuild`, `~/.claude`, `~/.codex` or
  `~/Library/LaunchAgents`. It stops only processes it started, by PID, never by name or port. No child inherits a
  billing key or a `CLAUDE*`, `CODEX*`, `OTEL_*` or `DEEP_*` variable of the runner's; a test sets the ones it needs.
- `<tmp>/bin` is first on `PATH` with stand-ins for `claude`, `codex`, `launchctl` and `systemctl`
  (`fixtures/agent-bin.sh`): each logs its call and exits 0, so nothing registers a login service, starts a session
  or sends a prompt. No network, no GitHub; git only for the perf lane's `git merge-base HEAD origin/main`.
- With `--root` here, Vitest writes its cache to `tests/acceptance/19/status/node_modules/.vite/`; delete it before
  committing.
- The suite takes under a minute at the base; with #19 in, AC17's two timed tests add five runs each, and its
  perf-lane test runs the two benchmark commands.

## The surface

### Merged surfaces, used as their suites define them

- **The hub**: `deep hub run [--root <folder>]` with `HOME` the temporary home, its ready line, its socket's line
  protocol, a `cli` connection with the control token from `<root>/control.token`, `events.read` (#16). Its stdout and
  stderr go to `<root>/logs/hub.log`, as the login service setup installs sends them (#16's service definition), so
  whatever the hub prints is a log under the state folder. `DEEP_HUB_PLANT=<name>` selects a planted program, and a
  name the hub doesn't know makes it exit at start.
- **The address setting** `{"hub": {"address": "unix:<path>"}}` in `~/.deepbuild/config.json`, which "deep-hook,
  `deep mcp`, the app and the CLI all read" (#16, `packages/hub/src/paths.ts`).
- **The record**, seeded with the hub stopped through `@deepbuild/record` (`openRecord` on `<root>/ledger.db`,
  `append`, `table`) and `@deepbuild/asks` (`openAsks`, `raise`), as the hub's hooks, core and asks core would write it.
- **deep-hook** as a settings entry runs it: `deep-hook claude-code <event>`, the hook JSON on stdin, `HOME` the
  agent's; with no hub it spools the request to `<root>/spool/` and the hub replays the spool when it starts (#315).
- **`deep doctor --json`**: one `doctor.item@1` per line, each with a `fix` (#18, #19's other folders).
- **`deep debug bundle`** prints the bundle's path last and writes it under `<root>/debug/` (#34's slice, in the base).
- **`deep setup`** with the stand-ins on `PATH` (#18), only to give AC17's doctor an installed home.
- **The perf lane**: `benchmarks/budgets.json` and `validateBudgets` in `scripts/benchmark.mjs` (#16, #24, #319).
- **#15's gitleaks fixture** (`tests/acceptance/15/gitleaks.ts` and the pinned v8.30.1 config), imported to generate a
  key for every rule; and #15's forms of a scrub-list value (raw, URL-encoded with hex of either case, base64 at byte
  offsets 0, 1 and 2 in both alphabets), copied into `helpers.ts`.

### Defined here, where the issue and the design leave a surface open

1. **What `deep status` prints** (AC8, AC17). The issue and the design name the content, not the layout, so the tests
   read only this much:
   - A session is shown when a line holds the first 8 characters of its ID (case ignored). Rows may say anything else.
   - **Grouped by repo**: a shown session's row names its repo, or the nearest line above it that names a repo names
     its repo. The repo is the project its events carry (the record's `project_id`); a name counts as a word, not
     inside another word.
   - **Quiet folded**: no quiet session is shown on a line of its own, and the numbers `N` in every `N quiet` (case
     ignored) add up to the quiet sessions. One line in all, or one per repo, both pass.
   - **Which hub it reads**: the output names the hub's root folder or its socket (`<root>/hub.sock`, or
     `unix:<root>/hub.sock`), with or without `/private`, and with your home written as `~` or not. With the hub down
     it reads the database read-only (design: the deep CLI row) and names the root it read.
   - It exits 0 when it read the sessions (the exit-code table's "ok").
2. **What the bundle holds** (AC7, AC25). The file `deep debug bundle` prints last, gzip or not, holds the hub's log
   lines (scrubbed) and the doctor's output: each item `deep doctor --json` prints, found by its `fix` text. The tests
   search its bytes and, when it is JSON, every string in it decoded.
3. **States** (AC8), from the design's States people see and Sessions that know about each other:
   - *needs you*: the session has an open ask.
   - *stuck*: the record's session status is `stuck`: a failed stop whose `owner` is `you` or `service` (the
     record's projection), or `session.attention` `stuck`.
   - *flagged*: one of the design's flags the record can carry today, "a session that ended without a claim because an
     app quit or a usage limit hit": a failed stop on `plan_window_spent` or `agent_crashed` with no claim, and a
     session whose process is gone (`session.gone`) mid-turn with no claim.
   - *quiet*: its hooks went quiet (`session.attention` `unknown`) days ago.
   - *working*: a tool call in the last minutes.
4. **The 30 sessions** (`helpers.ts`, `THIRTY`): 3 need you (one with two asks), 3 stuck, 3 flagged, 2 working and 19
   quiet, in three repos (`orchard`, `quarry`, `tundra`) and both agents (Claude Code and Codex). The attention
   sessions' IDs sort last, most of them sit in the repos whose names sort last, and the quiet ones are appended to
   the log first, so a listing in log, ID or repo-name order without the attention sessions first and the quiet ones
   folded puts some past line 20. A right listing fits in 18 lines whichever way it groups (`status.test.ts`'s judge
   test writes one). A seed test reads the record back so a failure is about `deep status`, not the seed.
5. **The canary sweep** (AC25): `canary.test.ts`, below.

### Additions the implementation must make

| Addition | Where | Read by |
|---|---|---|
| `deep status`, printing as defined above, reading the hub at the address setting, or the database read-only with the hub down | `packages/cli` | AC8, AC17 |
| `DEEP_HUB_TEST_HELD=<absolute path>`: a file of values, one a line, that the hub holds by handle from its start (as it holds secrets and credentials env-local loads), so it scrubs each, in every form, from everything it writes: hook payloads it records live and from the spool it replays, logs and evidence. `deep debug bundle` reads the same variable and scrubs the same values. Set only by tests, like the hub's other `DEEP_HUB_TEST_*` settings | `packages/hub`, `packages/cli` | AC25 |
| Plant `log-raw-command` in the hub's list: it scrubs as the hub does everywhere, but writes each tool call's command, as the hook sent it, to a log under `<root>/logs/` (its own file, or its stderr, which the service sends to `hub.log`) | `packages/hub/src/wire.ts` | AC25 |
| `DEEP_CLI_PLANT=bundle-raw-logs`, read by `deep debug bundle`: it copies `<root>/logs/` into the bundle unscrubbed | `packages/cli` | AC7 |
| Perf-lane tasks `deep-status-30` (`deep status` on the 30 sessions over a month of history, with the hub up) and `deep-doctor` (`deep doctor` on an installed home with stand-ins), each a command run from the checkout's root that exits 0, valid by `validateBudgets` against the merge base's file, with an `initialReason` naming #19 (the merge base has no `deep status`, and no doctor task) | `benchmarks/budgets.json`, `benchmarks/*.mjs` | AC17 |
| `'tests/acceptance/19/status/'` in `alone` in `scripts/lanes.mjs`, so the local preflight's unit lane runs this folder one file at a time, as it runs #315's and #24's | `scripts/lanes.mjs` | AC17, AC25 ("in the local preflight") |

## The canary sweep (AC25)

`canary.test.ts`, run once as it is and once with the planted hub:

1. A temporary home, `rules.json` with no entries, `DEEP_HUB_TEST_HELD` naming a file that holds the scrub-list value,
   a fresh value each run (`plum+<hex>=orchid/<hex>`, so its URL-encoded and base64 forms differ from it). The key is
   a GitHub token (`ghp_` and 36 letters and digits), which the pinned gitleaks rules match.
2. **Hub up.** `deep hub run`, then through deep-hook: SessionStart, and a turn whose prompt, Bash command and output
   (the PostToolUse `tool_response` and the transcript Claude Code writes) each hold the value raw, URL-encoded and in
   base64, and the key. The test waits until the hub has recorded the prompt and the command, or deep-hook spooled
   them late on a loaded Mac (then they're recorded at the restart; the test logs which).
3. **Hub down.** SIGTERM; a second turn the same way; deep-hook spools it (at least three lines).
4. **Back up, synced.** The hub again, until `events.read` holds both turns' prompts and commands and no spooled line
   is left. Then `deep debug bundle` with the same variable.
5. **The sweep**, with the hub up (its WAL there) and again once it stops: every file under `<root>` (the ledger, its
   WAL, any spool left, logs, evidence, the bundle under `debug/`), and the bundle wherever it is, read as bytes and
   inflated when gzip, searched for every form of the value and the raw key. Each hit is `<file>: <canary> (<form>)`.
   The test fails on any hit, listing them.
6. **Planted:** with `DEEP_HUB_PLANT=log-raw-command` on both starts, the sweep must name a file under `<root>/logs/`
   holding the value raw.

## Criteria → tests → wrong programs

IDs are from `criteria.txt` (the first 8 hex digits of SHA-256 of each criterion's text, as `tests/acceptance/48`
computes them). Each test's name starts with its criterion's number and ID.

| # | ID | Test | Fails on | At the base |
|---|---|---|---|---|
| AC7 | `#19.a34ae696` | `bundle.test.ts` 1: a key for each of the 221 gitleaks rules in `logs/hub.log`, the control token, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `GITHUB_TOKEN` in the environment, an OTLP endpoint, header and a Slack token in `~/.claude/settings.json`'s env, a key in what `claude auth status` prints and in `codex login status`'s API-key line; the bundle holds a marker log line and every doctor item's fix, and none of the keys (the token in every form) | a bundle that copies a log, a setting, the environment or a sign-in command's output as it is; one that leaves the logs or the doctor out (the holding checks) | PASS: the base bundle holds the telemetry doctor and the scrubbed logs, and its doctor reads none of the new sources; kept as regression protection for #19's doctor items |
| AC7 | `#19.a34ae696` | `bundle.test.ts` 2 (wrong program) | plant `bundle-raw-logs`: the search names the log's keys and the token | FAIL: no such plant; the base bundle is scrubbed |
| AC8 | `#19.21db8bc2` | `status.test.ts` 1: the 30 with the hub up, then with it down from the database | a listing in log, ID or repo order (an attention session past line 20, named); no fold (a quiet session listed, named); no grouping; not naming the hub; not reading the database with the hub down | FAIL: `deep status` unsupported, exit 2 |
| AC8 | `#19.21db8bc2` | `status.test.ts` 2: a dev hub (`deep hub run --root`) at the address setting | a status that reads the installed hub's database regardless, or doesn't name the dev hub | FAIL: unsupported, exit 2 |
| AC8 | `#19.21db8bc2` | `status.test.ts` 3: the judge on planted twins written from the seed | it must fail a log-order listing, an unfolded one, an ungrouped one and one not naming the hub, and pass a right one | PASS (the judge alone) |
| AC8 | `#19.21db8bc2` | `status.test.ts` 4: the seed read back from the record | a seed the record reads differently | PASS |
| AC17 | `#19.26a1fd32` | `budgets.test.ts` 1: tasks `deep-status-30` and `deep-doctor` valid against the merge base, naming #19, and they run | no task, a changed frozen task, a command that fails | FAIL: no task `deep-status-30` |
| AC17 | `#19.26a1fd32` | `budgets.test.ts` 2: `deep status` on the 30 over 600 sessions of a month (7,200 events), five runs after a warm-up, each listing every attention session, under 200 ms and 100 MB peak (`/usr/bin/time -l`) | a slow or heavy status; one that drops attention sessions under load | FAIL: unsupported, exit 2 (before any machine check) |
| AC17 | `#19.26a1fd32` | `budgets.test.ts` 3: `deep doctor` on a home `deep setup` installed into, the hub up, under 2 s and 100 MB | a slow or heavy doctor | SKIPPED, INCONCLUSIVE: this Mac was on battery |
| AC25 | `#19.18335781` | `canary.test.ts` 1: the sweep | the value or key in the ledger, its WAL, a spool left, a log, evidence or the bundle, each hit naming the file | FAIL: the value raw, URL-encoded and in base64 in `ledger.db` and `ledger.db-wal` (the base hub holds only its token) |
| AC25 | `#19.18335781` | `canary.test.ts` 2 (wrong program) | plant `log-raw-command`: the sweep names `<root>/logs/…` | FAIL: the hub exits at start, `DEEP_HUB_PLANT=log-raw-command names no planted program` |

"Compared with the merge base" is the perf lane's: it compares p50 and peak memory with the merge base once main has
these tasks. The limits are judged in `budgets.test.ts` on a reference Mac (Mac15,7 or Mac15,12) on mains power, Low
Power Mode off, no thermal warning and the 1-minute load at most the core count; anywhere else the timed part is
skipped as INCONCLUSIVE with the reading, never passed. Each timed test first runs its command once anywhere, so a
missing command fails on any machine.

No sample implementation was run: the passing side of each test, and each plant's failure, are unverified until the
implementation exists. `BASE-FAILURE.txt` holds the base run.

## Disputes and readings

- **The scrub-list value needs a seam.** The hub's scrub list is the values it holds by handle (design: Privacy). At
  the base the only one is its control token, which changes at every start, so a value spooled while the hub is down
  could never be on the next hub's list. `DEEP_HUB_TEST_HELD` stands in for a secret held by handle that outlives a
  restart (the secrets and credentials env-local loads, which #19 doesn't build). `deep debug bundle` reads it too,
  since the bundle is the CLI's and must scrub what the hub holds; an implementation that asks the hub instead may
  ignore it in the CLI, as long as the bundle holds no form.
- **"Stuck" and "flagged"** are read as in States above. The design's other two flags, two sessions on one issue and
  idle work not on any remote branch, aren't seeded: the record carries no issue on a session at the base, and the
  second needs a git remote. The test doesn't check which word a row uses, only that each attention session is within
  the first 20 lines.
- **Quiet** is a session whose hooks went quiet days ago (`session.attention` `unknown`, the schema's "unknown when its
  hooks went quiet"). Finished sessions aren't in the 30, since the design doesn't say whether one counts as quiet.
- **One fold line or one per repo** both pass: the issue says "one line", the sidebar groups by repo.
- **`deep status` exits 0** with the hub up or at a dev hub. With the hub down and the database there it must run
  (not exit 2) and show the same; its exit code there is AC16's folder's.
- **Which hub** is checked with the installed hub, with it down, and with a dev hub named by the address setting. How
  `deep hub use --root` records a worktree's choice is AC22's; this folder reaches a dev hub through the one setting
  every client already reads.
- **AC7 at the base passes**: `deep debug bundle` exists and scrubs. The test guards #19's additions (sign-in, billing
  and settings items) against carrying a key into the bundle; the plant proves the search fails on a bundle that
  doesn't scrub.
- **100 MB** is read as 100 MiB (104,857,600 bytes), the peak resident size `/usr/bin/time -l` reports for the
  `deep` process.
- **The month behind `deep status`'s budget** is #16's heavy month (20 sessions a day for 30 days), each session with
  a prompt, eight tool calls and a finished stop, then quiet: the design's numbers are "with 30 days of history".

## Files

- `helpers.ts`: temp homes, stand-ins and cleanup by PID; `deep`; the hub with its log under the root; the socket and
  `events.read`; the seeder and the 30 sessions; the status judge; the bundle reader; the forms and the sweep;
  deep-hook and its payloads; the budget rule and `/usr/bin/time -l`.
- `fixtures/agent-bin.sh`: the stand-in for `claude`, `codex`, `launchctl` and `systemctl`.
- `bundle.test.ts` (AC7), `status.test.ts` (AC8), `budgets.test.ts` (AC17), `canary.test.ts` (AC25).
- `tsconfig.json`: type-checks the folder under the root's strict options with `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run at the base.
