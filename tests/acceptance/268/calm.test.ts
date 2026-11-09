// #268.2a540142: "Beside a straight quay with `calm: {near: 0.25, far: 20}`, the vertex height's amplitude over one
// period at 0, 10 and 20 m from the quay is 0.25, 0.625 and 1 times the waves' closed form within 1 mm, on a linear depth
// readback; a planted scale that ignores the field leaves the amplitude at 1 by the quay and fails, naming the material"
//
// The fixture (helpers.ts `quayDoc`): a plate of 5 cm cells from x = −2 to 30 m whose material `quay-water` carries one
// wave (QUAY_WAVE: along +Z, 8 m long, 0.4 m high, steepness 0, so a point moves only up and down) and `shore: {items:
// "quay-shore", calm: {near: 0.25, far: 20}}`; the quay `quay`, a box whose straight face x = 0 meets the water along z,
// the one member of `quay-shore`. So a point at x m from the face is x m from the quay.
//
// Each distance is seen by its own camera 5 m straight above the point (x, 0) with x = 0.05 m ("0 m": half a cell off
// the face, where the factor is 0.25 + 1.4e-5), 10 m and 20 m, each a vertex of the plate, in a 129 × 129 frame whose
// centre pixel's ray is vertical; its `depth` (#166's linear depth readback) gives the height there as 5 m less the depth.
// 18 frames 4 apart from 0 to 68 at 30 fps cover one period of the wave (2.265 s). The amplitude over the period is half
// the heights' range, and must be within 1 mm of 0.25, 0.625 and 1 times the closed form's half range at the same times
// (#166's A cos(k z − ω t), ω = √(g k)). The planted scale (`deep-gpu run --planted shore_calm_ignores_field`) scales
// each wave without reading the field: by the quay the amplitude is the closed form's, and the check fails, naming the
// material `quay-water` and the distance.
import { describe, expect, it } from 'vitest';
import {
  AC, type Cam, G, type JsonObject, type Planted, QUAY_WAVE, camItem, frameAt, framesOf, failsNaming, look3d, none, quayDoc, readFloats, requireGpu,
  runGpu, useGpu, useOut, view3d, waveHeight, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [129, 129];
const H = 5;
const LOOK = look3d('calm-268');
const FRAMES = Array.from({ length: 18 }, (_, k) => 4 * k);
const POINTS: { label: string; x: number; factor: number }[] = [
  { label: '0 m', x: 0.05, factor: 0.25 }, { label: '10 m', x: 10, factor: 0.625 }, { label: '20 m', x: 20, factor: 1 },
];
const half = (xs: number[]): number => (Math.max(...xs) - Math.min(...xs)) / 2;

interface Reading { label: string; x: number; factor: number; measured: number; closed: number }
function measure(planted?: Planted): Reading[] {
  const dir = out();
  const calls: JsonObject[] = POINTS.map(({ x }, k) => {
    const cam: Cam = { position: [x, H, 0], target: [x, 0, 0], fov: 10, size: SIZE };
    const doc = writeJson(dir, `quay-${k}`, quayDoc(`quay-${k}`, SIZE, camItem(cam), { near: 0.25, far: 20 }));
    return view3d({ doc, look: LOOK, size: SIZE, frames: 69, fps: 30, capture: FRAMES, targets: ['depth'] });
  });
  const replies = runGpu(bin(), dir, calls, planted);
  return POINTS.map(({ label, x, factor }, k) => {
    const frames = framesOf(replies[k]!, `the quay at ${label}`);
    const heights = FRAMES.map((n) => H - readFloats(dir, frameAt(frames, n, `the quay at ${label}`), 'depth', SIZE, `the quay at ${label}, frame ${n}`).v[64 * SIZE[0] + 64]!);
    return { label, x, factor, measured: half(heights), closed: half(FRAMES.map((n) => waveHeight(QUAY_WAVE, x, 0, n / 30))) };
  });
}
/** Each distance's amplitude against its factor times the closed form's, within 1 mm; failures name the material. */
function calmProblems(readings: Reading[]): string[] {
  return readings.filter((r) => !(Math.abs(r.measured - r.factor * r.closed) <= 0.001)).map((r) =>
    `material quay-water: at ${r.label} from the quay (x ${r.x} m) the height's amplitude over one period is ${r.measured.toFixed(5)} m, ${(r.measured / r.closed).toFixed(4)} times the closed form's ${r.closed.toFixed(5)} m, not ${r.factor} times within 1 mm`);
}

describe(`${AC[2]} the swell lies calmer by the quay as the field says`, () => {
  it(`${AC[2]} at 0, 10 and 20 m from the quay the amplitude over one period is 0.25, 0.625 and 1 times the closed form within 1 mm`, () => {
    requireGpu();
    const k = (2 * Math.PI) / QUAY_WAVE.length;
    expect(FRAMES.at(-1)! / 30, 'the frames cover one period of the wave').toBeGreaterThanOrEqual((2 * Math.PI) / Math.sqrt(G * k));
    const readings = measure();
    for (const r of readings) console.log(`${AC[2]}: at ${r.label} the amplitude is ${r.measured.toFixed(5)} m, ${(r.measured / r.closed).toFixed(4)} × the closed form's ${r.closed.toFixed(5)} m (want ${r.factor})`);
    none(calmProblems(readings), 'the calm factor by the quay');
  });

  it(`${AC[2]} a planted scale that ignores the field (--planted shore_calm_ignores_field) leaves the amplitude at 1 by the quay and fails, naming the material`, () => {
    requireGpu();
    const readings = measure('shore_calm_ignores_field');
    failsNaming(calmProblems(readings), ['material quay-water', 'at 0 m from the quay'], 'shore_calm_ignores_field');
    const byQuay = readings[0]!;
    expect(Math.abs(byQuay.measured - byQuay.closed), 'under the plant the amplitude by the quay is the closed form\'s').toBeLessThanOrEqual(0.001);
  });
});
