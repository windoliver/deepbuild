# Acceptance tests for #319: ask timing and the inbox

Written first, blind, from issue #319 (its text as of October 21, 2026: Scope, the 11 acceptance criteria and Proof), its parent #22 and siblings #318 (merged), #320 and #321 (read only to keep their scope out), `docs/technical-design.md` (An ask, and your answer getting back; Lifecycles; the Event, Ask and Decision primitives; the `done.yaml` block and the paragraph after it on values the rules leave open; States people see; Numbers version 0 has to hold, with Timing relations and Every task carries its own budgets; How we know version 0 works; Decided: Ask deadlines and defaults), `docs/canvas-primitives.md` (Question card, the event catalogue, Projections the canvas reads) and the base commit `c9891b3` (`origin/main`, with #318's asks core and no implementation of #319). The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job.

## Run

```sh
npm ci                                   # once, if node_modules is missing
npm run build -w @deepbuild/contracts -w @deepbuild/evidence -w @deepbuild/record   # the record resolves these through dist/
npx vitest run tests/acceptance/319      # from the checkout's root, with the repo's vitest.config.ts
npx tsc -p tests/acceptance/319          # type-check the tests against the surface below
```

Node 24.22 or newer, nothing else: no network, no hub, no git. Every world is a real record on SQLite and a home folder in its own temporary folder, with a virtual clock, removed afterwards. Batches, deadlines, defaults and Later move only on the virtual clock; the one wall-clock measure is criterion 2's 5 s from the hub's start. Without the budgets the suite takes about 3 s; the budgets add about 20 s on a reference Mac.

On the base, 14 of the 15 behaviour tests fail. The third plant test passes, but only because the base refuses the choice ask for the same reason its plant does: no choice deadline is declared anywhere. The 2 budget tests skip as INCONCLUSIVE off a reference Mac on mains power. `npx tsc -p tests/acceptance/319` reports 13 errors on the base, every one the missing surface: `draftAskSettings` and `InboxRow` not exported, `home` not in `AsksOptions`, `later` and `inbox` not on `Asks` (and the implicit `any`s that follow from `inbox`). Against the surface below it reports none. `BASE-FAILURE.txt` shows the base run, a sample fix kept outside this checkout that passes every test, each plant's run, and the mutants of that fix each test fails on.

## The surface

The issue names behaviours, `deep inbox`, Needs you, setup's drafted settings and a repo's `done.yaml`; the design names `~/.deepbuild/config.json` and the `asks:` block. These tests define the smallest code surface they need on top of #318's, which stays as `tests/acceptance/318/README.md` defines it. They reach the code only through:

