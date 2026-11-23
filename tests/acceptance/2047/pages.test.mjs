// #2047 AC6: 250 closed issues, each with one criterion a test on main names by ID, served in pages of 100
// (README: The stand-in).
import { test } from 'node:test';
import { LONG, assert, body, dump, fileIssue, idOf, repo, sandbox, sweep } from './helpers.mjs';

const TEXT = 'The paged fixture issue has one criterion, held by ID';
const NUMBERS = Array.from({ length: 250 }, (_, i) => 10001 + i);

test('AC6 #2047.ececce7b with the stand-in serving 250 closed issues in pages of 100 the summary counts 250 read', LONG, async (t) => {
  const box = await sandbox(t);
  repo(box, {
    'tests/paged.test.mjs': ["import test from 'node:test';", '', `const IDS = ${JSON.stringify(NUMBERS.map((n) => idOf(n, TEXT)))};`, 'for (const id of IDS) test(`${id} holds`, () => {});', ''].join('\n'),
  });
  for (const n of NUMBERS) fileIssue(box, { number: n, title: `Fixture: paged issue ${n}`, body: body(`paged issue ${n}`, [TEXT]) });

  const run = await sweep(box, { timeout: 1_500_000 });
  const all = dump(run);
  const read = run.summary?.read;
  assert.equal(read, 250, `the summary counts ${read ?? 'no'} issues read, not 250: the stand-in served 250 closed issues in pages of 100\n${all}`);
  assert.equal(run.status, 0, `the run, with no issue BLOCKED, didn't exit 0\n${all}`);
});
