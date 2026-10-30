# Acceptance tests for #45: readings

Written first, from issue #45 (its text as of 2026-10-30T09:19:07Z), the design sections it links (First-party extensions that
ship on by default, the readings row; Plan usage, per account and per task; How we know version 0 works), Held time is counted,
A loop's turn end isn't a hand-back, Slow runs start when the turn ends, the Decided row Decision 1, the paragraph on labelled
samples under Dogfooding, Reading by reference and Privacy, all in `docs/technical-design.md`, and base commit `244a3455`, by a
job that never saw an implementation. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job.

All 16 checkbox criteria are tested, in issue order, as AC1 … AC16, each test named with its criterion's tag (`#45.<h8>`).

```sh
npm ci                                    # once, if node_modules is missing
npm run build --workspaces                # hub.test.ts runs the built hub and CLI
cargo build -p deep-hook                  # and the real hook
npx vitest run --root tests/acceptance/45 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/45/tsconfig.json
```

Use the repo's Node (`.node-version`, 24.22.0). With `--root` here Vitest writes its cache to `tests/acceptance/45/.vite/`;
delete it before committing. `BASE-FAILURE.txt` is added by the base run, not by this job.

## The surface under test

The issue names `deep_search`, the Numbers panel and the record's events, and no code API. So these tests define the smallest
one they need, the public entry of a new workspace package, `@deepbuild/readings`, at `packages/readings/src/index.ts`, imported
with its `.ts` extension, and two hub surfaces.

- **`numbers.read`**, a socket method for the control role: `{}` returns `{ rows: PanelRow[] }`, every reading in the record as
  `panelRows` gives it. The panel draws these rows; its pixels are not tested here (Open points 1).
- **`deep numbers`**, a command: one line per row, with its id, value, source, age (such as `2d`) and, when stale, `STALE`.
- **`deep_search`** gains reading hits beside its others, each from `searchReadings`: `{ source, quote, as_of, reading }`.
- **The billing keys**, as `session.start@3` already reports them, read as `billing.mode` rows whose value is `billingMode`'s.

**One seam the twins need:** `packages/readings/src/index.ts` is exactly `export * from './impl.js';`, with the implementation
in `impl.ts` (which may re-export other files), and the hub and CLI import only the names below. Each twin replaces `index.ts`
with `export *` from `impl.js` plus one wrong function over the real one, so it compiles against any implementation that keeps
these signatures. The hub must reach its readings through these functions, or a twin won't reach it.

