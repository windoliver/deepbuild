// The criteria's judges, each returning the problems it found (empty when the criterion holds). Every test runs its
// scenario's outcome through its criterion's judge and expects no problem; the wrong programs in twins.ts must fail
// the same judge with the problem the criterion names: the key (AC3, AC6, AC8), the count (AC6), the run (AC7, AC13),
// the call (AC5), the send's key (AC8), what's missing (AC9) and the second address (AC11).
import type { ScheduleRow, ScheduleRun, SendRow } from '../../../packages/extension-host/src/index.ts';
import type { Event } from '../../../packages/record/src/index.ts';
import { hhmm } from './helpers.ts';

const named = (r: ScheduleRun): string => `the ${hhmm(r.dispatched ?? r.due)} run (${r.run})`;
const at = (r: ScheduleRun): number => r.dispatched ?? r.due;

// ---- AC1, AC4: notices.
/** One notice the watch job tried to send, and whether the criterion lets it out. */
export interface Attempt { subscription: string; cited: string; sent?: string; refused?: string; allowed: boolean; why: string }
/**
 * AC1, AC4: every notice the criterion refuses was refused (deep.notices.send rejected it and no notice.sent names
 * it), and every one it lets out was sent and recorded, citing the reading it cited.
 */
export function judgeNotices(attempts: Attempt[], sent: Event[]): string[] {
  const problems: string[] = [];
  const recorded = new Map(sent.map((e) => [(e.data as { notice: string }).notice, e.data as { notice: string; cites: string[] }]));
  for (const a of attempts) {
    if (!a.allowed && a.sent !== undefined) problems.push(`the notice for ${a.subscription} citing ${a.cited} (${a.why}) was sent as ${a.sent}, not refused`);
    if (!a.allowed && a.sent === undefined && a.refused === undefined) problems.push(`the notice for ${a.subscription} citing ${a.cited} was never tried`);
    if (a.allowed && a.sent === undefined) problems.push(`the notice for ${a.subscription} citing ${a.cited} (${a.why}) was refused: ${a.refused}`);
    if (a.allowed && a.sent !== undefined && !recorded.get(a.sent)?.cites.includes(a.cited)) problems.push(`the notice ${a.sent} has no notice.sent citing ${a.cited}`);
  }
  const allowed = new Set(attempts.filter((a) => a.allowed && a.sent).map((a) => a.sent));
  for (const notice of recorded.keys()) if (!allowed.has(notice)) problems.push(`notice.sent records ${notice}, a notice the criterion refuses`);
  return problems;
}

// ---- AC2: no overlap, one catch-up.
export function judgeOverlap(runs: ScheduleRun[], most: number): string[] {
  const problems: string[] = [];
  const ran = runs.filter((r) => r.dispatched !== null).sort((a, b) => a.dispatched! - b.dispatched!);
  for (let i = 1; i < ran.length; i++) {
    const before = ran[i - 1]!;
    if (before.ended === null || before.ended > ran[i]!.dispatched!) problems.push(`${named(ran[i]!)} started while ${named(before)} was still running`);
  }
  if (most > 1) problems.push(`the plug-in had ${most} watch jobs running at once`);
  return problems;
}
/** AC2: from `from` (the wake, or the end of a long run) to before `until`, the schedule ran once. */
export function judgeCatchUp(runs: ScheduleRun[], from: number, until: number, what: string): string[] {
  const woke = runs.filter((r) => r.dispatched !== null && r.dispatched >= from && r.dispatched < until);
  if (woke.length === 1) return [];
  return [`${what}, the schedule ran ${woke.length} times before ${hhmm(until)}${woke.length ? `: ${woke.map(named).join(', ')}` : ''}, not once`];
}

// ---- AC3: a send goes out once.
export function judgeOnce(key: string, reached: number): string[] {
  return reached === 1 ? [] : [`the send ${key} reached the provider ${reached} times, not once`];
}

