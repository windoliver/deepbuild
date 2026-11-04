# Acceptance tests for #325: done gate release checks and budgets

Release checks once per head, switches left off, one budget per issue, and stalled claims.

Written first, blind, by a job that never saw an implementation of #325. Sources:

- **The issue**: its text as of 2026-11-03T21:09:12Z (`updatedAt`): Scope, the 9 checkbox criteria, Proof and Depends on
  (#322, #86, #319, all closed and on the base).
- **The design**, `docs/technical-design.md`:
  - [What done means, fixed at the start]: One budget (priced when the definition locks, asked once for the whole
    issue, runs inside it need no further approval), At the claim (Closes only when every requirement passed, else Part
    of), Done means switched on (release checks on the commit merged with main, once per head, in the slow lane; a
    change behind a switch that's off where it's deployed can't say Closes until you decide it stays off).
  - [How runs become one of five verdicts]: the precedence, Open items as records, Pinned to a commit.
  - [An agent says it's done]: Every stop is judged, Slow runs start when the turn ends, The verdict in the chat
    ("sent back 1/3"), A question holds the send-back, Open items ("still open" sections), Stalled claims (the two-stops
    rule, three send-backs without new evidence, new evidence defined, stops while a question holds the send-back count
    toward neither, the one decision: split, fund or accept).
  - [An ask, and your answer getting back]: Tasks only you can do (an unblock names its check; "I did it" re-runs it),
    the four delivery outcomes.
  - The Budget primitive (`spend.approved` and the rest of the ledger's events, #86) and the Lease primitive (`cpu.slot`).
  - [How we know version 0 works]: the seeded cases "A question holds the send-back" and "Send-backs and whose checks
    count" ("after three send-backs without new evidence the claim comes to you once instead"); Dogfooding.
- **The base commit**: `83e4159c` (origin/main). The base code read: `packages/hub/src/` (`core.ts`: the stop's hold,
  `laneOf`, `closesGate`, `askFor` (deep_ask), `deliver` and `shown`, `change` (`changes.read`), `inbox`; `server.ts`:
  the `DEEP_HUB_TEST_*` settings; `plant.ts`; `forge.ts`: `isPrCreate`, `closesIssue`, `prUrlIn`; `ask-tasks.ts`:
  `asksForChange`; `verdict-chat.ts`), `packages/gate/src/` (`index.ts`, `claim.ts`: `claimVerdict`),
  `packages/budget/src/index.ts` (`openLedger`, the `spend.*` events), `packages/checks-command/src/index.ts` (how a run
  counts its tests and traces its programs), the schemas `spend.approved@2`, `claim.sent_back@1`, `claim.stalled@1`,
  `decision.created@1`, `run.started@3`.
- **Sibling suites, for their conventions**: tests/acceptance/322 (this suite's template: the world, the hub as a
  process, sessions through deep-hook, the work source, Closes or Part of), 303, 86, 319, 26 (a session's own `deep mcp`
  and deep_ask) and 906 (what Claude Code writes into the transcript from a hook's reply).

The implementing agent does not edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 (`.node-version`) first on `PATH` and the Rust toolchain:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub and the deep CLI the tests start
cargo build --locked -q -p deep-hook     # target/debug/deep-hook, which every hook runs
npx vitest run --root tests/acceptance/325 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/325/tsconfig.json
```

- Node 24.22 must be the one on `PATH` when the suite starts: the hub inherits it, and the command check kind links
  the hub's `node` into each run. On this Mac, Homebrew's Node 23 loads libuv from `/opt/homebrew/Cellar`, which the
  run's sandbox refuses, so every run reads `uncounted`.
- The hub tests start hubs of their own, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list (`alone`),
  beside #322's. The implementer adds it. `timing.test.ts` is a fast test and may run anywhere.
- Every test makes its folders under `/tmp/dh325-*` (a Unix socket path must fit in 104 bytes on macOS), sets `HOME`
  to `<tmp>/h` for every process it starts, and never touches the real `~/.deepbuild`, `~/.claude` or `~/.codex`.
- It stops only processes it started, by PID (`helpers.ts`, `cleanup`), never by name or port.
- No network, no model, no `claude` binary, no `gh` call: the agent's `gh pr create` is allowed or refused at
  PreToolUse, and when allowed the test writes gh's answer (the PR's link) as the call's result; nothing is fetched. A
  child never inherits this process's billing keys, forge tokens or its `DEEP_*`, `GIT_*`, `XDG_*` or `CLAUDE*`
  settings.
- Every hub runs with `DEEP_HUB_TEST_STOP_HOLD_MS=30000`. A stop that is sent back returns when its fast-lane checks
  end, in seconds. On the base the whole suite took 4.5 minutes; on a correct hub each hub test is one to three
  minutes, about 15 in all.

## The surface under test

The tests reach DeepBuild only through these:

- **deep-hook** (`target/debug/deep-hook`), run as Claude Code runs our hook entry, as #322's suite runs it, each
  session's hooks children of the session's own process (`fixtures/agent.mjs`). A Stop's reply is read from
  deep-hook's stdout (`decision: block` and its `reason`, and `systemMessage`) or, at exit 2, its stderr. What Claude
  Code then writes into the transcript is written too, as #906's suite records it: a hook's `additionalContext` as a
  `hook_additional_context` attachment, a Stop's block as the user entry `Stop hook feedback:\n<reason>`.
- **The session's own `deep mcp`** (AC9), a child of the same process, initialized as an MCP client does, and its
  `deep_ask` tool, as #26's suite calls it. The PreToolUse `mcp__deep__deep_ask` is fired before the call and
  PostToolUse after it returns (it says it is still waiting after its 40 s).
- **`deep hub run`** with the base's `DEEP_HUB_PLANT`, `DEEP_HUB_TEST_CONFIRM`, `DEEP_HUB_TEST_STOP_HOLD_MS`,
  `DEEP_HUB_TEST_DRAFTS` and `DEEP_HUB_TEST_WORK`, and one new one, `DEEP_HUB_TEST_PRICES` (below).
- **The socket**, as the cli role with the control token: `events.read`, `inbox.read` (what `deep inbox` lists) and
  `changes.read` (the claim's receipt, #83).
- **`deep inbox answer <ask> <option>`**: your answer on the trusted path, the OS confirmation stubbed `confirmed`.
- **The gate's public entry**, `packages/gate/src/index.ts`: `claimVerdict` (the base's) and `priceDefinition` (new).
- Claude Code's workspace trust in `~/.claude.json` (`hasTrustDialogAccepted`), so the repo's spec checks run (#322 AC1).

### The world

`<tmp>/repo`, a git repository with one commit on `main`, the folder every session works in: `src/auth.js`
(`checkToken`, `rejectsExpired`, `logsRejected`, `allowsLegacy` and a `note` line each round's edit bumps), `src/net.js`
(`retries: 0`), `tests/unit.test.js` (the spec's `unit`, failing until FIX), `.deepbuild/done.yaml` and the drafted
checks. A drafted check is `.deepbuild/checks/<name>.sh`, a `#!/bin/sh` file running `node --test` on its node:test
file `.deepbuild/checks/<name>.test.cjs`, whose assertion is that file's line 4 (the requirement's `asserts`): a bare
script counts no tests, so a passing one reads ran nothing. `expired-token` passes after FLAG; `retry` and `audit`
fail on every commit of these tests; `live-quote`, `hosted-checkout` and `model-review` pass on every commit.

Sessions start from a test work source item as #322's do, `Fix https://work.test/acme/shop/issues/<n>`, its handed
definition one requirement per criterion (R1, R2, …). A later prompt in question form ("Can you open the pull
request now?", "Is the retry check still failing?") opens no task, so a turn after an allowed stop goes on under the
same task. A PR is the agent's `gh pr create --base main --title … --body "Closes #n"` (or `"Part of #n"`), as in
#322's AC2; allowed, its result is `https://github.com/acme/shop/pull/12`.

### New: paid checks and their prices (AC1, AC2, AC7)

- **A paid check** is marked on its handed requirement: `paid: "live call" | "hosted browser run" | "model job"`
  (DEEP_HUB_TEST_DRAFTS), the kinds of spend the issue names. A requirement with none costs nothing. The lock keeps it.
- **`DEEP_HUB_TEST_PRICES`** names a JSON file, which only tests set: `{ "prices": { "<check>": <usd> }, "costs": {
  "<check>": <usd> } }`, keyed by the check as the definition names it (`.deepbuild/checks/live-quote.sh`). `prices` is
  the hub's price lookup for a paid check, at the definition's lock and before each paid run reserves; a check with no
  entry has a price nobody knows. `costs` is each paid run's cost reading, which lands as the run ends and is charged
  to the ledger (#86's `charge`); a check with no cost entry lands at its price. The file is read at each lookup.
- **The budget ask**: when the definition of an issue with paid checks locks, one ask, whose data names the total
  price as `$12.00` (its question, its plan or its options), with an option whose id or label says allow, approve,
  yes or fund. Your yes through `deep inbox answer` is one `spend.approved` (the base's event): `scope: { kind:
  "issue", ref }`, `ref` the item's source_id (`item-31`), its link or the task, and `cap_usd` at least the total.
- **The receipt** is `changes.read { id: "claim:<id>" }`'s `change`: a paid check's spend shows either on its entry in
  `change.checks` (a field whose name says spend, usd, cost or charged, equal to the cost reading) or in the receipt's
  text, `change.second` or `change.line`, as one piece (between ` · `, `, ` or a line break) naming the check's file and
  the dollars, such as `live-quote.sh passed $3.50`.
- **Pricing a definition** (AC7), on the gate's public entry:

```ts
// packages/gate/src/index.ts
export type PaidKind = 'live call' | 'hosted browser run' | 'model job';
/** The paid checks of a definition, each with its price, in the definition's order; total_usd is null while any price is unknown. */
export interface Pricing { total_usd: number | null; checks: { req: string; check: string; paid: PaidKind; usd: number | null }[] }
export function priceDefinition(
  requirements: readonly { id: string; check: string | null; paid?: PaidKind }[],
  price: (check: { check: string; paid: PaidKind }) => Promise<number | null>,
): Promise<Pricing>;
```

  It looks up only paid checks. The test reads it through a namespace import, so the suite typechecks on the base.

### New: release checks (AC5)

- **`.deepbuild/done.yaml`** names them: `release: { checks: [preflight] }`, each a check under `checks:`; here
  `preflight: { type: command, run: "node --test tests/release.test.js", min_tests: 1 }`, the repo's local preflight.
- A claim on a PR (the agent's allowed `gh pr create`) runs them on the PR's head merged with `main`, the repo's local
  branch (no remote; nothing is fetched). The PR's head is the session's HEAD at the claim, on branch `fix`. Their
  `run.started` names the merge commit as `commit`, which is neither the head nor main's tip.
- While a release check is still to run or running, `gh pr create … "Closes #n"` is refused, the reason naming Part of
  and the release check (`preflight`, or the word release).
- The world: branch `fix` is cut from the base while `main` has moved on with `src/limits.js` (`strict: true`). The
  preflight's test fails only where the code base is strict and `allowsLegacy` is true: on `fix` merged with main,
  never on `fix` alone or on main alone.

### New: switches (AC6)

- **`.deepbuild/done.yaml`** names them: `switches: { file: config/flags.json, deployed: config/deployed.json }`.
  `file` is a JSON object whose keys are the switches, flags and schedules the code reads; `deployed` is the deployed
  configuration, a JSON object of each one's value where it runs. A change ships behind a switch when its diff adds a
  key to `file`; the switch is off when its deployed value is `false`, unset when the deployed object lacks it.
- A PR saying Closes is refused while such a switch is off or unset, the reason naming Part of and each such switch
  by name, never one that's on. You're asked about each (one ask per switch, or one naming them all), with an option
  whose id or label says it stays off (`stay` or `off`). Once you answered that for every one, the PR may say Closes.
- **The decision is saved with its follow-up**: the `decision.created` whose `data.ask` is the ask, and the follow-up
  either in that decision's data (a field whose name says follow, naming the switch) or in an event after your answer
  whose kind or a field of whose data says follow, naming `decision:<id>` and the switch.

### New: stalled claims (AC3, AC4, AC8, AC9)

- **Open items** are the claim's: each non-PASS check result, and each line under the stop's "Still open:" heading
  (design: Open items). AC3's stops all report the same list; AC8's report another each time, so only the three
  send-backs apply there.
- **The round** of a send-back is in its reply, as the verdict line has it: `sent back 1/3` (or `round 1 of 3`).
- **The decision** for a stalled claim is an `ask.created` whose options, by id or label, split the issue, fund the
  live runs and accept what's proven (`split`, `fund`, `accept` in an id or label). It shows in `inbox.read`. One per
  stalled claim.
- **A split** is your answer with the option that says split. It leaves the issue closable: `gh pr create … "Closes
  #n"` is then allowed. **The drafted issue** is an event after your answer whose kind says issue, or draft but isn't a
  `definition.*` (`issue.drafted`, say), whose data names each remaining requirement (R2 and R3, by ID or text) and
  what it needs: its check, by file name (`retry.sh`, `audit.sh`).
- **The step only you can take** (AC9) is an unblock task the agent raises with `deep_ask` (`kind: "unblock"`, its
  steps, where and why, `check: "unit"`), the base's tool. "I did it" (`done`) re-runs `unit`, which passes.
- **Delivered** is the base's `delivery.outcome` with `outcome: "delivered"` for that ask. Your answer reaches the
  session at its next prompt (`Did the sign-in go through?`), and the hub records it delivered once it reads it in the
  transcript, at a later hook; the first stop whose reply finds it recorded is "the next stop" AC9 names.

## Wrong programs

Each is code the implementer writes, selected with `DEEP_HUB_PLANT=<name>` on `deep hub run`. A plant the base
doesn't list stops the hub from starting (`plantOf` throws), so its test fails BLOCKED, never passes. Each
wrong-program test runs its criterion's scenario on the planted hub and requires it to fail with the message the
criterion names; `failureOf` rethrows BLOCKED and INCONCLUSIVE, so neither counts as the plant's failure.

| Name | Criterion | What the plant does | How the test fails on it |
|---|---|---|---|
| `new-run-is-evidence` | AC8 | the stalled-claim rule counts any new run of a check as new evidence, whatever its result | the same failing check runs again before each stop, so the count of send-backs without new evidence never reaches three: the fourth stop is sent back; the failure says "the fourth stop must not be sent back" |
| `counts-waiting-stops` | AC9 | the stops made while a question holds the send-back count toward the stalled-claim limits (they are still not sent back) | the two waiting stops have the same open items, so the decision is raised while the ask is open; the failure says "no decision is raised while ask:… is still open" |

AC7's harness is shown failing on a judge planted in the test itself, one that takes 60 ms (`timing.test.ts`). The
issue names no wrong program for AC1 to AC6; the base is theirs (`BASE-FAILURE.txt`).

## Criteria to tests

Each `describe` and test name starts with its criterion's number and ID, `#325.<first 8 hex of SHA-256 of the
criterion's text>`, trimmed, whitespace collapsed, as `scripts/proof-change.mjs` computes it. Every failure message
starts with them too.

| ID | Criterion (short) | Test file | What the test does |
|---|---|---|---|
| AC1 `#325.48d4efcc` | three paid checks ask once at the lock with the total; one ledger entry | `budget.test.ts` (1) | item 31, three paid checks priced $4, $3, $5: one ask naming $12.00 before any stop; your yes is one `spend.approved` for the issue, cap at least $12; the stop's three paid runs raise no ask and add no entry |
| AC2 `#325.9d341426` | the receipt lists the spend per check | `budget.test.ts` (1) | item 32, the same, the runs landing at $3.50, $2.25 and $4.75: the claim's `changes.read` shows each check with its spend |
| AC3 `#325.ae91cc84` | the same open items on two stops in a row: no third send-back, one decision in the inbox | `stalled.test.ts` (1) | item 21, R2 and R3 failing, every stop reporting both as still open: stop 1 sent back; stop 2, or else stop 3, not sent back; one split/fund/accept ask, in `inbox.read` |
| AC4 `#325.84b92502` | a split leaves the issue closable with evidence and drafts a new issue | `stalled.test.ts` (1) | item 22, AC3's scenario; Closes #22 refused (control); you answer split; the drafted issue names R2 with retry.sh and R3 with audit.sh; Closes #22 allowed; R1's check passed on the task's claims |
| AC5 `#325.3ce2ada4` | release checks on the PR's merge with main; FAIL there; Part of while one runs | `release.test.ts` (1) | item 9 on branch `fix`, main ahead: green stop; commit; Closes #9 refused naming Part of and preflight; Part of allowed; stop; preflight's run fails on a commit that is neither the head nor main; the claim's verdict FAIL names preflight |
| AC6 `#325.e4aeb66b` | a change behind a switch off or unset where deployed can't say Closes until you decide; the decision has its follow-up | `switch.test.ts` (1) | item 11, the change adds reject_expired (off), audit_log (unset), fast_path (on): Closes #11 refused naming Part of and the two, never fast_path; asks name both, none fast_path; you answer stays off; Closes #11 allowed; each decision saved with a follow-up naming its switch |
| AC7 `#325.ea463eff` | judging 20 requirements under 50 ms, pricing under 100 ms | `timing.test.ts` (3) | `claimVerdict` on 20 requirements and 60 runs: FAIL naming R7 and R15, median of 9 under 50 ms; `priceDefinition` on 20 requirements, 16 paid: the paid checks priced in order and summed, only they looked up, median under 100 ms; a 60 ms judge fails the harness |
| AC8 `#325.7685f017` | the same failing check rerun with the same result: three send-backs, then one decision; the new-run rule fails | `rerun.test.ts` (2) | item 23, R2 failing, the agent rerunning its check and working a round before each stop, each stop reporting other open items: stops 1 to 3 sent back, 4 not, one decision after the third, in the inbox; the wrong program `new-run-is-evidence` |
| AC9 `#325.68bf903d` | waiting stops count toward neither limit; next stop after the answer is 1/3; the counting rule fails | `waiting.test.ts` (2) | item 25: deep_ask raises an unblock task; two stops with R2 failing and the same open items aren't sent back and raise no decision while it's open; you answer done; the first stop after it's delivered is sent back 1/3; the one decision comes after that stop; the wrong program `counts-waiting-stops` |

## What this suite could not encode

- **"Compared with the merge base"** (AC7): the merge base's code can't be judged here without building it, so the
  test asserts the budgets on this machine and states its reading (median, the runs, the load) in its message; the
  delta against the merge base is the local preflight's timing lane. "On the reference Mac" is wherever the suite
  runs. A reading over its budget while the machine is loaded past its cores is taken once more and then INCONCLUSIVE.
- **Pricing at the lock** is read as the ask naming the total before any stop, not as a priced record of its own.
- **"Once per head", the slow lane, the `cpu.slot` lease and the reused verdict** (Scope, no criterion): not asserted.
  Nor is "any headless job starts through the runner".
- **"Fund the live runs it needs"** and **"accept what's proven"**: only that the decision offers them; only split's
  effect is a criterion (AC4).
- **"With evidence for what passed"** (AC4) is read as a passing run of R1's check on the task's claims while the
  issue becomes closable; what the closing PR's body cites isn't read, since no PR body reaches a forge.
- **The budget's runs and end date, and the environment's budget rules**: the ask is read only for its total price.
- **AC3's two readings**: whether the stall shows at the second stop with the same items or at the third, the test
  takes either, and requires the third send-back never to happen.

## Files

- `helpers.ts`: temp worlds (a home, the repo with its spec, unit test and drafted checks, the drafts, the work source
  and the prices), the hub as a process, `events.read`, `inbox.read`, `changes.read`, sessions with their transcripts,
  hooks, tool calls, stops and deep_ask, deep-hook's decisions (`decision`, `replyText`, `sentBack`), the record
  readers, `deep inbox answer`, and `verdict`, `failureOf`, `Inconclusive`.
- `scenarios.ts`: each criterion's world and flow, run by its test and, for AC8 and AC9, by its wrong-program test.
- `fixtures/agent.mjs`: each session's Claude Code stand-in, the parent of that session's deep-hook runs and its `deep mcp`.
- `budget.test.ts` (AC1, AC2), `stalled.test.ts` (AC3, AC4), `release.test.ts` (AC5), `switch.test.ts` (AC6),
  `timing.test.ts` (AC7), `rerun.test.ts` (AC8), `waiting.test.ts` (AC9).
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit, trimmed to each test's failing assertion.

[What done means, fixed at the start]: ../../../docs/technical-design.md
[How runs become one of five verdicts]: ../../../docs/technical-design.md
[An agent says it's done]: ../../../docs/technical-design.md
[An ask, and your answer getting back]: ../../../docs/technical-design.md
[How we know version 0 works]: ../../../docs/technical-design.md
