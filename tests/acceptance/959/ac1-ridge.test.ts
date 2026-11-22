// AC1 #959.cff22b0c: "On a 1,024 × 1,024 m plate with a 40 m ridge across its middle, a sensor 300 m in front of the
// ridge marks the cells behind it unseen, matching a brute-force f64 ray march from the eye to every cell centre cell
// for cell; a planted library that ignores the heights sees behind the ridge and fails, naming the cell"
//
// Through `deep-logic first_party`, `check` and `bake` (README: The surface). The ridge plate (fixtures.ts): 1,025 ×
// 1,025 samples 1 m apart, a ridge 40 m high from edge to edge across its middle, and a 120 m hill behind it. One eye
// of side 0, 2 m above its ground, at (4, 300), 300 m in front of the ridge's line, range 330 m; the strong defaults
// (sight cells of 8 × 8 samples, radar cells of 4 × 4, a rebuild over 3 steps). The driver calls sense.lib@1's `sight`
// once a step, linked to the first-party reference library through the interface, and writes the fog grid.
// - The reference (model.ts) is held first to the ridge's answer written by hand (fixtures.ts: ridgeSeen), and a wrong
//   reference that ignores the heights must fail it, so the ray march counts as an oracle (design: a CPU reference).
// - Then every fog cell the library wrote at every step of the rebuild equals the reference's, and the unit behind the
//   ridge isn't seen while the one in front is.
// The wrong program: sense_ignores_heights@1 (programs.ts: libraryText({flat: true})), whose every height reads 0: it
// sees flat cells behind the ridge, and the same judgement fails on it naming the first such cell.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, logicBin, prebuild } from '../190/helpers.ts';
import { HILL, RIDGE, RIDGE_STEPS, RIDGE_UNITS, ridgeParams, ridgePlan, ridgePlate, ridgeSeen } from './fixtures.ts';
import { AC, IFACE, bakeCall, checkCall, findSense, interfaceRuns, judge, piece, run, type Fixture, type Judged } from './helpers.ts';
import { SEEN, UNSEEN, gridsOf, runPlan, stateOf } from './model.ts';

prebuild(() => { logicBin(); });

const fixture = (): Fixture => ({ plate: ridgePlate(), params: ridgeParams(), plan: ridgePlan() });
/** Step 2 ends the first rebuild: the whole grid stands. */
const WHOLE = 2;

/** Where a grid of side 0's states (a fog grid's values, read as player 1) differs from the answer written by hand. */
function offClosedForm(fog: Int32Array, f: Fixture): string[] {
  const g = gridsOf(f.plate, f.params);
  const out: string[] = [];
  for (let fz = 0; fz < g.fr; fz++) {
    for (let fx = 0; fx < g.fc; fx++) {
      const cell: [number, number] = [Math.floor(fx / g.q), Math.floor(fz / g.q)];
      const want = ridgeSeen(...cell) ? SEEN : UNSEEN;
      const got = stateOf(fog[fz * g.fc + fx]!, 1);
      if (got !== want) out.push(`cell (${cell.join(', ')}) reads ${got}, the closed form gives ${want}`);
    }
  }
  return out;
}

let shipped: Judged | undefined;
/** The reference library's bake of the ridge, once for both tests. */
function ridgeOnShipped(): Judged {
  if (shipped) return shipped;
  const s = findSense().sense!;
  const p = piece(fixture(), s);
  const [checked, baked] = run([checkCall(p), bakeCall(p, RIDGE_STEPS)]);
  expect(interfaceRuns(checked!, s.ref.name), `${s.ref.name} links through ${IFACE} with every fixture of ${IFACE} run on it and passed`).toEqual(s.iface.fixtures.map((x) => [x, 'PASS']).sort());
  return (shipped = judge(baked!, fixture(), RIDGE_STEPS, `the ridge on ${s.ref.name}`));
}

