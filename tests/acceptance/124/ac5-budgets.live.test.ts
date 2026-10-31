// Criterion 5's timings, on the reference Mac (README: Criterion 5): a replica launches in under 2 s, an action's round
// trip takes under 50 ms plus its wait, a 2,000-node snapshot under 20 ms, and a replica stays under 500 MB. Each is five
// readings after a warm-up, judged by scripts/benchmark.mjs's judgeLimit: PASS only on a reference Mac on mains power,
// Low Power Mode off and the thermal state nominal, with all five within the limit; anywhere else INCONCLUSIVE, which
// fails here and never passes. The merge-base comparison is the perf lane's four tasks (ac5-lease.test.ts checks them).
//
// Skipped unless DEEP_DRIVE_BUDGETS=1: the local preflight's perf step sets it on the reference Mac. It spends no plan.
//   DEEP_DRIVE_BUDGETS=1 npx vitest run --root tests/acceptance/124 ac5-budgets.live.test.ts
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ACTION_MS, Drive, ID, LAUNCH_MS, MEMORY_BYTES, PANEL, REPO, RUNS, SNAPSHOT_MS, SNAPSHOT_NODES, buildDrive, cleanup, launch, must, nodesOf, readRun,
  replay, requireMacos, sleep, type Obj,
} from './helpers.ts';

afterEach(cleanup, 60_000);
const OPTED = process.env.DEEP_DRIVE_BUDGETS === '1';

async function judged(limit: number, runs: number[]): Promise<Obj> {
  const bench = await import(join(REPO, 'scripts', 'benchmark.mjs')) as { fingerprint: () => Obj; judgeLimit: (o: Obj) => Obj };
  return bench.judgeLimit({ limit, runs, fingerprint: bench.fingerprint() });
}
const holds = (r: Obj, what: string) => expect(r.status, `${what}: ${JSON.stringify(r)}`).toBe('PASS');
const rss = (pid: number): number => Number(spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim()) * 1024 || 0;

describe.skipIf(!OPTED)(`${ID.budgets} budgets on the reference Mac`, () => {
  it(`${ID.budgets} a replica launches in under 2 s: from spawning deep-drive to launch's answer, five times after a warm-up`, async () => {
    requireMacos();
    buildDrive();
    const once = async () => {
      const at = performance.now();
      const drive = await Drive.start();
      await launch(drive, { from: 'fixture', panel: PANEL.form, clock: 'virtual' });
      const ms = performance.now() - at;
      await drive.stop();
      return ms;
    };
    await once();
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) runs.push(await once());
    holds(await judged(LAUNCH_MS, runs), 'launch');
  }, 600_000);

  it(`${ID.budgets} an action's round trip takes under 50 ms plus its wait: five clicks on a field already visible, enabled and still`, async () => {
    requireMacos();
    const drive = await Drive.start();
    const replica = await launch(drive, { from: 'fixture', panel: PANEL.form, clock: 'virtual' });
    const click = { call: 'act', replica, locator: { label: 'Email' }, act: { kind: 'click' } };
    await must(drive, click);
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const { reply, ms } = await drive.call(click);
      expect(reply.ok, JSON.stringify(reply)).toBe(true);
      expect(typeof reply.waited_ms, 'each action answers how long it waited').toBe('number');
      runs.push(ms - (reply.waited_ms as number));
    }
    holds(await judged(ACTION_MS, runs), 'action round trip less its wait');
  }, 600_000);

  it(`${ID.budgets} a 2,000-node snapshot takes under 20 ms`, async () => {
    requireMacos();
    const drive = await Drive.start();
    const replica = await launch(drive, { from: 'fixture', panel: PANEL.many, clock: 'virtual' });
    const see = { call: 'see', replica, see: { scope: 'window', include: ['roles', 'names', 'values', 'bounds'] } };
    const first = await must(drive, see);
    expect(nodesOf(first.snapshot).filter((n) => /^Node \d+$/.test(n.name ?? '')).length, 'the snapshot holds the panel\'s 2,000 nodes').toBe(SNAPSHOT_NODES);
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) runs.push((await drive.call(see)).ms);
    holds(await judged(SNAPSHOT_MS, runs), '2,000-node snapshot');
  }, 600_000);

  it(`${ID.budgets} a replica stays under 500 MB: its peak resident memory over a recorded run's replay, five replays`, async () => {
    requireMacos();
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      let peak = 0;
      let pid: number | undefined;
      let going = true;
      const sampler = (async () => { while (going) { if (pid) peak = Math.max(peak, rss(pid)); await sleep(50); } })();
      const { drive } = await replay(readRun(RUNS['claude-code']), PANEL.form, { started: (d) => { pid = d.pid; } });
      peak = Math.max(peak, rss(drive.pid));
      going = false;
      await sampler;
      await drive.stop();
      runs.push(peak);
    }
    expect(runs.every((r) => r > 0), `every replay's memory was read: ${runs}`).toBe(true);
    holds(await judged(MEMORY_BYTES, runs), 'peak memory');
  }, 900_000);
});
