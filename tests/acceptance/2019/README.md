# Acceptance tests for #2019: session flags (interrupted, retrying, repeating, watch-only, unpushed) in the right slot, and agents that can't reach DeepBuild

Written first and blind, at base commit `35df4523f`, from issue #2019 (updatedAt 2026-11-10T00:25:40Z: its Scope, six
acceptance criteria, Proof and Depends on), the design and the base, before any implementation. The implementing agent does
not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). There is no
taste criterion, so no `TASTE.json`.

## What was read

- Issue #2019, live, and the titles of its dependencies #1461 and #2018 (both merged at the base).
- `docs/technical-design.md` at the base: States people see (the table, the row shape, the one reading); Sessions that know
  about each other (the session map's flags, Telling the agent, Safety, Agents side by side); Hooks are evidence, not a state
  machine (Unknown, not finished; Health reads the agent's side; Facts as data); the Claude Code, Codex and pi rows of What
  each agent gives us; the reference window (Decisions); Dogfooding and Wrong programs.
- At the base: `packages/hub/src/{status,rows,list,plant,hookmap,codex-settings,agents,setup,doctor}.ts` and the parts of
  `core.ts` that read a stop's cause, a version past its facts, a process gone and Codex's hook list;
  `packages/verdicts/src/line.ts`; `crates/deep-app/src/{views,installed,record,address}.rs` (the list, the Agents page);
  `adapters/{claude-code,codex,pi}.facts.json` (versions, stop causes, transcripts); the schemas and fixtures of
  `agent.stop@5`, `tool.after`, `commit.made@1`, `session.gone@1`, `session.attention@2`, `notice.delivered@1`;
  `scripts/proof-change.mjs` (criterion IDs); the suites `2018` (whose conventions and helpers this one follows), `1461`,
  `352`, `39`, `993`, `26` and `16`.
- A fact given with the job: Claude Code writes each model-call retry into its transcript as a line of its own, with no
  `message`: `{"type":"system","subtype":"api_error","level":"error","error":{…},"retryInMs":…,"retryAttempt":…,
  "maxRetries":10,"source":"request_retry",…}`; the records seen were connection errors on 2.1.317 and 2.1.321.

## How to run

With Node 24.22 first on `PATH`, cargo on `PATH` (`/opt/homebrew/opt/rustup/bin`), the workspaces built (`npm ci
--ignore-scripts; npm run build --workspaces`), `deep-hook` and `deep-replica` built, on macOS:

```sh
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease cargo build --locked -q -p deep-hook -p deep-replica
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2019 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2019/tsconfig.json
```

- **Builds.** #2018's helpers build `deep-drive` with `--features env-plants` and then plain, once a run, with #1172's build
  environment, each copied out of the target folder under its own name; this suite reuses them.
- **Folders and processes.** Homes and outputs are under `/tmp` (#16's `tempDir`). Nothing touches the real `~/.deepbuild`,
  `~/.claude`, `~/.codex`, `~/.pi` or `~/Library/LaunchAgents`. Only what a test started is stopped, by PID. The OS
  confirmation is #24's stub, `confirmed`. No network, no model, no real agent binary: AC5's agents are stand-ins
  (`fixtures/agents/`), first on a `PATH` of their own with a login shell that keeps it.
- **Time.** Each file but `agents.test.ts` builds the Proof's fixture once; AC3 and AC6 then play live sessions on its hub. AC3
  waits at most 30 s for a row to show what a transcript says (Disputes 3).
- **`--root` cache.** Vitest writes `tests/acceptance/2019/node_modules/.vite/`; delete it before committing.
- **Lanes.** `scripts/lanes.mjs` needs `tests/acceptance/2019/` in `alone` (it builds `deep-drive` twice, starts real hubs,
  runs `deep setup` and many replicas, and the replica draws on macOS only): `alone.push('tests/acceptance/2019/')`. This job
  writes only under `tests/acceptance/2019/`; the implementer makes that edit.

## The surface (my choice where the issue names none)

The readers are the real ones: `deep status --json` and `deep status` from the built CLI against a real hub in a temp HOME;
the record through `events.read`; each hook's reply as the hub's hook route returns it; the app's list and the Agents page as
the real `deep-drive` draws them, launched with `launch.from: "record_copy"` in the same HOME, at the reference window
(1512 × 982, the replica's default); and `deep setup` for AC5's homes. No reply, label or log line credits a criterion.

### Pinned here: the implementation must provide these

Every name below is in one place in `helpers.ts`.

1. **The flag on the row.** Each row of `deep status --json` (#1463's `{log_pos, rows}`, the one row shape `see`'s `rows`
   share) carries `flag`: `null`, or one object, so a row shows at most one flag. `flag.code` is the flag's word and
   `flag.text` the one line its right slot shows. Codes and their fields (`FLAG`, `Flag`):
   - `interrupted`: a session an app quit or a usage limit stopped (read from the agent's own records), or that the session
     map shows exited mid-turn. `doing`: what it was doing; `until`: when it can pick up, ms since the epoch, exactly the
     agent's own record's reset time (Codex's `plan_resets`), when there is one. What it was doing may stand in `doing`,
     `text` or the row's `why`, as the turn's prompt or its last command.
   - `retrying`: `cause`, the cause in words (it must say overload); `count`, the retries so far; `since`, the first
     retry's own `timestamp` in ms (within 1 s).
   - `repeating`: `command`, as the call ran it; `count`, how many identical failures in a row; `since`, the time of the
     first of them (between its call's `tool.before` and `tool.after`, within 1 s).
   - `watch-only`: `text` or the row's `why` names the version past the facts (`2.1.321`); `fix`, a non-empty sentence.
   - `unpushed`: an idle session with a commit (`commit.made`) on no remote branch.
   The app's row draws the flag in its right slot, a node `session:<id>:flag` inside the row `session:<id>`, whose name
   (or value, or the strings drawn in it) holds the flag's word (`unpushed` may read `unpushed`, `not pushed` or `not on
   any remote`). The state word stays in `session:<id>:word`, one of #2018's fourteen; a flag is never a state.
2. **The verdict line** in `deep status`: under the session's row, the line that carries its newest claim's verdict (the line
   that names the verdict's cause, here `users 404`, which the line never cuts). For a session whose holds are watch-only it
   holds `watch-only`; no line of its block reads `sent back` when no hold was delivered.
3. **Retries read live.** The hub reads a live Claude Code session's transcript (the `transcript_path` its hooks give) for
   model-call retry records without waiting for a hook: within 30 s of the second retry record, with no event since, the
   row reads retrying; within 30 s of the model's next reply in that turn, with no hook since, it reads working with no
   retrying flag.
4. **The notice at the third failure** goes through #352's route: the record holds exactly one `notice.delivered` (any
   version) for the session whose `text` names the command, between the third identical failure's `tool.after` and the
   fourth's, and that text names the count `3` and the error signature as the record's `tool.after` holds it
   (`sig:<16 hex>`); the same text stands in a hook reply the agent got (`hookSpecificOutput.additionalContext`, a
   `reason` or a `systemMessage`). No other notice names the command; no `ask.created` is recorded for the session; its row
   never reads needs you.
5. **The Agents page.** In the replica launched with `from: "record_copy"`, the Agents page (`open` `page/agents`, the
   page node `page/agents`) draws the model the hub in that HOME answers to `agents.read`, read at launch or through to the
   hub (a read, so no write reaches it). Each agent set up has a row of its own, a node `agent:<id>` inside the page
   (`agent:claude-code`, `agent:codex`, `agent:pi`), whose words hold its name (`Claude Code`, `Codex`, `pi`) and, with
   no session yet, that it waits for a first session (`waits for a first session`, `waiting for its first session` and the
   like). An agent whose sessions can't reach DeepBuild says why: with Codex's hook list reporting DeepBuild's entries
   untrusted, Codex's row holds `untrusted` (or `not trusted`) and the fix, which names `/hooks`. "Right after Set up" is
   right after `deep setup` exits 0 in a home where `~/.claude`, `~/.codex` and `~/.pi/agent` exist and `claude`, `codex`
   and `pi` are on the login shell's `PATH`; the hub has read Codex's hook list by then (Codex's `app-server` `hooks/list`,
   as the base reads it at a Codex session's start).
6. **Plants**, each selected by `DEEP_HUB_PLANT=<name>`, set in the hub's process, in `deep`'s and in the replica's, read
   through `activePlant()`/`plantOf()` (`packages/hub/src/plant.ts`) or, for the app, `crate::plain::planted` in
   `deep-drive --features env-plants`; everything else as shipped:
   - `retry-reads-working` (AC3): the hub never reads a model-call retry, so the row reads working through the retries.
   - `sent-back-without-hold` (AC4): a FAIL whose send-back no hold delivered reads `sent back` on the row.
   - `agents-title-only` (AC5): the Agents page draws only its title. The env-plants build with no plant chosen draws the
     page as the plain build does.
   - `repeat-by-command` (AC6): repeating is keyed on the command alone, so the same command failing with two signatures
     reads repeating at its third call.
   - `repeat-notifies-each` (AC6): every identical failure from the third on brings a notice.
   - `repeat-raises-ask` (AC6): the third identical failure raises an ask.

### Merged surfaces, used as they are

`deep hub run` with `DEEP_HUB_TEST_CLOCK` and `DEEP_HUB_TEST_CONFIRM`; the hook route (#16's `sendHook`, `hookRequest`,
`newSession`), Claude Code's PreToolUse, PostToolUse and PostToolUseFailure (its `error`, read by the base's adapter into
`tool.after`'s `exit_code` and `signature`); `events.read`; the record and asks core through #26's `seed` and #2018's
`Seeder`; `deep status` and `--json` (#1463, #2018); `deep setup` (#18, #39); Codex's `app-server` `hooks/list` as the hub
reads it; `deep-drive --out <dir>` with `launch` (`from: record_copy`), `see`, `open`, `wait_for`; the row's nodes
`session:<id>` and `session:<id>:word` (#1461); the list node `list` (#1461's `listRows`); the replica's `env-plants`.

### The fixture

`helpers.ts`, `mainWorld`, the Proof's "30 sessions across 3 repos": three git folders, `cart`, `docs` and `search`, each
with a first commit on `main`; `cart` also has an origin, a bare repo beside it, holding `main` with one more commit, and a
branch `cart-totals` with a commit no remote holds. AC4's session is played through a real hub whose clock stands half an
hour back; with it stopped, the rest is seeded through the record and asks core, each event in its kind's published shape,
times counted back from when the fixture is made; then a real hub. The world's sessions:

| Key | Agent, repo | Title | What the record holds | Read by |
|---|---|---|---|---|
| `limited` | Codex, cart | Invoice schema | the prompt *move the invoices to the new schema*, `npm run db:migrate` run, then a stop whose cause Codex's rate-limit record gave, `plan_window_spent`, with `plan_resets` 2 h 13 min on, owner `service`, no claim | AC1 |
| `unpushed` | Claude Code, cart | Cart totals | a `git commit` call, `commit.made` on `cart-totals` (on no remote), a stop with no claim | AC1 |
| `pushed` | Claude Code, cart | Cart page | the same, its commit on `main`, on `origin/main` | AC1 |
| `exited` | Claude Code, cart | Search index | `npm run index` begun and never ended, then `session.gone` (the session map: exited mid-turn) | AC2 |
| `unreadable` | Claude Code, cart | End-to-end run | `npm run e2e` begun six hours ago, then `session.attention` `unknown` (its hooks went quiet and nothing could be read); its transcript is gone; no `session.gone` | AC2 |
| `watchonly` | Claude Code, cart | Users endpoint | played: a transcript on 2.1.321, its start, a prompt and `npm run lint`; seeded: a stop that claims done and a FAIL whose smallest case is `users 404`; no `claim.sent_back` | AC4 |
| `f0` to `f23` | Claude Code, twelve in docs and twelve in search | Task *n* in *repo* | six finished, four working, four PASS, three says done, three with an open ask, four quiet three days | AC1 (none is interrupted or unpushed) |

Live sessions played on that hub: AC3's `retrying` in cart (a transcript on 2.1.308, its start, the prompt *build the API
docs and check their links*, `npm run docs:build` and its result; then two retry records 600 ms apart and the model's reply);
AC6's `repeats` in cart (four failures of `pnpm test --filter api` with one error text, A, then `git status`),
`two-signatures` in docs (A, B, A, B another error text with the same exit code) and `passes-second` in search (A, a pass,
A). Each plant test starts the hub again with its plant; AC3's then plays a fresh session in cart, and each of AC6's one in
search. A retry record's error is a 529 with the API's `overloaded_error` body (Disputes 4).

The criteria's sessions are all in `cart`, first by name, so the app's list draws their rows at the reference window: at
the base the list draws only the rows that fit in the window and doesn't scroll (#1808), and the first run of this suite,
with them in a repo that sorted last, found two of them cut off (BASE-FAILURE.txt).

AC5's homes (`setUpHome`): `~/.claude`, `~/.codex` and `~/.pi/agent`; stand-ins for `claude` (2.1.308), `codex` (0.160.0,
whose `app-server` answers `initialize` and `hooks/list` from the home's `~/.codex/hooks.json` with the trust `codex.json`
names) and `pi` (1.4.0), a login shell that keeps `PATH`, and `launchctl`; a real hub; then `deep setup`, exit 0. One home's
Codex list reports DeepBuild's entries `trusted`, the other's `untrusted`.

## Criterion to tests

IDs are `criterionId` in `scripts/proof-change.mjs`; `criteria.json` lists them with their text.

| Criterion | ID | Tests | Wrong programs it fails on |
|---|---|---|---|
| AC1 | `#2019.3052d233` | `interrupted.test.ts`: `limited` reads `interrupted` with what it was doing and `until` its reset; `unpushed` reads `unpushed`, `pushed` doesn't; no other session of the 30 reads either; the app's right slots agree | the base (no flag); a flag on every stopped session or every session with a commit |
| AC2 | `#2019.92d09557` | `interrupted.test.ts`: `unreadable` reads quiet and nothing in its row says interrupted; `exited` reads `interrupted`, in `--json` and its right slot | the base (`exited` reads flagged, no flag); a reader that calls every quiet mid-turn session interrupted |
| AC3 | `#2019.52aac98e` | `retrying.test.ts`: after two overload retries the row reads `retrying`, overload, 2, since the first's time, with no event since; at the model's reply it reads working again | the base (it reads working through the retries); `retry-reads-working` |
| AC4 | `#2019.3a943830` | `watch-only.test.ts`: `watchonly` reads `watch-only` naming 2.1.321 with a fix, in `--json`, its right slot and its verdict line, and never `sent back` | the base (it reads `sent back`, its verdict line `sent back 1/3`); `sent-back-without-hold`, naming the session |
| AC5 | `#2019.524707a3` | `agents.test.ts`: right after `deep setup`, `agent:claude-code`, `agent:codex` and `agent:pi` wait for a first session and the list has no row; with Codex untrusted, its row says so with `/hooks` | the base (no agent rows); `agents-title-only`, naming each agent's missing row |
| AC6 | `#2019.ea7b05b6` | `repeating.test.ts`: the third identical failure reads `repeating` with the command and 3, one notice naming the command, 3 and the signature, none at the fourth, no ask; the two twins never read repeating | the base (no flag, no notice); `repeat-by-command`, `repeat-notifies-each` and `repeat-raises-ask`, each naming the call |

Every test fails at the base (`BASE-FAILURE.txt`): each criterion's at its own assertion, for the missing flag, notice or
agent row; each hub-side plant's at the hub's start, which refuses a name the base doesn't know; and AC5's plant one step
before the plant, where the env-plants build with no plant chosen must already draw the agents' rows.

## Scope the criteria don't cover

No criterion names these, so nothing here tests them: two sessions on one issue; an app quit (only a usage limit is
fixtured); "an older record read late changes nothing"; a hook that doesn't fire, `deep off` and unapproved checks as causes
of watch-only (only a version past the facts is fixtured), and watch-only's fix's wording; an agent whose sessions can't reach
DeepBuild for hooks not installed, a version outside its facts, or a session already running at Set up (only Codex's untrusted
hooks are fixtured); the quiet sessions folded into one line per repo and the sidebar's grouping (#1461, #2018); a repeat of an
MCP tool by its arguments' hash; repeating's place in the state order; no notification for a repeat (only no ask is held);
the row's controls on hover and selection.

## Disputes and assumptions a redraft may revisit

1. **Which agent's usage limit (AC1).** Claude Code's facts record a usage limit only as `rate_limited`, with no reset time,
   so "when it can pick up" has no source there; Codex's facts read `plan_window_spent` and `plan_resets` from its own
   rate-limit record. The fixture is a Codex session. A redraft may fixture Claude Code once its facts carry a reset.
2. **"Can't be read" (AC2).** Read as the design's "Unknown, not finished": a session whose hooks went quiet mid-call, which
   the hub marked `unknown`, whose transcript is gone and whose process the session map never named. The base already reads
   it quiet; the half that fails at the base is the exited session.
3. **"Within one event of the second retry" (AC3).** No hook fires while a model call retries, so the row must show retrying
   with no further event: the test writes the second retry and nothing else, and reads the row for up to 30 s. It also reads
   "the time of the first" as the first record's own `timestamp`, and "the count" as 2. A redraft may allow one more record
   (a third retry) before reading.
4. **The overload record's shape (AC3).** No overload (529 / `overloaded_error`) retry record was seen; the fixture's error
   is `{message: "529 {…overloaded_error…}", formatted, status: 529, type: "overloaded_error", connection: null,
   isNetworkDown: false, rateLimits: null, noResponse: null}`. The session's version is 2.1.308, covered by the facts, so
   its holds stay on and no watch-only flag takes the slot; the records seen were on 2.1.317 and 2.1.321.
5. **The verdict line (AC4).** Read in `deep status` as the line under the row naming the FAIL's cause; a redraft may read
   it in the reply that carries a landed verdict at the next prompt instead.
6. **The notice's route and timing (AC6).** It may ride the third failure's own reply or the next hook's; the test places a
   notice by the `tool.after` it follows in the record. "The count" after the fourth identical failure is read as 4.
7. **Codex's hook list (AC5).** The stand-in answers `hooks/list` in the fields #39's suite read from Codex 0.160
   (`eventName` lower camel case, `trustStatus` `trusted` or `untrusted`); and the hub reads it by the time setup ends.
8. **pi set up.** The base's setup sets up Claude Code and Codex only; the criterion lists pi, so setup is expected to set
   up pi when `pi` is on the login shell's `PATH` and `~/.pi/agent` exists.
9. **Plants in every process.** Each plant test sets `DEEP_HUB_PLANT` for the hub, for `deep` and (AC5) for the replica, so
   the implementation may place a plant on either side; the hub refuses a name it doesn't know, so at the base the hub-side
   plant tests fail at the hub's start.

## Files

- `helpers.ts`: the IDs, every pinned name, the criteria's values, `More` (seeded kinds past #2018's seeder), the git
  folders, `Transcript` and `Live` (played sessions with their replies), `mainWorld`, `setUpHome`, the readers and the
  judges. Reuses `../16/helpers.ts`, `../26/helpers.ts`, `../2018/helpers.ts` and `../1461/helpers.ts`.
- `interrupted.test.ts` (AC1, AC2), `retrying.test.ts` (AC3), `watch-only.test.ts` (AC4), `agents.test.ts` (AC5),
  `repeating.test.ts` (AC6).
- `fixtures/agents/`: the stand-ins for `claude`, `codex` (and its `app-server`), `pi`, the login shell and `launchctl`.
- `criteria.json`, `tsconfig.json`, `BASE-FAILURE.txt`.