describe(`${AC[1]} sight that a ridge blocks, cell for cell against a brute-force ray march`, () => {
  it(`${AC[1]} a sensor 300 m in front of a 40 m ridge marks the cells behind it unseen, every cell matching the brute-force f64 ray march from the eye to its centre`, () => {
    const f = fixture();
    const g = gridsOf(f.plate, f.params);
    // The reference is an oracle only once it gives the answer written by hand, and a wrong reference doesn't.
    const want = runPlan(f.plate, f.params, f.plan, RIDGE_STEPS);
    const whole = want[WHOLE]!.out.fog;
    expect(offClosedForm(whole, f).slice(0, 5), 'the reference gives the ridge\'s closed form at every cell').toEqual([]);
    const flat = runPlan(f.plate, f.params, f.plan, RIDGE_STEPS, { flat: true })[WHOLE]!.out.fog;
    expect(offClosedForm(flat, f).length, 'a reference that ignores the heights fails the closed form').toBeGreaterThan(0);
    // The grid compared isn't one colour on either side of the ridge.
    const count = (rows: (cz: number) => boolean, state: number): number => {
      let n = 0;
      for (let cz = 0; cz < g.gr; cz++) for (let cx = 0; cx < g.gc; cx++) if (rows(cz) && stateOf(whole[cz * g.q * g.fc + cx * g.q]!, 1) === state) n += 1;
      return n;
    };
    const front = (cz: number): boolean => cz > RIDGE.front;
    const behind = (cz: number): boolean => cz < RIDGE.rows[0];
    expect([count(front, SEEN) > 0, count(front, UNSEEN) > 0, count(behind, SEEN), count(behind, UNSEEN) > 0], `in front of the ridge the grid holds seen and unseen cells; behind it the hill's ${HILL.columns[1] - HILL.columns[0] + 1} cells are seen and the rest unseen`).toEqual([true, true, 4, true]);

    const found = findSense();
    expect(found.problems, `first_party lists a first-party pack that declares ${IFACE} with its reference library (the packs are ${found.packs.join(', ')})`).toEqual([]);
    const j = ridgeOnShipped();
    expect(j.misses.map((m) => m.message), 'every fog cell, at every step of the rebuild, is the brute-force ray march\'s').toEqual([]);
    // The unit behind the ridge stays hidden from side 0 (player 1); the one in front is seen once its row is rebuilt.
    const seen = (step: number, unit: number): number => j.want[step]!.out.seen[unit]! & 1;
    expect([seen(WHOLE, RIDGE_UNITS.behind), seen(WHOLE, RIDGE_UNITS.front)], 'player 1 sees the unit in front of the ridge and not the one behind it').toEqual([0, 1]);
  }, TIMEOUT);

  it(`${AC[1]} a planted library that ignores the heights sees behind the ridge and fails, naming the cell`, () => {
    const found = findSense();
    expect(found.problems, `first_party lists a first-party pack that declares ${IFACE} with its reference library (the packs are ${found.packs.join(', ')})`).toEqual([]);
    expect(ridgeOnShipped().misses.map((m) => m.message), 'the reference library passes the judgement the planted one fails').toEqual([]);
    const f = fixture();
    const [baked] = run([bakeCall(piece(f, 'flat'), RIDGE_STEPS)]);
    const wrong = judge(baked!, f, RIDGE_STEPS, 'the ridge on sense_ignores_heights@1').misses;
    expect(wrong.length, 'the judgement fails the library that ignores the heights').toBeGreaterThan(0);
    const first = wrong[0]!;
    expect([first.array, first.side, first.expected, first.actual], `its first wrong cell is one it sees and the ray march doesn't: ${first.message}`).toEqual(['fog', 0, 'unseen', 'seen']);
    const [cx, cz] = first.sightCell!;
    expect(cz < RIDGE.rows[0] && !ridgeSeen(cx, cz), `sight cell (${cx}, ${cz}) lies behind the ridge, on ground the closed form leaves unseen`).toBe(true);
    expect(first.message, 'the failure names the cell').toContain(`sight cell (${cx}, ${cz})`);
  }, TIMEOUT);
});
