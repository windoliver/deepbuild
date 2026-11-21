// #2691.f1acfa43: The check's GPU memory estimate for the every-pass scene is within 10% of the device's peak at
// internal scale 0.5 and at 1.
//
// Read where the check itself sizes a view of the scene at each scale and the view then draws, through #379's `live`
// call with `report: ["meter", "memory"]`: the session's `meter` row gives the check's `estimate` (`gpu_bytes` at the
// `internal_scale` it fits), each frame's view says the internal scale it drew at, and each frame's `device_bytes` is
// Metal's allocated size once the frame's queue drained. No field is added (README: Surface choices).
//   - Internal scale 0.5: the every-pass scene (../2189's copy, unchanged), whose camera turns, so its showpiece class
//     sizes it at 0.5 (the budget class table), at the reference window's 3024 × 1964 px. At its own 3456 × 2234 the
//     merge base's check refuses it, and at the 1280 × 800 of #2189's criterion a mirror counted at four times its
//     pixels still reads within 10%, so a test there would pass a wrong estimate (README: Ambiguities).
//   - Internal scale 1: the same scene with its camera at rest, at 1280 × 800, where scale 1 fits its 512 MB.
// "Within 10% of the device's peak" is |estimate − peak| ≤ 10% of the peak, the largest `device_bytes` of the play's
// 30 frames, as #2189's suite reads it. Two release `deep-gpu run` processes on this Mac's Metal GPU, one a scale, so
// neither's device holds the other's view; no stub meter. Off macOS, or with no Metal device, INCONCLUSIVE.
// The run keeps its readings as target/acceptance/2691/estimate.json.
import { describe, expect, it } from 'vitest';
import {
  AC, ENVELOPE_LOOK, ENVELOPE_WRITER, EVERY_PASS, REFERENCE_WINDOW, answered, arr, by, everyPassAtRest, keep, num, obj, requireMetal, runGpu, shown, useOut, useRelease,
  type JsonObject, type Size,
} from './helpers.ts';

const bin = useRelease();
const out = useOut();
const WITHIN = 0.1;
const FRAMES = 30;
const AT_REST: Size = [1280, 800];

/** One `live` play of `doc` at `size` in a process of its own: the check's estimate and its scale, the scales its
 * frames drew at, and the device's peak. */
function play(dir: string, doc: string, size: Size, what: string): { estimate: number; scale: number; drew: number[]; peak: number } {
  const session = 'every-pass';
  const [reply] = runGpu(bin(), dir, [{
    call: 'live', look: ENVELOPE_LOOK, frames: FRAMES, fps: 60, sessions: [{ session, writer: ENVELOPE_WRITER, doc, size }], report: ['meter', 'memory'],
  }]);
  answered(reply!, what);
  const row = arr(reply!['meter'], `${what}: meter`).map((m, i) => obj(m, `${what}: meter[${i}]`)).find((m) => m['session'] === session);
  expect(row, `${what}: the check admitted the view, so the meter has its session's row: ${shown(reply!['sessions'])}`).toBeDefined();
  const estimate = obj(row!['estimate'], `${what}: the meter row's estimate`);
  const frames = arr(reply!['frames'], `${what}: frames`).map((f, i) => obj(f, `${what}: frames[${i}]`));
  expect(frames.length, `${what} played ${FRAMES} frames`).toBe(FRAMES);
  const views = frames.flatMap((f) => arr(f['views'], `${what}: a frame's views`).map((v) => obj(v, `${what}: a view`)));
  expect(views.some((v) => v['drawn'] === true), `${what}: the view drew`).toBe(true);
  return {
    estimate: num(estimate['gpu_bytes'], `${what}: estimate.gpu_bytes`), scale: num(estimate['internal_scale'], `${what}: estimate.internal_scale`),
    drew: [...new Set(views.map((v) => num(v['internal_scale'], `${what}: a view's internal_scale`)))],
    peak: Math.max(...frames.map((f) => num(f['device_bytes'], `${what}: a frame's device_bytes`))),
  };
}

describe(`${AC[4]} the check's estimate beside the device's peak`, () => {
  it(`${AC[4]} the check's GPU memory estimate for the every-pass scene is within 10% of the device's peak at internal scale 0.5 (3024 × 1964, its camera turning) and at 1 (1280 × 800, its camera at rest)`, () => {
    requireMetal();
    const dir = out();
    const plays: [number, string, Size][] = [[0.5, EVERY_PASS, REFERENCE_WINDOW], [1, everyPassAtRest(dir), AT_REST]];
    const kept: JsonObject = {};
    const read = plays.map(([want, doc, size]) => {
      const what = `the every-pass scene at ${by(size)}, internal scale ${want}`;
      const p = play(dir, doc, size, what);
      kept[String(want)] = { size_px: size, estimate_scale: p.scale, drew_scales: p.drew, estimate_bytes: p.estimate, peak_bytes: p.peak };
      return { want, what, ...p };
    });
    console.log(`${AC[4]}: ${read.map((r) => `${r.what}: estimate ${r.estimate} B, peak ${r.peak} B, ${(((r.estimate - r.peak) / r.peak) * 100).toFixed(2)}%`).join('; ')}; kept as ${keep('estimate', kept)}`);
    for (const r of read) {
      expect.soft([r.scale, r.drew], `${r.what}: the check sized the view at internal scale ${r.want}, and every frame drew at it`).toEqual([r.want, [r.want]]);
      expect.soft(r.peak, `${r.what}: the device's peak is a reading above 0`).toBeGreaterThan(0);
      expect.soft(Math.abs(r.estimate - r.peak), `${r.what}: the check's estimate ${r.estimate} B is ${(((r.estimate - r.peak) / r.peak) * 100).toFixed(2)}% from the device's peak ${r.peak} B, and within ${WITHIN * 100}% is ${Math.floor(WITHIN * r.peak)} B`).toBeLessThanOrEqual(WITHIN * r.peak);
    }
  }, 1_800_000);
});
