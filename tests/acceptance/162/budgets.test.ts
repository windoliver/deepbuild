// AC13 #162.30ea626f: "Budgets, on the reference Mac in the local preflight, compared with the merge base: exporting a
// 200-item title with 2,000 keys takes under 1 s, and importing a 1 MB Lottie file takes under 2 s and under 200 MB"
//
// Split as #157's budget suite is: the merge-base comparison is the perf lane's (benchmarks/budgets.json has a task
// whose reason names this criterion's ID, valid against the merge base's budgets); the limits are judged here by the
// repo's `judgeLimit`, five runs after a warm-up, counted only on a reference Mac on mains power with Low Power Mode off
// and the thermal state nominal, and INCONCLUSIVE anywhere else, never a pass. The export's time is its receipt's
// `timing.wall` (Export: the time from the command to the file). The import's time is one deep_job run's, a cache miss,
// from the call to its reply; its memory is the largest resident set of any process the hub starts for that run
// (polled every 25 ms with `ps`). The 200-item title: 200 rects, each with ten Bézier keys on its x; the 1 MB file: a
// Lottie of shape layers made here, at least 1,048,576 bytes, its layer names changed per run so each run misses.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, REPO, TIMEOUT, channel, exportedOf, film, importLottie, importWorld, inconclusive, item, lottieExport, obj, referenceMacProblem, show,
  showRun, useShow, useTemp, type ImportWorld, type JsonObject,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

interface Benchmark {
  validateBudgets(current: unknown, base: unknown): void;
  fingerprint(): Record<string, unknown>;
  judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown>; loads: { start: number; end: number }[] }): { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string };
}
const benchmark = () => import(join(REPO, 'scripts', 'benchmark.mjs')) as Promise<Benchmark>;

/** 200 rects in a grid, each with ten Bézier keys on its x over 4 s: 2,000 keys. */
function bigTitle(evidence: string): JsonObject {
  const items: JsonObject[] = []; const channels: JsonObject = {};
  for (let i = 0; i < 200; i++) {
    const id = `r${String(i).padStart(3, '0')}`;
    items.push(item(id, 'rect@1', `Rect ${i}`, `b${String(i).padStart(3, '0')}`, { box: [0, 0, 12, 12], paint: { fill: { role: i % 2 ? 'accent' : 'ink' } } }, { at: { pos: [16 * (i % 20), 18 * Math.floor(i / 20), 0] } }));
    channels[`x${i}`] = channel(`items/${id}/at/pos/0`, Array.from({ length: 10 }, (_, k) => [k * 0.4, 16 * (i % 20) + (k % 2 ? 6 : 0), { bezier: { x1: 0.4, y1: 0, x2: 0.2, y2: 1 } }] as [number, number, JsonObject]));
  }
  return film(evidence, { id: 'big-title', size: [320, 180], rate: [30, 1], frames: 120, items, channels });
}
/** A Lottie of shape layers, each a 24-point closed path filled from four colours and moved by two keys, of at least
 * 1,048,576 bytes; `tag` names its layers. */
function bigLottie(tag: string): string {
  const colours = [[0.95, 0.76, 0.19], [0.11, 0.11, 0.13], [0.55, 0.55, 0.55], [0.91, 0.91, 0.91]];
  const layers: JsonObject[] = [];
  let text = '';
  for (let i = 0; text.length < 1_048_576; i++) {
    const v = Array.from({ length: 24 }, (_, k) => [256 + 120 * Math.cos((2 * Math.PI * k) / 24) + (i % 7), 256 + 120 * Math.sin((2 * Math.PI * k) / 24) - (i % 5)]);
    layers.push({
      ty: 4, nm: `${tag} shape ${i}`, ind: i + 1, ip: 0, op: 120, st: 0,
      ks: {
        a: { a: 0, k: [0, 0] }, o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, s: { a: 0, k: [100, 100] },
        p: { a: 1, k: [{ t: 0, s: [0, 0], o: { x: [0.4], y: [0] }, i: { x: [0.2], y: [1] } }, { t: 119, s: [i % 13, i % 11] }] },
      },
      shapes: [{
        ty: 'gr', nm: 'Group', it: [
          { ty: 'sh', nm: 'Path', ks: { a: 0, k: { c: true, v, i: v.map(() => [0, 0]), o: v.map(() => [0, 0]) } } },
          { ty: 'fl', nm: 'Fill', c: { a: 0, k: colours[i % 4]! }, o: { a: 0, k: 100 }, r: 1 },
          { ty: 'tr', a: { a: 0, k: [0, 0] }, p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
        ],
      }],
    });
    if (i % 50 === 49 || i < 2) text = JSON.stringify({ v: '5.7.0', ver: 10001, nm: tag, fr: 30, ip: 0, op: 120, w: 512, h: 512, assets: [], layers });
  }
  const out = JSON.stringify({ v: '5.7.0', ver: 10001, nm: tag, fr: 30, ip: 0, op: 120, w: 512, h: 512, assets: [], layers });
  if (out.length < 1_048_576) throw Error(`harness: the 1 MB fixture is ${out.length} bytes`);
  return out;
}

async function judged(what: string, limit: number, runs: number[], loads: { start: number; end: number }[], unit: string): Promise<void> {
  const { fingerprint, judgeLimit } = await benchmark();
  const machine = fingerprint();
  const result = judgeLimit({ limit, runs, fingerprint: machine, loads });
  const reading = `${what}: ${runs.map((r) => r.toFixed(3)).join(', ')} ${unit} against ${limit} ${unit} on ${String(machine['model'])}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`;
  console.log(`${AC[13]} ${reading}`);
  expect(result.status, reading).not.toBe('BLOCKED');
  expect(result.status, reading).not.toBe('FAIL');
  if (result.status === 'INCONCLUSIVE') inconclusive(reading);
}
/** One export of the 200-item title: its receipt's `timing.wall`, in seconds. */
function exportOnce(): number {
  const evidence = temp(); const dir = temp();
  const [reply] = showRun(shows.bin(FULL), evidence, [bigTitle(evidence)], [lottieExport(0, join(dir, 'big.json'))], 'the 200-item title');
  const wall = obj(exportedOf(reply!, 'the 200-item title').receipt['timing'], 'the receipt\'s timing')['wall'];
  expect(typeof wall === 'number' && Number.isFinite(wall), `the receipt times the export: timing.wall ${show(wall ?? null)}`).toBe(true);
  return wall as number;
}
/** Every process under `root` (by parent PID) with its resident set in bytes. */
function processesUnder(root: number): Map<number, number> {
  let table = '';
  try { table = execFileSync('ps', ['-ax', '-o', 'pid=,ppid=,rss='], { encoding: 'utf8' }); } catch { return new Map(); }
  const rows = table.split('\n').map((l) => /^\s*(\d+)\s+(\d+)\s+(\d+)/.exec(l)).filter((m): m is RegExpExecArray => m !== null).map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), rss: Number(m[3]) * 1024 }));
  const ours = new Set([root]);
  for (let grew = true; grew;) { grew = false; for (const r of rows) if (!ours.has(r.pid) && ours.has(r.ppid)) { ours.add(r.pid); grew = true; } }
  return new Map(rows.filter((r) => r.pid !== root && ours.has(r.pid)).map((r) => [r.pid, r.rss]));
}
/** One import of a fresh 1 MB file: its time from call to reply in seconds, and the largest resident set of a process
 * the hub started for it, in MB. */
