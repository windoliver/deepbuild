// #2700 criterion 5 (#2700.934bb9b3): "After a recheck that returns issues, one that returns nothing because the
// patch needs the whole check, and one that panics inside a check, the document equals the document as given, byte
// for byte once serialized. A planted recheck that does not put the items back fails, naming the first item missing"
//   node --test tests/acceptance/2700/as-given.test.mjs
// The probe holds one 12-item document (its items out of sorted order, with `data` and `assets`), applies a one-item
// patch, serializes the document (`serde_json::to_vec`), hands it to the recheck as `&mut`, and serializes it again
// once the recheck is over, for `recheck` and for `recheck_with`, three ways:
//   issues: the patch puts a width out of range; the recheck returns issues.
//   whole:  the same patch on the document with a `collections` entry, a map keyed by ID the recheck doesn't read,
//           so it returns nothing and the caller runs the whole check.
//   panic:  the patch sets an `acc2700.pic` item's `fuse` to `blow`, on which the test module's rule panics inside
//           the check; the probe catches the unwind, if one reaches it, and reads the document.
import assert from 'node:assert/strict';
import test from 'node:test';
import { AC, RECHECKS, probe, shown } from './lib.mjs';

/** Each case: what the recheck must have done for the case to be the criterion's, and how the README names it. */
const CASES = [
  { name: 'issues', what: 'a recheck that returns issues' },
  { name: 'whole', what: 'a recheck that returns nothing because the patch needs the whole check' },
  { name: 'panic', what: 'a recheck that panics inside a check' },
];

/** Why the document differs, naming the first item missing, else the first item out of its place, else the byte. */
function difference(run) {
  if (run.first_missing) return `the item \`${run.first_missing}\` is missing: the first of ${run.given_items.filter((id) => !run.after_items.includes(id)).length} the recheck did not put back (${run.after_items.length} of ${run.given_items.length} items left: ${shown(run.after_items, 300)})`;
  if (run.first_out_of_place) return `the item \`${run.first_out_of_place.given}\` is out of its place: item ${run.first_out_of_place.at} is \`${run.first_out_of_place.after}\``;
  if (run.after_items.length !== run.given_items.length) return `it holds ${run.after_items.length} items, not ${run.given_items.length}: ${shown(run.after_items, 300)}`;
  return `its bytes differ from byte ${run.first_byte_that_differs} (${run.given_bytes} bytes given, ${run.after_bytes} after)`;
}

test(`${AC.asGiven} after a recheck that returns issues, one that returns nothing and one that panics inside a check, the document is the document as given, byte for byte`, { timeout: 3_600_000 }, () => {
  const { cases } = probe('as-given');
  for (const { name, what } of CASES) {
    for (const fn of RECHECKS) {
      const run = cases?.find((c) => c.case === name && c.function === fn);
      assert.ok(run, `BLOCKED: the probe reported no ${fn} run for ${what}: ${shown(cases)}`);
      assert.equal(run.applied, true, `BLOCKED: ${fn}, ${what}: the one-item patch did not apply`);
      assert.equal(run.given_items.length, 12, `BLOCKED: ${fn}, ${what}: the document given holds ${run.given_items.length} items, not 12`);
      // The case must be the one the criterion names, or its document proves nothing.
      if (name === 'issues') assert.ok(run.returned === 'issues' && run.issues.length > 0, `BLOCKED: ${fn} did not return issues for a patch that puts a width out of range: it returned ${run.returned} ${shown(run.issues)}`);
      if (name === 'whole') assert.equal(run.returned, 'nothing', `BLOCKED: ${fn} did not return nothing for a document holding a collections entry (it returned ${run.returned}), so no recheck that needs the whole check ran`);
      if (name === 'panic') assert.equal(run.check_panicked, true, `BLOCKED: the test module's rule did not panic inside ${fn}'s check (it returned ${run.returned}), so no recheck panicked inside a check`);
      console.log(`${AC.asGiven} ${fn}, ${what}: returned ${run.returned}; the document ${run.equal ? 'equals' : 'differs from'} the document as given (${run.given_bytes} bytes)`);
      assert.equal(run.equal, true, `after ${what} (${fn}; it ${run.returned === 'panic' ? 'unwound' : `returned ${run.returned}`}), the document is not the document as given: ${difference(run)}`);
      assert.deepEqual(run.after_items, run.given_items, `after ${what} (${fn}), the items are not in their order`);
    }
  }
});