- **`@deepbuild/asks`, through its public entry `packages/asks/src/index.ts`**: #318's surface, with the additions below;
- **`@deepbuild/record`** as it is at the base: `openRecord`, `append`, `read`, `table('asks')`, `close()`;
- **`@deepbuild/contracts`** as it is at the base: `validate('ask.created@1', event)`;
- **files**: `<home>/config.json` (your `~/.deepbuild/config.json`) and `<worktree>/.deepbuild/done.yaml`;
- **events** the tests append as the hook would: `session.start@1` (`thread`, `worktree`), `user.ask@1` (`from: person`), `tool.before@1`; and events they read, each by its `subject` (the ask's handle): `ask.created`, `ask.answered`, `ask.defaulted`, `ask.escalated`, `ask.cancelled`, `ask.superseded`, `ask.moot`, `ask.later`, and `verdict.made`, `claim.made`, `decision.created`, `decision.applied`, `run.finished` to show a default appends none of them.

```ts
// packages/asks/src/index.ts: additions to #318's surface
import type { Connection, RecordStore } from '@deepbuild/record';

export interface AsksOptions {
  record: RecordStore;
  now: () => number;
  deliver: (delivery: Delivery) => void;
  /** Your ~/.deepbuild folder: its config.json holds your own settings. Left out, nothing is declared. */
  home?: string;
}

/** An ask's place in its life (design: ask.machine@1's states), as the inbox shows it. */
export type InboxStatus = 'queued' | 'shown' | 'later' | 'folded' | 'held' | 'closed';
/** One row of the inbox projection that `deep inbox` and the app read. */
export interface InboxRow {
  ask: string;            // ask:<id>
  kind: AskKind;
  session: string;
  status: InboxStatus;
  outcome: string;        // 'unanswered' while open; otherwise how it closed (#318's closed set)
  owner: string;          // who has it now
  age: number;            // now() minus when it was raised, in ms
}

export interface Asks {
  // …raise, answer, tick, card, needsYou, holds, authorized as #318 defined them, and:
  /** Later, on the trusted path (the card or `deep inbox`): hides the ask until `until`, never past its deadline. */
  later(connection: Connection, ask: string, until: number): Promise<void>;
  /** The inbox projection: every ask in the record, open or closed, with its status, owner and age. */
  inbox(): Promise<InboxRow[]>;
}

/** Setup: drafts your own ask settings into <home>/config.json. */
export function draftAskSettings(home: string): Promise<void>;
```

Nothing else is needed: no other option, flag or export. `deep inbox` itself isn't run: there is no hub socket yet (#16), so the tests read the projection it prints through `inbox()`, as #318's tests answered through a `cli` connection.

### Settings

`<home>/config.json` holds your own values under `asks`, in the shape of `done.yaml`'s `asks:` block. Setup (`draftAskSettings`) writes the drafted ones; the tests write the file themselves where they need other values:

```json
{ "asks": {
    "deadline": { "taste": "3d", "authority": "1d", "unblock": "2d", "exception": "2d", "choice": "2d", "definition": "4h" },
    "default":  { "taste": "recommended", "authority": "no", "unblock": "stay-blocked", "exception": "no-change", "choice": "recommended", "definition": "leave-out" },
    "fallback": ["change-owner"],
    "fold": 5,
    "batch": { "every": "8h", "cap": 3 } } }
```

- Durations are a whole number and `m`, `h` or `d`.
- A repo's `.deepbuild/done.yaml` `asks:` block overrides these key by key for sessions whose worktree (from `session.start`) is that repo. The tests' file uses YAML flow maps, `deadline: { taste: 5d, authority: 12h }`, under a `done.yaml` with `claims:` and `checks:` as the design's example has them.
- **Batches** fall at the whole multiples of `every` since the Unix epoch, so `8h` gives 00:00, 08:00 and 16:00 UTC. `cap` is how many asks batches may show in one UTC day. With no `batch` declared, nothing waits for a batch: every ask shows when it's raised, as #318's tests (which pass no `home`) expect.
- The tests don't depend on whether asks shown at once count toward the cap.

### Behaviour the surface carries

- **`raise`** fills `deadline` (now plus your setting for the ask's kind) and `default` when the ask leaves them out. `default` is filled from the policy: `recommended` takes the ask's recommended option, and `no` takes the authority ask's deny option. For an unblock, an exception or a definition, the raiser names the option that stays blocked, changes nothing or leaves the requirement out, since only it knows which option that is. The `ask.created` it appends carries both values, so it passes `ask.created@1`. An ask that brings its own deadline and default keeps them, as #318's tests do.
- **Shown**: `needsYou()` lists only asks that have shown, plus the exception's card. An ask shows in a batch, up to the day's cap, oldest first. It shows **at once**, cap or not, when its deadline (for the exception, the earliest deadline among the asks it holds) comes before the next batch, or when its session is held on it. A session is held on an ask when `holds()` lists the ask. The core checks this when the ask is filed, after each batch, and when the core starts (`openAsks`). An ask that is queued, folded or held for a message never takes its default before it has shown.
- **Held for a message**: an ask raised for a session after a person's `user.ask` in that session, with no `tool.before` (the agent's next step) between, waits until the agent has the message, and still shows at once when its deadline would pass first.
- **The fold's exception**: answering it on the card with its option `together` (the `asks.fold` fixture's "Answer them together") answers every open ask of its session with that ask's recommended option, recorded as `ask.answered` on the card, and answers the exception.
- **Later**: `later(card, ask, until)` with `until` past the deadline is refused (`AskRefused`, `field: 'until'`), or recorded no later than the deadline. A hidden ask reads `later` in the inbox and is back in Needs you at `until`.
- **For one person** the fallback (`change-owner`) is you, with nobody above: at its deadline the ask takes its default, recorded as one `ask.defaulted` stamped at the deadline, delivered to the agent, with `undo` on its card. Nothing is recorded as `ask.escalated`.

