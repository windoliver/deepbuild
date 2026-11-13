// #1183.b941c395 (AC5): "A driver over a bound value with no unit appears in the record as unchecked, naming the
// mapping, and the check's verdict for it is INCONCLUSIVE, never PASS."
//
// Fixture (helpers.ts, gaugeFigure). The gauge: in assembly `gauge` (`shown_at: 1`) the dial and the needle `needle`,
// whose x the driver `sweep` sets to `0.01 * r`, r the logic output `meter.reading` (0.5 at every step), whose write
// declares no unit. Nothing else in the figure maps a length.
//
// asserts: the honest-numbers row is INCONCLUSIVE, with its `lengths` record holding drivers/sweep on needle as
// `unchecked`, and the claim's verdict isn't PASS.
// Wrong programs it fails: the base (honest numbers PASSes the gauge, and has no record); a check that takes a value
// with no unit as metres (passes or refuses it); one that leaves the mapping out of the record.
import { describe, it } from 'vitest';
import { AC, TIMEOUT, brief, docId, entryFailures, gaugeFigure, judge, none, useFolders, useShow } from './helpers.ts';

const bin = useShow();
const folder = useFolders();

describe(`${AC[5]} a mapping over a value with no unit is never passed`, () => {
  it(`${AC[5]} a driver over a logic output with no unit is in the record as unchecked, naming drivers/sweep, and the check's verdict is INCONCLUSIVE`, () => {
    const fig = gaugeFigure(docId(1));
    const judged = judge(bin(), folder(), [fig]).judged[fig.name];
    const row = judged?.row;
    const failures = entryFailures(row, 'sweep', 'needle', 'unchecked', null, 'the gauge');
    if (row?.result !== 'INCONCLUSIVE') failures.push(`the gauge's honest-numbers row is ${row?.result ?? 'missing'}, not INCONCLUSIVE: ${brief(row?.raw)}`);
    if (judged?.result === 'PASS') failures.push(`the claim on the gauge is PASS: ${brief(judged.raw)}`);
    none(failures, 'a mapping over a value with no unit');
  }, TIMEOUT);
});
