// #2240.07b0552b: "A uniform bar 1 m long on a hinge at its top end, released from 10°, swings with a period of
// 2π√(2L ÷ 3g) × (1 + θ² ÷ 16) = 1.641 s within 1%. With `centre_of_mass` 0.75 m from the hinge along the bar, the
// period is 2π√((L² ÷ 12 + 0.75²) ÷ (0.75 g)) × (1 + θ² ÷ 16) = 1.865 s within 1%. A planted wrapper that ignores the
// field reads 1.641 s, and one that also adds a parallel-axis term to the shapes' inertia reads 1.953 s. Each fails,
// naming the fixture, the answer and what it read"
//
// The bar (README: The fixtures, the bar) hangs from the world by a hinge at its top end, is built turned 10° from
// hanging, at rest, and is baked 5 s at 120 Hz. Its period is read from the hinge's `joint_coordinate` output (#523's
// reading), sampled once a step: the time between the first two times the reading falls through the level midway
// between its highest and lowest values, each interpolated between its two steps. Each answer is worked here from the
// issue's formula and shown to print as the issue prints it. The two bars are also the behavior kit's (README: Fixture
// names), each once, passed by the reference backend. `centre_of_mass_ignored` swings the bar that writes the field as
// the one that doesn't, at 1.641 s; `centre_of_mass_parallel_axis` moves the weight and adds m × 0.25² to the inertia
// about it, so it swings at 1.953 s. Under each, the judge fails naming the answer and the reading, and the kit's row
// for the bar that writes the field fails, naming the fixture, the answer 1.865 s and the period it read.
import { describe, expect, it } from 'vitest';
import {
  BACKEND, BAR_LENGTH, BAR_LOW, CRITERIA, FROM_HINGE, G, RELEASE, TIMEOUT, ask, bakeRead, barDataFailures, barWorld, caught, dataOf, failFailures, fmt,
  kitOf, naming, near, none, prebuildBuilds, printedAs, readingsOf, rowOf, show, stepAt, swingOf, type BarRun, type Kit, type Planted,
} from './helpers.ts';

prebuildBuilds(['release']);

const ID = CRITERIA[2];
const STEPS = stepAt(5);
const WITHIN = 0.01;
/** The issue's formulas: θ in radians, L = 1 m, the centre 0.75 m from the hinge. */
const THETA = (RELEASE * Math.PI) / 180;
const WIDE = 1 + THETA ** 2 / 16;
const PERIOD = 2 * Math.PI * Math.sqrt((2 * BAR_LENGTH) / (3 * G)) * WIDE;
const PERIOD_CENTRE = 2 * Math.PI * Math.sqrt((BAR_LENGTH ** 2 / 12 + FROM_HINGE ** 2) / (FROM_HINGE * G)) * WIDE;

/** The two bars, each with its answer and the name it has in the behavior kit. */
const BARS: BarRun[] = [
  { centre: false, answer: PERIOD, printed: '1.641', fixture: 'bar_period' },
  { centre: true, answer: PERIOD_CENTRE, printed: '1.865', fixture: 'bar_period_centre' },
];
const CENTRE = BARS[1]!;
const named = (b: BarRun): string => (b.centre ? 'the bar with centre_of_mass 0.75 m from the hinge' : 'the bar with no centre_of_mass');

/** Each bar baked 5 s: its period, s (null when its world isn't baked or it never swings twice), and the judge's failures, each naming the answer and what it read. */
function judge(bars: BarRun[], planted?: Planted): { failures: string[]; periods: (number | null)[] } {
  const replies = ask(bars.map((b) => bakeRead(barWorld(b.centre ? BAR_LOW : undefined), STEPS)), planted);
  const failures: string[] = [];
  const periods = bars.map((b, i) => {
    const reply = replies[i]!;
    if (reply['ok'] !== true) {
      failures.push(`bar: ${named(b)} isn't baked: ${show(reply)}`);
      return null;
    }
    const swing = swingOf(readingsOf(reply, 'swing', STEPS + 1, named(b)).map((s) => s.value));
    console.log(`${planted ? `planted ${planted}: ` : ''}${named(b)} swings between ${fmt(swing.low)}° and ${fmt(swing.high)}° with a period of ${swing.period} s; the worked answer is ${fmt(b.answer)} s`);
    if (swing.period === null) failures.push(`bar: ${named(b)} doesn't fall twice through the middle of its swing in 5 s (it reads ${fmt(swing.low)}° to ${fmt(swing.high)}°), so it shows no period to hold to ${b.printed} s`);
    else if (!near(swing.period, b.answer, WITHIN)) failures.push(`bar: ${named(b)} swings with a period of ${fmt(swing.period)} s, not ${b.printed} s within 1%`);
    return swing.period;
  });
  return { failures, periods };
}

