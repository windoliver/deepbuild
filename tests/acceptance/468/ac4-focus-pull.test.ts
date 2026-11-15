// AC4 #468.7ecff161: With the camera dollying from 6 m to 4 m while items A and B move, dof.focus keyed from A to B over
// 0.8 s gives at every frame a focus distance equal to A's evaluated distance at the first key, B's at the second and
// their eased mix between, within 1e-6 m, by seeking and by playing; and a camera of view width 20 m whose field of view
// runs from 0° to 40° projects every point as the 20 m orthographic camera does at 0° within 1e-9 of the view, keeps the
// target plane 20 m wide within 1e-9 relative at every field of view, and moves no projected point within 10 m of the
// target plane by more than 0.5 px in a 1920-wide frame between 0° and 0.01°.
//
// Through `deep-gpu run`'s `view3d` (#378), 60 frames a second.
//
// The focus pull (README: Documents): a 35 mm lens camera at (0, 1, z) looking down −Z, z keyed linearly from 6 to 4 m
// over 2 s (`items/cam/params/position/2`); A, a 0.2 m box on the view axis at z from 0 to −1 m, and B at z from −3 to
// −2 m, each keyed linearly over the 2 s; an `effect@1` of kind dof whose `focus` is keyed by a channel on
// `items/fx/params/dof/focus` with two keys that name items: "A" at 0.5 s and "B" at 1.3 s, no interpolation named, so
// in_out_cubic (Camera `camera@1`: lens). A's distance at t is 6 − t/2 m and B's 9 − 1.5·t m (on the axis, the
// distance and the depth agree). Each frame's focus distance is read through `evaluate:
// ["items/fx/params/dof/focus"]` (Assumed surface 1), from one played call (frames 0 to 120) and from a cold seek to each
// of frames 30 to 78 (0.5 s to 1.3 s); at each, within 1e-6 m of (1 − e)·A's + e·B's, e = in_out_cubic((t − 0.5) ÷ 0.8):
// A's own at 0.5 s and B's own at 1.3 s.
//
// The flat board into perspective: a camera on +Z aimed at the origin with `view_width: 20` and `fov` keyed linearly
// from 0° to 40° over 4 s (frames 0 to 240), and a twin keyed from 0° to 0.01° over 1 s (frames 0 to 60), at 1920 ×
// 1080. Each frame projects 75 points (x in −10, −5, 0, 5, 10 m; y in −5, 0, 5 m; z, toward the camera, in −10, −5, 0,
// 5, 10 m) through `project` (Assumed surface 3). At 0° every point lands where the 20 m orthographic view puts it
// (960 + 96·x, 540 − 96·y px) within 1e-9 × 1920 px; at every field of view (±10, 0, 0) land 1920 px apart within 1e-9
// relative; on the twin no point moves more than 0.5 px from where frame 0 put it. And so the channel is seen to turn
// the board: at 40° every point lands where #378's pinhole at distance 20 ÷ (2·tan 20°) puts it, within 0.01 px.
//
// Wrong programs: the base (no lens, no dof effect, no `project`); focus held at the key's item's distance at the key's
// time, or eased linearly, or measured from the camera's target; a seek that eases from the previous frame's focus; a
// field of view of 0 read as the default orthographic width, or a distance that doesn't follow the view width.
import { describe, expect, it } from 'vitest';
import {
  AC, DARK_SKY, box, dof, focalOfFov, frameAt, framesOf, inOutCubic, lensCamera, linear, linearAt, none, num, project, projectedOf, requireMetal, runGpu,
  sceneDoc, unlit, useGpu, useOut, valueAt, view3d, writeJson, type Frame, type JsonObject, type V3,
} from './helpers.ts';

const ID = AC[4];
const bin = useGpu();
const out = useOut();
const FPS = 60;
const FOCUS = 'items/fx/params/dof/focus';
const DOLLY: [number, number][] = [[0, 6], [2, 4]];
const A_Z: [number, number][] = [[0, 0], [2, -1]];
const B_Z: [number, number][] = [[0, -3], [2, -2]];
const KEYS = { a: 0.5, b: 1.3 } as const;

