# Acceptance tests for #365: plug-in schedules, notices and sends

Written first, blind, by a job that never saw an implementation of #365 (none exists at the base). It read:

- issue #365 as of October 31, 2026: its Scope, its 13 checkbox criteria, its Proof and its Depends on
- `docs/technical-design.md`: Extension API (TypeScript, in-process) (the `deep.schedule`, `deep.notices.send`,
  `deep.send`, `deep.registerAction`, `deep.secret` and `deep.registerSource` rows), Building blocks (the Schedule,
  Notice, Secret, Action and Send rows), Blocks for plug-ins that do real work (Source and reading, Schedule, Notice,
  Secret, Action, Send, Delivery, Channel), Sessions that know about each other (safe retries, honest liveness), Every
  task carries its own budgets, and Dogfooding
- `AGENTS.md`
- the acceptance tests of #363, #364, #104 (a hub's stop and next start), #139 (approving an ask's plan) and #761
  (a budget on the reference Mac), for their conventions; `scripts/proof-change.mjs` for the criterion IDs
- the packages #365 builds on, read only, at the base commit `f41a5b3e`: `extension-host` (`host.ts`: `callAction`,
  `action.entered`/`action.reported`, `deep.notices.send` as #363 left it, `enterSecret`, `readSource`,
  `removeSecret`; `sources.ts`; `runtime/deep.mjs`), `contracts` (extension-api.json's preview `deep.schedule`,
  `deep.notices.send` and `deep.send` tracking #365; `notice.subscribed@1`, `notice.sent@1`, `action.entered@1`,
  `action.reported@1`; `checkManifest`), `record` (`storage.ts`: the test VFS and the two durabilities), `hub`
  (`vfs.ts`, `standing.ts`), `asks`, `supervisor`, `scripts/benchmark.mjs`

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

The issue has 13 checkbox criteria, AC1 to AC13, in the body's order.

## How to run