// ---- AC5: actions.
/** AC5's schema refusal: no action.entered for its request, and it reached the agent as did not run. */
export function judgeRefusedBySchema(result: unknown, entered: Event[], request: string): string[] {
  const problems: string[] = [];
  const mine = entered.filter((e) => (e.data as { request?: string }).request === request);
  if (mine.length) problems.push(`the refused call ${request} recorded action.entered ${mine.map((e) => (e.data as { call: string }).call).join(', ')}`);
  const r = result as { status?: string; started?: unknown } | null;
  if (r?.status !== 'refused' || r.started !== undefined) problems.push(`the refused call ${request} reached the agent as ${JSON.stringify(result)}, not as did not run`);
  return problems;
}
/**
 * AC5's throwing handler: action.reported holds the alert's write in `changed`, `verified: unverified` and the error,
 * and the call reached the agent as one that ran: refused with `started`, naming its call.
 */
export function judgeThrew(call: string, result: unknown, reported: Event[], wrote: string[]): string[] {
  const problems: string[] = [];
  const r = result as { status?: string; started?: unknown; call?: unknown } | null;
  if (r?.status !== 'refused' || r.started !== true || r.call !== call) problems.push(`the call ${call}, whose handler wrote and then threw, reached the agent as ${JSON.stringify(result)}: as did not run`);
  const mine = reported.filter((e) => (e.data as { call: string }).call === call);
  if (mine.length !== 1) problems.push(`the call ${call} has ${mine.length} action.reported, not one`);
  const d = mine[0]?.data as { changed: string[]; verified: string; error: string | null } | undefined;
  if (d && !d.changed.some((c) => wrote.some((x) => c.includes(x)))) problems.push(`the call ${call}'s action.reported changed ${JSON.stringify(d.changed)} leaves out the write ${wrote.join(' (or ')}${wrote.length > 1 ? ')' : ''}`);
  if (d && d.verified !== 'unverified') problems.push(`the call ${call}'s action.reported is verified: ${d.verified}, not unverified`);
  if (d && !d.error) problems.push(`the call ${call}'s action.reported has no error`);
  return problems;
}
/** AC5's send whose provider never answered: after the restart it reads unknown, and one request reached the provider. */
export function judgeUnanswered(call: string, key: string, row: SendRow | undefined, reached: number): string[] {
  const problems: string[] = [];
  if (row?.outcome !== 'unknown') problems.push(`the call ${call}'s send ${key} reads ${row ? row.outcome : 'nothing'} after the restart, not unknown`);
  if (reached !== 1) problems.push(`the call ${call}'s send ${key} reached the provider ${reached} times: it was sent again`);
  return problems;
}

// ---- AC6: a missing key.
/** AC6: in the 24 hours after the key went, one run, BLOCKED and naming the key; none after it. */
export function judgeMissingKey(runs: ScheduleRun[], from: number, until: number, key: string): string[] {
  const after = runs.filter((r) => at(r) >= from && at(r) < until);
  const fails = after.filter((r) => r.verdict === 'FAIL').length;
  const blocked = after.filter((r) => r.verdict === 'BLOCKED');
  const problems: string[] = [];
  if (after.length !== 1) problems.push(`the schedule recorded ${after.length} runs in the ${(until - from) / 3_600_000} hours after the key went (${fails} FAIL, ${blocked.length} BLOCKED), not one`);
  if (blocked.length !== 1) problems.push(`${blocked.length} BLOCKED verdicts on the schedule's claim, not one`);
  for (const b of blocked) if (!b.cause?.includes(key)) problems.push(`${named(b)} is BLOCKED with cause ${JSON.stringify(b.cause)}, which doesn't name ${key}`);
  return problems;
}

// ---- AC7: INCONCLUSIVE and FAIL spacing.
/**
 * AC7's 429s: the 10:00 run is INCONCLUSIVE, the source is called at 10:00, 10:05, 10:15 and 10:35 and at no other
 * time up to 10:35, a run passes once it answers, and no run is FAIL.
 */