### How the tests drive it

- As in #318: the tests append `session.start` before a session raises anything, then call `raise` over a `core` connection with the session set. After moving the clock they call `tick()` (`World.at`), and they answer and Later over `app` (the card).
- Each world's `shown()` reads `needsYou()` and records the virtual time each handle first showed, on its own card or in an exception's `folded`. "No ask takes its default before it has shown" is checked against that record: every `ask.defaulted` must have been preceded by a `needsYou()` that showed its ask.
- The clock starts at 2026-10-20 12:00 UTC. A deadline is reached when `now() >= deadline`.

## The contract per criterion

1. **`#319.ed496876` The cap.** Batches every 8 h, cap 3. Four taste calls from four sessions at 12:00 wait (`needsYou()` empty; the inbox reads `queued`, owner `you`, age 0). The 16:00 batch shows three; the fourth stays `queued`, 4 h old. At 16:01 a provisional taste call (S5) and a definition ask (4 h deadline, 20:01) are raised. The definition shows at once, and the taste call doesn't until `holds('S5', {leaves_machine: true})` lists it, after which it shows. The fourth taste call still waits at 23:59 and shows at the 00:00 batch.
2. **`#319.1ad1ab09` The hub stopped across a batch.** Batches every 8 h. Two authority asks (deadline 2026-10-21 12:00) and a taste call are raised at 12:00 and wait for 16:00. The hub stops at 12:30 (core dropped, record closed) and starts at 09:00 the next day (record reopened, `openAsks`). The 16:00, 00:00 and 08:00 batches passed while it was down, and the next batch is 16:00. Each authority ask is in `needsYou()` within 5,000 ms of real time from the start, polled every 50 ms; each takes no at 12:00, after it showed. **Plant:** a hub that shows nothing new until its next batch fails, naming the ask.
3. **`#319.466f1905` Defaulted, never escalated.** Under the drafted settings an authority ask gets `deadline = T0 + 1 day`. One ms before, nothing closes it. At the deadline it gets exactly one closing event, `ask.defaulted {decision: deny}` stamped at the deadline, and no `ask.escalated`. Its outcome is `defaulted` in the asks table and the inbox (`closed`, `defaulted`), and the agent hears `deny` once. **Plant:** a hub that records it as `ask.escalated` fails, naming the ask.
4. **`#319.ba0ff138` The default.** (a) A taste call takes `green`, its recommended option, at its 3-day deadline: delivered once as `{green, none}`, with the card's `undo` true. (b) An authority ask whose own default is its allow option takes `deny`. A choice whose recommended option declares allow takes `deny`, or is refused at `raise`. Nothing is authorized. An unblock takes its stay-blocked option and an exception its no-change option, both with decision `none`, and no `verdict.made`, `claim.made`, `run.finished`, `decision.created` or `decision.applied` is appended. (c) Later until T0+1h hides the ask (inbox `later`), and it is back at T0+1h. A Later past the deadline is refused naming `until`, or recorded no later than the deadline. The ask takes its default at its deadline, not later.
5. **`#319.e94e8d14` The fold.** Five taste calls and a choice from one session. The choice has no card of its own; one card of kind `exception` holds it in `folded`; the exception's `ask.created` question says "keeps asking". `answer(card, exception, {option: 'together'})` closes all six, each with one `ask.answered` naming its recommended option (`green`, or `files` for the choice), outcome `answered`, delivered to the agent. None of them, nor the exception, is left in Needs you.
6. **`#319.eaa6ea10` The day's cap reached.** Batches every 8 h, cap 2. Three taste calls at 12:00, and the 16:00 batch shows two (the cap is reached). At 16:01 an early question (deadline 20:01) shows at once, and a taste call (3 days) stays `queued`. The early question takes its default at 20:01 while the taste call waits, shows at the 00:00 batch, and later takes its default. Every `ask.defaulted` comes after its ask showed.
7. **`#319.49a0402f` Setup's drafts.** `draftAskSettings(home)` writes `asks.deadline` = taste 3d, authority 1d, unblock, exception and choice 2d, definition 4h; `asks.default` as above; `asks.fold` = 5. One ask of each kind raised without a deadline gets now plus that. Taste and choice asks get their recommended option as `default`. At each deadline: authority `hold`/deny, taste `green`, choice `files`, unblock `wait`, exception `keep`, definition `drop`, each a single `ask.defaulted` stamped at its deadline. The early question hands the agent `{drop, none}`: the definition locks without that requirement.
8. **`#319.b1bf1877` Folded or held, still on time.** Batches every 2 days; the clock starts a minute after one. Five taste calls in S1 (3-day deadlines, so they wait), then an authority ask (1 day), which folds. Its exception's card shows at once with it in `folded`. In S2, after a step and a person's typed message, an authority ask is raised that the agent hasn't read: it shows at once. At the 1-day deadline each authority ask takes `deny`, stamped then, after it showed. None of the five taste calls closes.
9. **`#319.d452dc28` Key by key.** Your settings change the choice deadline to 36 h; the repo's `done.yaml` sets only `taste: 5d, authority: 12h`. A choice ask in that repo is raised, not refused. Its `ask.created` has deadline T0+36h and default `files` and passes `ask.created@1`, and the inbox reads it `queued` or `shown`. Taste and authority asks there take 5 days and 12 hours. At 36 h the choice takes `files`. **Plant:** a hub that takes the repo's block in place of yours fails, naming the choice ask.
10. **`#319.43d13eb3` Budgets.** See Criterion 10 below.
11. **`#319.3699b37e` Never closed silently.** Batches every 8 h, cap 1; one ask of each kind raised at 12:30, and the hub ticks every 30 minutes for 3 days. The early question's deadline, 16:30, comes after the 16:00 batch, which has room for only one, so it must show at once there. Each ask gets its drafted deadline and exactly one closing event, `ask.defaulted` at that deadline, with its kind's default (as in 7). Each default is delivered to the agent, with `undo` on the card, and reads `defaulted` in the inbox. Every inbox row that reads `closed` has the one event that closed it, and no default comes before its ask showed.

