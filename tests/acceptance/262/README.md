# Acceptance tests for #262: live readings, Read now, while shown, and series kept as batches with rollups

Written first, blind, by a job that never saw an implementation of #262 (none exists at the base). It read:

- issue #262 as of November 1, 2026: its Scope, its checkbox criteria, its Proof and its Depends on (#139, #14, #15,
  #34, #401, #364, #365)
- `docs/technical-design.md`: Blocks for plug-ins that do real work (Source and reading; Read now, and while shown;
  Series; Notice; Schedule; Replay and a clock), One event log, with tables built from it (the `rollups` line),
  Evidence (retention: uncited batches after 24 h, minute rollups after 7 days, 30 days otherwise, decisions kept),
  the Extension API block (`deep.registerSource` with `shape`/series and `while_shown`, `deep.readNow`), the App API
  row (`views/shown`, `views/hidden`), the blocks table's Source and reading row, Replica, Socket roles, Dogfooding
- `AGENTS.md`
- the acceptance tests of #364, #365 (layout, helpers, judges, twins, budgets), #34 (the app API on the socket), #401
  (bound values), #15 (the evidence store) and #14 (the record), for their conventions; `scripts/proof-change.mjs` for
  the criterion IDs; `scripts/benchmark.mjs` (`judgeLimit`, `validateBudgets`, `fingerprint`); `scripts/lanes.mjs`
