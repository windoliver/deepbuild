// #23.d8c645da budgets, on the reference Mac in the local preflight, compared with the merge base: matching an
// ask against 10,000 saved decisions takes under 10 ms at p95, with no model call.
//
// The merge-base comparison is the perf lane's (scripts/benchmark.mjs over benchmarks/budgets.json), as #24 and
// #319 left it: the first test holds the lane to a task for this budget. The second times resolver-decisions'
// resolver itself, the matching, on the asks the core hands it, with 10,000 decisions saved through the real
// path; no network connection, fetch or child process may start while it matches. Timing follows the design's
// rule: five runs after a warm-up; PASS when all five are within the limit, FAIL when all five are over it by more
// than the margin (the larger of 5% and the runs' spread), otherwise INCONCLUSIVE. The readings are always taken
// and printed; off a reference Mac, on battery, with Low Power Mode on or unknown, a thermal warning, or a load
// average above the core count, the result is INCONCLUSIVE and the test skips with the readings. It never passes by
// skipping, and it never waits for a quieter machine.

import { ChildProcess, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Socket } from 'node:net';
import { availableParallelism, loadavg } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type TestContext } from 'vitest';
import type { ResolverAsk } from '../../../../packages/asks/src/index.ts';
import { choiceAsk, HOUR, openWorld, RESOLVER } from './helpers.ts';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const NODE = process.execPath;
const TASK = 'resolver-match-10k';

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const read = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why a timing here is only a reading, or null on a reference Mac on mains power, Low Power Mode off, thermal state nominal, not overloaded. */
function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = read('sysctl', '-n', 'hw.model');
    chip = read('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(read('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = read('pmset', '-g', 'batt');
    power = read('pmset', '-g');
    therm = read('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  const fingerprint = `${model} / ${chip} / ${gib} GiB`;
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${fingerprint}`;
  if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  const [load] = loadavg();
  if (load! > availableParallelism()) return `load average ${load!.toFixed(1)} above ${availableParallelism()} cores`;
  return null;
}
/** PASS when every run is within the limit; FAIL when every run is over it by more than the margin; else INCONCLUSIVE. */
function judge(ctx: TestContext, name: string, runs: number[], limit: number, problem: string | null): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const shown = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (problem) ctx.skip(`INCONCLUSIVE (reading only: ${problem}) ${shown}`);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}
const p95 = (samples: number[]): number => {
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.ceil(0.95 * s.length) - 1]!;
};

test(`#23.d8c645da the perf lane has the task ${TASK}, a #23 first measurement, valid against the merge base's budgets, and it runs`, async () => {
  const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
  const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: { id: string; command: string[]; initialReason?: string }[] };
  const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
  validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
  const task = current.tasks.find((t) => t.id === TASK);
  expect(task, `benchmarks/budgets.json has a task ${TASK}`).toBeDefined();
  expect(String(task!.initialReason), `${TASK} says why, naming issue #23`).toMatch(/#23\b/);
  const [command, ...args] = task!.command;
  // It runs to completion: execFileSync throws on a non-zero exit, naming the command.
  execFileSync(command === 'node' ? NODE : command!, args, { cwd: REPO, encoding: 'utf8', timeout: 600_000 });
}, 600_000);

test('#23.d8c645da matching an ask against 10,000 saved decisions takes under 10 ms at p95, with no model call', async (ctx) => {
  const w = await openWorld({}, { resolver: false });
  try {
    // 10,000 decisions, saved through the real path: a choice raised in one of ten repos and answered on the card.
    const t0 = performance.now();
    const repos = Array.from({ length: 10 }, (_, r) => `repo${r}`);
    for (const [r, repo] of repos.entries()) await w.start(`seed${r}`, `seed${r}`, repo);
    const point = (i: number): string => `req:01JSEED${String(i).padStart(18, '0')}`;
    for (let i = 0; i < 10_000; i++) {
      const ask = await w.raise(`seed${i % 10}`, 'deep_ask.choice', choiceAsk(`Which way for requirement ${i}?`, point(i), ['one', 'two'], w.clock.now()));
      await w.answer(ask, i % 3 ? 'one' : 'two');
    }
    expect((await w.events('decision.created')).length, 'the record holds 10,000 saved decisions').toBeGreaterThanOrEqual(10_000);
    console.log(`seeded 10,000 decisions in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    // The asks the core hands the resolver: 100 a saved decision covers, 50 in a repo none of them covers, 50 new.
    const handed: ResolverAsk[] = [];
    w.asks.registerResolver('spy', (ask) => { handed.push(structuredClone(ask)); return undefined; });
    w.asks.registerResolver(RESOLVER, w.resolver);
    const covered: boolean[] = [];
    for (let j = 0; j < 200; j++) {
      w.clock.set(w.clock.now() + HOUR);
      const i = (j * 37) % 10_000;
      const [repo, p] = j < 100 ? [repos[i % 10]!, point(i)] : j < 150 ? ['repoElsewhere', point(i)] : [repos[j % 10]!, point(10_000 + j)];
      await w.start(`probe${j}`, `probe${j}`, repo);
      await w.raise(`probe${j}`, 'deep_ask.choice', choiceAsk(`Which way, again, for ${p}?`, p, ['one', 'two'], w.clock.now()));
      covered.push(j < 100);
    }
    expect(handed, 'the core hands resolvers each of the 200 asks').toHaveLength(200);
    // No model call: no socket, fetch or child process starts while the resolver matches.
    const started: string[] = [];
    const connect = Socket.prototype.connect;
    // Every child process starts through ChildProcess.prototype.spawn, which Node's typings leave out.
    const child = ChildProcess.prototype as unknown as { spawn: (...a: unknown[]) => unknown };
    const spawn = child.spawn;
    const fetched = globalThis.fetch;
    Socket.prototype.connect = function (this: Socket, ...args: unknown[]) { started.push(`socket ${JSON.stringify(args[0])}`); return (connect as (...a: unknown[]) => Socket).apply(this, args); } as typeof connect;
    child.spawn = function (this: ChildProcess, ...args: unknown[]) { started.push('child process'); return spawn.apply(this, args); };
    globalThis.fetch = ((...args: unknown[]) => { started.push(`fetch ${String(args[0])}`); return fetched(...(args as Parameters<typeof fetch>)); }) as typeof fetch;
    const round = async (): Promise<number> => {
      const samples: number[] = [];
      for (const [k, ask] of handed.entries()) {
        const t = performance.now();
        const answer = await w.resolver(ask);
        samples.push(performance.now() - t);
        const named = answer && typeof answer.because === 'string' && typeof answer.answer === 'string' ? answer.because : null;
        if (covered[k]) expect(named, `${ask.ask}, covered by a saved decision, is answered naming it`).toEqual(expect.stringMatching(/^decision:[0-9A-Za-z]+$/));
        else expect(named, `${ask.ask}, which no saved decision covers, is answered from none`).toBeNull();
      }
      return p95(samples);
    };
    let runs: number[];
    try {
      console.log(`warm-up: ${(await round()).toFixed(3)} ms at p95 (discarded)`);
      runs = [];
      for (let r = 0; r < 5; r++) runs.push(await round());
    } finally {
      Socket.prototype.connect = connect;
      child.spawn = spawn;
      globalThis.fetch = fetched;
    }
    expect(started, 'matching starts no socket, fetch or child process: no model call').toEqual([]);
    judge(ctx, '#23 match an ask against 10,000 decisions, p95 (ms)', runs, 10, environmentProblem());
  } finally {
    await w.close();
  }
}, 1_800_000);
