# Acceptance tests for #31: base-commit runs in a temporary checkout from DeepBuild's object store

Written first and blind, from issue #31 (its Scope and its 15 checkbox criteria), `docs/technical-design.md` (How runs
become one of five verdicts, esp. Fail before, pass after, Failing on an assertion, Pinned to a commit and The stack a check
runs against; Threats; A base with nothing to start; the Snapshots test bullet; Evidence; Dogfooding), `AGENTS.md`, the
acceptance tests of #29 and #30 for their conventions, and base commit `244a3455`, by a job that never saw an implementation
of #31. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

The issue has 15 checkbox criteria, AC1 to AC15 in the body's order.

| AC | Tag | Criterion, in short | File |
| --- | --- | --- | --- |
| AC1 | `#31.5a0437de` | a fix whose check passes on the base is INVALID | `base-runs.test.ts` |
| AC2 | `#31.f79bde6b` | a real fix is FAIL on the base, PASS on the branch | `base-runs.test.ts` |
| AC3 | `#31.95ac64f6` | no stash entries, no changes to other worktrees | `repo-state.test.ts` |
| AC4 | `#31.9afbd40a` | the seeded bug with no fix is FAIL, never BLOCKED as inherited | `base-runs.test.ts` |
| AC5 | `#31.21807e6b` | your worktree list, refs and objects unchanged | `repo-state.test.ts` |
| AC6 | `#31.814af360` | budgets: ready under 3 s, under 100 MB, on a 1 GB repo | `budgets.test.ts` |
| AC7 | `#31.79cb5a05` | another check kind gets its base run from this service | `base-runs.test.ts` |
| AC8 | `#31.81951b2c` | `failed on the base before its tests ran` | `assertion.test.ts` |
| AC9 | `#31.6485de3c` | the claim's snapshot commit, index and objects untouched, skip-worktree | `snapshot.test.ts` |
| AC10 | `#31.4e4739a3` | a write under `node_modules` in the claim's checkout stays there | `snapshot.test.ts` |
| AC11 | `#31.e96da3bd` | `failed on the base only elsewhere: TypeError at test/coupon.test.ts:7`; journeys; a named deadline | `assertion.test.ts` |
| AC12 | `#31.0c42ed7c` | stand-ins from one fixed form per kind, only on a base with nothing to start | `standin.test.ts` |
| AC13 | `#31.2f87995e` | the same edits on the same HEAD are the same commit, and write nothing | `snapshot.test.ts` |
| AC14 | `#31.ab1f7997` | snapshot retention on a controlled clock | `retention.test.ts` |
| AC15 | `#31.a271090e` | a temporary checkout's lifetime, and a hub killed mid-run | `lifetime.test.ts` |

```sh
npm ci                                    # once, if node_modules is missing
npm run build --workspaces                # AC15's hub test
cargo build -p deep-hook                  # AC15's hub test
npx vitest run --root tests/acceptance/31
node node_modules/typescript/bin/tsc -p tests/acceptance/31/tsconfig.json
```

Use the repo's Node (`.node-version`, 24.22.0). With `--root` here Vitest writes its cache to `tests/acceptance/31/.vite/`;
delete it before committing. AC15's hub test goes through the real hub and deep-hook, with `tests/acceptance/29/h-d.ts`'s
session and hub; a hub that can't start is BLOCKED (the test throws), never a pass. AC6 runs only on a reference Mac on
mains power, as #29's budgets do, and otherwise skips as INCONCLUSIVE; it never passes by skipping.

## The surface under test

The issue names behaviors and no API, so these tests define the smallest one they need: additions to `@deepbuild/gate`'s
public entry, `packages/gate/src/index.ts`. `snapshotOf` and `checkoutOf` stay as they are for whoever keeps calling them;
the implementer may build on them.

