// AC3 #2215.74b10a80: The reflection agrees: a second glowing disk mirrored in the pane from the camera’s side has its
// highlight’s long axis within 5° of the refracted glow’s. A planted tracer that stretches only the reflection fails the
// first criterion, and one that stretches only the refraction fails this one.
//
// The fixture at strength 0.5 (rotation 0), and the same with the second disk at the first one’s mirror image, its face
// 2 m in front of the pane at the camera’s plane, inside the near plane so no camera ray meets it (helpers: `fixture`),
// each a path-traced final at 512 × 512 and 4,096 samples in one `deep-gpu run`. The highlight is the second frame less
// the first, pixel by pixel in linear light; each long axis comes from the glow’s second moments (helpers: `axisOf`).
// Each has a long axis (its spreads along its own axes more than 5% apart, AC1’s bound for round) and the two lie within
// 5°. `--planted final_stretches_refraction_only` fails this, naming `pane`; `--planted
// final_stretches_reflection_only` fails AC1’s reading (helpers: `stretchOnFinal`), naming `pane`. Without a final (the
// base has none: #178), BLOCKED naming #178, never a pass.
// Wrong programs: the base (raster only); either lobe stretched alone; the two stretched along different axes.
import { describe, it } from 'vitest';
import {
  AC, SAMPLES, axisOf, draw, f2, failsNaming, fixture, glowOf, glowProblems, none, requireMetal, stretchOnFinal, useDir, useGpu, type Planted,
} from './helpers.ts';

const ID = AC[3];
const bin = useGpu();
const dir = useDir();

function reflectionFailures(planted?: Planted): string[] {
  const d = draw(bin(), dir(), [{ name: 'refracted', doc: fixture({ strength: 0.5 }) }, { name: 'both', doc: fixture({ strength: 0.5, mirrored: true }) }], SAMPLES, planted);
  const refracted = glowOf(d.get('refracted')!.linear);
  const highlight = glowOf(d.get('both')!.linear, d.get('refracted')!.linear);
  const a = axisOf(refracted); const b = axisOf(highlight);
  const apart = Math.min(Math.abs(a.angle - b.angle), 180 - Math.abs(a.angle - b.angle));
  console.log(`${ID}${planted ? ` (--planted ${planted})` : ''}: the refracted glow’s long axis at ${f2(a.angle)}° (${f2(a.long)} by ${f2(a.short)} px); the highlight’s at ${f2(b.angle)}° (${f2(b.long)} by ${f2(b.short)} px); ${f2(apart)}° apart`);
  const failures = [...glowProblems(refracted, 'the refracted glow'), ...glowProblems(highlight, 'the mirrored disk’s highlight')];
  if (!(a.long > 1.05 * a.short)) failures.push(`pane: the refracted glow has no long axis: it spreads ${f2(a.long)} and ${f2(a.short)} px along its own axes, within 5%`);
  if (!(b.long > 1.05 * b.short)) failures.push(`pane: the mirrored disk’s highlight has no long axis: it spreads ${f2(b.long)} and ${f2(b.short)} px along its own axes, within 5%`);
  if (!(apart <= 5)) failures.push(`pane: the highlight’s long axis lies at ${f2(b.angle)}° and the refracted glow’s at ${f2(a.angle)}°, ${f2(apart)}° apart, over 5°`);
  return failures;
}

describe(`${ID} the final’s reflection and refraction stretch alike`, () => {
  it(`${ID} a disk mirrored in the pane has its highlight’s long axis within 5° of the refracted glow’s; a planted tracer that stretches only the refraction fails this, and one that stretches only the reflection fails the first criterion`, () => {
    requireMetal();
    none(reflectionFailures(), 'the highlight against the refracted glow');
    failsNaming(reflectionFailures('final_stretches_refraction_only'), ['pane'], '--planted final_stretches_refraction_only');
    failsNaming(stretchOnFinal(bin(), dir(), 'final_stretches_reflection_only').failures, ['pane'], '--planted final_stretches_reflection_only, on the first criterion');
  }, 7_200_000);
});
