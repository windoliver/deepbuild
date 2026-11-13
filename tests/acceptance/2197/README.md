# Acceptance tests for #2197: deep_status says where a session starts: the repo's checks, its open asks and its open items

Written first and blind, at base commit `d199a9f7`, from issue #2197, the design and the base, before any implementation.
The drafting job saw nothing of the work: no other checkout, branch, pull request diff or commit past the base. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). There is no taste criterion, so no `TASTE.json`.

## What was read

- **Issue #2197**, its live body read with `gh issue view` on 2026-11-12 at 18:50Z: the revision with `updatedAt`
  2026-11-12T18:26:29Z, no comments. The criterion IDs below are computed from that body.
- What it links: the epic #2, #26 (closed), #1105 (open, not built at the base), pull request #2196's description
  (merged before the base), and `reports/uiux-agentic-audit-2026-11-10.md`, finding 1.
- `docs/technical-design.md`: Building blocks (the table, and the sentence before it on the skill and the tool
  descriptions), the MCP tools row and the `deep mcp` lines of Socket roles, An agent says it's done, What done means
  fixed at the start, the Ask and Lifecycles primitives, States people see, Numbers version 0 has to hold (Every task
  carries its own budgets, The reference Macs), How we know version 0 works (Failing on an assertion, Criteria to
  tests, Criteria in a checked shape, Wrong programs, The edit guard, Dogfooding) and Built to be hard to get wrong.
- At the base: `deep_status`, `deep_ask`, `deep_wait`, `deep_open_item`, `deep_claim`, the binding and the spec
  readers in `packages/hub/src/core.ts`; `packages/hub/src/{plant,tools,session-facts}.ts`; `packages/hub/tools.json`;
  `scripts/skill.mjs`; `raise` and the deadline moves in `packages/asks/src/index.ts`; the `asks` and `open_items`
  tables in `packages/record/src/projections.ts`; `ask.machine@1`; `scripts/proof-change.mjs` (criterion IDs, test
  names), `scripts/proof-runs.mjs` and `scripts/proof.mjs` (the before and trace lanes, twins, "at its assertion"),
  `scripts/lanes.mjs` (`alone`, `timed`), `scripts/throttle.mjs`, `benchmarks/budgets.json` (`deep-mcp-30d`); and the
  suites `26` (helpers, tools, budgets, binding, ask), `1463`, `2201`, `823`, `992` and `1551` (its timing gate).

## How to run

Node 24.22 or newer and `git` on the `PATH`, `node_modules` installed (`npm ci --ignore-scripts`), and the workspaces
built: the tests run the built CLI (`packages/cli/dist/main.js`: `deep hub run`, `deep mcp`), and the root vitest
config loads `scripts/lanes.mjs`, which needs the built packages. From the checkout's root:

```sh
node scripts/throttle.mjs build --wait 60 -- scripts/lease npm run build --workspaces
node scripts/throttle.mjs test --wait 60 -- scripts/lease node node_modules/vitest/vitest.mjs run --no-file-parallelism tests/acceptance/2197/start.test.ts tests/acceptance/2197/others.test.ts tests/acceptance/2197/scope.test.ts
node scripts/throttle.mjs timed --wait 60 -- scripts/lease node node_modules/vitest/vitest.mjs run tests/acceptance/2197/budget.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/2197/tsconfig.json
```

On a machine nobody else uses, the two test commands are one:
`NO_COLOR=1 node node_modules/vitest/vitest.mjs run --no-file-parallelism tests/acceptance/2197`.

