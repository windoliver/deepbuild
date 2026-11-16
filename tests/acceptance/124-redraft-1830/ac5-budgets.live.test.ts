// Criterion 5's timings, blind redraft for #1830 of ../124/ac5-budgets.live.test.ts (README): on the reference Mac, a
// replica launches in under 2 s, an action's round trip takes under 50 ms plus its wait, a 2,000-node snapshot under
// 20 ms, and a replica stays under 500 MB. Each is five readings after a warm-up, and each reading's run reads the
// one-minute load average at its start and at its end. scripts/benchmark.mjs's judgeLimit judges the five with their
// loads: PASS only on a reference Mac on mains power, Low Power Mode off and the thermal state nominal, with no run's load
// above the core count and all five within the limit; anything else fails here, as FAIL or as INCONCLUSIVE with
// judgeLimit's reason, and never passes. The merge-base comparison is the perf lane's four tasks (../124/ac5-lease.test.ts).
//
// Skipped unless DEEP_DRIVE_BUDGETS=1: the local preflight's perf step sets it on the reference Mac. It spends no plan.
//   DEEP_DRIVE_BUDGETS=1 npx vitest run --root tests/acceptance/124-redraft-1830 ac5-budgets.live.test.ts
import { spawnSync } from 'node:child_process';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ACTION_MS, Drive, ID, LAUNCH_MS, MEMORY_BYTES, PANEL, REPO, RUNS, SNAPSHOT_MS, SNAPSHOT_NODES, buildDrive, cleanup, launch, must, nodesOf, readRun,
  replay, requireMacos, sleep, type Obj,
} from '../124/helpers.ts';

afterEach(cleanup, 60_000);
const OPTED = process.env.DEEP_DRIVE_BUDGETS === '1';

/** The one-minute load average at a run's start and at its end. */
interface Load { start: number; end: number }
const oneMinuteLoad = (): number => loadavg()[0]!;

/** judgeLimit on five readings, the fingerprint now, and each reading's run's load, in the runs' order. */
async function judged(limit: number, runs: number[], loads: Load[]): Promise<Obj> {
  const bench = await import(join(REPO, 'scripts', 'benchmark.mjs')) as { fingerprint: () => Obj; judgeLimit: (o: Obj) => Obj };
  return bench.judgeLimit({ limit, runs, fingerprint: bench.fingerprint(), loads });
}
/** Only PASS passes; FAIL fails as FAIL, and INCONCLUSIVE or BLOCKED fails as INCONCLUSIVE with judgeLimit's reason. */
const holds = (r: Obj, what: string) => expect(r.status, `${r.status === 'FAIL' ? 'FAIL' : 'INCONCLUSIVE'} ${what}: ${JSON.stringify(r)}`).toBe('PASS');
const rss = (pid: number): number => Number(spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim()) * 1024 || 0;

describe.skipIf(!OPTED)(`${ID.budgets} budgets on the reference Mac`, () => {
  it(`${ID.budgets} a replica launches in under 2 s: from spawning deep-drive to launch's answer, five times after a warm-up`, async () => {
    requireMacos();
    buildDrive();
    const once = async (): Promise<{ ms: number; load: Load }> => {
      const start = oneMinuteLoad();
      const at = performance.now();
      const drive = await Drive.start();
      await launch(drive, { from: 'fixture', panel: PANEL.form, clock: 'virtual' });
      const ms = performance.now() - at;
      const load = { start, end: oneMinuteLoad() };
      await drive.stop();
      return { ms, load };
    };
    await once();
    const runs: number[] = [];
    const loads: Load[] = [];
    for (let i = 0; i < 5; i++) {
      const { ms, load } = await once();
      runs.push(ms);
      loads.push(load);
    }
    holds(await judged(LAUNCH_MS, runs, loads), 'launch');
  }, 600_000);

  it(`${ID.budgets} an action's round trip takes under 50 ms plus its wait: five clicks on a field already visible, enabled and still`, async () => {
    requireMacos();
    const drive = await Drive.start();
    const replica = await launch(drive, { from: 'fixture', panel: PANEL.form, clock: 'virtual' });
    const click = { call: 'act', replica, locator: { label: 'Email' }, act: { kind: 'click' } };
    await must(drive, click);
    const runs: number[] = [];
    const loads: Load[] = [];
    for (let i = 0; i < 5; i++) {
      const start = oneMinuteLoad();
      const { reply, ms } = await drive.call(click);
      loads.push({ start, end: oneMinuteLoad() });
      expect(reply.ok, JSON.stringify(reply)).toBe(true);
      expect(typeof reply.waited_ms, 'each action answers how long it waited').toBe('number');
      runs.push(ms - (reply.waited_ms as number));
    }
    holds(await judged(ACTION_MS, runs, loads), 'action round trip less its wait');
  }, 600_000);

  it(`${ID.budgets} a 2,000-node snapshot takes under 20 ms`, async () => {
    requireMacos();
    const drive = await Drive.start();
    const replica = await launch(drive, { from: 'fixture', panel: PANEL.many, clock: 'virtual' });
    const see = { call: 'see', replica, see: { scope: 'window', include: ['roles', 'names', 'values', 'bounds'] } };
    const first = await must(drive, see);
    expect(nodesOf(first.snapshot).filter((n) => /^Node \d+$/.test(n.name ?? '')).length, 'the snapshot holds the panel\'s 2,000 nodes').toBe(SNAPSHOT_NODES);
    const runs: number[] = [];
    const loads: Load[] = [];
    for (let i = 0; i < 5; i++) {
      const start = oneMinuteLoad();
      runs.push((await drive.call(see)).ms);
      loads.push({ start, end: oneMinuteLoad() });
    }
    holds(await judged(SNAPSHOT_MS, runs, loads), '2,000-node snapshot');
  }, 600_000);

  it(`${ID.budgets} a replica stays under 500 MB: its peak resident memory over a recorded run's replay, five replays`, async () => {
    requireMacos();
    const runs: number[] = [];
    const loads: Load[] = [];
    for (let i = 0; i < 5; i++) {
      let peak = 0;
      let pid: number | undefined;
      let going = true;
      const start = oneMinuteLoad();
      const sampler = (async () => { while (going) { if (pid) peak = Math.max(peak, rss(pid)); await sleep(50); } })();
      const { drive } = await replay(readRun(RUNS['claude-code']), PANEL.form, { started: (d) => { pid = d.pid; } });
      peak = Math.max(peak, rss(drive.pid));
      going = false;
      await sampler;
      loads.push({ start, end: oneMinuteLoad() });
      await drive.stop();
      runs.push(peak);
    }
    expect(runs.every((r) => r > 0), `every replay's memory was read: ${runs}`).toBe(true);
    holds(await judged(MEMORY_BYTES, runs, loads), 'peak memory');
  }, 900_000);
});
