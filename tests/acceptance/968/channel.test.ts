// #968.baa8eab9: "On a straight 40 m channel with `flow: {along: c, speed: 1.5, cycle: 2}`, the surface normal at 64
// sampled pixels matches the two-phase closed form within 1e-3 at 30 times over 4 s, seeked or played, by pixel hash;
// the mean frame-to-frame difference at each phase wrap stays within 1.5 times its median over the cycle, while a
// planted single-phase flow jumps at every wrap, at t = 2 s first, by more than 5 times its median and fails, naming
// the material and the time"
//
// The fixture (helpers.ts `channelDoc`): a 40 m × 8 m plate `channel` whose material `channel-water` carries FLAT water
// (no waves: a wind of 0 m/s, so the ripples drift with no wind; ripples at strength 0.1; no rain; the steepness foam
// off) and `flow: {along: "c", speed: 1.5, cycle: 2}`; `c` is a straight curve along the channel's centre from x = −20
// to 20 m, so downstream is +x at every point. The camera looks straight down from 6 m over the channel's middle (fov
// 30°, a 3.2 m square of water), so every pixel sees water and its centre ray meets the water at rest at a point fixed
// by the camera alone.
//
// The closed form (README; helpers.ts `twoPhase` and `blend`). Each phase p ∈ {0, 1 s} carries the ripples' noise
// downstream by o_p = 1.5 × ((t + p) mod 2) m and weighs w_p = 1 − |(t + p) mod 2 − 1|, 0 where it wraps. The still
// water (the same document with no flow) seen from the camera moved upstream by o_p shows, at each pixel, the noise
// from o_p upstream of the pixel's point: the normal phase p carries there. The expected normal is the two noises
// blended by their weights (their slopes summed, `blend`). 64 seeded pixels at 30 times, frames 4, 8, …, 120 at 30 fps
// (t = 2/15 s to 4 s): the `normal` target (README) of the played film and of each frame seeked cold is within 1e-3 of
// it, and each seeked frame's pixel hash is the played one's. Not vacuous: at every time some expected normal is more
// than 1e-2 from the still water's at that pixel, so a flow that doesn't move the noise, or moves it the wrong way or
// at the wrong speed, fails.
//
// The wraps: the same channel, 128 × 128, played at 60 fps from 0 to 4 s and a frame (242 frames), its `normal` read at
// every frame. A frame's difference is the mean over its pixels of |n_k − n_(k−1)|; a phase wraps at 1, 2, 3 and 4 s,
// and the difference there (the larger of the two that touch the wrap's frame) stays within 1.5 times the median of the
// 120 differences of its cycle (0 to 2 s, or 2 to 4 s). The planted single-phase flow (`deep-gpu run --planted
// water_flow_single_phase`: one phase, offset 1.5 × (t mod 2), weight 1) jumps at 2 and 4 s by more than 5 times its
// median; its check fails, first at 2 s, naming the material `channel-water` and the time.
import { describe, expect, it } from 'vitest';
import {
  AC, CHANNEL_FLOW, type Cam, FLAT, type Floats, type Frame, Lcg, type Planted, type V3, at3, blend, camItem, channelDoc, dist3, failsNaming, frameAt,
  framesOf, look3d, median, moved, none, readFloats, requireGpu, runGpu, twoPhase, useGpu, useOut, view3d, wraps, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const LOOK = look3d('channel-968');
const SPEED = 1.5; const CYCLE = 2; const SPAN = 4;
const FLOWING = { ...FLAT, flow: CHANNEL_FLOW };
const TOL = 1e-3;

describe(`${AC[1]} the channel's surface runs downstream in two phases with no jump at a wrap`, () => {
  it(`${AC[1]} the surface normal at 64 sampled pixels matches the two-phase closed form within 1e-3 at 30 times over 4 s, seeked or played, by pixel hash`, () => {
    requireGpu();
    const dir = out();
    const SIZE: [number, number] = [256, 256];
    const CAM: Cam = { position: [0, 6, 0], target: [0, 0, 0], fov: 30, size: SIZE };
    const FPS = 30;
    const FRAMES = Array.from({ length: 30 }, (_, k) => 4 * (k + 1));
    const rng = new Lcg(968);
    const pixels = Array.from({ length: 64 }, () => [8 + Math.floor(rng.next() * (SIZE[0] - 16)), 8 + Math.floor(rng.next() * (SIZE[1] - 16))] as [number, number]);
    const flowing = writeJson(dir, 'flowing', channelDoc('channel-flowing', SIZE, camItem(CAM), FLOWING));
    const still = (name: string, cam: Cam, n: number) =>
      view3d({ doc: writeJson(dir, name, channelDoc(`channel-${name}`, SIZE, camItem(cam), FLAT)), look: LOOK, size: SIZE, from: n, frames: 1, fps: FPS, capture: [n], targets: ['normal'] });
    const calls = [
      view3d({ doc: flowing, look: LOOK, size: SIZE, frames: SPAN * FPS + 1, fps: FPS, capture: FRAMES, targets: ['normal'] }),
      still('still', CAM, 0),
      ...FRAMES.flatMap((n) => {
        const [a, b] = twoPhase(n / FPS, SPEED, CYCLE);
        return [
          view3d({ doc: flowing, look: LOOK, size: SIZE, from: n, frames: 1, fps: FPS, capture: [n], targets: ['normal'] }),
          still(`still-${n}-a`, moved(CAM, [-a.offset, 0, 0]), n),
          still(`still-${n}-b`, moved(CAM, [-b.offset, 0, 0]), n),
        ];
      }),
    ];
    const replies = runGpu(bin(), dir, calls);
    const normalAt = (k: number, n: number, what: string): { f: Frame; t: Floats } => {
      const f = frameAt(framesOf(replies[k]!, what), n, what);
      return { f, t: readFloats(dir, f, 'normal', SIZE, what) };
    };
    const played = framesOf(replies[0]!, 'the played channel');
    const plain = normalAt(1, 0, 'the still water').t;
    const failures: string[] = [];
    let worst = 0;
    FRAMES.forEach((n, k) => {
      const t = n / FPS;
      const [a, b] = twoPhase(t, SPEED, CYCLE);
      const p = frameAt(played, n, 'the played channel');
      const playedNormal = readFloats(dir, p, 'normal', SIZE, 'the played channel');
      const seeked = normalAt(2 + 3 * k, n, `the channel seeked to frame ${n}`);
      const sa = normalAt(3 + 3 * k, n, `the still water ${a.offset.toFixed(3)} m upstream`).t;
      const sb = normalAt(4 + 3 * k, n, `the still water ${b.offset.toFixed(3)} m upstream`).t;
      if (seeked.f.pixel_hash !== p.pixel_hash) failures.push(`material channel-water: at ${t.toFixed(4)} s (frame ${n}) the seeked frame's pixel hash ${seeked.f.pixel_hash.slice(0, 12)} differs from the played one's ${p.pixel_hash.slice(0, 12)}`);
      let moves = 0;
      for (const [i, j] of pixels) {
        const want = blend(at3(sa, i, j), a.weight, at3(sb, i, j), b.weight);
        moves = Math.max(moves, dist3(want, at3(plain, i, j)));
        for (const [how, got] of [['played', at3(playedNormal, i, j)], ['seeked', at3(seeked.t, i, j)]] as [string, V3][]) {
          const off = dist3(got, want);
          worst = Math.max(worst, Number.isFinite(off) ? off : Infinity);
          if (!(off <= TOL)) failures.push(`material channel-water: at ${t.toFixed(4)} s (frame ${n}, ${how}) pixel (${i}, ${j}): normal (${got.map((v) => v.toFixed(5)).join(', ')}), the two-phase closed form (${want.map((v) => v.toFixed(5)).join(', ')}) from offsets ${a.offset.toFixed(3)} m × ${a.weight.toFixed(3)} and ${b.offset.toFixed(3)} m × ${b.weight.toFixed(3)}, off ${off.toExponential(2)}`);
        }
      }
      expect(moves, `at ${t.toFixed(4)} s the flow moves the surface: some expected normal is more than 1e-2 from the still water's, so the check isn't vacuous`).toBeGreaterThan(1e-2);
    });
    console.log(`${AC[1]}: worst of 64 pixels × 30 times × (played, seeked) ${worst.toExponential(3)} off the two-phase closed form`);
    none(failures, 'the two-phase closed form within 1e-3, seeked or played');
  });

  /** The channel played at 60 fps over 4 s and a frame, `normal` read at every frame; each phase wrap's frame-to-frame
   * difference against its cycle's median. Failures name the material and the wrap's time. */
  function wrapCheck(planted?: Planted): { failures: string[]; ratios: Map<number, number> } {
    const dir = out();
    const SIZE: [number, number] = [128, 128];
    const CAM: Cam = { position: [0, 6, 0], target: [0, 0, 0], fov: 30, size: SIZE };
    const FPS = 60;
    const COUNT = SPAN * FPS + 2;
    const [reply] = runGpu(bin(), dir, [
      view3d({ doc: writeJson(dir, 'flowing', channelDoc('channel-wraps', SIZE, camItem(CAM), FLOWING)), look: LOOK, size: SIZE, frames: COUNT, fps: FPS, capture: 'every', targets: ['normal'] }),
    ], planted);
    const frames = framesOf(reply!, 'the recorded channel');
    expect(frames.length, `the recording holds ${COUNT} frames`).toBe(COUNT);
    const normals = Array.from({ length: COUNT }, (_, n) => readFloats(dir, frameAt(frames, n, 'the recorded channel'), 'normal', SIZE, 'the recorded channel'));
    const drawn = (t: Floats, p: number): boolean => t.v[3 * p]! !== 0 || t.v[3 * p + 1]! !== 0 || t.v[3 * p + 2]! !== 0;
    // diff[k]: frame k against frame k − 1 (diff[0] unused).
    const diff = normals.map((t, k) => {
      if (k === 0) return 0;
      let sum = 0; let count = 0;
      for (let p = 0; p < SIZE[0] * SIZE[1]; p++) {
        if (!drawn(t, p) || !drawn(normals[k - 1]!, p)) continue;
        sum += Math.hypot(t.v[3 * p]! - normals[k - 1]!.v[3 * p]!, t.v[3 * p + 1]! - normals[k - 1]!.v[3 * p + 1]!, t.v[3 * p + 2]! - normals[k - 1]!.v[3 * p + 2]!);
        count++;
      }
      expect(count, `frames ${k - 1} and ${k} both draw water at nine in ten pixels or more`).toBeGreaterThanOrEqual(0.9 * SIZE[0] * SIZE[1]);
      return sum / count;
    });
    const failures: string[] = []; const ratios = new Map<number, number>();
    for (const T of wraps(CYCLE, SPAN)) {
      const k = Math.round(T * FPS);
      const c = Math.ceil(T / CYCLE - 1e-9) - 1;
      const m = median(diff.slice(c * CYCLE * FPS + 1, (c + 1) * CYCLE * FPS + 1));
      const jump = Math.max(diff[k]!, diff[k + 1]!);
      const ratio = jump / m;
      ratios.set(T, ratio);
      console.log(`${AC[1]}${planted ? ` (--planted ${planted})` : ''}: wrap at ${T} s: difference ${jump.toExponential(3)}, ${ratio.toFixed(2)} times the median ${m.toExponential(3)} of ${c * CYCLE} to ${(c + 1) * CYCLE} s`);
      if (!(m > 0)) failures.push(`material channel-water: the surface doesn't move from frame to frame between ${c * CYCLE} and ${(c + 1) * CYCLE} s (median difference ${m})`);
      else if (!(ratio <= 1.5)) failures.push(`material channel-water: at ${T} s (frames ${k - 1} to ${k + 1}) the mean frame-to-frame difference of the surface normal is ${jump.toExponential(3)}, ${ratio.toFixed(2)} times its median ${m.toExponential(3)} over the cycle from ${c * CYCLE} to ${(c + 1) * CYCLE} s, past 1.5`);
    }
    return { failures, ratios };
  }

  it(`${AC[1]} the mean frame-to-frame difference at each phase wrap stays within 1.5 times its median over the cycle`, () => {
    requireGpu();
    none(wrapCheck().failures, 'no jump at a phase wrap');
  });

  it(`${AC[1]} a planted single-phase flow (--planted water_flow_single_phase) jumps at every wrap, at t = 2 s first, by more than 5 times its median and fails, naming the material and the time`, () => {
    requireGpu();
    const { failures, ratios } = wrapCheck('water_flow_single_phase');
    failsNaming(failures, ['material channel-water', 'at 2 s'], 'water_flow_single_phase');
    expect(failures[0], 'the first failure is the wrap at 2 s').toContain('at 2 s');
    for (const T of [2, 4]) expect(ratios.get(T), `the single phase jumps at its wrap at ${T} s by more than 5 times its median`).toBeGreaterThan(5);
  });
});
