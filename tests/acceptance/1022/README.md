# Acceptance tests for #1022: Codex /compact records PreCompact twice and an empty prompt from unknown

Written first, blind, by a job that never saw an implementation of #1022; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- Issue #1022 as of 2026-11-08: What the record shows, Why it matters, the three acceptance criteria and Proof.
- `docs/technical-design.md`: What each agent gives us, and the limits we design around (the Codex row; Claude Code's
  row on prompt origins, `unknown` opening no ask), Hooks are evidence, not a state machine, and A loop's turn end
  isn't a hand-back (prompt origins).
- At the base (`da22dbe4`), to learn the surfaces only: `adapters/codex.facts.json` (`mapping.PreCompact`,
  `PostCompact`, `UserPromptSubmit`, `turnWithoutPrompt`), `packages/hub/src/hookmap.ts` (`session.compact` as a
  reading), `packages/hub/src/core.ts` (`promptless`, prompt placement, the spool replay), `crates/deep-hook/src/main.rs`
  (the 20 ms acknowledgement and the spool), and tests/acceptance/39/helpers.ts, which these helpers adapt.

## Surfaces

Every test reaches DeepBuild the way Codex does: `deep-hook codex <event>` (the real debug build) with the hook's JSON
on stdin, against `deep hub run` (the real CLI build) in a temp home under `/tmp/dh1022-*`. What is asserted is read
back from the record over the hub's control socket: `events.read` (the session's `session.reading`, `user.ask`,
`task.created`, `ask.created`, `permission.request` and `session.state` events) and `status.read` (the session's row).
Nothing stands in for deep-hook, the hub or the record; a `codex` stub on PATH only prints a version.

## The recorded payloads

The 0.160.0 run's payloads the issue names are not on this machine. `fixtures/hooks.jsonl` and `fixtures/rollout.jsonl`
stand in for them: a live `/compact` typed in the real Codex CLI 0.144.0 TUI (a version `codex.facts.json` covers),
driven in a pty against a local fake model on 2026-11-08, every hook's stdin logged. The run: SessionStart, a typed
`say hi` (UserPromptSubmit), Stop, then `/compact`, which fired PreCompact (trigger `manual`) and PostCompact in a turn of
its own, with no UserPromptSubmit and no Stop. Paths are rewritten to `@T1@` (moved into each test's temp folder at run
time), and Codex's long instruction texts in the rollout are trimmed; nothing else changed. `replay` fires the hooks in
their recorded order and writes the rollout as Codex had written it at each hook's recorded time.

The issue's text is the authority on what the 0.160.0 record showed: PreCompact readings at log positions 28 and 30,
then PostCompact at 31, and a `user.ask` with `"text": ""` and `"from": "unknown"`. The 0.144.0 run fired PreCompact
once; replayed, the base records one PreCompact reading but the issue's empty `user.ask` from `unknown`.

## Tests

| Criterion | File | What it does and asserts |
|---|---|---|
| AC1 `#1022.616badd8` A `/compact` in a Codex session records exactly one PreCompact reading and one PostCompact reading | `compact.test.ts` | Two hubs. (a) The recorded run as Codex fired it. (b) The same run with its PreCompact hook reaching DeepBuild a second time before PostCompact, the order the 0.160.0 record shows (28, 30, 31). Each must hold exactly one PreCompact and one PostCompact reading. |
| AC2 `#1022.afb0a4f3` A Codex slash command records no `user.ask`; if Codex fires UserPromptSubmit for it, the adapter records it as a reading naming the command, and it opens no ask and bounds no turn | `slash.test.ts` | Two hubs. (a) No UserPromptSubmit (the recorded run): no `user.ask` but the typed `say hi`. (b) UserPromptSubmit with prompt `/compact` in the command's own turn, after the typed turn's Stop and before PreCompact: a `session.reading` containing `/compact` recorded for it before PreCompact fires; no `user.ask` for it; no `task.created`, `ask.created` or `permission.request` after it (opens no ask); no `session.state` `working` after it, and the session's row reads the same state after the `/compact` as after the typed turn's Stop (bounds no turn). |
| AC3 `#1022.77e6168c` Replayed from the recorded hook payloads of that run, an adapter that records two PreCompact readings or a `user.ask` for the command fails the test, naming the duplicate | `replay.test.ts` | The recorded run, replayed as recorded, judged by `duplicates`: any PreCompact or PostCompact reading count other than one, and any `user.ask` that isn't the typed `say hi`, each named by its log position and content. |

Each test collects every problem its criterion names and fails once listing them all, so a failure names each
duplicate. The base itself is the wrong program for each: BASE-FAILURE.txt shows AC3's judge naming the empty `user.ask`
from `unknown` at its log position, and AC1's (the same `compactionReadings` the judge uses) naming both PreCompact
readings.

## Readings of the issue (what the tests assume)

- A PreCompact or PostCompact reading is a `session.reading` whose text names the hook, as the issue quotes the record
  ("PreCompact: the context compacts (manual)"). No other wording is asserted.
- AC2's reading "names the command" when its text contains `/compact`; it is looked for after the UserPromptSubmit and
  before PreCompact fires, so a PreCompact reading that happened to mention `/compact` can't stand in for it.
- "Opens no ask": no task (`task.created`) and no ask or permission request after the command's hook. "Bounds no turn":
  the command doesn't put the session to work (`session.state` `working`), and the row's state is unchanged by it.
- AC1(b) sends the second PreCompact as an identical hook (same session, turn and trigger). The issue doesn't say
  whether 0.160.0 fired PreCompact twice or DeepBuild recorded one hook twice; either way the record must hold the one
  compaction once, so the test gives the hub the same hook twice.
- Only `/compact` is tested as "a Codex slash command": it is the issue's command, and which other commands Codex fires
  UserPromptSubmit for isn't known here.

## Load

deep-hook fails open: a hook it can neither hand to the hub within 20 ms nor spool within 50 ms is lost, and on this
shared machine at load 75-125 that happened to several hooks a run. So `deliver` waits for the record to settle after
each hook (all spool lines replayed, then 4 s still, past the hub's 3 s prompt placement), and fires again only a hook
deep-hook reported lost that left the session's record unchanged, up to 5 times; past that the test fails as
INCONCLUSIVE, never as a verdict. Run the files one at a time (`--no-file-parallelism`).

## Not run here

The Proof's live `/compact` in the Codex CLI on the reference Mac (0.160.0) is not part of this suite and wasn't run:
this machine has Codex 0.144.0, whose live hooks are the fixtures above.
