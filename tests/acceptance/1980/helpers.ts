// Test-side tools for the #1980 acceptance tests: a real record on SQLite and a real evidence store in a temporary
// folder, on a virtual clock the replay moves; the routing replay run once over them; the snapshot read back from the
// evidence store by its hash; and the checks the criteria's planted programs must fail, each returning its failures as
// sentences that name what failed (README: The surface under test). Nothing here stands in for the replay, the asks
// core, the record or the evidence store: every result read here is theirs. No test fetches anything.

import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect } from 'vitest';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import type { EvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import type { Event, RecordStore, Row } from '../../../packages/record/src/index.ts';
import { replay, SNAPSHOT } from '../../../packages/routing-replay/src/index.ts';

export { SNAPSHOT };
export type { Event, Row };
export type Obj = { [key: string]: JsonValue };

export const DAY = 86_400_000;
/** The deadline the issue gives every ask: 14 days on the virtual clock. */
export const DEADLINE = 14 * DAY;
/** The one form a maintainer handle takes in the snapshot: a stable placeholder (README: invented). */
export const PLACEHOLDER = /^maintainer-[1-9][0-9]*$/;
const EMAIL = /[^\s@"'<>()]+@[^\s@"'<>()]+\.[A-Za-z]{2,}/;
const HEX64 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
/** The events that close an ask, each naming one outcome of the closed set. */
const CLOSING = new Set(['ask.answered', 'ask.defaulted', 'ask.escalated', 'ask.cancelled', 'ask.superseded', 'ask.moot']);

// ---------------------------------------------------------------------------------------------------
// JSON

export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
/** A column the record stores as JSON text, read back. */
export const stored = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as unknown; } catch { return value; }
};

