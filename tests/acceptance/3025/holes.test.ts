// AC1 #3025.f34de22c: A material operator whose coverage can cut compiles, and its holes let light through: over a lit
// plate under one shadowed spot, a solid whose operator discards where uv0.u < 0.5 throws a shadow from its kept half
// only, and a solid whose operator writes alpha 0 everywhere throws none.
//
// Fixture. A 6 m matte plate (ρ 0.8, top at z = 0) under one shadowed spot 5 m straight above its centre, aiming down
// (987 lm = 100π² lm, so 25π cd and π lx below it, where the plate reads 0.8; cone 28°/30°, radius 0.02 m, range 20 m,
// PCF), seen in plan by an orthographic camera 3.2 m across 640 px (200 px/m), on the linear target at exposure scale 1.
// The solid is a disc: `mark.cylinder@1` of size [1, 0.02, 1], turned by at.rot [90, 0, 0] so its axis points at the
// spot, its centre 2.5 m up, half way. The spot throws its shadow at twice its size, a disc of radius 1 m, and a plate
// point (x, y) is shaded by the disc's point (x/2, y/2). A disc and not a box: both of the base's cylinder caps carry
// uv0.u = 0.5 + x (mesh.rs), so "where uv0.u < 0.5" is the same half, x < 0, on both faces a shadow pass draws, while a
// box's two large faces run u along x and along y and would keep three quarters. Its 2 cm side wall keeps another half
// and throws only a sliver at r ≈ 1 m, which no region below reaches.
//
// Each test draws, in one `deep-gpu run`, three single frames: the plate alone (`clean`), the disc with its material and
// no operator (`whole`, the control: the whole shadow, which the base would cast if it drew the disc without its
// operator), and the disc under the operator. Regions, on the plate as the view sees it, each pixel judged as its ratio to
// `clean`'s pixel:
//   ring  0.6 ≤ r ≤ 0.9 m: outside the disc's footprint in the view (r ≤ 0.5), inside its whole shadow (r ≤ 1)
//   kept  the ring at x ≥ 0.15 m; cut  the ring at x ≤ −0.15 m, both 0.15 m (30 px) from the half-shadow's edge x = 0
//   hole  r ≤ 0.4 m at x ≤ −0.1 m: the plate seen through the discarded half, whose light also comes through it
// The fixture holds when `clean` reads at least 0.5 on every judged pixel and `whole` darkens the ring (mean under 5% of
// `clean`). Dark is a mean under 5% and every pixel under 15% of `clean`; lit is a mean within 2% and every pixel at
// least 90% of it.
//   1. `cut` (discard_if@1 where uv0.u < 0.5): its frame drawn, not refused; kept dark; cut and hole lit.
//   2. `clear` (alpha 0 everywhere): its frame drawn, not refused; the whole ring lit.
// Wrong programs: the merge base, where op::compile's shadow pipeline reads the light group, the device rejects it and
// view3d refuses the frame with operator_compile (view3d never draws a part without its operator); a program that drew
// the disc without its operator, or kept the operator out of the shadow pass (`whole`'s shadow: cut, hole and clear's
// ring dark); one whose operator solid casts nothing (kept lit); one that keeps the other half or reads u along another
// axis (kept lit or cut dark); one that leaves alpha out of what cuts (clear's ring dark).
import { describe, expect, it } from 'vitest';
import {
  DARK_SKY, box, matte, materialOp, none, only, ortho, orthoPoint, readLinear, requireMetal, runGpu, sessionDoc, spot, useDir, useGpu,
  view3dCall, writeJson, type JsonObject, type Linear, type V3,
} from '../446/helpers.ts';

/** The criterion's ID: the first 8 hex digits of SHA-256 of its text (README: Criteria to tests). */
const ID = 'AC1 #3025.f34de22c';
const bin = useGpu();
const dir = useDir();
const SIZE: [number, number] = [640, 640];
const WIDTH = 3.2;
const TARGET: V3 = [0, 0, 0];

const GREY: JsonObject = { op: 'const@1', args: { value: [0.8, 0.8, 0.8], type: 'vec3' } };
/** Discards where uv0.u < 0.5. */
const CUT = materialOp('Discards where uv0.u < 0.5.', {
  uv: { op: 'uv0@1', args: {} },
  u: { op: 'split@1', args: { x: 'uv', pick: 'x' } },
  half: { op: 'const@1', args: { value: 0.5, type: 'f32' } },
  left: { op: 'lt@1', args: { a: 'u', b: 'half' } },
  gone: { op: 'discard_if@1', args: { cond: 'left' } },
  c: GREY,
}, { base_color: 'c' });
/** Writes alpha 0 everywhere. */
const CLEAR = materialOp('Writes alpha 0 everywhere.', {
  zero: { op: 'const@1', args: { value: 0, type: 'f32' } },
  c: GREY,
}, { base_color: 'c', alpha: 'zero' });

type Subject = 'whole' | 'cut' | 'clear';
/** The plate under its spot, with the disc under `subject`'s material, or alone. */
function plateDoc(subject: Subject | null): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: ortho(TARGET, WIDTH), sky: DARK_SKY, grey: matte(0.8),
    plate: box([6, 6, 0.1], [0, 0, -0.05], { material: 'grey' }),
    lamp: spot(987, [0, 0, 5], [0, 0, 0], { shadow: true, inner: 28, outer: 30, range: 20, radius: 0.02 }),
  };
  if (subject === 'cut') items['cut'] = CUT;
  if (subject === 'clear') items['clear'] = CLEAR;
  if (subject !== null) {
    items['disc_mat'] = subject === 'whole' ? matte(0.8) : matte(0.8, { op: subject });
    items['disc'] = { kind: 'mark.cylinder@1', params: { size: [1, 0.02, 1] }, at: { pos: [0, 0, 2.5], rot: [90, 0, 0] }, material: 'disc_mat' };
  }
  return sessionDoc(`plate-${subject ?? 'clean'}`, SIZE, items, { light_policy: { soft: { method: 'pcf' }, shadowed: { spots: 1 } } });
}

