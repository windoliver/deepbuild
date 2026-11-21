// AC1 #3025.f34de22c: A material operator whose coverage can cut compiles, and its holes let light through: over a lit
// plate under one shadowed spot, a solid whose operator discards where uv0.u < 0.5 throws a shadow from its kept half
// only, and a solid whose operator writes alpha 0 everywhere throws none.
//
// Three disks side by side, 6 m apart, each 1 m across and 0.1 m thick, its centre 3 m over a matte plate (ρ 0.8) and
// 2 m under its own shadowed spot (987 lm, inner 28°, outer 30°, range 8, radius 0.02), which points straight down at
// it; a black sky, so the spots are the only light. Each disk is a `mark.cylinder@1` turned 90° about X, so its caps face
// ±Z. On both caps of the unit cylinder (crates/deep-scene3d-render/src/mesh.rs) uv0.u is 0.5 + x, and the turn keeps
// x, so uv0.u < 0.5 is the disk's −x half on both caps, and whatever cuts the caps cuts the disk in the spot's map. (A
// box's top and bottom faces run u along different axes, so a halved box would still cover three quarters of its
// shadow.)
//   `halved` (x = −6): its operator `halve` discards where uv0.u < 0.5. Its shadow falls on the +x side only.
//   `hollow` (x = 0): its operator `hollow_op` writes alpha 0 everywhere. It throws no shadow.
//   `plain` (x = 6): no operator, the control: its shadow falls on both sides, so the frame's spots do cast here.
// The view is orthographic from +Z, 16 m across 960 × 240 px (60 px/m). A cap's shadow on the plate is 5 ÷ (5 − z)
// times its size: 1.22 m (bottom cap) to 1.28 m (top cap) in radius, beside a disk that hides 0.5 m of the plate in the
// view. On each side of each disk, |y| ≤ 0.4 m, the test reads the plate's linear red mean on a ring 0.6 to 0.95 m from
// the centre, inside the shadow and clear of the disk in the view, and beside it, 1.45 to 1.65 m out, lit whatever the
// disk does. A ring under a shadow reads under 5% of the plate beside it; a lit one over 90% (its own lit level is about
// 1.17 of it, being nearer the spot). Each spot must also report its local map (`shadows: true`), so a dropped shadow
// can't pass for a hole.
//
// Every failure names the disk it is about. Wrong programs: the base, where both operators are refused because their
// shadow pipeline reads the light group, so view3d refuses the frame (operator_compile) and the test fails naming
// `halved` and `hollow`; a shadow pass that draws an operator solid whole fails naming both; one that leaves operator
// solids out of the map fails naming `halved`; one that keeps discards but not alpha fails naming `hollow`; one that
// discards the other half fails naming `halved`.
import { describe, expect, it } from 'vitest';
import {
  DARK_SKY, box, inconclusive, material, materialOp, matte, none, only, ortho, orthoPoint, readLinear, requireMetal, runGpu, sessionDoc, shadowsOf, shown, spot,
  useDir, useGpu, view3dCall, writeJson, type JsonObject, type Linear, type V3,
} from '../446/helpers.ts';

const ID = 'AC1 #3025.f34de22c';
const bin = useGpu();
const dir = useDir();
const SIZE: [number, number] = [960, 240];
const WIDTH = 16;
const TARGET: V3 = [0, 0, 0];
/** A disk's size (diameter, thickness, diameter, before its turn), its centre's height and its spot's. */
const DISK: V3 = [1, 0.1, 1];
const Z = 3;
const SPOT_Z = 5;
const POWER = 987;
/** The bands, in m from a disk's centre along x, and their half height in y. */
const RING: [number, number] = [0.6, 0.95];
const BESIDE: [number, number] = [1.45, 1.65];
const HALF_Y = 0.4;
const DARK = 0.05;
const LIT = 0.9;

const HALVE = materialOp('Cuts away the half where uv0.u < 0.5.', {
  uv: { op: 'uv0@1', args: {} },
  u: { op: 'split@1', args: { x: 'uv', pick: 'x' } },
  left: { op: 'lt@1', args: { a: 'u', b: 0.5 } },
  d: { op: 'discard_if@1', args: { cond: 'left' } },
  c: { op: 'const@1', args: { value: [0.8, 0.8, 0.8], type: 'vec3' } },
}, { base_color: 'c' });
const HOLLOW = materialOp('Writes alpha 0 everywhere.', {
  a: { op: 'const@1', args: { value: 0, type: 'f32' } },
  c: { op: 'const@1', args: { value: [0.8, 0.8, 0.8], type: 'vec3' } },
}, { base_color: 'c', alpha: 'a' });

