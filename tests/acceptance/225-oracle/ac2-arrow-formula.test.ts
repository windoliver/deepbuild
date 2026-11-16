// Oracle port for criterion 2 (AC2 #225.69823b27): an upstream engine's arrow field formula (the oracle page's
// criterion 2 row: its vector field source, lines 84-125 and 559-575, pinned at a6d5cc02b4; formula source, no upstream
// test), run against our output over every arrow, not only the one at (1, 0).
//
// Upstream: an arrow's default length is 0.45 × sigmoid(|v|), along v; the field's colors map |v| over [0, 2] onto
// four colors by inverse interpolation. Ours: criterion 2's film, F = (−y, x)/2 with arrows on the unit grid over
// [−2, 2]² and the four-role ramp over [0, 2] (the length's `max` at its default, 0.45 × step = 0.45). For each of the
// 25 arrows at p, with m = |F(p)| = |p| ÷ 2: `length` 0.45 × sigmoid(m) within 1e-6; `vector` along F(p) within 0.1°
// (but at the origin, where F is 0); and with s = 3 × min(m ÷ 2, 1), i = min(⌊s⌋, 2), `color.roles` [ramp i, ramp
// i + 1] and `color.mix` s − i within 1e-6.
// The planted fault, a fixture written the wrong way: the same judge on the film whose fn isn't halved, F = (−y, x),
// must fail, naming an arrow.
import { describe, expect, it } from 'vitest';
import { HALF_SWIRL, RAMP, SWIRL, TIMEOUT, failsNaming, field, fieldCall, fieldOf, film, none, present, presented, run, scenario, sigmoid, useBins, useFolders, type JsonObject } from './helpers.ts';

const bin = useBins(['show']);
const folder = useFolders();
const arrowsFilm = (fn: JsonObject): JsonObject => film('arrows', [640, 480], [field('half', 'a0', {
  fn, arrows: { grid: { x: [-2, 2, 1], y: [-2, 2, 1] }, color: { by: 'magnitude', ramp: RAMP, domain: [0, 2] } },
})]);

/** Every arrow of the film against the formula for F = (−y, x)/2; each failure names the arrow by where it is. */
function judge(fn: JsonObject): string[] {
  const [shown, reply] = run(bin('show'), scenario(folder(), [present(arrowsFilm(fn)), fieldCall('half', 0)]));
  presented(shown!, 'the arrows film');
  const f = fieldOf(reply!, 'vector_field half');
  expect(f.arrows.length, 'one arrow at each of the 5 × 5 grid points').toBe(25);
  return f.arrows.flatMap((a) => {
    const [x, y] = [a.at[0]!, a.at[1]!];
    const name = `the arrow at (${x}, ${y})`;
    const v = [-y / 2, x / 2]; const m = Math.hypot(v[0]!, v[1]!);
    const out: string[] = [];
    if (!(Math.abs(a.length - 0.45 * sigmoid(m)) <= 1e-6)) out.push(`${name} is ${a.length} long, not 0.45 × sigmoid(${m}) = ${0.45 * sigmoid(m)}`);
    if (m > 0) {
      const off = Math.abs(((Math.atan2(a.vector[1]!, a.vector[0]!) - Math.atan2(v[1]!, v[0]!) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      if (!(off * (180 / Math.PI) <= 0.1)) out.push(`${name} points ${(off * 180 / Math.PI).toFixed(3)}° off F`);
    }
    const s = 3 * Math.min(m / 2, 1); const i = Math.min(Math.floor(s), 2);
    if (JSON.stringify(a.roles) !== JSON.stringify([RAMP[i], RAMP[i + 1]]) || !(Math.abs(a.mix - (s - i)) <= 1e-6)) out.push(`${name} is colored ${a.mix} from ${a.roles.join(' to ')}, not ${s - i} from ${RAMP[i]} to ${RAMP[i + 1]}`);
    return out;
  });
}

describe('oracle: the arrow field\'s length and color formula (criterion 2)', () => {
  it('AC2 #225.69823b27 every arrow of F = (−y, x)/2 is 0.45 × sigmoid(|F|) long along F, colored by |F| over [0, 2] onto the four roles', () => {
    none(judge(HALF_SWIRL), 'the arrows against the formula');
  }, TIMEOUT);

  it('AC2 #225.69823b27 the formula fails on the field written the wrong way, F = (−y, x), naming an arrow', () => {
    failsNaming(judge(SWIRL), ['the arrow at ('], 'the formula on the unhalved field');
  }, TIMEOUT);
});
