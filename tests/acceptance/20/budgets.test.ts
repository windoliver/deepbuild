// #20 AC7: budgets, on the reference Mac in the local preflight, compared with the merge base: archiving keeps up with
// 10 live sessions at under 1% of a core; 30 days of transcripts compress to under 2 GB; a 1 GB backlog archives in
// under 5 minutes. The merge-base comparison is the perf lane's (scripts/benchmark.mjs, benchmarks/budgets.json), as
// #16's and #237's budgets do it: the archive's tasks must be there, each a #20 first measurement, valid against the
// merge base's budgets, and each must run. The issue's numbers are judged here. Timings follow the design's rule (five
// runs after a warm-up; PASS when all are within the limit, FAIL when all are over it by more than the margin,
// otherwise INCONCLUSIVE) and count only on a reference Mac in a fit state; anywhere else they are skipped as
// INCONCLUSIVE, never passed. The size budget is bytes on disk, not a timing, so it is judged on any Mac. Each test
// loads the archive first, so at the base every one fails on the missing surface before any machine check.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, type TestContext } from 'vitest';
import { appendSession, linesUpTo, pathOf, session, writeSession, type Generated } from './generate.ts';
import {
  AC, allEvents, allocated, archiveModule, archivedOf, copyText, dataOf, DAY, evidenceOf, HOUR, makeClock, MINUTE, NODE, openArchiveOn, openWorld,
  redacted, REPO, removeTemps, T0, tempDir,
} from './helpers.ts';

afterAll(removeTemps);

const MB = 1_000_000;
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why this machine's timings are a reading only, or null on a reference Mac in a fit state (design: The reference Macs). */
function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = sh('sysctl', '-n', 'hw.model');
    chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = sh('pmset', '-g', 'batt');
    power = sh('pmset', '-g');
    therm = sh('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm || lpm[1] !== '0') return 'Low Power Mode on or unknown';
  if ([...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100) || !/No thermal warning level/.test(therm)) return 'thermal state not nominal';
  const [one] = loadavg();
  const cores = availableParallelism();
  return one! > cores ? `loaded past its core count: 1-minute load ${one!.toFixed(1)} on ${cores} cores` : null;
}
/** PASS when every run is within the limit; FAIL when every run is over it by more than the margin; else INCONCLUSIVE. */
function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const shown = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (runs.every((r) => r < limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}
const problem = environmentProblem();

interface Task { id: string; command: string[]; initialReason?: string }
function archiveTasks(): Task[] {
  const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Task[] };
  return current.tasks.filter((t) => /#20\b/.test(String(t.initialReason)) && t.command.some((part) => part.endsWith('benchmarks/archive.mjs')));
}

describe(`AC7 ${AC[7]} budgets, compared with the merge base in the local preflight`, () => {
  it("AC7 the perf lane has the archive's three tasks, one per budget, each a #20 first measurement running benchmarks/archive.mjs, valid against the merge base's budgets", async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as unknown;
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    const tasks = archiveTasks();
    expect(tasks.map((t) => t.id), 'budgets.json has a #20 task for each of the three budgets (live sessions, 30 days, 1 GB backlog)').toHaveLength(3);
  });

  it("AC7 each of the archive's perf-lane tasks runs and exits 0", () => {
    const tasks = archiveTasks();
    expect(tasks.length, 'the archive has perf-lane tasks to run').toBeGreaterThan(0);
    for (const task of tasks) {
      const [cmd, ...args] = task.command;
      const r = spawnSync(cmd === 'node' ? NODE : cmd!, args, { cwd: REPO, encoding: 'utf8', timeout: 900_000 });
      expect(r.status, `${task.id} (${task.command.join(' ')}): ${r.stderr}`).toBe(0);
    }
  }, 1_800_000);
});

