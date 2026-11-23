// #2700 criterion 1 (#2700.9725b660): "A one-item patch on a document that holds 4 MiB of `data` allocates under
// 256 KB more heap than the same patch on that document with no `data` (drafted). On the merge base it allocates at
// least 8 MiB more, and the test fails, naming the bytes"
//   node --test tests/acceptance/2700/heap.test.mjs
// The probe applies one `set` of one item's width to a 100-item document (`apply_ops`), takes the items it changed
// (`Patched::changed`) and re-checks it (`recheck`, then the same on a fresh document through `recheck_with`), once
// with a `data` member of 64 strings of 65,536 bytes (4 MiB of text) and once with no `data` member. Its allocator
// counts every byte asked of the heap between the patch's first op and the recheck's return. The count is exact and
// the same on every machine, so nothing here is a timing: no reference Mac, no load gate.
import assert from 'node:assert/strict';
import test from 'node:test';
import { AC, RECHECKS, grouped, probe, shown } from './lib.mjs';

const MIB = 1024 * 1024;
/** "under 256 KB more": 256,000 bytes (README: Readings). */
const LIMIT = 256_000;

test(`${AC.heap} a one-item patch allocates under 256 KB more heap on a document holding 4 MiB of data than on the same document with none`, { timeout: 3_600_000 }, () => {
  const report = probe('heap');
  for (const name of RECHECKS) {
    const side = report[name];
    assert.ok(side?.with_data && side?.without_data, `BLOCKED: the probe reported no ${name} run: ${shown(report)}`);
    const { with_data: withData, without_data: without } = side;
    // What must hold for the two counts to be the criterion's: the same one-item patch, re-checked, on both documents.
    for (const [what, run] of [['with 4 MiB of data', withData], ['with no data', without]]) {
      assert.equal(run.applied, true, `BLOCKED: ${name}: the one-item patch did not apply to the document ${what}: ${shown(run)}`);
      assert.deepEqual(run.changed, ['s007'], `BLOCKED: ${name}: the patch changed ${shown(run.changed)}, not its one item, on the document ${what}`);
      assert.equal(run.answered, true, `BLOCKED: ${name} answered nothing for a one-item patch on the document ${what} (a document of items alone needs no whole check), so no recheck was measured`);
      assert.equal(run.items, 100, `BLOCKED: ${name}: the document ${what} holds ${run.items} items, not 100`);
    }
    assert.equal(withData.data_text_bytes, 4 * MIB, `BLOCKED: the document holds ${grouped(withData.data_text_bytes)} bytes of data, not 4 MiB`);
    assert.equal(without.data_member, false, 'BLOCKED: the document "with no data" holds a data member');
    assert.ok(Number.isSafeInteger(withData.allocated_bytes) && Number.isSafeInteger(without.allocated_bytes) && without.allocated_bytes > 0,
      `BLOCKED: ${name}: no heap count: ${shown(side)}`);
    const more = withData.allocated_bytes - without.allocated_bytes;
    console.log(`${AC.heap} ${name}: ${grouped(withData.allocated_bytes)} bytes with 4 MiB of data, ${grouped(without.allocated_bytes)} bytes with none: ${grouped(more)} bytes more`);
    assert.ok(more < LIMIT,
      `${name}: the one-item patch allocated ${grouped(more)} bytes more heap on the document holding 4 MiB of data ` +
      `(${grouped(withData.allocated_bytes)} bytes) than on the same document with no data (${grouped(without.allocated_bytes)} bytes); ` +
      `the limit is under ${grouped(LIMIT)} bytes more${more >= 8 * MIB ? ' (at least 8 MiB more: the data was copied twice or more)' : ''}`);
  }
});
