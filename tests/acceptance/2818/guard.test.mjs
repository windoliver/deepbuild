// #2818's third criterion (README: Criteria → tests). This checkout's real `node scripts/proof.mjs guard`, on a
// repository whose change is a refresh of scripts/known-failures.json as a record on main writes one: first with no
// approval tag, then under a maintainer's signed tag naming the file and each entry the refresh adds.
import test from 'node:test';
import { assert, day, dump, guardScene, KNOWN, knownFile, LONG, sandbox, verdicts } from './helpers.mjs';

const SKIP = { id: 'tests/fixture-2818/gated.test.ts › the gated test', note: 'opt-in: a person sets DEEP_2818_FIXTURE=1', reason: 'a fixture of #2818', approval: 'deep/approved/fixture' };
const PASSES_NOW = 'tests/fixture-2818-held.test.mjs › passes on main';
const ADDED = ['tests/fixture-2818-held.test.mjs › fails on main', 'cargo -p fixture-2818 --lib › tests::fails_on_main'];

test('#2818.5656e229 the proof guard passes on a refresh of scripts/known-failures.json made as its own commit under a signed approval tag naming the file and each entry it adds, and fails the same refresh with no tag, naming the file: the file is guarded (#1872)', LONG, async (t) => {
  const box = sandbox(t);
  const before = knownFile({ failures: { [PASSES_NOW]: `fails on main 0a1b2c3d4e: an earlier record's failure (#9801, added ${day(Date.now() - 3 * 86_400_000)})` }, skips: [SKIP] });
  // As a record at main's head writes it: the test that passes now taken out, each that fails there added, skips kept.
  const after = (main) => knownFile({ failures: Object.fromEntries(ADDED.map((id, at) => [id, `fails on main ${main.slice(0, 10)}: it fails there (#${9811 + at}, added ${day()})`])), skips: [SKIP] });
  const scene = guardScene(box, before, after);

  const unsigned = await scene.guard();
  const refusals = verdicts(unsigned).filter((line) => line.startsWith('FAIL guard:') && line.includes('known-failures.json'));
  assert.ok(refusals.length > 0 && unsigned.status !== 0, `a refresh of ${KNOWN} with no approval tag passed the proof guard, so the file isn't guarded (#1872)\n${dump(unsigned)}`);

  scene.approve([KNOWN, ...ADDED.flatMap((id) => [`${KNOWN} › ${id}`, id])]);
  const signed = await scene.guard();
  const refused = verdicts(signed).filter((line) => line.startsWith('FAIL guard:'));
  assert.deepEqual(refused, [], `the refresh, as its own commit under a signed approval tag naming ${KNOWN} and each entry it adds, fails the proof guard\n${dump(signed)}`);
  assert.equal(signed.status, 0, `the proof guard exits ${signed.status} on the approved refresh\n${dump(signed)}`);
});
