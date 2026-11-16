// AC2 #225.69823b27: "The arrow of F = (−y, x)/2 at (1, 0) points along +y within 0.1° and has length 0.45 ×
// sigmoid(0.5) within 1e-6; with a 4-role ramp over [0, 2] its color is 75% of the way from role 1 to role 2"
//
// The film: `half`, a vector_field@1 with `fn: {x: "-y / 2", y: "x / 2"}` and `arrows: {grid: {x: [−2, 2, 1], y: [−2, 2,
// 1]}, color: {by: magnitude, ramp: [term_blue, term_cyan, term_yellow, term_red], domain: [0, 2]}}`, its length left at
// the design's default (`by: sigmoid`, `max: 0.45 × step`, so 0.45 on this unit grid), no scales. Through `deep show`
// and `{"call": "vector_field", item: "half", t: 0}` (README: The surface under test):
// - 25 arrows, one at each grid point;
// - the arrow at (1, 0): its `vector` at 90° (+y in the field's own coordinates) within 0.1°; its `length` 0.45 ×
//   sigmoid(0.5) = 0.280106699… within 1e-6, and |vector| the same; its `color` 75% of the way from role 1 to role 2:
//   `roles` [term_blue, term_cyan] and `mix` 0.75 within 1e-6 (|F| = 0.5 sits a quarter of the way along [0, 2], and
//   four roles put role 1 at 0 and role 2 at 2/3).
// The judge must be able to fail: run on the arrow at (2, 0) (|F| = 1, a field read at the wrong point), it fails,
// naming that arrow.
// Wrong programs: the base; F not halved (length 0.45 × sigmoid(1), mix 0.5 from role 2); a ramp over [0, 1] (role 2
// to 3); length linear or constant; the vector read y-down (−90°); colors spread over the domain by the ramp's index
// rather than its stops.
import { describe, expect, it } from 'vitest';
import {
  AC, HALF_SWIRL, RAMP, TIMEOUT, dist, failsNaming, field, fieldCall, fieldOf, film, none, present, presented, run, scenario, sigmoid, useBins, useFolders,
  type Arrow,
} from './helpers.ts';

const bin = useBins(['show']);
const folder = useFolders();
const DOC = film('arrows', [640, 480], [field('half', 'a0', {
  fn: HALF_SWIRL,
  arrows: { grid: { x: [-2, 2, 1], y: [-2, 2, 1] }, color: { by: 'magnitude', ramp: RAMP, domain: [0, 2] } },
})]);
const LENGTH = 0.45 * sigmoid(0.5);

/** The judge for one arrow: criterion 2's direction, length and color; each failure names the arrow by where it is. */
function judge(a: Arrow): string[] {
  const name = `the arrow at (${a.at.join(', ')})`;
  const out: string[] = [];
  const angle = (Math.atan2(a.vector[1]!, a.vector[0]!) * 180) / Math.PI;
  if (!(Math.abs(angle - 90) <= 0.1)) out.push(`${name} points at ${angle.toFixed(4)}°, not 90° (+y) within 0.1°`);
  if (!(Math.abs(a.length - LENGTH) <= 1e-6)) out.push(`${name} is ${a.length} long, not 0.45 × sigmoid(0.5) = ${LENGTH} within 1e-6`);
  if (!(Math.abs(Math.hypot(...a.vector) - a.length) <= 1e-6)) out.push(`${name}: |vector| ${Math.hypot(...a.vector)} isn't its length ${a.length}`);
  if (JSON.stringify(a.roles) !== JSON.stringify(RAMP.slice(0, 2))) out.push(`${name} is colored between ${a.roles.join(' and ')}, not role 1 and role 2 (${RAMP[0]}, ${RAMP[1]})`);
  if (!(Math.abs(a.mix - 0.75) <= 1e-6)) out.push(`${name} is colored ${a.mix} of the way, not 0.75`);
  return out;
}

describe(`${AC[2]} the arrow of F = (−y, x)/2 at (1, 0)`, () => {
  it(`${AC[2]} the arrow at (1, 0) points along +y within 0.1°, is 0.45 × sigmoid(0.5) long within 1e-6, and is colored 75% of the way from role 1 to role 2`, () => {
    const [shown, reply] = run(bin('show'), scenario(folder(), [present(DOC), fieldCall('half', 0)]));
    presented(shown!, 'the arrows film');
    const f = fieldOf(reply!, 'vector_field half');
    expect(f.arrows.length, 'one arrow at each of the 5 × 5 grid points').toBe(25);
    const at = (x: number, y: number): Arrow | undefined => f.arrows.find((a) => dist(a.at.slice(0, 2), [x, y]) <= 1e-9);
    const one = at(1, 0);
    expect(one, 'an arrow sits at (1, 0)').toBeDefined();
    none(judge(one!), 'the arrow at (1, 0)');

    const twin = at(2, 0);
    expect(twin, 'an arrow sits at (2, 0)').toBeDefined();
    failsNaming(judge(twin!), ['(2, 0'], 'the judge on the arrow at (2, 0), standing for a field read at the wrong point');
  }, TIMEOUT);
});