type Region = (x: number, y: number) => boolean;
const ring: Region = (x, y) => { const r = Math.hypot(x, y); return r >= 0.6 && r <= 0.9; };
const kept: Region = (x, y) => ring(x, y) && x >= 0.15;
const cut: Region = (x, y) => ring(x, y) && x <= -0.15;
const hole: Region = (x, y) => Math.hypot(x, y) <= 0.4 && x <= -0.1;

interface Ratios { n: number; mean: number; min: number; max: number }
/** Each pixel of `region` in `l` over the same pixel of `clean`, which must read the lit plate (at least 0.5) there. */
function ratios(l: Linear, clean: Linear, region: Region, what: string): Ratios {
  let n = 0; let sum = 0; let min = Infinity; let max = -Infinity; let dim = 0;
  for (let py = 0; py < SIZE[1]; py++) {
    for (let px = 0; px < SIZE[0]; px++) {
      const [x, y] = orthoPoint(TARGET, WIDTH, SIZE, px, py);
      if (!region(x, y)) continue;
      const c = clean.at(px, py);
      if (!(c >= 0.5)) { dim++; continue; }
      const k = l.at(px, py) / c;
      n++; sum += k; min = Math.min(min, k); max = Math.max(max, k);
    }
  }
  expect(dim, `the fixture: the plate alone reads at least 0.5 on every pixel of ${what}`).toBe(0);
  expect(n, `the fixture: ${what} holds at least 5,000 pixels`).toBeGreaterThanOrEqual(5_000);
  return { n, mean: sum / n, min, max };
}
const f = (k: number): string => k.toFixed(3);
function dark(l: Linear, clean: Linear, region: Region, what: string, found: string[]): void {
  const s = ratios(l, clean, region, what);
  if (s.mean > 0.05 || s.max > 0.15) found.push(`${what} isn't in shadow: mean ${f(s.mean)}, brightest ${f(s.max)} of the lit plate over ${s.n} pixels (want under 0.05 and 0.15)`);
}
function lit(l: Linear, clean: Linear, region: Region, what: string, found: string[]): void {
  const s = ratios(l, clean, region, what);
  if (Math.abs(s.mean - 1) > 0.02 || s.min < 0.9) found.push(`${what} isn't lit as the plate alone: mean ${f(s.mean)}, darkest ${f(s.min)} of it over ${s.n} pixels (want within 0.02 of 1, and at least 0.9)`);
}

/** The plate alone, the disc whole and the disc under `subject`, in one process; `subject`'s frame, or a failure naming
 * its refusal. */
function draw(subject: 'cut' | 'clear', found: string[]): { clean: Linear; drawn: Linear | null } {
  const out = dir();
  const call = (s: Subject | null): JsonObject => view3dCall({ doc: writeJson(out, s ?? 'clean', plateDoc(s)), size: SIZE, targets: ['linear'] });
  const [c, w, d] = runGpu(bin(), out, [call(null), call('whole'), call(subject)]);
  const clean = readLinear(out, only(c!, 'the plate alone'), SIZE, 'the plate alone');
  const whole = readLinear(out, only(w!, 'the disc without an operator'), SIZE, 'the disc without an operator');
  const s = ratios(whole, clean, ring, 'the ring under the disc without an operator');
  expect(s.mean, `the fixture: the disc without an operator darkens the ring (mean ${f(s.mean)} of the lit plate)`).toBeLessThan(0.05);
  if (d!['code'] !== undefined && d!['code'] !== 'unsupported_platform') {
    found.push(`${subject}: the frame is refused, ${String(d!['code'])}: ${String(d!['reason'] ?? JSON.stringify(d)).slice(0, 1500)}`);
    return { clean, drawn: null };
  }
  return { clean, drawn: readLinear(out, only(d!, `the disc under ${subject}`), SIZE, `the disc under ${subject}`) };
}

describe(`${ID} a material operator that cuts its coverage compiles and lets the spot's light through its holes`, () => {
  it(`${ID} a solid whose operator discards where uv0.u < 0.5 compiles and throws a shadow from its kept half only`, () => {
    requireMetal();
    const found: string[] = [];
    const { clean, drawn } = draw('cut', found);
    if (drawn) {
      dark(drawn, clean, kept, 'cut: the ring behind the kept half (x ≥ 0.15 m)', found);
      lit(drawn, clean, cut, 'cut: the ring behind the discarded half (x ≤ −0.15 m)', found);
      lit(drawn, clean, hole, 'cut: the plate seen through the discarded half', found);
    }
    none(found, 'the disc under an operator that discards where uv0.u < 0.5');
  }, 1_800_000);

  it(`${ID} a solid whose operator writes alpha 0 everywhere compiles and throws no shadow`, () => {
    requireMetal();
    const found: string[] = [];
    const { clean, drawn } = draw('clear', found);
    if (drawn) lit(drawn, clean, ring, 'clear: the ring its whole shadow would darken', found);
    none(found, 'the disc under an operator that writes alpha 0 everywhere');
  }, 1_800_000);
});
