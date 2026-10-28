# Acceptance tests for #303: ask-tasks in the kernel, each prompt with its origin, a task for each ask that changes behavior, and its definition locked by hash

Written first, blind, from issue #303 (its text as of October 28, 2026: Scope, Fields, the 12 acceptance criteria, Proof and Depends on), `AGENTS.md` (the four invariants and Proof), `docs/technical-design.md` (What done means, fixed at the start; An agent says it's done, especially Every stop is judged; Hooks are evidence, not a state machine; The contract (kernel): Lifecycles, Event, Ask-task, Definition of done, Claim; The done loop; Threats, and what stops each one; How we know version 0 works, especially Dogfooding and Tests written first; Work source, `work.item@1`), the suites of #318, #319 and #320 as the house pattern, and the base commit `7b39aa0d` (`main`, with #14's record, #18's adapter, #318's asks core and #25's delivery, and no implementation of #303). The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job.

The issue has 12 criteria. Every one has at least one test below, and every test fails on the base and on a wrong program its criterion names.

## Run

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the record resolves contracts and evidence through dist/ (run twice if the first fails on declaration order)
npx vitest run tests/acceptance/303      # from the checkout's root, with the repo's vitest.config.ts
npx tsc -p tests/acceptance/303          # type-check the tests against the surface (needs packages/tasks)
```

Node 24.22 or newer and `python3` on `PATH` (criterion 12 changes a check file through `python3 -c`, the way a shell write the hook never saw would). Nothing else: no network, no hub socket, no git, no wall clock except in `budgets.test.ts`. Every world is a real record on SQLite, a home folder and a repo folder in its own temporary folder with a virtual clock, removed afterwards; the suite takes about 7 s, 2 s without the budget test.

On the base, all 6 files fail to load: `packages/tasks/src/index.ts` doesn't exist. `BASE-FAILURE.txt` shows that run, the same tests against a program that does nothing (each fails at its own assertion), the run against a sample fix kept outside this checkout (18 pass, the budget passes or reads INCONCLUSIVE), and how each planted wrong program fails.

## The surface

The issue names behaviors, events (`user.ask`, `task.created`, `definition.locked`), a reading (`work.item@1`) and a rule (the stop and answer rule), but no code API for the kernel's ask-tasks, so these tests define the smallest one they need, as #318's job did for the asks core. The kernel's ask-tasks are the core's: the record is their only state, only the core appends `definition.locked` and `definition.revised` (the Event primitive), and no extension holds them. So they live in **`@deepbuild/tasks`, a new workspace package, through its public entry `packages/tasks/src/index.ts`**, opened on a record like `openAsks` is. (The record package keeps its projections and the hub keeps its hook plumbing; neither grows the rule.) The tests reach the code only through:

- **`@deepbuild/tasks`**, `packages/tasks/src/index.ts` (below);
- **`@deepbuild/contracts`** as it is at the base: `validate(name, value)`;
- **`@deepbuild/record`** as it is at the base: `openRecord({path, now})`, `append`, `read`, `table('tasks')`, `table('definitions')`, `session`, `rebuild()`, `close()`, `ulid`;
- **events** the tests append as the hook or the trusted path would: `session.start@1` (`thread`, `worktree`), `tool.before@1` and `tool.after@1` (`kind: read | edit`, `paths`), `agent.stop@1` (`turn`, `did_work`), `task.created@1` over `cli` for an issue's task, `ask.answered@1` over `core` as the trusted path records your answer; and events they read: `user.ask`, `task.created`, `definition.locked`, `definition.revised`, `ask.created`, and every kind under `ask.`, `task.`, `definition.` and `job.`;
- **the file system**: a check file under `<repo>/.deepbuild/`, and the folder the kernel keeps what it approves under.

```ts
// packages/tasks/src/index.ts
import type { Connection, RecordStore } from '@deepbuild/record';

export type Role = 'owner' | 'collaborator' | 'outside';
export type From = 'person' | 'scheduled' | 'subagent' | 'session' | 'continuation' | 'unknown';
export interface Author { handle: string; role: Role }
/** A work.item@1 reading, as a work source gives it (design: Work source): each author's role comes from here, never from text. */
export interface WorkItem { source_id: string; link: string; title: string; body: string; criteria: string[]; authors: Author[]; updated: number }