On macOS, with the repo's Node (24.22.0). The shell's default `node` may be another version; put 24.22.0 first on
`PATH` (on the machine these were written on it is fnm's):

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH"
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # if any package's dist is missing
node node_modules/vitest/vitest.mjs run --root tests/acceptance/365 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/365/tsconfig.json
```

- **`--no-file-parallelism`:** the files start sandboxed plug-ins through the supervisor, kill them, and time
  schedules and calls, so nothing else should run beside them. The implementer adds `tests/acceptance/365/` to the
  one-at-a-time list (`alone`) in `scripts/lanes.mjs`, as #26's, #104's and #364's suites are (not done here: this
  job writes tests only).
- **The platform sandbox:** plug-ins from outside the release run under the supervisor's sandbox, so the run needs a
  shell that may start it (in Claude Code, the Bash tool with its own sandbox off).
- **The environment:** `helpers.ts` takes `CLAUDE*`, `DEEP_*` and `AI_AGENT` out of the test process's environment,
  points `HOME` at a temp folder and sets `TZ=UTC`, so nothing touches the real `~/.deepbuild` or Keychain and the
  issue's times read as UTC.
- **Temp folders:** every package, record, evidence store and home is under `/tmp/dh365-*`, removed after its file.
  Every host a test opens is closed after its file, which stops what it started. A plug-in's process is killed only
  through the supervisor run that started it (its process group) or by the PIDs the supervisor recorded for that run;
  nothing is stopped by name or port.
- **No network:** `api.market.example` and `api.mail.example` are HTTP servers this process runs on 127.0.0.1. The hub
  reaches them only through the HTTP client the test gives it, which refuses any other name before opening a socket.
- **Time:** the issue's times are on a clock the test controls; no test waits real hours. AC6's 24 hours are 1,440
  steps of a minute and take seconds. Only AC10's timings use the real clock.

## The surface under test

The issue names no module. #365 builds on #348–#350's host, #363's actions and #364's sources and secrets, so the tests
reach it only through `packages/extension-host/src/index.ts`, and the record only through
`packages/record/src/index.ts`. Names come from the issue and the design: schedule, cadence, cron line, deadline,
run, claim, owner, BLOCKED, INCONCLUSIVE, FAIL, INVALID, uncounted, declared change, no-op, notice, subscription,
fresh reading, send, key, standing rule, authority ask, plan digest, sent / not sent / unknown, queued, running, on,
paused, Run now, resume, stopped before dispatch. Every other name below is *picked here*.

The seams the tests need are #364's (the clock `now`, a `secrets` store standing in for the OS one, an `http` client
routing the issue's hosts to local servers) and the record's own test VFS (`testStorage()`), passed to `openRecord`
as its storage. #365 adds two host methods a test drives the clock with, `tick` and `idle`: production calls `tick`
from the hub's own timer, so neither loosens a check.

### `packages/extension-host/src/index.ts` gains

```ts
import type { Connection } from '@deepbuild/record';

export type Verdict = 'PASS' | 'FAIL' | 'BLOCKED' | 'INCONCLUSIVE' | 'INVALID' | 'uncounted';

/** One run of a schedule, as the hub recorded it. */
export interface ScheduleRun {
  run: string;                 // its handle, run:<ULID>; the job's ctx.run
  schedule: string;            // ext.<plugin>.<name>
  due: number;                 // the time it was for: its slot, or when Run now or a resume asked for it (the clock)
  dispatched: number | null;   // when the hub handed it to the plug-in; null if it never did (a BLOCKED run may not)
  ended: number | null;
  verdict: Verdict | null;     // null while queued or running
  cause: string | null;        // why: a BLOCKED run names what's missing (`market_key`)
  stopped: 'before dispatch' | null;
  /** Each send the run started, whether it went out. */
  sends: { key: string; outcome: 'sent' | 'not sent' | 'unknown' }[];
  /** Handles of what the hub recorded for it: readings (reading:<id>), store items, notices (notice:<id>), sends. */
  changes: string[];
}
/** One row of the schedules list. */
export interface ScheduleRow {
  name: string; extension: string;
  state: 'on' | 'paused';
  activity: 'idle' | 'queued' | 'running';
  words: string;               // the row's state in words
  next: number | null;         // from the hub's own schedule
  last: { run: string; at: number; verdict: Verdict | null } | null;   // from its last run: `at` is when it ran
  owner: string | null;        // the claim's owner once paused: 'you' (the actor of the trusted path's connection)
}
/** One send, as the hub holds it. */
export interface SendRow {
  key: string; piece: string; schedule: string | null; run: string | null; kind: string; to: string[];
  outcome: 'sent' | 'not sent' | 'unknown' | 'waiting';   // waiting: on its authority ask
  plan: string;                // its plan's digest
  ask: string | null; rule: string | null;
}
/** A standing rule for sends: the piece that sends, its recipients and, for a scheduled send, the schedule. */
export interface SendRule { sentence: string; piece: string; recipients: string[]; schedule: string | null }

export interface ExtensionHost {
  // ...#348–#364's methods, `enterSecret` and `removeSecret` among them, and:
  /** The hub's timer at `now()`: every run due starts, or queues behind its schedule's running run; resolves once each is dispatched. */
  tick(): Promise<void>;
  /** Resolves once nothing the schedules started is still going: no run running or able to start, no held call waiting. */
  idle(): Promise<void>;
  schedules(): Promise<ScheduleRow[]>;
  runs(schedule: string): Promise<ScheduleRun[]>;
  sends(): Promise<SendRow[]>;
  /** On the trusted path. */
  editSchedule(connection: Connection, name: string, cadence: { every: number } | { cron: string }): Promise<void>;
  runNow(connection: Connection, name: string): Promise<void>;
  resumeSchedule(connection: Connection, name: string): Promise<void>;
  /** You asked to be told: notice.subscribed@1's `notice_kind` and `key`, `by` the connection's actor. */
  subscribeNotice(connection: Connection, kind: string, key: string): Promise<string>;
  /** Returns the rule's handle. */
  setSendRule(connection: Connection, rule: SendRule): Promise<string>;
}
```

`removeSecret` (#364) keeps its shape: without a yes, or with a yes naming another list, it only answers
`{ removed: false, blocked }`; with a yes naming exactly that list it removes the secret. #365 makes `blocked` list
every source, schedule and check that needs it. The host is opened with the world's asks core (`asks`), through which
a send no rule covers raises its authority ask.

### The package's side (runtime `deep`, `EXTENSION_API`)

`deep.schedule`, `deep.notices.send` and `deep.send` join the API list and stay preview, so a package lists them in
`requires.preview`.

```ts
deep.schedule(name: string, cadence: {
  every?: number;              // ms; or
  cron?: string;               // a cron line, in the machine's zone (UTC here)
  deadline: number;            // ms, on the hub's clock
  declares: { readings: string[]; notices: string[]; stores: string[]; sends: string[]; noop: boolean };
}, job: (ctx: { run: string; at: number; read(source: string): Promise<JobRead> }) => Promise<unknown>): Promise<void>
// JobRead: #364's SourceRead, the reading carrying its handle:
//   { status: 'reading'; reading: { handle: string; source; value; unit; as_of } } | { status: 'BLOCKED' | 'failed'; cause }
// A job that declares noop returns { noop: <reason> } for a declared no-op.

deep.notices.send({ kind, subscription, key, readings }): Promise<string>   // notice:<id>; rejects when refused
// kind: a notice kind the manifest lists; subscription: the key you subscribed under; key: this notice's cause;
// readings: the reading handles it cites (#363's base already reads `readings`)

deep.send({ kind, key, to, subject, body, host, path }): Promise<unknown>
// kind: 'email' here; key: the send's key, claimed before it goes out; to: addresses; host: a host the grant names.
// The hub makes the request: POST https://<host><path> with the message (the tests find a send at the provider by
// its key, which the fixtures put in its subject and body, and by its recipients, in its body or URL). Without a
// standing rule that covers it, the call raises an authority ask and resolves once it is answered.

deep.registerCheck(kind, runner, { readings: string[] })   // a third argument: the sources the check reads
deep.store(kind, { generation, schema, quota?: { bytes: number } }, migrate?)   // #363's, with a quota
```

The manifest needs no new field: schedules and sends are declared when registered; `notices` lists notice kinds as
extension.manifest@1 already has it.

## Readings

- **The controlled clock.** Each step moves the clock to a minute, calls `tick` and then `idle`. A call reaches a
  provider, and a run is dispatched, at the clock's time of the step. A schedule loaded at a five-minute mark puts its
  runs at :00 and :05 whether its slots count from the clock or from its load.
- **"Never overlaps itself" (AC2).** No run of a schedule starts before the one before it ended (by the hub's
  records), and the plug-in never has two of its jobs running at once (its own count). A run is held at its price
  call from 10:00 to 10:20 with its deadline at an hour; at most one run follows it for the four slots it covered.
- **"Catches up once after sleep" (AC2).** No tick between 10:01 and 11:02, as a sleeping Mac fires no timer: from
  11:02 to before 11:05 one run, then the cadence again. The hub being down (the design's other case) isn't encoded.
- **Notices (AC1, AC4).** You subscribe on the trusted path. "Stale" is past the source's `freshFor` (one minute) at
  the time of the send: the watch job cites the reading the previous run got five minutes before. "Refused": the
  plug-in's call rejects and no `notice.sent` records it; the controls (a fresh reading; a subscribed key) are sent and
  recorded citing their reading. AC4 sends the unsubscribed notice first, so a limit on how often notices go out can't
  refuse it in its place.
- **"A retried send" (AC3).** The brief's key is one per schedule and day; Run now the same morning is the retry.
  "Power is cut right after its key is claimed and its request goes out": the record runs on the record's test VFS;
  the provider cuts it the moment the send's request reaches it and never answers; the plug-in's process is killed
  and the hub's objects dropped; the hub then starts on what the storage kept. The send key's claim is in the record
  (the criterion's own words: a claim made at `synchronous=NORMAL` is lost).
- **"Reaches the agent as did not run" (AC5).** `callAction` refuses with no `started`, as #363's host already
  answers a call refused before its handler; one that ran answers `started: true` and its call. `changed` names the
  write by its `ext.market.alert:NVDA` entry or by its store event's ID (#363 left either open). AC5's first two parts
  were delivered by #363: those tests pass at the base, as regression protection.
- **"Before the hub is stopped" (AC5).** The hub stops with the send's request unanswered; two seconds into the stop
  the provider drops the connection without answering, so a stop that waits on the request ends.
- **The 24 hours (AC6).** From 00:00, when the key is removed (your yes to the list), to 23:59. "One BLOCKED claim"
  is one run with verdict BLOCKED, its cause naming `market_key`; "no runs after the first" is no other run recorded
  in the 24 hours (the BLOCKED one may never be dispatched). "Passes on the reading it records": the 12:02 run is PASS
  and its `changes` holds the handle of a `reading.recorded` of the price with as-of 12:02.
- **"The recorded source" (AC7).** A local server answers with the recorded answers by the clock: 200 before 10:00;
  from 10:00 the 429s (or 400s). "Calls go to the source at 10:05, 10:15 and 10:35": between 10:00 and 10:35 the
  source is called at 10:00, 10:05, 10:15 and 10:35 and at no other time. "Resumes after the third": a run passes
  between 10:35 and 10:40. The 400 case runs to 18:00; you then resume it and a run follows by 18:05.
- **Three kill points (AC8).** "Before its send's request": no rule covers the relay's send, so it waits on its
  authority ask, and the process is killed then; that send counts among the sends the run started, read not sent.
  "After the request, before the answer": the provider holds the request. "After the answer is recorded": the send
  reads sent and the job is held at its next call. The hub stays up; the plug-in's process is killed.
- **"From what plug-ins declared" (AC9).** The source names the secret; the schedule declares the price among its
  readings; the check is registered with the price as a reading it needs. Cancelling is closing the list without a
  yes. "Changes nothing": the key stays in the store, the source still reads, and the next run passes.
- **Budgets (AC10).** As #761's: the merge-base comparison is the perf lane's, so `benchmarks/budgets.json` must hold a
  task for each timing (`extension-source-call`, `extension-store-query`, `extension-schedule-fire`, picked here) and
  stay valid against the merge base's. The numbers: a source call is `readSource` less the same request straight to
  the provider (mean of 20, five runs); a store query is `deep.store.get` of a random key among 100,000 items, timed in
  the plug-in (p95 of 200, five runs); a schedule fires within 1 s of its slot (a five-second schedule on the real
  clock with no tick, five firings). Each is judged by `judgeLimit` and counts only on a reference Mac; elsewhere it is
  skipped as INCONCLUSIVE before any work. The quota is checked on every machine: against 4,096 bytes, 100 puts of
  117 bytes each leave at most 35 items and a refusal naming the quota. The implementer adds `budgets.test.ts` to the
  one-at-a-time list as #761's is.
- **The standing rule (AC11).** "my weekly summary, to me": the brief, `you@example.test`, `ext.brief.weekly`.
  "Different content": each Monday's body carries its date. "Naming what changed": the ask's card names the second
  address, or the daily schedule (`daily`). "Raises one authority ask": one in the asks core's inbox, and nothing
  reaches the provider while it is open.
- **The last result (AC12).** A daily 08:00 cron; at 09:00 you change it to 10:00. The row's `last.at` is 08:00.
- **One run accepted and one queued (AC13).** "The agent had accepted" the run's turn is read as the plug-in's own
  process having taken the run (it is the run's agent; no model or agent session runs a plug-in's job). The relay's
  run is accepted, its send answered, and it is held at its next call; the next slot passes, so the next run is due
  and queued behind it, since runs never overlap. "Resumes the first once": the plug-in's new process is given that run
  once after the restart and the run ends; its send doesn't go out again. "Stopped before dispatch": the queued run
  reads so and its job never runs.

## Criteria to tests

Each test's name starts with its criterion's number. Each `describe` carries the criterion's ID,
`#365.<first 8 hex of the SHA-256 of its text>`, as `scripts/proof-change.mjs` computes it (trimmed, whitespace
collapsed). A test headed `(wrong program)` runs the scenario through the wrong program the criterion names and
expects it to fail the criterion's judge (`judges.ts`) with the problem naming what the criterion says.

