# Acceptance tests for #324: the done gate's size and scope

A change measured against its plan and your usual size with no model, sent back once, then one taste call.

Written first, blind, by a job that never saw an implementation of #324 (none existed). Sources:

- **The issue**: its text as of 2026-11-03T22:10:22Z (`updatedAt`): Scope, the five checkbox criteria, Proof and
  Depends on.
- **The design**, `docs/technical-design.md`:
  - [An agent says it's done]: **Size and scope** (the reading with no model: lines and files changed, new
    dependencies, top-level folders, files outside the plan, unreached code, duplicated blocks; the median of the last
    20 changes you accepted for the same kind of issue in that repo; the numbers sent back once with "cut it to what the
    issue needs, or say why each part is needed"; still over, one taste call with the biggest additions; never FAIL;
    a large plan's scope sized before any code and brought to you once; a document's patches listed by stable ID),
    Every stop is judged, A question holds the send-back, Stalled claims, The verdict in the chat.
  - [Checks for work beyond code]: Document, Judgment, Stable names for what checks target.
  - [Before each command]: "Adding a dependency, a service, a cloud resource or a top-level folder that the plan
    doesn't name is a decision".
  - [What done means, fixed at the start]: Who drafts it; the Definition of done, Ask, Patch, Document check and
    Provenance primitives; the done-gate row of [First-party extensions that ship on by default] ("The plan's proof
    section is read too").
  - [An ask, and your answer getting back] and the asks primitives: a taste call's key, deadline and default.
  - The learned layer's "Size budgets learned from the change sizes you accept" (Later, as extensions).
- **The closed dependencies**, for the base behaviour they landed: #322 (the done gate's core reads; its suite,
  tests/acceptance/322, is this suite's template: the world, the hub as a process, sessions through deep-hook, the
  record through `events.read`, `deep inbox answer`) and #318 (asks: kinds, deadline, fallback and default). Also
  read: tests/acceptance/303 (#322's template), 317 (the plan a guard reads), 806 and 393 (`deep show`, the canvas
  world `DEEP_HUB_TEST_SHOW`, writer layers), 68 (check kinds for documents).
