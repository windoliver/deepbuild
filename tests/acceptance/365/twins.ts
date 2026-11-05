// The wrong programs the criteria name, built here and never in any package (README, Wrong programs). Each runs on
// its scenario's real bytes and the real hub: a storage under the real record, a wrapper over the real host's
// answers, or a model scheduler whose every source call is the real host's own read through the same provider and
// clock. Each test headed `(wrong program)` expects its criterion's judge to fail the twin, naming what the criterion
// says.
import type { ActionCall, ActionResult, ExtensionHost, HttpRequest, ScheduleRow, ScheduleRun } from '../../../packages/extension-host/src/index.ts';
import { testStorage, type Backend, type Connection, type TestStorage } from '../../../packages/record/src/index.ts';
import { approve, hhmm, MINUTE, PRICE, send, type Clock, type Provider, type Seen, type TestStore, type World } from './helpers.ts';

/**
 * AC3: a hub that claims send keys with synchronous=NORMAL. The record's own test VFS under the real record and hub,
 * every commit made at synchronous=NORMAL once `normal` is set (the test sets it after the setup is synced, right
 * before the send's run), so the claim a power cut follows is never synced.
 */
export function claimsAtNormal(): TestStorage & { normal: boolean } {
  const inner = testStorage() as TestStorage & Backend;
  const twin: TestStorage & Backend & { normal: boolean } = {
    name: 'test',
    normal: false,
    get refuseWrites() { return inner.refuseWrites; },
    set refuseWrites(v: boolean) { inner.refuseWrites = v; },
    cutPower: () => inner.cutPower(),
    syncs: () => inner.syncs(),
    open: (path) => inner.open(path),
    commit: (db, mode, work) => inner.commit(db, twin.normal ? 'normal' : mode, work),
    close: (db) => inner.close(db),
  };
  return twin;
}

/** AC5: a hub that reports a call whose handler started and then threw as did not run. */
export function asDidNotRun(h: ExtensionHost): (call: ActionCall) => Promise<ActionResult> {
  return async (call) => {
    const result = await h.callAction(call);
    if (result.status !== 'refused') return result;
    return { status: 'refused', reason: result.reason };
  };
}

/**
 * AC5: a hub that, at its next start, sends again each send it holds with no answer: the request it made, once more
 * (every one the provider took and never answered).
 */
export async function resendsUnanswered(routes: Record<string, Provider>, unanswered: Seen[]): Promise<void> {
  for (const first of unanswered.filter((s) => s.url.startsWith('/send'))) {
    const request: HttpRequest = { url: `https://api.mail.example${first.url}`, method: first.method, headers: { 'content-type': first.headers['content-type'] ?? 'application/json' }, body: first.body };
    await send(routes, request, AbortSignal.timeout(2_000)).catch(() => undefined);
  }
}

/** One model run, as a scheduler that isn't the hub's records it. */
const modelRun = (t: number, verdict: ScheduleRun['verdict'], cause: string | null): ScheduleRun => ({
  run: `run:model${hhmm(t).replace(':', '')}`, schedule: 'ext.market.watch', due: t, dispatched: t, ended: t, verdict, cause, stopped: null, sends: [], changes: [],
});
/** The status of the answer a read got, from its cause (`no price in a 429 answer`), or null for a reading. */
const statusOf = (read: unknown): number | null => {
  const r = read as { status?: string; cause?: string };
  if (r.status === 'reading') return null;
  return Number(/\b(\d{3}) answer/.exec(r.cause ?? '')?.[1] ?? 0);
};

/**
 * AC6: a schedule that keeps running: every five minutes from `from` to before `until`, whatever the last run said, a
 * run reads the price through the real host (which has no key to call with) and records FAIL for anything but a reading.
 */
export async function keepsRunning(h: ExtensionHost, c: Clock, from: number, until: number): Promise<ScheduleRun[]> {
  const runs: ScheduleRun[] = [];
  for (let t = from; t < until; t += 5 * MINUTE) {
    c.set(t);
    const read = await h.readSource(PRICE);
    runs.push(modelRun(t, read.status === 'reading' ? 'PASS' : 'FAIL', read.status === 'reading' ? null : read.cause));
  }
  return runs;
}

/**
 * AC7's wrong schedulers, each reading the price through the real host on the clock, minute by minute from `from` to
 * `until`. As the hub should, a held schedule (a 429 or a 5xx) calls again after the cadence and then at doubling
 * gaps, and after a FAIL the next run waits twice the last gap; they differ from it as named:
 * - `keeps-cadence`: runs every five minutes whatever happens (a 429 or a 5xx is INCONCLUSIVE, any other error FAIL)
 * - `429-as-fail`: holds and spaces as the hub should, but records a rate limit as FAIL (pausing after 5 FAILs)
 * - `pauses-early`: holds and spaces as the hub should, and pauses after 4 FAILs in a row
 */