async function importOnce(iw: ImportWorld, tag: string): Promise<{ seconds: number; mb: number }> {
  const bytes = bigLottie(tag);
  const before = new Set(processesUnder(iw.w.hub.pid).keys());
  let peak = 0;
  const poll = setInterval(() => { for (const [pid, rss] of processesUnder(iw.w.hub.pid)) if (!before.has(pid)) peak = Math.max(peak, rss); }, 25);
  const start = performance.now();
  try { await importLottie(iw, bytes, `${tag}.json`); } finally { clearInterval(poll); }
  const seconds = (performance.now() - start) / 1000;
  expect(peak, `the import of ${tag}.json ran in a process the hub started (one was seen by ps)`).toBeGreaterThan(0);
  return { seconds, mb: peak / 1e6 };
}

describe(`${AC[13]} budgets: a 200-item title with 2,000 keys under 1 s; a 1 MB Lottie imported under 2 s and 200 MB`, () => {
  it(`${AC[13]} the perf lane has a task whose reason names #162.30ea626f, and the budgets are valid against the merge base's`, async () => {
    const { validateBudgets } = await benchmark();
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: { id: string; initialReason?: string; changeReason?: string }[] };
    expect(current.tasks.some((t) => /#162\.30ea626f\b/.test(`${t.initialReason ?? ''} ${t.changeReason ?? ''}`)), 'benchmarks/budgets.json has a task whose reason names #162.30ea626f').toBe(true);
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
  }, TIMEOUT);

  it(`${AC[13]} on the reference Mac, exporting the 200-item title with 2,000 keys takes under 1 s (five runs after a warm-up)`, async () => {
    const problem = await referenceMacProblem(true);
    if (problem) inconclusive(`the budgets count only on a reference Mac in a fit state, so the runs aren't made here: ${problem}`);
    exportOnce();
    const runs: number[] = []; const loads: { start: number; end: number }[] = [];
    for (let i = 0; i < 5; i++) { const start = loadavg()[0]!; runs.push(exportOnce()); loads.push({ start, end: loadavg()[0]! }); }
    await judged('exporting the 200-item title with 2,000 keys to Lottie', 1, runs, loads, 's');
  }, TIMEOUT);

  it(`${AC[13]} on the reference Mac, importing a 1 MB Lottie file takes under 2 s and under 200 MB (five runs after a warm-up)`, async () => {
    const problem = await referenceMacProblem(true);
    if (problem) inconclusive(`the budgets count only on a reference Mac in a fit state, so the runs aren't made here: ${problem}`);
    const iw = await importWorld();
    await importOnce(iw, 'warm');
    const seconds: number[] = []; const mb: number[] = []; const loads: { start: number; end: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const start = loadavg()[0]!;
      const r = await importOnce(iw, `run${i}`);
      seconds.push(r.seconds); mb.push(r.mb); loads.push({ start, end: loadavg()[0]! });
    }
    await judged('importing a 1 MB Lottie file', 2, seconds, loads, 's');
    await judged('the import\'s largest resident set', 200, mb, loads, 'MB');
  }, TIMEOUT);
});