/** Each disk, its spot, and which of its sides (+x is uv0.u ≥ 0.5) its shadow darkens. */
const DISKS = [
  { id: 'halved', x: -6, spot: 'spot_halved', material: 'halved_mat', op: 'halve', dark: { plus: true, minus: false } },
  { id: 'hollow', x: 0, spot: 'spot_hollow', material: 'hollow_mat', op: 'hollow_op', dark: { plus: false, minus: false } },
  { id: 'plain', x: 6, spot: 'spot_plain', material: 'grey', op: null, dark: { plus: true, minus: true } },
] as const;

function holesDoc(): JsonObject {
  const beam = { shadow: true, inner: 28, outer: 30, range: 8, radius: 0.02 };
  const items: Record<string, JsonObject> = {
    cam: ortho(TARGET, WIDTH), sky: DARK_SKY, grey: matte(0.8), halve: HALVE, hollow_op: HOLLOW,
    halved_mat: material({ base_color: [0.8, 0.8, 0.8, 1], roughness: 1, op: 'halve' }),
    hollow_mat: material({ base_color: [0.8, 0.8, 0.8, 1], roughness: 1, op: 'hollow_op' }),
    plate: box([16, 5, 0.1], [0, 0, -0.05], { material: 'grey' }),
  };
  for (const d of DISKS) {
    items[d.id] = { kind: 'mark.cylinder@1', params: { size: DISK }, at: { pos: [d.x, 0, Z], rot: [90, 0, 0] }, material: d.material };
    items[d.spot] = spot(POWER, [d.x, 0, SPOT_Z], [0, 0, 0], beam);
  }
  return sessionDoc('holes-3025', SIZE, items, { light_policy: { soft: { method: 'pcf' }, shadowed: { spots: 3 } } });
}

/** The plate's mean between `from` and `to` m from x0 on `side`, |y| ≤ HALF_Y, by pixel centres. */
function mean(l: Linear, x0: number, side: 1 | -1, [from, to]: [number, number], what: string): number {
  let sum = 0; let n = 0;
  for (let py = 0; py < SIZE[1]; py++) {
    for (let px = 0; px < SIZE[0]; px++) {
      const [x, y] = orthoPoint(TARGET, WIDTH, SIZE, px, py);
      const r = side * (x - x0);
      if (r >= from && r <= to && Math.abs(y) <= HALF_Y) { sum += l.at(px, py); n++; }
    }
  }
  expect(n, `${what} holds at least 400 pixels`).toBeGreaterThanOrEqual(400);
  return sum / n;
}

function problems(): string[] {
  const out = dir();
  const call = view3dCall({ doc: writeJson(out, 'holes', holesDoc()), size: SIZE, targets: ['linear'], shadows: true });
  const reply = runGpu(bin(), out, [call])[0]!;
  if (reply['code'] === 'unsupported_platform') inconclusive('view3d reports unsupported_platform');
  if (reply['code'] !== undefined) {
    const why = `${String(reply['code'])}: ${String(reply['reason'] ?? shown(reply))}`;
    return DISKS.filter((d) => d.op).map((d) => `${d.id}: no frame draws its operator ${d.op}, view3d refuses it with ${why}`);
  }
  const f = only(reply, 'the disks');
  const l = readLinear(out, f, SIZE, 'the disks');
  const maps = shadowsOf(f, 'the disks').maps;
  const found: string[] = [];
  for (const d of DISKS) {
    if (!maps.some((m) => m.light === d.spot)) found.push(`${d.id}: its spot ${d.spot} reports no shadow map (the frame's: ${maps.map((m) => m.light).join(', ') || 'none'})`);
    for (const side of [1, -1] as const) {
      const half = side === 1 ? '+x half (uv0.u ≥ 0.5)' : '−x half (uv0.u < 0.5)';
      const lit = mean(l, d.x, side, BESIDE, `${d.id}'s beside band`);
      const r = mean(l, d.x, side, RING, `${d.id}'s ring`) / lit;
      const reads = `the plate past its ${half} reads ${r.toFixed(3)} of the lit plate beside it (${lit.toFixed(3)})`;
      if (d.dark[side === 1 ? 'plus' : 'minus']) {
        if (!(r < DARK)) found.push(`${d.id}: no shadow from its ${half}: ${reads}, not under ${DARK}`);
      } else if (!(r > LIT)) found.push(`${d.id}: a shadow from its ${half}, which lets the light through: ${reads}, not over ${LIT}`);
    }
  }
  return found;
}

describe(`${ID} a material operator's coverage holes let the spot's light through`, () => {
  it(`${ID} under their own shadowed spots, halved (discards where uv0.u < 0.5) throws a shadow from its kept half only, hollow (alpha 0 everywhere) throws none, and plain throws its whole shadow`, () => {
    requireMetal();
    none(problems(), 'the disks\' shadows');
  }, 600_000);
});
