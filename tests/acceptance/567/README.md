# Acceptance tests for #567: the verdict spine's exit

A seeded false "done" in a Claude Code session is held, sent back, and its verdict line shows in the chat, with only
the spine's 25 tasks landed; and the spine's time is measured and recorded.

Written first, blind, by a job that never saw an implementation of #567 (none existed). It read:

- issue #567 as of November 4, 2026 (`updatedAt` 02:18:57Z): Scope, the three checkbox criteria, Proof and Depends on
  (#48, #322, #303, #83, #30, #29, #25, all closed and merged at the base); it has no comments;
- `docs/technical-design.md`: Six weeks to version 0 ("The verdict spine is the first exit"), An agent says it's done
  (Every stop is judged, The verdict in the chat), States people see, the done-gate and spec-draft rows of First-party
  extensions that ship on by default, and the `.deepbuild/done.yaml` example;
- the `spine` label's 25 issues and their sub-issues on GitHub (below), and the READMEs of the suites whose surfaces
  it drives: `25/live/`, `29/`, `30/`, `83/`, `303/`, `322/`, `48/`, and `666/` and `668/` for the conventions;
- base commit `d2623d97` (origin/main): `packages/hub/src/{server,core,claude-settings}.ts`, `scripts/agent-harness.mjs`,
  `scripts/proof-runs.mjs` (how twins are laid over a checkout), `scripts/lanes.mjs`, `adapters/claude-code.facts.json`
  and its corpus;
- redrafted blind on November 4, 2026 for one dispute, against the branch's new base `1d858ece` (origin/main merged
  in): issue #1202 and its PR #1203 (`0c8460c9`), and that base's `packages/hub/src/claude-settings.ts`. `deep setup`'s
  entries now exec deep-hook, so the stand-in's own `exec` (the first draft's dash workaround) ran `exec exec …` and
  failed; the stand-in is #83's as-is again (Readings, 10). No test, check or expected value changed.

The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 first on `PATH` (`.node-version`) and the Rust toolchain:

```sh
npm ci && npm run build --workspaces     # the tests run the built CLI, packages/cli/dist/main.js
cargo build --locked -q -p deep-hook     # setup's entries run target/debug/deep-hook (a test builds it if missing)
npx vitest run --root tests/acceptance/567 --no-file-parallelism fast.test.ts
DEEP_HARNESS_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=<from `claude setup-token`> npx vitest run --root tests/acceptance/567 session.live.test.ts   # by hand only: spends plan usage
node node_modules/typescript/bin/tsc -p tests/acceptance/567/tsconfig.json
```

- **Fast tests** (`fast.test.ts`) start no agent and spend nothing: the exit's scenario with a made-up session whose
  hooks run through `deep setup`'s entries into the real deep-hook and hub (seconds), and the spine's record read
  against this checkout's git history (seconds; it needs the full history: a shallow checkout is `BLOCKED`).
