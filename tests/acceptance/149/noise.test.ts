// AC8 #149.1c3a3068: A noise fill with a cycle of 4 turns gives the same frame at an evolution of 1,440° as at 0°, seeking
// equals playing by pixel hash, a world-anchored noise fill stays within 0.5 px of its reprojected place through a
// dolly, and a status role in its ramp is refused.
//
// Each frame here fills a panel with the noise, so a hash reads the whole field. Evolution is a phase through a 4D
// lattice, so with a cycle of 4 turns the field at 1,440° is the field at 0° and the field half way is another. The
// dolly is AC2's arithmetic on the fill's own layer: 9,100 u of camera, each frame against the one before it, reprojected.
// The status role is `status.pass`, the form #374's refusals use, and its code `status_color_unbound`.
//
// Wrong programs: a phase that doesn't wrap at the cycle (1,440° differs); evolution ignored (720° equals 0°); noise
// anchored to the screen; a seed taken from playback; a ramp that takes any role.
import { describe, expect, it } from 'vitest';
import {
  AC, chainProblems, errorsOf, figure, film2dCall, flickOf, layerFloats, layersCall, look, mark, none, oneLine, requireMetal, residuals, rows, runGpu, shown, toGray, useBin, useDir,
  useGpu, type Gray, type JsonObject, type Pose, type Residual,
} from './helpers.ts';

const ID = AC[8];
const bin = useGpu();
const render = useBin('deep-canvas-render');
const dir = useDir();
const LOOK = look({ id: 'noise-149' });
const SIZE = [240, 135] as const;

const noise = (fields: JsonObject): JsonObject => ({
  noise: { kind: 'fractal', scale: 40, octaves: 5, roughness: 0.5, cycle: 4, stops: [{ at: 0, role: 'ink' }, { at: 0.5, role: 'accent' }, { at: 1, role: 'ground' }], seed: 11, ...fields },
});
const panel = (fill: JsonObject, box: number[] = [0, 0, SIZE[0], SIZE[1]]): JsonObject => mark('plate', 'rect@1', 'a0', { box, paint: { fill } });
const still = (id: string, evolution: number): JsonObject => figure(id, SIZE, { plate: panel(noise({ evolution })) });
const hashOf = (doc: JsonObject, extra: JsonObject = {}): string => {
  const [reply] = runGpu(bin(), dir(), [film2dCall(doc, LOOK, { frames: 1, ...extra })]);
  return rows(reply!, `the noise, ${shown(extra)}`)[0]!.hash;
};
const FPS = 30;
const moving = (): JsonObject => figure('noise-move-149', SIZE, { plate: panel(noise({ evolution: 0 })) }, {
  channels: { turn: { target: 'items/plate/params/paint/fill/noise/evolution', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '4s', value: 1440, interp: 'linear' } } } },
});

describe(`${ID} the noise fill`, () => {
  it(`${ID} with a cycle of 4 turns, evolution 1,440° draws the frame 0° does and 720° another, and seeking equals playing by pixel hash`, () => {
    requireMetal();
    const zero = hashOf(still('noise-0-149', 0));
    expect(hashOf(still('noise-1440-149', 1440)), 'the phase comes back after 4 turns').toBe(zero);
    expect(hashOf(still('noise-720-149', 720)), 'the phase moves in between').not.toBe(zero);
    const doc = moving();
    const out = dir();
    const played = new Map(rows(runGpu(bin(), out, [film2dCall(doc, LOOK, { fps: FPS, frames: 121 })])[0]!, 'the play').map((r) => [r.frame, r.hash]));
    expect(new Set(played.values()).size, 'the field moves').toBeGreaterThan(60);
    for (const n of [1, 37, 90, 120]) {
      const sought = rows(runGpu(bin(), out, [film2dCall(doc, LOOK, { fps: FPS, from: n, frames: 1 })])[0]!, `sought to ${n}`)[0]!;
      expect(sought.hash, `frame ${n} sought equals frame ${n} played`).toBe(played.get(n));
    }
    expect(played.get(120), 'at 4 s, four turns on, the frame is frame 0').toBe(played.get(0));
  });

  it(`${ID} a world-anchored noise fill stays within 0.5 px of its reprojected place through a dolly`, () => {
    requireMetal();
    const [W, H] = [480, 270] as const;
    const doc = figure('noise-dolly-149', [W, H], {
      cam: mark('cam', 'camera@1', 'a0', { projection: 'orthographic', target: [240, 135, 0], view_width: W }),
      plate: panel(noise({ anchor: 'world', scale: 48, evolution: 0 }), [-480, -270, 10_560, 810]),
    }, {
      camera: 'cam',
      channels: { dolly: { target: 'items/cam/params/target/0', type: 'f32', keys: { k0: { t: '0s', value: 240, interp: 'linear' }, k1: { t: '20s', value: 9340, interp: 'hold' } } } },
    });
    const pose = (n: number): Pose => ({ x: 240 + (9100 * Math.min(n / FPS, 20)) / 20, y: 135, vw: W });
    const ns = Array.from({ length: 39 }, (_, k) => Math.min(k * 16, 600));
    const out = dir();
    const grays: Gray[] = [];
    for (let i = 0; i < ns.length; i += 16) {
      const batch = ns.slice(i, i + 16);
      runGpu(bin(), out, batch.map((n) => layersCall(doc, LOOK, { t: flickOf(n, FPS) }))).forEach((r, k) => grays.push(toGray(layerFloats(out, r, 'main', [W, H], `frame ${batch[k]!}`))));
    }
    const links: { label: string; found: Residual[] }[] = [];
    for (let i = 1; i < ns.length; i++) links.push({ label: `frame ${ns[i - 1]!} to ${ns[i]!}`, found: residuals(grays[i - 1]!, pose(ns[i - 1]!), grays[i]!, pose(ns[i]!)) });
    const result = chainProblems('the noise', links, W, H, 0.5);
    console.log(`${ID}: worst patch ${result.worst.toFixed(3)} px, drift along the chain ${result.drift.toFixed(3)} px`);
    none(result.problems, 'noise off its reprojected place');
  });

  it(`${ID} a status role in the ramp is refused, naming the item; the same fill over data roles checks`, () => {
    const stops = (role: string): JsonObject => noise({ stops: [{ at: 0, role: 'ink' }, { at: 1, role }] });
    const bad = errorsOf(oneLine(render(), ['check'], { doc: figure('noise-status-149', SIZE, { plate: panel(stops('status.pass')) }), look: LOOK }));
    expect(bad.map((e) => e.code), `the status-color rule refuses the ramp: ${shown(bad)}`).toContain('status_color_unbound');
    expect(bad.find((e) => e.code === 'status_color_unbound')?.ids, 'the refusal names the item').toContain('plate');
    expect(errorsOf(oneLine(render(), ['check'], { doc: figure('noise-data-149', SIZE, { plate: panel(stops('accent')) }), look: LOOK })), 'data roles check').toEqual([]);
  });
});
