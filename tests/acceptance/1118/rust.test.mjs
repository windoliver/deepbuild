// AC3's second half: when a twin touches Rust, a second proof of the same tree rebuilds only the crates it touches,
// and the record names them. The fixture's twin rewrites crates/greet/src/main.rs (greet is a leaf: nothing depends
// on it), so word, which no use touches, must stay fresh in every use, and the base bay compiles nothing.
import assert from 'node:assert/strict';
import test from 'node:test';
import { TWINS, USES, byUse, compiled, machineRepo, proof, recordUse, sandbox, show, strings, theBays, useRecords } from './helpers.mjs';

const names = (record, crate) => strings(record).some((value) => value === crate || value === `crates/${crate}` || value.startsWith(`crates/${crate}/`));

test('#1118.1f06c2df when the twin touches Rust, a second proof of the same tree rebuilds only the crate it touches, named in the record', { timeout: 1_200_000 }, async (t) => {
  const box = sandbox(t);
  const fixture = machineRepo(box, { twin: TWINS.rust });
  const first = await proof(box, fixture);
  const result = await proof(box, fixture);
  const uses = byUse(result, fixture.twin);
  for (const use of USES)
    for (const seen of uses[use]) {
      assert.equal(seen.build?.status, 0, `the ${use} use's cargo build failed\n${seen.build?.stderr}`);
      const expected = /base$/.test(use) ? [] : ['greet'];
      const extra = compiled(seen).filter((crate) => !expected.includes(crate));
      assert.deepEqual(extra, [], `in the second proof, the ${use} use compiled ${extra.join(', ')}, which none of its overlays touches\n${show(result)}`);
    }
  for (const seen of uses.twin) {
    assert.deepEqual(compiled(seen), ['greet'], 'the twin use did not rebuild greet, the crate its file is in');
    assert.equal(seen.greet, 'HELLO', 'the twin use\'s binary is not built from the twin');
  }
  const records = useRecords(result);
  for (const use of USES)
    for (const seen of uses[use])
      for (const crate of compiled(seen)) {
        const own = records.filter((record) => recordUse(record, fixture.twin) === use);
        assert.ok(own.some((record) => names(record, crate)), `the ${use} use rebuilt ${crate}, but no record of that use names it\n${own.map(({ line }) => line).join('\n') || '(no record of the use)'}`);
      }
  const bays = theBays(box, result, fixture.twin);
  assert.deepEqual(theBays(box, first, fixture.twin), bays, 'the second proof of the same tree used other bays than the first');
});