<!-- SURFACE:BEGIN -->
```ts
/* ================= Input: the record's events, as plain data ================= */
export interface RecordEvent { id: string; kind: string; v?: number; ts: number; session: string | null; data: Record<string, unknown> }
// `session` is the event's session as the record's connection names it, without the `session:` prefix; every per-session
// result below names sessions the same way. A turn is identified by the id of the user.ask that began it.

/* ================= Readings ================= */
export type Cost = { basis: 'reported'; usd: number } | { basis: 'estimated'; usd: number; rate_card: string } | { basis: 'unpriced' };
export interface Reading {
  id: string;                        // the ids tested: held.turn, held.session (unit ms); cost.turn (subject: the turn.usage's turn);
                                     // spend.usd (subject: `session:<id>` and, per task, the task's handle); billing.mode (value: a
                                     // billingMode); a reading.recorded@1 event's reading handle (e.g. `reading:mergetime`) as its id
  subject: string | null;
  value: number | string | null;     // null is missing or unknown, never zero
  unit: string;
  source: string;                    // never empty; a reading.recorded's own source as it stands
  as_of: number;                     // ms: the newest event or source reading it counts
  basis: 'observed' | 'modeled';     // a reported cost and a held time are observed; an estimate from a rate card is modeled
  cost?: Cost;                       // on cost.turn
  complete?: boolean;                // on spend.usd: false when a turn it sums is unpriced
  classifier?: ClassifierCheck | null;   // on a classifying reading: its check, or null when it has none
}
export type ReadingsState = unknown; // opaque
export function recompute(events: RecordEvent[]): ReadingsState;
export function update(state: ReadingsState, events: RecordEvent[]): ReadingsState;   // same readings as a recompute over everything
export function readingsOf(state: ReadingsState): Reading[];

/* ================= The Numbers panel ================= */
export interface PanelRow {
  id: string; subject: string | null; value: number | string | null; unit: string;
  source: string; age_ms: number; basis: 'observed' | 'modeled';
  status: 'current' | 'STALE';       // STALE past fresh_for[source]; a source with no entry is current here, and the hub holds the defaults
  agreement: { share: number; n: number; status: ClassifierCheck['status'] } | null;
}
export function panelRows(readings: Reading[], options: { now: number; fresh_for: Record<string, number> }): PanelRow[];

/* ================= Classifying readings ================= */
export interface LabelledMessage { message: string; text: string; label: boolean; period: 'baseline' | 'dogfood'; dates_hidden: boolean; labelled_by: string }
export interface ClassifierCheck { id: string; n: number; agreement: number | null; status: 'PASS' | 'FAIL' | 'BLOCKED'; labelled_by: string | null }
// BLOCKED under 100 messages, without both periods, or with any date shown. PASS when agreement >= threshold.
export function checkClassifier(input: { id: string; classifier: (text: string) => boolean; sample: LabelledMessage[]; threshold: number }): ClassifierCheck;
export function isItDone(text: string): boolean;     // the real classifier
// Only passing checks on labels by `labellers`, ['you'] unless named; a test's fixture labels are never yours.
export function decisionOneInputs(readings: { id: string; check: ClassifierCheck | null }[], options?: { labellers?: string[] }): { used: string[]; refused: { id: string; why: string }[] };

/* ================= Transcripts ================= */
export interface Tokens { input: number; output: number; cache_write: number; cache_read: number }
export interface RateCard { name: string; models: Record<string, { input: number; output: number; cache_write: number; cache_read: number }> }   // USD per million
export interface UsageCount {
  totals: Tokens & { unknown_turns: number };
  turns: { turn: string; usage: Tokens | null }[];   // turn: the uuid of the user line that began it; null is unknown, never zero
  cost: Cost;                                        // estimated from options.rateCard, else the shipped card; unpriced when the card lacks a model
}
export function countUsage(paths: string[], options?: { rateCard?: RateCard }): UsageCount;   // Claude Code JSONL files

/* ================= Baseline ================= */
export interface BaselineMeasure { id: string; kind: string; window: { from: number; to: number }; transcripts: { sha256: string }[]; copied_from_doc?: number }
export function recomputeBaseline(input: { baseline_sha256: string; measures: BaselineMeasure[]; archive: (sha256: string) => Uint8Array | null }): {
  baseline_sha256: string;
  script: { sha256: string; text: string };          // the counting script
  output: { sha256: string; text: string };          // its output; the same bytes on a second run
  measures: { id: string; window: { from: number; to: number }; transcripts: string[]; value: number | null; status: 'recomputed' | 'missing' }[];
};
// kind 'tokens.total' is the one the fixture tests: the sum of the four token kinds by countUsage's rules.

/* ================= Billing ================= */
export function billingMode(sessionStart: RecordEvent): 'api_key' | 'plan' | 'unknown';   // no billing report is unknown; any API-key name set is api_key
export function planWindowTokens(events: RecordEvent[]): { counted_tokens: number; sessions: { session: string; mode: 'api_key' | 'plan' | 'unknown'; tokens: number; counted: boolean }[] };
// tokens: input + cached + output of the session's turn.usage events (the tests leave cached at 0).

/* ================= Held time ================= */
export interface HeldBy { question: number; slow: number; fast: number; snapshot_start: number; queue_wait: number }
export function heldTime(events: RecordEvent[], options: { budget_ms: number }): {
  stops: { stop: string; session: string; turn: string; total_ms: number; by: HeldBy; code_changing: boolean }[];   // in order
  turns: { turn: string; session: string; total_ms: number; by: HeldBy }[];
  sessions: { session: string; total_ms: number; by: HeldBy;
    code_changing: { stops: number; p50_ms: number; p95_ms: number; budget_ms: number; band: 'inside' | 'over'; slow_hold_ms: number } }[];
};
export function budgetCost(events: RecordEvent[]): { left: number; failed_after_reply: number; items: { check: string; claim: string; turn_started: string | null }[] };
// left: the distinct checks in stop.held budget_cost; turn_started: the id of the first user.ask after the FAIL.

/* ================= Stale runs and loops, per session ================= */
export function staleRuns(events: RecordEvent[]): { sessions: { session: string; count: number; within_30s: number;
  runs: { run: string; check: string; outdated_by: string; after_ms: number }[] }[] };   // outdated_by: user.ask's `from`; after_ms: from the reply of the stop that started the run
export function loopHolds(events: RecordEvent[]): { sessions: { session: string; places_taken: number; runs_saved: number; runs_started: number;
  starts: { check: string; claim: string; by: string; waited_ms: number }[] }[] };       // waited_ms: from the stop of the claim it started on

/* ================= deep_search ================= */
export interface ReadingHit { reading: Reading; source: string; as_of: number }
export function searchReadings(readings: Reading[], query: string): ReadingHit[];   // `spend` matches spend.usd; a word no reading holds matches none
```
<!-- SURFACE:END -->

