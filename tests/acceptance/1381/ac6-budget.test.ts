// AC6 #1381.82d06a5e: "Under 0.1 ms at 1080p on the reference Mac, measured"
//
// What is timed (README: Readings): the GPU time the far ground light adds to a frame at 1920 × 1080, the sunset of
// criteria 4 and 5 drawn with the plate's horizon against the same document with the plate's `horizon` left out, which
// bakes nothing and draws as the base does (README: Assumed surfaces 1). Each side is 300 frames at 30 frames a second
// (the sun sinking over the first 3 s, then holding at 3°) with `timings` and nothing captured; a run is one process
// drawing both sides, their order alternating from run to run; its cost is the difference of the sides' median `gpu_ms`,
// a negative one read as 0. One warm-up run, then five (#2017's sway pattern).
//
// The test:
//   - scripts/lanes.mjs runs this file as a timed one (README: Run them), so it runs alone under the timed grant;
//   - so the timing sees the horizon, the sides differ: frame 75 (2.5 s, the sun at 5°) draws other pixels with the
//     horizon than without it;
//   - then, only where the lane can judge a timing (a reference Mac at rest; anywhere else INCONCLUSIVE before anything
//     is timed), the five runs are judged against 0.1 ms by the perf lane's own `judgeLimit` (scripts/benchmark.mjs):
//     a FAIL fails, anything but PASS is INCONCLUSIVE, never a pass.
//
// Catches: the base (no `horizon`: the document is refused, or both sides draw alike); a horizon costing 0.1 ms or more
// a frame at 1080p.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, HD, PLAIN, REPO, framesOf, inconclusive, judgeLimit, load, num, pixelHash, requireMetal, ridgeDoc, runGpu, timingProblem, useGpu, useOut,
  writeJson, type JsonObject,
} from './helpers.ts';

const ID = AC[6];
const NAME = `AC6 ${ID}`;
const bin = useGpu();
const out = useOut();
const FILE = 'tests/acceptance/1381/ac6-budget.test.ts';
const LIMIT_MS = 0.1;
const FPS = 30;
const FRAMES = 300;
const RUNS = 5;
const SUNSET_FRAME = 75;

describe(`${NAME} the far ground light's cost at 1080p`, () => {
  it(`${NAME} the plate's horizon adds under 0.1 ms of GPU time a frame at 1920 × 1080, five runs after warm-up on the reference Mac`, async () => {
    const lanes = (await import(join(REPO, 'scripts', 'lanes.mjs'))) as { timed: string[] };
    expect(lanes.timed, `scripts/lanes.mjs runs ${FILE} as a timed file`).toContain(FILE);

    requireMetal();
    const docs = (dir: string): { on: string; off: string } => ({
      on: writeJson(dir, 'sunset-on', ridgeDoc({ size: HD, sun: 'sunset', view: 'sunset' })),
      off: writeJson(dir, 'sunset-off', ridgeDoc({ size: HD, sun: 'sunset', view: 'sunset', horizon: false })),
    });
    {
      const dir = out();
      const d = docs(dir);
      const at = (doc: string): JsonObject => ({ call: 'view3d', doc, look: PLAIN, size: [...HD], fps: FPS, from: SUNSET_FRAME, frames: 1, capture: [SUNSET_FRAME], targets: ['final'] });
      const [on, off] = runGpu(bin(), dir, [at(d.on), at(d.off)]);
      const hash = (r: JsonObject, what: string): string => pixelHash(framesOf(r, 1, what, SUNSET_FRAME)[0]!, what);
      expect(hash(on!, 'the sunset with the horizon, frame 75'), 'with the horizon the sunset draws other pixels than without it, so the timing sees it')
        .not.toBe(hash(off!, 'the sunset without the horizon, frame 75'));
    }

    const problem = await timingProblem();
    if (problem) inconclusive(`the 0.1 ms budget is judged only on a reference Mac at rest: ${problem}`);
    const run = (k: number): number => {
      const dir = out();
      const d = docs(dir);
      const side = (doc: string): JsonObject => ({ call: 'view3d', doc, look: PLAIN, size: [...HD], fps: FPS, frames: FRAMES, capture: [], timings: true });
      const onFirst = k % 2 === 0;
      const replies = runGpu(bin(), dir, onFirst ? [side(d.on), side(d.off)] : [side(d.off), side(d.on)]);
      const [on, off] = onFirst ? [replies[0]!, replies[1]!] : [replies[1]!, replies[0]!];
      const median = (r: JsonObject, what: string): number => {
        const ms = framesOf(r, FRAMES, what).map((f, i) => num(f['gpu_ms'], `${what}: frame ${i}: gpu_ms`)).sort((a, b) => a - b);
        return ms[Math.floor(ms.length / 2)]!;
      };
      return Math.max(0, median(on, `run ${k}, with the horizon`) - median(off, `run ${k}, without it`));
    };
    run(0);
    const costs: number[] = [];
    const loads: { start: number; end: number }[] = [];
    for (let k = 1; k <= RUNS; k++) { const start = load(); costs.push(run(k)); loads.push({ start, end: load() }); }
    const v = await judgeLimit(LIMIT_MS, costs, loads);
    console.log(`${ID}: the horizon's GPU time a frame at 1920 × 1080, per run: ${costs.map((c) => c.toFixed(4)).join(', ')} ms against ${LIMIT_MS} → ${String(v['status'])}`);
    expect(v['status'], `the horizon's cost against ${LIMIT_MS} ms: ${JSON.stringify(v)}`).not.toBe('FAIL');
    if (v['status'] !== 'PASS') inconclusive(JSON.stringify(v));
  }, 4 * 3_600_000);
});
