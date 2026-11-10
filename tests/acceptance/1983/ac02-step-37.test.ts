// Criterion 2 (no upstream test): "A planted replay in the lane that changes one array value at step 37 makes
// `cross_machine` FAIL, naming step 37, the item and the field that differ, never PASS"
//
// The lane runs with `--planted replay_changes_step_37` (README: Planted twins): its container's deep-logic changes the
// first value of tally's first array (`x`) after step 37 of the replay. The lane's record is FAIL with the golden's report
// (Golden: first_step and the field), and `deep-logic determinism` with compare cross_machine fails on it, naming step
// 37, the item tally and the array tally.x.
import { describe, expect, it } from 'vitest';
import {
  AC, ARRAY, ITEM, STEP, TIMEOUT, cross, logicBin, macGolden, needImage, obj, onReferenceMac, pin, prebuild, recordOf, runLane, sandbox,
  show, tallyPiece, treeOf, verifyCall,
} from './helpers.ts';

prebuild(() => { logicBin(); });

describe(`${AC[2]} a replay in the lane that differs at step ${STEP} fails cross_machine`, () => {
  it(`${AC[2]} a planted replay that changes one value of ${ITEM}.${ARRAY} at step ${STEP} makes cross_machine FAIL, naming step ${STEP}, ${ITEM} and ${ARRAY}, never PASS`, () => {
    onReferenceMac();
    needImage(pin(), 'linux/amd64');
    const box = sandbox();
    const tree = treeOf(box);
    const piece = tallyPiece(1983_02);
    const golden = macGolden(piece);

    const run = runLane(box, [verifyCall(piece, golden)], { planted: 'replay_changes_step_37' });
    const record = recordOf(box, tree, run);
    expect(record['state'], `the lane's record of the planted replay: ${show(record)}`).toBe('FAIL');
    const report = obj(record['report'], 'the record\'s golden report');
    expect([report['first_step'], obj(report['field'], 'report.field')['id'], obj(report['field'], 'report.field')['field']], `the report names step ${STEP}, the item and the field: ${show(report)}`).toEqual([STEP, ITEM, ARRAY]);

    const c = cross(box, piece, tree, 'cross_machine on the planted replay\'s record');
    expect(c.verdict, `cross_machine fails, never PASS: ${show(c.raw)}`).toBe('FAIL');
    const named = c.failures.filter((f) => f['run'] === 'golden' && f['step'] === STEP && f['item'] === ITEM && f['array'] === `${ITEM}.${ARRAY}`);
    expect(named.length, `a golden failure names step ${STEP}, ${ITEM} and ${ITEM}.${ARRAY}: ${show(c.failures)}`).toBeGreaterThan(0);
  }, TIMEOUT);
});
