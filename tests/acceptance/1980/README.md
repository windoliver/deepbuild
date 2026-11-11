# Acceptance tests for #1980: routing replay of the recorded nixpkgs failures

Written first, from issue #1980 ("Routing replay: the ask router replays the recorded nixpkgs failures from a snapshot
kept by hash, one ask per cause": its Scope, its three acceptance criteria and its Proof line, "The snapshot by hash and
the replay's record of causes, asks, fallbacks and defaults. Planted wrong programs that must each fail, naming the
criterion: a router that asks per job, and a snapshot that keeps a maintainer handle."), the design sections it links
and base commit `568adc8f5` ("Merge pull request #2266 …"), by a job that never saw an implementation; none existed, and
no other worktree, branch or pull request was read. The implementing agent doesn't edit these files (AGENTS.md, Proof);
a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test per clause, plus one per planted
program the criteria name.

## What was read

- The issue, live with `gh issue view 1980`.
- `AGENTS.md` (the four invariants, Proof) and `docs/technical-design.md`: How we know version 0 works (the Routing
  replay bullet, Dogfooding and "Who drafts it"); An ask, and your answer getting back (every ask ends with a deadline,
  a fallback and a default; past its deadline an ask goes to its fallback, and for one person the default applies; the
  closed outcome set and its closing events; `ask.sources@1`; `ask.machine@1`, no ask closes twice); the Replay and
  clock rows of Building blocks and Blocks for plug-ins that do real work; Evidence (stored once, named by its
  SHA-256); the Event and Ask-task primitives (`task.created`, a task's `task_ref` and `owner`).
- At the base, only for how the surfaces are driven: `packages/asks` (`openAsks`, `raise`, `tick`, `sources.json`; at a
  deadline the core appends `ask.defaulted`; with no batch schedule every ask shows when raised), `packages/record`
  (`openRecord` with `now` and `evidence`, `read`, `table('asks')`, `rebuild`, `keep`; the asks projection's columns),
  `packages/evidence` (`openEvidenceStore`, `get`, `read` checked against the hash), `packages/extension-host` (#364's
  replay: recordings and the `now` clock), the schemas `ask.created@1`–`@4`, `ask.escalated@1`, `ask.defaulted@1`,
  `task.created@1`, and the suites `318/`, `364/`, `1957/` and `1961/` (README, helpers, conventions). Every expected
  value comes from the issue.

## Run them

From the checkout's root, with the repo's Node (24.22.0):

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces --if-present  # once, if a package's dist is missing
node node_modules/vitest/vitest.mjs run tests/acceptance/1980 --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1980/tsconfig.json
```

No network, no hub, no wall clock, no agent session: each replay runs into a real record on SQLite and a real evidence
store in its own temporary folder (removed afterwards), through the real asks core, on a virtual clock. `globalThis.fetch`
throws while a replay runs, and the replay may call it nowhere. Five replays in all: one per describe block (two in
`routing.test.ts`, one in `deadline.test.ts`, two in `snapshot.test.ts`). `BASE-FAILURE.txt` holds the one run on the base.

## The surface under test

The issue names no module; it is labelled `area:extension`, so the replay is an extension over the core's record, asks
and evidence, never part of the core. **Every name and shape below that the issue doesn't give is this job's
invention**, the smallest surface consistent with the design and the base; the implementer builds exactly these, or a
dispute goes to a blind redraft.

- **`@deepbuild/routing-replay`, a new workspace package, through its public entry
  `packages/routing-replay/src/index.ts`**, which the tests import by that path (as `318/` imports the asks core):

```ts
// packages/routing-replay/src/index.ts
import type { Asks } from '@deepbuild/asks';
import type { EvidenceStore } from '@deepbuild/evidence';
import type { RecordStore } from '@deepbuild/record';

/** The kept snapshot's SHA-256, in lower-case hex: the hash it is kept as evidence by, and the snapshot the replay replays. */
export const SNAPSHOT: string;

/** The virtual clock (#364's clock that tests move): the replay sets it to each evaluation's recorded time. It never goes back. */
export interface VirtualClock { now(): number; set(ms: number): void }

export interface ReplayOptions {
  record: RecordStore;          // the replay's own record, opened by the caller with `now: clock.now` and `evidence`
  evidence: EvidenceStore;      // where the replay keeps the snapshot, by its hash
  clock: VirtualClock;
  plant?: 'router-asks-per-job' | 'snapshot-keeps-handle';   // only tests pass one
}
export interface Replay {
  report: Report;
  asks: Asks;                   // the asks core it routed through, over `record` on `clock.now`, still open
}
/**
 * Keeps the snapshot SNAPSHOT names in `evidence` by its hash, then feeds every evaluation in it, in recorded order: the
 * clock set to the evaluation's `at`, its failures routed (asks through the asks core, fix tasks as task.created, all
 * into `record`), the core ticked. Reads only the kept bytes; fetches nothing and sends nothing anywhere.
 */
export function replay(options: ReplayOptions): Promise<Replay>;
```

  The tests type nothing else from the package. `Report` is the object below; its TypeScript name is free.

- **The snapshot's bytes** are JSON. The package keeps them where it likes (the tests never read its folder); the tests
  read them only from the evidence store the replay kept them in, `evidence.read(SNAPSHOT)` (the store checks the bytes
  against the hash). The fields the tests read (more are the implementation's own, such as the jobs that newly succeed,
  which close an ask; the tests read none of them):

```ts
{
  evaluations: {                       // every evaluation the replay feeds, in recorded order
    id: number;                        // Hydra's evaluation ID
    at: number;                        // its recorded time, ms since the epoch: the virtual clock when the replay feeds it
    failures: {                        // the build records of the jobs failing in it that the replay reads
      build: number;                   // Hydra's build ID
      job: string;                     // the job's name
      maintainers: string[];           // the job's maintainer handles, each a stable placeholder
      merge: { commit: string; owner: string } | null;
                                       // a newly failing job: the merge it came in with, its 40-hex commit and its
                                       // owner (a stable placeholder); null for an inherited failure
      inherited_from: number | null;   // an inherited failure: the build whose failure it inherits, as its build record
                                       // names it (Hydra's "propagated from" build); null for a newly failing job
    }[];                               // exactly one of merge and inherited_from is set
  }[];
}
```

- **A stable placeholder** is `maintainer-<n>`, `n` a decimal number from 1 with no leading zero (`/^maintainer-[1-9][0-9]*$/`),
  the same for one person everywhere in the snapshot. A merge's owner is a maintainer handle too, so it takes the same
  form. "Names no person" is also read as: no string in the snapshot holds an email address (Hydra's build records give
  maintainers as email addresses), so a `git@host:…` URL counts as one.
- **Causes, asks and fix tasks in the record.** A newly failing job's cause is the merge it came in with; an inherited
  failure's cause is the build it inherits from. The router raises one ask per merge through the asks core: an
  `ask.created` **pinned to the merge's commit** (`pinned_to: {kind: 'commit', ref: <commit>}`), to the merge's owner,
  raised while the replay feeds the evaluation, so stamped with that evaluation's `at`. The tests read "the asks the
  router raised" as every `ask.created` pinned to the commit of a merge in the snapshot, except a request the core drafts
  about another ask (its `subject` is that ask). One send-back per cause is one such ask per merge. A fix task is one
  **`task.created` whose `subject` is `ev:<SNAPSHOT>#<build>`**, the build its inherited failures inherit from (the
  evidence handle `ev:<sha256>` with that build as its fragment): one per such build.
- **"Goes to its fallback"**: the ask closes, once, with `ask.escalated` (handed on to its fallback) or `ask.defaulted`
  (the fallback is one person's queue, where the default applies: design, "For one person there is no one above you,
  so the default applies"), stamped at or after its deadline, and its row in the asks table reads `escalated` or
  `defaulted` with the `fallback` its `ask.created` carries. The tests accept either; the report counts both together.
- **The report** (the object `replay` resolves with as `report`):

```ts
{
  snapshot: string;                    // the SHA-256 of the snapshot replayed (SNAPSHOT, or a plant's own)
  weeks: {                             // asks per week across the 107 evaluations, in order
    week: string;                      // 'YYYY-MM-DD', the Monday (UTC) the week starts on
    evaluations: number[];             // the IDs of those of the 107 whose `at` falls in [Monday 00:00 UTC, +7 days)
    asks: { count: number; sample: string };     // the asks the router raised for them
    per_job: { count: number; sample: string };  // what routing per job would send for them: one per newly failing job
  }[];
  owned: {
    reached: { count: number; sample: string };          // owned failures that reached their fallback or default
    sat_past_14_days: { count: number; sample: string }; // the 18 that sat past 14 days
  };
}
```

  Each `count` is a whole number over the `sample` it names (a non-empty string, its wording free). An owned failure is
  a newly failing job (it has an owner, its merge's); it reached its fallback or default when its merge's ask closed as
  `ask.escalated` or `ask.defaulted` in the record as the replay left it. Nothing in the report is a pass or a fail: no
  boolean anywhere, and no key or string `pass`, `passed`, `fail`, `failed`, `ok` (nor a key `verdict`).

### Planted programs (`plant`, each reachable only there; names are this job's)

| Value | Criterion | The wrong program |
|---|---|---|
| `router-asks-per-job` | #1980.dbc0f471 | the router raises one ask per newly failing job instead of one per cause, each pinned to the merge the job came in with, so the GCC 16 evaluation raises 688 |
| `snapshot-keeps-handle` | #1980.e7991d8c | the snapshot the replay keeps, and replays, holds one maintainer handle as fetched instead of its placeholder; it is kept by its own hash, which its report names. The handle need not be a real person's (any string that isn't a placeholder) |

## Criteria to tests

Each criterion's ID is `#1980.<first 8 hex digits>` of the SHA-256 of its text, trimmed and white space collapsed
(`scripts/proof-change.mjs`, `criterionId`, on the live issue body). Each test's name starts with it and says its clause;
each file's head quotes its criterion and says what each test asserts.

| ID | File | Tests | What they assert | Fails at the base because |
|---|---|---|---|---|
| `#1980.dbc0f471` | `routing.test.ts` | 3 | (1) the snapshot holds one evaluation where one merge broke 688 jobs, and the record holds exactly one ask the router raised pinned to that merge's commit, to the merge's owner as the snapshot gives it, carrying a key (64 hex), a deadline 14 days after it was raised, a fallback and a default that is one of its options; (2) the snapshot holds inherited failures, and the record holds exactly one fix task per build they inherit from, and none for anything else; (3) under `router-asks-per-job` 688 asks are pinned to that merge and (1)'s check fails, naming `evaluation <id>` | `packages/routing-replay/src/index.ts` doesn't exist, so the file can't load |
| `#1980.e07015a3` | `deadline.test.ts` | 2 | (1) every ask the router raised waits 14 days; with the clock moved past every deadline (and 14 days more for a second tick), each ask still open at its deadline closes once as `ask.escalated` or `ask.defaulted` at or after it, its asks row at its fallback; at least one does; after `record.rebuild()` those rows read the same, and an asks core opened on the rebuilt log closes none of them again; (2) the report: its weeks cover 107 snapshot evaluations, each in its week; each week's `asks` equals the router's asks the record holds for its evaluations and `per_job` their newly failing jobs; `owned.sat_past_14_days` is 18 and `owned.reached` the newly failing jobs of those evaluations whose merge's ask the record shows at its fallback or default; each a count over a named sample; no pass or fail | as above |
| `#1980.e7991d8c` | `snapshot.test.ts` | 3 | (1) SNAPSHOT is 64 hex; the report names it; the evidence store keeps a file by it whose bytes hash to it and parse as the snapshot; (2) every maintainer handle and merge owner in it is a placeholder, and it holds no email address; (3) under `snapshot-keeps-handle`, the snapshot kept by the hash its report names fails (2)'s check, a failure naming the job a non-placeholder handle came with | as above |

## Readings where the issue leaves a choice

- **Whether the GCC 16 evaluation is one of the 107** is left open: no test asserts it either way. The GCC 16
  evaluation is found in the snapshot as the one evaluation where the newly failing jobs of one merge number 688. The
  report's weeks must cover exactly 107 evaluations of the snapshot, whichever they are; the snapshot may hold more.
- **"120 newly failing jobs across 107 evaluations"** is the Scope's description of the fetched history, not a
  criterion; no test asserts 120.
- **A cause's key** is the `key` its ask carries (`ask.created`'s 64-hex subject key); how it is spelled from the cause
  is left to the implementation. The tests tie an ask to its cause by its pinned commit, not by its key.
- **"Inherited failures each make one fix task per cause"**: an inherited failure is one whose build record names the
  build its failure came from (`inherited_from`), and its cause is that build; a fix task is a `task.created` (the
  design's task, with an owner), not an ask. The tests don't read a fix task's owner or title (`task.created@1` has no
  field naming a cause, so the subject carries it). Fix tasks are counted over every evaluation the replay feeds.
- **What routing per job would send**: one ask per newly failing job, as the design counts "the 688 that routing per
  job would send for that one merge". Inherited failures add nothing to it.
- **"Owned failures"** are the newly failing jobs; "reached their fallback or default" is read from the record as the
  replay left it, before the tests move the clock, over the 107 evaluations. The tests don't compare `reached` with 18:
  the issue gives them side by side as counts, never as a pass.
- **"Rebuilding the asks table from the log sends it there again"**: `record.rebuild()` drops the projections and
  replays the log; each ask that went to its fallback reads the same row after it (status, outcome, fallback, owner,
  key, deadline), and an asks core opened on the rebuilt log appends no second close for it (no ask closes twice).
- **"On the virtual clock"**: the tests' clock moves only when the replay or a test sets it, never backwards; an ask's
  14 days are counted from its `ask.created`'s `ts`. The tests move it past every deadline after the replay, so an ask
  still open when the replay ends is seen at its deadline too.
- **"Stable"** placeholders can't be checked without the handles, which the snapshot must not hold; the tests check
  every handle has the one placeholder form, and that the GCC 16 ask's owner is the placeholder its merge carries in
  the snapshot.
- **"Fails, naming"**: as `1961/` reads its plants, the failures are sentences this suite's checks write
  from the snapshot and the record; a planted program must make its clause's check fail with a failure naming what the
  criterion says (`evaluation <Hydra evaluation ID>`; `job <job name>`).

## Not tested, because the criteria don't ask

The `ask.sources@1` row the replay's asks need (the asks core already refuses a source with no row); what each ask's
question says; the asks' kind; a fix task's owner; the order and spacing of the clock's steps beyond never going back;
that nothing is sent anywhere beyond `fetch` not being called; the fetch that made the snapshot; running in the local
preflight and never in CI; plan usage.
