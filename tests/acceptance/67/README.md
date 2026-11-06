# Acceptance tests for #67: workspaces, a home for work outside a repo, with state sources

Written blind by a job that saw only the issue, the design and the base commit `d722ba3d`, and nothing of any work on
#67. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

What was read:

- Issue #67: its Scope, 11 acceptance criteria, Proof and Depends on.
- `docs/technical-design.md`: Work outside a repo; Checks for work beyond code; the Extension API block; the Hub slots
  table's State source row; How runs become one of five verdicts; Plans before acting; Dogfooding.
- At the base: `packages/verdicts` (`key`, `staleReason`, `markStale`), `packages/contracts/schemas/verdict.made@1.json`,
  `packages/conformance/src/slots`, `packages/extension-host/src/host.ts` (the kits at install, project packages, views
  and commands), `packages/asks` (`CANT_UNDO`, plans), `packages/hub/src` (`ask-tasks.ts`, `core.ts`, `gate-runner.ts`,
  `paths.ts`) and `packages/checks-command`.
- Sibling suites for their conventions: `tests/acceptance/322` (`hub.ts` here is cut down from its helpers), `331`, `349`,
  `68`, `1014` (a hub plant) and `1097` (the timing rule).

## Run

```sh
npm ci                                # once
npm run build --workspaces            # the hub and the deep CLI the tests start
cargo build --locked -q -p deep-hook  # target/debug/deep-hook, which every hook runs
npx vitest run --root tests/acceptance/67 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/67/tsconfig.json
```

Node 24.22.0. No network, no model, no paid call. `HOME` is a temp folder for every process, folders are under
`/tmp/dh67-*`, and every process is stopped by its PID. The suite was never run green: at the base the surface does not exist. Expect each hub file to take under a minute
and the suite about two minutes, so it belongs on `scripts/lanes.mjs`'s one-at-a-time list; the implementer adds it.

## The surface under test