### Criterion 10: budgets

`budgets.test.ts` holds the issue's limits.

- **Create and answer.** Creating an ask (`raise`) and answering it (`answer` on the card) each take under 5 ms in the hub. Five runs follow a warm-up, each of 200 raise-and-answer pairs in one session, timed per call and judged at each run's median. The design gates a budget at p50 unless the issue states p95.
- **The inbox.** `inbox()` over 10,000 asks (2,000 sessions with five open asks each, so none folds) loads in under 100 ms. Five calls are timed after a warm-up, and each must list at least 10,000 rows.

Per the design's rule for timing results, a budget passes when all five runs are within the limit, fails when all five are over it by more than the margin (the larger of 5% and the five runs' spread), and is otherwise INCONCLUSIVE. It counts only on a reference Mac (Mac15,7 or Mac15,12) on mains power, with Low Power Mode off and no thermal warning. Anywhere else, and when INCONCLUSIVE, the test is skipped with that reason, never passed.

The merge-base comparison belongs to the perf lane (`scripts/perf.mjs`, `benchmarks/budgets.json`), which measures commands, not calls, as #14, #15 and #311 left it. The implementer adds two tasks, each a command that runs one workload once against a temp root and exits 0: `asks-raise-answer` (raise and answer an ask, 200 times) and `asks-inbox-10k` (load the inbox over 10,000 asks). Each gets `margin: 0.5`, empty `limits` (the per-call limits above stay in the vitest test, since a command's p50 includes Node's start), and an `initialReason` saying the merge base has the asks core but no task for it. Once a merge base has these tasks, the lane compares p50 and peak memory with it.

