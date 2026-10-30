// AC9 #120.a3880a7d, its second half, redrafted blind (AC9-IDLE-REDRAFT.md): on the reference Mac, in the local
// preflight, compared with the merge base, an idle session costs no CPU while it waits.
//
// The idle session is #120's own: a Claude Code session whose agent said "I'll check the deploy again in 20 minutes."
// and stopped. It is idle, and it waits for that wake-up: its waiter (DeepBuild's asyncRewake entry, #25) is waiting
// and the wake-up is recorded with the quote (design: Commands end). Before any reading counts, the wait must be that
// one (the wake-up recorded, the waiter live, no wake while it is young), so a program with nothing to wait for can't
// pass by costing nothing.
//
// What the session costs is the CPU of every process DeepBuild runs for it while it is idle: the process groups of its
// live background entries (the waiter among them), which must use none (design, Numbers: "each Claude Code waiter ...
// no CPU while it waits"), and the hub's process group, whose work for the waiting session must be none beyond what the
// merge base's hub spends on the same idle session. Both sides are the same driver on their own builds, sampled in the
// same windows: five windows of 10 s, `ps` cputime before and after (it counts hundredths of a second), so "none" is at
// most one hundredth a window. The hub is compared window by window: its CPU beyond the merge base's in the same window
// stays under 50% of the merge base's median (the design's regression rule) plus one hundredth for `ps`'s rounding;
// five runs are judged by the design's rule
// (helpers' judge). Readings count only on a reference Mac in a fit state; anywhere else, or loaded, the test skips as
// INCONCLUSIVE with the readings, never PASS. A missing merge base is BLOCKED (helpers' mergeBase).
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC9, allEvents, CURRENT, awaitEvent, begin, cleanup, edits, evShown, groupOf, hubWithSetup, inconclusiveIfLoaded, isDeepBuild, judge, load, makeHome, median,
  mergeBase, newSession, processes, QUOTE, REPO, sleep, stop, waitFor, wakeAfter, wakeupEvents, type Checkout, type Claude, type Ev, type Hub, type Proc,
  type Session,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const THIS_FILE = 'tests/acceptance/120/budgets-idle-redraft.test.ts';
const WINDOW_MS = 10_000;
const RUNS = 5;
/** The stop's own work (its records, the transcript's tail) is not idle time. */
const SETTLE_MS = 10_000;
/** `ps` counts hundredths of a second, so one hundredth in a window is rounding, not use. */
const TICK_S = 0.01;
const s2 = (x: number) => x.toFixed(2);

interface Side { label: string; hub: Hub; s: Session; claude: Claude; wakeup?: Ev | undefined }

/** A session that works, says the promise as its last words and stops; its waiter is waiting. */
async function idleSession(co: Checkout): Promise<Side> {
  const h = makeHome(co);
  const hub = await hubWithSetup(h);
  const s = newSession(h);
  const { claude } = await begin(h, s, 'Deploy the fix and make sure it is up.');
  await edits(claude, s);
  const before = (await allEvents(hub)).length;
  const fired = await stop(claude, s, QUOTE);
  if (fired.blocked) throw Error(`BLOCKED (${co.label}): the stop must go through (nothing to send back), it was held: ${fired.blocked}`);
  await awaitEvent(hub, s, (e) => e.kind === 'agent.stop' && e.log_pos > before, 'the stop');
  await waitFor(async () => (await claude.liveWaiters(s.id)).length > 0 || undefined, 30_000, `${s.id}'s waiter (${co.label}), waiting once its stop went through`);
  const wakeup = await waitFor(async () => wakeupEvents(await allEvents(hub), s.id)[0], 15_000, 'the wake-up').catch(() => undefined);
  return { label: co.label, hub, s, claude, wakeup };
}
/** The process groups DeepBuild's live background entries of the session run in (each entry is its own group). */
async function entryGroups(side: Side, table: Proc[]): Promise<number[]> {
  return (await side.claude.background())
    .filter((r) => isDeepBuild(r.command) && r.session === side.s.id && r.ended === null && groupOf(r.pid, table).length > 0)
    .map((r) => r.pid);
}
/** Each process of the groups and the CPU it had used, from one `ps` table. */
const cpuOf = (pgids: number[], table: Proc[]): Map<number, number> => new Map(pgids.flatMap((g) => groupOf(g, table)).map((p) => [p.pid, p.cpuS]));
/** CPU used between two readings; a process that appeared between them counts whole. */
const used = (a: Map<number, number>, b: Map<number, number>): number => [...b].reduce((sum, [pid, cpu]) => sum + Math.max(0, cpu - (a.get(pid) ?? 0)), 0);

