// The criteria's judges, each returning the problems it found (empty when the criterion holds). Every test runs its
// scenario's outcome through its criterion's judge and expects no problem; the wrong programs in twins.ts must fail
// the same judge with the problem naming what the criterion says: the source (AC2, AC3), the view (AC4), the notice
// (AC6), the count (AC9), the value (AC11, AC16), the field (AC13), the table (AC14, AC17) and the cited batch (AC16).
import { count, hms, SECOND } from './helpers.ts';

// ---- AC1, AC2: Read now.
/** What Read now found at `at`: each bound source, when it was last answered and, for one the quota refuses, until when. */
export interface ReadNowCase {
  at: number;
  /** Source → its provider calls (times). */
  calls: Record<string, number[]>;
  /** Sources answered in the last 2 s before `at`, with the time of that answer: Read now keeps it. */
  kept: Record<string, number>;
  /** Sources whose quota is spent, with the time it can run again. */
  quota: Record<string, number>;
  /** Sources Read now calls: once each, at `at`. */
  ready: string[];
}
/** AC1, AC2: one call to each ready source at Read now, none to a source answered in the last 2 s or inside its quota window. */
export function judgeReadNow(c: ReadNowCase): string[] {
  const problems: string[] = [];
  const at = (source: string) => (c.calls[source] ?? []).filter((x) => x >= c.at && x < c.at + SECOND);
  for (const [source, answered] of Object.entries(c.kept)) {
    for (const x of at(source)) problems.push(`Read now at ${hms(c.at)} called ${source} again at ${hms(x)}, ${(c.at - answered) / SECOND} s after its answer at ${hms(answered)}`);
  }
  for (const [source, until] of Object.entries(c.quota)) {
    for (const x of (c.calls[source] ?? []).filter((y) => y >= c.at && y < until)) problems.push(`Read now at ${hms(c.at)} called ${source} at ${hms(x)}, inside its quota window until ${hms(until)}`);
  }
  for (const source of c.ready) {
    const n = at(source).length;
    if (n !== 1) problems.push(`Read now at ${hms(c.at)} called ${source} ${n} times, not once`);
  }
  return problems;
}

// ---- AC3, AC4, AC7: while shown.
/** AC3, AC7: `n` calls of the source in [from, to), plus or minus one. */
export function judgeCalls(source: string, calls: number[], from: number, to: number, n: number, what: string): string[] {
  const got = calls.filter((x) => x >= from && x < to).length;
  return Math.abs(got - n) <= 1 ? [] : [`${source} made ${got} calls from ${hms(from)} to ${hms(to)} ${what}, not ${n} plus or minus one`];
}
/** AC3: no call of the source at or after `from`. */
export function judgeNoneFrom(source: string, calls: number[], from: number, what: string): string[] {
  const late = calls.filter((x) => x >= from);
  return late.length ? [`${source} was called at ${late.map(hms).join(', ')}, ${what}`] : [];
}
/** AC4: no call of the source after `by`, since the view no longer counts as shown; the problem names the view. */
export function judgeStopped(view: string, source: string, calls: number[], by: number, why: string): string[] {
  const late = calls.filter((x) => x > by);
  return late.length ? [`${view} was counted as shown ${why}: ${source} was called at ${late.map(hms).join(', ')}, after ${hms(by)}`] : [];
}

// ---- AC5: refusals at install.
export function judgeRefused(refusal: string | null, what: string, names: { label: string; test: RegExp }[]): string[] {
  if (refusal === null) return [`${what} installed and loaded; it is refused at install`];
  return names.filter((n) => !n.test.test(refusal)).map((n) => `${what} was refused without naming ${n.label}: ${refusal}`);
}

// ---- AC6: the notice's own schedule.
export interface NoticeCase {
  /** The notice: its key and your words. */
  key: string; words: string;
  /** The job's runs' dispatch times while every view was hidden, in [from, to). */
  runs: number[]; from: number; to: number;
  /** The source's calls in [from, to). */
  calls: number[];
  /** notice.sent events for the notice. */
  sent: number;
}
export function judgeNoticeSchedule(c: NoticeCase): string[] {
  const problems: string[] = [];
  const runs = c.runs.filter((x) => x >= c.from && x < c.to).length;
  const calls = c.calls.filter((x) => x >= c.from && x < c.to).length;
  if (Math.abs(runs - 6) > 1) problems.push(`the notice "${c.key}" (${c.words}): its checking job ran ${runs} times in the minute every view was hidden, not every 10 s`);
  if (Math.abs(calls - 6) > 1) problems.push(`the notice "${c.key}" (${c.words}): its source was read ${calls} times in the minute every view was hidden, not every 10 s`);
  if (c.sent !== 1) problems.push(`the notice "${c.key}" (${c.words}) notified ${c.sent} times for the recorded 3%, not once`);
  return problems;
}

