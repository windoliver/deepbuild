# Acceptance tests for #303: ask-tasks in the kernel

Each prompt with its origin, a task for each ask that changes behavior, and its definition locked by hash.

Written first, blind, by a job that never saw an implementation of #303. Sources:

- **The issue**: its text as of 2026-10-28T17:37:23Z (`updatedAt`): Scope, Fields, the 12 checkbox criteria, Proof
  and Depends on.
- **The design**, `docs/technical-design.md`:
  - [What done means, fixed at the start], all of it: When, Who drafts it (each requirement keeps its author), Locked
    (the hash recomputed at every claim; SessionStart sends the open asks' requirement IDs again), Disputes.
  - [An agent says it's done]: "Every stop is judged" and "A loop's turn end isn't a hand-back".
  - [The contract (kernel)]: Event, Ask-task, Definition of done, Claim.
  - [Threats, and what stops each one]: "Hostile text in what DeepBuild reads".
  - Hook protocol (deep-hook and the hub), and [What each agent gives us] (Claude Code's row: prompt origins, messages
    typed while it works read from the transcript's queue at the next hook).
  - Building blocks: Work source (`work.item@1`'s fields, each author's role from the provider's membership record).
  - Dogfooding, for disputes.
- **The base commit**: `c92864d1` (origin/main). The base code read:
  - `packages/hub/src/`: `core.ts` (`queuedAsks`, `enrich`, the `user.ask` drafts and their `tasks`, `deep_claim`,
    `deep_propose`, `evidence.read`), `hookmap.ts`, `server.ts` (the test settings), `plant.ts`.
  - `packages/record/src/projections.ts` (the `definitions` table) and `index.ts` (the core-only kinds).
  - The schemas `user.ask@1`, `task.created@1`, `definition.locked@1`, `definition.drafted@1`, `claim.made@2`,
    `agent.stop@3`, `learn.proposed@1`, and `packages/contracts/src/index.ts` (`validate`, `getSchema`, `listSchemas`,
    `fixtures`).
  - `adapters/claude-code.facts.json` (the UserPromptSubmit origin rules) and the corpus's compact, clear, subagent and
    desktop-peer sessions.
  - `scripts/benchmark.mjs`, `scripts/perf.mjs` and `benchmarks/budgets.json` (the perf lane).
- **Sibling suites, for their conventions**: tests/acceptance/321, 18/mapping, 18/session, 25, 318 and 304 (budgets).

The implementing agent does not edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 (`.node-version`) first on `PATH` and the Rust toolchain:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub and the deep CLI the tests start
cargo build --locked -q -p deep-hook     # target/debug/deep-hook, which every hook runs
npx vitest run --root tests/acceptance/303 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/303/tsconfig.json
```

- Each test starts hubs of its own, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list (`alone`),
  beside #321's and #18's. The implementer adds it.
- Every test makes its folders under `/tmp/dh303-*`, because a Unix socket path must fit in 104 bytes on macOS. It sets
  `HOME` to `<tmp>/h` for every process it starts, and never touches the real `~/.deepbuild`, `~/.claude` or `~/.codex`.
- It stops only processes it started, by PID (`helpers.ts`, `cleanup`, `stopHub`), never by name or port.
- No network, no model, no `claude` binary. A child never inherits this process's billing keys or its `DEEP_*`,
  `GIT_*`, `XDG_*` or `CLAUDE*` settings.
- AC11's timing test builds the merge base in a temp folder (`git archive`, read from this checkout only) and takes
  several minutes. The others take 30 s to 2 minutes each on a correct hub.

## The surface under test

The tests reach DeepBuild only through these:

- **deep-hook** (`target/debug/deep-hook`), run as Claude Code runs our hook entry: `deep-hook claude-code <event>`,
  the hook's JSON on stdin, `HOME` the test's. Payloads and transcripts are shaped like the corpus's
  (`adapters/corpus/claude-code`). Every transcript entry carries the newest version the facts cover, so no session is
  watch-only.
- **`deep hub run`** with its test settings: `DEEP_HUB_PLANT`, `DEEP_HUB_TEST_CLOCK` and `DEEP_HUB_TEST_CONFIRM`, which
  the base has, and two new ones, `DEEP_HUB_TEST_DRAFTS` and `DEEP_HUB_TEST_WORK` (below). Each test passes both new
  ones to every hub it starts.
- **The socket**, as the cli role with the control token: `events.read`, and `evidence.read` (AC12).
- **`deep inbox answer <ask> <option>`** (#24): your answer on the trusted path (AC5), the OS confirmation stubbed
  `confirmed` (`DEEP_HUB_TEST_CONFIRM`), as #321's and #24's suites stub it.
- **The contracts package's public entry**, `packages/contracts/src/index.ts`: `listSchemas`, `getSchema`, `validate`
  and `fixtures`, each schema by name (AC9).
- **The record's file**, `<home>/.deepbuild/ledger.db`: its `definitions` table is "the store" AC9 edits (below).
- **The perf lane**, `benchmarks/budgets.json` and `scripts/benchmark.mjs`'s `validateBudgets` (AC11).

### Playing Claude Code

The test is Claude Code. Each session has its own long-lived process, `fixtures/agent.mjs` (copied from #321's), which
runs every deep-hook of that session as its child, so the hub binds the session to it and `deep inbox answer`, run by
the test process, is outside every session's process tree, as your terminal is. The test runs a call only when
deep-hook's PreToolUse allows it (exit 0 with no deny), then writes the call's result to the transcript and fires
PostToolUse.

- **A prompt you typed**: a transcript entry with `turnOrigin: human` and `origin.kind: human`, then UserPromptSubmit.
- **A `/loop` iteration**: `turnOrigin: scheduled` (as #18's AC24 writes it).
- **A background subagent's report**: `origin.handback: true` (the corpus's 2.1.304 subagent session).
- **Another session's message**: `turnOrigin: peer`, `origin.kind: peer`, `hostInjected: true` (the corpus's 2.1.299
  desktop-peer session).
- **A message typed while the agent works**: a `queue-operation` `enqueue` line in the transcript, written while a Read
  runs, between its PreToolUse and its PostToolUse. That PostToolUse is the one next hook.
- **Startup, resume, compaction and /clear**: SessionStart with `source` `startup`, `resume` (the same session ID) or
  `compact` (the same session ID); `/clear` is SessionEnd with `reason: clear`, then a new session ID whose SessionStart
  has `source: clear`, as the corpus's clear session has them.

### New: the definitions the kernel is handed (`DEEP_HUB_TEST_DRAFTS`)

The issue: "The kernel locks the definition it is handed (a fixture in this task's tests …) and never drafts one". The
fixture reaches the hub as a JSON file named by `DEEP_HUB_TEST_DRAFTS`, which only tests set:

```json
{ "drafts": [
  { "ask": "<a prompt's exact text>",
    "requirements": [{ "id": "R1", "text": "…", "source_line": "ask#L1", "refuted_by": "…", "check": ".deepbuild/checks/expired-token.sh",
                       "on_base": "fails", "asserts": [".deepbuild/checks/expired-token.sh:3"], "depth": "unit", "oracle": "code", "near_misses": [] }],
    "deliverables": ["src/auth.ts"], "budget": null },
  { "issue": "<a work item's source_id>", "requirements": [ … ], "waives": [{ "id": "R2", "source_line": "item-7.c1#L2" }],
    "deliverables": [ … ], "budget": null }
] }
```

- When the kernel opens a task for a prompt whose text is `ask`, or for the work item whose `source_id` is `issue`, this
  is the definition handed to it for that task, as the drafting job's output will be from week 5. With no entry, the
  task's definition waits, as one whose drafting job hasn't finished does.
- Each requirement has the issue's Fields (`id, text, source_line, refuted_by, check, depth, oracle, near_misses`) and
  the design's `on_base` and `asserts`. `check` is a path in the repo, or null.
- `source_line` names the text a requirement came from: `ask#L<n>` for a line of the prompt, `<source_id>#L<n>` for a
  line of a work item's body.
- `waives` (issue drafts only) lists a requirement the text at `source_line` asks to remove or waive, as a drafting job
  that read "skip the e2e test" would record it. The kernel decides whether it applies.
- The suite hands a definition for every prompt it types, the questions and the rename included, so a kernel that
  wrongly opened a task for one would lock it, and the tests would see it.

### New: the test work source (`DEEP_HUB_TEST_WORK`)

The issue: the author's role "comes from the comment's `work.item@1` reading, here a test source's". The test source is
a JSON file named by `DEEP_HUB_TEST_WORK`, which only tests set, holding the readings the source gives:

```json
{ "readings": [
  { "source_id": "item-7", "link": "https://work.test/acme/shop/issues/7", "title": "…", "body": "<the text>",
    "criteria": ["…"], "authors": [{ "handle": "maya", "role": "owner" }], "updated": "2026-10-20T09:00:00Z" },
  { "source_id": "item-7.c1", "link": "https://work.test/acme/shop/issues/7#comment-1", "title": "…", "body": "<the comment>",
    "criteria": [], "authors": [{ "handle": "drive-by", "role": "outside" }], "updated": "2026-10-21T10:00:00Z" }
] }
```

- Each entry is one `work.item@1` reading with the design's fields (`source_id, link, title, body, criteria, authors,
  updated`); here `body` is the text itself, where the GitHub source (#32) carries a handle.
- A comment is a reading of its own, linked to its item by its link (the item's link and `#comment-<n>`), with one
  author, the comment's. The handed definition's source lines name it.
- A session starts from an item as the design says, "a link in a prompt": the prompt `Fix <link>`.

### What the tests read in the record

- **A prompt's origin**: its `user.ask`'s `from`: `person`, `scheduled`, `subagent` or `session`.
- **"Opens a task"**: the prompt's `user.ask` names one task in `tasks`, and a `task.created` with that `task_ref` is
  under the session's thread (its `thread` is the one the session's `session.start` recorded). For a prompt or a
  mid-turn message, the `task_ref` is a message handle, `session:<id>#<message>`. For AC5's issue, the session's thread
  holds exactly one task, whatever its key.
- **"Opens no task, and no drafting job"**: its `user.ask` records `tasks: []`; the thread holds no `task.created` but
  the other prompts' tasks; and no `definition.*` or `job.*` event of the session, or of none, names the prompt's text
  or a task the other prompts didn't open.
- **"Within one hook"** (AC2, AC8): the `user.ask` and the `task.created` are in the record within 10 s of the one hook
  after the message was queued, before any other hook of the session fires.
- **A locked definition**: a `definition.locked` whose `task_ref` is the task's. Its `data` carries `hash`, `issue_rev`
  and `base_commit`. `base_commit` is the commit the session's repository was at. Its `requirements` are the handed
  ones by `id`. For AC5, each requirement has `author: {handle, role}`, from the work.item@1 reading of the text its
  `source_line` names.
- **Its schema**: the version the event's `v` names, `definition.locked@<v>`, read by name through the contracts entry,
  with the event's top-level fields that schema lists. "One without any of them fails its schema, naming the field": a
  refusal whose `path` is `/data/<field>`. The newest `definition.locked@<n>` the contracts publish must hold the same
  for its first fixture.
- **The stop rule's reading**: each `agent.stop` carries `claim`: `false` when the rule reads the stop as no claim,
  `true` when it reads it as a claim. The base records `did_work` but no reading.
- **The claim's recomputed hash** (AC9, AC12): "The core's gate runner recomputes the hash at every claim", and AC12
  speaks of "the next claim's recomputed hash". A claim is a stop the rule reads as a claim: a stop whose turn did work.
  The record holds, after that stop, an event that names the task's `task_ref` in `data.task_ref` and the hash the
  kernel recomputed from the stored definition at that claim in `data.hash`. Its kind is open (a new `claim.made`
  version would do); the test takes the first such event after the stop that isn't a `definition.*`.
- **The store** (AC9): the record's `definitions` table, which at the base holds each locked definition's
  `requirements` by `task_ref`. The test stops the hub by PID, rewrites R2's `text` there with better-sqlite3, starts
  the hub again, and makes the next claim. The events table is append-only; this table is what a writer to the ledger
  could change.
- **What SessionStart sends** (AC4): deep-hook's stdout for the SessionStart, Claude Code's reply. "SessionStart sends
  the open asks' requirement IDs again": it must name each requirement ID of the locked definition, as a word.
- **The approved bytes kept by digest** (AC12): the locked definition's R1 names the SHA-256 of the check file's bytes
  at the lock, and `evidence.read` with that SHA-256 finds it in the hub's evidence store.
- **A proposal naming the file** (AC12): an event of a kind ending in `.proposed`, after the change, whose data names
  `.deepbuild/checks/expired-token.sh`. The base's `deep_propose` records `learn.proposed`.

### The prompts

The issue's own words are used where it gives them. How the kernel tells a request for new or changed behavior from a
question or a rename is left to the implementer; no test fixes the rule, only what it does on these prompts:

| Prompt | Kind | Criteria |
|---|---|---|
| `make the auth middleware reject expired tokens` | change (the issue's) | AC1, AC3, AC4, AC6, AC7, AC9, AC11, AC12 |
| `explain how the auth middleware checks expiry` | question (the issue's) | AC7, AC10 |
| `why did you pick bcrypt?` (mid-turn) | question (the issue's) | AC8 |
| `also add a test for expired tokens` (mid-turn) | change (the issue's) | AC8 |
| `also return 401 with a JSON error body when the token is malformed` (mid-turn) | change | AC2 |
| `Rename the getUser function to fetchUser.` | rename only | AC3 |
| `Add a rate limit of five login attempts per minute.` | change | AC1 |
| `Send a password reset email when a user asks for one.` | change | AC1 |
| `Fix https://work.test/acme/shop/issues/7` | an issue the session starts from | AC5 |

AC6's three automatic prompts each ask for a change in their words (`/loop make the login tests pass, then add a retry
to the cart sync`, a report ending "Add a retry with three attempts to the cart sync.", and another session's "Add a
dark mode toggle to the settings page."), so only their origin keeps them from opening a task. AC11 times the change
prompt with a suffix that makes each one new (`… in the r0p3 handler`).

### AC5's answer

The definition "waits for one answer before it locks". The ask's options aren't stated. The test answers with the
first option whose id or label says keep, include, add, accept, approve, lock or yes, else the ask's recommended option,
else its first. Then the definition must lock with drive-by's R3 in it, marked with its author, since outside text
"can add requirements".

### INCONCLUSIVE (AC11)

The timing test always measures and prints its readings. It counts only on a reference Mac (Mac15,7 M3 Pro 36 GiB or
Mac15,12 M3 16 GiB, the list #304's suite uses) whose 1-minute load is within its core count. Anywhere else, or when
the merge base can't be built, it is skipped as INCONCLUSIVE with the readings, never passed. Mains power, Low Power
Mode and the thermal state are not read. Its judgement is #304's: five runs; PASS when every run's added time is under
5 ms; FAIL when every run is over it by more than the margin (the larger of 5% and the runs' spread); otherwise
INCONCLUSIVE. The same deep-hook binary, this checkout's, runs both sides, so only the hub's time differs. The timed
prompts have no handed definition, as at a real prompt, where drafting takes minutes.

## Wrong programs

Each is code the implementer writes, selected with `DEEP_HUB_PLANT=<name>` on `deep hub run`. A plant the base doesn't
list stops the hub from starting (`plantOf` throws), so its test fails BLOCKED, never passes. Each wrong-program test
runs its criterion's scenario on the planted hub and requires it to fail with a message naming what the issue says it
names. `failureOf` rethrows BLOCKED and INCONCLUSIVE, so neither counts as the plant's failure.

| Name | Criterion | What the plant does | How the test fails on it |
|---|---|---|---|
| `first-prompt-always-task` | AC7 | opens a task for every session's first prompt you type, a question included | `the prompt "explain how the auth middleware checks expiry" must open no task … yet it opened ["session:…#0"]`; the test requires the message to name that message handle |
| `midturn-always-task` | AC8 | opens a task for every message typed mid-turn, a question included | `the prompt "why did you pick bcrypt?" must open no task … yet it opened ["session:…#1"]`; the test requires the handle |
| `hash-ids-only` | AC9 | the lock and its recompute hash only the requirement IDs | `requirement R2 of session:…, edited in the store after the lock …, must give another hash …`; the test requires `R2` |
| `claim-on-tool-calls` | AC10 | the stop rule reads every stop whose turn made a tool call as a claim | `stop D, the answer to your typed question … (agent.stop <id>) must read as no claim (claim: false)`; the test requires the stop's event ID |
| `role-from-text` | AC5 | the lock reads an author's role from the text it wrote ("the repo owner"), not from its work.item@1 reading | the signed comment's definition locks with no answer, or drive-by isn't marked outside; the test requires a failure on the wait or the role |
| `hash-check-paths` | AC12 | the lock hashes requirement records with their check paths but not the checks' bytes | `.deepbuild/checks/expired-token.sh, changed by python -c after the lock, must make the next claim's recomputed hash differ …`; the test requires the file's path |

The issue names no wrong program for AC1, AC2, AC3, AC4, AC6 and AC11. The base is theirs (`BASE-FAILURE.txt`):
it records a `tasks` entry for every prompt a person typed, a question and a rename included, and opens no task,
definition or lock at all. AC3 and AC6 carry a typed change in the same session as a control, so a kernel that opens
no task for anything fails them too.

## Criteria to tests

Each `describe` and test name starts with its criterion's number and ID, `#303.<first 8 hex of SHA-256 of the
criterion's text>`: trimmed, whitespace collapsed, `- [ ] ` dropped, as `scripts/proof-change.mjs` computes it. Every
failure message starts with them too.

| ID | Criterion (short) | Test file | What the test does |
|---|---|---|---|
| AC1 `#303.b4187956` | three asks over three days, three locked definitions | `days.test.ts` (1) | one session; three hubs on `DEEP_HUB_TEST_CLOCK` a day apart, a resume each day; three tasks under the thread, one lock each, each locked that day |
| AC2 `#303.c7678fa6` | a mid-turn message asking for a change is a task within one hook | `midturn.test.ts` (1) | the message queued during a Read; after its PostToolUse alone, a task keyed by its message handle |
| AC3 `#303.64edb131` | a rename-only prompt opens no task | `rename.test.ts` (1) | a typed change (control), then the rename, with an Edit; `tasks: []`, no task, lock or job |
| AC4 `#303.01978d67` | definitions survive a resume and a compaction | `survive.test.ts` (1) | lock; SessionStart compact names R1 and R2; hub restarted; SessionStart resume names them; one lock, same hash, no revision |
| AC5 `#303.c870ae54` | an outside comment's "skip the e2e test" leaves the requirement, marks its author, waits for one answer; signed "the repo owner" still waits; a role read from the text fails | `outside.test.ts` (3) | the test work source and an issue draft with a waiver; one ask, no lock until `deep inbox answer`; R2 stays, R3 marked drive-by/outside, R1 and R2 maya/owner; the signed variant; the wrong program `role-from-text` |
| AC6 `#303.f3b51cf5` | a /loop iteration, a subagent's report and another session's message open nothing, each with its from | `origins.test.ts` (1) | a typed change (control), then the three automatic prompts, each asking for a change; from scheduled, subagent, session; `tasks: []` |
| AC7 `#303.1bdbea79` | a first-prompt question opens no task or drafting job, `tasks: []`; a first-prompt change opens one; the always-task rule fails naming the handle | `first.test.ts` (2) | two fresh sessions; the wrong program `first-prompt-always-task` |
| AC8 `#303.0ca34012` | mid-turn "why did you pick bcrypt?" opens none, "also add a test for expired tokens" opens one within one hook; the always-task rule fails naming the handle | `midturn.test.ts` (2) | both queued during Reads; the wrong program `midturn-always-task` |
| AC9 `#303.8c347a59` | `definition.locked` carries hash, issue revision, base commit, each required by its schema; the recomputed hash matches, an edit in the store changes it; ID-only hashing fails naming the requirement | `lock.test.ts` (3) | the newest schema's fixture; the recorded event; a claim recomputes the locked hash; R2 edited in `definitions`; the next claim recomputes another; the wrong program `hash-ids-only` |
| AC10 `#303.fd687f1e` | the stop rule: after startup, resume, /clear and an answer, no claim; the same question with an edit, a claim; the tool-call rule fails naming the stop | `stops.test.ts` (2) | turns A to E above; `agent.stop`'s `claim`; the wrong program `claim-on-tool-calls` |
| AC11 `#303.447eb97a` | turning a message into a task adds under 5 ms to the prompt hook, against the merge base | `budgets.test.ts` (2) | the perf lane's task naming #303, valid and running; the timing against a merge-base build, INCONCLUSIVE where it can't count |
| AC12 `#303.323ca6a1` | a drafted check file changed by `python -c` after the lock: the next claim's hash differs, the approved bytes kept by digest, a proposal naming the file; path-only hashing fails | `checkfile.test.ts` (2) | R1's check is the drafted file; a control claim; `python3 -c` as an allowed Bash call; the next claim; `evidence.read`; the `*.proposed` event; the wrong program `hash-check-paths` |

## What this suite could not encode

- **"The claim's checks run the approved bytes."** No gate runner (#29) runs checks yet, so the suite reads only that
  the hub keeps the approved bytes by digest and that the locked definition names them, never a run of them.
- **The issue's revision.** `issue_rev` is required and must be present, but its value isn't asserted: the issue says
  "the issue's revision" without saying what a message handle's task carries, or how a test source's reading gives one.
- **"Every attempt on the task shares it"** and **"it changes after the lock only through a dispute you answer"** are
  Scope and Fields with no criterion. Only AC4's "no definition.revised" touches them.
- **The early question's wording and options** (AC5), and whether an answer of "no" drops what the outsider added.
- **The stop judge (#82) and the gate runner (#29) citing the rule**: only the rule's reading on `agent.stop` is read.
- **The acknowledgement in one line and the session's line showing the queue** (the design's When) are not read.
- **Codex and other agents.** Every session is Claude Code's.
- **A message typed mid-turn that Claude Code later also submits as a prompt** is not replayed; the base already reads
  the queue and the prompt as one message.

## Files

- `helpers.ts`: temp worlds (a home, a repository with the drafted check, the drafts and work-source files), the hub
  as a process, `events.read`, sessions, payloads and transcripts, deep-hook runs and their decisions, the record
  readers (`expectTask`, `expectNoTask`, `lockedFor`, `stopsOf`, `recomputedAt`), `deep inbox answer`, and `verdict`,
  `failureOf`, `Inconclusive`.
- `fixtures/agent.mjs`: each session's Claude Code stand-in, the parent of that session's deep-hook runs.
- `days.test.ts` (AC1), `midturn.test.ts` (AC2, AC8), `rename.test.ts` (AC3), `survive.test.ts` (AC4),
  `outside.test.ts` (AC5), `origins.test.ts` (AC6), `first.test.ts` (AC7), `lock.test.ts` (AC9), `stops.test.ts`
  (AC10), `budgets.test.ts` (AC11), `checkfile.test.ts` (AC12).
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit, trimmed to each test's failing assertion.

[What done means, fixed at the start]: ../../../docs/technical-design.md
[An agent says it's done]: ../../../docs/technical-design.md
[The contract (kernel)]: ../../../docs/technical-design.md
[Threats, and what stops each one]: ../../../docs/technical-design.md
[What each agent gives us]: ../../../docs/technical-design.md
