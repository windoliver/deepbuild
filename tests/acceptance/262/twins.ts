// The wrong programs the criteria name, built here and never in any package (README, Wrong programs). The hub has no
// seam for its while-shown policy, its Read now or its rollup arithmetic, and adding one would be a production option
// that weakens a check, so each twin is a model beside the hub that runs on the scenario's own inputs: the app's
// report log, the provider's recorded answers, the real host's bound values, the real record, the real evidence
// store. Each test headed `(wrong program)` expects its criterion's judge to fail the twin, naming what the criterion
// says.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ExtensionHost } from '../../../packages/extension-host/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import { API, callDirect, clock, metricsApi, SECOND, tempDir, type Answers, type Sent, type ShownReport, type World } from './helpers.ts';
import type { Stats } from './judges.ts';

// ---- AC2: a Read now that calls every source the view binds, whatever their last answer and quota.
/**
 * The scenario's calls on a provider of its own, as such a Read now makes them: the earlier answers at their times,
 * then, at Read now, one call to each source the view binds, straight to the provider.
 */
export async function readsEverything(answers: Answers, earlier: { source: string; at: number }[], at: number, binds: string[]): Promise<Record<string, number[]>> {
  const c = clock(Math.min(...earlier.map((e) => e.at), at));
  const api = await metricsApi(c, answers);
  const routes = { [API]: api };
  for (const e of [...earlier].sort((a, b) => a.at - b.at)) {
    c.set(e.at);
    await callDirect(routes, e.source);
  }
  c.set(at);
  for (const source of binds) await callDirect(routes, source);
  return Object.fromEntries(binds.map((s) => [s, api.calls(s)]));
}

// ---- AC3, AC4: while-shown cadences that count views the wrong way.
/**
 * How a host decides a view is shown at `at`, from the app's reports. The right rule: a views/shown from the app
 * itself (not a replica) for a window visible and not minimized, on an awake display, the session unlocked, within
 * the last 10 s, and no views/hidden since. The wrong ones: `ignores-hidden` counts a view shown from its first
 * report on; `counts-every-report` counts any views/shown within 10 s, whatever it says; `shown-until-hidden` counts a
 * view shown from a report until a views/hidden, however long the app has been silent.
 */
export type ShownRule = 'right' | 'ignores-hidden' | 'counts-every-report' | 'shown-until-hidden';
const counts = (r: ShownReport): boolean => r.visible && !r.minimized && r.display_awake && !r.session_locked && !r.replica;
export function shownAt(rule: ShownRule, sent: Sent[], view: string, at: number): boolean {
  const mine = sent.filter((s) => s.report.view === view && s.at <= at);
  const shown = mine.filter((s) => s.kind === 'shown') as (Sent & { report: ShownReport })[];
  if (rule === 'ignores-hidden') return shown.length > 0;
  const lastHidden = Math.max(-Infinity, ...mine.filter((s) => s.kind === 'hidden').map((s) => s.at));
  const live = shown.filter((s) => s.at >= lastHidden && (rule === 'counts-every-report' || counts(s.report)));
  if (rule === 'shown-until-hidden') {
    const last = shown.filter((s) => s.at >= lastHidden).at(-1);
    return last !== undefined && counts(last.report);
  }
  const last = live.at(-1);
  if (!last) return false;
  if (rule === 'right') {
    // The newest report decides: a minimized window's report stops it at once.
    const newest = shown.filter((s) => s.at >= lastHidden).at(-1)!;
    if (!counts(newest.report)) return false;
  }
  return at - last.at < 10 * SECOND;
}
/**
 * A model while-shown cadence on a provider of its own: from `from` to `to`, a second at a time, a call every `every`
 * while a view binding the source counts as shown by `rule`; with `perView`, one cadence per such view.
 */
export async function modelCadence(o: { source: string; answers: Answers; sent: Sent[]; views: string[]; rule: ShownRule; perView: boolean; every: number; from: number; to: number }): Promise<number[]> {
  const c = clock(o.from);
  const api = await metricsApi(c, o.answers);
  const routes = { [API]: api };
  const last = new Map<string, number>();
  for (let at = o.from; at <= o.to; at += SECOND) {
    c.set(at);
    const shown = o.views.filter((v) => shownAt(o.rule, o.sent, v, at));
    const cadences = o.perView ? shown : shown.length ? ['one'] : [];
    for (const k of cadences) {
      const before = last.get(k);
      if (before !== undefined && at - before < o.every) continue;
      last.set(k, at);
      await callDirect(routes, o.source);
    }
  }
  return api.calls(o.source);
}