- the packages #262 builds on, read only, at the base commit `a7e140b2`: `extension-host` (`host.ts`: `readSource`,
  `deep.registerSource`, `deep.registerView`'s `viewRefusal`, `deep.schedule` and `deep.schedule.read`,
  `subscribeNotice`, `noticeAllowed`, `runCheck`, `tick`, `idle`; `sources.ts`; `schedules.ts`; `runtime/deep.mjs`),
  `contracts` (extension-api.json's preview `deep.readNow` tracking #262; `reading.batch@1`, `reading.rollup@1`,
  `decision.created@1`, `notice.subscribed@1`; `manifest.ts`'s source-name rule), `record` (`projections.ts`: the
  `rollups` table fed by `reading.rollup`; `read`, `table`, `rebuild`, `backup`), `evidence` (`KEPT_MS` for
  `reading.batch` and `reading.rollup.minute`, `retain`, `read`'s hash check), `hub` (`server.ts`'s method table,
  `core.ts`'s retention pass and its cited set), `verdicts` (where INVALID comes from)

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

The issue has 18 checkbox criteria, AC1 to AC18, in the body's order; the budgets are the 18th.

## How to run

On macOS, with the repo's Node (24.22.0) first on `PATH`:

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH"
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # appapi.test.ts starts the built hub, packages/cli/dist/main.js
node node_modules/vitest/vitest.mjs run --root tests/acceptance/262 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/262/tsconfig.json
```

- **`--no-file-parallelism`:** the files start sandboxed plug-ins through the supervisor, run a day and thirty days
  of the test clock, and time bound values, so nothing else should run beside them. The implementer adds
  `tests/acceptance/262/` to the one-at-a-time list (`alone`) in `scripts/lanes.mjs`, as #364's and #365's are (not
  done here: this job writes tests only).
- **Long files.** `day.test.ts` runs one day of a 500-series source every 10 s (8,640 calls, 17,000 ticks);
  `retention.test.ts` runs thirty days of it once a minute (43,200 calls). On the base both stop at their first step.
  On an implementation, expect minutes for the day and tens of minutes for the thirty days; each has a 3 to 4 hour
  ceiling. The thirty days write about 0.9 GB of batch and rollup files over the run under `/tmp/dh262-*`, of which
  retention keeps about a quarter; all of it goes with the file.
- **The platform sandbox:** the plug-ins come from outside the release, so the run needs a shell that may start the
  supervisor's sandbox (in Claude Code, the Bash tool with its own sandbox off).
- **The environment:** `helpers.ts` takes `CLAUDE*`, `DEEP_*` and `AI_AGENT` out of the test process's environment,
  points `HOME` at a temp folder and sets `TZ=UTC`. Every package, record, evidence store and home is under
  `/tmp/dh262-*` and removed after its file; every host is closed after its file, which stops what it started. The
  one hub process (`appapi.test.ts`) is #16's `startHub`, stopped by its PID. Nothing is stopped by name or port.
- **No network:** `api.metrics.example` is an HTTP server this process runs on 127.0.0.1, answering `/s/<source>`.
  The hub reaches it only through the HTTP client the test gives it, which refuses any other name before a socket.
- **Time:** every criterion's times are on a clock the test controls (day 1 is Monday, November 2, 2026, UTC); only
  AC18's timings use the real clock.

## The surface under test

The issue names `deep.readNow(view)`, `while_shown: {every}`, `views/shown` and `views/hidden` on the app API, series
sources, `reading.batch`, `reading.rollup`, the `rollups` table, `reading:<source>#<series>` handles, the evidence
store and the record. It names no module, so the tests reach the host only through
`packages/extension-host/src/index.ts`, the record through `packages/record/src/index.ts`, the evidence store through
`packages/evidence/src/index.ts`, and the hub's socket as #16's and #34's tests do. Every name below that doesn't
exist at the base is **picked here**, on the base's own names; the tests rely on nothing else.

### `packages/extension-host/src/index.ts` gains

```ts
import type { CheckResult, CheckSpec } from '@deepbuild/conformance';
import type { EvidenceStore } from '@deepbuild/evidence';
import type { Connection } from '@deepbuild/record';

export interface ExtensionHostOptions {
  // ...#348–#365's options, and:
  /** The evidence store batch and rollup files go to and are read back from, through their hash. */
  evidence?: EvidenceStore;
}

/** A views/shown report, as the app sends it on the app API for each view it shows, at once and every 5 s. */
export interface ViewShown {
  view: string;               // the view's name, as deep.registerView registered it
  window: string;             // the app window it is drawn in
  visible: boolean; minimized: boolean; display_awake: boolean; session_locked: boolean;
  replica: boolean;           // drawn by a replica, which never counts
}
/** A bound value as a frame draws it. */
export interface BoundValue {
  handle: string;             // reading:<source> for a number source, reading:<source>#<series> for one series
  status: 'reading' | 'rollup' | 'quota' | 'missing';
  value: number | null;       // null when missing
  as_of: number | null;
  shown: string;              // what is drawn: the number, or a dash when missing
  span?: 'minute' | 'hour';   // with status rollup: the window it resolved to (its `last` is the value)
  until?: number;             // with status quota: when the call can run
  cause?: string;             // with status missing: why, naming the batch and, for a bad file, the mismatch
}
export interface RollupStats { min: number; max: number; mean: number; last: number; count: number }
export interface NoticeRow { id: string; kind: string; key: string; source: string | null; sentence: string; every: number | null }

export interface ExtensionHost {
  // ...#348–#365's methods, and:
  /** The app API's views/shown and views/hidden (the hub's socket forwards them with the app's connection). */
  viewsShown(connection: Connection, report: ViewShown): Promise<void>;
  viewsHidden(connection: Connection, report: { view: string; window: string }): Promise<void>;
  /** Bound values, live, or as of a frame's pinned log position (`at.log_pos`), in the order asked. */
  boundValues(handles: string[], at?: { log_pos: number }): Promise<BoundValue[]>;
  /** One window's rollups of a source, per series, read from the file its reading.rollup names; null when none. */
  rollup(source: string, span: 'minute' | 'hour', start: number): Promise<Record<string, RollupStats> | null>;
  /**
   * #365's, with a fourth argument: a notice you create on a source, in your words (`every`: a slower cadence the
   * notice names). On a source that runs only while shown it gives the plug-in's job that checks the notice kind a
   * schedule of its own; it rejects, naming the notice, when the plug-in declares no such job.
   */
  subscribeNotice(connection: Connection, kind: string, key: string, on?: { source: string; words: string; every?: number }): Promise<string>;
  /** The notices you created, each with its sentence (which names the schedule it was given). */
  listNotices(): Promise<NoticeRow[]>;
  /** One run of a check kind, judged as the hub judges it: a result citing a batch whose file is gone or fails its hash is INVALID, naming it. */
  judgeCheck(kind: string, spec: CheckSpec, ctx: { checkout: string; deadline: number }): Promise<{ verdict: Verdict; cause: string | null; result?: CheckResult }>;
}
```

- **`tick()` and `idle()`** (#365's) also run each while-shown cadence that is due, write the rollups of each window
  that has closed (its end plus the source's timeout), and apply a series' retention: past 24 h an uncited batch's
  file goes, past 7 days a minute rollup's, past 30 days an hour rollup's (the evidence store's `retain`, keeping what a
  check, notice or decision cites). Production calls `tick` from the hub's own timer.
- **`readSource(name)`** on a series source makes one call, as it does for a number source; the call lands as one
  `reading.batch` (`{source, as_of, file}`, the file in the evidence store). A call past 10,000 values answers
  `{ status: 'failed', cause }`, the cause naming the count. The tests read only `status` of a series read; its
  answer's shape is the implementer's (`{ status: 'batch', batch: { handle, source, as_of, file, count } }` would do).
- **A batch's handle** is its `reading.batch` event's `subject`, or `reading:<its event ID>` when the event has none.
  A notice cites a batch by it; a check cites a batch by it or its file's hash.
- **`views.shown` and `views.hidden`** are the hub socket's method names for the app API's `views/shown` and
  `views/hidden`, as `inbox.read` and `ask.answer` are for its other rows; the app calls them on its connection.

### The package's side (runtime `deep`)

```ts
deep.registerSource(name, {
  variant: 'polled', host, path, quota: { per_minute, per_day }, timeout, freshFor, parse,   // #364's
  shape?: 'series',               // parse returns { values: Record<string, number>, unit } instead of { value, unit }
  while_shown?: { every: number },// ms, at least 10,000
})
deep.registerView(name, panel, area, { binds: string[] })   // the reading handles the view binds (with #366's pages, commands)
deep.readNow(view: string): Promise<unknown>                // joins the runtime's API list (preview, tracking #262)
deep.schedule(name, { deadline, declares }, job)            // #365's, with no `every` or `cron`: a job that checks the
                                                            // notice kinds its declares.notices names, run only on the
                                                            // schedules notices give it
```

The view's Read now button calls the plug-in's action `ext.shop.read_now`, whose handler calls `deep.readNow(view)`
(the panel draws the button; a panel reaches the hub only through its plug-in's actions).

### Source names and handles

A plug-in's source is named `ext.<plugin>.<name>` at the base (`checkManifest`'s rule for #364's sources), so the
issue's source `metrics` is `ext.shop.metrics` here and its handle `reading:metrics#checkout` is
`reading:ext.shop.metrics#checkout`. If the implementation makes plain source names legal instead, that is a dispute
for a blind redraft (the tests hold each handle in one constant).

### The budgets' perf-lane tasks

`benchmarks/budgets.json` gains `reading-batch-refresh` and `reading-value-at-position`, each with an `initialReason`
naming #262, valid by `validateBudgets` against the merge base's file. `budgets.test.ts` joins the one-at-a-time list.

## Readings

- **Read now (AC1, AC2).** "Recorded sources" are local servers answering recorded answers by the clock, as #365's
  are. "Answered 1 s before" is a call at 10:00:29; "quota spent until 10:01" is a quota of one call a minute spent at
  10:00:00. Every source is fresh for 1 s only, so Read now's 2 s rule alone keeps the first. "Within one frame of its
  reading": on the test clock, which doesn't move, the third's bound value shows the 10:00:30 reading with no clock
  time between them. "Its values read quota with 10:01" is `status: 'quota', until: 10:01:00`.
- **Shown (AC3, AC4).** The app reports each shown view at once and every 5 s (helpers.ts, `App`). AC4 models a
  minimized window, a replica and a silent app through the app API's report, since the base has no app-side reporter
  to drive: from 10:00:00 the reports say `minimized: true`; a replica's reports say `replica: true`; a silent app
  sends no report at all and never views/hidden, its socket open. "Within 10 s plus one period" of the last report at
  10:00:00 is no call after 10:00:20. `appapi.test.ts` checks only that the hub's socket serves the two methods.
- **The notice (AC6, AC7).** "Creating" is `subscribeNotice` with the source and your words. "A schedule every 10 s"
  is the checking job's runs, 6 ± 1 a minute with no view shown, each reading the source; "the sentence names it" is
  `/every 10 s/` in `listNotices()`'s sentence. "Notifies once": one `notice.sent` for three answers of 3%. "Leaves the
  job unscheduled" is the job given no schedule, a model beside the hub (Wrong programs). "Refused when it is
  created, naming the notice": the call rejects with its kind, key or words, and records no `notice.subscribed`.
- **The day (AC8, AC9, AC14, AC18's sizes).** The view is shown from 00:00:00, ticking every 5 s to 24:00:10. Batches
  are counted by as-of time from 00:00:00 to 23:59:50; rollups by windows that end by 24:00:00, each once. "No event
  per value or per series" is no event kind with more than three events a call. "The driver's own events counted
  apart": the record's growth is a backup of it, compacted, less the same backup without the source's batch and
  rollup events and their `rollups` rows, compacted.
- **Replay (AC11).** "Live" is the value pinned to the 10:00:10 batch's log position read before the next lands;
  "on replay" is the same pin read after the 10:00:20 batch landed.
- **The planted file (AC12).** One byte of the batch's file is flipped in the store's folder; the next resolution
  reads missing. "A check that cites it" is `ext.shop.cites`, whose result cites the batch's file and handle.
- **Rollups (AC13).** The calls are 10 s apart; the three failing calls get a 500. The rollups are read through
  `rollup()`, not the file, since the 40 bytes a series of AC17 leave the file's format to the implementer.
- **Thirty days (AC15, AC16, AC17).** A call a minute (at :05) keeps the run to 43,200 calls; rows and rollup files
  are per window, not per call. "A decision cites" is a `decision.created` appended by the core with the batch's file
  as its evidence, which the hub's retention pass already reads as cited. "The notice still opens the batch": its file
  is held and a value pinned to it resolves through it (`status: 'reading'`).
- **Budgets (AC18).** Sizes are judged on every machine; the two timings only on a reference Mac (`judgeLimit`, five
  runs after a warm-up), and skipped as INCONCLUSIVE elsewhere. "Refreshes its 500 bound values" is one
  `boundValues` of the 500 handles after a batch lands (mean of 20 a run); "a value at a past log position" is one
  handle pinned to a random earlier batch (p50 of 200 a run, p95 logged).

## Criteria to tests

Each `describe` carries the criterion's ID, `#262.<first 8 hex of the SHA-256 of its text>`, as
`scripts/proof-change.mjs` computes it. A test headed `(wrong program)` runs the criterion's wrong program and expects
its judge (`judges.ts`) to fail it, naming what the criterion says.

| ID | Criterion (short) | Tests |
|---|---|---|
| AC1 `#262.9d1a9fcb` | Read now: one call, to the ready source; kept, quota, update | `readnow.test.ts` (1) |
| AC2 `#262.acafafac` | the 5-minute schedule stays 10:05:00; calling the kept or spent source fails naming it | `readnow.test.ts` (2) |
| AC3 `#262.19fbe9a5` | 6 ± 1 a minute with one view, 6 with two, none 10 s after hidden; two wrong hosts | `whileshown.test.ts` (2), `appapi.test.ts` (1) |
| AC4 `#262.457c2b67` | minimized, replica, silent app; wrong hosts name the view | `whileshown.test.ts` (4) |
| AC5 `#262.d7c7f941` | every 5 s refused naming the field; 10 s under 5 a minute refused naming both | `whileshown.test.ts` (2) |
| AC6 `#262.afbd91fe` | the notice's own 10 s schedule, its sentence, one notice; unscheduled fails naming it | `notice.test.ts` (2) |
| AC7 `#262.96530f6d` | 6 calls a minute with the view shown, not 12; panel-only check refused naming the notice | `notice.test.ts` (2) |
| AC8 `#262.2a3a744d` | 8,640 batches, 1,464 rollups | `day.test.ts` (2) |
| AC9 `#262.99400a8b` | no event per value; 4,320,000 fails naming the count | `day.test.ts` (2) |
| AC10 `#262.e2bdbc81` | 10,001 fails naming the count; 10,000 one batch | `series.test.ts` (1) |
| AC11 `#262.4ba2cfdd` | 42.5 live and on replay; newest-batch host fails naming the value | `series.test.ts` (2) |
| AC12 `#262.190cedac` | planted file: missing naming batch and mismatch; citing check INVALID | `series.test.ts` (1) |
| AC13 `#262.edf5ecc6` | minute and hour rollups; three wrong hosts name the field | `rollups.test.ts` (2) |
| AC14 `#262.2d291fb4` | rollups rebuilt byte for byte; table-only host fails naming the table | `day.test.ts` (2) |
| AC15 `#262.7b9efe91` | day 3 minute rollup, notice opens 14:00:00; day 9 hour rollup | `retention.test.ts` (3) |
| AC16 `#262.ddd70a8f` | day 32 missing as a dash, decision opens 15:00:00; two wrong hosts | `retention.test.ts` (3) |
| AC17 `#262.ff200c23` | 43,920 rows, under 250 MB; per-series projection fails naming the table | `retention.test.ts` (2) |
| AC18 `#262.7859de09` | budgets: batch bytes, record growth, refresh, past position; perf-lane tasks | `day.test.ts` (2), `budgets.test.ts` (3) |

41 tests in all.

## Wrong programs

Built in this folder (`twins.ts`, or inline where the twin is one line), never by editing a package. The hub has no
seam for its while-shown policy, Read now, its rollup arithmetic or its projections, and adding one would be a
production option that weakens a check, so each is a model beside the hub, run on the scenario's own inputs.

| Twin | Criterion | What it is | How it fails |
|---|---|---|---|
| `readsEverything` | AC2 | at Read now, one call to each bound source, straight to a provider of its own | names `ext.shop.fresh` (again, 1 s after) and `ext.shop.spent` (inside its quota window) |
| `modelCadence('ignores-hidden')` | AC3 | a while-shown cadence on the app's real report log, counting a view shown from its first report | names the source, called at 10:02:10 and after |
| `modelCadence(…, perView)` | AC3 | one cadence per shown view | names the source, 12 calls in the minute two views are shown |
| `modelCadence('counts-every-report')` | AC4 | counts any views/shown, minimized or a replica's | names the view |
| `modelCadence('shown-until-hidden')` | AC4 | counts a view shown until views/hidden, however long the app is silent | names the view |
| `modelNoticeJob(…, every: null)` | AC6 | the notice's checking job on the scenario's timeline and answers, every view hidden, given no schedule, so it never runs | names the notice, notified 0 times |
| one event per value | AC9 | the day's events with each value the provider answered as a reading.recorded | names 4,320,000 |
| `newestOnReplay` | AC11 | the real host's bound value with the pin dropped | names `reading:ext.shop.metrics#checkout`, 43 |
| `wrongRollups` | AC13 | median as mean, max as last, mean of minute means | names `mean`, `last`, the hour's `mean` |
| `rebuiltWithoutRollupEvents` | AC14 | the real record rebuilt from a log with no reading.rollup | names `rollups` |
| raw on day 3 | AC16 | the 10:00:05 batch's raw value shown on day 3 | names the value's handle |
| `dropsCited` | AC16 | the real evidence store's retention on a copy, given no citation | names the 14:00:00 and 15:00:00 batches |
| one row per series | AC17 | the 30 days' rows times 500 | names `rollups`, 21,960,000 |

Each model of AC3, AC4 and AC6 is also run with the right rule (for AC6, the notice's 10 s) and expected to pass the same judge.

## Redrafts

- **AC6's wrong program (November 2, 2026).** Disputed: it modelled the unscheduled host as the real host with the
  clock stepped and only `idle()` called, but #365's `Schedules.idle()` at the base itself ticks any schedule that is
  due, so a host that does give the job its schedule runs it there and the judge finds nothing. Redrafted blind as
  `modelNoticeJob` (`twins.ts`), a model beside the hub on the scenario's timeline and recorded answers with the job
  given no schedule, judged by the same `judgeNoticeSchedule`; the same model given the notice's 10 s must pass it.
  The right-program AC6 test is unchanged.
- **AC14's rows (November 2, 2026).** Disputed: `day.test.ts`'s `beforeAll` threw `Do not know how to serialize a
  BigInt` in `sorted`, because the record's `table()` at the base reads every INTEGER column as a BigInt
  (`safeIntegers(true)`), so `sorted`, `judgeRebuilt`'s `JSON.stringify` and AC14's `start + HOUR` failed on any host.
  Redrafted: the sort key is written with a replacer, the rows go to the unchanged `judgeRebuilt` with each BigInt as
  `{"bigint":"<digits>"}` (so a number never matches a BigInt of the same value), and the window filter uses
  `Number(r.start)`. Expected values and judges are unchanged. `retention.test.ts`'s AC17 filter only compares `start`
  with numbers, which is exact for a BigInt, so it is unchanged.

## What the tests don't cover

Scope items with no criterion: Read now from ⌘K or your words (only the panel's button, through its action); a
display asleep or the session locked (the report carries both; no criterion reads them); a `{row}` source's one-row
quota check and rows that go first in the next period; a notice naming a slower cadence than the source's; a kept
batch "always resolved through" beyond the two cited ones; a batch file that is gone (only a changed one, AC12). A PR
should say how it proves each it claims, or say `Part of #262`.

## Files

- `helpers.ts`: the environment, temp folders, the controlled clock, the world (record, evidence store on the clock,
  asks, supervisor, trust), hosts with their seams, the local provider and routed client, the fixture copier,
  install-check-load, the probe, the Read now and notify actions, the app's reports (`App`) and the clock steps.
- `judges.ts`: each criterion's assertions, returning problems. `twins.ts`: the wrong programs.
- The test files: `readnow` (AC1, AC2), `whileshown` (AC3–AC5), `appapi` (AC3's app API), `notice` (AC6, AC7),
  `day` (AC8, AC9, AC14, AC18's sizes), `series` (AC10–AC12), `rollups` (AC13), `retention` (AC15–AC17), `budgets`
  (AC18's timings).
- `fixtures/`: `shop` (sources, views, polls, the notice's job, the Read now and notify actions, the citing check, the
  probe) and `glance` (a while-shown source and a notice kind whose only check is in its panel); code carries a
  `.fixture` suffix so Vitest and `tsc` skip it.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run and the type check on the base commit.
