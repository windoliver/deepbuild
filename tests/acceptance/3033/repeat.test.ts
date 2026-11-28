// #3033.2b265ebd: "Along the wind, the height's correlation with itself at every lag from 200 m to 1 km stays under 0.3
// (drafted). The same plate with `waves: wind` passes 0.9 inside that range, which is the repeat this task removes. A
// planted sea that draws only its four longest waves fails, naming the lag"
//
// Runs on any machine: the wave tables are read on `deep-gpu run --backend noop`, which draws nothing, and their
// measure is evaluated here in f64.
//
// The fixture (helpers.ts `tableCall`): the 2 km plate, once with `waves: {sea: {wind: 10, direction: 90, spread: 30,
// seed: 3033}}` and once, the same plate, with `waves: {wind: {speed: 10, direction: 90}}`, each a `view3d` call with
// `receipt: true`; each reply's `receipt.water.waves` lists the waves that water sums (README: Surface choices).
//
// The measure (helpers.ts `correlation`, `upwind`, `LAGS`): 4,096 samples, each a point uniform over the plate's upwind
// half at a time uniform over [0, 600) s, from one generator seeded 3033; at each lag of every whole metre from 200 m
// to 1 km, the correlation coefficient over the samples of the height at the sample's point and the height that lag
// downwind of it at the same time (the point is still on the plate). The sea's must be under 0.3 at all 801 lags; the
// four waves' must pass 0.9 at one of them at least.
//
// The planted sea (`deep-gpu run --backend noop --planted water_sea_draws_four_longest`; README: Planted programs):
// the sea keeps only the four longest waves of its table, so its receipt lists four and it draws four; everything else
// as shipped. The same check must fail on it, each failure naming its lag.
import { describe, expect, it } from 'vitest';
import { AC, DIRECTION, LAGS, correlation, failsNaming, fourWaves, keep, none, peak, repeatProblems, sea, tablesOf, upwind, useGpu, useOut } from './helpers.ts';

const bin = useGpu();
const out = useOut();
/** A curve as the log shows it: its value every 100 m. */
const every100 = (curve: number[]): string => LAGS.flatMap((lag, i) => (lag % 100 === 0 ? [`${lag} m ${curve[i]!.toFixed(2)}`] : [])).join(', ');

describe(`${AC[3]} a sea doesn't repeat along the wind, as four waves do`, () => {
  it(`${AC[3]} along the wind the 10 m/s sea's height correlates under 0.3 with itself at every lag from 200 m to 1 km, and the same plate with waves: wind passes 0.9 inside that range`, () => {
    const [swell, four] = tablesOf(bin(), out(), [['sea-10', sea(10)], ['four-waves-10', fourWaves(10)]]);
    expect(swell, 'the receipt of a sea from a wind of 10 m/s lists its wave table, receipt.water.waves').not.toBeNull();
    expect(four, 'the receipt of the same plate with waves: wind lists its waves, receipt.water.waves').not.toBeNull();
    const { curve, failures } = repeatProblems(swell!);
    const repeat = correlation(four!, DIRECTION, upwind(), LAGS);
    const [top, again] = [peak(curve), peak(repeat)];
    const kept = keep('repeat', { lags_m: LAGS, correlation: { 'sea from 10 m/s': curve, 'waves: wind at 10 m/s': repeat } });
    console.log(`${AC[3]}: the sea (${swell!.length} waves) correlates at most ${top.value.toFixed(3)}, at ${top.lag} m: ${every100(curve)}`);
    console.log(`${AC[3]}: waves: wind (${four!.length} waves) correlates up to ${again.value.toFixed(3)}, at ${again.lag} m: ${every100(repeat)}; both curves are kept as ${kept}`);
    none(failures, 'the sea\'s height correlates under 0.3 with itself at every lag from 200 m to 1 km along the wind');
    expect(again.value, `the same plate with waves: wind passes 0.9 inside that range: its highest is ${again.value.toFixed(3)} at ${again.lag} m`).toBeGreaterThan(0.9);
  });

  it(`${AC[3]} a planted sea that draws only its four longest waves (--planted water_sea_draws_four_longest) fails, naming the lag`, () => {
    const [cut] = tablesOf(bin(), out(), [['sea-10', sea(10)]], 'water_sea_draws_four_longest');
    expect(cut, 'the planted run\'s receipt lists the sea\'s wave table, receipt.water.waves').not.toBeNull();
    const { curve, failures } = repeatProblems(cut!);
    const top = peak(curve);
    console.log(`${AC[3]}: the planted sea (${cut!.length} waves) correlates up to ${top.value.toFixed(3)}, at ${top.lag} m: ${every100(curve)}`);
    failsNaming(failures, /^at a lag of \d+ m along the wind /, 'the sea of its four longest waves');
  });
});
