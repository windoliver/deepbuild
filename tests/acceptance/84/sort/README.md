# Acceptance tests for #84, sorting questions: the sort share

Written first, blind, by a job that never saw an implementation of #84 (there is none on the base). A sibling job
writes the issue's other criteria. Sources:

- **The issue**: its text as of 2026-11-05T23:06:22Z (`updatedAt`): Scope and the 11 criteria below.
- **The design**, `docs/technical-design.md`: [An agent says it's done] (Questions at the stop, A question holds the
  send-back, Open items, Stalled claims, Fast and slow lanes, Slow runs start when the turn ends, The verdict in the
  chat), [An ask, and your answer getting back] (Asks stay current, Tasks only you can do, Could the agent do it?, Work
  goes on while you decide), The done loop, Ask, and the Question card in `docs/canvas-primitives.md`.
- **The base commit**: `d722ba3d` (origin/main). The base code read, to learn how to drive it: `packages/hub/src/`
  (`holds.ts`, `core.ts`'s Stop reply, `questionHolds`, `slowStop`, `inbox.ts`, `tools.ts`'s deep_ask, `plant.ts`),
  `packages/asks/src/index.ts` (the `held` view, typed text), and the schemas `question.proceeded@1`, `ask.answered@5`,
  `claim.sent_back@1`.
