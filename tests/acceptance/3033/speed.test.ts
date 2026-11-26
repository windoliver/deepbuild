// #3033.dbde0e46: "Every row of the wave table has speed √(g × length ÷ 2π) within 1e-9, so the 100 m wave moves about
// 12.5 m in a second and the 25 m wave half that. A planted table that gives every wave the longest one's speed fails,
// naming the row"
//
// Runs on any machine: the wave table is read on `deep-gpu run --backend noop`, which draws nothing.
//
// The fixture (helpers.ts `tableCall`): the 2 km plate with `waves: {sea: {wind, direction: 90, spread: 30, seed:
// 3033}}` at 10 m/s and at 5 m/s, each a `view3d` call with `receipt: true`; the reply's `receipt.water.waves` is the
// sea's wave table, and each row carries its `length` in m and its `speed` in m/s (README: Surface choices).
//
// Every row of both tables: |speed − √(g × length ÷ 2π)| ≤ 1e-9, with g = 9.81 m/s², the water's own (helpers.ts `G`).
// The criterion's two numbers hold the formula as the suite evaluates it: 100 m gives about 12.5 m/s (to one decimal)
// and 25 m gives half of that. Not vacuous: each table holds waves of more than one length, so one speed for all of
// them fails.
//
// The planted table (`deep-gpu run --backend noop --planted water_sea_speed_of_longest`; README: Planted programs):
// every row's speed is the longest wave's, everything else as shipped. The same check must fail on it, each failure
// naming its row, for every row shorter than the longest and for no other.
import { describe, expect, it } from 'vitest';
import { AC, deepWaterSpeed, failsNaming, none, sea, speedProblems, tablesOf, useGpu, useOut } from './helpers.ts';

const bin = useGpu();
const out = useOut();

describe(`${AC[2]} every wave travels at the deep-water speed for its length`, () => {
  it(`${AC[2]} every row of the wave table of a sea from 10 m/s, and of one from 5 m/s, has speed √(g × length ÷ 2π) within 1e-9, by which a 100 m wave moves about 12.5 m in a second and a 25 m wave half that`, () => {
    const [ten, five] = tablesOf(bin(), out(), [['sea-10', sea(10)], ['sea-5', sea(5)]]);
    expect(ten, 'the receipt of a sea from a wind of 10 m/s lists its wave table, receipt.water.waves').not.toBeNull();
    expect(five, 'the receipt of a sea from a wind of 5 m/s lists its wave table, receipt.water.waves').not.toBeNull();
    expect(deepWaterSpeed(100), 'by the criterion\'s formula a 100 m wave moves about 12.5 m in a second').toBeCloseTo(12.5, 1);
    expect(deepWaterSpeed(25), 'and a 25 m wave half that').toBeCloseTo(deepWaterSpeed(100) / 2, 12);
    for (const [wind, rows] of [[10, ten!], [5, five!]] as const) {
      const lengths = rows.map((w) => w.length);
      console.log(`${AC[2]}: the sea from ${wind} m/s: ${rows.length} rows, ${Math.min(...lengths).toFixed(2)} to ${Math.max(...lengths).toFixed(2)} m long, ${Math.min(...rows.map((w) => w.speed)).toFixed(3)} to ${Math.max(...rows.map((w) => w.speed)).toFixed(3)} m/s`);
      expect(new Set(lengths).size, `the sea from ${wind} m/s holds waves of more than one length`).toBeGreaterThan(1);
      none(speedProblems(rows), `every row of the table of the sea from ${wind} m/s has the deep-water speed for its length`);
    }
  });

  it(`${AC[2]} a planted table that gives every wave the longest one's speed (--planted water_sea_speed_of_longest) fails, naming the row`, () => {
    const [same] = tablesOf(bin(), out(), [['sea-10', sea(10)]], 'water_sea_speed_of_longest');
    expect(same, 'the planted run\'s receipt lists the sea\'s wave table, receipt.water.waves').not.toBeNull();
    const fastest = deepWaterSpeed(Math.max(...same!.map((w) => w.length)));
    expect(same!.filter((w) => Math.abs(w.speed - fastest) > 1e-9).length, 'every row of the planted table has the longest wave\'s speed').toBe(0);
    const failures = speedProblems(same!);
    failsNaming(failures, /^row \d+ of the wave table /, 'the table with the longest wave\'s speed in every row');
    expect(failures.length, 'the check fails every row shorter than the longest, and no other').toBe(same!.filter((w) => Math.abs(deepWaterSpeed(w.length) - fastest) > 1e-9).length);
  });
});