- **The base commit**: `7b18ed17` (origin/main). The base code read: `packages/hub/src/` (`ask-tasks.ts`: the handed
  draft's fields; `core.ts`: the PreToolUse decisions, `show`, `recordRevision`; `standing.ts`: the dependency ask;
  `show.ts`; `canvas.ts`), `packages/checks-command/src/index.ts` (a check that counts no test runs nothing), the
  schemas `ask.created@4`, `claim.made@3`, `verdict.made@1`, `run.started@3`, `doc.patched@2`, `work.item@2`, and
  `crates/deep-show` (the canvas core's build set, writer layers).

The implementing agent does not edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 (`.node-version`) first on `PATH` and the Rust toolchain:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub and the deep CLI the tests start
cargo build --locked -q -p deep-hook     # target/debug/deep-hook, which every hook runs
cargo build --locked -q --bin deep-show  # the canvas core the hub runs for AC5's figure
npx vitest run --root tests/acceptance/324 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/324/tsconfig.json
```

- On Linux the check runner's sandbox (bwrap) sees only system folders, so the Node that runs vitest, whose folder
  every child's `PATH` starts with, must be one it can read (on the reference Linux box, `/var/tmp/deep40/node/bin`);
  with a Node under the home folder, every check run is refused and the tests stop BLOCKED at "the claim's checks
  must pass".
- Each test starts hubs of its own, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list (`alone`),
  beside #303's and #322's. The implementer adds it.
- Every test makes its folders under `/tmp/dh324-*` (a Unix socket path must fit in 104 bytes on macOS), sets `HOME`
  to `<tmp>/h` for every process it starts, and never touches the real `~/.deepbuild`, `~/.claude` or `~/.codex`.
- It stops only processes it started, by PID (`helpers.ts`, `cleanup`), never by name or port.
- No network, no model, no `claude` binary, no `gh` call. A child never inherits this process's billing keys, forge
  tokens or its `DEEP_*`, `GIT_*`, `XDG_*` or `CLAUDE*` settings.
- Each test takes seconds on the base; on a correct hub, up to a few minutes (three stops, each held for its checks
  within `DEEP_HUB_TEST_STOP_HOLD_MS` = 30 s, plus AC2's 20 s wait for the plan's ask). The whole suite is under 30
  minutes.

## The surface under test

The tests reach DeepBuild only through what #322's suite reaches it through, and three test settings:

- **deep-hook** (`target/debug/deep-hook`), run as Claude Code runs our hook entry, as a child of the session's own
  process (`fixtures/agent.mjs`). A Stop's reply is read from deep-hook's stdout (`decision: block` with its
  `reason`, and `systemMessage`) or, at exit 2, its stderr (`replyText`); `decision` says whether the stop was let
  through. A send-back is a stop that isn't let through.
- **`deep hub run`** with `DEEP_HUB_TEST_CONFIRM`, `DEEP_HUB_TEST_DRAFTS`, `DEEP_HUB_TEST_SHOW` and
  `DEEP_HUB_TEST_STOP_HOLD_MS` (the base's), and one new one, `DEEP_HUB_TEST_ACCEPTED` (below).
- **The record** through `events.read` on the socket (the cli role, the control token): `user.ask`,
  `task.created`, `definition.locked`, `claim.made`, `run.started`/`run.finished`, `verdict.made`, `ask.created`,
  `doc.patched`, `agent.stop`, and whatever events the implementer adds for a claim's size reading.
- **`deep inbox answer <ask> <option>`**: your answer on the trusted path (AC2, only when the hub holds the first
  edit until you answer the plan's ask).
- **`deep show --doc <doc> --document <file> --json`** (#806), run by the session's Bash tool as a child of its
  process, so the hub stamps the session's writer (AC5).
- **The project's trust decision** as #348 records it (`openTrust` over the record before the hub starts), as
  #322's suite records it.

### Playing Claude Code

As in #322's suite, with one addition: `fixtures/agent.mjs` also runs a command other than deep-hook (`exe`), so the
`deep show` a Bash call runs is a child of the session's process, as Claude Code's tool commands are.

### The world

`<tmp>/repo`, a git repository on `main`, the folder every session works in. Its first commit holds:

- `src/auth.js`: `checkToken` (`token.exp > 0`), `rejectsExpired: false`, and `require('./clock.js')`. `FIX` makes
  the unit test pass, `FLAG` the drafted check. `fixed: true` (AC5) commits both already made.
- `src/clock.js`: the middleware's clock, loaded by everything that loads `src/auth.js`.
- `src/billing.js`: a module nothing loads.
- `tests/unit.test.js` (the spec's `unit` check) and `tests/expired.test.js`, a node:test test that the drafted check
  `.deepbuild/checks/expired-token.sh` runs (`node --test tests/expired.test.js`; R1 asserts
  `tests/expired.test.js:5`). A drafted check must run a test the runner counts: a bare `node -e` exit is
  `ran_nothing` at the base, so INVALID.
- `.deepbuild/done.yaml` (#322's spec: the `unit` check) and `package.json` with `"dependencies": {}`.

Then 35 commits, one per accepted change (`HISTORY`): 20 feature changes, each adding 17 lines over 3 new files under
`src/feat/`, then the 15 most recent, fixes of 400 lines over 3 files under `src/fixes/`. HEAD is the session's base.
So the usual size of a feature change is 17 lines and 3 files, with no dependency and no top-level folder added; a
median over the last 20 changes of any kind is 400 lines.

### New: the changes you accepted (`DEEP_HUB_TEST_ACCEPTED`)

The design compares a change "with the changes you accepted for the same kind of issue in that repo, the median of
the last 20", but names no record of an accepted change a fresh hub could already hold. This suite hands them in, the
way #303 and #322 hand in drafts and work items: a JSON file named by `DEEP_HUB_TEST_ACCEPTED`, which only tests set,
`{ "accepted": [ { "repo": <real path>, "kind": "feature" | "fix", "base": <sha>, "commit": <sha>, "accepted_at": <ms> } ] }`,
one entry per accepted change, oldest first. Each is a commit of the world's repo with its base; the hub measures it
with the same reading it gives a claim (no sizes are handed in). "Last" is by `accepted_at`; "the same kind" is
`kind` against the task's kind (below).

### The plan and the kind (`DEEP_HUB_TEST_DRAFTS`)

#322's handed draft, `{ ask, requirements, deliverables, budget }`, plus two fields the design leaves without a
home:

- `kind`: the kind of issue the task is (`feature` in every test), which picks the accepted changes it is compared
  with.
- `plan`: `{ large: boolean, scope: { files, parts, dependencies, folders } }`. The design: "When the plan marks an
  issue as large, its scope section, the files and parts it will touch, is sized before any code"; a dependency or
  a top-level folder "that the plan doesn't name". A part is a part of the code by name, or a document's item by its
  stable ID (AC5: `axis-y`). The plan is handed with the definition, as the drafting job's output is; an agent-written
  plan (Claude Code's plan mode) has no facts or corpus entry at the base to drive.

### What the tests read

- **A task**, **a locked definition**, **a claim**, **its runs** and **its verdicts**: as #322's suite reads them.
  The base-commit run of R1 (on the base, which fails as a fix's must) is told apart by its `commit`.
- **Listed in the claim** (AC3, AC4, AC5): the design names no event or field for the size reading, so the suite
  reads the claim's record: every event after the stop whose data names the task's `task_ref`, one of its claims
  (`claim`) or has one as its subject, other than prompts, tool calls, session events and check runs. A new event
  (such as one per claim's reading) or new fields of `claim.made` both read. Within it, by structure, never by words:
  - *with where it came from* (AC3): an object one of whose own string fields names the thing (`left-pad`; the
    folder `vendor` or `vendor/`, not a path inside it) and that holds an origin anywhere inside it, or one string that
    names both. The origin is the file that brought it (`package.json`; `vendor/pad.js`) or the ID of the tool call
    that did (the Edit's or the Write's `tool_use_id`).
  - *a list* (AC4, AC5): an array, read as the string elements and own string fields of its elements. AC4 needs one
    naming `src/billing.js` and neither `src/auth.js` (the plan's) nor `src/clock.js` (reached by every check); AC5
    one naming `series-revenue`, `series-cost` and `legend` and no `axis-y`. A list of every changed file or item
    doesn't do.
- **Sent back with the numbers** (AC1): the stop isn't let through, and its reply carries the words "cut it to what
  the issue needs, or say why each part is needed" (case aside), the change's lines (189 added, or 191 added and
  removed) and the usual 17. **Sent back once**: no later stop is sent back with those words (AC1) or naming the
  same files or IDs (AC4, AC5).
- **One taste call**: exactly one `ask.created` of kind `taste` after the work began, still one after a third stop.
  AC1's names a file of the biggest additions (`src/rules/…`) and takes your taste deadline, 3 days; AC4's names
  `src/billing.js` and carries the diff (the line it added, or a field whose name holds `diff` with a value); AC5's
  names `series-revenue` and `legend` and never `axis-y`.
- **Reaches you before any code is written** (AC2): an `ask.created` whose options read approve, shrink and split,
  in the record before the first edit's change is made. The test waits 20 s after the lock, then sends the first
  edit; a hub that holds that edit until you answer gets your approve through `deep inbox answer`. **Once**: one
  such ask after the work and a stop.
- **Never FAIL** (AC1, AC5): no `verdict.made` on the task's claims with `outcome` FAIL.

## Criteria to tests

Each `describe` and test name starts with its criterion's number and ID, `#324.<first 8 hex of SHA-256 of the
criterion's text>` (trimmed, whitespace collapsed, `- [ ] ` dropped, as `scripts/proof-change.mjs` computes it).
Every failure message starts with them too.

| ID | Criterion (short) | Test file | What the test does |
|---|---|---|---|
| AC1 `#324.5829869b` | ten times the usual size: sent back once with the numbers, then one taste call, never FAIL | `size.test.ts` | a feature change within its plan, checks green, 189 lines over 12 files against the feature median 17 (the last 20 of any kind give 400); stop 1 sent back with 189/191, 17 and the words; stop 2 one taste call naming `src/rules/…`, deadline 3 d, no second send-back; stop 3 nothing more; no FAIL |
| AC2 `#324.adc9187e` | a plan past the usual size reaches you before any code | `plan.test.ts` | a plan marked large with 12 files (usual 3): an ask with approve, shrink and split before the first edit's change, naming the scope; one after a stop. Twin in the same test: marked large with 1 file, no such ask, the edit goes through |
| AC3 `#324.c3d7daec` | a dependency or top-level folder outside the plan, listed with where it came from | `outside.test.ts` | plan names `dayjs` and no folder; the agent adds `dayjs` and `left-pad` to package.json and writes `vendor/pad.js`; the claim lists `left-pad` with package.json (or the Edit) and `vendor` with vendor/pad.js (or the Write) |
| AC4 `#324.a94619b4` | files neither plan nor check reaches: listed, sent back once, one taste call with the diff | `unreached.test.ts` | plan names src/auth.js; the agent also edits src/clock.js (reached) and src/billing.js (not); the claim lists billing apart from auth and clock; stop 1 sent back naming billing, not clock; stop 2 one taste call naming billing with its diff; stop 3 nothing more |
| AC5 `#324.96d43bd6` | figure: series and legend listed by ID, sent back once, one taste call; axis never listed; never FAIL | `figure.test.ts` | the session draws the figure, then (asked to relabel `axis-y`) a revision that also recolors both series and moves the legend; the claim lists the three IDs without `axis-y`; stop 1 sent back naming them; stop 2 one taste call naming them, not `axis-y`; stop 3 nothing more; no FAIL |

The issue's Proof ("A change ten times the usual size sent back once and then asked, and a figure patch's extra
changes listed by ID, each shown failing first") is AC1 and AC5 failing on the base (`BASE-FAILURE.txt`). The issue
names no wrong program, so no plant is selected; AC2's twin and AC4's `src/clock.js` are the wrong cases in-line.

## What this suite could not encode

- **Where the accepted changes, the plan and the kind live.** `DEEP_HUB_TEST_ACCEPTED` and the draft's `kind` and
  `plan` are this suite's; the design names none of them. The implementer reads them as the stand-ins they are for
  the record of changes you accepted and the drafting job's plan.
- **Services or cloud resources, code no test reaches by coverage, and duplicated blocks** (knip, coverage, jscpd):
  in the issue's Scope with no criterion of their own; no test drives them. AC4's "any requirement's check reaches"
  is read as the code the checks load (src/auth.js loads src/clock.js), which an import graph or a read trace gives.
- **The send-back's exact wording beyond the quoted phrase**, how the numbers are laid out, and the taste call's key:
  only the numbers' presence and the phrase are read. The taste call's key (the screen or step and the element's
  stable name) is not asserted.
- **Whether the plan's ask is a taste call or a choice**: only its options (approve, shrink, split) are read; it is
  not counted among AC1's or AC4's taste calls because those tests' plans aren't marked large.
- **The brief** (AC5) is the task's prompt and its requirement's text, both naming the y axis; R1 has no check (no
  check kind at the base reads a canvas document), so the claim's verdict is INVALID at the base, which is not FAIL.
- **The order of the first edit and the plan's ask** (AC2) is read from the record: the ask's `log_pos` before the
  log position at the moment the edit's change is made on disk.

## Files

- `helpers.ts`: the world (home, repo with its history, drafts with kind and plan, accepted changes, canvas world),
  the project's trust decision, the hub as a process, `events.read`, sessions and their hooks, the session's own
  commands, the record readers (`lockedTask`, `claimsOf`, `claimRecord`, `runsOf`, `taskVerdicts`, `tasteCalls`,
  `asksRaised`), the listing readers (`entriesWith`, `listsNaming`), `deep inbox answer`.
- `fixtures/agent.mjs`: each session's Claude Code stand-in, the parent of that session's deep-hook runs and commands.
- `size.test.ts` (AC1), `plan.test.ts` (AC2), `outside.test.ts` (AC3), `unreached.test.ts` (AC4),
  `figure.test.ts` (AC5).
- `tsconfig.json`: #322's (the root's strict options with `noEmit` and `allowImportingTsExtensions`).
- `BASE-FAILURE.txt`: the run on the base commit, trimmed to each test's failing assertion.

[An agent says it's done]: ../../../docs/technical-design.md
[Checks for work beyond code]: ../../../docs/technical-design.md
[Before each command]: ../../../docs/technical-design.md
[What done means, fixed at the start]: ../../../docs/technical-design.md
[First-party extensions that ship on by default]: ../../../docs/technical-design.md
[An ask, and your answer getting back]: ../../../docs/technical-design.md
