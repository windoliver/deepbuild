# Acceptance tests for #992: waiting clears on evidence, gone outranks it, and the CLI and the app agree

Written first, blind, from issue #992 (its body as of November 2, 2026: Scope, the four acceptance criteria, Proof,
Depends on), the design sections it links and those they lean on ("Hooks are evidence, not a state machine", "States
people see", the hook protocol, "What each agent gives us" and the corpus rules of #47) and base commit `42060bb7`
(origin/main, "Merge pull request #1135"), by a job that never saw an implementation; none existed. The base code read
for its surfaces: `packages/hub/src/{status,core,server,plant}.ts`, `packages/leases`, `adapters/claude-code.facts.json`,
`adapters/corpus/`, `crates/deep-app/src/{states,views,events}.rs`, `crates/deep-replica/src/{lib,replica}.rs`, and the
suites `tests/acceptance/{83,326/surfaces,47,27,18,120}`. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job.

At the base a PermissionRequest sets a session waiting and nothing clears it but a later tool call, prompt or stop;
the quiet timer runs only for working sessions; `deep status` checks waiting before gone, and only the lease keeper
writes `session.gone`; the app maps every attention state but unknown to Working; and Claude Code's Notification hook
maps to nothing. So every criterion fails there (BASE-FAILURE.txt).

## How to run

With the workspaces built (`npm run build --workspaces`) and `target/debug/deep-hook` built
(`cargo build -p deep-hook`):

```sh
npx vitest run --root tests/acceptance/992 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/992/tsconfig.json
```

- The app's side (AC2's sidebar test and AC3) runs the replica through cargo, `cargo test --locked -p deep-replica
  --test acceptance_992_app`, from those tests; the replica runs on macOS only. Off
  macOS, or before the `[[test]]` entries exist, those tests fail as BLOCKED, never skip. The first run builds the
  replica, which takes minutes.
- Every test makes its folders under `/tmp/dh992-*` (a socket path must fit in 104 bytes), sets `HOME` to `<tmp>/h`
  for every process it starts, and never touches the real `~/.deepbuild` or `~/.claude`. cargo gets the toolchain's
  `CARGO_HOME` and `RUSTUP_HOME` and a temp `HOME`. Processes are stopped by PID only: the hub, `deep status`, the
  Claude Code stand-in, cargo. No child inherits a billing key, a forge token, a `CLAUDE*` variable or a `DEEP_*`
  setting of the runner's. No test runs a live agent or reaches the network.
- `<tmp>/bin` is first on `PATH`: stand-ins for `claude` (answering `--version` with the newest covered version),
  `launchctl` and `systemctl`, each logging its call and exiting 0.
- With `--root` here, Vitest writes its cache to `tests/acceptance/992/node_modules/.vite/`; delete it before committing.
- On the base the suite takes about two minutes; AC1 waits up to 35 s of real time after its clock step, twice.

## The surface under test

The issue names `deep status`, the sidebar ("the app's row"), the record's `session.gone`, Claude Code's Notification
and Elicitation hooks, the adapter's facts and recorded corpus cases. It names no test entry for the app, no plant
names and no tags. Where it leaves one open, the smallest surface next to an existing one is pinned below.

### Merged surfaces, used as their suites define them