describe(`AC7 ${AC[7]} the issue's numbers`, () => {
  it("AC7 archiving keeps up with 10 live sessions at under 1% of a core: a pass each minute brings all ten current, at under 0.6 s of CPU", async (ctx) => {
    await archiveModule();
    if (problem) ctx.skip(`INCONCLUSIVE (not measured: ${problem})`);
    // Ten sessions an hour in (1 MB each), each gaining a line every 5 seconds; the archive's pass runs once a minute.
    const w = await openWorld();
    try {
      const live: { g: Generated; at: number }[] = Array.from({ length: 10 }, (_, i) => {
        const g = session(0x20_7000 + i, 3 * MB, T0);
        const at = linesUpTo(g, MB);
        writeSession(w.env, g, at);
        return { g, at };
      });
      const archive = await openArchiveOn(w);
      await archive.pass(); // the ten histories: not part of a live minute
      const runs: number[] = [];
      for (let minute = 0; minute < 6; minute++) {
        for (const s of live) {
          appendSession(w.env, s.g, s.at, s.at + 12);
          s.at += 12;
        }
        w.clock.tick(MINUTE);
        const c0 = process.cpuUsage();
        await archive.pass();
        const cpu = process.cpuUsage(c0);
        if (minute > 0) runs.push(((cpu.user + cpu.system) / 1000 / MINUTE) * 100);
        for (const s of live) {
          const copies = await archivedOf(w.record, s.g.id);
          const newest = String(dataOf(copies[copies.length - 1]!).evidence);
          expect(await copyText(w.store, newest), `minute ${minute}: session ${s.g.id} is current after the minute's pass (keeps up)`).toBe(redacted(readFileSync(pathOf(w.env, s.g), 'utf8')));
        }
      }
      judge(ctx, 'AC7 a live minute of 10 sessions (% of one core)', runs, 1);
    } finally {
      await w.close();
    }
  }, 900_000);

  it('AC7 30 days of transcripts compress to under 2 GB: two days of a heavy month (20 sessions a day, each copied at half and at its full 5 MB) on disk, times 15', async (ctx) => {
    await archiveModule();
    if (process.platform !== 'darwin') ctx.skip(`INCONCLUSIVE (not measured: bytes on disk are judged on the reference Macs' file system, not ${process.platform})`);
    const w = await openWorld();
    try {
      const archive = await openArchiveOn(w);
      let raw = 0;
      for (let day = 0; day < 2; day++) {
        const seeds = Array.from({ length: 20 }, (_, s) => 0x20_3000 + day * 100 + s);
        // Midday: every session at half its size, archived; evening: every session whole, archived again.
        for (const seed of seeds) {
          const g = session(seed, 5 * MB, T0 + day * DAY);
          writeSession(w.env, g, linesUpTo(g, 2.5 * MB));
        }
        w.clock.set(T0 + day * DAY + 4 * HOUR);
        await archive.pass();
        const paths: string[] = [];
        for (const seed of seeds) {
          const g = session(seed, 5 * MB, T0 + day * DAY);
          paths.push(writeSession(w.env, g));
          raw += g.bytes;
        }
        w.clock.set(T0 + day * DAY + 10 * HOUR);
        await archive.pass();
        expect((await allEvents(w.record, ['transcript.archived'])).length, `day ${day}: each session copied at half and whole`).toBe(40 * (day + 1));
        for (const path of paths) rmSync(path); // the sources go; the archive's copies stay
      }
      const onDisk = allocated(evidenceOf(w.root));
      const month = onDisk * 15;
      console.log(`AC7 two days: ${(raw / MB).toFixed(0)} MB of transcripts, ${(onDisk / MB).toFixed(0)} MB in the archive on disk; 30 days: ${(month / 1e9).toFixed(2)} GB against 2 GB`);
      expect(month, `30 days of transcripts in the archive: ${(month / 1e9).toFixed(2)} GB, against 2 GB`).toBeLessThan(2e9);
    } finally {
      await w.close();
    }
  }, 1_800_000);

  it('AC7 a 1 GB backlog (200 sessions of 5 MB) archives in under 5 minutes', async (ctx) => {
    await archiveModule();
    if (problem) ctx.skip(`INCONCLUSIVE (not measured: ${problem})`);
    const backlog = tempDir('backlog');
    const env = { CLAUDE_CONFIG_DIR: join(backlog, 'claude') };
    let total = 0;
    const ids: string[] = [];
    for (let i = 0; i < 200; i++) {
      const g = session(0x20_1000 + i, 5 * MB, T0 - 10 * DAY + i * HOUR);
      writeSession(env, g);
      total += g.bytes;
      ids.push(g.id);
    }
    expect(total, 'the backlog is 1 GB of transcripts').toBeGreaterThanOrEqual(1e9);
    const once = async (): Promise<number> => {
      const w = await openWorld({ clock: makeClock(T0), env });
      try {
        const archive = await openArchiveOn(w);
        const t0 = performance.now();
        await archive.pass();
        const s = (performance.now() - t0) / 1000;
        const linked = new Set((await allEvents(w.record, ['transcript.archived'])).map((e) => String(dataOf(e).session)));
        expect(ids.filter((id) => !linked.has(`session:${id.replace(/[^0-9A-Za-z]/g, '')}`)), 'every session of the backlog is archived').toEqual([]);
        return s;
      } finally {
        await w.close();
        rmSync(w.dir, { recursive: true, force: true });
      }
    };
    await once(); // warm-up
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) runs.push(await once());
    judge(ctx, 'AC7 a 1 GB backlog (s)', runs, 300);
  }, 3_600_000);
});
