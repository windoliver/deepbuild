// @deepbuild/routing-replay: the ask router's replay of recorded nixpkgs Hydra failures (#1980).
//
// The snapshot is public build history fetched once (make-snapshot.mjs) and kept in this package by its SHA-256:
// the trunk jobset's evaluations in recorded order, each failure with its build record. A newly failing job names
// the merge it came in with, an inherited failure the build whose failure it inherits; maintainers and merge
// owners are stable placeholders, so it names no person.
//
// The replay keeps those bytes in the evidence store by their hash, then feeds each evaluation on the virtual clock:
// the newly failing jobs of one merge raise one ask, to that merge's owner, through the asks core (one send-back per
// cause), and the failures inherited from one build make one fix task. An ask whose jobs all build again later is
// withdrawn; one still open at its 14-day deadline takes its default there, as the core rules for one person, with
// the fallback it carries kept in the asks table. Nothing is fetched and nothing is sent: asks go to this record and
// their placeholder owners.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { openAsks } from '@deepbuild/asks';
import type { Asks } from '@deepbuild/asks';
import type { EvidenceStore } from '@deepbuild/evidence';
import { ulid } from '@deepbuild/record';
import type { Connection, RecordStore } from '@deepbuild/record';

/** The kept snapshot's SHA-256, in lower-case hex: the hash it is kept as evidence by, and the snapshot replayed. */
export const SNAPSHOT = '4901b0250363cba72ec8ddc553f547904af03a85d0fc0c121781dc9e4976c363';

const DAY = 86_400_000;
/** Every ask waits 14 days (#1980). */
const WAIT = 14 * DAY;
/** The ask.sources@1 row the router raises under. */
const SOURCE = 'replay.routing';
/** Who a routed ask falls back to past its deadline: the jobset's queue, never a person. */
const FALLBACK = 'queue:nixpkgs-unstable';
/** The figure the issue sets the owned failures that reached their fallback or default against. */
const SAT_PAST_14_DAYS = 18;
const OPTIONS = [
  { id: 'fix', label: 'Fix the failing jobs', decision: 'none' },
  { id: 'revert', label: 'Revert the merge', decision: 'none' },
  { id: 'leave', label: 'Leave them failing', decision: 'none' },
] as const;
/** Past its deadline nothing changes: the jobs stay failing. */
const DEFAULT = 'leave';

export interface VirtualClock { now(): number; set(ms: number): void }
export type Plant = 'router-asks-per-job' | 'snapshot-keeps-handle';
export interface ReplayOptions {
  /** The replay's own record, opened by the caller on `clock.now` with `evidence`. */
  record: RecordStore;
  /** Where the replay keeps the snapshot, by its hash. */
  evidence: EvidenceStore;
  clock: VirtualClock;
  /** A planted wrong program, for the acceptance tests only. */
  plant?: Plant;
}
export interface Count { count: number; sample: string }
export interface Week { week: string; evaluations: number[]; asks: Count; per_job: Count }
export interface Report {
  /** The SHA-256 of the snapshot replayed. */
  snapshot: string;
  /** Asks per week across the window's evaluations, against what routing per job would send. */
  weeks: Week[];
  owned: { reached: Count; sat_past_14_days: Count };
}
export interface Replay { report: Report; asks: Asks }

interface Merge { commit: string; owner: string }
interface Failure { build: number; job: string; status: string; maintainers: string[]; merge: Merge | null; inherited_from: number | null }
interface Evaluation { id: number; at: number; window: boolean; failures: Failure[]; fixed: string[] }
interface Snapshot { evaluations: Evaluation[] }

/** One open routed ask: its handle, deadline and the jobs it was raised for that still fail. */
interface Routed { handle: string; thread: string; deadline: number; jobs: Set<string> }

const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

/** The kept bytes, checked against SNAPSHOT. */
function keptBytes(): Uint8Array {
  const bytes = gunzipSync(readFileSync(new URL(`../snapshot/${SNAPSHOT}.json.gz`, import.meta.url)));
  if (sha256(bytes) !== SNAPSHOT) throw new Error(`the kept snapshot's bytes no longer hash to ${SNAPSHOT}`);
  return bytes;
}

