// #2240.b395689a: "In a new fixture, a 100 kg box 1 m wide and 2 m tall stands on a static slope, both of friction 2.
// With no `centre_of_mass` it tips at atan(0.5 ÷ 1.0) = 26.57°: on a 20° slope it turns less than 1° in 3 s, and on a
// 33° slope it turns past 45° within 3 s. With `centre_of_mass: (0, −0.75, 0)`, 0.25 m above its base, it tips at
// atan(0.5 ÷ 0.25) = 63.43°: on the 33° slope and on a 45° slope it turns less than 1° in 3 s. A planted wrapper that
// reads the field and leaves the weight where the shapes put it topples on the 33° slope and fails, naming the body and
// the angle it turned"
//
// The box (README: The fixtures, the box on a slope) stands on a static slab turned 20°, 33° or 45°, sleep off, and is
// baked 3 s at 120 Hz. Its turn is the angle between its orientation after a step and the one it was built with
// (#2009's body states); "in 3 s" and "within 3 s" are read at every step up to 360, so the box that stands never turns
// 1° and the box that topples passes 45° at some step. The fixture's four runs are also the behavior kit's (README:
// Fixture names): each once in its data with the box, the slope and the centre the criterion gives it, and passed by
// the reference backend. `centre_of_mass_ignored` takes the field at check and builds the box as its shape alone gives
// it, so on the 33° slope it topples as the box with no field does; the judge names `box` and the angle it turned, and
// the kit's row for that run fails naming its box and the angle.
import { describe, expect, it } from 'vitest';
import {
  BACKEND, BOX_HALF, CRITERIA, DEG, LOW, TIMEOUT, ask, bakeRead, bodiesOf, boxDataFailures, caught, dataOf, failFailures, fmt, kitOf, mostTurned, naming,
  none, prebuildBuilds, rowOf, show, standWorld, statesOf, stepAt, type BoxRun, type Kit, type Planted,
} from './helpers.ts';

prebuildBuilds(['release']);

const ID = CRITERIA[1];
const STEPS = stepAt(3);

/** The fixture's four runs, and the name each has in the behavior kit. */
const RUNS: BoxRun[] = [
  { slope: 20, centre: false, stands: true, fixture: 'box_slope_20' },
  { slope: 33, centre: false, stands: false, fixture: 'box_slope_33' },
  { slope: 33, centre: true, stands: true, fixture: 'box_slope_33_centre' },
  { slope: 45, centre: true, stands: true, fixture: 'box_slope_45_centre' },
];
const LOW_33 = RUNS[2]!;
const where = (r: BoxRun): string => `on the ${r.slope}° slope with ${r.centre ? 'centre_of_mass (0, −0.75, 0)' : 'no centre_of_mass'}`;
const rule = (r: BoxRun): string => (r.stands ? 'less than 1° in 3 s' : 'past 45° within 3 s');
const keeps = (r: BoxRun, deg: number): boolean => (r.stands ? deg < 1 : deg > 45);

/** Each run baked 3 s: the most its box turned at any step, deg (null when its world isn't baked), and the judge's failures, each naming the body and the angle it turned. */
function judge(runs: BoxRun[], planted?: Planted): { failures: string[]; turned: (number | null)[] } {
  const replies = ask(runs.map((r) => bakeRead(standWorld(r.slope, r.centre ? LOW : undefined), STEPS, ['box'])), planted);
  const failures: string[] = [];
  const turned = runs.map((r, i) => {
    const reply = replies[i]!;
    if (reply['ok'] !== true) {
      failures.push(`box: ${where(r)} its world isn't baked: ${show(reply)}`);
      return null;
    }
    const most = mostTurned(statesOf(reply, 'box', STEPS + 1, `the box ${where(r)}`));
    console.log(`${planted ? `planted ${planted}: ` : ''}the box ${where(r)} turns ${fmt(most.deg, 4)}° at most, at step ${most.step}`);
    if (!keeps(r, most.deg)) failures.push(`box: turned ${fmt(most.deg, 4)}° ${where(r)} (at step ${most.step}), not ${rule(r)}`);
    return most.deg;
  });
  return { failures, turned };
}

