# Acceptance test for #321, criterion 1: a "proceed" never covers a call that needs authority

Written first, blind, by a job that never saw an implementation of #321 or #1101. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

## The criterion

`#321.70212996` (the first 8 hex digits of the SHA-256 of its text):

> A planted sorter answers "want me to push to main?" with "proceed": the proceed is recorded with its rule, and in
> the turn it starts the agent's `git push origin main` is held at PreToolUse with an authority ask naming the push,
> which waits for your answer; your yes starts the push's hold (#1101), a try during the hold is refused, and the
> push runs once the hold ends; after the same sorter's "proceed" for "want me to run the tests?", `npm test` runs
> with no ask. A core that lets a "proceed" cover the calls of the turn it starts lets the push through and fails
> this test, naming the call

This folder covers this criterion only. #321's other four criteria (the MCP server updates and the 1-day deadline)
are not here.

## What was read

- Issue #321's text (Scope, the five criteria, Proof, Depends on), and issue #1101's text for the hold only (its
  Scope and criteria: the 10 s hold, a try or Undo inside it, the hold kept by the hub).
- `docs/technical-design.md` as given to this job: Questions at the stop (the sort, "proceed", `question.proceeded`,
  "A 'proceed' never covers a call that needs authority"), A question holds the send-back (a proceed rides in the
  stop's one reply), An ask, and your answer getting back (Every ask ends, Where they reach you, Delivery), Before
  each command, Hook protocol (deep-hook and the hub), Plans before acting (The step drawn from the call, A hold
  before what can't be undone), and Dogfooding for the blind-test rule.
- The base commit `debda22a` (the only commit given): `AGENTS.md`; `packages/hub/src/server.ts` (how a hook is
  acknowledged, held and answered: `reply`, `holdFor`, `coreReply`; the `ask.answer` method and its roles),
  `core.ts` (`hookReply`, the stop hold, `trusted`, `answer`), `plant.ts` (`DEEP_HUB_PLANT`), `confirm.ts` and the
  `DEEP_HUB_TEST_*` settings, `claude-settings.ts` (the stop-hold relation), `setup.ts` (`installRules`),
  `inbox.ts`; `packages/asks/src/index.ts` (an approval binds to the plan's digest and a click token);
  `crates/deep-hook/default-rules.json`; and the suites of #18 (`mapping/`), #24, #25 (`routes/`), #304, #318,
  #319 and #320 for their conventions. `helpers.ts` adapts #18 mapping's helpers (same repo, same license).

Nothing outside these inputs was read. No sample implementation was written or run, so the passing side of the
test and the wrong program's failure are unverified until the implementation exists.

## Run

From the checkout's root, with the repo's Node (`.node-version`, 24.22.0), git, npm and the Rust toolchain:

```sh
npm ci
npm run build --workspaces                                  # the hub and the deep CLI the test starts
CARGO_BUILD_JOBS=1 RUSTC_WRAPPER= cargo build --locked -q -p deep-hook
npx vitest run --root tests/acceptance/321-ac1-70212996 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/321-ac1-70212996/tsconfig.json
```

- Each file runs `cargo build --locked -q -p deep-hook` once (a no-op when it's built) and starts its own
  `deep hub run`. `--no-file-parallelism` keeps the two files from building deep-hook side by side.
- Each run makes its folders under `/tmp/dh321-*` (a Unix socket path must fit in 104 bytes on macOS) and runs every
  process with `HOME` there, so nothing touches the real `~/.deepbuild`, `~/.claude` or the network. The git origin
  is a bare repository in the same folder. Every process the test starts is stopped by PID after each test, never by
  name or port. A child never inherits this process's agent markers, billing keys, `GIT_*`, `npm_*` or `DEEP_*`.
- The scenario waits on the wall clock: 3 s with the ask open, then the 10 s hold, so a passing run takes about
  20 s plus the hub's start; each test's timeout is 10 minutes, for a loaded machine.

## The test world

What a person's setup leaves that the hub and deep-hook read, written by the test (`helpers.ts`, `makeHome`),
since `deep setup` itself is #18's and #19's and would also write Claude Code's settings, which the test doesn't
need (it runs deep-hook as Claude Code's hook entry runs it):

- `<home>/.deepbuild/rules.json`: `crates/deep-hook/default-rules.json` copied in, as setup's `installRules` and
  #304's and #316's suites do;
- `<home>/.deepbuild/config.json`: your ask settings as setup drafts them (#319's `asks` block: authority `1d`,
  default `no`, fallback `change-owner`, fold 5, no batches, so an ask shows at once);
- `DEEP_HUB_TEST_CONFIRM` naming a file that says `confirmed`, the base's stand-in for the OS confirming you (#24),
  so your answer on the CLI's trusted path counts;
- the repo `shop`: a worktree on `main` with one commit, its origin a bare repository, a README with a typo and an
  `npm test` that passes.

## The contract

One Claude Code session, its hooks run through `deep-hook claude-code <Event>` with Claude Code's payloads and
environment and a transcript where Claude Code keeps it; the record and the inbox read through the hub's socket as
the `cli` role (`events.read`, `inbox.read`); your answer sent there as `ask.answer`.

1. You ask for a fix. The agent's Edit and `git commit` run (each PreToolUse lets it through), and the turn's Stop
   ends on "I fixed the typo and committed it. Want me to push to main?".
2. **The proceed.** The Stop's reply keeps the agent working: deep-hook exits 0 with `{"decision": "block",
   "reason": …}` whose reason says proceed (design: "A Stop hold returns `decision: block` with the answer"; "A
   'proceed' also rides in the stop's one reply"). The record gains a `question.proceeded` in the session whose
   `data.question` holds "want me to push to main?" (any case) and whose `data.rule` is the planted sorter's rule.
3. **Held at PreToolUse.** With no prompt between (the turn the proceed started), the agent's PreToolUse for Bash
   `git push origin main` doesn't let the call through, and the record gains an `ask.created` of kind `authority`
   in the session whose data, or the `plan.proposed` for it, holds the text `git push origin main`. The test
   doesn't require deep-hook to keep waiting or to deny at once: either is "held", as long as the call doesn't run.
4. **Waits for your answer.** 3 s later the push still hasn't been let through, origin's `main` is unchanged,
   `inbox.read` lists the ask with `status` not `closed` and `outcome` `unanswered`, and no event closes it.
5. **Your yes.** `ask.answer` over a `cli` connection with the control token: `{ask, option: <the ask's option
   whose decision is allow>, token: "click-321", plan_hash: <the plan.proposed hash, when the ask has a plan>}`.
   It must reply with a `result`.
6. **The hold.** Right after, a second PreToolUse for the same push (a try) must be refused, and no push may be
   let through, nor reach origin, before 10 s after the moment the test sent its yes.
7. **The push runs once the hold ends.** Either the held PreToolUse of step 3 is let through then (at or after
   those 10 s), or, if it was refused, a try started a second after the hold ends is let through. The agent's tool
   then runs `git push origin main`, and origin's `main` is the fix.
8. **The tests.** The next Stop ends on "Pushed main to origin. Want me to run the tests?": the same reply and a
   second `question.proceeded` with the same rule. The PreToolUse for Bash `npm test` lets it through, the tool runs
   it (it passes), and 2 s later the session has no `ask.created` since that proceed.

"Let through" is what Claude Code does with the hook's output: a call doesn't run when deep-hook exits 2, or prints
a `permissionDecision` of `deny` or `ask`, or `decision: block`, or `continue: false`; any other output, an exit 1
included, lets it run (`helpers.ts`, `letThrough`).

**The wrong program** (`wrong.test.ts`): the same scenario against `DEEP_HUB_PLANT=proceed-covers-turn` must fail,
and its failure message must contain `` `git push origin main` was let through at PreToolUse ``, the message the
scenario gives when the push gets through in the proceed's turn. The hub's own start failure never names the call,
so a plant the hub doesn't know can't pass this test.

## What the implementer adds (test-only settings)

- **`DEEP_HUB_TEST_SORTER=<rule name>`**, in the environment of `deep hub run`, read like the hub's other
  `DEEP_HUB_TEST_*` settings and set only by tests: when it is set, the hub sorts every question an agent ends its
  turn with as one to proceed on ("proceed", the planted sorter), whatever the question says, and records each such
  proceed as `question.proceeded` with `data.question` the question and `data.rule` the value of this setting. The
  test sets it to `planted-proceed-every-question`. Why a setting of its own rather than a plant: the wrong-program
  test needs the planted sorter and a planted core together, and `DEEP_HUB_PLANT` names one program. Why every
  question: the criterion's sorter answers "proceed" to both questions, and the point is that the core holds the
  push whatever the sorter said.
- **`proceed-covers-turn`**, a name in `packages/hub/src/plant.ts`'s `Plant` type and `PLANTS` list, selected with
  `DEEP_HUB_PLANT`: the core lets every call in the turn a "proceed" started through without the authority check, as
  if the proceed covered them.

## Choices the inputs don't fix

- **The question's source.** The question at the stop is the Stop payload's `last_assistant_message` and the
  transcript's last assistant text, both "… Want me to push to main?".
- **The recorded proceed.** Event kind `question.proceeded` (the design's name), in the session, with fields
  `question` and `rule`; the design says "recorded with the question and the rule that sorted it" but names no
  fields. The question is matched case-insensitively as a substring, so the hub may keep the whole last message.
- **How the proceed reaches the agent.** The Stop reply's `decision: block` with a reason containing "proceed".
- **"The turn it starts"** is the calls after that Stop with no UserPromptSubmit between.
- **"Held at PreToolUse"**: the call doesn't run until the hold ends; whether deep-hook waits on an acknowledged hold
  or the hub refuses each try with the ask named is the implementer's. "Waits for your answer" is checked for 3 s
  (not a number the inputs fix; long enough to see the ask stays open, short against the 60 s hook limit).
- **"Naming the push"**: the command text `git push origin main` in the `ask.created` data or its `plan.proposed`.
- **Your yes.** The design's trusted paths are the card (a paired device's signature, which the base's tests can't
  make) and `deep inbox answer` (which at the base sends only `{ask, option}`, while the asks core binds an approval
  to the plan's digest and a click token). So the test sends `ask.answer` on the socket as the `cli` role, the method
  `deep inbox answer` calls, with the OS confirmation stubbed `confirmed`, the allow option, the plan's digest when
  there is a plan, and the click token `click-321`.
- **The hold's length** is #1101's and the design's 10 s, measured from when the test sends the yes, on the wall
  clock (#1101's own tests use a virtual clock; the hub's `DEEP_HUB_TEST_CLOCK` sets only its start). Nothing is
  asserted tighter than "not before 10 s": the push may run any time after, within the hook's own limit.
- **"A try during the hold"** is a new PreToolUse for the same command right after the yes; if the machine is so
  loaded that it starts after the hold ended, the test fails BLOCKED rather than judge it.
- **"Runs with no ask"** for `npm test`: let through, and no `ask.created` in the session in the 2 s after it ran.
- **What runs the calls.** The test stands in for Claude Code's tools: it edits the README, commits, pushes and runs
  `npm test` itself, each only once deep-hook let the call through, and reports each with PostToolUse.

## Files

- `helpers.ts`: temp homes and the test world, processes stopped by PID, the hub as a process, the socket, the
  made-up session, the `shop` repo and its origin, `letThrough`, `failureOf`.
- `scenario.ts`: the criterion's scenario, shared by both tests.
- `proceed.test.ts`: the scenario against the hub as it is.
- `wrong.test.ts`: the scenario against `DEEP_HUB_PLANT=proceed-covers-turn`.
- `tsconfig.json`: type-checks the suite under the root's strict options with `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run at the base.