## Readings where the issue leaves a choice

- **The surface.** `later` and `inbox` join `Asks`, and `home` joins `AsksOptions`. Settings are read from files the design names, never passed as an object, so the done.yaml override is tested through the repo's own file.
- **Settings shape and batches.** `config.json` takes `done.yaml`'s `asks:` shape, plus `fold` and `batch`. The design names neither key for config.json. It says the five is "drafted at setup like the deadlines" and that asks come "a few visits a day", so the tests write `batch` themselves and don't require setup to draft one. Batch times are epoch-anchored multiples of `every` in UTC, which keeps the tests independent of the machine's time zone. A schedule by local times of day would be a change to this reading.
- **The cap** limits what batches show in a UTC day. An ask that must show at once ignores it.
- **"Next batch"** is the next batch time. An ask still waiting after a batch the cap filled is checked again then, against the batch after (criterion 11's early question is the case).
- **"Shows" is Needs you.** An ask shows when `needsYou()` lists it, on its own card or folded into the exception's. A queued ask is in the inbox, never in Needs you. A folded ask shows when its exception does.
- **A session held on an ask** is one `holds()` listed it for: a step of that session waits on it. That is the hub's own record of a held step (the PreToolUse hold is #321's).
- **Held for a message** uses `tool.before` as the agent's next step, where it reads a steer (design: Delivery). Criterion 8 asks only that such an ask shows at once when its deadline would pass first. That the hold keeps a later-due ask from you until the agent reads the message isn't tested, since no criterion says it.
- **Defaults filled at raise.** Only `recommended` and `no` name an option by themselves. For an unblock, an exception or a definition, the raiser names the option that stays blocked, changes nothing or leaves the requirement out. `ask.created@1` requires `default` to be an option ID, and only the raiser knows which option is which.
- **"The PR can only say Part of"** comes from the done gate reading the locked definition. That isn't in the asks core, and no surface exists for it at the base. The test checks what the asks core hands on: the early question defaults to the option that leaves the requirement out, delivered to the agent with decision `none`.
- **"A default never makes a claim pass"**, in the asks core, means a default's decision is never `allow`, and a default appends no verdict, claim, run or decision.
- **Escalation for one person.** The fallback `change-owner` is you, so the default applies at the deadline and the fallback step adds no event of its own. The single `ask.defaulted` is the recorded step. A team's queue (`queue:shop-team`) and how long the queue waits before the default are "Scale later" (teams), with no value declared for the wait, so escalation to a named queue isn't tested. The inbox's `owner` column is read only for one person (`you`).
- **Bulk answer.** "Answer them together" takes each ask's recommended option. An authority ask whose recommended option approves is left for its own card. In a batch, irreversible steps start switched off (design), and no criterion tests a bulk approval.
- **The hub's start** is `openAsks` on the reopened record. Missed batches need not be replayed at the start: an ask whose deadline comes after the next batch may wait for it.
- **The fold counts per session** in the issue and per thread in #318's core. Every session here has its own thread, so either reading passes.

## Criteria, tests and wrong programs

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed and the leading `- [ ] ` dropped (the command in `tests/acceptance/48/README.md`). Each test name starts with its ID. A "plant" is a wrong program in `plants.ts`, run by `plants.test.ts`. A "mutant" is the sample fix with one part changed, run outside this checkout (`BASE-FAILURE.txt`).