export function judgeRateLimit(runs: ScheduleRun[], calls: number[], times: { first: number; calls: number[]; resumedBy: number }): string[] {
  const problems: string[] = [];
  const first = runs.find((r) => at(r) === times.first);
  if (!first) problems.push(`no run at ${hhmm(times.first)}`);
  else if (first.verdict !== 'INCONCLUSIVE') problems.push(`${named(first)} reads ${first.verdict}, not INCONCLUSIVE`);
  const last = times.calls[times.calls.length - 1]!;
  const held = calls.filter((t) => t >= times.first && t <= last);
  for (const t of held) if (!times.calls.includes(t)) problems.push(`a call to the source at ${hhmm(t)}${runAt(runs, t)} while the schedule should hold`);
  for (const t of times.calls) if (!held.includes(t)) problems.push(`no call to the source at ${hhmm(t)}`);
  for (const r of runs) if (r.verdict === 'FAIL') problems.push(`${named(r)} reads FAIL`);
  if (!runs.some((r) => at(r) >= last && at(r) <= times.resumedBy && r.verdict === 'PASS')) problems.push(`no run passed between ${hhmm(last)} and ${hhmm(times.resumedBy)}: the schedule didn't resume after the call that got an answer`);
  return problems;
}
const runAt = (runs: ScheduleRun[], t: number): string => {
  const r = runs.find((x) => at(x) === t);
  return r ? ` (${r.run})` : '';
};
/**
 * AC7's 400s: runs end FAIL at exactly the times given, no other run from the first to `until`, and the schedule is
 * paused with you as the claim's owner.
 */
export function judgeFailSpacing(runs: ScheduleRun[], times: number[], until: number, row: ScheduleRow | undefined): string[] {
  const problems: string[] = [];
  const window = runs.filter((r) => at(r) >= times[0]! && at(r) <= until && r.dispatched !== null);
  for (const r of window) {
    if (!times.includes(at(r))) problems.push(`${named(r)} ran${r.verdict ? ` (${r.verdict})` : ''} where the schedule should wait or be paused`);
    else if (r.verdict !== 'FAIL') problems.push(`${named(r)} reads ${r.verdict}, not FAIL`);
  }
  for (const t of times) if (!window.some((r) => at(r) === t)) problems.push(`no run at ${hhmm(t)}: the schedule ${window.filter((r) => r.verdict === 'FAIL').length < times.length ? 'paused or waited before its fifth FAIL' : 'missed it'}`);
  if (row?.state !== 'paused') problems.push(`after the fifth FAIL the schedule reads ${row?.state ?? 'nothing'}, not paused`);
  if (row?.owner !== 'you') problems.push(`the claim's owner reads ${JSON.stringify(row?.owner)}, not you`);
  return problems;
}

// ---- AC8: a killed run.
export type Point = 'before the request' | 'after the request, before the answer' | 'after the answer';
const OUTCOME: Record<Point, 'not sent' | 'unknown' | 'sent'> = { 'before the request': 'not sent', 'after the request, before the answer': 'unknown', 'after the answer': 'sent' };
/** AC8: the run whose plug-in process was killed is INVALID, and its send reads as the point says. */
export function judgeKilled(point: Point, run: ScheduleRun | undefined, key: string): string[] {
  if (!run) return [`no run started the send ${key}`];
  const problems: string[] = [];
  if (run.verdict !== 'INVALID') problems.push(`the run that started the send ${key}, killed ${point}, reads ${run.verdict}, not INVALID`);
  const send = run.sends.find((s) => s.key === key);
  if (!send) problems.push(`the run killed ${point} doesn't say whether its send ${key} went out`);
  else if (send.outcome !== OUTCOME[point]) problems.push(`the send ${key}, killed ${point}, reads ${send.outcome}${send.outcome === 'sent' ? ' with no recorded answer' : ''}, not ${OUTCOME[point]}`);
  return problems;
}

