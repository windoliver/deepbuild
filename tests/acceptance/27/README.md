# Acceptance tests for #27: an answer reaches an idle session; a repeat never reaches you

Written first, blind, by a job that never saw an implementation of #27 (none existed). It read:

- issue #27 as of October 29, 2026 (labels type:test, area:adapter): its Scope, five checkbox criteria, Proof,
  References, Depends on (#23, #25, #26, #48, all merged at the base) and its "Added Oct 9" and "Done when" lines; it
  has no comments;
- `docs/technical-design.md`: Week 2; How we know version 0 works (Headless agent tests, Hook edge cases, Every wait
  ends, Dogfooding, Criteria to tests, Wrong programs); An ask, and your answer getting back (Every ask ends, Asks stay
  current, One table for an ask's life, the four delivery outcomes, Before each command's "Commands end"); the Claude
  Code row of What each agent gives us; Hooks are evidence, not a state machine; Numbers version 0 has to hold
  (Timing relations, Every task carries its own budgets, The reference Macs); the checks-command row; Decided:
  Question matching;
- AGENTS.md and CONTRIBUTING.md;
- the READMEs, helpers and fixtures of the suites whose surfaces it drives: `25/{routes,fallbacks,live}/` (and
  `25/live/MANUAL.md`), `23/`, `24/`, `26/`, `48/`, `668/`, `25/twins.json`, `668/twins.json`;
- base commit `38b7a1a5` (origin/main): `packages/hub/src/{core,inbox,tools,claude-settings,setup,plant}.ts`,
  `packages/asks/src/index.ts` (the inbox row), `packages/contracts/schemas/{delivery.outcome,run.finished,
  session.attention,agent.stop}@*.json`, `crates/deep-hook` (the waiter), `scripts/agent-harness.mjs` (its
  `deep-answer` scenario), `scripts/lanes.mjs`, `scripts/proof-change.mjs` (criterion IDs), `scripts/proof-runs.mjs`
  (twins, "at its assertion"), `adapters/claude-code.facts.json`, `spikes/80/decision.json`.

The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 first on `PATH`, on macOS, with the Rust toolchain:

```sh
npm ci && npm run build --workspaces          # the tests run the built CLI, packages/cli/dist/main.js
cargo build --locked -q -p deep-hook          # setup's entries run it; a test builds it if it's missing
npx vitest run --root tests/acceptance/27 --no-file-parallelism wake.test.ts repeat.test.ts desktop.test.ts waits.test.ts outcomes.test.ts
npx vitest run --root tests/acceptance/27 --no-file-parallelism --silent=false budgets.test.ts   # about 10-15 minutes, nothing beside it; --silent=false prints the readings
node node_modules/typescript/bin/tsc -p tests/acceptance/27/tsconfig.json
DEEP_HARNESS_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=<from `claude setup-token`> npx vitest run --root tests/acceptance/27 session.live.test.ts   # by hand only: spends plan usage
DEEP_HUB_PLANT=<name> npx vitest run --root tests/acceptance/27 --no-file-parallelism <file>   # a wrong program, by hand
```

- **Fast tests** start no agent and spend nothing. Each starts its own hub; most wait out the hub's 60 s stop hold
  and deep_ask's 40 s wait, which are protocol, not test overhead. The five fast files take about 20 minutes at the
  base, most of it `waits.test.ts`'s agent-command case, which waits up to 5 minutes for an overrun.
- **Live tests** (`session.live.test.ts`) run real interactive Claude Code sessions through the harness on your own
  sign-in. Without `DEEP_HARNESS_LIVE=1` (#48's opt-in), without `CLAUDE_CODE_OAUTH_TOKEN`, without a `claude` on
  `PATH`, with a Claude Code version the facts don't cover, or without the harness's `repeat` route, each fails with
  `BLOCKED` in its message; nothing skips. This job did not run them (no token here, and they spend plan usage).
- **The desktop app** is `MANUAL.md` (AC3), run by a person.
- Every test makes its folders under `/tmp/dh27-*` (a socket path must fit in 104 bytes), sets `HOME` to `<tmp>/h`
  for every process it starts, and never touches the real `~/.deepbuild`, `~/.claude`, `~/.claude.json`, the
  Keychain or `~/Library/LaunchAgents`. It stops only processes it started, by PID, and the process groups its
  stand-ins started for hook entries. No child inherits a billing key or a `CLAUDE*`, `CODEX*`, `GIT_*`, `OTEL_*` or
  `DEEP_*` variable of the runner's, with one exception: a `DEEP_HUB_PLANT` you set by hand reaches the hub, setup,
  the CLI and the stand-in (so deep-hook and `deep mcp`), to try a wrong program. The live run passes
  `CLAUDE_CODE_OAUTH_TOKEN` to the harness explicitly.
- The merge base's build for AC5 is kept at `/tmp/dh27-base-<sha12>` between runs; remove it to reclaim the space.
  When this checkout's code is the merge base's, the base side is this checkout's own build.
- With `--root` here, Vitest writes its cache to `tests/acceptance/27/node_modules/.vite/`; delete it before committing.
- Machine load: deep-hook acts alone on a hub that hasn't acknowledged within 50 ms (#315), so on a badly loaded Mac
  a Stop can go through unheld and a test fails on a hook's reply, naming it; rerun it and keep the load with the
  result. AC5 reads a miss on a machine loaded past its cores as INCONCLUSIVE, never PASS.

## The surface under test

### Merged surfaces, used as their suites define them

- **The hub** (#16): `deep hub run` with `HOME` the temporary home, its ready line, the socket's line protocol on a
  `cli` connection with the control token: `events.read`, `inbox.read` (#24, #34: every ask's row with `status`,
  `outcome`, `decision`), `sessions.read` (#34). `DEEP_HUB_PLANT=<name>` selects a planted program; a name the hub
  doesn't know makes it exit at start. `DEEP_HUB_TEST_CONFIRM` stands for the OS confirming you (#24).
- **`deep setup`** (#18, #25): DeepBuild's entries in `~/.claude/settings.json`, among them the foreground Stop entry
  (the hold) and the waiter, its one `asyncRewake` entry. DeepBuild's entries are those whose command runs deep-hook
  or the deep CLI.
- **`deep mcp`** started by the session's own process, and its tools as `deep mcp` lists them (#26): `deep_ask` (kind,
  question, options, recommended, `subject`), `deep_claim`, `deep_run`.
- **`deep inbox answer <ask> <option>`** (#24): your answer from the CLI, saved as a decision for the ask's repo
  (#23). **`deep inbox`**: what you read.
- **The record**: `ask.created`, `ask.answered`, `ask.defaulted`, `ask.batched`, `decision.created`,
  `decision.applied`, `delivery.outcome@1` (`delivery`, `via`, `outcome` one of `delivered`, `stalled`,
  `timed_out`, `replaced`), `run.started`, `run.finished@1` (`outcome` one of passed, failed, ran_nothing, missing,
  overran, stopped, uncounted), `session.attention`, `agent.stop`.
- **Your settings**: `~/.deepbuild/config.json`'s `asks.deadline` block (#318).
- **The harness** `scripts/agent-harness.mjs` (#48) and its `deep-answer` scenario (#25), for the live file.

### Stand-ins (boundaries this repo doesn't own)

- **Claude Code**: `fixtures/claude.mjs`, #25's routes stand-in copied as-is (see its header): it runs each command
  entry of the user settings file as Claude Code does, blocks a Stop on a `decision: block`, starts a turn with a
  task-notification when the waiter exits 2 (#80), and with `configure({wake:false})` is an app that doesn't start
  that turn. Live, the real `claude` on the runner's `PATH`.
- `launchctl`, `systemctl`, `claude` on `PATH` for setup: `fixtures/stub-bin.sh` (log and exit 0; `claude --version`
  answers the newest version the facts cover). `deep` runs the built CLI.

### The repo and the sessions

Each test makes `<tmp>/repo<x>`, a git repo with one commit and git's user in its own config, and its sessions work
there, so the hub gives them a project and your answers are saved for that repo (#23). A session is one stand-in
process: SessionStart, a typed prompt, `deep_ask` through its own `deep mcp` (a choice between two header colours,
blue recommended, with PreToolUse and PostToolUse around the call and the call in the transcript), the agent's words,
then its Stop. **Idle** is a session whose Stop went through with nothing answered (its hold ended), its waiter
waiting.

## Readings where the issue and design leave a choice

1. **AC1, "the idle session wakes and uses the answer".** Wakes: Claude Code starts a turn for the waiter's exit with
   no prompt typed, and that turn's prompt carries the chosen option. Uses: live, the agent's reply after the wake
   is the chosen option's label and not the other's; fast, the scripted reply uses it and the stop after the woken
   turn isn't held or sent back with the same answer again. The record says `delivered`, once, and no other outcome.
   "Answer from the CLI" is `deep inbox answer`.
2. **AC2, "the same question asked again in a new session"**: the same kind (choice), words, options and
   `subject.point` (a requirement handle), in a new session in the same repo, after you answered it once from the
   CLI. **"Answered by the resolver"**: the new ask closes as `decided_for_you` with one `decision.applied` from the
   core citing the decision your first answer saved; the agent's `deep_ask` comes back with that answer at once
   (under 10 s, long before its 40 s wait for you); no `ask.batched` names it and `deep inbox` never lists it among
   your open asks. **"Appears under decided for you"**: in `deep inbox`'s output, the ask's line says "decided for
   you", or the nearest line above it naming no ask (a heading) does, and the ask's line names the decision it reused.
   #24's and #667's merged tests read every `deep inbox` line that starts (trimmed) with an ask's handle as an open
   ask, so a decided-for-you line that starts that way would read as open there; one that starts with its label
   (`decided for you  ask:…  decision:…`) satisfies both suites.
3. **AC3.** The desktop app's wake can't be driven by a harness; `MANUAL.md` decides which branch holds and says
   where a known limit is recorded (the Claude Code row's Known limits cell). The fast test proves the fallback
   wherever an app doesn't wake: the delivery reads `stalled`, never `delivered` from the waiter's exit; a reading on
   the session says it wasn't woken and the answer goes with the next prompt; the next prompt carries it once; and
   the limit stays known for that session: its next answer isn't handed to the waiter again and goes with its next
   prompt (the design: a route a session never showed working counts as absent).
4. **AC4, "each ask, hold, check run and agent command reaching a recorded outcome by its deadline".**
   - Ask: your settings give each kind 1 minute; an ask nobody answers has `ask.defaulted` by its deadline (+5 s, the
     hub's tick) and its inbox row reads `defaulted`, never answered.
   - Hold: a stop held for an open ask nobody answers is let through by the end of its hold (60 s by default, +5 s);
     by then the record holds an event that isn't a hook's own kind, about the session, saying how the hold ended
     (its text names a hold) and naming the open ask; and the session never reads `finished` (its sessions row
     state, else its newest `session.attention`), since it waits on you.
   - Check run: the repo's `.deepbuild/done.yaml` gives a check whose command never ends a `deadline: 1m` (the asks'
     duration form; the design says each run has a deadline from the spec); `deep_run` starts it for the session's
     claim; `run.finished` with outcome `overran` is recorded by `run.started` + 1 minute (+10 s), and no process of
     the run is left.
   - Agent command: the same Bash command ran once and took 1.5 s; run again, its PreToolUse comes and no PostToolUse
     follows. The design gives a call an expected time "from its kind and from how long the same command took
     before" and leaves the number open, so the test bounds it: within 5 minutes of the call's start the record holds
     an event that isn't a hook's own kind, naming the call's `tool_use_id`, whose text says it overran (`overr…`),
     and the session doesn't read `finished`.
5. **The "Added Oct 9" cases and "Done when"**, tagged with AC4's ID (they are waits reaching their recorded outcome):
   - **The four delivery outcomes in scripted sessions** (stand-in sessions; a real Claude Code can't be made to
     stall, time out or be replaced on cue): delivered is `wake.test.ts`; stalled is `desktop.test.ts` (an app that
     doesn't wake); **timed out**: the waiter took the answer and exited 2, the app started no turn, and the session's
     transcript can't be read, so nothing proves whether a turn carried it: `timed_out` within 60 s, never `stalled`
     (nobody read the session) or `delivered`; once it can be read, the next prompt carries it once and it reads
     delivered (the design: "a timeout doesn't prove nothing arrived, so a retry reads the session first");
     **replaced**: the waiter took the answer and exited 2, the app started no turn, and the session was cleared at
     once (`/clear`: SessionEnd reason clear, then SessionStart source clear with a new ID in the same process):
     `replaced`, never `stalled`, and the new ID's SessionStart reply carries the answer (Threads, not IDs), delivered
     once.
   - **A waiter that outlives its session**: an idle headless session's Claude Code is killed (no SessionEnd); its
     waiter's process group is gone within 10 s; your answer then reads no `delivered`; the session isn't `finished`.
   - **A stop held while a Claude subagent still runs**: the agent's background subagent fires PreToolUse and
     PostToolUse with its `agent_id` on the parent's session before, during and after the parent's held stop. Its
     hooks don't end the hold; the session isn't `finished` during it; your answer during the hold continues the
     parent's held stop; no subagent hook reply carries it; no wake follows; the outcome is `delivered via
     stop_hold`, once.
   - **"None reads as finished"**: each case checks that its wait reads its own outcome (defaulted, overran, timed
     out, replaced, …) and never answered, passed, delivered or `finished` when it isn't.
6. **AC5.** "Over 20 runs": 20 idle sessions per side, each answered in turn with `deep inbox answer`; a run is the
   time from when you ran the command to when Claude Code (the stand-in) started the woken turn. p95 is the nearest
   rank of 20. On a reference Mac (Mac15,7 or Mac15,12, Low Power Mode off, thermal state nominal, on battery or
   mains alike, not loaded past its cores) a p95 over 2,000 ms, a session not woken, or a p50 more than 50% above
   the merge base's (and more than 2 ms) FAILs; anywhere else the test is skipped as INCONCLUSIVE with both sides'
   readings, never PASS. The merge base is measured by the same driver on its own build, after a 2-session warm-up.
   "In the local preflight": some check lane in `scripts/lanes.mjs` runs `budgets.test.ts` with Vitest and
   `--no-file-parallelism`, not as an `--exclude` argument. The design's five-runs rule is #25's AC8 shape; this issue
   names 20 runs, so these tests take the design's "each side takes 20 samples" and gate the p95 the issue states.
7. **"On real sessions"** (the issue's first line, Proof's "transcripts and the record for each step"): AC1 and AC2
   also run live through the harness, each keeping the run's transcripts and the record (the harness's `--out`
   folder and the hub's record under the temporary home, printed on failure). The other criteria can't be forced on
   a real Claude Code session and are proven on the stand-in.

## Disputes

1. **A repeated question that names no subject.** The base keys a `deep_ask` with no `subject` on its words and its
   session (`core.ts`, `askFor`: "one that names nothing keeps a key of its own wording in its session, which no
   saved decision answers elsewhere"), so the same words in a new session reach you. The design's Question matching
   ("by kind and scope in v0, never by exact wording") can be read either way. These tests ask with a subject, the
   path the base offers, and the live `repeat` route's prompt names one; the owner decides whether a subject-less
   repeat must be answered too. A redraft adds that case if so.
2. **deep_ask's reply when the resolver answers.** At the base the repeated ask closes as decided for you, but
   `deep_ask` returns `{status: "decided", answer: null}`, so the agent never learns the answer. These tests require
   the reply to carry it; an implementation that delivers it by another route instead (the next hook) would fail
   them, and that reading is this job's.
3. **AC3's known limit** is read as the per-session fallback the design describes plus `MANUAL.md`'s record in the
   design's Known limits cell. If the owner reads "recorded as a known limit" as the design table alone, the fast
   test's third step (the limit stays known for the session) goes beyond the issue.
4. **The check run's deadline key.** The design gives each run a deadline from the spec but names no key in
   `done.yaml`; these tests write `deadline: 1m`. Week 3 owns hermetic checks with deadlines; if the owner moves that
   case to week 3's issue, it moves with its tag.
5. **The agent command's bound.** 5 minutes for a command whose last run took 1.5 s is this job's, as no number is in
   the design.

## Additions the implementation must make

This job edits nothing outside this folder.

1. **A harness route**, `repeat`, in the `deep-answer` scenario of `scripts/agent-harness.mjs` (and its usage line):
   `--route repeat`. Session A types the ask prompt as `idle-wake`'s round 1 does, with one change: the prompt also
   names `subject {"point": "req:<the run's tag>"}` for `mcp__deep__deep_ask`. A's round is done as `idle-wake`'s is
   (a Stop after the first carrying a label, and `turn_duration` after it); then `/exit` and wait for A to exit.
   Session B, new, in the same `--workdir`, types the same ask prompt word for word (the same question, labels and
   subject); done at B's first Stop carrying either label; `/exit`. The run line's `evidence.sessions` names A and B.
   The tests answer only A's ask. The route stays out of `all` and the harness budgets lane.
2. **Planted programs**, named in `packages/hub/src/plant.ts`'s `Plant` and `PLANTS`:

   | Name | What it does wrong | Criterion |
   |---|---|---|
   | `repeat-reaches-you` (new) | deep_ask raises its ask without asking the resolvers, so a repeated question reaches you | AC2 |
   | `waiter-never-wakes`, `wake-assumed`, `skip-default-at-deadline`, `waiter-outlives-session`, `answer-skips-held-stop`, `waiter-checks-every-5s` (merged) | as #25, #318 and #16 define them | AC1, AC3, AC4, AC5 |

   `packages/hub/src/plant.ts` keeps its exports (`Plant`, `plantOf`, `activePlant`): each twin replaces it whole.
   The `waiter-outlives-session` twin also replaces `packages/hub/src/setup.ts` with the base's copy whose waiter
   entry carries the plant to deep-hook's waiter (as #25's twin does); if the change edits `setup.ts`, that twin's
   copy must follow it.
3. **`scripts/lanes.mjs`**: `tests/acceptance/27/` in `alone` (its files start hubs; `budgets.test.ts` must run with
   nothing beside it), or the fast files in `alone` and `budgets.test.ts` in a check lane of its own run with
   `--no-file-parallelism`; and `tests/acceptance/27/session.live.test.ts` in `byHand` and in the release lane
   `claude code adapter live` as `env DEEP_HARNESS_LIVE=1 node node_modules/vitest/vitest.mjs run --root
   tests/acceptance/27 session.live.test.ts`. Without the `byHand` entry the unit lane runs the live file and it
   fails BLOCKED. The budget file runs about 15 minutes on a fit reference Mac; a change that keeps it in `alone`
   says so against the checks' time budget.
4. What the tests found missing at the base (BASE-FAILURE.txt), for the implementation to build: `deep_ask` returning
   the resolver's answer; `deep inbox` listing what was decided for you; a session that showed its app doesn't wake
   keeping that known; a recorded outcome for every held stop; check-run deadlines from `done.yaml`; agent-command
   overruns; `timed_out` and `replaced` delivery outcomes; and the merge-base budget lane.

## Criteria to tests

IDs are `#27.<first 8 hex of SHA-256 of the criterion's text, trimmed, whitespace collapsed, the leading "- [ ] "
dropped>` (`scripts/proof-change.mjs`). Every test name and check message starts with its ID. `twins.json` maps each
criterion to its twin folders under `twins/`, each holding `packages/hub/src/plant.ts` (and `setup.ts` for one).

| ID | Criterion (short) | Tests | Wrong program each fails on |
|---|---|---|---|
| AC1 `#27.778c531d` | the idle session wakes and uses the answer | `wake.test.ts` (one); `session.live.test.ts` AC1 (live) | passes on the base; twin `waiter-never-wakes` ("never woke within 30 s of your answer", checked with `DEEP_HUB_PLANT` at the base) |
| AC2 `#27.6e863673` | the repeat is answered by the resolver, under decided for you | `repeat.test.ts` (one); `session.live.test.ts` AC2 (live) | the base: B's deep_ask comes back without the answer (`decided` with `answer: null` in one run, `waiting` after 40 s in another), and `deep inbox` has no decided-for-you section; twin `repeat-reaches-you` |
| AC3 `#27.f8331d25` | the desktop app wakes, or the fallback is a known limit | `desktop.test.ts` (one); `MANUAL.md` | the base: the session's second answer is handed to the waiter that didn't wake (its known limit not kept); twin `wake-assumed` (no `stalled`) |
| AC4 `#27.e6116d56` | each ask, hold, check run and agent command reaches a recorded outcome by its deadline (and the Oct 9 cases) | `waits.test.ts`: ask, hold, check run, agent command; `outcomes.test.ts`: timed out, replaced, waiter outliving its session, stop held while a subagent runs | the base, for all but the ask: no record of how a hold ended; a check run with no deadline runs on; no overrun recorded; `stalled` where `timed_out` and `replaced` are due; an idle session with its ask open, and one held while its subagent runs, read `finished`. The ask passes on the base: twin `skip-default-at-deadline`. Twins `waiter-outlives-session` and `answer-skips-held-stop` kill the waiter and subagent tests' earlier checks once the base's `finished` is fixed |
| AC5 `#27.ffbe7d6f` | 20 runs, within 2 s at p95, reference Mac, local preflight, vs the merge base | `budgets.test.ts` (three) | the base: no lane runs the file; the budget itself was INCONCLUSIVE here (load 26.7 on 12 cores; this checkout p95 337 ms, the merge base 265 ms); `waiter-checks-every-5s` (the instrument's own test, and the twin) |

## Files

- `helpers.ts`: temp homes and stand-ins, the repo, `deep setup`, the hub and its socket, the stand-in's client,
  asking and idle sessions, `deep inbox answer` and `deep inbox`, delivery outcomes, the process table, the machine
  rule, the merge base's build.
- `wake.test.ts` (AC1), `repeat.test.ts` (AC2), `desktop.test.ts` (AC3), `waits.test.ts` and `outcomes.test.ts`
  (AC4), `budgets.test.ts` (AC5), `session.live.test.ts` and `live.ts` (AC1 and AC2 live), `MANUAL.md` (AC3).
- `fixtures/claude.mjs` (#25's stand-in, copied), `fixtures/stub-bin.sh`.
- `twins.json`, `twins/<plant>/packages/hub/src/plant.ts` (and `setup.ts`): the planted wrong programs for the proof lane.
- `BASE-FAILURE.txt`: the run at the base, and why each test fails or which twin kills it.
- `tsconfig.json`: the root options with `noEmit`.