The issue names `deep.registerStateSource`, `state-source@1`, `~/.deepbuild/workspaces/` and `verdict.made`, and no code
API for the rest, so these tests define the smallest one they need. Each new piece is reached lazily or through a
process, so each test fails on its own at the base. Everything else is the base's own: the hub, deep-hook, `deep inbox
answer`, the `events.read` and `changes.read` calls, `runKit`, `slotKits`, the asks core, project trust.

### `deep workspace`, a CLI over the hub

Each command runs against the running hub as the cli role, exits 0 and prints one line of JSON; a refusal exits non-zero
and says why on stderr. No command asks a question.

```text
deep workspace new <topic> [--folder <path>]   {"id":"<project id>","folder":"<real path>","name":"<topic>"}
deep workspace move <id> <folder>              {"id":"<same id>","folder":"<real path>","name":"<topic>"}
deep workspace revert <id> <commit>            {"commit":"<the new head>"}
deep workspace diff <id>                       {"diffs":[{"touch":"web-1","item":"port","was":80,"now":8080}]}
deep workspace drift <id>                      {"drifted":["web-1"],"stale":["verdict:…"],"reran":["<check>"]}
```

- `new` makes a git repo with a first commit at `<root>/workspaces/<anything>` or at `--folder`, and writes
  `.deepbuild/workspace.json`. It commits with no git identity set up. A workspace is trusted by being made: its checks
  run with no trust question, since a topic makes one with no question.
- `<id>` is the project id: the `project` of every event a session in the workspace records, in place of the repo hash.
- `revert` undoes one commit, as a new commit on top.
- `diff` compares each touch's reading now with what was read when the newest definition in the workspace locked, through
  each touch's source's `compare`. `was` and `now` are the item's values; a `git` item is a path, and `was` and `now` on one
  aren't read.
- `drift` reads every touch now, marks stale each verdict whose pinned digests differ, and runs again the checks whose
  `reads` name a touch that drifted, on the claim's commit, carrying the others' results. A hub timer may call the same
  thing; the tests use the command, to be deterministic. The check names are as `run.started` names them.

### What a workspace names, and what a check reads

`.deepbuild/workspace.json` holds `{ ..., "touches": [...] }`. A touch is `{ "id", "source", ...settings }`:

- `{ "id": "files", "source": "git" }`: the workspace's own files. Its items are paths.
- `{ "id": "web-1", "source": "host", "log": "/abs/path" }`: a host's change log, one JSON line per change,
  `{"id":"c-1","item":"port","value":80}`. An item's value is the last line naming it. A host elsewhere comes with hosts;
  a log on this machine is what the tests can hold.

A requirement of a definition may name `reads: ["web-1"]`, the touches its check reads. A check runs sandboxed and can't
open the log, so **the check's checkout holds `.deepbuild/state/<touch>.json`, `{ "<item>": value }`**, the reading whose
digest its verdict pins. The verdict's `key.state_digests` holds one SHA-256 for each touch its checks read; one reading
gives one digest, whichever verdict read it.

The reading is pinned when the definition locks, for every touch. A check's run on the base commit reads the pinned
reading, not today's. Otherwise a check of state couldn't be proven: `free_gb >= 200` passes at 240 GB today on the base
commit too, and "a fix that also passes on the base commit" is INVALID.

### What the kernel is handed

`DEEP_HUB_TEST_DRAFTS` as #303 has it, with two more fields on a handed definition for a task that lands in a new
workspace, what the drafting job wrote: `files` (`{ "<path>": "<text>" }`, written and committed before the lock) and
`touches`. And on a requirement, `reads`.

### The record

`workspace.created@1`, core only, its data `{ workspace: "<project id>", folder, topic, task_ref: string | null }`.
Moving one may record another kind; the tests don't read it. `DEEP_HUB_PLANT=state-left-out-of-key` is a planted program:
each workspace verdict's `state_digests` is `[]`, so its key is only the commit, document revisions, check digests,
environment and tools (`packages/hub/src/plant.ts`, as #1014's).

### `state-source@1`

```ts
// @deepbuild/conformance, exported from its index; slotKits() ships the kit, packages/contracts/slots/state-source@1.json its fill
export interface StateItem { id: string; value: JsonValue }
/** `changed` is empty when the item holds what's expected. */
export interface StateDiff { item: string; changed: { what: string; was: JsonValue; now: JsonValue }[] }
export interface StateChange { id: string; item: string; was: JsonValue; to: JsonValue }
export type StateUndo = { plan: PlanInput } | { cannot: string };   // PlanInput: @deepbuild/asks's { steps, diff }
export interface StateFixture {
  /** A fresh fixture: read, compare and undo answer from it from now on. Answers the changes to try. */
  start(): StateChange[] | Promise<StateChange[]>;
  /** The world makes this change to the fixture. */
  make(change: StateChange): void | Promise<void>;
  /** Carries out the plan undo gave for this change, on the fixture. */
  run(change: StateChange, plan: PlanInput): void | Promise<void>;
}
export interface StateSource {
  read(): StateItem[] | Promise<StateItem[]>;
  compare(item: StateItem, expected: JsonValue): StateDiff | Promise<StateDiff>;
  undo(change: StateChange): StateUndo | Promise<StateUndo>;
  /** A read of a host or an account can be held to a kit only on a fixture of its own, so every source brings one. Only the kit calls it. */
  fixture: StateFixture;
}
export interface StateSourceFill extends SlotFill, StateSource { slot: 'state-source@1'; name: string }
```

The kit, for each change `start()` answers: reads, `make`s the change, and reads again, failing naming the item when
the item didn't change; `compare`s the new item with the old value, failing naming the item when the diff is empty; then
`undo`. A `{ cannot }` ends the case. A `{ plan }` is `run` and read again, failing naming the change's `id` when the
reading isn't the first one, or when `run` throws. A kit needs at least one fixture to run; the fixed part may be one
case that walks every change.

### The extension host

```ts
// @deepbuild/extension-host
deep.registerStateSource(name: string, source: StateSource): void   // API entry, hub-slots.json row
// Manifest key `state_sources: string[]`: the names it registers. Install runs the kit on each, wherever the package
// will run, its functions staying with the package as an environment's do; a FAIL refuses the install, the error
// carrying the failing case's message; Installed.kits holds { slot: 'state-source@1', fill: name, verdict }.
interface ExtensionHost {
  /** A live state source by its registered name. */
  stateSource(name: string): Promise<Omit<StateSource, 'fixture'>>;
  /** You are in this project: its packs, as `.deepbuild/packs.json` names them, install and load if you trust it. An untrusted project's stay out: none installed, none run. */
  enterProject(folder: string): Promise<{ trusted: boolean; views: ProjectView[] }>;
  leaveProject(folder: string): Promise<void>;
  /** What the app shows now: the views and commands of the project you're in. */
  projectViews(): ProjectView[];
}
interface ProjectView { name: string; extension: string; commands: { name: string; action: string }[] }
```

`.deepbuild/packs.json` is `{ "packs": ["<folder in the project>", ...] }`, for a repo or a workspace alike.

### `@deepbuild/workspaces`, a new package

```ts
// packages/workspaces/src/index.ts
/** The state sources DeepBuild ships first, as fills, each with its fixture: named git, host, api and document. */
export function shippedSources(): StateSourceFill[];
/**
 * The plan of a change through a state source: `step`, with `undo` the first step's `does` of what `source.undo(change)`
 * answers, or null when it answers `cannot`, which the asks core shows as "can't undo".
 */