// ---- AC9: removing the key.
/** AC9: the list names exactly the three, and the key stayed in the OS secret store until your yes. */
export function judgeRemoval(listed: string[], expected: string[], heldBeforeYes: boolean): string[] {
  const problems: string[] = [];
  for (const e of expected) if (!listed.includes(e)) problems.push(`the list of what goes BLOCKED leaves out ${e}`);
  for (const l of listed) if (!expected.includes(l)) problems.push(`the list of what goes BLOCKED names ${l}, which doesn't use the key`);
  if (!heldBeforeYes) problems.push('the key left the OS secret store before your yes: the remove deleted it at once');
  return problems;
}

// ---- AC11: a standing rule for sends.
export interface SendCase { what: string; key: string; reached: number; asks: string[]; cards: string[]; names: string }
/** AC11's covered sends: each went out once with no ask, each recording its plan's digest, the digests different. */
export function judgeCovered(cases: { key: string; reached: number; asks: number; plan: string | undefined }[]): string[] {
  const problems: string[] = [];
  for (const c of cases) {
    if (c.reached !== 1) problems.push(`the send ${c.key} reached the provider ${c.reached} times, not once`);
    if (c.asks) problems.push(`the send ${c.key} raised ${c.asks} asks under the standing rule`);
    if (!c.plan) problems.push(`the send ${c.key} records no plan digest`);
  }
  const plans = cases.map((c) => c.plan).filter(Boolean);
  if (new Set(plans).size !== plans.length) problems.push(`two sends with different content record the same plan digest ${plans[0]}`);
  return problems;
}
/** AC11's changed sends: one authority ask naming what changed, and nothing reached the provider without your answer. */
export function judgeChanged(c: SendCase): string[] {
  const problems: string[] = [];
  if (c.reached) problems.push(`the send ${c.key} (${c.what}) went out under the rule ${c.reached} times with no answer from you`);
  if (c.asks.length !== 1) problems.push(`the send ${c.key} (${c.what}) raised ${c.asks.length} authority asks, not one`);
  else if (!c.cards[0]!.includes(c.names)) problems.push(`the ask for ${c.key} (${c.what}) doesn't name ${c.names}`);
  return problems;
}

// ---- AC12: the last result.
export function judgeLast(row: ScheduleRow | undefined, ranAt: number, editedAt: number): string[] {
  if (!row?.last) return [`the row shows no last result; the schedule last ran at ${hhmm(ranAt)}`];
  if (row.last.at === editedAt) return [`the row shows ${hhmm(editedAt)}, when the schedule was edited, as the last run`];
  if (row.last.at !== ranAt) return [`the row shows ${hhmm(row.last.at)} as the last run, not ${hhmm(ranAt)}`];
  return [];
}

// ---- AC13: the hub stopped with one run accepted and one queued.
export function judgeStopped(accepted: { run: string; key: string; reached: number; resumed: number; after: ScheduleRun | undefined }, queued: { run: string; reached: number; dispatched: number; after: ScheduleRun | undefined }): string[] {
  const problems: string[] = [];
  if (accepted.reached !== 1) problems.push(`the accepted run ${accepted.run}'s send ${accepted.key} reached the provider ${accepted.reached} times, not once`);
  if (accepted.resumed !== 1) problems.push(`the accepted run ${accepted.run} was resumed ${accepted.resumed} times after the restart, not once`);
  if (!accepted.after || accepted.after.ended === null) problems.push(`the accepted run ${accepted.run} never ended after the restart`);
  if (queued.reached) problems.push(`the queued run ${queued.run} was sent ${queued.reached} times though it was stopped before dispatch`);
  if (queued.dispatched) problems.push(`the queued run ${queued.run} was dispatched ${queued.dispatched} times after the restart`);
  if (queued.after?.stopped !== 'before dispatch') problems.push(`the queued run ${queued.run} reads ${JSON.stringify(queued.after ? { stopped: queued.after.stopped, verdict: queued.after.verdict } : null)}, not stopped before dispatch`);
  return problems;
}

