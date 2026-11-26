// #3033.b7819eb1: "At 10 m/s the sea's significant height, four times the standard deviation of its height at 4,096
// seeded points over 600 s, is 2.14 m within 5% (0.21 × wind² ÷ g), and at 5 m/s 0.54 m. A planted table with every
// amplitude halved reads 1.07 m and fails, naming the wind"
//
// Runs on any machine: the wave table is read on `deep-gpu run --backend noop`, which draws nothing, and its measure is
// evaluated here in f64.
//
// The fixture (helpers.ts `tableCall`): a plate 2 km × 2 km whose material `sea-water` carries `water: {waves: {sea:
// {wind, direction: 90, spread: 30, seed: 3033}}}`, once with `wind: 10` and once with `wind: 5`, each a `view3d` call
// with `receipt: true`. The reply's `receipt.water.waves` is the sea's wave table (README: Surface choices): one row a
// wave, `{direction, length, amplitude, phase, speed}`.
//
// The measure (helpers.ts `significantHeight`, `everywhere`): 4,096 samples, each a point uniform over the plate at a
// time uniform over [0, 600) s, drawn from one generator seeded 3033; the height at a sample is the sum over the rows
// of amplitude × cos(k (D · (x, z)) − k × speed × t + phase), k = 2π ÷ length, D the row's heading; the significant
// height is four times the standard deviation of those 4,096 heights. It must be within 5% of the issue's 2.14 m at
// 10 m/s and of its 0.54 m at 5 m/s.
//
// The planted table (`deep-gpu run --backend noop --planted water_sea_amplitudes_halved`; README: Planted programs):
// the sea's table with every amplitude halved, everything else as shipped. The same check on it must read the issue's
// 1.07 m (within the same 5%) and fail, its failure naming the wind, 10 m/s.
import { describe, expect, it } from 'vitest';
import { AC, type JsonObject, failsNaming, heightProblems, keep, none, sea, tablesOf, useGpu, useOut } from './helpers.ts';

const bin = useGpu();
const out = useOut();

describe(`${AC[1]} a sea stands as high as its wind makes it`, () => {
  it(`${AC[1]} at 10 m/s the sea's significant height, four times the standard deviation of its height at 4,096 seeded points over 600 s, is 2.14 m within 5%, and at 5 m/s 0.54 m`, () => {
    const [ten, five] = tablesOf(bin(), out(), [['sea-10', sea(10)], ['sea-5', sea(5)]]);
    expect(ten, 'the receipt of a sea from a wind of 10 m/s lists its wave table, receipt.water.waves').not.toBeNull();
    expect(five, 'the receipt of a sea from a wind of 5 m/s lists its wave table, receipt.water.waves').not.toBeNull();
    const a = heightProblems(10, ten!, 2.14); const b = heightProblems(5, five!, 0.54);
    const kept = keep('tables', { tables: { 'sea from 10 m/s': ten as unknown as JsonObject[], 'sea from 5 m/s': five as unknown as JsonObject[] }, significant_height_m: { 'sea from 10 m/s': a.reading, 'sea from 5 m/s': b.reading } });
    console.log(`${AC[1]}: the sea from 10 m/s (${ten!.length} waves) reads ${a.reading.toFixed(4)} m against 2.14 m; from 5 m/s (${five!.length} waves) ${b.reading.toFixed(4)} m against 0.54 m; the tables are kept as ${kept}`);
    none([...a.failures, ...b.failures], 'each sea\'s significant height is the issue\'s within 5%');
  });

  it(`${AC[1]} a planted table with every amplitude halved (--planted water_sea_amplitudes_halved) reads 1.07 m and fails, naming the wind`, () => {
    const [halved] = tablesOf(bin(), out(), [['sea-10', sea(10)]], 'water_sea_amplitudes_halved');
    expect(halved, 'the planted run\'s receipt lists the sea\'s wave table, receipt.water.waves').not.toBeNull();
    const { reading, failures } = heightProblems(10, halved!, 2.14);
    console.log(`${AC[1]}: the table with every amplitude halved reads ${reading.toFixed(4)} m`);
    expect(Math.abs(reading - 1.07) / 1.07, `the planted table reads 1.07 m (within 5%), got ${reading.toFixed(4)} m`).toBeLessThanOrEqual(0.05);
    failsNaming(failures, /a wind of 10 m\/s/, 'the table with every amplitude halved');
  });
});