/** Everything wrong with the kit's data and its report on the reference backend for the two bars. */
function kitFailures(k: Kit): string[] {
  const f: string[] = [];
  for (const b of BARS) {
    const d = dataOf(k, b.fixture, f);
    if (d) f.push(...barDataFailures(b, d));
    const row = rowOf(k, b.fixture, f);
    if (!row) continue;
    console.log(`${row.backend} ${b.fixture}: measured ${row.measured} s against ${row.answer} s ${JSON.stringify(row.tolerance)} → ${row.result}`);
    if (row.result !== 'pass') f.push(`${b.fixture}: reads ${row.result} on ${row.backend}, not pass: ${row.what}`);
    if (row.measured === null || !near(row.measured, b.answer, WITHIN)) f.push(`${b.fixture}: measures a period of ${show(row.measured)} s on ${row.backend}, not ${b.printed} s within 1%`);
    if (d && (row.answer !== d.answer || JSON.stringify(row.tolerance) !== JSON.stringify(d.tolerance))) f.push(`${b.fixture}: the row's answer and tolerance ${show(row.answer)} ${show(row.tolerance ?? null)} aren't the interface's ${d.answer} ${show(d.tolerance)}`);
  }
  return f;
}

/** A planted wrapper swings the bar that writes the field at `reads` s: the judge fails, naming the answer and the reading, and the kit's row fails, naming the fixture, the answer and what it read. */
function wrongWrapper(planted: Planted, reads: string): void {
  const { failures, periods } = judge([CENTRE], planted);
  caught(failures, planted);
  naming(failures, /^bar: .* swings with a period of [\d.]+ s, not 1\.865 s within 1%$/, `${planted}'s failure names the answer and what it read`);
  const read = periods[0] ?? null;
  expect(read !== null && near(read, Number(reads), WITHIN), `the planted wrapper's bar reads ${reads} s within 1% (it reads ${String(read)} s)`).toBe(true);
  const k = kitOf(planted);
  const f: string[] = [];
  const row = rowOf(k, CENTRE.fixture, f);
  if (row) {
    f.push(...failFailures(row, row.backend));
    if (row.answer === null || !printedAs(row.answer, CENTRE.printed)) f.push(`${CENTRE.fixture}'s fail names the answer ${show(row.answer)}, not ${CENTRE.printed} s`);
    if (row.measured === null || !near(row.measured, Number(reads), WITHIN)) f.push(`${CENTRE.fixture}'s fail reads ${show(row.measured)} s, not the ${reads} s the planted wrapper swings at, within 1%`);
  }
  none(f, `${CENTRE.fixture} under ${planted}`);
}

describe(`${ID} a hinged bar swings slower with its weight lower: 1.641 s with no centre_of_mass, 1.865 s with it 0.75 m from the hinge`, () => {
  it(`${ID} the bar swings with a period of 1.641 s within 1%, and with centre_of_mass 0.75 m from the hinge along the bar 1.865 s within 1%`, () => {
    expect(PERIOD, '2π√(2L ÷ 3g) × (1 + θ² ÷ 16)').toBeCloseTo(1.641, 3);
    expect(PERIOD_CENTRE, '2π√((L² ÷ 12 + 0.75²) ÷ (0.75 g)) × (1 + θ² ÷ 16)').toBeCloseTo(1.865, 3);
    none(judge(BARS).failures, 'the bar\'s two periods beside their answers');
  }, TIMEOUT);

  it(`${ID} the two bars are in the behavior kit's data once each, and the reference backend passes them`, () => {
    const k = kitOf();
    expect(k.report.backend, 'the report is the reference backend\'s').toBe(BACKEND);
    none(kitFailures(k), 'the bar in the kit\'s data and on the reference backend');
  }, TIMEOUT);

  it(`${ID} (twin: centre_of_mass_ignored) a wrapper that ignores the field reads 1.641 s and fails, naming the fixture, the answer and what it read`, () => {
    wrongWrapper('centre_of_mass_ignored', '1.641');
  }, TIMEOUT);

  it(`${ID} (twin: centre_of_mass_parallel_axis) a wrapper that also adds a parallel-axis term to the shapes' inertia reads 1.953 s and fails, naming the fixture, the answer and what it read`, () => {
    wrongWrapper('centre_of_mass_parallel_axis', '1.953');
  }, TIMEOUT);
});
