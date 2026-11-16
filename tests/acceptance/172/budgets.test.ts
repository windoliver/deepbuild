// AC4 #172.1e1f958d: "Budgets, measured in the scheduled budget window on a reference Mac at the merged commit against
// its merge base; the PR says `Part of #172` until that window closes the issue; unmeasured is never PASS: the player is
// under 12 MB compressed without fonts and assets; the lab reaches its first frame in under 3 s in Chrome; and it steps
// and draws the lab at 60 fps at 1080p"
//
// Split as #169's and #538's budget suites are: the merge-base comparison and the window are the perf lane's
// (benchmarks/budgets.json has a task naming this criterion, valid against the merge base's budgets; the window runs
// it at the merged commit and settles the issue); the limits are judged here.
//
// asserts:
//   - the perf lane's task, as above;
//   - on any machine: the lab's player, every WebAssembly or JavaScript file of the bundle that isn't a logic program
//     or a reduced image level (fonts and assets are neither), plus any script written inline in index.html, each compressed
//     with Brotli at quality 11 *(chosen: what a static host serves)*, sums to under 12,000,000 bytes;
//   - on a reference Mac on mains power with Low Power Mode off and the thermal state nominal, five runs after a
//     warm-up, each a fresh page of the lab in headless Chrome: `probe().first_frame_ms` under 3,000 ms; and, in a
//     1920 × 1080 page, a play of the lab's 600 steps from the start to `ended`: its wall time over the frames the
//     player drew (`probe().frames`) and over the steps it ran (`probe().step`) each within 1,000/60 ms, all by the
//     repo's `judgeLimit`. Anywhere else, INCONCLUSIVE, never a pass.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, LAB_STEPS, REPO, TIMEOUT, benchmark, done, exportLab, filesUnder, inconclusive, int, isObject, isWasm, judged, levelsOf, play, probeOf,
  referenceMacProblem, useBrowsers, useShow, useTemp, type Exported,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const browsers = useBrowsers();
const CRITERION = '#172.1e1f958d';
const PLAYER_LIMIT = 12_000_000;
const FRAME_MS = 1000 / 60;

const brotli = (b: Buffer): number => brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: b.length } }).length;
/** The player's compressed bytes: the bundle's WebAssembly and JavaScript, less logic programs, levels and the document's
 * assets, and the scripts written inline in index.html. */
function playerBytes(lab: Exported): { bytes: number; files: string[] } {
  const skip = new Set([...levelsOf(lab.receipt), ...lab.receipt.files.filter((f) => isObject(f.raw['logic']))].map((f) => f.path));
  let bytes = 0; const files: string[] = [];
  for (const [path, b] of filesUnder(lab.out)) {
    if (skip.has(path) || path === 'index.html') continue;
    if (isWasm(b) || /\.(m?js)$/.test(path)) { bytes += brotli(b); files.push(path); }
  }
  const index = readFileSync(join(lab.out, 'index.html'), 'utf8');
  for (const m of index.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) if ((m[1] ?? '').trim()) bytes += brotli(Buffer.from(m[1]!, 'utf8'));
  return { bytes, files };
}

describe(`${AC[4]} budgets: the player under 12 MB compressed, the first frame under 3 s, 60 fps at 1080p`, () => {
  it(`${AC[4]} the perf lane has a task naming ${CRITERION}, and the budgets are valid against the merge base's`, async () => {
    const { validateBudgets } = await benchmark();
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: { id: string; criteria?: string[]; initialReason?: string; changeReason?: string }[] };
    expect(current.tasks.some((t) => (t.criteria ?? []).includes(CRITERION) || `${t.initialReason ?? ''} ${t.changeReason ?? ''}`.includes(CRITERION)), `benchmarks/budgets.json has a task naming ${CRITERION}`).toBe(true);
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
  }, TIMEOUT);

  it(`${AC[4]} the lab's player is under 12 MB compressed without fonts and assets (on any machine)`, () => {
    const lab = exportLab(shows(FULL), temp(), join(temp(), 'bundle'), 'the lab exported to the web');
    const p = playerBytes(lab);
    console.log(`${AC[4]} the player: ${p.bytes} bytes compressed (Brotli 11) in ${p.files.length} files and inline scripts: ${p.files.join(', ')}`);
    expect(p.files.length, 'the bundle holds the player as WebAssembly or JavaScript').toBeGreaterThan(0);
    expect(p.bytes, `the player is under ${PLAYER_LIMIT} bytes compressed: ${p.bytes}`).toBeLessThan(PLAYER_LIMIT);
  }, TIMEOUT);

  it(`${AC[4]} on the reference Mac the lab's first frame comes in under 3 s and it steps and draws at 60 fps at 1080p (five runs after a warm-up)`, async () => {
    const problem = await referenceMacProblem(true);
    if (problem) inconclusive(`the budgets count only on a reference Mac in a fit state, so the runs aren't made here: ${problem}`);
    const lab = exportLab(shows(FULL), temp(), join(temp(), 'bundle'), 'the lab exported to the web');
    const once = async (k: number): Promise<{ first: number; frameMs: number; stepMs: number }> => {
      const what = `the lab at 1920 × 1080, run ${k}`;
      const p = browsers(await play(lab.out, { viewport: [1920, 1080] }));
      await p.tab.mustBeReady(what);
      const firstMs = Number((await p.tab.probe(what)).raw['first_frame_ms']);
      expect(Number.isFinite(firstMs) && firstMs > 0, `${what}: probe().first_frame_ms is the time to the first frame: ${String(firstMs)}`).toBe(true);
      const ran = await p.tab.evaluate<{ wall: number; before: unknown; after: unknown }>(`new Promise((done) => { const p = document.querySelector('deep-player');
        const read = () => JSON.parse(JSON.stringify(p.probe())); p.currentTime = 0; const before = read(); const t0 = performance.now();
        p.addEventListener('ended', () => done({ wall: performance.now() - t0, before, after: read() }), { once: true }); p.play(); })`, 120_000, true);
      const before = probeOf(ran.before as never, `${what}: before`); const after = probeOf(ran.after as never, `${what}: after`);
      expect(after.step, `${what}: the play ran the lab's ${LAB_STEPS} steps`).toBe(LAB_STEPS);
      const frames = int(after.raw['frames'] ?? null, `${what}: probe().frames after`) - int(before.raw['frames'] ?? null, `${what}: probe().frames before`);
      expect(frames, `${what}: the player drew frames while it played`).toBeGreaterThan(0);
      await done(p);
      return { first: firstMs, frameMs: ran.wall / frames, stepMs: ran.wall / (after.step - before.step) };
    };
    await once(0);
    const firsts: number[] = []; const frames: number[] = []; const steps: number[] = []; const loads: { start: number; end: number }[] = [];
    for (let k = 1; k <= 5; k++) {
      const start = loadavg()[0]!;
      const r = await once(k);
      firsts.push(r.first); frames.push(r.frameMs); steps.push(r.stepMs); loads.push({ start, end: loadavg()[0]! });
    }
    await judged(AC[4], 'the lab\'s first frame in Chrome, from navigation start', 3000, firsts, loads, 'ms');
    await judged(AC[4], 'the lab at 1080p: ms per frame drawn over its 600-step play', FRAME_MS, frames, loads, 'ms');
    await judged(AC[4], 'the lab at 1080p: ms per step run over its 600-step play', FRAME_MS, steps, loads, 'ms');
  }, TIMEOUT);
});
