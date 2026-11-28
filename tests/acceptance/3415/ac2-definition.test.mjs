import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DESIGN, LIMIT, lineOf, makeCopy, named, plant, read, runCheck, shown, write } from './helpers.mjs';

const ID = '#3415.e847772a';
const PLANTS = [
  'Zorvanthic fixture line: each stop is judged against the definition of done of each open ask.',
  'Zorvanthic fixture line: for each open ask it touched, against that ask\'s definition of done.',
];

function statesRow(text, word) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^#{2,4} States people see\s*$/.test(line));
  if (start < 0) return [];
  const end = lines.findIndex((line, i) => i > start && /^#{1,4} /.test(line));
  return lines.slice(start, end < 0 ? undefined : end).flatMap((line, i) => (new RegExp(`^\\| ${word} \\|`).test(line) ? [start + i + 1] : []));
}

test(`${ID} AC2: a planted sentence giving an ask a definition of done fails, naming its line, and the Done gate line, the done-gate row and the queued row of States people see pass`, LIMIT, (t) => {
  const { sandbox, repo } = makeCopy(t);
  const { text } = plant(read(repo, DESIGN), PLANTS.flatMap((line) => ['', line]));
  write(repo, DESIGN, text);
  const run = runCheck(repo, sandbox);
  t.diagnostic(`exit ${run.status}\n${shown(run)}`);
  assert.notEqual(run.status, 0, `the check passes a planted "the definition of done of each open ask"\n${shown(run)}`);
  const unnamed = PLANTS.filter((plant) => !named(run, DESIGN, lineOf(text, (line) => line === plant)[0]).length);
  assert.deepEqual(unnamed, [], `no failing line names ${DESIGN} and the line of these planted sentences\n${shown(run)}`);
  const places = {
    'the Done gate line': lineOf(text, (line) => /^- \*\*Done gate:\*\*/.test(line)),
    'the done-gate row': lineOf(text, (line) => /^\| done-gate \|/.test(line)),
    'the queued row of States people see': statesRow(text, 'queued'),
  };
  for (const [what, numbers] of Object.entries(places)) assert.equal(numbers.length, 1, `BLOCKED: ${DESIGN} must hold ${what} once, found at ${numbers.join(', ') || 'no line'}`);
  const failed = Object.entries(places).filter(([, [number]]) => named(run, DESIGN, number).length).map(([what, [number]]) => `${what} (${DESIGN}:${number})`);
  assert.deepEqual(failed, [], `the check fails these lines\n${shown(run)}`);
});
