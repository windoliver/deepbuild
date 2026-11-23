// AC2 #2215.2c2aa19d: With `rotation: 90` the long axis lies along v: the same two spreads swap, within 10%. A planted
// tracer that ignores `rotation` keeps the long axis along u and fails.
//
// The fixture at strength 0.5 with rotation 0 and with rotation 90, each a path-traced final at 512 × 512 and 4,096
// samples in one `deep-gpu run`; the reading is AC1’s (helpers: `glowOf`). At rotation 90 the spread along v exceeds the
// spread along u; its spread along v is rotation 0’s along u within 10%, and its spread along u is rotation 0’s along v
// within 10%. `--planted final_ignores_rotation` fails naming `pane`. Without a final (the base has none: #178),
// BLOCKED naming #178, never a pass.
// Wrong programs: the base (raster only); a lobe that ignores rotation; a rotation that also scales the lobe.
import { describe, it } from 'vitest';
import { AC, SAMPLES, draw, f2, failsNaming, fixture, glowOf, glowProblems, none, requireMetal, useDir, useGpu, type Planted } from './helpers.ts';

const ID = AC[2];
const bin = useGpu();
const dir = useDir();

function rotationFailures(planted?: Planted): string[] {
  const d = draw(bin(), dir(), [{ name: 'r0', doc: fixture({ strength: 0.5 }) }, { name: 'r90', doc: fixture({ strength: 0.5, rotation: 90 }) }], SAMPLES, planted);
  const g0 = glowOf(d.get('r0')!.linear); const g90 = glowOf(d.get('r90')!.linear);
  console.log(`${ID}${planted ? ` (--planted ${planted})` : ''}: rotation 0 spreads ${f2(g0.su)} px along u, ${f2(g0.sv)} px along v; rotation 90: ${f2(g90.su)}, ${f2(g90.sv)}`);
  const failures = [...glowProblems(g0, 'the final at rotation 0'), ...glowProblems(g90, 'the final at rotation 90')];
  if (!(g90.sv > g90.su)) failures.push(`pane: at rotation 90 the long axis isn’t along v: the glow spreads ${f2(g90.su)} px along u and ${f2(g90.sv)} px along v`);
  if (!(Math.abs(g90.sv / g0.su - 1) <= 0.1)) failures.push(`pane: at rotation 90 the glow spreads ${f2(g90.sv)} px along v, not rotation 0’s ${f2(g0.su)} px along u within 10%`);
  if (!(Math.abs(g90.su / g0.sv - 1) <= 0.1)) failures.push(`pane: at rotation 90 the glow spreads ${f2(g90.su)} px along u, not rotation 0’s ${f2(g0.sv)} px along v within 10%`);
  return failures;
}

describe(`${ID} rotation turns the final’s refracted lobe`, () => {
  it(`${ID} with rotation 90 the long axis lies along v and the two spreads swap within 10%; a planted tracer that ignores rotation keeps it along u and fails`, () => {
    requireMetal();
    none(rotationFailures(), 'the final at rotation 0 and 90');
    failsNaming(rotationFailures('final_ignores_rotation'), ['pane'], '--planted final_ignores_rotation');
  }, 7_200_000);
});