export type Wrong = 'keeps-cadence' | '429-as-fail' | 'pauses-early';
export async function wrongScheduler(h: ExtensionHost, c: Clock, wrong: Wrong, from: number, until: number): Promise<{ runs: ScheduleRun[]; row: ScheduleRow }> {
  const runs: ScheduleRun[] = [];
  const cadence = 5 * MINUTE;
  const cap = 6 * 3_600_000;
  let next = from;
  let gap = cadence;
  let hold = 0;
  let fails = 0;
  let paused = false;
  for (let t = from; t <= until; t += MINUTE) {
    c.set(t);
    if (paused || t < next) continue;
    const read = await h.readSource(PRICE);
    const status = statusOf(read);
    const limited = status === 429 || (status !== null && status >= 500);
    const verdict: ScheduleRun['verdict'] = status === null ? 'PASS' : limited && wrong !== '429-as-fail' ? 'INCONCLUSIVE' : 'FAIL';
    runs.push(modelRun(t, verdict, status === null ? null : `the provider answered ${status}`));
    if (wrong === 'keeps-cadence') { next = t + cadence; continue; }
    if (status === null) { gap = cadence; hold = 0; fails = 0; next = t + cadence; continue; }
    if (limited) {
      hold = hold ? Math.min(hold * 2, cap) : cadence;
      next = t + hold;
    } else {
      gap = Math.min(gap * 2, cap);
      next = t + gap;
    }
    if (verdict === 'FAIL') fails++;
    if (fails >= (wrong === 'pauses-early' ? 4 : 5)) paused = true;
  }
  const last = runs[runs.length - 1];
  const row: ScheduleRow = {
    name: 'ext.market.watch', extension: 'test/market', state: paused ? 'paused' : 'on', activity: 'idle', words: paused ? 'paused' : 'on',
    next: paused ? null : next, last: last ? { run: last.run, at: last.due, verdict: last.verdict } : null, owner: paused ? 'you' : null,
  };
  return { runs, row };
}

/** AC8: a hub that records a run whose process was killed as FAIL. */
export const killedAsFail = (runs: ScheduleRun[]): ScheduleRun[] => runs.map((r) => (r.verdict === 'INVALID' ? { ...r, verdict: 'FAIL' } : r));
/** AC8: a hub that reads a send as sent when no answer was recorded for it. */
export const sentWithoutAnswer = (runs: ScheduleRun[]): ScheduleRun[] => runs.map((r) => ({ ...r, sends: r.sends.map((s) => (s.outcome === 'unknown' ? { ...s, outcome: 'sent' as const } : s)) }));

/** AC9: a remove that deletes at once: the key leaves the secret store when the list is asked for. */
export function deletesAtOnce(h: ExtensionHost, store: TestStore): ExtensionHost['removeSecret'] {
  return async (connection: Connection, extension: string, name: string, answer?: { yes: string[] }) => {
    if (!answer) store.clear();
    return h.removeSecret(connection, extension, name, answer);
  };
}
/** AC9: a list that leaves one out: the check the plug-in registers is missing from what goes BLOCKED. */
export function leavesOneOut(h: ExtensionHost, left: string): ExtensionHost['removeSecret'] {
  return async (connection: Connection, extension: string, name: string, answer?: { yes: string[] }) => {
    const r = await h.removeSecret(connection, extension, name, answer);
    return { ...r, blocked: r.blocked.filter((b) => b !== left) };
  };
}

/**
 * AC11: a rule matched by recipient kind alone. Every authority ask a send raises while it runs is answered yes, as a
 * rule that names an email recipient and matches any email address would answer it; `stop()` ends it.
 */
export function kindOnlyRule(w: World): { stop(): Promise<void> } {
  let on = true;
  const loop = (async () => {
    while (on) {
      for (const card of await w.asks.needsYou().catch(() => [])) if (card.kind === 'authority') await approve(w, card.ask).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 50));
    }
  })();
  return { stop: async () => { on = false; await loop; } };
}

/** AC12: a list that shows when the schedule was saved as its last run. */
export function lastFromSaved(rows: ScheduleRow[], name: string, savedAt: number): ScheduleRow[] {
  return rows.map((r) => (r.name === name && r.last ? { ...r, last: { ...r.last, at: savedAt } } : r));
}

/**
 * AC13: a hub that, at its next start, sends both runs again: the accepted run's send once more, as it was made, and
 * the queued run's send, as its job would make it.
 */
export async function sendsBothAgain(routes: Record<string, Provider>, seen: Seen[], accepted: string, queued: { run: string; key: string }): Promise<void> {
  const first = seen.find((s) => s.url.startsWith('/send') && s.body.includes(accepted));
  if (first) await send(routes, { url: `https://api.mail.example${first.url}`, method: first.method, headers: { 'content-type': 'application/json' }, body: first.body }).catch(() => undefined);
  const body = JSON.stringify({ to: ['you@example.test'], subject: queued.key, body: `${queued.key}: the relay brief, made by ${queued.run}` });
  await send(routes, { url: 'https://api.mail.example/send', method: 'POST', headers: { 'content-type': 'application/json' }, body }).catch(() => undefined);
}
