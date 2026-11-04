# Acceptance tests for #1263: "all done?" typed in a real Claude Code session is answered from the record, though its transcript entry comes after the prompt hook

Written first, blind, by a job that never saw an implementation of #1263 (none existed). It read:

- issue #1263 as of November 4, 2026 (`updatedAt` 19:24:47Z): What happens, Scope, the three checkbox criteria, Proof
  and Depends on (#669 and #567, both closed and merged at the base); it has no comments;
- `docs/technical-design.md`: The verdict in the chat ("A message typed into the session that only asks for status
  ... is answered from the record by the prompt hook, without waking the model") and States people see;
- AGENTS.md; the READMEs of `669/` (its status question, AC5, the twin `status-from-model`), `567/` (its made-up
  session, which this suite's world and stand-in come from) and `83/` (status answered from the record, prompt
  origins, the hook log), and `83/status.test.ts`;
- base commit `e2e6e1cc` (origin/main), read-only: in `packages/hub/src/core.ts` the status answer (`statusReply`),
  the prompt's origin (`enrich`), #567's late-entry hold (`entryLater`, `placeHeld`, `PROMPT_PLACE_MS`), the queue's
  reading (`queue-operation`, `AUTOMATIC_QUEUED`, `queuedAsks`); `packages/hub/src/verdict-chat.ts`
  (`isStatusQuestion`, `statusAnswer`); `packages/hub/src/plant.ts`; `packages/hub/test/prompt-flush.test.ts` (#567's
  stand-in for 2.1.308's timing); Claude Code 2.1.299 and 2.1.308 corpus transcripts with queue entries
  (`adapters/corpus/claude-code/*/subagent`, `desktop-peer`); `scripts/proof-runs.mjs` (`atAssertion`) and
  `scripts/proof-change.mjs` (criterion IDs);
- redrafted blind on November 4, 2026 for one dispute, on Reading 5 (which the first draft flagged as open): the
  corpus's automatic prompts (`2.1.308/child-gates`, `2.1.308/monitor`, `2.1.304/subagent`, `2.1.308/loop`, each
  transcript's `queue-operation` entries beside its UserPromptSubmit prompts) reach the hook with the queue's wrapped
  text as their prompt, never a bare question. AC2's automatic test, which gave its hook a bare `all done?` behind a
  wrapped queue entry, modelled an input Claude Code doesn't produce; it is dropped, with its twin and `twins.json`.
  AC1, AC2 (recorded) and every expected value are unchanged.

The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 first on `PATH` (`.node-version`):

```sh
npm ci && npm run build --workspaces     # the tests run the built CLI, packages/cli/dist/main.js
cargo build --locked -q -p deep-hook     # setup's entries run target/debug/deep-hook (missing: BLOCKED; never built here)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1263 --no-file-parallelism fast.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/1263/tsconfig.json
```

- **Fast tests** (`fast.test.ts`) start no agent and spend nothing: one home, `deep setup`, one hub (`deep hub run`),
  and made-up Claude Code sessions whose hooks run through setup's entries into the real deep-hook and hub (seconds,
  plus up to 19 s of waiting for the record in AC2).
- Every test makes its folders under `/tmp/dh1263-*` (a socket path must stay short), sets `HOME` to `<tmp>/h` for
  every process it starts, and never touches the real `~/.deepbuild`, `~/.claude` or `~/.claude.json`. It stops only
  processes it started, by PID, and the process groups its stand-in started for hook entries. No child inherits a
  billing key, a forge token or a `CLAUDE*`, `DEEP_*`, `GIT_*`, `XDG_*` or `OTEL_*` variable of the runner's. No test
  reaches the network.
- With `--root` here, Vitest writes its cache to `tests/acceptance/1263/node_modules/.vite/`; delete it before committing.
- **`scripts/lanes.mjs` needs one entry this job didn't make** (it edits nothing outside this folder):
  `tests/acceptance/1263/fast.test.ts` in `alone` (it starts a hub and hook processes, as #567's does).

**The proof** is written to `$TMPDIR/deep-1263-proof/` (`os.tmpdir()`), rewritten on each run and never read back,
with this machine's home folder and the temp folders redacted: `typed-reply.json` (the stop's and the status
question's replies at the agent's side, and the record's line), `typed-transcript.jsonl`, `typed-record.json` (the
typed session's events).

## The surface under test

### Merged surfaces, used as their suites define them

- **`deep setup`** (#18): DeepBuild's entries in `~/.claude/settings.json`, its foreground UserPromptSubmit entry among
  them, each `exec '<deep-hook>' claude-code <Event>` (#1202).
- **The hub** (#16): `deep hub run`, its ready line, its socket, `events.read` and `changes.read` on a `cli`
  connection with the control token. No `DEEP_HUB_TEST_*` seam but `DEEP_HUB_TEST_CONFIRM`; no `DEEP_HUB_PLANT`.
- **The status answer** (#83, #669): a status question ("all done?") answered by DeepBuild's UserPromptSubmit entry
  with `{"decision":"block","reason":<answer>}`, which keeps the prompt from the model and shows the reason.
- **The record** (#14, #83): `user.ask` with its `text` and `from` (the prompt's origin, `person` for a prompt you
  typed); `claim.made`, `run.started` (`claim`, `run`) and `run.finished` (`run`) of the session's judged stop; the
  receipt's `line` (`changes.read {id: claim:<id>}`), the line the chat showed for the claim.
- **Claude Code's transcript** (#80, the corpus): a typed prompt's entry (`type: user`, `promptId`,
  `turnOrigin: human`, `promptSource: typed`).
- **Claude Code 2.1.308's UserPromptSubmit payload** (the issue): `cwd`, `hook_event_name`, `permission_mode`,
  `prompt`, `prompt_id`, `scratchpad_dir`, `session_id`, `transcript_path`, and no origin.

### Stand-ins (boundaries this repo doesn't own)

- `fixtures/claude.mjs`: #83's Claude Code stand-in, as #567 copied it, as-is. It runs every matching entry of the
  user settings file with `/bin/sh -c`, as Claude Code does; a UserPromptSubmit entry's block keeps the prompt from
  the model and is saved as a `hook_blocked_prompt` attachment; **the hook log** (`<tmp>/hooks.jsonl`) holds a
  `{phase: "model", session, prompt}` line whenever a prompt reaches the model. It never writes a prompt's own entry:
  the tests do, with 2.1.308's timing (Readings, 1).
- `fixtures/stub-bin.sh` as `launchctl`, `systemctl` and `claude` in `<tmp>/bin`, first on `PATH` (#567's), and a
  `deep` that runs the built CLI.

### The fixture repo

`<tmp>/shop`, #567's: `src/auth.js` (`token.exp > 0`, the bug), `tests/unit.test.js` (two node:test tests),
`.deepbuild/done.yaml` with one command check `unit`, trusted in `<tmp>/h/.claude.json`'s workspace trust.

### The session

- **Typed** (AC1, AC2): SessionStart; the prompt `Make checkToken in src/auth.js reject expired tokens.`
  typed with 2.1.308's timing; a Read of `src/auth.js`; the Edit that fixes it; Stop saying done. The stop is judged
  (its claim, the `unit` check's run passed, the line `says done 1/1 · 2 tests · next: DeepBuild · receipt` at the
  base). Once the record holds the claim with its runs finished and its line, `all done?` is typed, with 2.1.308's
  timing.

## Readings where the issue and design leave a choice

1. **Claude Code 2.1.308's timing.** A prompt's UserPromptSubmit fires with no transcript entry for it; the test
   appends the entry (as the corpus shapes it) only once the stand-in reports every entry of the hook returned, as the
   issue measured (154 ms after a quick hook). **Assumed for a blocked prompt:** Claude Code never writes a `user`
   entry for a prompt a hook blocked (the hooks reference: the prompt "is not processed"), only the
   `hook_blocked_prompt` attachment; so a correctly answered status question never gets an entry, and the hub can't
   wait for one. A prompt that isn't blocked gets its entry right after the hook, so a wrong program that lets the
   question through sees what real Claude Code would show it.
2. **"Answered from the record by DeepBuild's prompt entry, blocking the prompt so no model call is made"** (AC1):
   DeepBuild's UserPromptSubmit entry (the run of setup's entry) replies with a block whose reason is the answer; the
   stand-in reports the prompt kept from the model, and its hook log has no model line for `all done?`. **From the
   record**: the answer carries the receipt's `line` for the session's newest claim (the record's line for the
   verdict the question comes after) and names the session (its first 8 characters), as #83's answer does.
3. **"Typed after a verdict"**: after the session's judged stop, once the record holds its claim, its check's runs
   finished and its line. The fast world has no drafting job, so the task's definition never locks and the record
   holds no `verdict.made`; the line (`says done ...`) is the record's state for the claim, which the answer must
   carry. A real PASS verdict is #669's live AC5's (AC1 live, below).
4. **"The blocked prompt is recorded as yours (`user.ask` from `person`)"**: within 15 s of its block (past #567's 3 s
   wait for a late entry) and with no further hook from the session, the record holds exactly one `user.ask` of the
   session after the question whose `text` is `all done?`, and its `from` is `person`; read again 4 s later, so a
   late second record of the same prompt fails too. A status question that wasn't blocked isn't "the blocked prompt":
   the test fails at that assertion first.
5. **"A status question that came in as an automatic prompt is not answered from the record": no test here.**
   In every automatic prompt the corpus records (a task notice in `2.1.308/child-gates` and `2.1.308/monitor`, an
   agent's message in `2.1.304/subagent`, another session's message in `2.1.299/desktop-peer`), the UserPromptSubmit
   payload's `prompt` is the full wrapped text, identical to the queue's `enqueue` `content` (`<task-notification>
   ...`, `<agent-message from="..."> ...`, `<cross-session-message ...> ...`). `isStatusQuestion` (anchored, in
   `verdict-chat.ts`) never matches such a prompt, so a test shaped as Claude Code sends it passes on the base, on a
   fix, and on a hub that reads every unentried prompt as yours alike: no wrong program the criterion names could fail
   it, and it would prove nothing (AGENTS.md). A test whose hook carries a bare `all done?` behind a wrapped queue
   entry (the first draft's) models an input Claude Code doesn't produce, and would demand code and a plant for it.
   The one plain-text queued prompt the corpus shows is `/loop`'s (`2.1.308/loop`, a scheduled prompt whose hook
   prompt equals its enqueue), and the desktop app queues typed prompts the same way (#340), so a queue entry alone
   can't tell a scheduled status question from a typed one; that case is outside the issue's list (task notice,
   another session's or agent's message) and gets no test either. The clause stays held as the base holds it: by
   `isStatusQuestion` for the wrapped prompts, and by #83's AC4 (`83/status.test.ts`, run under AC3) for automatic
   prompts whose entry is already written. A PR that proves AC1 and AC2 (recorded) with this suite should say so.
6. **CLI, not the desktop app.** The typed question is typed while the session is idle, in the terminal, so no queue
   entry comes before it (the desktop app's enqueue-then-dequeue of every prompt, #340, is not modelled).

## AC1 live: #669's live file

The issue's first criterion is proven in a real session by `tests/acceptance/669/session.live.test.ts` (its AC5,
`#669.b5400502`, and the whole file passing), which this job does not copy. It runs on macOS (the reference Mac), with
the Rust toolchain, Claude Code at a version the facts cover, and a long-lived token; it spends plan usage, so by hand
only:

```sh
npm ci && npm run build --workspaces && cargo build --locked -q -p deep-hook
DEEP_HARNESS_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=<from `claude setup-token`> npx vitest run --root tests/acceptance/669 session.live.test.ts
```

It needs #669's harness scenario `fix-coupon-test` (its README, Additions, 2). The issue's Proof wants it failing at
AC5 on main and passing with the fix; both runs, kept as evidence, are what a PR needs to say `Closes #1263`. This
suite's AC1 test is its fast counterpart: a failing test on the merge base, through the real hub and deep-hook.

## AC3: the suites that must still pass

Run as they are, unchanged, on the implementation:

```sh
npx vitest run --root tests/acceptance/669 --no-file-parallelism --testTimeout=600000 fast.test.ts   # #669's fast suite (needs #669's README setup)
npx vitest run --root tests/acceptance/83 --no-file-parallelism status.test.ts                       # #83's status tests
```

Plus the hub's own status-question test, `packages/hub/test/status-question.test.ts`, through `node
scripts/affected.mjs`. No test here repeats them (AGENTS.md: no duplicate test).

## Needed outside the folder

This job edits nothing outside this folder. No planted wrong program is needed: both tests fail at the merge base.

1. **`scripts/lanes.mjs`**: `tests/acceptance/1263/fast.test.ts` in `alone`.
2. For AC1's live proof, #669's additions (its README, Additions: the `fix-coupon-test` harness scenario).

## Criteria to tests

IDs are `#1263.<first 8 hex of SHA-256 of the criterion's text, trimmed, whitespace collapsed, the leading "- [ ] "
dropped>` (`scripts/proof-change.mjs`). Each `describe`, test name and failure message starts with its ID.

| ID | Criterion (short) | Tests | Wrong program each fails on |
|---|---|---|---|
| AC1 `#1263.e768d825` | in a real Claude Code session "all done?" typed after a verdict is answered from the record, blocking the prompt (#669's live AC5 passes) | `fast.test.ts` AC1: the typed session, the question's entry written only after its hook; live: #669's `session.live.test.ts` (above) | the base: the question isn't blocked, it reaches the model (BASE-FAILURE.txt) |
| AC2 `#1263.19b14762` | the blocked prompt recorded as yours; an automatic status question not answered | `fast.test.ts` AC2: one `user.ask` from `person` for the blocked question; the automatic clause has no test (Readings, 5) | the base: no blocked prompt to record |
| AC3 `#1263.0fb7dbd3` | #669's fast suite and #83's status tests still pass | none here: the named suites, run as they are (AC3 above) | each suite's own twins and base failures |

Every judgment is node:assert's own assertion failure (`must` in `helpers.ts`, under the test paths); a missing build,
a hub that won't start, a setup without its prompt entry, or a judged stop the record never settles is a plain
`BLOCKED` error, never a pass.

## Files

- `helpers.ts`: the world, `deep setup`, the hub and its socket, the Claude Code stand-in's client, the typed and
  typed prompt with 2.1.308's timing, the judged session, the answer and the hook log readings, the proof writer.
- `fast.test.ts`: the tests. `tsconfig.json`: #567's, the root options with `noEmit`.
- `fixtures/claude.mjs`, `fixtures/stub-bin.sh`: #567's (#83's) as-is.
- `BASE-FAILURE.txt`: the run at the base.