function pullDoc(): JsonObject {
  return sceneDoc('focus-pull', [960, 640], {
    cam: lensCamera([0, 1, 6], [0, 1, -20], { focal_length: 35 }, { aperture: { f_stop: 2.8, blades: 0 } }),
    sky: DARK_SKY, grey: unlit([0.5, 0.5, 0.5]),
    A: box([0.2, 0.2, 0.2], [0, 1, 0], 'grey'),
    B: box([0.2, 0.2, 0.2], [0, 1, -3], 'grey'),
    fx: dof({ focus: 'A', max_coc: 24 }),
  }, {
    transport: { span: '2s' },
    channels: {
      dolly: linear('items/cam/params/position/2', DOLLY), a_moves: linear('items/A/at/pos/2', A_Z), b_moves: linear('items/B/at/pos/2', B_Z),
      pull: { target: FOCUS, type: 'f32', keys: { k0: { t: `${KEYS.a}s`, value: 'A' }, k1: { t: `${KEYS.b}s`, value: 'B' } } },
    },
  });
}
/** The focus distance the criterion asks for at t s in [0.5, 1.3]. */
function wantFocus(t: number): number {
  const cam = linearAt(DOLLY, t);
  const a = cam - linearAt(A_Z, t); const b = cam - linearAt(B_Z, t);
  return a + (b - a) * inOutCubic((t - KEYS.a) / (KEYS.b - KEYS.a));
}

const SIZE: [number, number] = [1920, 1080];
const POINTS: V3[] = [];
for (const x of [-10, -5, 0, 5, 10]) for (const y of [-5, 0, 5]) for (const z of [-10, -5, 0, 5, 10]) POINTS.push([x, y, z]);
const LEFT = POINTS.findIndex((p) => p[0] === -10 && p[1] === 0 && p[2] === 0);
const RIGHT = POINTS.findIndex((p) => p[0] === 10 && p[1] === 0 && p[2] === 0);
function boardDoc(name: string, keys: [number, number][]): JsonObject {
  return sceneDoc(name, SIZE, {
    cam: { kind: 'camera@1', params: { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 0, elevation: 0 }, view_width: 20, fov: 0 } },
    sky: DARK_SKY, grey: unlit([0.5, 0.5, 0.5]), board: box([20, 11.25, 0.1], [0, 0, -0.05], 'grey'),
  }, { transport: { span: `${keys.at(-1)![0]}s` }, channels: { zoom: linear('items/cam/params/fov', keys) } });
}
const ortho = (p: V3): [number, number] => [SIZE[0] / 2 + (SIZE[0] / 20) * p[0], SIZE[1] / 2 - (SIZE[0] / 20) * p[1]];