describe(`${AC9} Budgets, on the reference Mac in the local preflight, compared with the merge base: an idle session costs no CPU while it waits`, () => {
  it(`${AC9} in the local preflight: a check lane in scripts/lanes.mjs runs ${THIS_FILE} with --no-file-parallelism`, async () => {
    const { checks } = (await import(join(REPO, 'scripts/lanes.mjs'))) as { checks: { name: string; commands: string[][] }[] };
    const covers = (cmd: string[]): boolean => {
      if (!cmd.some((a) => /vitest/.test(a)) || !cmd.includes('--no-file-parallelism')) return false;
      const i = cmd.indexOf('--root');
      const root = i >= 0 ? cmd[i + 1]!.replace(/\/$/, '') : '';
      const valued = new Set(['--exclude', '--root', '-t', '--testNamePattern', '--config', '--project']);
      const paths = cmd.filter((a, k) => k > cmd.indexOf('run') && !a.startsWith('-') && !valued.has(cmd[k - 1]!));
      const under = (p: string) => { const full = root ? `${root}/${p}` : p; return THIS_FILE === full || THIS_FILE.startsWith(full.endsWith('/') ? full : `${full}/`); };
      return paths.length ? paths.some(under) : root !== '' && THIS_FILE.startsWith(`${root}/`);
    };
    const lanes = checks.filter((c) => c.commands.some(covers)).map((c) => c.name);
    expect(lanes, `${AC9} some check lane of the local preflight runs ${THIS_FILE} one file at a time (--no-file-parallelism); lanes: ${checks.map((c) => c.name).join(', ')}`).not.toEqual([]);
  });

  it(`${AC9} a session idle and waiting for its promised check uses no CPU in its waiter, and its hub spends no more than the merge base's on the same idle session, over five 10 s windows`, async (ctx) => {
    const base = await mergeBase();
    const cur = await idleSession(CURRENT);
    // The instrument: the session is idle and waits for the promised check, the wait #120 adds.
    expect(cur.wakeup, `${AC9} the idle session waits for its promised check: ${JSON.stringify(QUOTE)} is recorded as a wake-up once it stopped; the session's events: ${(await allEvents(cur.hub)).filter((e) => e.session === cur.s.id).map((e) => e.kind).join(', ')}`).toBeDefined();
    const old = await idleSession(base);
    await sleep(SETTLE_MS);

    const idleFrom = Date.now();
    const loads = [load()];
    const sides = [cur, old];
    const readings = sides.map(() => ({ entries: [] as number[], hub: [] as number[], groups: 0 }));
    for (let run = 0; run < RUNS; run++) {
      const t0 = processes();
      const groups = await Promise.all(sides.map((side) => entryGroups(side, t0)));
      const a = sides.map((side, i) => ({ entries: cpuOf(groups[i]!, t0), hub: cpuOf([side.hub.pid], t0) }));
      await sleep(WINDOW_MS);
      const t1 = processes();
      sides.forEach((side, i) => {
        readings[i]!.entries.push(used(a[i]!.entries, cpuOf(groups[i]!, t1)));
        readings[i]!.hub.push(used(a[i]!.hub, cpuOf([side.hub.pid], t1)));
        readings[i]!.groups = Math.max(readings[i]!.groups, groups[i]!.length);
      });
      loads.push(load());
    }
    const [now, then] = readings as [typeof readings[0], typeof readings[0]];
    const text = `this checkout: entries ${now.entries.map(s2).join(', ')} s, hub ${now.hub.map(s2).join(', ')} s; ${old.label}: entries ${then.entries.map(s2).join(', ')} s, hub ${then.hub.map(s2).join(', ')} s (CPU per ${WINDOW_MS / 1000} s window; loads ${loads.map((l) => l.one.toFixed(1)).join(', ')} on ${loads[0]!.cores} cores)`;
    console.log(`${AC9} idle readings: ${text}`);

    // Still the same wait: the waiter lived through every window and nothing woke the session.
    expect(now.groups, `${AC9} the session's waiter waited through the windows (DeepBuild's live background entries of the session): ${text}`).toBeGreaterThan(0);
    expect((await cur.claude.liveWaiters(cur.s.id)).length, `${AC9} the waiter still waits after the windows`).toBeGreaterThan(0);
    expect(wakeAfter(cur.claude, cur.s, idleFrom - SETTLE_MS), `${AC9} nothing woke the session while it was idle: ${JSON.stringify(cur.claude.wakes)}`).toBeUndefined();
    expect(wakeupEvents(await allEvents(cur.hub), cur.s.id).length, `${AC9} the wake-up is still recorded: ${cur.wakeup ? evShown(cur.wakeup) : ''}`).toBeGreaterThan(0);

    inconclusiveIfLoaded(ctx, loads, `${AC9} idle CPU readings only: ${text}`);
    const entries = judge(`${AC9} the waiting session's DeepBuild entries, the waiter among them (CPU s per window)`, now.entries, TICK_S * 1.5, 's');
    // Paired by window, so what both hubs did at once (load, their own timers) cancels: the CPU this checkout's hub
    // spent beyond the merge base's, against half the merge base's median (the design's 50%) plus one hundredth.
    const extra = now.hub.map((x, i) => x - then.hub[i]!);
    const hubLimit = 0.5 * median(then.hub) + TICK_S * 1.5;
    const hub = judge(`${AC9} the hub's CPU with the waiting session beyond the merge base's in the same window, against 50% of the merge base's median ${s2(median(then.hub))} s plus one hundredth (CPU s per window)`, extra, hubLimit, 's');
    console.log(`${entries.verdict}: ${entries.text}\n${hub.verdict}: ${hub.text}`);
    expect(entries.verdict, `${AC9} an idle session costs no CPU while it waits: ${entries.text}; ${text}`).not.toBe('FAIL');
    expect(hub.verdict, `${AC9} compared with the merge base, the hub spends no CPU on the idle session: ${hub.text}; ${text}`).not.toBe('FAIL');
    if (entries.verdict === 'INCONCLUSIVE' || hub.verdict === 'INCONCLUSIVE') ctx.skip(`INCONCLUSIVE: ${entries.verdict}: ${entries.text}; ${hub.verdict}: ${hub.text}; ${text}`);
    for (const side of sides) await side.claude.end();
  }, 2_400_000);
});
