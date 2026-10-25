// #569 acceptance: a tolerance in a tagged test's fixtures only tightens (criterion 12), through
// `node scripts/proof.mjs guard`. The fixture is JSON Lines, one case per line (README Reading 9).
import test from 'node:test';
import { ISSUE, assertFails, assertPasses, criterionId, line, proof, repo } from './helpers.mjs';

const c1 = criterionId(ISSUE, 'Softmax matches the reference within its tolerance');
const FIXTURE = `tests/acceptance/${ISSUE}/fixtures/softmax.jsonl`;
const INPUT = '[1,2,3]';
const kase = (name, tolerance, input = INPUT) => `{"case":"${name}","criterion":"${c1}","tolerance":${tolerance},"input":${input},"expected":[0.09003057,0.24472847,0.66524096]}\n`;
const OLD = kase('softmax', '1e-6');
const LOOSE = kase('softmax loose', '1e-4');

const TEST = `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { softmax } from '../../../src/softmax.mjs';

const cases = readFileSync(new URL('fixtures/softmax.jsonl', import.meta.url), 'utf8').trim().split('\\n').map((row) => JSON.parse(row));

it('${c1} softmax matches the reference within each case\\'s tolerance', () => {
  for (const { input, expected, tolerance } of cases)
    softmax(input).forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= tolerance));
});
`;
const CODE = 'export const softmax = (xs) => { const e = xs.map(Math.exp); const s = e.reduce((a, b) => a + b, 0); return e.map((x) => x / s); };\n';
const code = { files: { 'src/softmax.mjs': `${CODE}export const argmax = (xs) => xs.indexOf(Math.max(...xs));\n` }, message: `Add argmax\n\nCloses #${ISSUE}` };
const RUNS = 'Old bound: 1e-6\nNew bound: 1e-4\nRuns:\nsoftmax: largest error 2.1e-7 on [1,2,3], passed\nsoftmax loose: largest error 2.1e-7 on [1,2,3], passed';

const scene = (t, fixture, commits) => repo(t, {
  base: { 'src/softmax.mjs': CODE, [`tests/acceptance/${ISSUE}/softmax.test.mjs`]: TEST, [FIXTURE]: fixture },
  issues: { [ISSUE]: ['Softmax matches the reference within its tolerance'] },
  commits,
});

test('#569.7b34ed5f raising a tagged fixture\'s tolerance from 1e-6 to 1e-4 in place fails the guard, naming the fixture and both values', (t) => {
  const result = proof(scene(t, OLD, [code, { files: { [FIXTURE]: kase('softmax', '1e-4') }, message: 'Loosen softmax' }]), ['guard']);
  assertFails(result, 'guard');
  line(result, ['FAIL'], 'guard', FIXTURE, '1e-6', '1e-4');
});

test('#569.7b34ed5f the in-place raise still fails when sent as its own approved proposal, naming the fixture and both values', (t) => {
  const result = proof(scene(t, OLD, [code, { files: { [FIXTURE]: kase('softmax', '1e-4') }, message: `Propose loosening softmax\n\n${RUNS}`, approve: { items: [FIXTURE] } }]), ['guard']);
  assertFails(result, 'guard');
  line(result, ['FAIL'], 'guard', FIXTURE, '1e-6', '1e-4');
});

test('#569.7b34ed5f the 1e-4 bound added as a new case beside the old, same criterion, proposed with both bounds and runs of both on the same inputs, passes once approved', (t) => {
  const result = proof(scene(t, OLD, [code, { files: { [FIXTURE]: OLD + LOOSE }, message: `Propose a looser softmax case\n\n${RUNS}`, approve: { items: [FIXTURE] } }]), ['guard']);
  assertPasses(result, 'guard');
});

test('#569.7b34ed5f the new looser case without your approval fails the guard, naming the fixture', (t) => {
  const result = proof(scene(t, OLD, [code, { files: { [FIXTURE]: OLD + LOOSE }, message: `Add a looser softmax case\n\n${RUNS}` }]), ['guard']);
  assertFails(result, 'guard');
  line(result, ['FAIL'], 'guard', FIXTURE);
});

test('#569.7b34ed5f the old case\'s removal fails unapproved, and fails inside the proposal that adds the looser case', (t) => {
  const alone = proof(scene(t, OLD + LOOSE, [code, { files: { [FIXTURE]: LOOSE }, message: 'Drop the tight softmax case' }]), ['guard']);
  assertFails(alone, 'guard');
  line(alone, ['FAIL'], 'guard', FIXTURE);
  const together = proof(scene(t, OLD, [code, { files: { [FIXTURE]: LOOSE }, message: `Propose a looser softmax case and drop the old\n\n${RUNS}`, approve: { items: [FIXTURE] } }]), ['guard']);
  assertFails(together, 'guard');
  line(together, ['FAIL'], 'guard', FIXTURE);
});

test('#569.7b34ed5f the old case\'s removal passes as its own approved proposal', (t) => {
  const result = proof(scene(t, OLD + LOOSE, [code, { files: { [FIXTURE]: LOOSE }, message: 'Propose dropping the tight softmax case', approve: { items: [FIXTURE] } }]), ['guard']);
  assertPasses(result, 'guard');
});

test('#569.7b34ed5f lowering the bound to 1e-7 passes as an approved proposal, and fails without approval', (t) => {
  const tighter = { [FIXTURE]: kase('softmax', '1e-7') };
  assertPasses(proof(scene(t, OLD, [code, { files: tighter, message: 'Propose tightening softmax', approve: { items: [FIXTURE] } }]), ['guard']), 'guard');
  const unapproved = proof(scene(t, OLD, [code, { files: tighter, message: 'Tighten softmax' }]), ['guard']);
  assertFails(unapproved, 'guard');
  line(unapproved, ['FAIL'], 'guard', FIXTURE);
});
