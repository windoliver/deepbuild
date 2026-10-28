# Acceptance tests for #25: budgets and the live delivery routes

Written first, blind, from issue #25 (its body as of October 27, 2026), the design sections it links and those around
them (An ask, and your answer getting back; What each agent gives us, the Claude Code row and the bullets after it;
Hooks are evidence, not a state machine; Numbers version 0 has to hold; How we know version 0 works, with
Dogfooding), `spikes/80/decision.json`, `adapters/claude-code.facts.json` and base commit `0350cf0`, by a job that
never saw an implementation of #25. The implementing agent does not edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job.

The issue has 12 checkbox criteria, AC1 to AC12 in the body's order. **This folder covers AC8 (budgets) and the
issue's Proof line**: a live test per route on interactive sessions run by the harness (#48), and the manual
desktop-app test (`MANUAL.md`). The live tests prove AC1 (Stop hold), AC2 (waiter wake), AC9's fallback half (next
prompt) and AC7 (SessionStart on a resume). Two sibling blind jobs cover the fast tests in `../routes/` and
`../fallbacks/`.

## How to run

With Node 24.22 first on `PATH`, the workspaces built (`npm run build --workspaces`) and `target/debug/deep-hook`
built (a test builds it if it's missing):

```sh
npx vitest run --root tests/acceptance/25/live --no-file-parallelism budgets.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/25/live/tsconfig.json
DEEP_HARNESS_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=... npx vitest run --root tests/acceptance/25/live routes.live.test.ts   # by hand only: spends plan usage
```

- `budgets.test.ts` takes about 9 minutes on a loaded Mac (two measurements and three plant runs) and about 20 on a
  fit reference Mac (a warm-up, five runs, the merge base, the plants). Every measurement waits out deep_ask's own
  40 s wait and the 60 s stop hold, which are protocol, not test overhead. Run it with nothing beside it.
- `routes.live.test.ts` takes about 35 minutes with its plant runs (the idle-wake test alone runs six rounds of
  about two minutes). It never runs without `DEEP_HARNESS_LIVE=1`; without it every test fails BLOCKED.
- Every test makes its folders under `/tmp/dh25l-*` (a socket path must fit in 104 bytes), sets `HOME` to `<tmp>/h`
  for every process it starts, and never touches the real `~/.deepbuild`, `~/.claude` or `~/.codex`. It stops only
  processes it started, by PID, with their process groups. No child inherits a billing key, a `CLAUDE*` variable or
  a `DEEP_*` setting of the runner's; the live runs pass `CLAUDE_CODE_OAUTH_TOKEN` to the harness explicitly.
- The merge base's build is kept at `/tmp/dh25l-base-<sha12>` between runs (it is reused, not rebuilt); remove it
  to reclaim the space. When this checkout's `packages/`, `crates/` and manifests are the merge base's, the base
  side is this checkout's own build and nothing is copied.
- With `--root` here, Vitest writes its cache to `node_modules/.vite/` in this folder; delete it before committing.
- Machine load: deep-hook gives up on a hub that hasn't acknowledged within 50 ms (#315), so on a badly loaded Mac a
  Stop can go through unheld. The budget measurement counts such a stop, stops the session again (up to three
  times), and reads a route that still doesn't deliver as INCONCLUSIVE, with the load, when the machine is loaded
  past its cores; on a machine that isn't, it fails. A live run on a loaded Mac can miss the hub the same way; rerun
  it, and keep the run's load with the result.

## The surface under test

### Merged surfaces, used as their suites define them

- **The hub**: `deep hub run` with `HOME` the temporary home, its ready line, the socket's line protocol, a `cli`
  connection with the control token, `events.read` (the record's `session.start`, `ask.created`, `ask.answered`,
  `agent.stop` and `session.end` events), `ask.answer` (`deep inbox answer`'s request). `DEEP_HUB_PLANT=<name>`
  selects a planted program, and a name the hub doesn't know makes it exit at start (#16).
  `DEEP_HUB_TEST_CONFIRM` names a file holding `confirmed`, the OS confirmation stubbed (#24).
- **`deep setup`** writes DeepBuild's hook entries into `~/.claude/settings.json` (#18): a foreground Stop entry and
  the waiter, DeepBuild's one entry with `asyncRewake: true`. DeepBuild's entries are those whose command runs
  deep-hook or the deep CLI, as #18's suite reads them. The tests run each command exactly as setup wrote it.
- **`deep mcp`** started by the session's own process, and **`deep_ask`** filing an ask under the session and coming
  back "still waiting" with the ask open once its wait runs out (#26, #18).
- **`deep inbox answer <ask> <option>`** (#24), the answer the issue's Proof names.
- **The harness** `scripts/agent-harness.mjs` (#48) and its run line, for the live file.
- **Claude Code's facts** (`adapters/claude-code.facts.json`): the continuation field `stop_hook_active`, the
  transcript path, the covered versions. From #80's decision: a waiter's wake starts a turn with a UserPromptSubmit
  whose prompt is a task-notification carrying the waiter's stderr.

### Defined here, where the issue and the design leave a surface open

1. **Budgets: the measurement** (`measure.ts`). One measurement of a checkout, with `HOME` a fresh temporary home:
   its hub starts, `deep setup` runs, and 20 sessions of the Claude Code stand-in (`fixtures/claude.mjs`, #18's,
   copied) each fire SessionStart and a typed prompt, then call `deep_ask` (kind `choice`, options `a` and `b`)
   through their own `deep mcp`, which comes back still waiting with the ask open. A real Claude Code can't stop
   during a tool call, so each stop comes only after deep_ask came back.
   - **Held stops** (10, one at a time): the session's Stop fires through setup's entries; once the hub has
     recorded it and 300 ms more, you answer `b` on the socket (`ask.answer`, as `deep inbox answer` sends it). The
     reading is when DeepBuild's foreground Stop entry ended, its stdout carrying `decision: block` with the answer
     (the ask's ID or the chosen label), less when the answer's line was written to the hub. This is "beyond the
     checks it waits for": a held stop at this point waits on your answer, and everything after the answer exists
     is what the hold adds. A stop that ends without the answer fails the test, naming the session.
   - **The waiter** (10 idle sessions): their Stops fire together; each is held while its ask is open, then let
     through. 3 s after each waiter started, its processes are sampled, and again 30 s later, while the stops are
     still held. A waiter's processes are everything under the shell Claude Code starts the entry with (by parent and
     by process group), the shell itself only once it became the waiter by exec. Its memory is their summed resident
     size, the larger sample; its CPU is the CPU time they used between the samples (ps, 10 ms resolution). A waiter
     that ended while waiting, or that has no process, fails the test.
   - **The wake** (the same 10, one at a time, after their holds ended): you answer `b`; the reading is when the
     waiter exited with code 2 and the answer on stderr (what Claude Code wakes the idle session with), less when
     the answer's line was written. A waiter that hasn't woken within 30 s, or ends without the answer, fails.
   - The stand-in stamps each hook run's end itself, so polling it doesn't bias a reading.
   - A session a route didn't deliver to is named in the measurement's failures and its reading left out. For this
     checkout any failure fails the test, naming the session, unless the machine was loaded past its cores, when it
     is INCONCLUSIVE with the load.
   - Sessions start one at a time, each once the one before has its ask filed, so 20 `deep mcp` processes don't all
     reach for the hub at once; a deep_ask that comes back `unavailable` is called again, up to three times, as its
     remediation says. A stop that went through before you could answer is counted (`missedHolds`) and the session
     stops again.
2. **Budgets: the judge.** Each run reads four numbers: the held stops' p95, the wakes' p95 (nearest rank over the
   ten), the largest waiter memory and the most waiter CPU. Each is judged over five runs after a warm-up by the
   design's rule: PASS when all five are within the limit (held stop under 20 ms, wake at most 2,000 ms, memory under
   5,000,000 bytes, CPU 0 ms, "no CPU" at ps's resolution); FAIL when all five are over it by more than the margin,
   the larger of 5% and the five runs' spread; otherwise INCONCLUSIVE with all five attached.
3. **Budgets: the merge base.** The same driver measures the merge base with origin/main on its own build (see How
   to run), once, after the warm-up. A reading regresses when this checkout's median over the five runs is more than
   50% above the base's and further from it than the instrument resolves: 2 ms for times, 1 MB for memory, 10 ms for
   CPU (Disputes, 3). Every reading prints beside the base's. A route the merge base doesn't deliver has no base
   reading; that is printed with the base's failures, and nothing regresses from it. (At `0350cf0` the base's held
   stops never continue with the answer: the waiter Claude Code started at the same Stop takes it first and exits 2,
   and the stop is let through a second later. That is the base shown to lack the route.)
4. **Budgets: the machine.** Readings count only on a reference Mac (Mac15,7 with an M3 Pro and 36 GB, or Mac15,12
   with an M3 and 16 GB), Low Power Mode off, thermal state nominal, on battery or mains alike (the owner's rule,
   October 19 and 24), with the 1-minute load average at or below the core count at every reading taken around the
   runs. Anywhere else the test skips as INCONCLUSIVE with the readings and the load, never PASS or FAIL. The plant
   tests are the instrument's own check and run on any machine.
5. **"In the local preflight"**: some check lane in `scripts/lanes.mjs` runs `budgets.test.ts` with Vitest and
   `--no-file-parallelism` (it starts hubs and times them), not as an `--exclude` argument.
6. **The live sessions** (`live.ts`). Each run: a temporary home, its hub, `deep setup`, Claude Code's onboarding
   marked done in `<home>/.claude.json`, a work folder, an MCP config naming `deep` as `node <cli> mcp`, and the
   harness's `deep-answer` scenario (Additions, 1). While the harness runs, the test answers at the route's moment,
   read off the hub's record and the live transcript Claude Code writes under the temporary home, always option
   `b` with `deep inbox answer`. "The turn is over" is Claude Code's `turn_duration` transcript entry after the stop:
   its Stop hooks, the hold among them, have finished (the corpus's 2.1.304 transcripts write it after
   `stop_hook_summary`). After the run, what reached the session is read from Claude Code's side only: the hook
   payloads the harness's own hooks recorded, and the transcript.
   - **The answer's IDs** are its ask's ID and the ID of every event the record holds about it once answered
     (`ask.answered`, deliveries). Text **carries the answer** when it holds one of them or the chosen option's label.
   - **A wake** is a UserPromptSubmit the harness didn't type (#80: the waiter's stderr as a task-notification).
   - **A delivery entry** is a transcript entry that isn't the agent's words, a tool result, a typed prompt, a
     `queue-operation`, `stop_hook_summary` or `turn_duration`, and carries the answer.
   - **A reply carries the answer** when the stop's `last_assistant_message` holds the chosen label and not the other.
7. **Routes, live:**
   - `stop-hold` (AC1): you answer 2 s after the hub recorded the stop, during the hold. Passes when a Stop with
     `stop_hook_active: true` follows the held stop and its reply carries the answer, and no wake carried it.
   - `idle-wake` (AC2): six rounds; in each you answer 1 s after the turn is over. Passes when each answer is
     followed by a wake carrying it and a reply carrying it. The delay is the earlier of the wake's hook and its
     delivery entry, less the record's `ask.answered` time; rounds 2 to 6 (round 1 is the warm-up) are judged
     against 2 s as five runs, under the machine rule above.
   - `next-prompt` (AC9's fallback): 1 s after the turn is over, the test stops every process under the harness
     running DeepBuild's waiter entry (SIGTERM, then SIGKILL after 3 s), as Claude Code stops a waiter at its timeout,
     then answers, waits 5 s, and lets the harness type the next prompt. Passes when that prompt's reply carries the
     answer. INCONCLUSIVE when no waiter process was found or the session was woken anyway; also when the reply is
     right but no delivery entry follows the prompt (Disputes, 5).
   - `resume` (AC7): you answer once the record has session A's SessionEnd. Then a new session B on other work in
     the same folder runs, and then A is resumed. Passes when nothing in B carries the answer, the resumed thread's
     SessionStart has source `resume` and its reply carries the answer, and the delivery entry comes before its typed
     prompt or names SessionStart. A delivery entry after the prompt naming UserPromptSubmit fails; one naming no hook
     reads INCONCLUSIVE (Disputes, 4).

### Additions the implementation must make

1. **A harness scenario**, `deep-answer`, in `scripts/agent-harness.mjs` (and its usage line):

   ```
   node scripts/agent-harness.mjs run --scenario deep-answer --route <stop-hold|idle-wake|next-prompt|resume>
        --workdir <dir> --mcp-config <file> [--go <file>] [--rounds <n>]
        [--pass-env <NAME>]... [--claude <path>] [--timeout-ms <n>] [--out <dir>]
   ```

   - Interactive Claude Code sessions in a pseudo-terminal in `--workdir` (never `-p`), from the facts' session
     launch, except that each loads your user settings (`--setting-sources user`, as `settings-tamper` does), so
     DeepBuild's entries in `$HOME/.claude/settings.json`, as `deep setup` wrote them, run; and `--mcp-config <file>`
     (with the facts' `--strict-mcp-config`), so the session starts `deep mcp` itself. `mcp__deep__deep_ask` is
     allowed without a prompt and no built-in tool is needed. The harness's own hooks go in its own `--settings`
     file, never in the user settings, and record every SessionStart, UserPromptSubmit, PreToolUse, PostToolUse,
     Stop, StopFailure and SessionEnd payload with `at` (epoch ms), one JSON line each, per session. It answers
     the folder trust prompt as its other scenarios do.
   - **The ask prompt** (round `r`, two fresh code words): call `mcp__deep__deep_ask` once, kind `choice`,
     question containing `round <r>`, options `a` and `b` labelled with the two code words; whatever it returns,
     call no other tool and end the turn in one sentence without the code words; when an answer to that question
     reaches you later, reply with only the chosen code word. **The follow-up prompt**: reply with only the word
     READY, unless an answer to a question you asked has reached you, then only its code word. Prompts are one line.
   - `stop-hold`: one session, A; types the ask prompt; done when a Stop after the first one carries either code
     word in `last_assistant_message`, whatever brought it; then `/exit`.
   - `idle-wake`: one session, A, `--rounds n` rounds (default 1); each round types the ask prompt once the last
     round is done; a round is done when a Stop after the round's first carries one of its code words and Claude
     Code wrote `turn_duration` after it; after the last round, `/exit`.
   - `next-prompt`: one session, A; types the ask prompt; once the turn is over (`turn_duration` after the first
     Stop), waits until the `--go` file exists, then types the follow-up prompt; done at the Stop after it; `/exit`.
   - `resume`: session A types the ask prompt; once A's turn is over, `/exit` and wait for A to exit; wait until
     the `--go` file exists; session B, new, in the same folder, types the follow-up prompt, and `/exit`s after its
     Stop; then A is resumed (`--resume <A's session ID>`) as session `A2` and types the follow-up prompt; done at
     A2's Stop; `/exit`.
   - It prints #48's run line, also on FAIL and timeout. `verdict` is PASS when the route's sequence completed.
     `evidence` is `{ "route", "sessions": [{ "name": "A" | "B" | "A2", "sessionId", "transcript", "hooks",
     "typed": [{ "at", "text" }] }] }`: the run's copy of each transcript, the path of each session's own hook log,
     and each prompt the harness typed, with when.
   - `--pass-env CLAUDE_CODE_OAUTH_TOKEN` signs the sessions in under the temporary HOME; `--pass-env
     DEEP_HUB_PLANT` carries a plant to DeepBuild's entries and `deep mcp`.
   - The scenario stays out of `all` and the harness budgets lane: it needs DeepBuild's hub.
2. **Planted programs**, selected with `DEEP_HUB_PLANT` and listed in `packages/hub/src/wire.ts`'s plants. The tests
   set the variable on `deep hub run`, on `deep setup`, on the stand-in (so on deep-hook, the waiter and `deep mcp`)
   and, live, on the sessions through `--pass-env`, so a plant may live on any side.

   | Name | What the plant does wrong | Criterion | How the test fails on it |
   |---|---|---|---|
   | `stop-hold-polls` | the held stop looks for its answer every 250 ms instead of being told | AC8 | held-stop p95 at least 20 ms |
   | `waiter-polls` | the waiter runs in Node, as the merge base's does, and asks the hub for its answer every 50 ms | AC8 | waiter memory over 5 MB and CPU above 0 while it waits |
   | `waiter-checks-every-5s` | the waiter asks the hub for its answer every 5 s instead of being told | AC8 | answer-to-wake p95 over 2 s |
   | `stop-hold-releases-without-answer` | a held stop is let through without the answer when it comes, leaving it to the waiter | AC1 | live: the answer arrives by a wake, not the Stop hold; the failure names the ask |
   | `waiter-never-wakes` | the waiter exits 0 without waking when its answer comes, leaving it for the next prompt | AC2 | live: no wake; the failure names the ask |
   | `delivered-to-dead-waiter` | an answer counts as delivered once handed to the session's waiter, even one that is gone (the merge base's behaviour) | AC9 | live: the next prompt doesn't bring it; the failure names the ask |
   | `ended-answer-to-worktree` | an ended session's answer goes to the next session that starts in its folder, whatever it works on | AC7 | live: session B gets it; the failure names B |
   | `ended-answer-at-next-prompt` | an ended session's answer reaches its resumed thread only with the next prompt, never at SessionStart | AC7 | live: the delivery entry follows the prompt, naming UserPromptSubmit; the failure names the ask |

   The shared `tests/acceptance/25/twins.json` (outside this folder) should map `#25.e5d5c962` to the first three,
   `#25.0215da31`, `#25.ee0f30b0`, `#25.14a7bfb8` and `#25.3010b97e` to theirs.
3. **`scripts/lanes.mjs`**: `tests/acceptance/25/live/budgets.test.ts` in `alone` (the unit lane's one-at-a-time
   block), or a lane of its own that runs it the same way; `tests/acceptance/25/live/routes.live.test.ts` in `byHand`
   (without it the unit lane runs the live file and it fails BLOCKED), and in the release lane `claude code adapter
   live` (or a new release lane) as `env DEEP_HARNESS_LIVE=1 node node_modules/vitest/vitest.mjs run --root
   tests/acceptance/25/live routes.live.test.ts`.
4. The preflight's time: on a fit reference Mac this file runs about 20 minutes, which the checks' 900 s budget
   can't hold beside the rest. A change that keeps it in `alone` must say so; one that gives it a lane of its own,
   run apart from the checks' time budget as the harness budgets lane is, still satisfies item 5 above if that lane
   is a `checks` lane with `paths` covering the delivery code. This job doesn't choose.

## Criteria to tests

Each test's name starts with its criterion's number and ID, `#25.<first 8 hex of SHA-256 of the criterion's text,
trimmed, whitespace collapsed>`, as `scripts/proof-change.mjs` computes it.

| ID | Criterion (short) | Test | Wrong program it fails on |
|---|---|---|---|
| AC8 `#25.e5d5c962` | budgets on the reference Mac in the local preflight, against the merge base: held stop < 20 ms beyond its wait; waiter < 5 MB, no CPU; wake ≤ 2 s at p95 | `budgets.test.ts`: (1) a check lane runs the file one at a time; (2) the warm-up, the merge base and five runs, judged per Defined here 2–4; (3–5) each plant's reading over its limit | the base: no lane runs the file (1); on a machine not loaded past its cores (2) fails naming each held session, whose stop its own waiter answers first, and its Node waiter reads 61 to 71 MB; `stop-hold-polls` (3, and 2), `waiter-polls` (4, and 2), `waiter-checks-every-5s` (5, and 2); a waiter that doesn't wake or a held stop without the answer fails (2) outright |
| AC1 `#25.0215da31` | a held stop continues with the answer | `routes.live.test.ts`, stop-hold (live, two) | `stop-hold-releases-without-answer`; the base: no `deep-answer` scenario (BLOCKED) |
| AC2 `#25.ee0f30b0` | an idle session wakes within 2 s at p95 | `routes.live.test.ts`, idle-wake (live, two) | `waiter-never-wakes`; a wake over 2 s in all five rounds (FAIL on a fit reference Mac); the base: no scenario |
| AC9 `#25.14a7bfb8` | no wake: the view says so (desktop, `MANUAL.md`) and the answer falls back to the next prompt | `routes.live.test.ts`, next-prompt (live, two); `MANUAL.md` part 3 | `delivered-to-dead-waiter` (the base's own behaviour: its hub marks the answer delivered to a waiter that's gone); the base: no scenario |
| AC7 `#25.3010b97e` | an ended session's answer reaches only the same thread at SessionStart; a new session on other work gets nothing | `routes.live.test.ts`, resume (live, three) | `ended-answer-to-worktree`, `ended-answer-at-next-prompt`; the base: no scenario |

## Disputes

1. **"Beyond the checks it waits for."** In #25 a held stop waits on your answer, not a check run, so the reading
   is from the answer's arrival at the hub to the end of DeepBuild's Stop entry with it. #80 measured the same
   relation against its checks (7.2 to 10.2 ms in the Claude desktop app).
2. **"No CPU while it waits"** is read at ps's 10 ms resolution over 30 s: any tick fails it. A waiter blocked on a
   read uses none; one with a timer may tick once in some runs, which the judge reads as INCONCLUSIVE, not FAIL,
   unless every run ticks.
3. **The merge-base rule's floor.** The design's regression is a median 50% over the base's; on readings of a few
   ms that is noise, so a regression also has to exceed the instrument's resolution (2 ms, 1 MB, 10 ms). The
   absolute limits are the issue's, with no floor.
4. **"At SessionStart" from Claude Code's side.** Claude Code's transcript records hook context in entries whose
   shape for SessionStart on a resume this job couldn't check (the corpus has none). The test accepts an entry that
   precedes the resumed thread's typed prompt or names SessionStart, fails one that names UserPromptSubmit, and
   reads anything else as INCONCLUSIVE rather than guess.
5. **AC9 in the terminal.** The criterion is about the desktop app; its "view says so" half is `MANUAL.md`. The live
   test proves the fallback half where it can be forced: a waiter Claude Code stopped can't wake the session, so the
   answer must come with the next prompt. Stopping the waiter by PID stands in for Claude Code's timeout, which
   setup sets to at least the longest ask deadline, too long to wait out live.
6. **The live AC2 timing** treats each of rounds 2 to 6 as one run of the design's rule: six rounds of an
   interactive session take about 12 minutes, each spending deep_ask's 40 s and the 60 s hold. AC8's budget, from
   the stand-in, is the 2 s p95 with ten wakes a run.

## Files

- `helpers.ts`: temp homes and stand-in tools, a checkout's `deep setup` and hub, the socket, the Claude Code
  stand-in's client, the process table, the machine rule and the judge.
- `measure.ts`: AC8's measurement and the merge base's build.
- `live.ts`: the live runs through the harness, the answers at each route's moment, and the readers of what reached
  a session.
- `fixtures/claude.mjs` (#18's Claude Code stand-in, copied) and `fixtures/stub-bin.sh` (launchctl, systemctl, claude).
- `budgets.test.ts` (AC8), `routes.live.test.ts` (AC1, AC2, AC9, AC7, live), `MANUAL.md` (the desktop app).
- `BASE-FAILURE.txt`: the run on the base commit and why each test fails there.
