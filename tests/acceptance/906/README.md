# Acceptance tests for #906: an answer in a prompt or stop reply that deep-hook gave up on reads stalled, never delivered

Written first, blind, by a job that never saw an implementation of #906 (none existed). It read:

- issue #906 as of October 31, 2026 (labels bug, area:hub, area:hook): its first paragraph, Scope, three checkbox
  criteria, Proof and Depends on (#25, #48, both merged at the base); it has no comments;
- `docs/technical-design.md`: Hook protocol (deep-hook and the hub), An ask, and your answer getting back (the four
  delivery outcomes: "delivered and acknowledged, when the agent's next prompt or turn shows it; stalled; timed out; or
  the session was replaced. A timeout doesn't prove nothing arrived, so a retry reads the session first."), the Claude
  Code row of What each agent gives us, Hooks are evidence, not a state machine, and How we know version 0 works
  (Criteria to tests, Wrong programs, Dogfooding);
- AGENTS.md and CONTRIBUTING.md;
- the READMEs, helpers, fixtures, twins and BASE-FAILURE files of `27/`, `25/routes/` and `823/` (and the
  `hook_additional_context` lines of `25/fallbacks/`);
- base commit `3f4b96ef` (origin/main, whose code under `packages/` and `crates/` is that of `39980abe`, the base the
  job was given, plus #883's notifications): `packages/hub/src/{core,server,plant,claude-settings}.ts`,
  `crates/deep-hook/src/main.rs`, `packages/contracts/schemas/delivery.outcome@1.json`, `scripts/proof-change.mjs`
  (criterion IDs), `scripts/proof-runs.mjs` (twins, "at its assertion"), `scripts/lanes.mjs`.

The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 first on `PATH`, on macOS, with the Rust toolchain:

```sh
npm ci && npm run build --workspaces          # the tests run the built CLI, packages/cli/dist/main.js
cargo build --locked -q -p deep-hook          # setup's entries run it; a test builds it if it's missing
npx vitest run --root tests/acceptance/906 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/906/tsconfig.json
DEEP_HUB_PLANT=<name> npx vitest run --root tests/acceptance/906 --no-file-parallelism <file>   # a wrong program, by hand
```

- Three tests, one per file, each starting its own hub. Each waits out deep_ask's 40 s wait for you, which is
  protocol, not test overhead; `stop.test.ts` also waits out a 60 s stop hold (the planted delay holds the reply past
  it) and up to 30 s for a wake. With the change they should take about 1, 2.5 and 1.5 minutes (not run: no
  implementation exists); at the base AC1 and AC2 fail within a minute each and AC3 passes in about a minute. They start hubs and time holds, so `tests/acceptance/906/` is in `alone` in `scripts/lanes.mjs`.
- Every test makes its folders under `/tmp/dh906-*` (a socket path must fit in 104 bytes), sets `HOME` to `<tmp>/h`
  for every process it starts, and never touches the real `~/.deepbuild`, `~/.claude`, `~/.claude.json`, the Keychain
  or `~/Library/LaunchAgents`. It stops only processes it started, by PID, and the process groups its stand-in started
  for hook entries. No child inherits a billing key or a `CLAUDE*`, `CODEX*`, `GIT_*`, `OTEL_*`, `XDG_*` or `DEEP_*`
  variable of the runner's, except a `DEEP_HUB_PLANT` you set by hand, which reaches the hub, setup, the CLI and the
  stand-in (so deep-hook and `deep mcp`).
- With `--root` here, Vitest writes its cache to `tests/acceptance/906/node_modules/.vite/`; delete it before committing.
- Machine load: deep-hook acts alone on a hub that hasn't acknowledged within 50 ms (#315), so on a badly loaded Mac a
  hook can go through unheld. A late hook that deep-hook let through in under 1 s never reached a hold, so the test
  stops `BLOCKED` naming it and the load (`helpers.ts`, `mustBeHeld`), never passing or failing on it; so does AC3's
  first prompt when deep-hook printed no reply (`mustCarry`), and a session whose `deep_ask` couldn't bind (its
  PreToolUse spooled, unheld). A later prompt that went through unheld can still fail a check; each message carries the
  load. Rerun on a quieter machine and keep the load with the result.

## The surface under test

### Merged surfaces, used as their suites define them

- **The hub** (#16): `deep hub run` with `HOME` the temporary home, its ready line, the socket's line protocol on a
  `cli` connection with the control token: `events.read` (the record's `ask.created`, `ask.answered` and
  `delivery.outcome@1`: `delivery`, `via` one of `steer`, `interrupt`, `stop_hold`, `next_prompt`, and `outcome` one of
  `delivered`, `stalled`, `timed_out`, `replaced`). `DEEP_HUB_TEST_CONFIRM` stands for the OS confirming you (#24).
  `DEEP_HUB_PLANT=<name>` selects a planted program; a name the hub doesn't know makes it exit at start.
- **The hook protocol**: deep-hook as `deep setup`'s entries in `~/.claude/settings.json` run it (#18, #25): the hub's
  acknowledgement with `hold_until_ms`, and deep-hook acting as with the hub away once no reply has come by then
  (`crates/deep-hook/src/main.rs`, `exchange`: it prints nothing, spools the request marked late, exits 0, so a prompt
  runs and a stop goes through without the reply). The foreground Stop entry (the hold) and the waiter, its
  `asyncRewake` entry.
- **`deep mcp`** started by the session's own process, and its `deep_ask` (#26).
- **`deep inbox answer <ask> <option>`** (#24): your answer from the CLI.

### The Claude Code stand-in

`fixtures/claude.mjs` is #27's stand-in (itself #25's routes stand-in), copied with one change. It runs each command
entry of the user settings file as Claude Code does, continues a turn on a Stop entry's block, starts a turn with a
task-notification prompt when the waiter exits 2 (#80), and writes into the session's transcript what Claude Code
writes there:

- a Stop entry's block reason as a user entry `Stop hook feedback:\n<reason>` (#80's desktop transcript; unchanged);
- a woken turn's prompt as a `queue-operation` enqueue and a user entry (#80; unchanged);
- **new for #906**: a synchronous entry's `hookSpecificOutput.additionalContext` (exit 0) as an attachment entry
  `{"type": "attachment", "attachment": {"type": "hook_additional_context", "content": [<context>], "hookName": <event>,
  "toolUseID": …, "hookEvent": <event>}}`, the entry Claude Code writes for a hook's added context (as
  `25/fallbacks/fixtures/claude.mjs` writes it). This is how a UserPromptSubmit or SessionStart reply reaches the turn.

What deep-hook didn't print never lands there: a reply deep-hook gave up on leaves no entry. `launchctl`,
`systemctl` and `claude` on `PATH` for setup are `fixtures/stub-bin.sh` (log and exit 0).

### "The transcript shows its ID"

A transcript entry Claude Code wrote from text DeepBuild handed the agent, naming the ask's ID (its ULID, with or
without `ask:`): a `hook_additional_context` attachment, or a user entry whose content is text (a Stop hook's feedback,
a wake's prompt). Not counted: a wake's `queue-operation` line (the same prompt, queued, before its user entry), and
the agent's own `deep_ask` tool_use and tool_result (the agent's call naming its own ask, not an answer).
`helpers.ts`, `showings`. "Shows its ID once" is exactly one such entry.

### Defined here, where the issue names no surface: the planted delay

**`DEEP_HUB_TEST_LATE_REPLY=<absolute file path>`**, read from `deep hub run`'s environment; only tests set it, and
unset, or set with no file at that path, nothing changes.

- While a file exists at that path, the hub writes its reply to each hook it acknowledged with a hold
  (`hold_until_ms` not null; the tests use it on UserPromptSubmit and Stop) no sooner than 1,000 ms after that
  `hold_until_ms`. By then deep-hook has given up on the reply (it waits only until `hold_until_ms`) and has let the
  hook through with nothing printed, so the write reaches no one: it fails, or lands on a closed connection.
- Whether the file exists is read once per hook, when the hub has that hook's reply in hand to write; removing it later
  doesn't hurry a reply already held.
- Only the write waits. Everything else happens when it would without the file: the core composes the reply then (the
  answers it carries are taken for that reply then), and whatever the hub does or records when it hands a reply over,
  it does then. A hub that held the core instead, so no answer was ever handed, would not be planting "a reply that
  reaches deep-hook after its hold ran out".
- The tests make the file just before the hook and remove it once the hook has run.

## Readings where the issue leaves a choice

1. **How the answer comes to be in a UserPromptSubmit reply (AC1, AC3).** You answer while the session's turn still
   runs: deep_ask came back still waiting after its 40 s and the turn hasn't stopped, so the session has no waiter and
   no held stop, and the answer waits for its next prompt (the base's `offer` hands nothing to a session with no
   waiter). You then interrupt the turn and type a prompt; Claude Code runs no Stop hook for an interrupted turn. AC1's
   next prompt follows the late one the same way, so the session's next route is its next prompt, as AC1 names it.
2. **AC1's outcomes.** Exactly `stalled via next_prompt`, then `delivered via next_prompt`, in log order, and nothing
   else; the delivered after the next prompt's hook began; no `delivered` 3 s after the late prompt's hook returned
   (past its hold and the planted write). "In flight" (Scope) is no outcome in `delivery.outcome@1`, so it reads as no
   event. When `stalled` is recorded is the implementation's: at the reply deep-hook dropped, or when the next prompt
   reads the session; it must come before the delivery. The turn of the next prompt ends with its Stop and the record
   has 30 s more to say delivered, since "delivered and acknowledged" is read from the turn.
3. **AC2, "the same holds".** The answer is given before the turn's Stop, so the Stop is held for it and its reply is
   a block carrying it. After the late reply: `stalled via stop_hold`, never delivered; then it goes with the
   session's next prompt: a wake's prompt if the hub hands it to the waiter that Stop started and Claude Code wakes the
   session within 30 s ("goes by the next route", Scope), else the prompt you type. Then `delivered via next_prompt`
   (the waiter's route records `next_prompt` at the base too), and the transcript shows the ID once.
4. **AC3, "a later route".** The answer goes out in a prompt's reply in time and the turn shows it. The later routes
   tried are all three: that turn's stop hold, the waiter its Stop starts (15 s for a wake carrying the ID), and the
   next prompt. None may send it again; the transcript shows it once; the record says `delivered via next_prompt`,
   once, and nothing else (30 s allowed for it).

## Disputes

1. **No Stop between AC1's late prompt and its next prompt.** Read as an interrupted turn, so the next route is the
   next prompt. If the owner wants the late prompt's turn to end with a Stop, the stop hold is the next route and the
   answer would go there (`via stop_hold`), not with "the session's next prompt" as AC1 says; a redraft would decide.
2. **`via` on the stalled outcome.** These tests read it as the route whose reply was dropped (`next_prompt` for the
   prompt, `stop_hold` for the stop). The issue names no `via`.
3. **The planted delay's 1,000 ms.** Any margin past the hold works; 1 s keeps the write clearly late on a loaded Mac.

## Criteria to tests

IDs are `#906.<first 8 hex of SHA-256 of the criterion's text, trimmed, whitespace collapsed>`
(`scripts/proof-change.mjs`). Every test name and check message starts with its ID. `twins.json` maps each criterion
to its twin folders under `twins/`, each holding `packages/hub/src/plant.ts`.

| ID | Criterion (short) | Test | Wrong program each fails on |
|---|---|---|---|
| AC1 `#906.b7af9874` | a UserPromptSubmit reply past the hold: stalled, never delivered, next prompt, ID once | `prompt.test.ts` (one) | the base: no planted delay, so the precondition fails naming the ask; twin `delivered-when-written` at "must never read delivered" |
| AC2 `#906.ac643af8` | the same for a stop-hold reply | `stop.test.ts` (one) | the base: no planted delay, so the precondition fails naming the ask; twin `delivered-when-written` at "must never read delivered" |
| AC3 `#906.02f9eada` | an ID a turn shows isn't sent again by a later route | `shown.test.ts` (one) | passes on the base (it records delivered when it writes, so nothing is retried); twin `sends-shown-again` at the first later route that sends it (the stop hold, the waiter or the next prompt: "must not send it again", the transcript showing it twice) |

## Additions the implementation must make

This job edits nothing outside this folder but the one `scripts/lanes.mjs` line.

1. **The planted delay**, `DEEP_HUB_TEST_LATE_REPLY`, as defined above, in `deep hub run`.
2. **Planted programs**, named in `packages/hub/src/plant.ts`'s `Plant` and `PLANTS`, each selected with
   `DEEP_HUB_PLANT=<name>`:

   | Name | What it does wrong | Criterion |
   |---|---|---|
   | `delivered-when-written` | records an answer `delivered` (via its route) when it writes it into a hook's reply, as the base's `deliver()` does, whether or not the reply reaches deep-hook in its hold or a turn shows its ID | AC1, AC2 |
   | `sends-shown-again` | a delivery tried again (stop hold, waiter or next prompt) sends every answered ask not yet recorded delivered without reading the session first, so an answer whose ID a turn already shows goes a second time | AC3 |

   `twins/<name>/packages/hub/src/plant.ts` replaces `plant.ts` whole and keeps its exports at the base (`Plant`,
   `plantOf`, `activePlant`, `piAcceptsReplaced`); if the change adds an export there, the twins need it too.

## Files

- `helpers.ts`: temp homes and stand-ins, the repo, `deep setup`, the hub (with the planted delay's file) and its
  socket, the stand-in's client, the asking session, `deep inbox answer`, delivery outcomes, what the transcript shows.
  Adapted from `tests/acceptance/27/helpers.ts`.
- `prompt.test.ts` (AC1), `stop.test.ts` (AC2), `shown.test.ts` (AC3).
- `fixtures/claude.mjs` (#27's stand-in, copied, with the hook-context transcript entry), `fixtures/stub-bin.sh`.
- `twins.json`, `twins/{delivered-when-written,sends-shown-again}/packages/hub/src/plant.ts`.
- `BASE-FAILURE.txt`: the run at the base, and why each test fails or which twin kills it.
- `tsconfig.json`: the root options with `noEmit`, as #27's.