- **Sibling suites, for their conventions**: tests/acceptance/82 (this suite's template), 325 (deep_ask, the waiting
  stops), 323 (the license task, `ready`), 303 (the queue), 39 (Codex's setup and timeouts), 1097 (guard files).

The implementing agent does not edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 (`.node-version`) first on `PATH` and the Rust toolchain:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub and the deep CLI the tests start
cargo build --locked -q -p deep-hook     # target/debug/deep-hook, which every hook runs
npx vitest run --root tests/acceptance/84/sort --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/84/sort/tsconfig.json
```

- Every test starts hubs of its own, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list (`alone`). The
  implementer adds it.
- Every test makes its folders under `/tmp/dh84s-*` (a Unix socket path must fit in 104 bytes on macOS), sets `HOME` to
  `<tmp>/h` for every process it starts, and never touches the real `~/.deepbuild`, `~/.claude` or `~/.codex`.
- It stops only processes it started, by PID (`helpers.ts`, `cleanup`), never by name or port.
- No network, no model, no `gh` call. `<tmp>/bin`, first on every child's `PATH`, holds logging stubs of `claude`,
  `codex`, `launchctl` and `systemctl`. A child never inherits this process's billing keys, forge tokens or its
  `DEEP_*`, `GIT_*`, `XDG_*`, `CLAUDE*` or `CODEX*` settings.
- Hubs run with `DEEP_HUB_TEST_STOP_HOLD_MS=30000`, except `budgets.test.ts` (the shipped 60 s hold).

## The surface under test

- **deep-hook** (`target/debug/deep-hook`), run as Claude Code and Codex run our hook entries, each session's hooks
  children of the session's own process (`fixtures/agent.mjs`). A Stop's reply is read from deep-hook's stdout
  (`decision: block`, its `reason`, and `systemMessage`, the verdict line) or, at exit 2, its stderr.
- **The session's own `deep mcp`**, a child of the same process, for `deep_ask`.
- **`deep hub run`** with the base's `DEEP_HUB_PLANT`, `DEEP_HUB_TEST_CONFIRM`, `DEEP_HUB_TEST_STOP_HOLD_MS`,
  `DEEP_HUB_TEST_DRAFTS` and `DEEP_HUB_TEST_WORK`. `DEEP_HUB_TEST_SORTER`, the planted stand-in #84 replaces, is not set.
- **The socket**, as the cli role: `events.read` and `inbox.read` (the RPC behind `deep inbox` and Needs you).
- **`deep inbox answer`**, `deep guard add` and `deep setup`, run outside every session's process tree, as your terminal
  is, the OS confirmation stubbed with `DEEP_HUB_TEST_CONFIRM`.

### The world

A home and a git repository with one commit on main: `src/auth.js`, `src/net.js`, `src/cart.js`, `src/receipt.js` (a
cent short of `$18.01`), the spec `.deepbuild/done.yaml` (`unit` in the `done` claim; `ready`, outside it, the check a
license task names, which passes once `vendor/license-accepted` exists, as #323's does), and drafted checks: `expired-token`
(fails until FLAG), `retry` (always fails), `receipt` (always fails) and `checkout-journey` (passes after a real 8 s;
handed with `expected_ms` and `deadline_ms` of 10 minutes). The test work source holds one item per scenario; a session
opens its task by typing `Fix <link>`. A world whose agent calls `deep_ask` runs `deep setup` beside its hub (`setUp`), then
puts your ask settings back, since setup drafts a batch every 8 hours. `~/.claude/settings.json` sets `MCP_TOOL_TIMEOUT` to
5 s and Codex's config sets `tool_timeout_sec = 8`, the base's documented way to make `deep_ask` return at once with its ask,
so no test sits out a 40 s wait. Setup also gives Codex's Stop entry its 45-minute timeout.

### How the criteria are read

- **"Answered 'proceed'"**: the Stop's reply blocks and its text holds the word `proceed` (case aside), and the record
  holds a `question.proceeded` on the session. **"Never answered 'proceed'"**: neither.
- **"Reaches you"**, **"Needs you"**: a row of `inbox.read` that isn't `closed` or `held` whose JSON holds the question's
  words, or for AC1, AC23 and AC25 also an `ask.created` naming them. `held` is the design's view of an open ask waiting
  for a message the agent hasn't read, so a held row doesn't count as reaching you.
- **A stop that ends on a step only you can take, or on a choice** (AC4, AC5, AC26, AC27): the agent raises it with
  `deep_ask` in that turn and then ends on it in its words. The sort comes from structure, and the design says an agent
  raises a task with `deep_ask`; a stop with words alone is AC25's case, which goes back once. A stop that names a step
  in the turn's own evidence with no `deep_ask` is not driven here.
- **"Your rules reserve commits"** (AC8): a `guard@1` entry you added with `deep guard add`, block mode, `run:git
  commit`, with its planted call and twin. It is the one way the base has to write such a rule.
- **"The agent reads the message"** (AC4): the message is queued (`queue-operation` enqueue) while a Read runs, with no
  hook; it is read when Claude Code takes it as the next prompt (dequeue, entry, UserPromptSubmit). **"Drops the
  question"**: the agent's next stop ends without it and it raises nothing. **"Still stands"**, the control: it calls
  `deep_ask` with the same arguments and ends on the question again.
- **"Your words beside it on the card"** (AC5): the ask's row in `inbox.read` holds them (Surfaces, below).
- **"Carrying the verdict line"** (AC26): the hook reply that holds the answer's `ask:<id>` also holds the word `FAIL`.
  **"Once your answer is delivered"**: `delivery.outcome` `delivered` for the ask, read as in #325. Prompts between stops
  are scheduled, since words typed in the session would close the task.
- **"Isn't held for the journey"** (AC26, Codex): the reply comes before any run of the journey has finished. Item 72 is
  the stop as the criterion words it, unit check failing; item 73 has every fast check green, where the design's slow hold
  would apply and the question must stop it.
- **"The PR call held until you answer"** (AC27): `gh pr create` is denied at PreToolUse in the turn after the stop, an
  authority ask for it is in `inbox.read`, and after your yes on every authority ask the stop raised the same call runs.
- **"Its smallest failing case"** (AC28): the `smallest` the `verdict.made` recorded holds `$18.00`, what the check found,
  and the reply does too, as the design's line does ("receipt shows $18.00"). The requirement's own words hold only
  `$18.01`, so a reply that names the requirement alone fails. The verdict line's cut of the cause is not enough.

## Surfaces the implementer must provide

Beyond what the design and the issue name:

- **Plants**, added to `packages/hub/src/plant.ts`:

| Plant (`DEEP_HUB_PLANT`) | Criterion | The wrong program | What the test requires |
|---|---|---|---|
| `proceed-unrecorded` | AC23 | a sorter that answers "proceed" and records no `question.proceeded` | the test fails on the missing record, naming the question |
| `keys-ask-from-words` | AC25 | a sorter that raises an ask keyed from the question's text | the test fails on that ask, naming `Should it be blue?` |
| `sends-back-held-stop` | AC26 | a gate that sends back a stop whose ask holds it | the test fails on the first stop, naming its `agent.stop` ID |
| `holds-every-ask` | AC27 | a gate that holds the send-back for every ask, authority and provisional included | the test fails on each stop, left idle, naming it |
| `proceed-alone` | AC28 | a hub whose proceed drops the send-back's failing requirements from the reply | the test fails naming `the receipt shows $18.01` |

  A plant the hub doesn't list stops `deep hub run`; the test then fails with `BLOCKED: plant <name> not listed …`.

- **The word `proceed`** appears in a reply only when the reply is a proceed. An authority or `deep_ask` reply avoids it.
- **`question.proceeded` on the session** for a still-open item too (AC17): `data.question` holds the item's text.
- **The follow-up on the verdict line** (AC17): `systemMessage` holds `follow-up` (or `followup`) and the item's words.
- **`ask.created`'s `provisional: true`** for a choice raised through `deep_ask` with a recommended option (AC27).
- **The verdict line names `FAIL`** at a stop whose ask holds its send-back (AC26). The base's says `sent back 1/3`.
- **`inbox.read`'s row for an authority ask carries your typed words** (AC5), in any field. The asks core has them on its
  card (`asks.card(...).words`); the base's row leaves them out.
- **The hub closes a typed answer as it lands** (AC5): within 15 s of the prompt. The asks core marks it, and on the base
  nothing appends it until its next deadline tick.

## Load

As in #82: a hook deep-hook couldn't hand to the hub within its budget, and a stop let through before its fast-lane
runs ended while the machine is loaded past its cores, are INCONCLUSIVE (a skip naming the 1-minute load), never a pass
or a fail (`helpers.ts`, `unreached` and `heldOut`). So is a budget reading over 20 ms under that load.

## Budgets

"On the reference Mac in the local preflight, compared with the merge base" can't be built in a blind suite, and the base
has no sorter to compare, so `budgets.test.ts` reads it on the hub as it stands. Five rounds of scheduled-task turns that
change nothing, ending on plain words, an in-scope question, an authority offer and a question with no key. Each case's
median Stop hook time less the plain stops' must be under 20 ms. "No model call": the stub `claude` and `codex` log no
call but `--version` and `login status`, and nothing reaches the listener the hub's `ANTHROPIC_BASE_URL` and
`OPENAI_BASE_URL` name. Each stop must also have been sorted (`proceed`, `deep_ask`, no `proceed`), since a hub that sorts
nothing adds nothing. A planted reading shows the harness fails.

## Criteria to tests

| Criterion | File (tests) | What it drives |
|---|---|---|
| AC1 `#84.78d86276` | `proceed.test.ts` (1) | item 11: "want me to run the tests?" gets `proceed`, no ask, nothing in Needs you |
| AC4 `#84.3ee2359f` | `queued.test.ts` (1) | items 51, 52: deep_ask with your message queued is held at deep_ask and at the stop; read and dropped, nothing reaches you; read and raised again, it does |
| AC5 `#84.3562ff8a` | `typed.test.ts` (1) | item 61: "use option B" records `ask.answered` via session, unverified; "go ahead and push" leaves the authority ask open, your words on its row |
| AC8 `#84.995fe88a` | `authority.test.ts` (1) | items 21-25: commit (reserved), push, open PR, merge, dispatch: no `proceed`, no record; item 26's control is proceeded |
| AC17 `#84.23d070cd` | `stillopen.test.ts` (1) | item 31: an unstarted R2 goes back with `proceed`, recorded; the billing item is a follow-up on the line, no ask |
| AC23 `#84.72bc83d6` | `proceed.test.ts` (2) | item 11: `question.proceeded` names the question and a rule, nothing in Needs you; plant `proceed-unrecorded` |
| AC24 `#84.7fe72382` | `budgets.test.ts` (2) | item 95: three cases each add under 20 ms, no model call; a planted reading |
| AC25 `#84.9e1e5720` | `nokey.test.ts` (2) | items 41, 42: "Should it be blue?" asks for deep_ask once, raises no ask; plant `keys-ask-from-words` |
| AC26 `#84.736028fe` | `held.test.ts` (3) | item 71: three held stops, your answer with the line, then sent back 1/3; items 72, 73: Codex not held for the journey; plant `sends-back-held-stop` |
| AC27 `#84.08696311` | `sendback.test.ts` (3) | item 81: PR offer sent back, the call held, your yes runs it; item 82: one reply with the recommended option and the send-back; plant `holds-every-ask` |
| AC28 `#84.ec2133c4` | `ride.test.ts` (2) | item 91: one reply with `proceed`, the requirement and its smallest case; plant `proceed-alone` |

## What this suite could not encode

- **"Compared with the merge base"** and **"the reference Mac"** (AC24): read on this machine and this hub, as above.
- **"In the common cases"** (AC24): the three cases are this suite's reading of them.
- **A stop's words alone becoming a step only you can take** (AC26): see How the criteria are read.
- **"Held no longer than its fast-lane checks"**, a Scope line: only "not held for the journey" is asserted.
- **Delivery by the waiter**: your answer here reaches an active session through its hooks; `deep-hook claude-code
  waiter` is not started.

## Files

- `helpers.ts`: worlds, the hub as a process, `events.read`, `inbox.read`, `deep`, Claude Code and Codex sessions with
  `deep_ask` and the queue, and `verdict`, `failureOf`, `Inconclusive`.
- `fixtures/agent.mjs`: each session's agent stand-in, the parent of that session's deep-hook runs and its `deep mcp`.
- `*.test.ts`: as the table above.
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit, trimmed to each test's failing assertion.

[An agent says it's done]: ../../../../docs/technical-design.md
[An ask, and your answer getting back]: ../../../../docs/technical-design.md