| ID | Criterion (short) | Tests | At this base |
|---|---|---|---|
| AC1 `#365.e88a0414` | a notice on a stale reading is refused | `notices.test.ts` (1) | fails (no `deep.schedule`) |
| AC2 `#365.97c8a041` | no overlap, one catch-up after sleep | `schedules.test.ts` (2): the held run; the hour asleep | fails |
| AC3 `#365.f05c3dba` | a retried send goes out once, also across a power cut; a NORMAL claim fails, naming the key | `sends.test.ts` (3): Run now the same day; the cut; wrong program | fails |
| AC4 `#365.77db7849` | no notice nobody subscribed to | `notices.test.ts` (1) | fails |
| AC5 `#365.5e6c187d` | schema refusal didn't run; write-then-throw reported; an unanswered send reads unknown, never sent again; two wrong programs fail, naming the call | `actions.test.ts` (5): the refusal; the throw; wrong program as did not run; the unanswered send; wrong program sends again | the refusal, the throw and its wrong program pass (#363); the send's two fail (no `setSendRule`, `deep.send`) |
| AC6 `#365.84ae7874` | key removed: one BLOCKED, no runs after; 288 FAILs fails naming the count; key back at 12:02 runs and passes | `outcomes.test.ts` (3) | fails |
| AC7 `#365.fe146d14` | 429 spacing and INCONCLUSIVE; 400 spacing, pause, resume; three wrong schedulers fail naming the run | `outcomes.test.ts` (6) | fails |
| AC8 `#365.40d6759a` | killed at three points: INVALID, not sent / unknown / sent; two wrong programs fail naming the key | `killed.test.ts` (5) | fails |
| AC9 `#365.faeb616a` | remove lists exactly three, changes nothing until yes, cancel keeps the key; two wrong programs fail naming what's missing | `removal.test.ts` (3) | fails |
| AC10 `#365.db4ac3e6` | budgets on the reference Mac vs the merge base; store quota | `budgets.test.ts` (5) | the merge-base test fails (no tasks); the query fails (100,000 rows: the lookups miss the call's deadline); the quota fails (no quota: 100 of 100 taken); the source call's timing runs on #364's code and may pass; the fire test fails (no `deep.schedule`) |
| AC11 `#365.7d93d1de` | covered sends with no ask and a digest each; recipient or schedule change asks once; kind-only rule fails | `sends.test.ts` (4) | fails |
| AC12 `#365.3ca5abe2` | last result from the last run, not the edit | `schedules.test.ts` (2) | fails |
| AC13 `#365.6d5ba1fd` | stop with one accepted and one queued: resume once, stopped before dispatch; sending both fails naming the run | `stopped.test.ts` (2) | fails |

42 tests in all.

## Wrong programs

Built in this folder (`twins.ts`), never by editing a package; each runs on its scenario's real bytes and the real
hub.

| Twin | Criterion | What it is | How it fails |
|---|---|---|---|
| `claimsAtNormal` | AC3 | the record's own test VFS under the real record and hub, every commit made at synchronous=NORMAL from right before the send's run | the claim is lost at the cut, the brief goes out again; the judge names the key |
| `asDidNotRun` | AC5 | the real host's `callAction`, its refusal of a call that ran stripped of `started` and the call | the judge names the call, reached the agent "as did not run" |
| `resendsUnanswered` | AC5 | at the next start, the unanswered request sent to the provider once more | two requests; the judge names the call |
| `keepsRunning` | AC6 | every five minutes for 24 hours, a run reading the price through the real host (no key) and recording FAIL | the judge names 288 runs (288 FAIL) |
| `wrongScheduler('keeps-cadence')` | AC7 | every five minutes whatever happens, through the real host's read | names the 10:10 call (429s) and the 10:05 run (400s) |
| `wrongScheduler('429-as-fail')` | AC7 | right spacing, a 429 recorded as FAIL | names the 10:00 run |
| `wrongScheduler('pauses-early')` | AC7 | right spacing, pauses after 4 FAILs | names the missing 12:30 run |
| `killedAsFail` | AC8 | the real runs, INVALID read as FAIL | names the send's key |
| `sentWithoutAnswer` | AC8 | the real runs, unknown read as sent | names the send's key, "sent with no recorded answer" |
| `deletesAtOnce` | AC9 | the real remove, the key deleted from the store when the list is asked for | "the key left the OS secret store before your yes" |
| `leavesOneOut` | AC9 | the real list without the check | names `ext.market.above_target` |
| `kindOnlyRule` | AC11 | every authority ask a send raises answered yes, as a rule matching any email address would | the send to the second address goes out; the judge names the send |
| `lastFromSaved` | AC12 | the real list, the last run's time taken from when the schedule was saved | names 09:00 |
| `sendsBothAgain` | AC13 | at the next start, the accepted run's send made again and the queued run's send made | names each run |

The schedulers of AC6 and AC7 are models beside the hub: the hub has no seam for its scheduling policy, and adding one
would be a production option that weakens a check. Each makes every call through the real host's `readSource`, the
same provider and clock, with the host's own schedule never due. They prove the judge tells a wrong schedule from a
right one on the scenario's own answers; the real hub's runs are judged by the same function.

## What the tests don't cover

The Scope's items with no criterion: the calendar function; a run's deadline being enforced; Run now saving the edit
first; the trigger list; the schedules list's `next` from the hub's own schedule and its state in words (read only
where a criterion needs them: paused, its owner, on after resume, queued); a notice sent once per cause, rate-limited,
never in Needs you, muted, and recording who subscribed and when; links opening only to declared hosts; the declared
out-of-process host; uncounted no-ops; a quota refusal's INCONCLUSIVE (#261 is open). A PR should say how it proves
each it claims, or say `Part of #365` for what stays open.

## Files

- `helpers.ts`: the environment, temp folders, the controlled clock, the world (record, evidence, asks, supervisor,
  trust; on the test VFS for AC3), hosts with their seams, the hub's stop and start, killing a plug-in's process,
  the local providers and routed client, the fixture copier, install-check-load, the probe reader, the clock steps.
- `judges.ts`: each criterion's assertions, returning problems.
- `twins.ts`: the wrong programs.
- The test files: `notices.test.ts` (AC1, AC4), `schedules.test.ts` (AC2, AC12), `sends.test.ts` (AC3, AC11),
  `actions.test.ts` (AC5), `outcomes.test.ts` (AC6, AC7), `killed.test.ts` (AC8), `removal.test.ts` (AC9),
  `budgets.test.ts` (AC10), `stopped.test.ts` (AC13).
- `fixtures/`: the test plug-ins, their code carrying a `.fixture` suffix so Vitest and `tsc` skip it: `market`
  (the price source, the watch schedule, the check, the alert actions), `brief` (scheduled sends, a send action, a
  pause source) and `tally` (a store with a quota, lookups timed in the plug-in, a five-second schedule).
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run and the type check on the base commit.
