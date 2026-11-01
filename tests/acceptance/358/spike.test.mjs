// Acceptance tests for issue #358, the panel host spike, on its record (docs/spikes/358/record.json), the tracked
// copy of a live run (record.out) and the technical design. Nothing builds the app.
// Run: node --test tests/acceptance/358/spike.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CASES } from './panels.mjs';
import {
  checkProblems, commandProblems, COST, costProblems, decisionProblems, DESIGN, entitlementFileProblems, JIT, jitProblems, loadRecord, RENDER, root, signatureProblems, signCommandProblems,
} from './validate.mjs';

const holds = (problems) => assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
const copy = (record, name) => {
  assert.ok(typeof record.out === 'string' && record.out.startsWith('docs/spikes/358/'), `record.out ${JSON.stringify(record.out)} isn't under docs/spikes/358/`);
  return JSON.parse(readFileSync(join(root, record.out, name), 'utf8'));
};

test(`${RENDER} the recorded run: an in-bounds panel passes, and each panel drawing outside its area or over the question card fails the headless render, as its laid-out trees show`, () => {
  const record = loadRecord();
  for (const id of Object.keys(CASES)) {
    const { want, status, output } = copy(record, `cases/${id}.json`);
    assert.deepEqual({ pass: want.pass, kinds: want.kinds, firstUpdate: want.firstUpdate }, { pass: CASES[id].pass, kinds: CASES[id].kinds, firstUpdate: CASES[id].firstUpdate }, `${id}: the kept case isn't this test's`);
    holds(checkProblems(id, want, { status, output }));
  }
});

test(`${JIT} the recorded run: the release host's kernel never left the interpreter while the switch's control did, and the signed binaries and every tracked entitlements file have no allow-jit`, () => {
  const record = loadRecord();
  holds([...commandProblems(record), ...signCommandProblems(record), ...entitlementFileProblems()]);
  const { shipping, control } = copy(record, 'jit.json');
  holds(jitProblems(shipping, control));
  const signatures = copy(record, 'signatures.json');
  holds([...signatureProblems('the app', signatures.app ?? {}), ...signatureProblems('the panel host', signatures.host ?? {})]);
});

test(`${COST} the decision records the panel host's element-tree cost on the 443-node benchmark with the JIT off, recomputed from its raw runs against 4 ms, and says what the runs say`, () => {
  const record = loadRecord();
  holds(costProblems(record));
  holds(decisionProblems(record, readFileSync(join(root, DESIGN), 'utf8')));
});
