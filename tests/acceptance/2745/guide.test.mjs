// #2745: deep.source.ask is published with no guide entry, so `node scripts/guide.mjs --check` and #351 AC1 fail.
// Written blind from issue #2745, AGENTS.md, the design (A first plug-in; Dogfooding) and the base 3c124dee5, before
// any fix existed. The surfaces are the ones the issue names: scripts/guide.mjs (what it writes, and its `--check`),
// docs/extension-guide.md and tests/acceptance/351/guide.test.ts. README.md maps each criterion to its test and says
// how a description is judged without pinning its sentence.
import assert from 'node:assert/strict';
import test from 'node:test';
import { checkPasses, DRIFT_CASES, regenerated, run351, scriptSays, unsaid } from './helpers.mjs';

test('AC1 #2745.733b48e4 scripts/guide.mjs says what deep.source.ask is for, as the host serves it: a plug-in asks a model source its manifest lists; the hub makes the call, from a recording when replaying; the plug-in gets the answer\'s status and body, or no answer, never the network', () => {
  scriptSays(assert);
});

test('AC2 #2745.92c22554 node scripts/guide.mjs --check passes', () => {
  checkPasses(assert);
});

test('AC2 #2745.92c22554 docs/extension-guide.md is regenerated: it has the entry for deep.source.ask and is what scripts/guide.mjs writes', () => {
  regenerated(assert);
});

test('AC3 #2745.0609af76 tests/acceptance/351/guide.test.ts passes: its drift cases, the one that failed on main among them', () => {
  const r = run351();
  assert.deepEqual(r.loadErrors, [], `tests/acceptance/351/guide.test.ts loads:\n${r.stdout}${r.stderr}`);
  const ran = r.cases.filter((c) => c.state !== 'skipped' && c.state !== 'pending');
  assert.equal(ran.length, 4, `the four cases of #351's guide.test.ts named ${DRIFT_CASES} ran; these did: ${JSON.stringify(ran.map((c) => c.name))}\n${r.stdout}${r.stderr}`);
  const failed = ran.filter((c) => c.state !== 'passed');
  assert.deepEqual(failed.map((c) => c.name), [], `each passes; failing:\n${failed.map((c) => `${c.name}\n${c.why.split('\n    at ')[0]}`).join('\n')}`);
  assert.equal(r.status, 0, `vitest exits 0:\n${r.stdout}${r.stderr}`);
});

// Not a criterion: the proof that AC1's judge fails wrong descriptions (AGENTS.md: a test must fail on a wrong
// program). It passes at the base and after the fix; README, "How a description is judged".
test('the judge of AC1: the issue\'s own sentence says it all, and an empty, an unrelated and a contrary description, and the sentence less any one clause, each leave something unsaid', () => {
  const clauses = [
    ['a plug-in asks a model source', 'A plug-in asks a model source', 'A plug-in asks'],
    ['one its manifest lists', ' its manifest lists', ' it names'],
    ['the hub makes the call', '; the hub makes the call', '; the call is made'],
    ['from a recording when replaying', ', from a recording when replaying', ''],
    ['the plug-in gets the answer\'s status and body', '; the plug-in gets the answer\'s status and body', '; the plug-in gets the answer'],
    ['or no answer', ', or no answer', ''],
    ['never the network', ', never the network.', '.'],
  ];
  const whole = clauses.map(([, text]) => text).join('');
  assert.deepEqual(unsaid(whole), [], `the issue's sentence says every clause: ${whole}`);
  for (const [clause, , without] of clauses) {
    const twin = clauses.map(([name, text, less]) => (name === clause ? less : text)).join('');
    assert.deepEqual(unsaid(twin), [clause], `without "${clause}" the judge names that clause and no other: ${twin}`);
  }
  assert.equal(unsaid('').length, 7, 'an empty description says nothing');
  // deep.fetch's description, as the base's scripts/guide.mjs has it: another method's words.
  assert.deepEqual(unsaid('An outside call the hub makes for the package, only to a host its grant names and within that host\'s quota.'), [
    'a plug-in asks a model source', 'one its manifest lists', 'from a recording when replaying', 'the plug-in gets the answer\'s status and body', 'or no answer', 'never the network',
  ], 'an unrelated description leaves out all but the hub');
  assert.deepEqual(unsaid(whole.replace(', never the network.', ', which it reads from the network.')), ['never the network'], 'a description that says the plug-in reads the network doesn\'t say "never the network"');
});