export function changePlan(
  source: Pick<StateSource, 'undo'>,
  change: StateChange,
  step: { does: string; changes: string[]; public: boolean; cost: number },
): Promise<PlanInput>;
```

## What the tests hold the pieces to

- **AC1, Proof** (`loop.test.ts`): a weekly report in a workspace. The definition locks in the workspace's project; a
  report stating 1250 where the `sales` host holds 1240 is FAIL and sent back naming R1 and its check; a dependency waits
  on your answer; the fixed report passes on the workspace's commit, one digest in its key; `changes.read` is its
  receipt. Then its history, a state-source diff and a revert, on the same run.
- **AC2** (`revert.test.ts`): a commit that rewrote a definition with CRLF endings, took a script's run bit, deleted a
  note and added a script, with a later commit on top. Reverted, the tree is what it was, byte and mode, with the later
  commit's file; both commits stay in the log.
- **AC3** (`diff.test.ts`): a setting and a file changed before the lock aren't named; those after it are, on every read.
- **AC4** (`sources.test.ts`): `changePlan` on a real source's `cannot`, raised through the asks core: the card and the
  record say "can't undo"; an undoable change's plan gives its undo.
- **AC5** (`sources.test.ts`): the sound package installs with the kit PASS, the kit having run the undo of `set-port` on
  the fixture and not `purge-archive`; the live settings file is untouched. The plant calling `purge-archive` undoable
  is refused, naming it, and isn't installed. `runKit` agrees on both. The four shipped sources pass.
- **AC6** (`drift.test.ts`): with nothing changed a drift marks nothing. web-1 drifts: the verdict reading it goes stale,
  the one reading only web-2 doesn't, and one run starts, of the check reading web-1.
- **AC7** (`drift.test.ts`, `sources.test.ts`): digests in the key; the schema refuses a key without them, naming the
  field; two verdicts on one commit differ in `state_digests` alone; a reading that fails the check gives FAIL, so the PASS isn't reused. The
  plant, on a second hub, fails the same judge.
- **AC8** (`outside.test.ts`): a question in a plain folder makes nothing. "free 200 GB" opens a task in a new workspace
  under `~/.deepbuild/workspaces/`, no ask raised, with the drafted check; at 150 GB the stop is sent back naming it; at
  240 GB the verdict is PASS.
- **AC9** (`packs.test.ts`): an untrusted project's pack isn't loaded, offers no action and starts no process. Trusted, its
  view and command show while you're in it and go when you leave; revoked, it stops.
- **AC10** (`budgets.test.ts`): five runs of `deep workspace new`, by #304's rule. Load past the core count, or another
  machine, is INCONCLUSIVE.
- **AC11** (`sources.test.ts`, `drift.test.ts`): the plant keeping its first read is FAIL on `runKit` and refused at install,
  naming `port`. The verdict pinned to the shipped host source goes stale on the change.
- **Scope lines** (`landing.test.ts`, `targets.test.ts`): a folder you pick; two workspaces on one topic are two
  projects; a work item with no repo lands in a new workspace, and a move keeps its id, files and history; a target's
  rename is followed, and offered as one proposal for the two requirements naming it, the definition unchanged.

## Readings where the issue leaves a choice

- **A source brings its fixture.** The design's `read()` takes nothing, and a kit can't change a real host, so "the fixture"
  of AC5 and AC11 can only be the source's. A kit that handed the source a fixture of its own would know only one
  domain. `fixture` is the one member past `{read, compare, undo}`.
- **"No undo"** in AC4 is `undo` answering `cannot`, the design's `plan | cannot`.
- **AC7's schema half passes at the base.** `verdict.made@1` already requires `state_digests`, and the engine's `key`
  already carries `claim.state`, so that test isn't credited to this work. The hub half is what fails: it pins nothing.
- **AC11's "real source"** on a hub is the shipped `host` source. A plug-in on a real hub runs sandboxed and can't read a
  settings file, so the plug-in half runs on a host in this process, with the package on a release.
- **AC10's merge base** has no workspaces, so nothing is compared, as in #68. The figure is held on `deep workspace new`
  end to end, what you'd wait for.
- **The ask in AC1** is `npm install csv-parse`, a dependency your rules decide, the same path a repo's goes down. No
  package is installed: the test plays the agent and runs nothing.
- **How the agent learns the workspace's folder** in AC8 is left open; the test reads it from `workspace.created`.
- **A rare race at base:** a stop can get its allow before its claim's send-back lands, which then rides with the next
  stop (`outside.test.ts`). `loop.test.ts` holds the first stop to the send-back, as #322 does.

## Not tested, and why

- **"The agent keeps what it builds there, as code where it can"** is a model's habit. No program decides it, and a test
  would only script the agent.
- **"A person never needs to know it's a git repo, or have git installed"** is #1349, still open. The tests hold the part
  that reaches this issue: no git identity is needed and no command asks anything. They use git to read the workspace,
  and don't run with git off the `PATH`. A topic (#1342) reaches these tests as `deep workspace new <topic>`.
- **A plug-in state source in the platform sandbox,** and the design's "a read past its grant": no criterion names it,
  and a sandboxed source's way to its host is a grant these tests have no case for.
- **"The app shows their views"**: AC9 holds `projectViews()`, what the app reads. Drawing them in the app is the shell's.

## Wrong programs

Each test fails at the base (`BASE-FAILURE.txt`) but AC7's schema test, named above, and on these: a workspace with no project id of
its own; a revert that resets, or restores only what it re-renders (AC2); a diff against the workspace's making or against
the last read (AC3); a plan that keeps a default undo (AC4); a kit that takes a plan on trust, or a kit that reads a
cached value (AC5, AC11); a drift that marks every verdict in the workspace, or re-runs every check of the claim (AC6); a
key of the five named fields, the plant (AC7); a workspace for every session, or a task with no check (AC8); packs that
load before trust, or stay on after you leave or after trust is taken back (AC9).

## Files

- `hub.ts`: the hub, deep-hook sessions, `deep`, the record read back, the criteria's IDs.
- `host.ts`: an extension host in this process, on a release.
- `fixtures/agent.mjs`: the session's Claude Code process, copied from #322's.
- `fixtures/settings-source/`: the state source, with its two plants. `fixtures/runbook/`: the test pack.
- `loop`, `revert`, `diff`, `sources`, `drift`, `outside`, `packs`, `budgets`, `landing`, `targets` `.test.ts`.
- `BASE-FAILURE.txt`: the run at the base.