## Event shapes these tests define

The record has `stop.held@1`, `run.*`, `user.ask@1`, `turn.usage@1`, `session.start@3` and `reading.recorded@1`. It has no fact for
the three below, so the tests define them, each `writer: core`, each with `data.session` as `session:<id>`. The tests hand them
to the public entry as plain data; they don't drive the gate runner to write them (Open points 4).

| Kind | `data` | Means |
| --- | --- | --- |
| `run.stale@1` | `session, run, check, claim, newer_claim` | A slow-lane run ended and a newer claim had changed its check's inputs. What outdated it is read from the record: the first `user.ask` after the reply of the `stop.held` with its claim. |
| `check.held@1` | `session, check, claim, replaced` | A slow check took its held place at a looping session's stop; `replaced` is the claim whose place it took, or null. |
| `check.held_start@1` | `session, check, claim, by` | A held check started; `by` is `pause`, `due_later`, `grace_window`, `claim` or `words`. |

`stop.held`'s `ts` is its reply, so a hold began at `ts - total`. A stop joins to a run by `data.claim`.

## The fixture

`fixtures/claude/` is hand-written; no real transcript, no personal data. Its tokens, counted by hand:

| Message | Where | Lines | Input | Output | Cache write | Cache read |
| --- | --- | --- | --- | --- | --- | --- |
| `msg_01` | main | 2 (and replayed by the resume) | 100 | 40 | 1,000 | 0 |
| `msg_02` | main | 1 (and replayed) | 10 | 20 | 50 | 1,000 |
| `msg_03` | main, after `/compact` | 1 | 300 | 60 | 0 | 500 |
| `msg_s1` | subagent | 1 | 200 | 30 | 0 | 0 |
| `msg_s2` | subagent | 3 | 5 | 15 | 10 | 200 |
| `msg_04` | resumed file | 1 | 20 | 30 | 100 | 1,500 |
| **Total** | | | **635** | **195** | **1,160** | **3,200** |

The resumed file ends in the crashed turn `u-crash`: an assistant line with no usage, then a torn line. Its usage is unknown.
The sum of all four is 5,190. At $3, $15, $3.75 and $0.30 per million the cost is $0.01014.

## Outside inputs

These read BLOCKED or INCONCLUSIVE when the thing isn't there, and never pass. Only their fixture tests prove logic.

