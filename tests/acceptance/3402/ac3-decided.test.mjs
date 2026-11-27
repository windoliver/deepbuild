// Criterion 3 of #3402: the redrafted Decided test finds the seven rows #1352 added under any heading inside
// Decisions, and fails on a planted design that drops one of them, naming its question. A planted reading that counts
// rows under `### Decided` alone fails on main's design. "Main's design" is the design as the base commit holds it,
// read through git; the redrafted Decided test is its whole check, decidedCheck, which its test asserts gives no
// problem on this checkout's design. Planted designs are held in memory (README.md, AC3).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADDED_QUESTIONS, DECIDED_COLUMNS, cells, decidedCheck, headings, readDesign } from '../1352-redraft-3402/helpers.mjs';
import { DESIGN, baseBytes, baseMissing, readDecidedAlone } from './helpers.mjs';

// The seven rows' questions, as the base design holds them under "### Decided for a hosted hub".
const QUESTIONS = [
  'A hub for someone with no computer',
  'Who runs a hub in the cloud',
  'Whose agents a hosted hub runs',
  'What a hosted hub keeps in the cloud',
  'A browser reaching a hub',
  'Who pays for a hosted hub',
  'Moving between a hosted hub and your own computer',
];
const HEADER = ['| Question | Decision | Reopens if |', '|---|---|---|'];
const isRow = (line, question) => line.trim().startsWith('|') && cells(line)[0] === question;
const named = (problems) => problems.map((problem) => problem.match(/for the question "([^"]+)"/)?.[1] ?? problem);
const under = (found) => found.map(({ question, heading }) => `${heading}: ${question}`);

test('#3402.96b79474 a planted reading that counts rows under ### Decided alone fails on main\'s design, missing each of the seven rows #1352 added, and the redrafted Decided test finds them on this checkout\'s design under any heading inside Decisions: where it holds them, under a planted heading, and in its first Decided table; and not in a table outside Decisions', (t) => {
  const missing = baseMissing();
  if (missing) return t.skip(missing);
  // Main's design, as the base commit holds it: the planted reading, through the redraft's own check.
  const main = baseBytes(DESIGN).toString('utf8'), alone = readDecidedAlone(main);
  assert.ok(alone.rows?.length > 0, `the planted reading reads no row under ### Decided on main's design: ${alone.problem ?? 'none there'}`);
  const onMain = decidedCheck(main, readDecidedAlone);
  assert.deepEqual(named(onMain.problems), QUESTIONS);
  assert.deepEqual(onMain.found, [], 'the planted reading found rows #1352 added under ### Decided on main\'s design');

  // This checkout's design: as it is, then with the seven rows lifted and planted elsewhere.
  const design = readDesign();
  assert.deepEqual(ADDED_QUESTIONS, QUESTIONS, 'the redraft looks for other rows than the seven the base design holds');
  const asIs = decidedCheck(design);
  assert.deepEqual(asIs.problems, []);
  assert.deepEqual(asIs.found.map(({ question }) => question), QUESTIONS, 'the redrafted Decided test does not find the seven rows in the design as it is');
  const rows = asIs.found.map(({ row }) => row);
  const rest = design.split('\n').filter((line) => !QUESTIONS.some((question) => isRow(line, question)));
  assert.equal(design.split('\n').length - rest.length, QUESTIONS.length, 'the design does not hold each of the seven rows once');
  const { found } = headings(rest.join('\n'));
  const decisions = found.find((h) => h.slug === 'decisions').index;
  // In a table of their own under a planted heading, right under the Decisions heading.
  const planted = decidedCheck([...rest.slice(0, decisions + 1), '', '### Planted under another name', '', ...HEADER, ...rows, '', ...rest.slice(decisions + 1)].join('\n'));
  assert.deepEqual(planted.problems, []);
  assert.deepEqual(under(planted.found), QUESTIONS.map((q) => `Planted under another name: ${q}`), 'the seven rows are not found under a planted heading inside Decisions');
  // In the first table with the Decided columns under Decisions, whatever its heading, right under its rule line.
  const table = rest.findIndex((line, at) => at > decisions && cells(line).join('|') === DECIDED_COLUMNS.join('|') && /^\|[\s:|-]+\|?\s*$/.test((rest[at + 1] ?? '').trim()));
  assert.ok(table > decisions, 'the design has no table with the Decided columns under Decisions');
  const heading = found.findLast((h) => h.index < table).text;
  const moved = decidedCheck([...rest.slice(0, table + 2), ...rows, ...rest.slice(table + 2)].join('\n'));
  assert.deepEqual(moved.problems, []);
  assert.deepEqual(under(moved.found), QUESTIONS.map((q) => `${heading}: ${q}`), 'the seven rows are not found in the first Decided table under Decisions');
  // In a table with the Decided columns that is not under Decisions: before it, at its level.
  const outside = decidedCheck([...rest.slice(0, decisions), '## Planted before Decisions', '', ...HEADER, ...rows, '', ...rest.slice(decisions)].join('\n'));
  assert.deepEqual(named(outside.problems), QUESTIONS, 'rows in a table outside Decisions are read as Decided rows');
});

test('#3402.96b79474 the redrafted Decided test passes on this checkout\'s design, and fails on it planted without one of the seven rows, naming its question', () => {
  const design = readDesign(), lines = design.split('\n');
  assert.deepEqual(decidedCheck(design).problems, []);
  for (const question of QUESTIONS) {
    const planted = lines.filter((line) => !isRow(line, question));
    assert.equal(lines.length - planted.length, 1, `the design holds not exactly one row for "${question}" to drop`);
    assert.deepEqual(named(decidedCheck(planted.join('\n')).problems), [question], `with the row "${question}" dropped, the Decided test does not fail naming that question alone`);
  }
});
