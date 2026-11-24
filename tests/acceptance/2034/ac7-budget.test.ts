// AC7 #2034.250d73ea: "Budget, on the reference Mac in the local preflight: the 18-light hall at 1920 × 1080 stays
// under 10 ms of GPU time a frame once its tiles are cached, and under 25 ms on a frame that redraws every tile
// (targets, to be measured)"
//
// The hall (helpers: `hallDoc`) at its `above` pose, 1920 × 1080, in two forms: as it is, whose tiles are drawn in
// frame 0 and cached from then on while nothing moves; and with `light_policy.cache: none`, which redraws every tile
// in every frame. A run is one `deep-gpu run` process playing each form for 120 frames at 60 fps with `timings: true`
// and `shadows: true`, nothing captured; a form's reading is the p95 of `gpu_ms` over frames 1 to 119 (frame 0 builds
// what the view needs).
//   - First, one run on any Mac with the suite's binary: every frame lists all 18 lights' tiles; in the cached form
//     every tile of frames 1 to 119 is `drawn: false`, in the redrawn form every tile of every frame `drawn: true`.
//     Its readings are printed. And scripts/lanes.mjs lists this file in `timed`, the local preflight's perf step.
//   - Then only where the perf lane can judge a timing (a reference Mac at rest, as scripts/benchmark.mjs's
//     `judgeLimit` reads it, through #1634's helpers): a release build, one warm-up run, then five runs, each limit
//     judged by the lane's rule: PASS passes, FAIL fails, anything else is INCONCLUSIVE. Elsewhere the test fails
//     INCONCLUSIVE with the first run's readings, never passing.
// Wrong programs: the base (2 spots' maps); tiles redrawn every frame though nothing moved; a tile pass or a lookup
// that costs past either target.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PLAIN_LOOK, TIMEOUT, buildGpu, framesOf, inconclusive, judgeLimit, load, none, p95, requireMetal, shown, timedFiles, timingProblem, useDir, useGpu, view3dCall, writeJson,
  type JsonObject, type Load,
} from '../1634/helpers.ts';
import { ABOVE, AC, HALL, HALL_LAMPS, HALL_POLICY, hallDoc, mapsOf, runGpu } from './helpers.ts';

const ID = AC[7];
const bin = useGpu();
const dir = useDir();
const FILE = 'tests/acceptance/2034/ac7-budget.test.ts';
const FRAMES = 120;
const LIMITS = { cached: 10, redrawn: 25 } as const;

/** One run: both forms played in one process; each form's p95 GPU ms over frames 1 on, and what is wrong with them. */
function run(binary: string): { cached: number; redrawn: number; failures: string[] } {
  const out = dir();
  const forms: [keyof typeof LIMITS, JsonObject][] = [['cached', HALL_POLICY], ['redrawn', { ...HALL_POLICY, cache: 'none' }]];
  const replies = runGpu(binary, out, forms.map(([name, policy]) => ({
    ...view3dCall({ doc: writeJson(out, `hall-${name}`, hallDoc(`hall-${name}`, ABOVE, policy)), look: PLAIN_LOOK, size: HALL.size, fps: 60, frames: FRAMES, capture: [], targets: [], timings: true }),
    shadows: true,
  })));
  const failures: string[] = []; const p: Record<string, number> = {};
  forms.forEach(([name], i) => {
    const frames = framesOf(out, replies[i]!, HALL.size, `the hall, ${name}`);
    expect(frames.length, `the hall, ${name}: every frame is reported`).toBe(FRAMES);
    const ms: number[] = [];
    for (const f of frames) {
      const maps = mapsOf(f, `the hall, ${name}, frame ${f.frame}`);
      if (maps.length !== HALL_LAMPS.length) { failures.push(`${name}, frame ${f.frame}: ${maps.length} lights hold tiles, not 18`); continue; }
      if (f.frame === 0) continue;
      const wrong = maps.filter((m) => m.drawn !== (name === 'redrawn')).map((m) => m.light);
      if (wrong.length) failures.push(`${name}, frame ${f.frame}: ${wrong.length} tiles ${name === 'redrawn' ? 'not drawn' : 'drawn again though nothing moved'}, ${wrong.slice(0, 3).join(', ')} first`);
      const gpu = f.raw['gpu_ms'];
      if (typeof gpu === 'number' && Number.isFinite(gpu)) ms.push(gpu); else failures.push(`${name}, frame ${f.frame}: no gpu_ms (${shown(gpu)})`);
    }
    p[name] = ms.length ? p95(ms) : NaN;
  });
  return { cached: p['cached']!, redrawn: p['redrawn']!, failures };
}

describe(`${ID} the hall's GPU budget`, () => {
  it(`${ID} the 18-light hall at 1920 × 1080 stays under 10 ms of GPU a frame with its tiles cached and under 25 ms on frames that redraw every tile, on the reference Mac`, () => {
    const failures: string[] = [];
    if (!timedFiles().includes(FILE)) failures.push(`scripts/lanes.mjs does not list ${FILE} in timed, the local preflight's perf step`);
    requireMetal();
    const first = run(bin());
    const reading = `cached ${first.cached.toFixed(3)} ms, every tile redrawn ${first.redrawn.toFixed(3)} ms a frame (p95 of ${FRAMES - 1} frames each)`;
    console.log(`${ID}: first run: ${reading}`);
    none([...failures, ...first.failures], `${ID}: the hall's timed frames`);
    const problem = timingProblem();
    if (problem) inconclusive(`the budget is judged only on a reference Mac at rest: ${problem}; the reading: ${reading}`);
    const scratch = mkdtempSync(join(tmpdir(), 'deep-2034-release-'));
    try {
      const release = buildGpu(scratch, true);
      expect(release.error, 'the release binary builds: cargo build --locked --release --bin deep-gpu').toBe('');
      run(release.bin);
      const runs: ReturnType<typeof run>[] = []; const loads: Load[] = [];
      for (let k = 0; k < 5; k++) { const start = load(); runs.push(run(release.bin)); loads.push({ start, end: load() }); }
      const judged: [string, JsonObject][] = [
        ['GPU ms a frame with the tiles cached, p95 (under 10)', judgeLimit(LIMITS.cached, runs.map((r) => r.cached), loads)],
        ['GPU ms a frame that redraws every tile, p95 (under 25)', judgeLimit(LIMITS.redrawn, runs.map((r) => r.redrawn), loads)],
      ];
      for (const [name, v] of judged) console.log(`${ID} ${name}: ${String(v['status'])} ${shown(v['runs'] ?? null)}${v['reason'] ? ` (${String(v['reason'])})` : ''}`);
      expect(judged.filter(([, v]) => v['status'] === 'FAIL').map(([n, v]) => `${n}: ${shown(v)}`), 'no budget fails').toEqual([]);
      const open = judged.filter(([, v]) => v['status'] !== 'PASS');
      if (open.length) inconclusive(open.map(([n, v]) => `${n}: ${String(v['status'])} ${String(v['reason'] ?? '')}`).join('; '));
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 3 * TIMEOUT);
});
