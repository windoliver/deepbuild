# Acceptance tests for #666: a real Claude Code session's hooks reach the record through deep-hook and the hub

Written first, from issue #666 (its text as of October 24, 2026: Scope, the five checkbox criteria, Proof and Depends
on; it has no comments), the design sections it links (Hook protocol (deep-hook and the hub); One hub per user, a tiny
hook client, and extensions in-process), the READMEs of the suites whose surfaces it drives (#670, #315, #16, #14,
#48), and base commit `0b41a19` (origin/main), by a job that never saw an implementation of #666; none existed. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

What was read at the base, beyond the READMEs: `crates/deep-hook/src/main.rs`, `packages/hub/src/{hookmap,core,wire,server}.ts`,
`packages/record/src/index.ts`, `scripts/agent-harness.mjs` and its hook, `adapters/claude-code.facts.json`,
`scripts/lanes.mjs` and `scripts/repo-rules.mjs`.

## How to run

With the repo's Node (`.node-version`, 24.22.0) and Rust toolchain:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the tests run the built CLI, packages/cli/dist/main.js
npx vitest run --root tests/acceptance/666 --no-file-parallelism fast.test.ts
DEEP_HARNESS_LIVE=1 npx vitest run --root tests/acceptance/666 session.live.test.ts   # by hand only: spends plan usage
node node_modules/typescript/bin/tsc -p tests/acceptance/666/tsconfig.json
```

- **Fast tests** (`fast.test.ts`) start no agent and spend nothing. They build `target/debug/deep-hook` with cargo,
  start real hubs and fire a made-up session's hooks through the same settings, hook command and deep-hook as the
  live session uses. About three minutes; a cargo build waits on `~/.cargo`'s package lock while other worktrees build.
- **Live tests** (`session.live.test.ts`) start real Claude Code sessions through the agent test harness, on your
  own sign-in, with the harness's Haiku launch. Without `DEEP_HARNESS_LIVE=1` (#48's opt-in, reused: one switch for
  every test that spends plan usage) each fails with `BLOCKED` in its message; nothing skips. They build
  `target/release/deep-hook`, the binary an install runs.
- `scripts/lanes.mjs` needs two entries this job didn't make (it edits nothing outside this folder): this folder in
  `alone` (the files start hubs and time hooks to 50 ms, as #315's do), and `tests/acceptance/666/session.live.test.ts`
  in `byHand` (or a lane of its own that runs it with the opt-in in the local preflight on the reference Mac, as the
  issue's scope asks). Without the second, the unit lane runs the live file and it fails as BLOCKED there.
- Every test makes its folders under `/tmp/dh666-*` (a socket path must fit in 104 bytes), gives the hub and deep-hook
  a temporary `HOME`, never touches the real `~/.deepbuild`, and stops only processes it started, by PID. No child
  inherits a billing key or a `DEEP_` setting, except the one session that sets the made-up `ANTHROPIC_API_KEY`.
- With `--root` here, Vitest writes its cache to `tests/acceptance/666/node_modules/.vite/`; delete it before committing.

**The proof** is written to `$TMPDIR/deep-666-proof/` (`PROOF_DIR`, `os.tmpdir()`), rewritten on each run and never
read back (delete it first to keep one run's proof). Per live session (`live-killed/`, `live-stopped/`, `live-keyed/`):
`record.json` (each event with its `seq` stamp and `log_pos`), `transcript.jsonl` (the session's transcript, the
harness's copy), `spool-before.json` and `spool-after.json` (the spool's files byte for byte, and its requests, before
and after its replay), `hooks.json` (each hook with its measured return time, spawn to exit, its exit code and
deep-hook's stderr), `hub.log`, `run.json` (the harness's run line) and `machine.txt` (model, chip, memory, power,
load). `live-killed/kill.json` adds when the hub was killed and started again, the events served before the kill and
the acknowledgements the forwarded socket saw. The planted runs write `live-replay-*/` and the fast tests `fast-*/`
(`record.json`, `problems.json`). The keyed session's key never goes into the proof: its SHA-256 does
(`live-keyed/key.json`), and every file there has the value, wherever it occurs, replaced by its hash.

`BASE-FAILURE.txt` is the run at the base.

## The surface under test

The tests drive what #16, #315, #14 and #48 already fixed, and add only what this issue needs.

### Merged surfaces used as their suites define them

- **deep-hook**: `deep-hook claude-code <Event>`, the hook's JSON on stdin, `HOME` the temporary home, so it reads the
  address setting and spools under `<home>/.deepbuild` (#315).
- **The hub**: `deep hub run` with `HOME` the temporary home; its ready line; its socket's line protocol; a `cli`
  connection with the control token; `events.read` paged by `log_pos`; `DEEP_HUB_PLANT=<name>` selects a planted hub,
  and a name the hub doesn't know makes it exit at start (#16). The hub's log is what it writes to stdout and stderr.
- **The address setting** `{"hub": {"address": "unix:<path>"}}` in `<home>/.deepbuild/config.json`, through which
  every client reaches a forwarded socket (#16 AC2). Only the killed session uses it (Readings, AC3).
- **The spool**: `<home>/.deepbuild/spool/*.jsonl`, one request line per spooled hook, as sent (#315).
- **The record**: `@deepbuild/record`'s public entry (`packages/record/src/index.ts`): `openRecord`, `PROJECTIONS`,
  `table`, `rebuild`, on a copy of `ledger.db` and its WAL once the hub has stopped (#14, as #16's AC3 does).
- **Claude Code's facts** (`adapters/claude-code.facts.json`): the hook events of the newest covered version (the
  settings run deep-hook for each), the event kind each maps to, and each tool's kind.

### The temporary home, and how Claude Code's settings meet it

Claude Code's sign-in is in the real user's macOS keychain: under a temporary `HOME` or `CLAUDE_CONFIG_DIR` it is
signed out. So Claude Code keeps the real `HOME`, and the temporary home is DeepBuild's and the settings':

- `<tmp>/h/.deepbuild/` is DeepBuild's home: the hub's root, deep-hook's spool, its address setting.
- `<tmp>/h/.claude/settings.json` is the session's user settings file: for every event in the facts' newest version
  (SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, PostToolUseFailure, Stop,
  StopFailure, SessionEnd, SubagentStop, TaskCompleted) one command hook,
  `node tests/acceptance/666/fixtures/timed-hook.mjs <config> <Event>`. The harness gives these hooks to the session
  (`--hooks`, below), since the real user settings can't move.
- `fixtures/timed-hook.mjs` runs `deep-hook claude-code <Event>` with `HOME` set to the temporary home, passes the
  hook's stdin, deep-hook's stdout, stderr and exit code through unchanged, and appends one line to `<tmp>/hooks.jsonl`:
  the event, the hook's input, the wall-clock times of deep-hook's spawn and exit, and the time between them. That is
  "each hook's measured return time": from the spawn to the exit of deep-hook as the agent's hook entry runs it, as
  #315 times it. The command's own start-up (Node) is outside that time and isn't DeepBuild's.

### The fixture repo

`fixtures/checkout-web/` (a README, a page and one script) is copied for each session into `<tmp>/checkout-web` and
made a fresh git repo with one commit. The copy also gets `.claude/settings.json` and `.claude/settings.local.json`,
each a hook that writes a tripwire file outside the repo. A session that ran either ("a repo's own settings") is
INVALID evidence for every criterion. They are written at run time: this repo keeps no hooks in any settings file
(repo-rules `agent-hooks`).

### Additions the implementation must make

1. **A harness scenario**, `add-readme-line`, in `scripts/agent-harness.mjs`:

   ```
   node scripts/agent-harness.mjs run --scenario add-readme-line --workdir <dir> --hooks <settings.json>
        [--pass-env <NAME>]... [--timeout-ms <n>] [--out <dir>] [--claude <path>]
   ```

   - Runs Claude Code from its facts' session launch: interactive, in a pseudo-terminal, never `-p` (which ends async
     hooks at teardown), Haiku, the version gate and sign-in check as today (a version the facts don't cover is
     BLOCKED). The session runs in `--workdir`, an existing folder the harness neither makes nor removes.
   - The session's hooks are the `hooks` object of the `--hooks` file, unchanged, in the `--settings` file it uses;
     the harness may add hooks of its own beside them, never remove or rewrite one.
   - The session loads none of the workdir's settings: no `project` or `local` setting source (the facts' session
     launch today has `--setting-sources project`, which would load `checkout-web/.claude/settings.json`).
   - Once the session is ready it types `Read the README and add one line to it.`; the edit runs without a person
     answering a prompt; the harness ends the session once that turn has stopped.
   - `--pass-env NAME` (repeatable) passes that variable from the harness's own environment into the session's, and
     nothing else beyond today's allowlist; its value is never printed. With `ANTHROPIC_API_KEY` passed, the session
     uses the key, so its model calls fail and spend nothing.
   - It prints #48's run line. `verdict` is `PASS` when the turn ended with Stop, `FAIL` when it ended otherwise;
     `workdir` is the real path of `--workdir`; `sessionId` and `transcript` (its copy) are the session's.
2. **Two planted hubs**, selected with `DEEP_HUB_PLANT` on `deep hub run`, listed in `packages/hub/src/wire.ts`'s
   plants:
   - `drops-post-tool-use`: acknowledges and answers every hook as the hub does, and appends nothing for the first
     PostToolUse request it reads.
   - `replay-appends-twice`: replays the spool as the hub does, and appends the first replayed event a second time: a
     second event with the same session, kind and `seq`, under the same ID or a new one.
3. **Claude Code 2.1.310 in the facts**, or a covered version on the machine, for any live test to get past BLOCKED.

## Spending

Three real sessions cover the five criteria; one of them spends nothing.

| Session | Hub | Criteria |
|---|---|---|
| killed | up, reached through a forwarded socket; SIGKILLed as soon as the first tool call's PostToolUse has returned; started again once the session stops | AC1, AC3, AC5 |
| stopped | started and stopped (SIGTERM) before the session; started once it stops | AC1, AC2, AC5 |
| keyed | as stopped; the harness passes a made-up `ANTHROPIC_API_KEY`, so the model calls fail | AC4, AC5 |

The two planted programs don't start sessions. `drops-post-tool-use` is fed the killed session's recorded hook inputs,
run again in order through the same settings command and the real deep-hook into a fresh home whose hub is up
throughout (and, as the control, into the merged hub). The check is the same one, on the same transcript, so the
program it must catch is the hub, not a made-up stream. `replay-appends-twice` replays the stopped session's spool,
copied byte for byte into a fresh home. Each session is made once per file run and shared by the tests that need it.

## Criteria to tests

IDs are `#666.<first 8 hex of SHA-256 of the criterion's text, trimmed, whitespace collapsed, the leading "- [ ] "
dropped>`, computed with #48's command. Each `describe` names its ID; each check's every message starts with it.

| ID | Criterion (short) | Live test | Fast test | Wrong program it fails on |
|---|---|---|---|---|
| AC1 `#666.fa419b94` | every hook in the record once, under the session's ID, in stamp order; SessionStart first, a PreToolUse and a PostToolUse per tool call, Stop | AC1 on the killed and the stopped session; AC1 (wrong program): the killed session's hooks fed to the merged hub and to `drops-post-tool-use` | AC1 (control) and AC1 (wrong program) on the made-up session | `drops-post-tool-use`: "the PostToolUse of call <tool> (<tool_use_id>) … is not in the record"; also a hub or deep-hook that loses, doubles, reorders or misfiles a hook |
| AC2 `#666.d0fc950d` | hub stopped: the session runs to its stop, each hook within 50 ms; every spooled event in the record once, in stamp order | AC2 on the stopped session; AC2 (wrong program): its spool replayed by `replay-appends-twice` | AC2 (control) and AC2 (wrong program) | `replay-appends-twice`: "spooled event <ID> (…) is in the record 2 times"; a deep-hook that waits on the missing hub; a replay out of stamp order |
| AC3 `#666.7359ccd1` | SIGKILL between two tool calls, restart: every acknowledged event in the record, log positions only increase, the hooks run while down arrive from the spool | AC3 on the killed session | AC3 (control) | a hub that acknowledges before an event is durable and loses it to the kill; one that renumbers or reuses `log_pos`; a spool that drops what ran while the hub was down |
| AC4 `#666.be202da6` | `ANTHROPIC_API_KEY` set: SessionStart says so; its value in no record row, spool file or hub log | AC4 on the keyed session (and the other two sessions read false) | — (#315's AC3 holds deep-hook's half with made-up hooks) | a constant true (the other sessions must read false); a value anywhere, raw or in #15's forms |
| AC5 `#666.95eb0939` | projections rebuilt from the log equal the live ones | AC5 on all three sessions' ledgers | AC5 (control), AC5 (mutant) | a projection that drifts from its log; the mutant (a copy whose live projection lost a row) shows the comparison names the table |

A live test whose session is BLOCKED (no scenario, an uncovered version, no sign-in, no opt-in) fails as BLOCKED; one
whose session loaded the repo's own settings fails as INVALID; one whose evidence can't reach a clause (no tool call
in the transcript, no hook while the hub was down, a kill that didn't fall between two calls) fails as INCONCLUSIVE.

## Readings where the issue and design leave a choice

1. **The temporary home** (above): DeepBuild's home and the user settings file are temporary; Claude Code's `HOME`
   is the real one, since its sign-in is in the keychain. The settings reach the session through the harness's
   `--hooks`. The session must load neither of the checkout's settings files; whether it loads the real user's
   `~/.claude/settings.json` too isn't tested (no criterion reads it), but a launch that loads it runs your own hooks
   in the session beside deep-hook.
2. **"Every hook event"** is every event Claude Code's facts list for their newest version, the events the adapter
   maps. Claude Code has more (Notification, PreCompact, WorktreeCreate, …); the hub maps none of them to an event
   kind, and some (WorktreeCreate) take over what Claude Code does, so the settings don't register them.
3. **"Every hook the session fires"** is every deep-hook run the timed command logged to its exit. A hook the
   harness killed before deep-hook exited (a SessionEnd at its cleanup) never returned and isn't held.
4. **Which record event is which hook's.** The hub records a tool call's kind, paths and command, not its
   `tool_use_id`, and deep-hook's ID isn't visible outside its request. So an event is a hook's when it has the kind
   the facts map the hook to, the hook's tool kind and path, and a `seq` between deep-hook's spawn and exit (5 ms of
   slack): deep-hook stamps `seq` from the wall clock as it starts. Where hooks ran at once, the nearest start wins.
   A spooled request is matched exactly, by its ID, or by session, kind and `seq` under another ID (so a replay that
   appends twice is caught whichever ID it gives the copy). "Naming the call" is the call's tool name and
   `tool_use_id`, from the hook's input, which the transcript shows.
5. **"In the order deep-hook stamped them"** is `log_pos` rising with `seq` over the session's events.
   **PostToolUseFailure** counts as a call's PostToolUse when the transcript shows the call's result as an error.
6. **"Within 50 ms of its start"** follows #315's reading: deep-hook's own fail-open deadline, which the client keeps
   on any machine, timed from spawn to exit, so it is FAIL over 50 ms anywhere, not a budget held to the reference
   Mac. Each time is in the proof with the machine's state. "Runs to its stop" is the run's `PASS` and a Stop hook.
7. **"Acknowledged before the kill"** is exact only on the wire, so the killed session's deep-hook reaches the hub
   through a forwarded socket at the address setting (#16 AC2: every client works through one), which keeps each
   request with the hub's acknowledgement. Every request acknowledged before the kill must be in the record once.
   "Between two tool calls" is: a call's PostToolUse returned before the kill and another call's PreToolUse started
   after it. "Log positions only increase" is: `events.read` serves them strictly rising, every event served before
   the kill (read every 50 ms while the hub ran) keeps its `log_pos` after the restart, and every event replayed from
   the spool takes a `log_pos` above them. "The hooks fired while it was down" are those started after the kill and
   ended before the restart; each must be a spool line whose ID is in the record once.
8. **The key** is made at run time in the shape of an Anthropic key (`sk-ant-api03-…AA`). "Says it is set" is the
   recorded `session.start`'s `data.billing.ANTHROPIC_API_KEY` true (#315's field); the killed and stopped sessions,
   run without it, must read false. The places searched: the record's events as `events.read` serves them, every file
   under the temporary `.deepbuild` (the ledger and WAL, the spool, logs, evidence), the spool before and after its
   replay, and the hub's stdout and stderr, raw and in every form #15 names.
9. **"After the run"** is once the hub has stopped (SIGTERM) after the spool's replay; the comparison is #16 AC3's,
   row by row and column by column, on every table in `PROJECTIONS`; a ledger with no projection row is INCONCLUSIVE.

## What the base does (found while writing these tests)

- deep-hook loses hooks under load. On this Mac (battery, load average 30 to 100 from other worktrees and an
  antivirus scanning each exec), a hook the hub didn't acknowledge in 20 ms, or the first spool write in a fresh home,
  often printed `could not spool <id> within the hook's 50 ms`: that hook is neither recorded nor spooled, and the
  design accepts it ("a filesystem that stalls loses the spooled copy, never the 50 ms"). AC1 holds every hook to the
  record, so such a run fails AC1, naming the hook. deep-hook's spawn-to-exit time was over 50 ms for some hooks too.
- The hub's `tool.before` and `tool.after` carry no `tool_use_id` (`hookmap.ts` keeps the catalogue's fields only),
  hence reading 4. Unmapped events (Notification and the rest) are acknowledged and appended as nothing.
- The facts' session launch loads `--setting-sources project` (reading 1 and addition 1).
- Claude Code here is 2.1.310; the facts cover 2.1.299 and 2.1.304, so the merged harness returns BLOCKED.

## What that means for the proof

Until the harness runs a covered Claude Code version, every live test ends BLOCKED and no criterion is proven by a
real session; the fast tests prove the checks and the planted programs on the merged deep-hook and hub only. A PR for
this issue says `Closes #666` only with the live file's run (all PASS) kept as evidence; otherwise `Part of #666`.

## Files

- `helpers.ts`: the temporary home and settings, the fixture checkout, the hub and its protocol, the forwarder, the
  spool, the harness as a process, the checks for each criterion, the projection comparison and the proof writer.
- `fixtures/timed-hook.mjs`: the settings' hook command. `fixtures/checkout-web/`: the fixture repo.
- `fast.test.ts`: the fast tests. `session.live.test.ts`: the live tests.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the base run.