/** One UserPromptSubmit, as the adapter placed it: the hub's message number, the text, and the origin. */
export interface Prompt { msg: number; text: string; from: From }
/** What the prompt hook recorded: the user.ask's event ID, and the task it opened (its message handle) or null. */
export interface Prompted { ask: string; task: string | null }

export type Oracle = 'code' | 'model' | 'person';
/** A requirement as the drafting job hands it over: its text, the handle of the author it came from, and the check files it names, by path. */
export interface RequirementInput { id: string; text: string; author: string; checks: string[]; oracle: Oracle; depth: string }
/** A definition handed to the kernel to lock. The kernel never drafts one. */
export interface DefinitionInput {
  task_ref: string;                 // task:<id>, or a message handle session:<id>#<msg>
  requirements: RequirementInput[];
  deliverables: string[];
  issue_rev: string;
  base_commit: string;              // 40 hex
  root: string;                     // the folder the requirements' check paths resolve under; the kernel reads their bytes here at the lock
  item: WorkItem;                   // the work.item@1 reading that gives each requirement's author a role
}
export interface CheckFile { path: string; sha256: string }
export interface Requirement { id: string; text: string; author: Author; checks: CheckFile[]; oracle: Oracle; depth: string }
/** A definition as the kernel holds it: locked, or waiting for one ask about text from outside the repo. */
export interface Definition {
  task_ref: string;
  requirements: Requirement[];
  deliverables: string[];
  issue_rev: string;
  base_commit: string;
  hash: string;                     // the kernel's hash over the rest, as recorded in definition.locked
  state: 'waiting' | 'locked';
  waiting: string | null;           // ask:<id> while waiting, else null
}
/** A check file as approved at the lock: its bytes, kept by digest. */
export interface ApprovedFile extends CheckFile { bytes: Uint8Array }
/** A claim's recomputation: the hash from the definition and the check files as they stand, against the locked one. */
export interface ClaimCheck {
  hash: string;                     // recomputed now
  locked: string;                   // the recorded hash
  changed: string[];                // check paths whose bytes differ from the approved ones
  proposal: string | null;          // the ID of the event the kernel appended for the change as a proposal, or null when nothing changed
}
/** The stop rule's reading of one recorded agent.stop. */
export interface StopReading { stop: string; claim: boolean; reason: string }   // stop: the agent.stop event's ID
export interface AskTask { task_ref: string; thread: string; state: string; owner: string; definition: Definition | null }