Real parts: real git repos in `/tmp/dh31-*`, real folders, the real `@deepbuild/supervisor`, `@deepbuild/leases` (with
env-local's kinds), `@deepbuild/record`, `@deepbuild/asks` and `@deepbuild/checks-command` running the real Vitest. The clock
is an argument. `plant` selects the wrong programs the criteria name, as `@deepbuild/leases`'s `plant` does; tests only.

DeepBuild's store is a bare git repo at `store`, its objects in its `objects/` and each snapshot's ref under its `refs/`, so
the tests read it with git itself (`--git-dir=<store>`), with the repo's objects as alternates when they read a whole tree.

<!-- SURFACE:BEGIN -->
```ts
import type { CheckResult, CheckRunnerFill, CheckSpec } from '@deepbuild/conformance';
import type { LeaseTable } from '@deepbuild/leases';
import type { Supervisor } from '@deepbuild/supervisor';
import type { Result } from '@deepbuild/verdicts';

export type CheckoutPlant =
  | 'base-in-command-check'         // AC7: only the command check kind gets a base run
  | 'any-nonzero-base-exit'         // AC8: any non-zero base exit counts as failing there
  | 'any-failure-of-collected-test' // AC11: any failure or overrun of a collected test counts as failing there
  | 'snapshot-through-index'        // AC9: the snapshot is written through the session's index
  | 'snapshot-into-repo'            // AC9: the snapshot's objects go into the repo's objects
  | 'keeps-skip-worktree'           // AC9: the index is copied with its marks kept
  | 'links-dependencies'            // AC10: ignored folders are linked, not cloned
  | 'stands-in-always'              // AC12: a stand-in is built where the part already starts
  | 'stamps-time'                   // AC13: a snapshot commit carries the current time
  | 'keeps-every-snapshot'          // AC14
  | 'drops-decisions'               // AC14: a snapshot behind a decision is dropped too
  | 'removes-at-session-end';       // AC15: checkouts are removed only when the session ends

export interface CheckoutsOptions {
  store: string;                    // DeepBuild's object store: a bare git repo, made if missing
  root: string;                     // the folder temporary checkouts are made in; empty when none is live
  kinds: CheckRunnerFill[];         // check.kind@1 fills, by `kind`: any kind's run gets its checkout from this service
  host: Supervisor;                 // stand-in services start through it
  leases: LeaseTable;               // and take their port from it
  now(): number;                    // the clock retention reads
  plant?: CheckoutPlant;
}
export function openCheckouts(options: CheckoutsOptions): Promise<Checkouts>;

export interface Snapshot { commit: string; wrote: boolean }           // wrote: this call wrote a commit to the store
export interface TempCheckout { dir: string; commit: string }

/** What a drafted check declares it enters through. `kind` with no fixed form gets no stand-in. */
export type DeclaredSurface =
  | { check: string; kind: 'service'; routes: string[]; format: 'json' }
  | { check: string; kind: 'page'; routes: string[] }
  | { check: string; kind: 'command'; name: string }                   // 'acme export': the program is `acme`
  | { check: string; kind: 'module'; path: string; exports: string[] }
  | { check: string; kind: string };
export interface StandIn {
  check: string;
  kind: string;
  hash: string;                     // SHA-256 hex; a command's and a module's is the same for each build of that form
  port?: number;                    // a service or page: its leased port
  run?: string;                     // and the supervisor's run handle
  bin?: string;                     // a command: its absolute path, in the checkout
}
export interface BaseCheckout extends TempCheckout { standIns: StandIn[] }

export interface ClaimCheckInput {
  check: string;
  spec: CheckSpec;                  // spec.kind picks the fill
  deadline: number;                 // ms a run may take
  on_base: 'fails' | 'passes';      // fails: a fix check, which also runs on the merge base
  own: string[];                    // the check's own files: on the base they come from the claim's commit
  asserts?: string[];               // the definition's named assertions: `file:line`, a step ID, or `deadline:5s`
}
export interface ClaimInput {
  claim: string;
  worktree: string;                 // the session's live worktree; uncommitted edits make a snapshot
  onto: string;                     // the branch whose merge base with the claim is the base
  checks: ClaimCheckInput[];
  dependencies?: string[];          // ignored folders cloned into the checkouts
  baseDependencies?: string[];      // the base checkout's, when they differ from `dependencies`
  earlier?: ClaimRun[];             // earlier claims whose results may carry
}
export interface BaseRun extends CheckResult {
  checkout: string;                 // the temporary checkout it ran in
  on_assertion: boolean;            // at least one test failed there on an assertion its check names
}
export interface ClaimCheckRun {
  check: string;
  carried: boolean;                 // its result carried from an earlier claim, and it didn't run
  head: CheckResult;
  base: BaseRun | null;             // null: it had no run on the base
}
export interface ClaimRun {
  claim: string;
  snapshot: string;
  verdict: Result;
  reasons: string[];                // why, for any verdict but PASS; empty on PASS
  smallest: string | null;          // a FAIL's smallest failing case
  checks: ClaimCheckRun[];
}
export interface Cited {
  open_claims: string[];            // snapshot commits an open claim cites
  open_asks: string[];              // and an open ask
  kept_evidence: { snapshot: string; behind_decision: boolean }[];     // and kept evidence of a verdict
}
export interface Checkouts {
  snapshot(worktree: string): Promise<Snapshot>;
  /** A checkout of `commit` for these runs, with `dependencies` cloned in. */
  checkout(r: { worktree: string; commit: string; dependencies?: string[]; runs: string[] }): Promise<TempCheckout>;
  /** A checkout of the merge base of `claim` (a revision of the worktree) and `onto`, `own` from `claim`, stand-ins built on a base with nothing to start. */
  baseCheckout(r: { worktree: string; onto: string; claim: string; own: string[]; dependencies?: string[]; surfaces?: DeclaredSurface[]; runs: string[] }): Promise<BaseCheckout>;
  /** `run` has ended; with no run left running or queued the checkout, and its stand-ins, are gone. */
  ended(checkout: TempCheckout, run: string): Promise<void>;
  /** A claim's checks on its snapshot's checkout, the fix checks also on the base, judged; every checkout it made is gone when this resolves. */
  runClaim(claim: ClaimInput): Promise<ClaimRun>;
  /** Drops the ref of each snapshot at least 30 days old that nothing cites, and prunes what nothing else holds. */
  prune(cited: Cited): Promise<{ removed: string[] }>;
  close(): Promise<void>;
}
```
<!-- SURFACE:END -->

The hub keeps its own entry: AC15's crash half reads only that the folder a killed run's check ran in is gone after the next
start, wherever under the hub's home or temp folder it was.

## Readings

- **"An empty repo" (AC12).** A repo with one empty root commit: a snapshot's parent and a merge base need a commit.
- **"A surface with no fixed form gets none" (AC12).** A scope line with no criterion of its own; held in AC12, as
  `device-screen`.
- **The reason on AC1.** The issue quotes none. The tests hold `passes on the base` or `passes on the merge base`.
- **"The same way" (AC11's journey).** `failed on the base only elsewhere` and the place `journeys/coupon.journey.ts:9`. The
  issue quotes the error's name only for the `TypeError`.
- **A base checkout with no dependencies (AC8).** `baseDependencies: []`, with the claim's own checkout installed, so the
  check passes on the claim and only the base lacks `vitest`. The real run reads `missing` there.
- **A deadline named in `asserts` (AC11).** `deadline:5s`, the design's "a test's deadline". The real Vitest hang needs the
  run to know its test had started: at the base the command check's report gives `testsRun: 0` and no failure for an
  overrun, and its `Failure` carries no error name, only the message `applyCoupon is not a function`. Both are the
  implementer's to read from the tool's report. Under heavy load Vitest may not start inside the 5 s deadline, which makes that
  test fail; rerun it alone before calling it a regression.
- **Citations (AC14).** The hub knows what cites a snapshot, from its record, so `prune` takes it as an argument.
- **"Compared with the merge base" (AC6).** The base has no such service, so the absolute limits are held. Disk is the free
  space the file system reports before and after, since `du` counts a clone in full.
- **The journey and the other kind (AC7, AC11).** Test kinds registered through `kinds`, reading the real folder they're
  given. Base has no journey kind. Neither stubs any part of the service.

## Proof on a wrong program

No `twins.json` here: a twin is an overlay on the implementation, which this job never saw. At the base the service's tests
fail with `TypeError: openCheckouts is not a function`, which is no assertion, so they need a planted wrong program in the
before lane. The implementer adds `twins.json` and `twins/` (or names the mutants that die) by the `plant` options above. The
exception is AC15's hub test, which fails on the base at its assertion. See `BASE-FAILURE.txt`.
