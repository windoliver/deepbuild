// AC8 budgets: a bound value updates within one frame of its reading, and a popped-out window opens in under 300 ms,
// on the reference Mac in the local preflight, compared with the merge base. Three parts:
// - "within one frame", read deterministically on the virtual display clock: the frame on screen one frame (and the
//   latch lead) after each reading lands shows it, on all three surfaces; a planted host a frame late fails;
// - the merge-base comparison is the perf lane's (scripts/benchmark.mjs, benchmarks/budgets.json), as #96's is;
// - the issue's numbers in wall time, judged by the design's rule for timing results (five runs after a warm-up,
//   within the limit, over it by more than the margin, else INCONCLUSIVE), and counted only on a reference Mac on
//   mains power, Low Power Mode off, thermal state nominal and not loaded past its core count: anywhere else the
//   test fails with INCONCLUSIVE. It never passes on a reading it can't trust.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import {
  B, Driver, FLICKS, LEAD, MS, PERIOD_A, REPO, SEC, SLOTS, arr, at, click, drawnOf, obj, plainTree, popOut, runShow, scenario, serialOf, useOut, useShow,
  type Bind, type JsonObject, type Manifest, type Planted, type World,
} from './helpers.ts';

const show = useShow();
const out = useOut();
const T0 = 2 * SEC;
const FRAME = PERIOD_A + LEAD;
const BIND: Bind = { source: 'reading:ticker', select: 'value', format: { unit: 'USD', precision: 2, notation: 'fixed' }, show: { source: true, as_of: true }, stale_after: 60 * SEC, missing: 'dash' };
const SURFACES = [
  { name: 'panel quote (text price)', panel: 'quote', element: 'price' },
  { name: 'sheet cell table (grid/price)', panel: 'table', element: 'grid/price' },
  { name: 'chart label chart (trend/label)', panel: 'chart', element: 'trend/label' },
] as const;

/** The stocks plug-in reading `ticker` every `every` from `first`, `n` times, each answer a new price. */
function stocks(first: number, every: number, n: number): Manifest {
  return {
    sources: { ticker: { fresh_for: 60 * SEC, replay: Array.from({ length: n }, (_, k) => ({ value: 101.5 + k * 0.25, unit: 'USD' })) } },
    panels: {
      quote: { tree: [{ id: 'price', component: 'text', bind: BIND }], script: n === 0 ? {} : { timers: [{ first, every, until: first + (n - 1) * every, do: [{ op: 'read', source: 'ticker' }] }] } },
      table: { tree: [{ id: 'grid', component: 'sheet', cells: [{ id: 'symbol', text: 'AAPL' }, { id: 'price', bind: BIND }] }] },
      chart: { tree: [{ id: 'trend', component: 'chart', label: { bind: BIND } }] },
    },
  };
}
const STOCK_PANELS = { quote: SLOTS[0]!, table: SLOTS[1]!, chart: SLOTS[2]! };

describe('AC8 a bound value updates within one frame of its reading, on the virtual display clock', () => {
  const N = 10;
  const when = (k: number): number => T0 + 2 * SEC + k * 2 * SEC;

  function oneFrame(planted?: Planted): string[] {
    const d = new Driver(show(), { evidence: out(), panels: STOCK_PANELS, plugins: { stocks: stocks(when(0), 2 * SEC, N) }, ...(planted ? { planted } : {}) });
    const calls = Array.from({ length: N }, (_, k) => SURFACES.flatMap((s) => [at('drawn', when(k) - MS, { panel: s.panel }), at('drawn', when(k) + FRAME, { panel: s.panel })])).flat();
    const r = d.step(calls, `ten readings${planted ? ` (planted ${planted})` : ''}`);
    const f: string[] = [];
    for (let k = 0; k < N; k++) {
      const price = (101.5 + k * 0.25).toFixed(2);
      SURFACES.forEach((s, j) => {
        const i = (k * SURFACES.length + j) * 2;
        const before = drawnOf(r[i], `${s.name} before reading ${k + 1}`).bound.find((b) => b.element === s.element);
        const after = drawnOf(r[i + 1], `${s.name} a frame after reading ${k + 1}`);
        const shown = after.bound.find((b) => b.element === s.element);
        if (before && before.text.includes(price)) f.push(`${s.name}: shows ${price} 1 ms before the reading that brings it`);
        if (!shown || !shown.text.includes(price)) f.push(`${s.name}: one frame after reading ${k + 1} lands (at ${when(k) / FLICKS} s) it shows ${JSON.stringify(shown?.text)}, not ${price}`);
        else if (after.vsync > when(k) + FRAME) f.push(`${s.name}: the frame showing reading ${k + 1} is at ${after.vsync}, more than a frame after it`);
      });
    }
    return f;
  }

  it('AC8 each of ten readings shows on the panel, the sheet cell and the chart label in the frame one frame after it lands, and not before it', () => {
    expect(oneFrame(), 'every surface within one frame').toEqual([]);
    // Wrong program: a host that shows each reading a frame late.
    const twin = oneFrame('bound_value_a_frame_late');
    for (const s of SURFACES) expect(twin.some((m) => m.startsWith(`${s.name}: one frame after`)), `the planted bound_value_a_frame_late fails on ${s.name}: ${JSON.stringify(twin.slice(0, 3))}`).toBe(true);
  }, 600_000);
});

