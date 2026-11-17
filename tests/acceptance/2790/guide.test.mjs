// #2790: deep.registerPort is published with no guide entry, so `node scripts/guide.mjs --check` and #351 AC1 fail.
// Written blind from issue #2790, AGENTS.md, the design (Extension API; A first plug-in; Dogfooding) and the base
// 3cf41958f, before any fix existed. The surfaces are the ones the issue names: scripts/guide.mjs (what it writes, and
// its `--check`), docs/extension-guide.md and tests/acceptance/351/guide.test.ts. README.md maps each criterion to its
// test, says how a description is judged without pinning its sentence, and how the tests hold whether or not #2745
// (deep.source.ask, the same drift for another method) has landed.
import assert from 'node:assert/strict';
import test from 'node:test';
import { checkIsQuiet, DRIFT_CASES, regenerated, run351, scriptSays, unsaid, wrongFailures } from './helpers.mjs';

test('AC1 #2790.56435eb8 scripts/guide.mjs says what deep.registerPort is for, as the design\'s Extension API and the host give it: a plug-in\'s side of a piece\'s port; the entries and the occurrence rows it takes and the sources it gives for readings in; whether its gear makes sound, which makes the plug-in a device gate owner whatever the document says; registering opens nothing: a port opens only after a person clicks Connect, and sends only while the piece plays live', () => {
  scriptSays(assert);
});

test('AC2 #2790.92d7996b node scripts/guide.mjs --check prints no line that names deep.registerPort', () => {
  checkIsQuiet(assert);
});

test('AC2 #2790.92d7996b docs/extension-guide.md is regenerated: it has an entry for deep.registerPort under the digest the contract publishes, and the file is what node scripts/guide.mjs writes', () => {
  regenerated(assert);
});

test('AC3 #2790.d87e08da the drift case of tests/acceptance/351/guide.test.ts fails on no line that names deep.registerPort: it passes, or fails only on deep.source.ask', () => {
  const r = run351();
  assert.deepEqual(r.loadErrors, [], `tests/acceptance/351/guide.test.ts loads:\n${r.stdout}${r.stderr}`);
  const ran = r.cases.filter((c) => c.state !== 'skipped' && c.state !== 'pending');
  assert.equal(ran.length, 4, `the four cases of #351's guide.test.ts named ${DRIFT_CASES} ran; these did: ${JSON.stringify(ran.map((c) => c.name))}\n${r.stdout}${r.stderr}`);
  const failed = ran.filter((c) => c.state !== 'passed');
  assert.deepEqual(wrongFailures(failed), [], `each case passes, or fails only on lines of deep.source.ask (#2745):\n${wrongFailures(failed).join('\n')}`);
  if (!failed.length) assert.equal(r.status, 0, `every case passed, so vitest exits 0:\n${r.stdout}${r.stderr}`);
});

// Not a criterion: the proof that AC1's judge and AC3's rule fail wrong programs (AGENTS.md: a test must fail on a
// wrong program). It passes at the base and after the fix; README, "How a description is judged".
test('the judges: the issue\'s own sentence says it all, and an empty, an unrelated and a contrary description, and the sentence less any one clause, each leave something unsaid; a #351 failure is allowed only on deep.source.ask\'s lines', () => {
  const clauses = [
    ['a plug-in\'s side of a piece\'s port', 'A plug-in\'s side of a piece\'s port', 'One side of a port'],
    ['it lists the entries it takes', '; it lists the entries', '; it lists'],
    ['and the occurrence rows it takes', ' and the occurrence rows it takes', ' what it takes'],
    ['and the sources it gives for readings in', ' and the sources it gives for readings in', ''],
    ['it says whether its gear makes sound', '; it says whether its gear makes sound', '; it says what its gear is'],
    ['which makes the plug-in a device gate owner', ', which makes the plug-in a device gate owner', ''],
    ['whatever the document says', ' whatever the document says', ''],
    ['registering opens nothing', '; registering opens nothing', '; on registering'],
    ['a port opens only after a person clicks Connect', ': a port opens only after a person clicks Connect', ': a port waits'],
    ['and sends only while the piece plays live', ', and sends only while the piece plays live.', '.'],
  ];
  const whole = clauses.map(([, text]) => text).join('');
  assert.deepEqual(unsaid(whole), [], `the issue's sentence says every clause: ${whole}`);
  for (const [clause] of clauses) {
    const twin = clauses.map(([name, text, less]) => (name === clause ? less : text)).join('');
    assert.deepEqual(unsaid(twin), [clause], `without "${clause}" the judge names that clause and no other: ${twin}`);
  }
  const all = clauses.map(([name]) => name);
  assert.deepEqual(unsaid(''), all, 'an empty description says nothing');
  // deep.registerRoute's description, as the base's scripts/guide.mjs has it: another method's words.
  assert.deepEqual(unsaid('An HTTP route served on 127.0.0.1, which reaches the package only once you turn it on.'), all, 'an unrelated description says none of it');
  const contrary = `${clauses.slice(0, 7).map(([, text]) => text).join('')}; registering opens the port at once, and it sends on a seek, a replay and an export too.`;
  assert.deepEqual(unsaid(contrary), all.slice(7), `a description that says registering opens the port and that it sends on a replay says none of the last three clauses: ${contrary}`);

  // AC3's rule, on failures shaped as #351's drift case gives them.
  const fail = (...lines) => [{ name: 'AC1 the guide is generated', why: `AssertionError: ${lines.map((l) => `FAIL guide: ${l}\n  Fix: run node scripts/guide.mjs and commit docs/extension-guide.md`).join('\n')}\n\n: expected [ …(${lines.length}) ] to deeply equal []\n    at file.ts:1:1` }];
  const none = 'the contract publishes it, and the guide has no entry for it', silent = 'scripts/guide.mjs says nothing of what it is for';
  assert.deepEqual(wrongFailures([]), [], 'no failure is no finding');
  assert.deepEqual(wrongFailures(fail(`deep.source.ask: ${none}`, `deep.source.ask: ${silent}`)), [], 'a failure on deep.source.ask alone is #2745\'s');
  assert.equal(wrongFailures(fail(`deep.registerPort: ${none}`, `deep.registerPort: ${silent}`, `deep.source.ask: ${none}`, `deep.source.ask: ${silent}`)).length, 1, 'the base\'s failure, which names deep.registerPort, is a finding');
  assert.equal(wrongFailures(fail(`deep.registerPort: its guide entry differs from what the contract publishes`)).length, 1, 'a stale deep.registerPort entry is a finding');
  assert.equal(wrongFailures(fail(`deep.source.ask: ${none}`, `deep.lease: ${silent}`)).length, 1, 'a line of a third method is a finding');
  assert.equal(wrongFailures([{ name: 'AC1 the guide is generated', why: 'AssertionError: the guide names its typescript example' }]).length, 1, 'a failure with no FAIL guide line is a finding');
});