- **What it starts and stops.** Each test makes its own world under `/tmp/dh26-*` (#26's `tempDir`; a socket path
  must fit in 104 bytes): a home, one throwaway git repo, a real hub and one or two agent stand-ins, each with its
  own `deep mcp`. Every process runs with `HOME` there, so nothing touches the real `~/.deepbuild` or `~/.claude`.
  It stops only the processes it started, by PID (#26's `cleanup`), and removes its folders. No network, no model
  call, no git command on this checkout.
- **Time.** About 8 s for all four files in the base run (8.3 s, on a loaded machine), so that is what the three
  plain files take: `budget.test.ts` was skipped at once there. `budget.test.ts` seeds 30 days and makes
  240 calls where its timing counts, and builds nothing where it doesn't; its scratch readings (below) took 29 s.
- **The timed grant.** `budget.test.ts` reads the machine's load and judges a wall-clock budget, so it runs under a
  timed grant, which no other class shares. Off a quiet reference Mac it reports INCONCLUSIVE at once, having built
  nothing, so it holds the grant for a second there.
- **Cache.** With the root config, as above, vitest writes nothing under this folder. Run with
  `--root tests/acceptance/2197` it leaves `tests/acceptance/2197/node_modules/.vite/`; delete it before committing.

## The surface

The tests reach the code only through surfaces the issue and the design name, as #26's suite defines them
(`tests/acceptance/26/README.md`): **`deep mcp`**, spoken to as an MCP client speaks it by an agent stand-in whose hooks
and `deep mcp` are its children, so the hub binds that `deep mcp` to the stand-in's session; **`deep hub run`** and its
socket (`events.read` on a `cli` connection, to check that the world is the criterion's Given); the repo's spec,
**`.deepbuild/done.yaml`**; and, for the Scope only, the **Building blocks table** in `docs/technical-design.md`. The
record is seeded before the hub starts through the public entries of `@deepbuild/record` and `@deepbuild/asks`, as
#26's and #1463's suites seed it. No hub, CLI or `deep mcp` module is imported.

What the tests call, as the base serves it and #26's README has it: `deep_status` with `{}`; `deep_open_item` with
`{text}`; `deep_claim` with claim.made@1's data; `tools/list`. A tool's value is its result's `structuredContent`, or
else the JSON in its first text block.

**The fixture.** Every world's repo has one spec, naming the checks `unit` and `e2e` and no other, both in its `done`
claim's list and in its `checks` block (`helpers.ts`, `SPEC`). An open taste ask is raised for a session through the
asks core before the hub starts (`raiseTaste`): two options, `slate` ("Slate accent") and `amber` ("Amber accent"), no
recommendation, not provisional, its default `amber`, its deadline a whole minute 2 days 3 h 17 min on. The hub's log
is then read to hold the ask to that: open, a taste ask, filed under its session, with that default and the deadline
it has now (`recorded`); if not, the test is BLOCKED. An open item is recorded by the agent itself with
`deep_open_item`, and the log is read to hold it under the agent's session with that text. Two sessions are two
stand-in processes in one worktree of one repo, each established through its own hooks.

### Pinned here: the implementation must provide these

The issue fixes what `deep_status` says and leaves every field name and the reply's shape open. The tests name no
field: `helpers.ts` reads a reply for the facts, so an object, a list, a map or a sentence that states them passes.
Each line below is this job's invention, the least the tests need to tell a reply that states a fact from one that
doesn't.

1. **The reply is one JSON object**, the tool's value, as today.
2. **A check is listed** (criterion 1) when its name stands in the reply as a string of its own, as a key, or as a word
   of its own in a longer string (`notListed`). So `["unit", "e2e"]`, `[{"name": "unit"}, …]`, `{"unit": {…}, …}` and
   `"Checks: unit, e2e."` all list both; `unit-fast` doesn't list `unit`.
3. **An ask's entry** (criterion 2) is the part of the reply about the ask whose handle it holds (`entriesOf`): the
   item of the nearest list around the handle; with no list around it, the innermost object below the reply itself;
   for a handle that is a key, the key with its value; else the string that holds it. The handle is `ask:<ULID>`, as
   `deep_ask` returns it. The ask's state, default and deadline are read from one entry of it, so facts spread over two
   asks' entries don't count.
4. **Its state** is said by a word the base or the design already has for an ask that is open, not put off and not
   folded, standing as a word of its own in the entry, letter case aside (`OPEN_WORDS`): `open` (`ask.machine@1`'s
   state); `waiting` (what `deep_ask` and `deep_wait` answer for one); `unanswered`, `queued`, `held` or `shown` (the
   asks core's outcome and inbox statuses for one, which `deep inbox` reads); `needs you` or `needs_you` (the word and
   the status-map entry of States people see). A word for another state, such as `answered`, doesn't count, and
   neither does a list named for open asks whose entries say nothing of their state: the criterion asks for each
   ask's state.
5. **Its default** is said when the entry names the option the ask takes, by its ID (`amber`, as a word of its own) or
   by its label, more often than it names the other option. So `"default": "amber"` counts, with or without a list
   of both options beside it, and a list of both options alone doesn't.
6. **When it takes it** is the ask's deadline, said in the entry as ms or seconds since the Unix epoch (a number of 13
   or 10 digits, within a second) or as an ISO 8601 date and time, to the minute or finer, with a zone or, without
   one, in UTC or the machine's zone (`saysWhen`). A duration from now, or a clock time without its date, isn't read.
7. **An open item's text** (criterion 3) is held when some string of the reply holds the text whole.
8. **The plant `status-lists-every-ask`** (criterion 4; Wrong programs, below).
9. **The description and the table** (Scope, no criterion): the description `deep mcp` lists for `deep_status`, and
   the Building blocks rows whose "Agents, through MCP" cell names `deep_status` (their Block and that cell), each
   hold the three nouns `check`, `ask` and `open item`, singular or plural, letter case aside.

### Wrong programs

| Criterion | Wrong program | How the test fails on it |
|---|---|---|
| 1, 2, 3 | The merge base: the reply is `{session, gates, claims}` | Each at its own assertion, naming what the reply lacks |
| 4 | The plant `status-lists-every-ask` | The plant test reads session B's ask in session A's reply and names its handle |
| 5 | A `deep_status` slower than 100 ms at p95 in all five runs by more than the margin; none is planted | The design's timing rule; `budget.test.ts`'s second test feeds the rule such readings and expects FAIL |

**What the implementer adds for criterion 4:** the name `status-lists-every-ask` in `Plant` and in `PLANTS` in
`packages/hub/src/plant.ts`, selected by `DEEP_HUB_PLANT` as every plant there is. Under it `deep_status` lists every
session's open asks, the calling session's and every other's, each as it lists the caller's own (so with its handle),
wherever it lists the caller's own; everything else as shipped. The tests set the variable in the environment of
`deep hub run` and of both agent stand-ins, so of each `deep mcp`: the plant may live on either side. A name the hub
doesn't know makes it refuse to start (#16), which is how the plant test fails on the merge base, at its first
assertion.

The base's own `status-row-leak` (#1463) is not used: it is on the merge base, so a test that selects it passes there
and shows nothing of this change, and it adds the app's rows beside the reply instead of widening the list of asks
this issue adds. There is no twin: both of criterion 4's tests fail on the merge base at an assertion, so the before
lane lays none (`scripts/proof-runs.mjs`).

## Criterion to tests

IDs are `criterionId` in `scripts/proof-change.mjs`, computed from the live body; `criteria.json` lists them with their
text. Each test's name starts with its ID.

| # | Criterion | ID | Tests | Wrong programs it fails on | On the base |
|---|---|---|---|---|---|
| 1 | It names the checks | `#2197.b904fcd1` | `start.test.ts`: in a repo whose spec names unit and e2e, a new session's `deep_status` lists both names | the base | FAIL at its assertion (`start.test.ts:22`): the reply is `{session, gates, claims}` and lists neither name; the message names both, `unit` and `e2e` |
| 2 | It names the session's open asks | `#2197.c8fb2936` | `start.test.ts`: a session with one open taste ask; its `deep_status` holds the ask's handle and, in the ask's entry, its state, its default and when it takes it | the base; a reply without the handle, the state, the default or the deadline, each named | FAIL at its assertion (`start.test.ts:29`): "the reply doesn't hold the ask's handle …, so neither its state, its default (amber) nor when it takes it" |
| 3 | It names the session's open items | `#2197.b02b3f39` | `start.test.ts`: the agent records an open item with `deep_open_item`; its `deep_status` holds the item's text | the base | FAIL at its assertion (`start.test.ts:38`): the reply doesn't hold the item's text |
| 4 | Nothing of another session | `#2197.def48d2c` | `others.test.ts`, two tests: neither of two sessions' `deep_status` holds the other's ask (handle, bare ID or question) and each holds its own; under the plant, session A's reply holds session B's ask | the plant `status-lists-every-ask`; a status that reads asks by repo or by worktree | Both FAIL. The first test at its last assertion (`others.test.ts:25`): the reply holds no ask at all, so not its own; not for a leak, since the base lists no ask and so shows none of the other's. The plant test at its first (`others.test.ts:37`): the hub refuses the unknown plant, "DEEP_HUB_PLANT=status-lists-every-ask names no planted program" |
| 5 | #26's budget holds | `#2197.e42c122a` | `budget.test.ts`: with #26's heavy month in the record and a session that has an open ask and an open item, the reply names all of it, and five runs' p95 of 40 calls each are within 100 ms; INCONCLUSIVE, never a pass, off a quiet reference Mac | a status over 100 ms; the base, whose reply isn't the one to time | SKIPPED, which is INCONCLUSIVE and never a pass: the machine was loaded (1-minute load 20.5 on 18 cores), so the run shows nothing of this criterion on the base. A scratch reading, which proves nothing (below): with the gate lifted, on a copy of the base, the test FAILED before any timing, since the reply names none of what is timed (neither check, the ask or the item) |

`BASE-FAILURE.txt` holds the base run.

## Scope the criteria don't cover

| Scope line | Tested? | Where, or why not |
|---|---|---|
| `session`, `gates` and `claims` stay as they are | Yes, a guard that passes on the base | `scope.test.ts`, first test: the issue's two replies under What happens today, value for value, on a session's first call and after a claim with no run yet |
| Nothing of another session is listed (beyond asks) | Yes | `others.test.ts`, third test: of two sessions that each recorded an open item, neither reply holds the other's item or the other session's ID, and each holds its own item |
| No new parameter | Yes, a guard that passes on the base | `scope.test.ts`, first test: `deep_status`'s listed input schema has no property. Every test also calls it with `{}` |
| The Building blocks row and the tool's description say what it answers | Yes, loosely (Pinned 9) | `scope.test.ts`, second test. The wording is free; only the three nouns are held |
| The skill and the description are generated from them | No | #26's own drift test holds it (`tests/acceptance/26/tools.test.ts`, `#26.2d751e6d`): each tool's description and the skill carry the Never cell of every row that names the tool, and the skill names no parameter. A second copy of it here would be a duplicate |
| No new tool | No | The base's tool list can only be held by copying it into a test, which the next tool added on main would break (#2201 was that fault). #26's allowlist test (`#26.e335d28b`) holds every listed tool to the design's MCP tools row |
| #1105's reply ceiling rises in the same change | No | #1105 is open and not built at the base: there is no ceiling to read |
| An ask that is answered, or an item that is closed, leaves the reply | No | No criterion states it, and "its state" allows a reply that keeps an ask with another state |

These tests carry `#2197.scope` in their names, which is no criterion's ID, so the trace lane counts none of them.

**The Proof's second sentence** ("#26's blind drift test passes with the regenerated skill and description") is not
restated as a test: it is #26's test, run as it is. This job ran it twice on 2026-11-13, as
`NO_COLOR=1 node node_modules/vitest/vitest.mjs run --no-file-parallelism tests/acceptance/26/tools.test.ts -t 2d751e6d`:
at the base (01:19:53Z) and on its fixed throwaway copy (01:20:04Z; below). It FAILED both times, the same way, at
its first drift assertion (`tools.test.ts:119`), with one line in the list: "the skill: names deep_root_plan's
parameter host". That line is not about `deep_status`. It names another tool's line in the skill: `deep_root_plan`'s
reads "Propose a root plan for a host: the script …", and #26's `drift` takes `host:` for that tool's parameter
`host` (this job's reading of `drift` and of the base's skill; the log gives the line only). On the copy, where
`deep_status`'s description and its line in the skill were changed, the list held nothing about `deep_status` and
still that one line. So the drift test fails on the base for a reason outside this suite and this issue, and at
the base `scripts/known-failures.json` doesn't list it. An implementer who sees it fail should read its list: a
line about `deep_status` is this change's to fix, and this one was there before it.

## What the implementer must add

1. The plant `status-lists-every-ask` (Wrong programs, above). Nothing else in `plant.ts`.
2. In `scripts/lanes.mjs`: `'tests/acceptance/2197/'` in `alone` (the files start real hubs and agent processes, and
   one times them), and `'tests/acceptance/2197/budget.test.ts'` in `timed` (its verdict reads the machine's load and a
   wall-clock budget; its gate is #1551's `timingProblem`, a helper the list's own grep doesn't find).
3. No perf task, no twin, no fixture, no seam and no new test setting. #26's `deep-mcp-30d` stays the perf lane's
   comparison with the merge base.

## Readings where the issue is silent, or differs from the base

1. **"The checks the repo's spec names."** The base says them two ways: the SessionStart context lists the checks the
   spec's claims name, or its `checks` block when no claim names one, and `deep_run`'s refusal lists the `checks`
   block. The fixture's spec names unit and e2e and nothing else in both, so either reading lists these two. A spec
   whose claims name fewer checks than its block is not tested.
2. **"A session with one open taste ask."** The ask is raised for the session by DeepBuild's core, as #26's and
   #1463's suites give a session an open ask, not by the agent's own `deep_ask`: at the base a taste ask with a
   recommendation is provisional and one without waits 10 s, and neither is what the criterion is about. It is filed
   under the session, which is what `deep_wait` takes as the session's own. Its default is its second option, with
   no recommendation, so a reply that says the first option, or a recommendation, isn't taken for the default.
3. **"Its state."** The issue names no vocabulary, and the base has four for an open ask: the lifecycle table's, the
   tools', the asks core's inbox statuses and the words people see (Pinned 4). Every word of them that is true of
   the fixture's ask is taken; a new word is not.
4. **"When it takes it"** is the deadline the hub's log holds for the ask when `deep_status` is called: its
   `ask.created` deadline, or a later `deadline.moved` or `default.undone`. None moved in the base run.
5. **"Recorded an open item"** is the agent's own `deep_open_item`. An item the gate opens from a verdict is not
   tested.
6. **"Two sessions with an ask each"** are two live sessions in one worktree, so that a status reading by repo or by
   worktree fails too. Both directions are read.
7. **"The other's ask is not in the reply"** is its handle, its bare ULID and its question, anywhere in the reply,
   letter case aside. The reply must also hold the caller's own ask: the base lists no ask, and a test it passed
   would show nothing.
8. **Criterion 5 names no wrong program and no comparison.** "Still" is read as: the reply that now names the checks,
   the ask and the item answers within #26's 100 ms. So the test first holds the timed reply to those, which the
   base fails; the perf lane's comparison with the merge base stays #26's task. The reference Macs are the design's
   three; "quiet" is #1551's reading, a 1-minute load of at most half the cores.
9. **`gates` in the guard** is `{watch_only: false, reason: null}`, the issue's own line, in a hub whose appends work.

## What the drafting job ran, and what it did not

The runs against a hub were made on 2026-11-13 between 01:16Z and 01:24Z, on one machine (Mac17,10, Apple M5 Max,
64 GiB, macOS 27.2, AC power, Node 24.22.2) that other sessions were using: its 1-minute load was 20 at the base
run and 12 after the last, on 18 cores. No file of this suite changed between the runs.

**Before the runs.** No build grant came on 2026-11-12: the machine's throttle was held by another session's timed
grant, and this job's requests ran out. One queued at 22:09Z built the workspaces by 01:16Z, in the checkout and in a
throwaway copy of it. The first try of the runs below (01:17Z) reached no assertion about `deep_status`: every hub
that should have started stopped with `no deep-hook is built under <checkout>/target; run cargo build -p deep-hook
first`. So the tests need `deep-hook` built as well as the workspaces. `cargo build --locked -p deep-hook` ran
(01:18Z, exit 0), and every run was made once more. The results below are that second set.

**Ran, each once after that:**

- **The base run**, 01:19:45Z to 01:19:53Z, in this checkout at `d199a9f7`, under a throttle test grant (through
  `scripts/lease`, which found no hub token on this machine and ran it unleased):
  `NO_COLOR=1 node node_modules/vitest/vitest.mjs run --no-file-parallelism tests/acceptance/2197`. 3 files failed,
  1 passed; 7 tests failed, 2 passed, 1 skipped; 8.3 s. Criteria 1 to 4 fail, each at its assertion, as the table
  above says. The guard passes. The Scope's two other tests fail: the reply doesn't hold the session's own open
  item, and the description names neither asks nor open items. `budget.test.ts`'s timed test is skipped and its
  rule test passes. `BASE-FAILURE.txt` holds the output.
- **#26's drift test**, at the base and on the fixed copy: it failed both times on another tool's line (above, The
  Proof's second sentence).
- **The passing side**, 01:19:55Z to 01:20:04Z: the same four files on a throwaway copy of the base with a fix of
  this job's own (a `deep_status` that also lists the checks, the session's open asks and its open items; the plant;
  the description, the skill and three Building blocks rows saying so). 4 files passed; 9 tests passed, 1 skipped,
  the timed budget test again; 8.8 s. Under the plant, session A's reply held session B's ask.
- **The budget test with its gate lifted**, under the same test grant, not a timed one: a scratch copy of
  `budget.test.ts` whose one changed line takes `timingProblem()` for null, so that it times on a loaded machine.
  - On the fixed copy, 01:20:06Z to 01:20:35Z, load 17.5 falling to 14.9: both tests passed. The five runs' p95 were
    2.1, 2.1, 2.0, 2.1 and 1.9 ms against 100 (margin 12%). 29 s.
  - On a second copy of the base, 01:20:35Z to 01:21:05Z, load 14.9 falling to 13.1: the timed test FAILED before
    any timing, at the assertion that the reply to be timed names what the issue adds (its line 38). The message
    named the check unit, the check e2e, the ask's handle (so neither its state, its default nor when it takes it)
    and the open item. 29 s.
- **Wrong fixes**, 01:22:37Z to 01:24:25Z: each planted in the fixed copy's `deep_status` behind a scratch
  environment variable and run once, against the one file that should catch it. The copy's `deep_status` was edited
  and its hub rebuilt just before (01:22Z; the logs don't say what the edit was), so the three plain files were run
  on it first with no wrong fix picked: 8 tests passed. In each run below the file's other tests passed. The log
  keeps the first 520 characters of each line.

  | Wrong fix | The test that failed | What its message named |
  |---|---|---|
  | Lists the first check only | `#2197.b904fcd1` | `e2e`, the check not listed |
  | The ask's entry without its state | `#2197.c8fb2936` | "…'s entry doesn't say its state, open (as one of: open, waiting, unanswered, queued, held, shown, needs you, needs_you)" |
  | Its state said as `answered` | `#2197.c8fb2936` | The same |
  | The entry without its default | `#2197.c8fb2936` | "…'s entry doesn't say its default, amber ("Amber accent"), apart from its other option" |
  | The first option, `slate`, as its default | `#2197.c8fb2936` | The same |
  | The entry without its deadline | `#2197.c8fb2936` | "…'s entry doesn't say when it takes its default", with the deadline in ms and as a date |
  | The minute the ask was raised, as its deadline | `#2197.c8fb2936` | The same |
  | Every session's asks, not through the plant | `#2197.def48d2c`, the first test | The other session's ask, found in the reply by its handle and by its bare ID |
  | Every session's open items | `#2197.scope`, the third test of `others.test.ts` | The other session's item, found in the reply by its text |
  | An answer 150 ms late | `#2197.e42c122a`, in the gate-lifted scratch file only | "FAIL #2197 deep_status p95 (ms), 30 days in the record: 155.3, 157.7, 155.4, 155.1, 157.4 against 100 (margin 5%)"; 66 s |

**The fix, the gate-lifted file and the wrong fixes were scratch.** They lived in throwaway copies outside this
checkout. None is part of this suite, and none is a proposal for the implementation. They show that the tests pass
on a status that says what the issue asks and fail on the wrong ones above; no more. A gate-lifted reading proves
no criterion: the two that timed were taken on a machine loaded above half its cores, which is what the gate
refuses, so criterion 5 has no result on either side.

Earlier, on 2026-11-12, with no hub and before any build (their output was not kept):

- `node node_modules/typescript/bin/tsc -p tests/acceptance/2197/tsconfig.json`: exit 0.
- The readers of a reply (`helpers.ts`), in a throwaway copy outside the checkout, against replies written by hand: ten
  shapes that state criterion 2's facts pass (objects, a map keyed by handle, a sentence, an ISO time, seconds, a
  label for the default, each of four state vocabularies); nine that leave one fact out, say another state, name the
  other option, list both options with no default, or give another time fail, each naming the fact; and facts spread
  over two asks' entries fail. The same for check names (a list, a map, objects, a sentence; `unit-fast` and a
  session ID holding `e2e` don't count), an item's text and a leaked ask.
- The criterion IDs, from the live body, with `criterionId`'s rule: the five in `criteria.json`.

**Did not run:** `scripts/proof.mjs` or any lane; `scripts/affected.mjs`; the preflight; any other suite, and of
#26's only the one drift test; cargo beyond the `deep-hook` build; `budget.test.ts` under a timed grant, as How to
run has it. The timed budget test never ran unskipped on a quiet reference Mac, on the base or on any fix. A status
that reads asks by repo or by worktree was not planted apart from the one that lists every session's.

So a run has shown: that the worlds start, two live sessions in one worktree among them; that the tests of
criteria 1 to 4 fail on the base at their assertions; that the guard passes there; and that those tests pass on a
fix and fail on the wrong fixes above. Still unverified: criterion 5, on the base and on a fix, which stays
INCONCLUSIVE until `budget.test.ts` runs unskipped on a quiet reference Mac.

## Files

- `helpers.ts`: the spec, the open taste ask and its reading from the log, the worlds (`oneSession`, `twoSessions`),
  the calls (`status`, `openItem`) and the readers of a reply (`notListed`, `holdsText`, `held`, `entriesOf`,
  `saysWhen`, `askProblems`). Reuses `../26/helpers.ts` (homes, worktrees, seeding, the hub, the socket, the agent
  stand-in, MCP, cleanup by PID, the timing rule).
- `start.test.ts` (1, 2, 3), `others.test.ts` (4, and the Scope's other session), `scope.test.ts` (the Scope),
  `budget.test.ts` (5, and the rule's failing side; gate from `../1551/helpers.ts`).
- `criteria.json`: the five criteria with their IDs. `tsconfig.json`: type-checks the suite under the root's strict
  options. `BASE-FAILURE.txt`: the run at the base.