// ---- AC8, AC9: the 500-series day.
/** AC9: no event per value or per series. A kind with more than three events a call is one per value or per series. */
export function judgeEventsPerCall(byKind: Record<string, number>, calls: number): string[] {
  return Object.entries(byKind).filter(([, n]) => n > 3 * calls).map(([kind, n]) => `the day added ${count(n)} ${kind} events for its ${count(calls)} calls: one per value or per series`);
}

// ---- AC11: replay at a pinned log position.
export function judgeReplay(handle: string, at: string, got: { value: number | null; status: string }, want: number): string[] {
  return got.value === want && got.status !== 'missing' ? [] : [`the bound value ${handle} pinned to ${at} shows ${String(got.value)} (${got.status}), not ${want}`];
}

// ---- AC13: rollups.
export interface Stats { min: number; max: number; mean: number; last: number; count: number }
export function judgeRollup(window: string, series: string, got: Partial<Stats> | undefined, want: Partial<Stats>): string[] {
  if (!got) return [`the ${window} rollup has no ${series}`];
  return (Object.keys(want) as (keyof Stats)[]).filter((field) => got[field] !== want[field])
    .map((field) => `the ${window} rollup's ${field} of ${series} is ${String(got[field])}, not ${String(want[field])}`);
}

// ---- AC14, AC17: the rollups table.
export function judgeRebuilt(table: string, before: unknown[], after: unknown[]): string[] {
  const a = before.map((r) => JSON.stringify(r));
  const b = after.map((r) => JSON.stringify(r));
  if (a.length !== b.length) return [`${table} held ${count(a.length)} rows before the rebuild and ${count(b.length)} after it`];
  const differ = a.findIndex((r, i) => r !== b[i]);
  return differ < 0 ? [] : [`${table}'s row ${differ + 1} differs after the rebuild: ${a[differ]} became ${b[differ]}`];
}
export function judgeRows(table: string, rows: number, want: number): string[] {
  return rows === want ? [] : [`${table} holds ${count(rows)} rows for the 30 days, not ${count(want)}`];
}

// ---- AC15, AC16: what a value resolves to as its files age, and what citations keep.
export interface Resolved { status: string; value: number | null; span?: string; shown?: string }
/** AC15, AC16: the value at its pinned position resolves as the day calls for. */
export function judgeAged(handle: string, day: string, got: Resolved, want: { status: 'rollup'; span: 'minute' | 'hour'; value: number } | { status: 'missing' }): string[] {
  if (want.status === 'missing') {
    const problems: string[] = [];
    if (got.status !== 'missing' || got.value !== null) problems.push(`${handle} on ${day} shows ${String(got.value)} (${got.status}), not missing`);
    if (!/^[-–—]$/.test(String(got.shown ?? ''))) problems.push(`${handle} on ${day} is shown as ${JSON.stringify(got.shown)}, not a dash`);
    return problems;
  }
  if (got.status === 'rollup' && got.span === want.span && got.value === want.value) return [];
  return [`${handle} on ${day} shows ${String(got.value)} (${got.status}${got.span ? `, ${got.span}` : ''}), not its ${want.span} rollup's last, ${want.value}, marked rollup`];
}
/** AC15, AC16: a cited batch still opens: its file is held and a value pinned to it resolves through it. */
export function judgeCitedOpens(by: string, batch: string, day: string, held: boolean, got: Resolved, want: number): string[] {
  const problems: string[] = [];
  if (!held) problems.push(`the ${batch} batch the ${by} cites is gone on ${day}`);
  if (got.status !== 'reading' || got.value !== want) problems.push(`a value pinned to the ${batch} batch the ${by} cites shows ${String(got.value)} (${got.status}) on ${day}, not ${want} through the batch`);
  return problems;
}