| Criterion | Needs | Without it |
| --- | --- | --- |
| AC1 | `DEEP_PILOT_BASELINE`: a private JSON manifest `{ baseline_sha256, archive_dir, measures }` | skipped as BLOCKED |
| AC4 | `DEEP_LABELLED_SAMPLE`: your sample, at least 100 messages you labelled, `{ threshold, messages }`. The labels in `classify.test.ts` are the test's own, marked `fixture`; `decisionOneInputs` refuses them unless a test names that labeller | skipped as BLOCKED |
| AC9 | A reference Mac on mains power, as #29's budgets | timed tests skip as INCONCLUSIVE |
| AC10 | `npx --yes ccusage@20.0.45 claude daily --json --offline`, on the fixture alone, in a temporary `CLAUDE_CONFIG_DIR` | skipped as BLOCKED |

So `Closes #45` needs those inputs to have been there; otherwise the PR says `Part of #45` and lists them.

## Wrong programs

`twins.json` maps each tag to its twins. At the merge base `hub.test.ts` and `perf-lane.test.ts` fail at assertions, and every other file fails at load, so those rest on the twins.

| Criterion | Twins (`twins/<name>/packages/readings/src/index.ts`) |
| --- | --- |
| AC1 | `baseline-copies-doc` |
| AC2 | `no-source` |
| AC3 | `stale-as-current` |
| AC4 | `classifier-unchecked` |
| AC5 | `counts-every-line`, `crash-as-zero` |
| AC6 | `api-key-in-window` |
| AC7 | `unpriced-as-zero` |
| AC8 | `all-observed` |
| AC9 | `update-ignores-new`, `slow-readings` |
| AC10 | `cost-off-by-five-percent` |
| AC11 | `search-no-source` |
| AC12 | `first-to-last` (134 s), `last-stop` (6 s), `session-double` |
| AC13 | `over-every-stop`, `adds-slow`, `always-inside` |
| AC14 | `counts-over-hold`, `counts-each-fail` |
| AC15 | `stale-no-origin`, `stale-per-day` |
| AC16 | `places-as-runs`, `wait-from-first` |

No test asserts with `toThrow`; each compares values, so a wrong program fails at an `expect` line.

## Open points

1. **The panel's pixels.** The issue says "the Numbers panel"; these tests read its rows through `numbers.read` and `deep numbers`. Drawing them in the app is not tested here.
2. **No agreement threshold.** Neither the issue nor the design gives one: "Decision 1 uses only those that pass", and the rule's threshold isn't stated. `checkClassifier` takes it as an argument, and the real sample's file names it. The tests use 0.9 as a fixture value only.
3. **No freshness limits.** The issue gives no age at which a source is stale. `panelRows` takes them per source; the hub test uses 40 days against one minute, which any sane default splits.
4. **The three new events.** Writing them from the gate runner isn't asserted, because the criteria state readings. An implementation that reads them but never writes them passes these tests and reads nothing on a real session; review that.
5. **"Three held places taken."** Three goal turns could mean three stops or a first hold plus three. These tests take the first hold as no place taken (`replaced: null`) and three newer snapshots as the three, since the issue says "each newer snapshot taking its held place".
6. **A waiter's wake.** The scope says a failure's turn is "a waiter's wake or the next prompt". AC14 names only "the turn its FAIL started", and the test uses the next prompt; a wake's record fact isn't defined here.
7. **Scope without a criterion.** Failed calls by signature, review wait, blocked time, git and GitHub lifecycle numbers, and Codex's counting rules (cached input taken out, a running total as a baseline) are in the issue's Scope and have no acceptance criterion, so no test here. A reading's `basis` for a recorded reading isn't asserted beyond being one of the two.
8. **An estimate as "modeled".** The issue doesn't say which costs are modeled; these tests read an estimate from a rate card as modeled and a reported cost as observed.
