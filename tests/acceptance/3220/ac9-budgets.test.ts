// #3220 AC9: budgets, on the reference Mac in the local preflight, compared with the merge base: keeping the peak adds no
// process start to a scan and under 1 ms to it, and deciding one admission takes under 1 ms with 10,000 keys kept
// (drafted). As #237's and #1015's budgets read "compared with the merge base": the perf lane's task (scripts/benchmark.mjs,
// benchmarks/budgets.json) names the criterion, is valid against the merge base's budgets and runs; its judge reads the
// times on the reference Mac at rest and INCONCLUSIVE anywhere else. The process starts are a count, not a time, so this
// suite counts them itself, on any machine: the supervisor's processes per scan with a run in flight, against the merge
// base's own count, measured on the base and pinned here (BASE-FAILURE.txt).
import { execFileSync, type ChildProcess } from 'node:child_process';
import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openAsks } from '../../../packages/asks/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import { openSupervisor } from '../../../packages/supervisor/src/index.ts';
import { AC9, allocBinary, cleanup, NODE, REPO, sleep, tempDir } from './helpers.ts';

afterAll(cleanup, 120_000);

const ID = AC9.split(' ')[0]!;
/** The processes a scan of one live run starts on the merge base: the native helper's scan and one `ps` of the run's processes. */
const BASE_PER_SCAN = 2;

interface Task { id: string; command: string[]; criteria?: string[]; initialReason?: string }

describe(`${AC9} budgets on the reference Mac in the local preflight, compared with the merge base`, () => {
  it(`${AC9} the perf lane has a task naming ${ID}, valid against the merge base's budgets, and each such task runs`, async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Task[] };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26 })));
    const tasks = current.tasks.filter((t) => t.criteria?.includes(ID));
    expect(tasks.length, `benchmarks/budgets.json must have a task whose criteria name ${ID}, timing a scan that keeps the peak and one admission with 10,000 keys kept against the merge base: it has none`).toBeGreaterThan(0);
    for (const t of tasks) {
      const [cmd, ...args] = t.command;
      try {
        execFileSync(cmd === 'node' ? NODE : cmd!, args, { cwd: REPO, stdio: 'pipe', timeout: 3_000_000, maxBuffer: 1 << 26 });
      } catch (error) {
        expect.fail(`the perf lane's task ${t.id} (\`${t.command.join(' ')}\`) must run and exit 0: ${String((error as { stderr?: Buffer }).stderr ?? error).slice(-1500)}`);
      }
    }
  }, 3_600_000);

  it(`${AC9} with a run in flight, a scan starts no more processes than the merge base's, ${BASE_PER_SCAN} a scan`, async () => {
    const dir = tempDir();
    const work = join(dir, 'run');
    mkdirSync(work);
    const bin = allocBinary();
    const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
    const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
    const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 2 * 86_400_000 } } } });
    const run = `run:DH3220${randomBytes(8).toString('hex').toUpperCase()}`;
    const spawned: ChildProcess[] = [];
    const onSpawn = (message: unknown): void => { spawned.push((message as { process: ChildProcess }).process); };
    try {
      // The fixture holds 64 MiB for 12 s; its processes are tracked within its first 3 s, after which each scan reads them.
      const started = await sup.start({ run, argv: [bin, 'parent', work, '64', '0', '0', '12000'], cwd: work, grant: { read: [dirname(bin)], write: [work] } });
      if (started.status !== 'started') throw Error(`BLOCKED: the fixture run didn't start: ${JSON.stringify(started)}`);
      await sleep(3000);
      subscribe('child_process', onSpawn);
      await sleep(5000);
      unsubscribe('child_process', onSpawn);
      // The denial stream's canaries and the system log it reads are the supervisor's own, started as it opens, never a scan's.
      const counted = spawned.filter((p) => !(p.spawnfile === '/usr/bin/sandbox-exec' && p.spawnargs.includes('probe')) && p.spawnfile !== '/usr/bin/log');
      const scans = counted.filter((p) => /\/helper$/.test(p.spawnfile ?? '') && p.spawnargs[1] === 'scan').length;
      const shown = counted.map((p) => `${p.spawnfile} ${p.spawnargs.slice(1, 3).join(' ')}`).join('; ').slice(0, 1500);
      if (scans < 5) throw Error(`BLOCKED: the supervisor scanned the live run only ${scans} times in 5 s (it scans every 100 ms): ${shown}`);
      const perScan = counted.length / scans;
      console.log(`AC9 process starts per scan with one run in flight: ${perScan.toFixed(2)} (${counted.length} over ${scans} scans), against the merge base's ${BASE_PER_SCAN}`);
      expect(perScan, `keeping the peak must add no process start to a scan: the supervisor started ${counted.length} processes over ${scans} scans of one live run, ${perScan.toFixed(2)} a scan, against the merge base's ${BASE_PER_SCAN}: ${shown}`).toBeLessThanOrEqual(BASE_PER_SCAN + 0.1);
      await sup.wait(run);
    } finally {
      unsubscribe('child_process', onSpawn);
      await sup.cleanup(run).catch(() => undefined);
      await sup.close();
      await record.close();
    }
  }, 300_000);
});
