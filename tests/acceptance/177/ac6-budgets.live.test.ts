// AC6 #177.707c9022: Budgets, on the reference Mac in the local preflight, compared with the merge base: HDR output
// adds under 0.2 ms of GPU per frame at 3024 × 1964 and nothing on the CPU per frame, and a changed headroom takes
// effect within 2 frames.
//
// The `timed` lane's file: live, the app's real window on the reference Mac's XDR display (`deep-app --hdr`,
// hdr-fixture build, release), DEEP_177_LIVE=1. The window is 1512 × 982 pt at scale 2, the view filling it: 3024 ×
// 1964 device px (another scale is INCONCLUSIVE). "Compared with the merge base": the merge base has no HDR output,
// so its frame is the same view with `hdr: "off"`, which draws through the SDR surface as the base does; what HDR adds
// is the difference. A warm-up pair, then five runs, each a pair of 360 frames with hdr auto and off (alternating
// which goes first), each side's p95 over its last 300 frames, judged by scripts/benchmark.mjs's `judgeLimit` with the
// load at each run's start and end:
// - GPU: the added p95 `gpu_ms`, against 0.2 ms.
// - CPU: the added p95 `cpu_ms` (the UI thread's time in the frame), against 0.01 ms, the resolution taken as nothing
//   (README: Readings); and in every run the app reads the display's headroom no more often than once when the HDR
//   surface shows plus once for each change the display posted (`headroom_reads` ≤ 1 + `display_posts`).
// - A change: 240 frames with hdr auto, the display seam posting a headroom of 1.5 before frame 120; the frame's HDR
//   surface's peak (the lamp at the look's white reaches the headroom) reads 1.5 by frame 122, in each of five runs.
// The wrong program `reads_headroom_every_frame` reads the display's headroom on the UI thread every frame.
import { describe, expect, it } from 'vitest';
import {
  AC, LOOK, TIMEOUT, inconclusive, judge, lampsDoc, liveHdr, load, p95, requireLive, requireXdr, useBuild, useDir, writeJson,
  type AppPlant, type JsonObject, type LiveReport,
} from './helpers.ts';

const app = useBuild('app');
const dir = useDir();
const FRAMES = 360;

function play(hdr: 'auto' | 'off', extra: JsonObject = {}, plant?: AppPlant): LiveReport {
  const out = dir();
  const doc = writeJson(out, 'lamps', lampsDoc());
  const r = liveHdr(app(), out, { doc, look: LOOK, window: [1512, 982], page: [200, 200, 200], view: [0, 0, 1512, 982], hdr, frames: FRAMES, ...extra }, plant);
  requireXdr(r);
  if (r.scale !== 2) inconclusive(`the window draws at scale ${r.scale}; 3024 × 1964 device px needs scale 2`);
  return r;
}
const tail = (r: LiveReport, k: 'gpu_ms' | 'cpu_ms'): number => {
  const v = r.frames.slice(-300).map((f) => f[k]);
  expect(v.every((x) => x !== null), `every frame reports ${k}`).toBe(true);
  return p95(v as number[]);
};
const readsProblem = (r: LiveReport): string | null =>
  r.headroom_reads > 1 + r.display_posts ? `the app reads the display's headroom ${r.headroom_reads} times in ${r.frames.length} frames with ${r.display_posts} change(s) posted: CPU work per frame` : null;

describe(`${AC[6]} HDR output's budgets on the reference Mac`, () => {
  it(`${AC[6]} HDR output adds under 0.2 ms of GPU and nothing on the CPU per frame at 3024 × 1964, five runs against hdr off`, async () => {
    requireLive('the budgets');
    play('auto'); play('off');
    const gpu: number[] = []; const cpu: number[] = []; const loads: { start: number; end: number }[] = []; const reads: string[] = [];
    for (let run = 0; run < 5; run++) {
      const start = load();
      const pair = run % 2 === 0 ? [play('auto'), play('off')] : [play('off'), play('auto')].reverse();
      const [on, off] = pair as [LiveReport, LiveReport];
      expect(on.frames.every((f) => f.state === 'on'), `run ${run + 1}: every frame with hdr auto presents HDR`).toBe(true);
      gpu.push(Math.max(0, tail(on, 'gpu_ms') - tail(off, 'gpu_ms')));
      cpu.push(Math.max(0, tail(on, 'cpu_ms') - tail(off, 'cpu_ms')));
      const r = readsProblem(on);
      if (r) reads.push(`run ${run + 1}: ${r}`);
      loads.push({ start, end: load() });
    }
    expect(reads, 'the headroom is read only when the display posts a change').toEqual([]);
    const g = await judge(0.2, gpu, loads); const c = await judge(0.01, cpu, loads);
    console.log(`${AC[6]}: added GPU p95 ${JSON.stringify(gpu)} ms → ${String(g['status'])}; added CPU p95 ${JSON.stringify(cpu)} ms → ${String(c['status'])}`);
    expect(g['status'], `HDR output's added GPU per frame: ${JSON.stringify(g)}`).not.toBe('FAIL');
    expect(c['status'], `HDR output's added CPU per frame: ${JSON.stringify(c)}`).not.toBe('FAIL');
    const open = [g, c].filter((x) => x['status'] !== 'PASS');
    if (open.length) inconclusive(open.map((x) => String(x['reason'])).join('; '));
  }, TIMEOUT);

  it(`${AC[6]} a headroom the display posts before frame 120 takes effect by frame 122, in each of five runs`, () => {
    requireLive('the budgets');
    const p: string[] = [];
    for (let run = 1; run <= 5; run++) {
      const r = play('auto', { frames: 240, posts: [{ frame: 120, headroom: 1.5 }], read_peak: true });
      const before = r.frames.find((f) => f.frame === 119);
      if (!before || before.state !== 'on') { p.push(`run ${run}: frame 119 doesn't present HDR (${JSON.stringify(before)})`); continue; }
      if (!(before.headroom > 1.5)) inconclusive(`run ${run}: the display's headroom before the post is ${before.headroom}, not above 1.5, so a fall to 1.5 can't be seen; raise the display's brightness below its maximum`);
      const took = r.frames.find((f) => f.frame >= 120 && f.peak !== null && Math.abs(f.peak - 1.5) <= 0.01);
      if (!took || took.frame > 122) p.push(`run ${run}: the headroom of 1.5 posted before frame 120 takes effect ${took ? `at frame ${took.frame}` : 'in no frame'}, past 2 frames`);
    }
    expect(p).toEqual([]);
  }, TIMEOUT);

  it(`${AC[6]} planted reads_headroom_every_frame (the UI thread reads the headroom every frame) fails, naming the reads`, () => {
    requireLive('the budgets');
    const r = readsProblem(play('auto', {}, 'reads_headroom_every_frame'));
    expect(r, 'the check fails on the planted program, naming the reads').not.toBeNull();
  }, TIMEOUT);
});