- **The live test** (`session.live.test.ts`) runs one real Claude Code session through the agent test harness on your
  own sign-in. Without `DEEP_HARNESS_LIVE=1` (#48's opt-in), without `CLAUDE_CODE_OAUTH_TOKEN`, or without a `claude`
  on `PATH`, it fails with `BLOCKED` in its message; nothing skips.
- Every test makes its folders under `/tmp/dh567-*` (a socket path must stay short), sets `HOME` to `<tmp>/h` for every
  process it starts, and never touches the real `~/.deepbuild`, `~/.claude` or `~/.claude.json`. It stops only processes
  it started, by PID, and the process groups its stand-in started for hook entries. No child inherits a billing key, a
  forge token or a `CLAUDE*`, `DEEP_*`, `GIT_*`, `XDG_*` or `OTEL_*` variable of the runner's; the live run passes
  `CLAUDE_CODE_OAUTH_TOKEN` to the harness explicitly, and nothing else. No test reaches the network.
- With `--root` here, Vitest writes its cache to `tests/acceptance/567/node_modules/.vite/`; delete it before committing.
- **`scripts/lanes.mjs` needs two entries this job didn't make** (it edits nothing outside this folder):
  `tests/acceptance/567/fast.test.ts` in `alone` (it starts hubs and builds deep-hook, as #666's and #668's do), and
  `tests/acceptance/567/session.live.test.ts` in `byHand`, or a release lane of its own that runs it with the opt-in,
  as #666's and #668's have. Without the second the unit lane runs the live file and it fails `BLOCKED` there.

**The proof** is written to `$TMPDIR/deep-567-proof/` (`os.tmpdir()`), rewritten on each run and never read back, with
this machine's home folder and the temp folders redacted: `fast/` (`record.json`, the record after the false "done";
`false-done.json` and `true-done.json`, what each stop showed at the agent's side; `transcript.jsonl`), `live/`
(`run.json`, the harness's run line; `harness.txt`; `transcript.jsonl`, the harness's copy; `record.json`;
`false-done.json`; `machine.txt`) and `spine/measured.json` (the recorded and the measured time side by side).

`BASE-FAILURE.txt` is the run at the base.

## The surface under test

### Merged surfaces, used as their suites define them

Each is a spine task's (AC2: the exit reaches DeepBuild through nothing else):

| Surface | Spine task |
|---|---|
| `deep hub run`, its ready line, its socket, `events.read` on a `cli` connection with the control token | #16 (the hub) |
| `deep-hook claude-code <event>` as setup's entries run it, the hub's reply mapped to Claude Code's hook output (`decision: block` with its `reason`; `systemMessage`) | #17 (deep-hook), #13 (the hook protocol) |
| `deep setup`: DeepBuild's entries in `~/.claude/settings.json`, the foreground Stop entry among them | #18 (the Claude Code adapter), #25 (the Stop hold) |
| A judged stop: a stop whose turn, begun with a prompt you typed, made an edit; its `claim.made`, `run.started`, `run.finished` (`check`, `outcome`) and `verdict.made` | #303 (ask-tasks), #29 (the gate runner), #28 (the verdict engine) |
| `.deepbuild/done.yaml`'s command check, run hermetically, under project trust reused from Claude Code's workspace trust (`~/.claude.json`'s `projects[<repo>].hasTrustDialogAccepted`) | #322 (the done gate's core reads, of #32), #30 (command checks), #348 (project trust, of #44) |
| The verdict line: the Stop reply's `systemMessage`, and the first line of a send-back's reason; the receipt's `line` (`changes.read {id: <claim>}`) | #83 |
| `scripts/agent-harness.mjs` and its run line | #48 |

`deep_claim`, `deep inbox`, `deep status` and every other surface of a task outside the spine stay unused. The hub runs
with no `DEEP_HUB_TEST_*` seam but `DEEP_HUB_TEST_CONFIRM` (the OS confirmation stubbed, which nothing in the exit
reaches).

### The fixture repo

Written at run time to `<tmp>/shop`, one commit on `main`: `src/auth.js` (`checkToken: (token) => token.exp > 0`, the
bug), `tests/unit.test.js` (two node:test tests, one failing until the fix `token.exp > Date.now() / 1000`),
`package.json`, and `.deepbuild/done.yaml`, the design's bootstrap spec cut to one command check:
`claims: { done: { checks: [unit] } }`, `checks: { unit: { type: command, run: "node --test tests/unit.test.js",
min_tests: 1 } }`. `<tmp>/h/.claude.json` marks the repo trusted in Claude Code's workspace trust, first-run screens
done. `<tmp>/bin`, first on `PATH`: stand-ins for `launchctl`, `systemctl` and (fast tests only) `claude`, each logging
its call and exiting 0, and a `deep` that runs the built CLI.

### The made-up session (fast)

`fixtures/claude.mjs` is #83's Claude Code stand-in, copied as-is: each entry runs as `/bin/sh -c <command>`, as
Claude Code runs it (Readings, 10). It runs every entry
of the user settings file for a hook, as Claude Code does, writes "Stop hook feedback" into the transcript when a Stop
is blocked and each `systemMessage` as a `hook_system_message` attachment. The session: SessionStart; the prompt you
typed, `Make checkToken in src/auth.js reject expired tokens.` (its transcript entry `turnOrigin: human`); a Read of
`src/auth.js`; an Edit that adds a comment and fixes nothing; then Stop with the seeded false "done", `Done. Expired
tokens are rejected and all tests pass.` After the check, the agent makes the fix and stops again (Claude Code's
continuation, `stop_hook_active: true`).

### The live session

The harness's `false-done` scenario (Additions, 1) in `<tmp>/shop`, with `HOME` the temporary home, so its user
settings are the file `deep setup` wrote; the real hub; the real `claude` on `PATH`. What the test reads: the run line,
the harness's hook log of Claude Code's payloads (each Stop's `last_assistant_message` and `stop_hook_active`), the
transcript, the terminal's screen, and the record (`events.read`, `changes.read`).

### The spine's record (where neither the issue nor the design names a surface)

The design says the spine is "measured on its own" and that a replan is "recorded as a design change", and the issue
that the spine's time is "measured and recorded", without saying where. The smallest surface that fits the repo: one
JSON file, `docs/spine.json`, written by the implementation and read here against git, never taken at its word
(invariant 1):

```json
{
  "tasks": [
    { "issue": 12, "landed": [{ "issue": 12, "merge": "<sha of the merge on main>" }] },
    { "issue": 13, "landed": [{ "issue": 311, "merge": "<sha>" }, { "issue": 312, "merge": "<sha>" }, "…"] },
    { "issue": 32, "counts_as": [322], "landed": [{ "issue": 322, "merge": "<sha>" }] },
    { "issue": 44, "counts_as": [348, 349, 350], "part": "<names R1's slot kits>", "landed": ["…one per counted issue…"] },
    { "issue": 236, "part": "<names its run tokens>", "landed": [{ "issue": 236, "merge": "<sha>" }] }
  ],
  "started": "<ISO time>", "landed": "<ISO time>", "days": 0.0,
  "weeks": { "plan": "six weeks" | "replanned", "design_change": "<sha>" | null }
}
```

## Readings where the issue and design leave a choice

1. **"A seeded false 'done'"**: a stop whose turn did work (an edit that leaves the bug in place) and whose last words
   say it is done, while the repo's spec check fails. Live, the harness's prompt seeds it: it asks for that edit and
   those words. A run where the spec check passed at the stop (the model fixed the bug anyway) seeded nothing:
   `INCONCLUSIVE`, as is a first stop whose words don't say done.
2. **"Held"**: DeepBuild's Stop entry didn't let the stop through, and it replied only after the check ran: the
   claim's `run.finished` of `unit` is stamped no later than the entry's return (1 s of slack between the two clocks).
   Live, Claude Code went on after the stop (a later Stop with `stop_hook_active: true`), and the run finished no later
   than the transcript entry that carries the send-back. **Held for being false**: in the fast test, the same session's
   stop after the fix isn't sent back (a hub that sends every stop back fails).
3. **"Sent back with the failing check named"** (the Proof): the send-back's reason, as Claude Code keeps it, names the
   failing check, `unit`, and the record has that check's failed `run.finished` for the stop's claim.
4. **"Its verdict line shows in the chat"**: the line is the Stop reply's `systemMessage`, or the first line of the
   send-back's reason (#83's reading 3); it fits 80 columns and says `sent back` (States people see), never `PASS`. Fast,
   the chat is what the stand-in kept: the `hook_system_message` attachments and the "Stop hook feedback" entry. Live,
   the line is the receipt's `line` for the stop's claim (`changes.read`, "the line the chat showed", #83), and it must
   be on the terminal's screen (escape codes stripped, whitespace collapsed) or in a transcript entry that isn't the
   agent's or a typed prompt.
5. **"The spine's 25 tasks"** are the 25 issues the `spine` label lists (12, 13, 14, 15, 16, 17, 18, 22, 25, 28, 29,
   30, 31, 32, 44, 47, 48, 56, 80, 83, 86, 236, 237, 303, 304), constants in `helpers.ts`, never read from GitHub at run
   time. Per the issue: #44 counts as #348, #349 and #350 (`counts_as`, and `part` naming R1's kits); #236 as its run
   tokens (`part`); #32 as #322 (`counts_as`). #13 and #17 landed through their sub-issues (#311 to #314, #315 to
   #317), so each of those lands it.
6. **"Landed"**: each issue a task lands by has a merge on HEAD's first-parent line whose message, or a commit it
   brought in, names it (`#n`, `issue-n` or a branch's `/n-`, never inside a longer number). A record missing a task,
   counting #44 whole, landing #32 as itself, giving #236 no part, landing a task by a commit that isn't a merge or by
   another task's merge, fails naming the task. **"It runs with only the spine's 25 landed"** is read as: the exit's
   tests above pass at a checkout where all 25 have landed, reaching DeepBuild only through the spine's surfaces
   (the table above, kept by review: no machine check can tell a surface's task from its code).
7. **"Measured"**: from the record's merges, by git: the spine started at the earliest author time of any commit those
   merges brought in, and landed at the latest merge's commit time; `days` is the difference (within 0.01). The
   recorded `started`, `landed` and `days` must equal it.
8. **"Recorded"**: in `docs/spine.json` (above), in the checkout the tests run on.
9. **"Held to six only once it has landed and been measured"**: `weeks.plan` is `six weeks` or `replanned`, only with
   every task landed (Reading 6) and the time measured (Reading 7). Past 21 days (three weeks) the plan must be
   `replanned` and `design_change` must name a commit in HEAD's history, made after the spine landed, that changes the
   design's "Six weeks to version 0" section (design: "planned again from its measured pace before week 4 starts, and
   the change is recorded as a design change"). Since a real spine may take three weeks or less, the rule's three
   wrong cases are also checked on a spine of 22 days, whatever this one took.
10. **Linux.** Claude Code runs each hook command with `/bin/sh -c`, and the hub binds a session's hooks by deep-hook's
    parent. dash, `/bin/sh` on Debian and Ubuntu, runs a lone command as a child of a new shell, so before #1202 every
    hook past SessionStart went unverified there. Since #1202 (PR #1203) `deep setup`'s entries are
    `exec '<deep-hook>' claude-code <Event>`, which leaves deep-hook the agent's child under dash as under bash. The
    stand-in therefore runs each entry exactly as Claude Code does, with no shell workaround of its own: an entry that
    loses the `exec` fails AC1 on a dash machine, which is the hub's failure on that platform, not this test's.

## Additions the implementation must make

This job edits nothing outside this folder.

1. **A harness scenario**, `false-done`, in `scripts/agent-harness.mjs` (and its usage line):

   ```
   node scripts/agent-harness.mjs run --scenario false-done --workdir <dir>
        [--pass-env <NAME>]... [--claude <path>] [--timeout-ms <n>] [--out <dir>]
   ```

   - One interactive Claude Code session in a pseudo-terminal in `--workdir` (an existing folder the harness neither
     makes nor removes), from the facts' session launch (Haiku, never `-p`), with the version gate and sign-in check as
     today (a version the facts don't cover is `BLOCKED`).
   - It loads your user settings and nothing of the workdir's (`--setting-sources user`), so `$HOME/.claude/settings.json`
     from the harness's environment runs, as `fix-checkout-test` does; the harness's own hooks go only in its
     `--settings` file and record every SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, StopFailure and
     SessionEnd payload with `at` (epoch ms), one JSON line each.
   - Tools `Bash`, `Read` and `Edit`, allowed with no prompt, with #666's scripted-session system prompt; the harness
     answers the folder's trust prompt as today.
   - Once the session is ready it types, word for word, ``Add the comment `// Tokens are checked here.` as the first
     line of src/auth.js, and run nothing. Then end your turn with exactly: Done. Expired tokens are rejected and all
     tests pass.`` (`helpers.ts`, `LIVE_PROMPT`). It never answers a Stop hook's feedback itself: the session goes on
     as Claude Code goes on.
   - It ends the session with `/exit` once the turn is over: Claude Code wrote `turn_duration` after the last Stop (its
     Stop hooks, DeepBuild's hold among them, have ended), or the timeout.
   - It prints #48's run line: `verdict` `PASS` when the turn ended with Stop; `sessionId`; `transcript` (its copy);
     `workdir`; and `evidence: { prompt, events, screen }`: the prompt it typed, the path of its hook log, and the path
     of the terminal output it kept.
   - The scenario stays out of `all` and the harness budgets lane: it needs DeepBuild's hub.
2. **The spine's record**, `docs/spine.json` (above), with the 25 tasks, the merge each issue landed by, the measured
   time, and the weeks' plan; and, if the measured spine is past three weeks, the design change it names.
3. **Claude Code's facts cover the version on the machine** (2.1.317 here; the facts cover 2.1.299, 2.1.304 and
   2.1.308), or the live run is `BLOCKED` at the harness's version gate.
4. **`scripts/lanes.mjs`**: the two entries in How to run.

## Criteria to tests

IDs are `#567.<first 8 hex of SHA-256 of the criterion's text, trimmed, whitespace collapsed, the leading "- [ ] "
dropped>` (#48's command). Each `describe`, test name and failure message starts with its ID.

| ID | Criterion (short) | Tests | Wrong program each fails on |
|---|---|---|---|
| AC1 `#567.4297f978` | a seeded false "done" is held, sent back, and its verdict line shows in the chat | `fast.test.ts` AC1 (the made-up session, then its true "done" let through); `session.live.test.ts` AC1 (live), the same check on a real session | twin `no-stop-hold` (`twins.json`: `packages/hub/src/server.ts` whose Claude Code Stop gets no hold, so it is answered at once with the empty reply): "the seeded false "done" must be held and sent back: DeepBuild's Stop entry let the stop through"; a hub that sends every stop back (the true "done"); a send-back that doesn't name `unit`; a line wider than 80 columns, saying PASS, or not in the chat |
| AC2 `#567.934c6451` | it runs with only the spine's 25 tasks landed, #44 as #348, #350 and R1's kits from #349, #236 as its run tokens | `fast.test.ts` AC2: the record against git; AC2 (wrong records): six wrong copies of the record | the base: no record; a record missing #31, counting #44 whole, landing #32 as itself, #236 whole, #25 by a commit that isn't a merge, #28 by #29's merge (each named) |
| AC3 `#567.317a15a0` | the spine's time measured and recorded; six weeks held only once it has landed and been measured | `fast.test.ts` AC3: the recorded time against git's and the weeks' rule; AC3 (wrong records): five wrong copies, and the rule's three wrong cases on a 22-day spine | the base: no record; a day added, a start a day early, a landing an hour late, no plan, #30 not landed; past three weeks: held to six, no design change, a design commit from before the spine landed |

A live test whose session is `BLOCKED` (no opt-in, no token, no `claude`, no scenario, an uncovered version) fails as
`BLOCKED`; one whose harness didn't type the seeding prompt fails `INVALID`; one whose session didn't end its turn with
Stop, never stopped, or whose "done" wasn't false fails `INCONCLUSIVE`.

## What the base does (found while writing these tests)

- **The exit already holds at the base on the made-up session** (AC1's fast test passes): the spine has landed, and the
  false "done" is held about 300 ms while the spec's `unit` check runs, sent back with "DeepBuild sent this claim back:
  the repo's spec check unit FAIL.", and its line is `sent back 1/3 · next: agent · receipt`, both as the reply's
  `systemMessage` and as the send-back's first line. The same session's stop after the fix is let through with
  `says done 1/1 · next: DeepBuild · receipt` (no PASS: the task's definition never locks without a drafting job, so
  "definition: runs still to come"). The twin `no-stop-hold`, laid over a copy of the base and built, fails it at
  "held" (BASE-FAILURE.txt).
- The base has no `docs/spine.json`, so AC2 and AC3 fail there. A record built by hand from today's history (in a
  scratch copy, not kept) passed all four AC2 and AC3 tests, its mutants failing as named, and measured the spine at
  18.99 days, from 2026-10-15T20:06:11Z (the first commit of #12's pull request; the repo's history starts that day,
  though the issues were opened on October 6) to 2026-11-03T19:57:11Z (#322's merge). By that measure the weeks may be
  held to six with no design change; a record that counts from October 6 would need git history this repo doesn't have.
- The merged harness has no `false-done` scenario, and Claude Code here is 2.1.317, outside the facts' versions, so the
  live test is `BLOCKED` until Additions 1 and 3 land.

## What that means for the proof

AC1 is proven on the merged spine by the fast test only; the issue's Proof is a real session's recording, so a PR for
this issue says `Closes #567` only with the live file's run (PASS) kept as evidence, on a machine where the hub binds
Claude Code's hooks (Readings, 10); otherwise `Part of #567`.

## Files

- `helpers.ts`: the world, `deep setup`, the hub and its socket, the Claude Code stand-in's client, the made-up session,
  the harness run and what its session showed, AC1's check, the spine's constants, the record's reader and AC2's and
  AC3's checks against git, the proof writer.
- `fixtures/claude.mjs` and `fixtures/stub-bin.sh`: #83's, as-is.
- `fast.test.ts`, `session.live.test.ts`: the tests. `tsconfig.json`: the root options with `noEmit`, the twin left out (it type-checks only where it lands, in `packages/hub`).
- `twins.json`, `twins/no-stop-hold/packages/hub/src/server.ts`: the build without the Stop hold, for the proof lane.
- `BASE-FAILURE.txt`: the run at the base.
