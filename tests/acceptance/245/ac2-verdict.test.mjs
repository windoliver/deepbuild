// #245 AC2: "The stored verdict follows the rule above from the recorded numbers".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RECORD, clone, expectedVerdict, loadRecord, loadRule } from './helpers.mjs';

test('#245 AC2 the stored verdict is the issue\'s rule applied to the stored numbers', async () => {
  const r = loadRecord();
  assert.ok(['copy_on_write', 'one_instance'].includes(r.verdict), `${RECORD}: verdict must be "copy_on_write" or "one_instance", got ${JSON.stringify(r.verdict)}`);
  const want = expectedVerdict(r);
  assert.equal(r.verdict, want, `the stored verdict ${r.verdict} doesn't follow the rule from the recorded numbers (${want})`);
  const verdict = await loadRule();
  assert.equal(verdict(clone(r)), want, `spikes/245/rule.mjs verdict() on the stored record`);
});

test('#245 AC2 the rule reads the stored record\'s own numbers: moving copy_on_write across a threshold moves its verdict', async () => {
  const r = loadRecord();
  const verdict = await loadRule();
  const one = r.forms?.one_instance?.wall_ms;
  assert.ok(one && Number.isFinite(one.p50) && Number.isFinite(one.p95), `BLOCKED: ${RECORD} has no one_instance wall_ms p50 and p95`);
  const at = (ratio, overhead) => {
    const x = clone(r);
    x.verdict = ratio <= 0.5 ? 'one_instance' : 'copy_on_write'; // the opposite: the rule must not read it
    x.forms.copy_on_write.wall_ms.p50 = one.p50 * ratio;
    x.forms.copy_on_write.wall_ms.p95 = one.p95 * ratio;
    x.forms.copy_on_write.overhead_ms.p50 = overhead;
    x.forms.copy_on_write.overhead_ms.p95 = overhead;
    return x;
  };
  // The stored record is on a reference Mac with the issue's parameters (AC1), so only its numbers decide.
  assert.equal(verdict(at(0.4, 0.2)), 'copy_on_write', 'the stored record with copy_on_write at 0.4x and 0.2 ms');
  assert.equal(verdict(at(0.6, 0.2)), 'one_instance', 'the stored record with copy_on_write at 0.6x');
  assert.equal(verdict(at(0.4, 0.35)), 'one_instance', 'the stored record with 0.35 ms overhead');
});