// ---------------------------------------------------------------------------------------------------
// The merge-base comparison: the perf lane's tasks.

interface Line { id: string; command: string[]; initialReason?: string }
const TASKS = ['panel-bound-value', 'panel-pop-out'] as const;

describe('AC8 budgets in the local preflight, compared with the merge base', () => {
  it('AC8 the perf lane has a task for each budget, each a #401 first measurement, valid against the merge base\'s budgets', async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Line[] };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    for (const id of TASKS) {
      const task = current.tasks.find((t) => t.id === id);
      expect(task, `budgets.json has a task ${id}`).toBeDefined();
      expect(task!.command.length, `${id} names its command`).toBeGreaterThan(0);
      expect(String(task!.initialReason), `${id} says why, naming issue #401`).toMatch(/#401/);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// The issue's numbers in wall time on the reference Mac (as tests/acceptance/96 and 237).

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
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
  const fingerprint = `${model} / ${chip} / ${gib} GiB`;
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${fingerprint}`;
  if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  const [one] = loadavg();
  if (one! > availableParallelism()) return `loaded past its core count: 1-minute load ${one!.toFixed(1)} on ${availableParallelism()} cores`;
  return null;
}
/** PASS when every run is within the limit; FAIL when every run is over it by more than the margin (the larger of 5% and
 * the runs' spread); else, and off a fit reference Mac, INCONCLUSIVE, which fails: it is not a pass. */
function judge(name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const reading = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(reading);
  const problem = environmentProblem();
  if (problem) expect.fail(`INCONCLUSIVE: ${problem}; the reading is not a result: ${reading}`);
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${reading}`).toBe(false);
  if (!runs.every((r) => r <= limit)) expect.fail(`INCONCLUSIVE: ${reading}`);
}
function timed(bin: string, s: JsonObject, what: string): number {
  const t = performance.now();
  runShow(bin, s, what);
  return performance.now() - t;
}

describe('AC8 the issue\'s numbers on the reference Mac', () => {
  it('AC8 a bound value updates within one frame (8.33 ms at 120 Hz): 600 readings on three surfaces, against the same run with none', () => {
    const N = 600;
    const w = (n: number): World => ({ evidence: out(), panels: STOCK_PANELS, plugins: { stocks: stocks(T0 + SEC, 100 * MS, n) } });
    const tail = (n: number): JsonObject[] => [at('drawn', T0 + SEC + n * 100 * MS + SEC, { panel: 'quote' })];
    const perReading = (): number => (timed(show(), scenario(w(N), tail(N)), 'many readings') - timed(show(), scenario(w(0), tail(N)), 'no readings')) / N;
    console.log(`warm-up: ${perReading().toFixed(3)} ms per reading (discarded)`);
    judge('AC8 a reading to its frame on three surfaces (ms)', [1, 2, 3, 4, 5].map(perReading), 1000 / 120);
  }, 900_000);

  it('AC8 a popped-out window opens in under 300 ms: six pop-outs onto B, against the same run with none', () => {
    const panels = Object.fromEntries(SLOTS.map((r, i) => [`v${i}`, r]));
    const world: World = { evidence: out(), panels, plugins: { views: { panels: Object.fromEntries(Object.keys(panels).map((p) => [p, { tree: plainTree(p) }])) } } };
    const clicks = Object.entries(panels).flatMap(([p, r], i) => click(T0 + i * SEC, p, r));
    // The serials of the six presses, from a run of the clicks alone.
    const s = scenario(world, clicks);
    const replies = runShow(show(), s, 'six clicks');
    const sorted = arr(s['calls'], 'calls');
    const serials = Object.keys(panels).map((_, i) => serialOf(replies[sorted.indexOf(clicks[2 * i]!)], `the press in v${i}`));
    const pops = Object.keys(panels).map((p, i) => popOut(T0 + 10 * SEC + i * SEC, p, B.uuid, serials[i]));
    const all = scenario(world, [...clicks, ...pops]);
    const check = runShow(show(), all, 'six pop-outs');
    const order = arr(all['calls'], 'calls');
    for (const p of pops) expect(obj(check[order.indexOf(p)], 'pop-out')['code'], `the pop-out of ${String(p['panel'])} opens`).toBeUndefined();
    const perPop = (): number => (timed(show(), scenario(world, [...clicks, ...pops]), 'six pop-outs') - timed(show(), scenario(world, clicks), 'no pop-outs')) / pops.length;
    console.log(`warm-up: ${perPop().toFixed(3)} ms per pop-out (discarded)`);
    judge('AC8 a pop-out opening its window (ms)', [1, 2, 3, 4, 5].map(perPop), 300);
  }, 900_000);
});
