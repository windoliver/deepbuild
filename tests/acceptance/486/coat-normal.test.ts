// AC5 #486.c1e9a9b8: A plate with coat 1 and a `coat_normal` tilting 11.31° toward −v, under a sun 45° from the normal,
// moves the coat's specular peak by the tilt while the base lobe's peak stays put, each within 0.5° of a CPU reference.
// A planted output that bends the base normal too moves both and fails, naming the operator.
//
// The plate (helpers: `coatTiltDoc`): a 2 m `mark.box@1` mirrored in y (uv0's v up, handedness +1), a red metal
// (base [1, 0, 0], metallic 1, roughness 0.2) under coat 1 (coat roughness 0.1), its operator `coat_tilt` writing the
// tangent-space coat normal normalize(0, −0.2, 1), atan 0.2 = 11.31° toward −v; one unshadowed sun 45° from the plate's
// normal on the −v side (`at.rot` [45, 0, 0]), under a black sky; seen from above at 512 × 512 so both lobes' highlights
// fall on the frame's centre column. On the linear target, along the two centre columns (averaged), the coat's lobe is
// the green channel (the coat has no color; a red metal's lobe puts almost none there) and the base lobe is red minus
// green (the coat cancels exactly). Each peak is read as the centroid of the run of rows within 90% of its largest
// value (`reference.ts`: `peakRow`), and placed by the half vector between the eye and the sun at that row, as a signed
// angle from the plate's normal toward +v (`halfAngle`): a lobe peaks where its normal is the half vector, so the coat's
// peak sits near −11.31° and the base's near 0°. The CPU reference (`reference.ts`: `lobes`, glTF's GGX lobe and
// KHR_materials_clearcoat's layer) is read the same way over the same pixels; each measured peak is within 0.5° of it.
// 1. The plate as shipped. 2. `--planted coat_normal_bends_base` (the coat normal also replaces the base's shading
//    normal): the base lobe's peak moves with the coat's, and the check fails, naming `coat_tilt`.
// Wrong programs: the base (no coat normal: both peaks at 0°); a coat normal read in another frame or handedness; one
// that bends the base lobe too; one applied to neither.
import { describe, expect, it } from 'vitest';
import { halfAngle, lobes, onPlane, peakRow, sub, towardSun, unit, type Pinhole } from './reference.ts';
import { AC, ANALYTIC, COAT_CAM, COAT_LOBES, COAT_SIZE, COAT_SUN, coatTiltDoc, draw, failsNaming, none, requireMetal, useDir, useGpu, type Drawn, type Planted } from './helpers.ts';

const ID = AC[5];
const bin = useGpu();
const dir = useDir();
const CAM: Pinhole = { ...COAT_CAM, size: COAT_SIZE };
const SUN = towardSun(COAT_SUN);
const COLS = [COAT_SIZE[0] / 2 - 1, COAT_SIZE[0] / 2];
const angleAt = (row: number): number => halfAngle(CAM, COAT_SIZE[0] / 2, row + 0.5, 0, SUN);

/** The CPU reference's peaks, as half-vector angles. */
function reference(): { coat: number; base: number } {
  const m = { n: [0, 0, 1] as [number, number, number], coatN: ANALYTIC, ...COAT_LOBES };
  const coat: number[] = []; const base: number[] = [];
  for (let y = 0; y < COAT_SIZE[1]; y++) {
    let c = 0; let b = 0;
    for (const x of COLS) { const p = onPlane(CAM, x + 0.5, y + 0.5, 0); const o = lobes(m, unit(sub(CAM.position, p)), SUN); c += o.coat; b += o.baseRedMinusGreen; }
    coat.push(c / COLS.length); base.push(b / COLS.length);
  }
  return { coat: angleAt(peakRow(coat)), base: angleAt(peakRow(base)) };
}
/** The frame's peaks, read the same way over the plate's rows (rows off the plate read 0). */
function measured(d: Drawn): { coat: number; base: number; rows: number } {
  const coat: number[] = []; const base: number[] = []; let rows = 0;
  for (let y = 0; y < COAT_SIZE[1]; y++) {
    if (!COLS.every((x) => d.ids.at(x, y) === 'plate')) { coat.push(0); base.push(0); continue; }
    rows++;
    let c = 0; let b = 0;
    for (const x of COLS) { const v = d.linear.at(x, y); c += v[1]; b += v[0] - v[1]; }
    coat.push(c / COLS.length); base.push(b / COLS.length);
  }
  return { coat: angleAt(peakRow(coat)), base: angleAt(peakRow(base)), rows };
}
function peaks(planted?: Planted): string[] {
  const [d] = draw(bin(), dir(), [{ name: 'coat_tilt', doc: coatTiltDoc() }], planted) as [Drawn];
  const want = reference(); const got = measured(d);
  console.log(`${ID}${planted ? ` --planted ${planted}` : ''}: the coat's peak at ${got.coat.toFixed(3)}° (reference ${want.coat.toFixed(3)}°), the base lobe's at ${got.base.toFixed(3)}° (reference ${want.base.toFixed(3)}°); ${got.rows} rows on the plate`);
  const out: string[] = [];
  if (got.rows < COAT_SIZE[1] * 0.9) out.push(`coat_tilt: only ${got.rows} of ${COAT_SIZE[1]} rows of the centre columns show the plate`);
  if (!(Math.abs(got.coat - want.coat) <= 0.5)) out.push(`coat_tilt: the coat's specular peak is at a half vector ${got.coat.toFixed(2)}° from the plate's normal, the CPU reference's at ${want.coat.toFixed(2)}°`);
  if (!(Math.abs(got.base - want.base) <= 0.5)) out.push(`coat_tilt: the base lobe's peak is at a half vector ${got.base.toFixed(2)}° from the plate's normal, the CPU reference's at ${want.base.toFixed(2)}°`);
  return out;
}

describe(`${ID} a coat normal moves the coat's lobe and leaves the base lobe`, () => {
  it(`${ID} coat 1 with a coat_normal tilted 11.31° toward −v under a sun 45° from the normal: the coat's specular peak moves by the tilt and the base lobe's stays put, each within 0.5° of the CPU reference`, () => {
    requireMetal();
    const want = reference();
    console.log(`${ID}: the CPU reference puts the coat's peak ${(want.base - want.coat).toFixed(3)}° from the base lobe's`);
    expect(Math.abs(want.base - want.coat - (Math.atan(0.2) * 180) / Math.PI), 'the reference: the coat\'s peak sits the tilt from the base lobe\'s, within 0.5°').toBeLessThanOrEqual(0.5);
    none(peaks(), 'the coat\'s and the base lobe\'s peaks');
  }, 3_600_000);

  it(`${ID} a planted output that bends the base normal too (--planted coat_normal_bends_base) moves both peaks and fails, naming the operator`, () => {
    requireMetal();
    const failures = peaks('coat_normal_bends_base');
    failsNaming(failures, ['coat_tilt'], '--planted coat_normal_bends_base');
    expect(failures.some((f) => f.includes('base lobe')), `the base lobe's peak moved: ${failures.join('; ')}`).toBe(true);
  }, 3_600_000);
});