- **The hub**: `deep hub run` with `HOME` the temporary home; its ready line; the socket's line protocol; a `cli`
  connection with the control token; `events.read` (each event with its `session`), `inbox.read`. `DEEP_HUB_PLANT=<name>`
  selects a planted program, and a name the hub doesn't know makes it exit at start (#16). `test.clock {advance_ms}`,
  served with `DEEP_HUB_TEST_CLOCK_STEPS=1` (#965), steps the hub's clock forward and answers `{now}`; every hub here
  runs with it, and with no `DEEP_HUB_TEST_CLOCK`, so its clock is the wall clock's until a test steps it.
- **deep-hook** (the hook protocol): `deep-hook claude-code <event>` with the hook's JSON on stdin, any event the agent
  fires, `Notification` and `Elicitation` included; its parent process is the agent's (the hub keeps it as the
  session's `pid`, `core.ts`).
- **`deep status`** (#19, `packages/hub/src/status.ts`): its words for a session's state, `needs you`, `stuck`,
  `flagged`, `working`, `finished` and `quiet`, and its listing: a row per session that isn't quiet,
  `  <first 8 of id>  <state>  <agent>  <why>`, columns two or more spaces apart, and the quiet ones folded into
  `<n> quiet, by repo: …`. Every hub here holds one session, so a session with no row is quiet when that line is there.
  Process gone mid-turn is the base's own words: `flagged`, why `its process is gone mid-turn`; the tests take
  `process gone mid-turn` with or without `is`.
- **The corpus** (#47, `adapters/corpus/README.md`): `adapters/corpus/claude-code/<version>/<session>/` with
  `session.json`, `events.jsonl` (`{payload, expect, source, reviewed, tag?}` per hook call) and `transcript.jsonl`.
- **The replica** (#338, #326): `deep_replica::Replica::open(fixture)`, `Replica::surfaces()` and its `"sidebar-row"`
  `Seen` (the row's text), opened at `deep_replica::NOW` over a fixture of `{"session_id", "event"}` lines
  (`deep_app::events::Fixture`).
- **`activePlant()`** from the hub's public entry (`@deepbuild/hub`): the plant the CLI's side acts as.

### Defined here

1. **The Claude Code stand-in** (`fixtures/agent.mjs`) is one Claude Code process: it runs each hook as `deep-hook
   claude-code <event>`, its own direct child, the payload on stdin, and waits for it. The terminal closing is the test
   killing it with SIGKILL, by PID: the agent's process is gone. Nothing else stands in for Claude Code.
2. **A replay** (`helpers.ts`, `replay`) is a recorded session's hook payloads, in recorded order, each through the
   stand-in into a hub of its own, with the recorded `cwd` moved to `<tmp>/work` everywhere in the payload, and
   `transcript_path` to `<home>/.claude/projects/<cwd with non-alphanumerics as ->/<session>.jsonl`; nothing else is
   changed. The transcript grows as the session ran: before each hook it holds every recorded entry up to the last one
   naming a `prompt_id` or `tool_use_id` some hook so far carried, and once a whole recording is replayed, all of it. A
   replay "through" a line stops after that line, its transcript as it stood then. The session's state is read once
   the log stops growing for half a second.
3. **Ten minutes with no hook** is `test.clock {advance_ms: 600000}` once the replay is in, then up to 35 s of real time
   for `deep status` to read quiet: the hub's quiet reading comes due on its own clock (as the gate runner's timers do
   on a step), or on a real timer of at most about 30 s from the last hook, either way after the transcript's tail is
   read.
4. **Within 5 s** is measured from the moment the stand-in is gone, by polling `deep status` every 250 ms.
5. **The app's side** (`app.rs`): the record a hub holds, from `events.read`, every event's `ts` moved by one amount so
   the hub's now falls on `deep_replica::NOW`, written as a fixture and opened in the replica, which prints the
   `"sidebar-row"` text as `DH992 {"name","session","row","entry","glyph"}`. The replica's process gets
   `DEEP_HUB_PLANT` set to the plant in effect: the one the test names, else `activePlant()` in the test's own process,
   which a twin of `plant.ts` sets (Planted programs, below); otherwise it has none. A row names
   a state by holding exactly one of `deep status`'s six words, case aside (`wordOf`); "the same state" is that word
   equal to the one `deep status` prints for the session. AC2's sidebar reads "flagged, process gone mid-turn": the
   word `flagged` and `process gone mid-turn` (with or without `is`) in the row.
6. **This suite's stand-in sessions** (`fixtures/sessions/<name>/`, corpus layout) are written from Claude Code's hooks
   reference (code.claude.com/docs/en/hooks) and the corpus's 2.1.308 shapes, and marked `recorded: "stand-in"`; they
   are not recordings. AC1, AC2 and AC4 run each case on its stand-in first and then on the corpus's recording, so the
   merge base fails at the criterion's assertion while the recordings don't exist yet, and no case passes on a stand-in
   alone: a missing recording is BLOCKED. AC3 uses recordings only.
7. **Never an ask, never evidence** (AC4): after the Notification hook's call, the session gets no event of a kind
   `ask.*`, `user.*`, `tool.*`, `permission.*`, `claim.*`, `verdict.*`, `run.*`, `check.*` or `evidence.*`, your inbox
   (`inbox.read`) holds no ask naming the session, the recorded Notification lines' `expect` hold only `session.*`
   kinds (session-state signals), and once the session goes on as recorded to its stop, no `claim.*`, `verdict.*`,
   `run.*`, `check.*` or `evidence.*` event of the session cites an event the notification added or carries its
   `message`.

## What the implementation must provide

1. **Recorded sessions** in a Claude Code set of the corpus (`adapters/corpus/claude-code/<version>/<name>/`, any
   covered version; the newest holding the name is used), each passing `node scripts/corpus.mjs check`:

   | Folder | Holds | Tagged lines |
   |---|---|---|
   | `permission-answered` | a permission prompt answered yes: its call then runs (PostToolUse of the call) and the turn stops | the `PermissionRequest`, `permission-answered`; the call's `PreToolUse` (same tool and `tool_input`) comes before it |
   | `permission-denied-esc` | a permission prompt denied with Esc, and the recording ends there | the `PermissionRequest`, `permission-denied-esc`; after it no PostToolUse, PostToolUseFailure, Stop, StopFailure, UserPromptSubmit or `idle_prompt` Notification |
   | `permission-terminal-closed` | a permission prompt left showing while its terminal closed | the `PermissionRequest`, `permission-terminal-closed`; after it no PostToolUse, PostToolUseFailure, Stop, StopFailure or UserPromptSubmit |
   | `elicitation-answered` | an elicitation dialog answered | an `Elicitation` hook, `elicitation-answered` (not asserted on beyond AC3) |
   | `elicitation-cancelled` | an elicitation dialog cancelled | an `Elicitation` hook, `elicitation-cancelled` (not asserted on beyond AC3) |

   And, in any of these sets, Notification hook lines tagged `notification-permission-prompt` (`notification_type`
   `permission_prompt`), `notification-idle-prompt` (`idle_prompt`) and `notification-elicitation-dialog`
   (`elicitation_dialog`; not asserted on), each stored with `expect` events of `session.*` kinds only. A tag is the
   corpus's `tag` field; each line has at most one, so a payload two cases need is recorded twice or the case reads
   another session's. The existing sets' `tools`, `subagent`, `loop`, `compact`, `child-gates`, `stop-failure` and
   `crash` are used as they are.
2. **The facts** list `Notification` and `Elicitation` (and whatever else the recordings fire, such as
   `ElicitationResult`) in `events.versions` for each recorded version, so the corpus check passes; their mapping is the
   adapter's facts, as Scope says.
3. **Planted programs**, each a name `DEEP_HUB_PLANT` selects, added to `Plant` and `PLANTS` in
   `packages/hub/src/plant.ts` and to nothing else in that file: the twins replace it whole with the base's other
   exports (`plantedSessionEnd`, `plantedReload`, `plantedStart`, `plantedStop`, `piAcceptsReplaced`), so a new export
   there breaks them.
   - `waiting-first`: the one reading checks waiting before gone, everything else as shipped (`session.gone` is still
     recorded). Under it a session whose agent's process went while its prompt showed reads `needs you` in `deep status`
     (the hub's side and the CLI's, through `plantOf` and `activePlant`) and on the sidebar. The app's side runs with
     the same `DEEP_HUB_PLANT` in its environment, so a reading the app computes itself takes the plant too.
   - `ask-from-notification`: the Claude Code adapter opens an ask from a Notification hook, everything else as shipped.
   - `waiting-as-working`: the planted app. The app, run in the replica with `DEEP_HUB_PLANT=waiting-as-working` in its
     process's environment, reads a session waiting on you as Working, everything else as shipped; the hub and the CLI
     run under that name as shipped.
4. **The app reads `DEEP_HUB_PLANT`** in the replica's process (as deep-hook already does for `waiting-outlives-session`)
   for `waiting-as-working`, and for `waiting-first` when the one reading runs on the app's side.
5. **The app's test entry**, in `crates/deep-replica/Cargo.toml`, exactly:

   ```toml
   [[test]]
   name = "acceptance_992_app"
   path = "../../tests/acceptance/992/app.rs"
   harness = false
   ```
6. **`deep status` keeps its listing** as above, and the sidebar row holds the state word `deep status` gives the
   session, with the extra `process gone mid-turn` for a session flagged for that.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed
(`scripts/proof-change.mjs`, `criterionId`). Each test's name starts with its ID.

| Criterion | Tests (file: what) | Wrong program it fails on |
|---|---|---|
| AC1 `#992.45c71d36`: Esc-denied, 10 min, quiet; the base reads needs you, naming the session | `quiet.test.ts`: the stand-in, then the recording `permission-denied-esc`, replayed whole, the clock stepped 10 min: `deep status` reads `quiet` within 35 s | the merge base (needs you, naming session `0992e5c0-…`) |
| AC2 `#992.34978db2`: terminal closed, process gone: flagged, process gone mid-turn within 5 s on both; a reading checking waiting first reads needs you | `gone.test.ts` (two): `permission-terminal-closed`, stand-in then recording, the stand-in killed: `deep status` reads `flagged` / gone mid-turn within 5 s, and with `waiting-first` `needs you`; the sidebar row over the record as it stood then reads `flagged` and `process gone mid-turn`, and with `waiting-first` `needs you` | the merge base (needs you; on the app's side Working); twin `waiting-first` |
| AC3 `#992.45c506d1`: 12 recorded sessions, every state, CLI and app agree; a planted app mapping waiting to Working fails, naming the session | `agree.test.ts` (one): the twelve below, each `deep status` word against the app's row word; then the twelve cover needs you, flagged, working, finished and quiet; then the app with `DEEP_HUB_PLANT=waiting-as-working` must disagree on every session `deep status` reads `needs you`, naming it | the merge base (the app reads Working for finished, flagged and quiet sessions); twin `waiting-as-working` |
| AC4 `#992.f70129f6`: idle clears waiting; permission prompt notification sets it; no ask, no evidence; a planted adapter opening an ask fails, naming the hook | `notification.test.ts` (three): `permission-terminal-closed` waiting, then the `idle_prompt` Notification: not `needs you` within 5 s; `permission-answered` through its call's PreToolUse, then the `permission_prompt` Notification with no PermissionRequest: `needs you` within 5 s; both with the checks of "Never an ask, never evidence"; with `ask-from-notification` the hub must start and the judge must fail, naming "the Notification hook" | the merge base (needs you stays; working stays; no such planted adapter); twin `ask-from-notification` |

### The twelve sessions (AC3)

Each replayed into a hub of its own and read when its case says; between them they read needs you, flagged, working,
finished and quiet.

| Session | Read |
|---|---|
| `tools`, `subagent`, `loop`, `compact`, `child-gates`, `stop-failure` | replayed whole, the agent alive |
| `crash` | replayed whole, then the agent killed; read once deep status flags it, or 5 s on |
| `permission-terminal-closed` | replayed whole, the agent alive (its prompt still showing) |
| `permission-denied-esc` | replayed whole, then the clock stepped 10 min; read once quiet, or 35 s on |
| `permission-answered` | replayed through the PostToolUse of the call its tagged PermissionRequest let run, the agent alive |
| `elicitation-answered`, `elicitation-cancelled` | replayed whole, the agent alive |

### Planted programs

`twins.json` maps AC2 to `waiting-first`, AC3 to `waiting-as-working` and AC4 to `ask-from-notification`; each twin is
`twins/<name>/packages/hub/src/plant.ts`, the base's `plant.ts` with `Plant` widened to `string` and `plantOf` and
`activePlant` giving that plant whatever `DEEP_HUB_PLANT` says. Laid over the change, the hub and the CLI run as that
plant, and the tests hand `activePlant()` to the replica as its `DEEP_HUB_PLANT`, so the app does too: AC2's tests then
read `needs you` (the sidebar's too, wherever the reading runs), AC3's comparison fails on the session that needs you,
and AC4's notification tests find an ask, each at its assertion. That is what the twins are for: on the merge base the
app's side can't run at all (no `[[test]]` entry), so AC2's sidebar test and AC3 fail there as BLOCKED, before their
assertions. Each twin type-checks against the base (`tsc -p packages/hub`). AC1's wrong program is the merge base.

## On the base

`BASE-FAILURE.txt` is the run at `42060bb7` on Linux arm64 (no macOS here). Every test fails:

- AC1 at its assertion: the stand-in session `0992e5c0-0000-4000-8000-00000000e5c0` reads `needs you (a permission
  prompt waits on you)` 10 minutes after its last hook.
- AC2, `deep status`: at its assertion, `needs you` 5 s after the agent's process went. The sidebar test: BLOCKED,
  `acceptance_992_app` isn't registered (and on Linux the replica can't build: `deep-app` uses `image`, a macOS-only
  dependency). On a Mac the base's app would read the session Working.
- AC3: BLOCKED on the app's side as above, after `deep status` read the seven recorded sessions the base has (finished
  ×5, flagged for stop-failure, working for the killed crash); the other five aren't recorded.
- AC4: the idle-prompt test at its assertion (`needs you` stays), the permission-prompt test at its assertion (`working`,
  not `needs you`), the planted test at its assertion (the hub knows no `ask-from-notification` and won't start).

## Ambiguities and assumptions a redraft may revisit

- **Every state.** A session's hooks alone reach `needs you`, `flagged`, `working`, `finished` and `quiet`; `stuck` needs
  a recorded StopFailure for a sign-in or rate limit, which the corpus doesn't have and the issue doesn't ask for, so
  AC3's coverage leaves it out. The design's table of states has no `finished`, `flagged` or `stuck`; the issue asks
  the sidebar to read `flagged`, so the tests compare with `deep status`'s words.
- **The sidebar's words.** The row must hold the state word; for AC2 also `process gone mid-turn`. A sidebar that shows
  the reason elsewhere than the row's text fails here, and is a dispute for a redraft.
- **Evidence.** "Never evidence for a claim" is read as in Defined here, 7: what a notification adds is session-state
  signals only, and no claim, verdict or run of the session cites it or quotes it.
- **The idle-prompt case** waits at a prompt still showing (`permission-terminal-closed`, its agent alive), since the
  Esc-denied session's transcript already says the prompt closed and a hub may rightly clear on that alone.
- **The quiet period.** AC1 doesn't require `needs you` before the ten minutes; a hub that reads the denial from the
  transcript sooner still passes once it reads quiet.
- **Time for the app.** The record's `ts` are moved so the replica's `NOW` is the hub's now; other times inside event
  data (none the twelve need) aren't moved.
- **One hub per replay**, so `deep status` lists one session; a row with no id prefix match and no quiet line reads as
  no row and fails.