/** No failures; the message lists them, each naming what failed. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}
/** At least one failure, and one that names each of `names`: what a planted program must give. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    expect(failures.some((f) => f.includes(name)), `${what}: a failure names ${name}; the failures were:\n  ${failures.join('\n  ')}`).toBe(true);
  }
}

// ---------------------------------------------------------------------------------------------------
// The snapshot, as the tests read it (README: The snapshot). Extra fields are the implementation's own and are not read.

export interface Merge { commit: string; owner: string }
export interface Failure { build: number; job: string; maintainers: string[]; merge: Merge | null; inherited_from: number | null }
export interface Evaluation { id: number; at: number; failures: Failure[] }
export interface Snapshot { evaluations: Evaluation[] }

/** The snapshot's bytes parsed and held to the shape the tests read; a wrong shape fails here, naming where. */
export function parseSnapshot(bytes: Uint8Array, what: string): Snapshot {
  let value: unknown;
  try { value = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch (e) { throw new Error(`${what} is not JSON: ${String(e)}`); }
  expect(isObj(value) && Array.isArray(value.evaluations), `${what} is an object with an array evaluations`).toBe(true);
  const evaluations = (value as Obj).evaluations as JsonValue[];
  evaluations.forEach((ev, i) => {
    const at = `${what}: evaluations[${i}]`;
    expect(isObj(ev) && Number.isInteger(ev.id) && Number.isInteger(ev.at) && Array.isArray(ev.failures), `${at} has an integer id and at and an array failures`).toBe(true);
    ((ev as Obj).failures as JsonValue[]).forEach((f, j) => {
      const here = `${at}.failures[${j}]`;
      expect(isObj(f) && Number.isInteger(f.build) && typeof f.job === 'string' && f.job !== '', `${here} has an integer build and a job`).toBe(true);
      const g = f as Obj;
      expect(Array.isArray(g.maintainers) && g.maintainers.every((m) => typeof m === 'string'), `${here} (job ${String(g.job)}) has maintainers, a list of strings`).toBe(true);
      const merge = g.merge ?? null;
      const inherited = g.inherited_from ?? null;
      expect(merge === null || (isObj(merge) && typeof merge.commit === 'string' && COMMIT.test(merge.commit) && typeof merge.owner === 'string'),
        `${here} (job ${String(g.job)}): merge is null or {commit: 40 hex digits, owner}`).toBe(true);
      expect(inherited === null || Number.isInteger(inherited), `${here} (job ${String(g.job)}): inherited_from is null or a build ID`).toBe(true);
      expect((merge === null) !== (inherited === null), `${here} (job ${String(g.job)}): exactly one of merge and inherited_from is set`).toBe(true);
    });
  });
  return value as unknown as Snapshot;
}

/** Every evaluation's newly failing jobs grouped by the merge they came in with: `${evaluation} ${commit}` → failures. */
export function newlyFailing(snapshot: Snapshot): Map<string, { evaluation: Evaluation; merge: Merge; failures: Failure[] }> {
  const groups = new Map<string, { evaluation: Evaluation; merge: Merge; failures: Failure[] }>();
  for (const evaluation of snapshot.evaluations) {
    for (const f of evaluation.failures) {
      if (!f.merge) continue;
      const key = `${evaluation.id} ${f.merge.commit}`;
      const group = groups.get(key) ?? groups.set(key, { evaluation, merge: f.merge, failures: [] }).get(key)!;
      group.failures.push(f);
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------------------------------
// The world: a virtual clock, a record and an evidence store in a temporary folder, and the replay over them.

/** The virtual clock: the replay sets it to each evaluation's recorded time; it never goes back. */
export interface Clock { now(): number; set(ms: number): void }
function makeClock(): Clock {
  let t = 0;
  return {
    now: () => t,
    set: (ms: number) => {
      if (!Number.isInteger(ms) || ms < t) throw new Error(`the virtual clock moves forward only, in whole ms: ${t} to ${ms}`);
      t = ms;
    },
  };
}

export interface World {
  clock: Clock;
  record: RecordStore;
  evidence: EvidenceStore;
  /** The asks core the replay routed through, over the same record and clock. */
  asks: { tick(): Promise<void> };
  /** What the replay returned as its report, unread. */
  report: unknown;
  /** Every event in the record when the replay returned, in log order. */
  events: Event[];
  close(): Promise<void>;
}

/** Every event in the record, in log order. */
export async function readAll(record: RecordStore): Promise<Event[]> {
  const all: Event[] = [];
  for (let after = 0; ;) {
    const page = await record.read({ after, limit: 1000 });
    all.push(...page);
    if (page.length < 1000) break;
    after = page[page.length - 1]!.log_pos;
  }
  return all;
}

/** The replay of the kept snapshot, run once into a fresh record (with a plant, the planted wrong program). */
export async function replayed(plant?: 'router-asks-per-job' | 'snapshot-keeps-handle'): Promise<World> {
  const dir = mkdtempSync(join(tmpdir(), 'deep-1980-'));
  const clock = makeClock();
  const evidence = await openEvidenceStore({ root: join(dir, 'evidence'), now: clock.now });
  const record = await openRecord({ path: join(dir, 'record.db'), now: clock.now, evidence });
  // No network: the snapshot was fetched once, before; the replay reads only what is kept.
  const fetched: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    fetched.push(String(input));
    throw new Error('the routing replay may fetch nothing');
  }) as typeof fetch;
  const close = async (): Promise<void> => { await record.close(); rmSync(dir, { recursive: true, force: true }); };
  try {
    const result = await replay({ record, evidence, clock, ...(plant ? { plant } : {}) });
    globalThis.fetch = realFetch;
    expect(fetched, 'the replay fetches nothing').toEqual([]);
    const events = await readAll(record);
    return { clock, record, evidence, asks: result.asks, report: result.report as unknown, events, close };
  } catch (e) {
    await close();
    throw e;
  } finally {
    globalThis.fetch = realFetch;
  }
}

/** One replay per describe block (or file), shared by its tests, removed after them. */
export function useReplay(plant?: 'router-asks-per-job' | 'snapshot-keeps-handle'): () => World {
  let world: World | undefined;
  beforeAll(async () => { world = await replayed(plant); }, 600_000);
  afterAll(async () => { await world?.close(); world = undefined; });
  return () => {
    expect(world, 'the replay ran').toBeDefined();
    return world!;
  };
}

/** The snapshot kept in the world's evidence store under `hash`, read back by it, with its bytes. */
export async function kept(w: World, hash: string): Promise<{ bytes: Uint8Array; snapshot: Snapshot }> {
  expect(await w.evidence.get(hash), `the evidence store keeps a file by the hash ${hash}`).toBeDefined();
  const bytes = await w.evidence.read(hash);
  return { bytes, snapshot: parseSnapshot(bytes, `the snapshot kept by ${hash}`) };
}

/** The hash the report names its snapshot by. */
export function reportedSnapshot(report: unknown): string {
  expect(isObj(report) && typeof report.snapshot === 'string', `the report names its snapshot by hash, got ${JSON.stringify(report)?.slice(0, 300)}`).toBe(true);
  return (report as Obj).snapshot as string;
}

// ---------------------------------------------------------------------------------------------------
// The record: the router's asks, their closes, the fix tasks.

const pinnedCommit = (e: Event): string | undefined => {
  const d = e.data;
  return isObj(d) && isObj(d.pinned_to) && d.pinned_to.kind === 'commit' && typeof d.pinned_to.ref === 'string' ? d.pinned_to.ref : undefined;
};
/**
 * The asks the router raised: each `ask.created` pinned to the commit of a merge in the snapshot, other than a request
 * the core drafted about another ask (its subject is that ask).
 */
export function routerAsks(events: readonly Event[], snapshot: Snapshot, commit?: string): Event[] {
  const merges = new Set(snapshot.evaluations.flatMap((ev) => ev.failures.flatMap((f) => (f.merge ? [f.merge.commit] : []))));
  return events.filter((e) => {
    const pin = pinnedCommit(e);
    return e.kind === 'ask.created' && !(e.subject ?? '').startsWith('ask:') && pin !== undefined && merges.has(pin) && (commit === undefined || pin === commit);
  });
}
export const handleOf = (e: Event): string => `ask:${e.id}`;
export const dataOf = (e: Event): Obj => (isObj(e.data) ? e.data : {});
/** The events that closed an ask, in log order: a closing event about it, or a saved decision applied to it. */
export const closesOf = (events: readonly Event[], handle: string): Event[] =>
  events.filter((e) => (CLOSING.has(e.kind) && e.subject === handle) || (e.kind === 'decision.applied' && isObj(e.data) && (e.data.ask === handle || e.data.ask === handle.slice('ask:'.length))));
/** Its asks-table row. */
export async function rowOf(record: RecordStore, handle: string): Promise<Row | undefined> {
  return (await record.table('asks')).rows.find((r) => r.id === handle.slice('ask:'.length));
}

// ---------------------------------------------------------------------------------------------------
// #1980.dbc0f471: the GCC 16 evaluation's one ask, and one fix task per inherited cause.

/** The evaluation where one merge broke 688 jobs, and the failures of the check that it raised one ask to that merge's owner. */
export function gcc16Check(snapshot: Snapshot, events: readonly Event[]): { evaluation?: number; asks: Event[]; failures: string[] } {
  const groups = [...newlyFailing(snapshot).values()].filter((g) => g.failures.length === 688);
  if (groups.length !== 1) return { asks: [], failures: [`the snapshot holds ${groups.length} evaluations where one merge broke 688 jobs, not one`] };
  const { evaluation, merge } = groups[0]!;
  const asks = routerAsks(events, snapshot, merge.commit);
  const failures: string[] = [];
  const at = `evaluation ${evaluation.id}`;
  if (asks.length !== 1) failures.push(`${at}: its 688 failures, from merge ${merge.commit}, raised ${asks.length} asks pinned to that merge, not one`);
  const ask = asks[0];
  if (ask) {
    const d = dataOf(ask);
    const handle = handleOf(ask);
    if (d.owner !== merge.owner) failures.push(`${at}: its ask ${handle} is to ${String(d.owner)}, not to the merge's owner ${merge.owner}`);
    if (typeof d.key !== 'string' || !HEX64.test(d.key)) failures.push(`${at}: its ask ${handle} carries no key`);
    if (typeof d.deadline !== 'number' || d.deadline - ask.ts !== DEADLINE) failures.push(`${at}: its ask ${handle}'s deadline is ${typeof d.deadline === 'number' ? (d.deadline - ask.ts) / DAY : 'missing'} days after it was raised, not 14`);
    if (typeof d.fallback !== 'string' || d.fallback === '') failures.push(`${at}: its ask ${handle} carries no fallback`);
    const options = Array.isArray(d.options) ? d.options.filter(isObj).map((o) => o.id) : [];
    if (typeof d.default !== 'string' || !options.includes(d.default)) failures.push(`${at}: its ask ${handle}'s default ${String(d.default)} is none of its options`);
  }
  return { evaluation: evaluation.id, asks, failures };
}

/** The failures of the check that inherited failures make one fix task per cause: one `task.created` per inherited-from build. */
export function fixTaskCheck(snapshot: Snapshot, events: readonly Event[]): string[] {
  const causes = new Set(snapshot.evaluations.flatMap((ev) => ev.failures.flatMap((f) => (f.inherited_from === null ? [] : [f.inherited_from]))));
  if (causes.size === 0) return ['the snapshot holds no inherited failure, so no fix task per cause can be shown'];
  const failures: string[] = [];
  const tasks = new Map<number, string[]>();
  for (const e of events.filter((x) => x.kind === 'task.created')) {
    const ref = String(dataOf(e).task_ref);
    const m = new RegExp(`^ev:${SNAPSHOT}#(\\d+)$`).exec(e.subject ?? '');
    const build = m ? Number(m[1]) : NaN;
    if (!causes.has(build)) failures.push(`fix task ${ref} (subject ${String(e.subject)}) names no build an inherited failure inherits from`);
    else (tasks.get(build) ?? tasks.set(build, []).get(build)!).push(ref);
  }
  for (const build of [...causes].sort((a, b) => a - b)) {
    const n = tasks.get(build)?.length ?? 0;
    if (n !== 1) failures.push(`cause build ${build}: its inherited failures made ${n} fix tasks, not one`);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// #1980.e07015a3: the report.

const isCount = (v: unknown): boolean => isObj(v) && Number.isInteger(v.count) && (v.count as number) >= 0 && typeof v.sample === 'string' && v.sample.trim() !== '';
const countOf = (v: unknown): number => (v as Obj).count as number;

/** Every boolean, and every key or string that says pass or fail, anywhere in the report. */
function verdictWords(value: unknown, path: string, out: string[]): void {
  if (typeof value === 'boolean') out.push(`${path} is ${value}, a pass or a fail`);
  else if (typeof value === 'string' && /^(pass|passed|fail|failed|ok)$/i.test(value)) out.push(`${path} says ${value}`);
  else if (Array.isArray(value)) value.forEach((v, i) => verdictWords(v, `${path}[${i}]`, out));
  else if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (/^(pass|passed|fail|failed|verdict|ok)$/i.test(k)) out.push(`${path}.${k} is a pass or a fail`);
      verdictWords(v, `${path}.${k}`, out);
    }
  }
}

/** The failures of the report's check against the snapshot and the record as the replay left it. */
export function reportCheck(report: unknown, snapshot: Snapshot, events: readonly Event[]): string[] {
  const failures: string[] = [];
  if (!isObj(report)) return [`the report is not an object: ${JSON.stringify(report)?.slice(0, 300)}`];
  verdictWords(report, 'report', failures);
  const byId = new Map(snapshot.evaluations.map((ev) => [ev.id, ev]));
  const router = routerAsks(events, snapshot);
  // Asks per week across the 107 evaluations, against what routing per job would send.
  const weeks = Array.isArray(report.weeks) ? report.weeks : [];
  if (!Array.isArray(report.weeks) || weeks.length === 0) failures.push('report.weeks lists no week');
  const seen = new Set<number>();
  weeks.forEach((w, i) => {
    const at = `report.weeks[${i}]`;
    if (!isObj(w) || typeof w.week !== 'string' || !Array.isArray(w.evaluations)) { failures.push(`${at} has no week and evaluations`); return; }
    const start = Date.parse(`${w.week}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(w.week) || Number.isNaN(start) || new Date(start).getUTCDay() !== 1) failures.push(`${at}.week ${w.week} is not a Monday's date`);
    const evaluations: Evaluation[] = [];
    for (const id of w.evaluations) {
      const ev = typeof id === 'number' ? byId.get(id) : undefined;
      if (!ev) { failures.push(`${at} (week ${w.week}) lists evaluation ${String(id)}, which the snapshot doesn't hold`); continue; }
      if (seen.has(ev.id)) failures.push(`${at} (week ${w.week}) lists evaluation ${ev.id} again`);
      seen.add(ev.id);
      if (!(ev.at >= start && ev.at < start + 7 * DAY)) failures.push(`${at}: evaluation ${ev.id} is not in the week of ${w.week}`);
      evaluations.push(ev);
    }
    if (!isCount(w.asks) || !isCount(w.per_job)) { failures.push(`${at} (week ${w.week}): asks and per_job are not each a count over a named sample`); return; }
    const times = new Set(evaluations.map((ev) => ev.at));
    const asks = router.filter((e) => times.has(e.ts)).length;
    const perJob = evaluations.reduce((n, ev) => n + ev.failures.filter((f) => f.merge !== null).length, 0);
    if (countOf(w.asks) !== asks) failures.push(`${at} (week ${w.week}): the report counts ${countOf(w.asks)} asks; the record holds ${asks} asks the router raised for its evaluations`);
    if (countOf(w.per_job) !== perJob) failures.push(`${at} (week ${w.week}): the report counts ${countOf(w.per_job)} asks routing per job would send; its evaluations hold ${perJob} newly failing jobs`);
  });
  if (seen.size !== 107) failures.push(`report.weeks covers ${seen.size} evaluations, not the 107`);
  // The owned failures that reached their fallback or default, against the 18 that sat past 14 days.
  const owned = report.owned;
  if (!isObj(owned) || !isCount(owned.reached) || !isCount(owned.sat_past_14_days)) {
    failures.push('report.owned.reached and report.owned.sat_past_14_days are not each a count over a named sample');
    return failures;
  }
  if (countOf(owned.sat_past_14_days) !== 18) failures.push(`report.owned.sat_past_14_days counts ${countOf(owned.sat_past_14_days)}, not the 18 that sat past 14 days`);
  const fellBack = new Set(router.filter((a) => {
    const close = closesOf(events, handleOf(a))[0];
    return close !== undefined && (close.kind === 'ask.escalated' || close.kind === 'ask.defaulted');
  }).map((a) => pinnedCommit(a)!));
  const reached = [...seen].reduce((n, id) => n + byId.get(id)!.failures.filter((f) => f.merge !== null && fellBack.has(f.merge.commit)).length, 0);
  if (countOf(owned.reached) !== reached) failures.push(`report.owned.reached counts ${countOf(owned.reached)}; in the 107 evaluations ${reached} newly failing jobs came with a merge whose ask the record shows at its fallback or default`);
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// #1980.e7991d8c: the snapshot names no person.

/** The failures of the check that every maintainer handle in the snapshot is a stable placeholder, and no email is in it. */
export function personCheck(snapshot: Snapshot): string[] {
  const failures: string[] = [];
  for (const ev of snapshot.evaluations) {
    for (const f of ev.failures) {
      const at = `evaluation ${ev.id}, build ${f.build}, job ${f.job}`;
      f.maintainers.forEach((m, i) => { if (!PLACEHOLDER.test(m)) failures.push(`${at}: maintainer handle ${i + 1} of ${f.maintainers.length} is not a placeholder`); });
      if (f.merge && !PLACEHOLDER.test(f.merge.owner)) failures.push(`${at}: the owner of merge ${f.merge.commit} is not a placeholder`);
    }
  }
  // An email address names a person wherever it sits; the job it came with is named when it sits in a failure.
  const walk = (value: unknown, path: string, job: string | undefined): void => {
    if (typeof value === 'string') { if (EMAIL.test(value)) failures.push(`${job ? `job ${job}: ` : ''}an email address at ${path}`); }
    else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`, job));
    else if (isObj(value)) {
      const here = typeof value.job === 'string' && Number.isInteger(value.build) ? value.job : job;
      for (const [k, v] of Object.entries(value)) {
        if (EMAIL.test(k)) failures.push(`${here ? `job ${here}: ` : ''}an email address in a key at ${path}`);
        walk(v, `${path}.${k}`, here);
      }
    }
  };
  walk(snapshot, 'snapshot', undefined);
  return failures;
}