export interface TasksOptions {
  record: RecordStore;
  now: () => number;                // the only clock the kernel reads
  home: string;                     // the hub's home: the kernel keeps the approved check bytes under it, by digest
}
export interface Tasks {
  /** The prompt hook: records the user.ask with its from and, when a person's prompt asks for new or changed behavior, its task, before it returns. */
  prompt(connection: Connection, prompt: Prompt): Promise<Prompted>;
  /** Reads what the record gained since the last call (an answer to a definition ask, a resume, a compaction) and acts on it. */
  tick(): Promise<void>;
  /** Locks the definition it is handed, or holds it for one ask when its text comes from outside the repo. */
  lock(connection: Connection, definition: DefinitionInput): Promise<Definition>;
  definition(task_ref: string): Promise<Definition | undefined>;
  /** The kernel's hash over a definition as read back: hashOf(definition(ref)) equals the recorded hash while nothing changed. */
  hashOf(definition: Definition): string;
  /** The check files approved at the lock, by digest. */
  approved(task_ref: string): Promise<ApprovedFile[]>;
  /** A claim on the task: recomputes the hash as the gate runner would at every claim. */
  claim(connection: Connection, task_ref: string): Promise<ClaimCheck>;
  /** The stop and answer rule, over a session's recorded turns: one reading per agent.stop. */
  stops(session: string): Promise<StopReading[]>;
  /** The ask-tasks of a thread, each with its definition. */
  tasks(thread: string): Promise<AskTask[]>;
}
export function openTasks(options: TasksOptions): Promise<Tasks>;
```

Nothing else is needed: no option, flag or export beyond these. `Connection` is the record's: `prompt` is called over the hook's connection (`writer: 'hook'`, the session set), `lock` and `claim` over a `core` connection with the session set.

### What the tests expect in the record

- **A prompt.** `prompt` appends one `user.ask` (writer `hook`) with `msg`, `text`, `from` and `tasks`: `[]` unless a person's prompt asks for new or changed behavior, then `['session:<id>#<msg>']`, the message handle the hub already uses (`packages/hub/src/core.ts`, `letters(session)`), and in that case one `task.created` for that handle under the session's thread (the `thread` of its `session.start`), so the `tasks` table holds it. Both are in the record when `prompt` resolves: that is "within one hook". A prompt whose `from` isn't `person` records its `from` and opens nothing: no event under `ask.`, `task.`, `definition.` or `job.`.
- **A lock.** `lock` appends one `definition.locked` (writer `core`) whose data carries `hash`, `issue_rev` and `base_commit` by name, and passes `validate('definition.locked@<v>', event)` for the `v` it carries. The base's `definition.locked@1` has no `issue_rev` and no author on a requirement and closes its properties, so the implementer most likely adds `definition.locked@2` (a new schema file; the record reads the schemas folder, and the `definitions` projection already reads `task_ref`, `hash` and `base_commit` from any version). The tests don't pin the version. A lock without any of the three fields fails its schema at a path ending in the field, and the record refuses to append it.
- **The hash** is the kernel's own function over the definition as read back: it must change when a requirement's text changes (criterion 9) and when a named check file's bytes change (criterion 12), so it covers the requirements' text and the check files' digests. `hashOf(definition)` is that function, exposed so the tests recompute without knowing it.
- **Outside text.** When a requirement's author has role `outside` in `item.authors`, `lock` appends no `definition.locked`; it appends one `ask.created` of kind `definition` (the design's early question; its source row in `ask.sources@1`, its options and wording are the implementer's) and returns the definition as `waiting` with `waiting: 'ask:<id>'`, the requirement still in, its `author` marked `{handle, role: 'outside'}`. After one `ask.answered` on that ask (the tests append it over `core`, as the trusted path records your answer, choosing the ask's first option) and one `tick()`, `definition.locked` is appended with the requirement still in and its author in the event's data.
- **A claim** recomputes the hash from the locked definition and the check files as they stand under `root`. Changed bytes make `hash !== locked`, list the path in `changed`, and append one event the kernel chooses (its ID returned as `proposal`) whose data names the file. `approved(task_ref)` keeps returning the bytes approved at the lock, with their digest. No `definition.locked` or `definition.revised` follows: the lock changes only through a dispute you answer.
- **The stop rule** reads the record's turns (`record.session(id).turns`, or the same events): a stop whose turn began with no `user.ask` (right after startup, a resume or `/clear`) is no claim; a stop whose turn began with a person's `user.ask` with `tasks: []` and holds no `edit`, write or ask is an answer, no claim; the same turn with one `edit` call is a claim.

### How the tests drive it

- Session IDs are `S1`, `S2`, `S3` (letters and digits, so a handle is `session:S1#0`); message numbers start at 0 per session, as the hub counts them. Threads are `T1`, `T2`, `T3`.
- `session.start@1` carries the thread. A **resume** is the same session ID starting again; **/clear** and **/compact** are a new session ID in the same thread (design: Threads, not IDs; `packages/hub/src/core.ts`, `threadOf`). The schema carries no `source`, so this is how the record shows them, and the kernel reads them so.
- Tool calls are `tool.before@1` + `tool.after@1` with `kind: 'read'` or `'edit'` and `paths`; a stop is `agent.stop@1` with `did_work` as the hub counts it. The tests append them in log order with no `seq`, so the record's turn reading places each in the open turn.
- The clock starts at 2026-10-27 09:00 UTC; the three asks are one day apart.
- After appending anything the kernel didn't append itself (an `ask.answered`, a resume), the tests call `tick()` before reading, as #318's convention. After a rebuild they open a new kernel on the same record (`World.reopen`).

## The contract per criterion