/** The planted snapshot: one failure keeps a maintainer handle as fetched, in place of its placeholder. */
function keepsHandle(bytes: Uint8Array): Uint8Array {
  const snapshot = JSON.parse(Buffer.from(bytes).toString('utf8')) as Snapshot;
  const failure = snapshot.evaluations.flatMap((e) => e.failures).find((f) => f.maintainers.length > 0)!;
  failure.maintainers[0] = 'handle@example.org';
  return Buffer.from(JSON.stringify(snapshot));
}

/** The UTC Monday of the week `ms` falls in, as YYYY-MM-DD. */
function monday(ms: number): string {
  const day = new Date(ms);
  const back = (day.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() - back)).toISOString().slice(0, 10);
}

export async function replay(options: ReplayOptions): Promise<Replay> {
  const { record, evidence, clock, plant } = options;
  const bytes = plant === 'snapshot-keeps-handle' ? keepsHandle(keptBytes()) : keptBytes();
  const put = await evidence.connect({ role: 'deepbuild', via: 'job' }).put({
    bytes, kind: 'file', source: 'routing-replay snapshot', redaction: 'complete', license: { name: 'public build history', allows: [] },
  });
  if (put.status !== 'stored') throw new Error(`the evidence store refused the snapshot: ${put.reason}`);
  const hash = put.evidence.sha256;
  const snapshot = JSON.parse(Buffer.from(bytes).toString('utf8')) as Snapshot;

  const asks = await openAsks({ record, now: clock.now, deliver: () => {} });
  const as = (thread: string): Connection => ({ writer: 'ext:routing-replay', actor: 'you', scope: 'you', session: thread });
  const routed = new Map<string, Routed>();
  /** Each cause raised once: never the same question twice. */
  const raised = new Set<string>();
  const tasked = new Set<number>();
  const asksAt = new Map<number, number>();
  const ownerOf = new Map<number, string>();
  for (const e of snapshot.evaluations) for (const f of e.failures) if (f.merge) ownerOf.set(f.build, f.merge.owner);

  const advance = (to: number): void => { if (to > clock.now()) clock.set(to); };
  for (const evaluation of snapshot.evaluations) {
    // Each deadline that comes before this evaluation is met on the clock: the core takes the ask's default there.
    for (const deadline of [...new Set([...routed.values()].map((r) => r.deadline))].filter((d) => d <= evaluation.at).sort((a, b) => a - b)) {
      advance(deadline);
      await asks.tick();
      for (const [cause, r] of routed) if (r.deadline <= deadline) routed.delete(cause);
    }
    advance(evaluation.at);
    // A routed ask whose jobs all build again no longer stands: the router withdraws it.
    const fixed = new Set(evaluation.fixed);
    for (const [cause, r] of routed) {
      for (const job of r.jobs) if (fixed.has(job)) r.jobs.delete(job);
      if (r.jobs.size > 0) continue;
      routed.delete(cause);
      await record.append(as(r.thread), { v: 1, id: ulid(clock.now()), kind: 'ask.cancelled', subject: r.handle, ts: clock.now(), data: { answer: DEFAULT, plan_hash: null, decision: 'none' } });
    }
    // One ask per merge (a planted router asks per job), to the merge's owner, pinned to its commit.
    const causes = new Map<string, { merge: Merge; jobs: string[] }>();
    for (const f of evaluation.failures) {
      if (!f.merge) continue;
      const cause = plant === 'router-asks-per-job' ? `${f.merge.commit} ${f.job}` : f.merge.commit;
      const c = causes.get(cause) ?? causes.set(cause, { merge: f.merge, jobs: [] }).get(cause)!;
      c.jobs.push(f.job);
    }
    for (const [cause, { merge, jobs }] of causes) {
      if (raised.has(cause)) continue;
      raised.add(cause);
      const key = sha256(`routing:${cause}`);
      const named = jobs.length === 1 ? jobs[0] : `${jobs.length} jobs`;
      // Each cause is a thread of its own, so one owner's asks never fold into another's.
      const thread = `routing${key.slice(0, 20)}`;
      const handle = await asks.raise(as(thread), SOURCE, {
        kind: 'choice',
        question: `Evaluation ${evaluation.id}: ${named} newly fail with merge ${merge.commit.slice(0, 12)}. Fix them, revert the merge, or leave them failing?`,
        options: OPTIONS.map((o) => ({ ...o })),
        recommended: 'fix',
        deadline: clock.now() + WAIT,
        fallback: FALLBACK,
        default: DEFAULT,
        provisional: false,
        owner: merge.owner,
        key,
        pinned_to: { kind: 'commit', ref: merge.commit },
      });
      routed.set(cause, { handle, thread, deadline: clock.now() + WAIT, jobs: new Set(jobs) });
      asksAt.set(evaluation.id, (asksAt.get(evaluation.id) ?? 0) + 1);
    }
    // One fix task per build whose failure others inherit.
    for (const f of evaluation.failures) {
      if (f.inherited_from === null || tasked.has(f.inherited_from)) continue;
      tasked.add(f.inherited_from);
      await record.append(as(`fix${f.inherited_from}`), {
        v: 1, id: ulid(clock.now()), kind: 'task.created', subject: `ev:${hash}#${f.inherited_from}`, ts: clock.now(),
        data: { task_ref: `task:${ulid(clock.now())}`, thread: `fix${f.inherited_from}`, owner: ownerOf.get(f.inherited_from) ?? 'you', title: `Fix build ${f.inherited_from}, whose failure other jobs inherit` },
      });
    }
    await asks.tick();
  }

  // What the router left: each merge whose ask reached its fallback or default, read from the record.
  const reachedCommits = new Set<string>();
  const closes = new Map<string, string>();
  for (let after = 0; ;) {
    const page = await record.read({ after, limit: 1000 });
    for (const e of page) {
      if (e.kind === 'ask.created' && e.writer === 'ext:routing-replay') {
        const pin = (e.data as { pinned_to?: { ref?: string } }).pinned_to?.ref;
        if (pin) closes.set(`ask:${e.id}`, pin);
      } else if (e.subject && closes.has(e.subject) && /^ask\.(answered|defaulted|escalated|cancelled|superseded|moot)$/.test(e.kind)) {
        if (e.kind === 'ask.defaulted' || e.kind === 'ask.escalated') reachedCommits.add(closes.get(e.subject)!);
        closes.delete(e.subject);
      }
    }
    if (page.length < 1000) break;
    after = page[page.length - 1]!.log_pos;
  }
  const window = snapshot.evaluations.filter((e) => e.window);
  const weeks = new Map<string, Evaluation[]>();
  for (const e of window) (weeks.get(monday(e.at)) ?? weeks.set(monday(e.at), []).get(monday(e.at))!).push(e);
  const newly = (e: Evaluation): Failure[] => e.failures.filter((f) => f.merge !== null);
  const report: Report = {
    snapshot: hash,
    weeks: [...weeks].map(([week, evaluations]) => ({
      week,
      evaluations: evaluations.map((e) => e.id),
      asks: { count: evaluations.reduce((n, e) => n + (asksAt.get(e.id) ?? 0), 0), sample: `asks the router raised for the week's ${evaluations.length} evaluations` },
      per_job: { count: evaluations.reduce((n, e) => n + newly(e).length, 0), sample: `newly failing jobs in the week's ${evaluations.length} evaluations, one ask each when routed per job` },
    })),
    owned: {
      reached: {
        count: window.reduce((n, e) => n + newly(e).filter((f) => reachedCommits.has(f.merge!.commit)).length, 0),
        sample: `newly failing jobs in the ${window.length} evaluations whose merge's ask reached its fallback or default in this replay`,
      },
      sat_past_14_days: {
        count: SAT_PAST_14_DAYS,
        sample: 'failures with an owner still open after 14 days in the recorded nixpkgs history the issue cites, with no routing',
      },
    },
  };
  return { report, asks };
}