| # | ID | Criterion (short) | Tests | Wrong programs it fails on | On the base |
|---|---|---|---|---|---|
| 1 | `#319.ed496876` | beyond the cap, wait unless held or due first | `timing`: *asks beyond the day's cap wait…* | mutants: no batches; no cap; nothing shown at once for its deadline; held session not shown; inbox age 0 | FAIL: raise refused, no deadline from settings |
| 2 | `#319.1ad1ab09` | hub stopped across a batch: shows within 5 s of start | `restart`: *with the hub stopped across a batch time…*; `plants`: one | plant: hub waits for the next batch (fails naming the ask); mutants: no batches; nothing shown at once | FAIL (same) |
| 3 | `#319.466f1905` | one person: authority defaults to no, never escalated | `deadlines`: *for one person, an authority ask…*; `plants`: one | plant: records it as escalated (fails naming the ask); mutants: default not announced; deadline only once passed | FAIL (same) |
| 4 | `#319.ba0ff138` | default announced, undoable, never a pass; irreversible is no; Later within deadline | `deadlines`: three tests | mutants: approving default taken; default not announced; default policy takes the first option; Later past deadline accepted; Later hides nothing; deadline only once passed | FAIL (same) |
| 5 | `#319.e94e8d14` | sixth ask folds; bulk answer closes all six | `fold`: *a sixth open ask…* | mutants: bulk answer closes only the exception; only the folded asks | FAIL (same) |
| 6 | `#319.eaa6ea10` | cap reached: early question at once, taste waits, no default unseen | `timing`: *with batches 8 hours apart…* | mutants: no batches; no cap; nothing shown at once; deadline only once passed | FAIL (same) |
| 7 | `#319.49a0402f` | setup drafts deadlines and defaults; each kind's default | `settings`: *setup drafts each kind's deadline…* | mutants: default policy takes the first option; default not announced; deadline only once passed | FAIL: `draftAskSettings` is not a function |
| 8 | `#319.b1bf1877` | folded and held asks show at once when due first; that ask alone takes no | `fold`: *an authority ask folded into the exception…* | mutants: nothing shown at once; exception goes by its own deadline only; deadline only once passed | FAIL: raise refused |
| 9 | `#319.d452dc28` | done.yaml overrides key by key; choice from your settings | `settings`: *in a repo whose done.yaml…*; `plants`: one | plant: repo block in place of yours (fails naming the choice ask); mutants: done.yaml ignored; deadlines hard-coded; default takes the first option | FAIL: the choice ask refused |
| 10 | `#319.43d13eb3` | create/answer < 5 ms; inbox of 10,000 < 100 ms | `budgets`: two | a sample-fix reading on battery (not counted) is in BASE-FAILURE.txt | SKIP: INCONCLUSIVE, not on mains power |
| 11 | `#319.3699b37e` | never closed silently: fallback, then announced default, each recorded | `deadlines`: *no ask is ever closed silently…* | mutants: nothing shown at once (an ask defaults unseen); default not announced; default takes the first option; deadline only once passed | FAIL: raise refused |

## Files

- `data.ts`: the clock's start, ULIDs, the drafted settings and `settings()`, the batch arithmetic, asks as `ask.created@1` data without a deadline, and each kind's expected default.
- `helpers.ts`: a world (virtual clock, record and home in a temporary folder, the asks core with `home`, its deliveries, what Needs you showed and when, stop and restart), connections, `sourceOf`, `noDefaultBeforeShown`, a repo with a `done.yaml`, and the budget rule (reference Mac, judge).
- `scenarios.ts`: the scenarios of criteria 2, 3 and 9, shared with `plants.test.ts`.
- `plants.ts`: the wrong programs criteria 2, 3 and 9 name, each the real program with one part wrong.
- `timing.test.ts` (criteria 1, 6), `restart.test.ts` (2), `deadlines.test.ts` (3, 4, 11), `fold.test.ts` (5, 8), `settings.test.ts` (7, 9), `budgets.test.ts` (10), `plants.test.ts`.
- `tsconfig.json`: type-checks the suite under the root's strict options with `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the base run, the sample fix, the plants and the mutants.