// ---- AC6: a host that leaves the notice's checking job unscheduled.
/**
 * The notice's checking job on a provider of its own, from `from` to `to`, a second at a time, with every view
 * hidden (so the source's while-shown cadence makes no call): with `every`, the schedule the notice gives the job, a
 * run every `every` that reads the source and, when the value is over `threshold`, sends the notice, once for its
 * key; with `every: null`, the job left unscheduled, which never runs. Its runs, the source's calls and the notices
 * sent.
 */
export async function modelNoticeJob(o: { source: string; answers: Answers; threshold: number; every: number | null; from: number; to: number }): Promise<{ runs: number[]; calls: number[]; sent: number }> {
  const c = clock(o.from);
  const api = await metricsApi(c, o.answers);
  const routes = { [API]: api };
  const runs: number[] = [];
  let sent = 0;
  for (let at = o.from; at <= o.to; at += SECOND) {
    c.set(at);
    if (o.every === null) continue;
    const before = runs.at(-1);
    if (before !== undefined && at - before < o.every) continue;
    runs.push(at);
    const answer = await callDirect(routes, o.source);
    const value = answer.status === 200 ? (JSON.parse(answer.body) as { value: number }).value : null;
    if (value !== null && value > o.threshold && sent === 0) sent = 1;
  }
  return { runs, calls: api.calls(o.source), sent };
}

// ---- AC11: a host that resolves a bound value on replay to the newest batch.
export const newestOnReplay = (h: ExtensionHost) => async (handle: string, _pinned: number) => (await h.boundValues([handle]))[0]!;

// ---- AC13: rollups computed the wrong ways, from the values as they arrived.
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
function stats(xs: number[], mean: (xs: number[]) => number, last: (xs: number[]) => number): Stats {
  return { min: Math.min(...xs), max: Math.max(...xs), mean: mean(xs), last: last(xs), count: xs.length };
}
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
/** `right` as the criterion computes them, beside the three wrong ways. */
export type RollupRule = 'right' | 'median-as-mean' | 'max-as-last' | 'mean-of-means';
/** The minute rollups of each minute's values, in arrival order, and the hour's, as a host with `rule` computes them. */
export function wrongRollups(rule: RollupRule, minutes: number[][]): { minutes: Stats[]; hour: Stats } {
  const mean = rule === 'median-as-mean' ? median : (xs: number[]) => sum(xs) / xs.length;
  const last = rule === 'max-as-last' ? (xs: number[]) => Math.max(...xs) : (xs: number[]) => xs[xs.length - 1]!;
  const mins = minutes.map((xs) => stats(xs, mean, last));
  const all = minutes.flat();
  const hour = stats(all, mean, last);
  if (rule === 'mean-of-means') hour.mean = sum(mins.map((m) => m.mean)) / mins.length;
  return { minutes: mins, hour };
}

// ---- AC14: a host that writes rollups only into the table. Its log holds no reading.rollup event, so a rebuild,
// which reads only the log, has nothing to make the rows from: the real record, rebuilt from such a log.
export async function rebuiltWithoutRollupEvents(): Promise<unknown[]> {
  const dir = tempDir('tableonly');
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: () => 0 });
  try {
    await record.rebuild();
    return (await record.table('rollups')).rows;
  } finally {
    await record.close();
  }
}

// ---- AC16: a host that drops a cited batch at 24 h: the real evidence store's retention, on a copy of the store's
// journal and the cited files, given no citation, as the hub would pass it if it counted none.
export async function dropsCited(w: World, files: string[], now: number): Promise<Record<string, boolean>> {
  const dir = tempDir('dropscited');
  copyFileSync(join(w.evidenceRoot, 'records.jsonl'), join(dir, 'records.jsonl'));
  for (const sha of files) {
    const from = join(w.evidenceRoot, sha.slice(0, 2), sha.slice(2));
    const to = join(dir, sha.slice(0, 2), sha.slice(2));
    mkdirSync(dirname(to), { recursive: true });
    if (existsSync(from)) copyFileSync(from, to);
  }
  const store = await openEvidenceStore({ root: dir, now: () => now });
  await store.retain({ cited: new Set(), archived: new Set() });
  return Object.fromEntries(await Promise.all(files.map(async (sha) => [sha, (await store.get(sha)) !== undefined] as const)));
}
