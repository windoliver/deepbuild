// AC2 #486.f7c1ed7f: occlusion darkens only what ambient occlusion darkens.
//
// The occlusion plate (helpers.ts: plateDoc; README: The fixture): a 60 cm plate with a 20 cm emissive square on it,
// lit by one π lx sun and the shipped studio environment over a black sky with no ambient, with a reflection probe
// whose box holds both, under a look whose ao is "none". Four documents, drawn in one `deep-gpu run`:
//   occlusion_0     the plate's and the square's materials name an operator whose only output is occlusion 0
//   occlusion_1     the same with occlusion 1
//   no_operator     the same plate with no operator
//   no_environment  the same plate with the environment and the probe removed, and no operator
// On every interior pixel of the plate and of the square (1 px away from any other part in both ID targets),
// occlusion_0 matches no_environment and occlusion_1 matches no_operator within one 10-bit code value in each channel
// of the linear target (1/1023 of max(1, |reference|): README: Readings). The fixture holds first: the sun lights the
// plate, the environment and the probe add to it, and the square's emission shows, read from the frames with no
// operator, so the match can't pass on a part left dark.
// 1. The shipped program passes the check.
// 2. `--planted occlusion_scales_direct` (the occlusion output scaling the direct light and the emission with the
//    ambient term) draws the sunlit plate or the square darker and fails the same check, naming the pixel.
import { describe, expect, it } from 'vitest';
import {
  AC2, MIN_COMPARED, PLATE_ID, SQUARE_ID, drawPlates, fixtureFailures, missLine, none, occlusionCheck, requireMetal, useDir, useGpu,
  type Checked,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();

/** Every pair compared enough of each part's interior. */
function comparedEnough(c: Checked, what: string): void {
  for (const m of c.results) {
    expect(m.compared, `${what}: ${m.pair} compares at least ${MIN_COMPARED[m.part]} interior ${m.part} pixels`).toBeGreaterThanOrEqual(MIN_COMPARED[m.part]!);
  }
}

describe(`${AC2} occlusion darkens only what ambient occlusion darkens`, () => {
  it(`${AC2} an operator writing occlusion 0 matches the plate with the environment's lighting and the probe removed, the square keeping its emission, and one writing 1 matches the plate with no operator, within one 10-bit code value`, () => {
    requireMetal();
    const drawn = drawPlates(bin(), dir());
    none(fixtureFailures(drawn), 'the occlusion plate holds');
    const c = occlusionCheck(drawn);
    comparedEnough(c, 'the shipped program');
    for (const m of c.results) console.log(`${AC2}: ${m.pair}: ${m.part}: ${m.compared} pixels compared, ${m.over} more than one code off`);
    expect(c.over, `pixels more than one 10-bit code value off:\n${c.failures.join('\n')}`).toBe(0);
  }, 3_600_000);

  it(`${AC2} the planted occlusion that also scales direct light and emission darkens the sunlit plate or the square and fails the same check, naming the pixel`, () => {
    requireMetal();
    const planted = 'occlusion_scales_direct';
    const drawn = drawPlates(bin(), dir(), planted);
    none(fixtureFailures(drawn), `the occlusion plate holds under --planted ${planted}`);
    const c = occlusionCheck(drawn);
    comparedEnough(c, `--planted ${planted}`);
    console.log(`${AC2}: --planted ${planted}: ${c.over} pixels more than one code off\n${c.failures.slice(0, 12).join('\n')}`);
    expect(c.over, `--planted ${planted} fails the check, but no pixel is more than one 10-bit code value off`).toBeGreaterThan(0);
    // The failure the criterion names: a sunlit plate pixel or a square pixel drawn darker, by its coordinates.
    const darkened = c.results.filter((m) => (m.part === PLATE_ID || m.part === SQUARE_ID) && m.darker !== null);
    expect(darkened.length, `--planted ${planted} darkens the plate or the square; the failures were:\n${c.failures.join('\n')}`).toBeGreaterThan(0);
    const named = darkened.map((m) => missLine(m, m.darker!));
    console.log(`${AC2}: --planted ${planted}: the darkest misses:\n${named.join('\n')}`);
    expect(c.failures.some((f) => named.some((line) => f.includes(line))), `the check's failures name a darkened pixel by its coordinates:\n${c.failures.join('\n')}`).toBe(true);
  }, 3_600_000);
});