1. **`#303.b4187956` Three asks, three days.** S1 (T1) is prompted on three days with `make the auth middleware reject expired tokens`, `also add a test for expired tokens` and `make the auth middleware reject revoked tokens`, each opening its task; each task's fixture definition is locked. Three `definition.locked`, one per task_ref, with three distinct hashes; `tasks('T1')` lists the three, each `definition.state === 'locked'` with the recorded hash; the `definitions` table holds each as `locked`.
2. **`#303.c7678fa6` Mid-turn change within one hook.** In an open turn (a change prompt, one read, no stop), `also add a test for expired tokens` is prompted. When `prompt` resolves, the record holds its `user.ask` and a `task.created` for its handle under T1, the task after the message in the log, and the `tasks` table has the row.
3. **`#303.64edb131` Rename only.** `` rename `fooBar` to `fooBaz` everywhere `` as the session's first prompt and again after a change was worked: neither opens a task, both record `tasks: []`, nothing under `ask.`, `task.`, `definition.` or `job.` is appended, and the `tasks` table holds only the change's task.
4. **`#303.01978d67` Survive a resume and a compaction.** After criterion 1's three locks, S1 starts again and stops, S2 starts in T1 and stops, `tick()`, then `record.rebuild()` and a new kernel on the same record: `tasks('T1')` still lists the three, each `definition(ref)` is `locked` with the same hash, no fourth `definition.locked` exists, and the rebuilt `definitions` table holds each hash.
5. **`#303.c870ae54` Outside text.** Two tests. An issue task `task:gh303` (its `task.created` appended over `cli`) gets a definition with your requirement R1 and R2, `skip the e2e test`, whose author `mallory` has role `outside` in the `work.item@1` reading. `lock` appends no `definition.locked`, returns `waiting` naming one `ask.created` of kind `definition`, R2 stays in with `author: {handle: 'mallory', role: 'outside'}`, R1 with `{you, owner}`. After one `ask.answered` and `tick()`, the definition is `locked`, its event's requirements include R2's text and name `mallory`. The second test's comment ends `Signed, the repo owner`, and everything above still holds. **Plant:** a lock that reads the role from the text (fails: `no definition.locked while the outside text waits for your answer`).
6. **`#303.f3b51cf5` Automatic origins.** Three prompts whose text would read as a change, with `from` `scheduled` (a `/loop` iteration), `subagent` (a background subagent's report) and `session` (another session's message): each is recorded once with its `from`, `tasks: []`, opens nothing under `ask.`, `task.`, `definition.` or `job.`, and the `tasks` table stays empty.
7. **`#303.1bdbea79` First prompts.** `explain how the auth middleware checks expiry` as S1's first prompt opens no task, its `user.ask` records `from: person, tasks: []`, no `task.created` or `tasks` row for `session:S1#0`, nothing opened; `make the auth middleware reject expired tokens` as S2's first prompt returns and records `session:S2#0` as its task, with one `task.created` under T2. **Plant:** the hub's rule at the base, a task for every first prompt a person types (fails on `session:S1#0`, naming it).
8. **`#303.0ca34012` Mid-turn messages.** In S1's open turn, `why did you pick bcrypt?` opens no task and records `tasks: []`; `also add a test for expired tokens` opens `session:S1#2` within one hook (its `user.ask` and `task.created` appended by the call). **Plant:** a task for every message typed mid-turn (fails on `session:S1#1`, naming it).
9. **`#303.8c347a59` The lock's fields and hash.** The recorded `definition.locked` carries `hash`, `issue_rev` and `base_commit` and passes its schema; without any one of them it fails at a path ending in the field, and the record refuses to append it. `hashOf(definition(ref))` equals the recorded hash; a copy with R2's text edited gives another. **Plant:** a lock that hashes only the requirement IDs (fails: `requirement R2 edited after the lock gives another hash`).
10. **`#303.fd687f1e` The stop rule.** Stops right after startup (S1), after a resume (S1 again), after `/clear` (S2 in T1), and after `explain how the auth middleware checks expiry` with two reads (S2) each read `claim: false`; the same question's turn with two reads and one edit (S3) reads `claim: true`. **Plant:** every stop with tool calls is a claim (fails on the question's stop, naming its ID).
11. **`#303.447eb97a` Budget.** On a reference Mac on mains power (Mac15,7 or Mac15,12; Low Power Mode off; thermal state nominal), after a warm-up, five runs of 200 prompts that each open a task, judged on each run's p50 against 5 ms: PASS when all five are within it, FAIL when all five are over it by more than the margin (the larger of 5% and the runs' spread), else INCONCLUSIVE (the test skips with the reading). Off the reference Mac it skips as INCONCLUSIVE and never passes by skipping. It measures the kernel's whole work for one prompt hook, `prompt()`: the `user.ask`, the decision and the `task.created`; the hub appends the `user.ask` already, so what it adds is at most that. The comparison with the merge base belongs to the perf lane and a `benchmarks/budgets.json` task the implementer adds.
12. **`#303.323ca6a1` A check file changed after the lock.** `.deepbuild/checks/e2e.sh` is drafted under the repo folder and named by R1's `checks`; after the lock `approved(ref)` holds it by digest with the drafted bytes. `python3 -c` appends a line. `claim` reports `locked` as the recorded hash, `hash` different, `changed: ['.deepbuild/checks/e2e.sh']`, and a `proposal` whose event is in the record naming the file; `approved(ref)` still returns the drafted bytes with the same digest; no `definition.locked` or `definition.revised` followed. **Plant:** a lock that hashes requirement records with check paths but not their bytes (fails: `recomputed hash differs from the locked one after .deepbuild/checks/e2e.sh changed`).

