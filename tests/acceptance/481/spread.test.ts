// AC1 #481.79c5d9ee: A 1 cm slab with a red mean free path of 5 mm and a green one of 1 mm, lit by a thin line of
// light, spreads red to the width the profile gives within 5% of a CPU reference at 20 points and green less, and at
// weight 0 the frame equals the frame without the lobe byte for byte.
//
// The slab (helpers.ts: slabDoc): 1 cm thick, 40 cm square, white, no specular, seen straight on from 1 m on
// 1000 × 1000 px, so a pixel is 0.2 mm on its face; the thin line is a `light.area@1` rect 0.2 mm × 0.4 m, 1 mm in
// front of the face along y through x = 0, the only light (README: Readings, the line of light).
//
// 1. Drawn twice in one process: without the lobe (the slab's lit diffuse, D) and with `subsurface: {weight: 1, color:
//    white, radius: [5 mm, 1 mm, 1 mm], thin: false}`. Each frame's columns are averaged over the central 200 rows
//    (y within ±2 cm, the line uniform there), giving the line's response across x. The CPU reference (reference.ts) is
//    D's red row convolved with Christensen–Burley's line-spread function for ℓ = 5 mm at A = 1 (s = 0.906). "The
//    width" is the half-width about the line, in px, holding a share f of the row's light; read at the 20 shares
//    f = 0.10, 0.14, … 0.86, each of red's widths must be within 5% of the reference's, and green's narrower than red's
//    at all 20. The fixture holds only if D is a thin line: its half-share width under 1 mm.
// 2. Drawn at 400 × 400: the slab without the field, with `subsurface: {weight: 0, …}` and with weight 1. Weight 0's
//    final PNG and linear target are byte for byte the field-less frame's; weight 1's linear target isn't (the lobe
//    draws, so equality at 0 is the lobe switching off, not the field being ignored).
import { describe, expect, it } from 'vitest';
import { AC, SLAB, draw, none, requireMetal, slabDoc, useDir, useGpu, type Drawn, type Subsurface } from './helpers.ts';
import { SHARES, centroid, columnKernel, convolve, scaling, widthAt } from './reference.ts';

const ID = AC[1];
const bin = useGpu();
const dir = useDir();
const N = 1000;
const PITCH = SLAB.span / N;
const ROWS: [number, number] = [400, 600];
const LOBE: Subsurface = { weight: 1, color: [1, 1, 1, 1], radius: SLAB.radius, thin: false };

/** A frame's channel, averaged down the central rows: the line's response across x. */
function row(d: Drawn, c: 0 | 1): number[] {
  const out: number[] = new Array(N).fill(0);
  for (let y = ROWS[0]; y < ROWS[1]; y++) for (let x = 0; x < N; x++) out[x] = out[x]! + d.linear.at(x, y)[c] / (ROWS[1] - ROWS[0]);
  return out;
}
const mm = (px: number): string => `${((px * PITCH) * 1000).toFixed(3)} mm`;

describe(`${ID} the spread of a thin line of light across a 1 cm slab`, () => {
  it(`${ID} red spreads to the width Christensen–Burley's profile gives at a 5 mm mean free path, within 5% of the CPU reference at 20 shares, and green, at 1 mm, less at every one`, () => {
    requireMetal();
    const out = dir();
    const [plain, lobe] = draw(bin(), out, [{ name: 'slab-plain', doc: slabDoc('plain', N, null) }, { name: 'slab-lobe', doc: slabDoc('lobe', N, LOBE) }]);
    for (const d of [plain!, lobe!]) expect(d.ids.at(N / 2, N / 2), `${d.name}: the slab fills the frame`).toBe('slab');

    const line = row(plain!, 0);
    const centre = centroid(line);
    const lineHalf = widthAt(line, centre, 0.5) * PITCH;
    console.log(`${ID}: the line without the lobe peaks at ${Math.max(...line).toFixed(4)}, centred at column ${centre.toFixed(2)}, half its light within ${(lineHalf * 1000).toFixed(3)} mm`);
    expect(Math.max(...line), 'the line of light lights the slab').toBeGreaterThan(0.05);
    expect(lineHalf, 'the fixture is a thin line: half its light within 1 mm of its centre').toBeLessThan(0.001);

    const reference = convolve(line, columnKernel(PITCH, N, SLAB.radius[0], scaling(1)));
    const red = row(lobe!, 0); const green = row(lobe!, 1);
    const failures: string[] = [];
    const lines: string[] = [];
    for (const f of SHARES) {
      const want = widthAt(reference, centre, f); const r = widthAt(red, centre, f); const g = widthAt(green, centre, f);
      const off = (r - want) / want;
      lines.push(`  share ${f.toFixed(2)}: reference ${mm(want)}, red ${mm(r)} (${(off * 100).toFixed(2)}%), green ${mm(g)}`);
      if (!(Math.abs(off) <= 0.05)) failures.push(`share ${f.toFixed(2)}: red's width ${mm(r)} is ${(off * 100).toFixed(2)}% off the reference's ${mm(want)}`);
      if (!(g < r)) failures.push(`share ${f.toFixed(2)}: green's width ${mm(g)} isn't less than red's ${mm(r)}`);
    }
    console.log(`${ID}: widths about the line\n${lines.join('\n')}`);
    none(failures, 'red against the CPU reference of the profile, and green against red, at the 20 shares');
  }, 3_600_000);

  it(`${ID} at weight 0 the frame equals the frame without the lobe byte for byte, and at weight 1 it doesn't`, () => {
    requireMetal();
    const out = dir();
    const [none0, zero, one] = draw(bin(), out, [
      { name: 'slab-none', doc: slabDoc('none', 400, null) },
      { name: 'slab-zero', doc: slabDoc('zero', 400, { ...LOBE, weight: 0, thin: true }) },
      { name: 'slab-one', doc: slabDoc('one', 400, { ...LOBE, thin: true }) },
    ]);
    expect(zero!.finalName, 'weight 0: the final PNG is the field-less frame\'s, byte for byte').toBe(none0!.finalName);
    expect(zero!.linearName, 'weight 0: the linear target is the field-less frame\'s, byte for byte').toBe(none0!.linearName);
    expect(one!.linearName, 'weight 1: the lobe draws, so its linear target differs from the field-less frame\'s').not.toBe(none0!.linearName);
  }, 3_600_000);
});