describe(`${ID} a focus pull between moving items, and a flat board that opens into perspective`, () => {
  it(`${ID} dof.focus keyed from A to B over 0.8 s gives A's distance at the first key, B's at the second and their in_out_cubic mix between, within 1e-6 m, played and seeked`, () => {
    requireMetal();
    const dir = out();
    const doc = writeJson(dir, 'pull', pullDoc());
    const frames = Array.from({ length: Math.round((KEYS.b - KEYS.a) * FPS) + 1 }, (_, k) => Math.round(KEYS.a * FPS) + k);
    const replies = runGpu(bin(), dir, [
      view3d({ doc, size: [960, 640], fps: FPS, from: 0, frames: 2 * FPS + 1, evaluate: [FOCUS] }),
      ...frames.map((n) => view3d({ doc, size: [960, 640], fps: FPS, from: n, frames: 1, evaluate: [FOCUS] })),
    ]);
    const played = framesOf(replies[0]!, 'played');
    const failures: string[] = [];
    frames.forEach((n, k) => {
      const t = n / FPS; const want = wantFocus(t);
      for (const [side, f] of [['played', frameAt(played, n, 'played')], ['seeked', frameAt(framesOf(replies[k + 1]!, `seek to ${n}`), n, `seek to ${n}`)]] as [string, Frame][]) {
        const got = num(valueAt(f, FOCUS, `frame ${n} ${side}`), `frame ${n} ${side}: ${FOCUS}`);
        if (!(Math.abs(got - want) <= 1e-6)) failures.push(`frame ${n} (${t.toFixed(4)} s, ${side}): focus ${got} m, not ${want} m within 1e-6`);
      }
    });
    console.log(`${ID} focus pull: ${frames.length} frames from ${KEYS.a} s (A at ${wantFocus(KEYS.a)} m) to ${KEYS.b} s (B at ${wantFocus(KEYS.b)} m), played and seeked; ${failures.length} off`);
    none(failures, `${ID}: the focus pull`);
  });

  it(`${ID} view width 20 m with fov 0° to 40°: orthographic at 0° within 1e-9 of the view, the target plane 20 m wide within 1e-9 at every fov, and under 0.5 px of movement within 10 m of the plane between 0° and 0.01°`, () => {
    requireMetal();
    const dir = out();
    const wide = boardDoc('board-40', [[0, 0], [4, 40]]);
    const fine = boardDoc('board-001', [[0, 0], [1, 0.01]]);
    const [rw, rf] = runGpu(bin(), dir, [
      view3d({ doc: writeJson(dir, 'wide', wide), size: SIZE, fps: FPS, from: 0, frames: 4 * FPS + 1, project: POINTS }),
      view3d({ doc: writeJson(dir, 'fine', fine), size: SIZE, fps: FPS, from: 0, frames: FPS + 1, project: POINTS }),
    ]);
    const failures: string[] = [];
    const wideFrames = framesOf(rw!, 'fov 0° to 40°');
    expect(wideFrames.length, 'fov 0° to 40°: every frame is reported').toBe(4 * FPS + 1);
    const at0 = projectedOf(frameAt(wideFrames, 0, 'fov 0°'), POINTS.length, 'fov 0°');
    POINTS.forEach((p, i) => {
      const got = at0[i]; const want = ortho(p);
      const off = got ? Math.max(Math.abs(got[0] - want[0]), Math.abs(got[1] - want[1])) : Infinity;
      if (!(off <= 1e-9 * SIZE[0])) failures.push(`fov 0°: point (${p.join(', ')}) at ${got ? got.join(', ') : 'nothing'}, ${off} px from the 20 m orthographic view's (${want.join(', ')})`);
    });
    for (const f of wideFrames) {
      const row = projectedOf(f, POINTS.length, `frame ${f.frame}`);
      const l = row[LEFT]; const r = row[RIGHT];
      const width = l && r ? r[0] - l[0] : NaN;
      if (!(Math.abs(width - SIZE[0]) <= 1e-9 * SIZE[0])) failures.push(`frame ${f.frame} (fov ${(f.frame / FPS) * 10}°): the target plane is ${width} px wide, not ${SIZE[0]} within 1e-9 relative`);
    }
    // The channel turns the board: at 40° the pinhole at distance 20 ÷ (2·tan 20°).
    const d40 = 20 / (2 * Math.tan((20 * Math.PI) / 180));
    const at40 = projectedOf(frameAt(wideFrames, 4 * FPS, 'fov 40°'), POINTS.length, 'fov 40°');
    POINTS.forEach((p, i) => {
      const want = project({ position: [0, 0, d40], target: [0, 0, 0], focal: focalOfFov(40, SIZE), size: SIZE }, p)!;
      const got = at40[i];
      const off = got ? Math.hypot(got[0] - want[0], got[1] - want[1]) : Infinity;
      if (!(off <= 0.01)) failures.push(`fov 40°: point (${p.join(', ')}) at ${got ? got.join(', ') : 'nothing'}, ${off} px from the pinhole at ${d40.toFixed(4)} m (${want[0].toFixed(3)}, ${want[1].toFixed(3)})`);
    });
    const fineFrames = framesOf(rf!, 'fov 0° to 0.01°');
    expect(fineFrames.length, 'fov 0° to 0.01°: every frame is reported').toBe(FPS + 1);
    const base = projectedOf(frameAt(fineFrames, 0, 'fov 0°'), POINTS.length, 'fov 0° (twin)');
    let most = 0;
    for (const f of fineFrames) {
      const row = projectedOf(f, POINTS.length, `twin frame ${f.frame}`);
      POINTS.forEach((p, i) => {
        const a = base[i]; const b = row[i];
        const moved = a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : Infinity;
        most = Math.max(most, moved);
        if (!(moved <= 0.5)) failures.push(`twin frame ${f.frame} (fov ${(f.frame / FPS) * 0.01}°): point (${p.join(', ')}) moved ${moved} px from fov 0°`);
      });
    }
    console.log(`${ID} board: ${wideFrames.length} frames 0° to 40° and ${fineFrames.length} frames 0° to 0.01°; the most any point moved up to 0.01° is ${most.toExponential(3)} px`);
    none(failures, `${ID}: the flat board into perspective (${failures.length} failures)`);
  });
});