/** Everything wrong with the kit's data and its report on the reference backend for the fixture's four runs. */
function kitFailures(k: Kit): string[] {
  const f: string[] = [];
  for (const r of RUNS) {
    const d = dataOf(k, r.fixture, f);
    if (d) f.push(...boxDataFailures(r, d));
    const row = rowOf(k, r.fixture, f);
    if (!row) continue;
    console.log(`${row.backend} ${r.fixture}: measured ${row.measured} against ${row.answer} ${JSON.stringify(row.tolerance)} → ${row.result}`);
    if (row.result !== 'pass') f.push(`${r.fixture}: reads ${row.result} on ${row.backend}, not pass: ${row.what}`);
    if (row.measured === null || !keeps(r, Math.abs(row.measured))) f.push(`${r.fixture}: measures a turn of ${show(row.measured)}° on ${row.backend}, not ${rule(r)}`);
    if (d && (row.answer !== d.answer || JSON.stringify(row.tolerance) !== JSON.stringify(d.tolerance))) f.push(`${r.fixture}: the row's answer and tolerance ${show(row.answer)} ${show(row.tolerance ?? null)} aren't the interface's ${d.answer} ${show(d.tolerance)}`);
  }
  return f;
}

describe(`${ID} a tall box tips where its weight is: at 26.57° with no centre_of_mass, at 63.43° with it 0.25 m above its base`, () => {
  it(`${ID} with no centre_of_mass the box turns less than 1° in 3 s on the 20° slope and past 45° on the 33° slope; with centre_of_mass (0, −0.75, 0) it turns less than 1° on the 33° slope and on the 45° slope`, () => {
    // The issue's worked answers, which the slopes lie between: 20° < 26.57° < 33° < 45° < 63.43°.
    expect(Math.atan(BOX_HALF[0] / BOX_HALF[1]) * DEG, 'atan(0.5 ÷ 1.0), the tipping angle with no centre_of_mass').toBeCloseTo(26.57, 2);
    expect(Math.atan(BOX_HALF[0] / (BOX_HALF[1] + LOW[1])) * DEG, 'atan(0.5 ÷ 0.25), the tipping angle with the centre 0.25 m above the base').toBeCloseTo(63.43, 2);
    none(judge(RUNS).failures, 'the box\'s turn on each slope');
  }, TIMEOUT);

  it(`${ID} the fixture's four runs are in the behavior kit's data once each, and the reference backend passes them`, () => {
    const k = kitOf();
    expect(k.report.backend, 'the report is the reference backend\'s').toBe(BACKEND);
    none(kitFailures(k), 'the box on a slope in the kit\'s data and on the reference backend');
  }, TIMEOUT);

  it(`${ID} (twin: centre_of_mass_ignored) a wrapper that reads the field and leaves the weight where the shapes put it topples on the 33° slope and fails, naming the body and the angle it turned`, () => {
    const { failures, turned } = judge([LOW_33], 'centre_of_mass_ignored');
    caught(failures, 'centre_of_mass_ignored');
    naming(failures, /^box: turned \d+(\.\d+)?° on the 33° slope /, 'centre_of_mass_ignored\'s failure names the body and the angle it turned');
    expect(turned[0] ?? 0, 'the planted wrapper\'s box topples: it turns past 45° within 3 s').toBeGreaterThan(45);
    // The kit holds the same run: under the wrapper its row fails, naming its box and the angle it turned.
    const k = kitOf('centre_of_mass_ignored');
    const f: string[] = [];
    const [d, row] = [dataOf(k, LOW_33.fixture, f), rowOf(k, LOW_33.fixture, f)];
    if (d && row) {
      f.push(...failFailures(row, row.backend));
      const boxes = bodiesOf(d, 'dynamic');
      const id = boxes.length === 1 ? boxes[0]![0] : null;
      if (id === null || row.raw['body'] !== id || !row.what.includes(id)) f.push(`${LOW_33.fixture}'s fail names body ${show(row.raw['body'])}, not its box ${show(id)}: ${JSON.stringify(row.what)}`);
      if (row.measured === null || !(row.measured > 45)) f.push(`${LOW_33.fixture}'s fail measures a turn of ${show(row.measured)}°, not one past 45°`);
    }
    none(f, `${LOW_33.fixture} under the planted wrapper`);
  }, TIMEOUT);
});