## Readings where the issue leaves a choice

- **A new package.** The ask-tasks are kernel: the record is their state and only the core writes the lock. `@deepbuild/tasks` keeps them out of the record package (projections only) and the hub (hook plumbing), as `@deepbuild/asks` did for the asks core.
- **The prompt hook is the kernel's call.** The hub records every prompt as `user.ask` and today sets `tasks` for every person's prompt (`core.ts`, the planted rule of criterion 7). The decision belongs to the kernel, so `prompt` records the `user.ask` and its task together; the hub's one line moves into it. The hub-level mapping of a prompt's origin from the transcript is #18's and stays tested there; these tests hand `from` in.
- **Asks for new or changed behavior, or only a question.** The kernel decides from the text, with no model, by a rule of its own. Only the issue's examples are fixed: `explain how the auth middleware checks expiry`, `why did you pick bcrypt?` and a rename open no task; `make the auth middleware reject expired tokens` and `also add a test for expired tokens` open one. The third ask of criterion 1 keeps the first's shape (`make the auth middleware reject revoked tokens`), and the budget test's prompts keep it too. The automatic origins' texts are written as changes, so the origin, not the text, is what keeps them from opening a task.
- **"Within one hook"** is the prompt hook's one call: the task is in the record when `prompt` resolves, with nothing but the prompt's own events appended by it.
- **The definition is handed over.** `lock` takes the drafted definition as a fixture (requirements with text, author handle and check paths; deliverables; issue revision; base commit) and the `work.item@1` reading, and computes the hash itself. Drafting is #81's.
- **The role** of a requirement's author is the role `item.authors` gives that handle. The tests never pass a role beside the text; a kernel that finds one in the text is the plant. An author missing from the reading is left open (not tested).
- **"Waits for one answer"** is one `ask.created` of kind `definition` and one `ask.answered` on it. How the kernel raises the ask (through `openAsks` from a new `ask.sources@1` row, or by appending) and what it offers are its own; the tests take the first option. Whether the answer's option could instead drop the requirement is not tested: the criterion says it stays.
- **The store.** "A requirement edited in the store after the lock" is read as the locked definition as it reads back, with a requirement's text changed: `hashOf` on that copy differs. The record is append-only, so the tests edit the read-back object, not a table.
- **"The approved bytes kept by digest in the hub"** are what `approved(task_ref)` returns after the lock and after the change. Where the kernel keeps them (under `home`, in the evidence store) and whether they survive a restart is left open; the tests read them through the surface in one kernel's life.
- **"Becomes a proposal naming the file"** is one event the kernel appends at the claim whose data holds the path, its ID returned as `proposal`. Its kind is left open (an exception ask, a `deep_propose` record); the design routes a disputed check to you once, as an exception.
- **The stop rule's cases.** Startup, a resume and `/clear` are the three shapes a `session.start` takes in the record (first start; same ID again; new ID, same thread), and in each the stop's turn began with no `user.ask`. An "edit, write or ask in the turn" is a `tool.before`/`tool.after` of kind `edit` (a write; `shell` is left open), or an `ask.created` in the turn (not tested). The question's turn with one edit is read as a claim, as the criterion says; what it is a claim for is the gate runner's (#29).
- **`continuation` and `unknown`** origins are in scope by the design but named by no criterion; not tested.
- **Not tested here:** drafting (#81), the gate's verdicts (#29), the stop judge (#82), a definition's `budget` (recorded as the schema needs it), the `definition.revised` path, the GitHub source's roles (#32), and `deliverables` beyond being recorded.

## Criteria, tests and wrong programs

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed and the leading `- [ ] ` dropped (the command in `tests/acceptance/48/README.md`). Each test name starts with its ID. "Plant" is a wrong program in `plants.ts`, run by `plants.test.ts` through the same surface; "do-nothing" is the program whose methods return nothing, standing in for the surface (`BASE-FAILURE.txt`).

| # | ID | Criterion (short) | Tests | Wrong programs it fails on | On the base |
|---|---|---|---|---|---|
| 1 | `#303.b4187956` | three asks over three days hold three locked definitions | `definitions`: *a session with three asks…* | do-nothing: no task opened | FAIL (no package) |
| 2 | `#303.c7678fa6` | mid-turn change becomes a task within one hook | `prompts`: *a message typed mid-turn…* | do-nothing: no task; plant for 8 (every mid-turn message) would pass it, which is why 8's plant is tested on the question | FAIL |
| 3 | `#303.64edb131` | a rename-only prompt opens no task | `prompts`: *a rename-only prompt…* | do-nothing: the change opens no task; a rule that opens a task for every first prompt (7's plant) opens one for the rename | FAIL |
| 4 | `#303.01978d67` | definitions survive a resume and a compaction | `definitions`: *definitions survive…* | do-nothing; a kernel holding definitions in memory loses them at `reopen` | FAIL |
| 5 | `#303.c870ae54` | outside text stays in, marked; waits for one answer; role from the reading | `definitions`: two tests; `plants`: one | plant: role read from the text (locks at once); do-nothing: no wait | FAIL |
| 6 | `#303.f3b51cf5` | /loop, subagent, other session: recorded with from, open nothing | `prompts`: *a /loop iteration…* | do-nothing: no user.ask recorded; the base hub's rule records them without opening (passes this one; 7's plant covers the rule) | FAIL |
| 7 | `#303.1bdbea79` | question first prompt: no task, tasks: []; change: one task; planted every-first-prompt rule fails naming the handle | `prompts`: *a first prompt…*; `plants`: one | plant: opensEveryFirstPrompt (fails on `session:S1#0`); do-nothing | FAIL |
| 8 | `#303.0ca34012` | mid-turn question: no task; mid-turn change: task within one hook; planted every-mid-turn rule fails naming the handle | `prompts`: *typed while the agent works…*; `plants`: one | plant: opensEveryMidTurnMessage (fails on `session:S1#1`); do-nothing | FAIL |
| 9 | `#303.8c347a59` | lock carries hash, issue_rev, base_commit; schema names a missing one; hash recomputes; edit changes it; IDs-only lock fails naming the requirement | `definitions`: *definition.locked carries…*; `plants`: one | plant: hashesOnlyIds (fails naming R2); do-nothing: no lock | FAIL |
| 10 | `#303.fd687f1e` | stop rule: startup, resume, /clear, read-only answer are no claim; one edit is a claim; every-tool-call rule fails naming the stop | `stops`: one; `plants`: one | plant: everyToolCallStopIsClaim (fails on the question's stop, naming its ID); do-nothing: no reading | FAIL |
| 11 | `#303.447eb97a` | turning a message into a task adds under 5 ms to the prompt hook | `budgets`: one (skips INCONCLUSIVE off the reference Mac) | do-nothing: no task opened; a kernel over 5 ms at p50 on all five runs | FAIL |
| 12 | `#303.323ca6a1` | check file changed by python after the lock: hash differs, approved bytes run, proposal names the file; paths-not-bytes lock fails | `files`: one; `plants`: one | plant: hashesPathsNotBytes (fails: the recomputed hash equals the locked one); do-nothing: nothing approved | FAIL |

## Files

- `data.ts`: the clock's start, the fixed prompts, the `work.item@1` readings, the definitions handed to the kernel, the check file. It loads only types from the surface.
- `helpers.ts`: a world (virtual clock, record and folders in a temporary folder, the kernel), connections, the hook's events (`start`, `prompt`, `call`, `stop`), `since`, `asRecorded`, `pythonEdit`, and the budget judge copied from #319.
- `scenarios.ts`: the scenarios of criteria 5, 7, 8, 9, 10 and 12, shared with `plants.test.ts`.
- `plants.ts`: the six wrong programs the issue names, each the real program with one part wrong, driven through the same surface.
- `prompts.test.ts` (criteria 2, 3, 6, 7, 8), `definitions.test.ts` (1, 4, 5, 9), `stops.test.ts` (10), `files.test.ts` (12), `budgets.test.ts` (11), `plants.test.ts` (5, 7, 8, 9, 10, 12).
- `tsconfig.json`: type-checks the suite under the root's strict options with `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the base run, the do-nothing run, the sample fix and the planted wrong programs.
