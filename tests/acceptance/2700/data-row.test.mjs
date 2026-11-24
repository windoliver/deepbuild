// #2700 criterion 3 (#2700.65df5186): "A patch that changes a row of `data` takes the whole check and reports what
// it reports today. A planted recheck that treats it as an item patch fails, naming the row"
//   node --test tests/acceptance/2700/data-row.test.mjs
// The probe holds a document whose item `meter` reads the row `data/goal` (its `row` names it), and changes that row
// twice: to a value no item can read as a number (the whole check then refuses `meter`), and back (it accepts it
// again). Each change reaches `data` and no item, so the patch names what it changed as the row's own name, the way
// the hub's patch path names the entries a patch changed outside `items` (README: Readings, the third criterion).
// What the patch then reports is the recheck's answer or, where the recheck answers nothing, the whole check its
// caller runs; that must be the whole check's issues, and the document must come back as it was given.
import assert from 'node:assert/strict';
import test from 'node:test';
import { AC, RECHECKS, probe, shown } from './lib.mjs';

const READER_ISSUE = { code: 'ref_unresolved', ids: ['meter'], path: 'items/meter/params/row' };

test(`${AC.dataRow} a patch that changes a row of data reports what the whole check reports`, { timeout: 3_600_000 }, () => {
  const { steps } = probe('data-row');
  assert.deepEqual(steps?.map((s) => s.step), ['broken', 'mended'], `BLOCKED: the probe did not change the row and change it back: ${shown(steps)}`);
  const [broken, mended] = steps;
  // The scenario itself: the row's change is what makes and unmakes the reader's issue, in the whole check.
  assert.deepEqual(broken.previous, [], `BLOCKED: the document had issues before its row changed: ${shown(broken.previous)}`);
  assert.deepEqual(broken.whole_check, [READER_ISSUE], `BLOCKED: the whole check does not refuse \`meter\` once the row ${broken.path} holds ${shown(broken.value)}: ${shown(broken.whole_check)}`);
  assert.deepEqual(mended.previous, [READER_ISSUE], `BLOCKED: the revision before the row was mended lacks the reader's issue: ${shown(mended.previous)}`);
  assert.deepEqual(mended.whole_check, [], `BLOCKED: the whole check still refuses something once the row ${mended.path} holds ${shown(mended.value)}: ${shown(mended.whole_check)}`);
  for (const step of steps) {
    for (const name of RECHECKS) {
      const call = step.calls?.[name];
      assert.ok(call, `BLOCKED: the probe reported no ${name} call for the ${step.step} row: ${shown(step)}`);
      console.log(`${AC.dataRow} row ${step.path} = ${shown(step.value)}: ${name} ${call.recheck_answered ? 'answered' : 'answered nothing, so the whole check ran'}; reported ${shown(call.reported)}`);
      assert.deepEqual(call.reported, step.whole_check,
        `the patch changed the row \`${step.path}\` (to ${shown(step.value)}), which the item \`${step.reader}\` reads, and what it reports through ${name} is not what the whole check reports: ` +
        `only the whole check reports ${shown(call.only_whole_check)}, only the patch reports ${shown(call.only_patch)} ` +
        `(${call.recheck_answered ? `${name} answered as for an item patch` : `${name} answered nothing and the whole check ran`})`);
      assert.equal(call.document_as_given, true, `the patch changed the row \`${step.path}\`, and ${name} did not hand the document back as it was given`);
    }
  }
});
