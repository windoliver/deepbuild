// AC4 #2215.87722da6: Raster’s glow on the same fixture has spreads within 5% of each other, and its receipt names the
// pane and `anisotropic_transmission`. A planted frame that lists nothing fails, naming the part.
//
// The fixture at strength 0.5 drawn in raster by `view3d` (no final; tone map none, one frame, `receipt: true`) at
// 512 × 512; the reading is AC1’s (helpers: `glowOf`): along u and along v within 5% of each other. The reply’s
// `receipt.warnings` holds `{item: "pane", what: "anisotropic_transmission"}` (README: Assumed surfaces 2).
// `--planted raster_lists_nothing` draws the same frame with no such entry and fails, naming `pane`.
// Wrong programs: the base (no listing); a frame that lists nothing; a raster blur stretched along u (out of scope).
import { describe, it } from 'vitest';
import {
  AC, draw, f2, failsNaming, fixture, glowOf, glowProblems, isObject, none, requireMetal, shown, useDir, useGpu, type Planted,
} from './helpers.ts';

const ID = AC[4];
const bin = useGpu();
const dir = useDir();

function rasterFailures(planted?: Planted): string[] {
  const { linear, reply } = draw(bin(), dir(), [{ name: 'raster', doc: fixture({ strength: 0.5 }) }], null, planted).get('raster')!;
  const g = glowOf(linear);
  const receipt = reply['receipt'];
  const warnings = isObject(receipt) && Array.isArray(receipt['warnings']) ? receipt['warnings'] : [];
  console.log(`${ID}${planted ? ` (--planted ${planted})` : ''}: raster spreads ${f2(g.su)} px along u, ${f2(g.sv)} px along v (ratio ${f2(g.su / g.sv)}); receipt ${shown(receipt)}`);
  const failures = glowProblems(g, 'raster’s frame');
  if (!(Math.abs(g.su / g.sv - 1) <= 0.05)) failures.push(`pane: raster’s glow spreads ${f2(g.su)} px along u and ${f2(g.sv)} px along v, not within 5% of each other`);
  if (!warnings.some((w) => isObject(w) && w['item'] === 'pane' && w['what'] === 'anisotropic_transmission')) {
    failures.push(`pane: drawn with transmission 1 and anisotropy strength 0.5, but the frame’s receipt lists no {item: pane, what: anisotropic_transmission} in warnings (receipt ${shown(receipt)})`);
  }
  return failures;
}

describe(`${ID} raster keeps its round blur and says so`, () => {
  it(`${ID} raster’s glow on the fixture has spreads within 5% of each other and its receipt names the pane and anisotropic_transmission; a planted frame that lists nothing fails, naming the part`, () => {
    requireMetal();
    none(rasterFailures(), 'raster’s frame of the fixture');
    failsNaming(rasterFailures('raster_lists_nothing'), ['pane'], '--planted raster_lists_nothing');
  }, 3_600_000);
});
