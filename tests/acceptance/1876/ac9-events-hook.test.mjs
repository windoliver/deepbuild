// #1876 criterion 9: the design's events table names every column packages/record/src/index.ts creates, and the hook
// protocol's ack and reply carry `v`. Through the design links lane's own commands on a scratch copy: a planted column
// in the record's table fails the lane, naming it, and so does a planted copy of the ack, or of the reply, without `v`
// (README: Criteria and tests).
import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECKOUT, DESIGN, RECORD, carriesV, clean, eventsTable, hookLines, insertAfter, namesWord, read, recordColumns, replaceLine, runLane, shown, unfailed, write } from './helpers.mjs';

// The planted column: a word the issue's other plants use, which the record doesn't create and the design doesn't name.
const COLUMN = 'ghost';

test('AC9 #1876.6bec2ce3 the events table names every column packages/record/src/index.ts creates, and a planted column in the record\'s table fails the design links lane, naming it', (t) => {
  const copy = clean(t);
  const problems = [];
  // The tree: the checkout's own design and record.
  const table = eventsTable(read(CHECKOUT, DESIGN));
  const unnamed = recordColumns(CHECKOUT).columns.filter((column) => !table.columns.some(({ name }) => name === column));
  if (unnamed.length) problems.push(`the events table (${DESIGN}:${table.number}) doesn't name ${unnamed.length} of the columns ${RECORD} creates: ${unnamed.join(', ')}`);
  // The plant: one more column in the copy's record, the first line of its `CREATE TABLE … events (`.
  const record = recordColumns(copy.repo);
  assert.ok(!record.columns.includes(COLUMN) && !eventsTable(read(copy.repo, DESIGN)).columns.some(({ name }) => name === COLUMN), `\`${COLUMN}\` is already a column of the record or of the design's events table, so planting it would prove nothing`);
  insertAfter(copy.repo, RECORD, record.from + 1, `  ${COLUMN}       TEXT,`);
  assert.ok(recordColumns(copy.repo).columns.includes(COLUMN), `the planted column isn't read as a column ${RECORD} creates`);
  const run = runLane(copy.repo, copy.issues);
  const planted = `a planted column \`${COLUMN}\` in the events table ${RECORD} creates`;
  problems.push(...unfailed(run, planted));
  if (run.status !== 0 && !namesWord(run, COLUMN)) problems.push(`on ${planted}, the lane failed without naming \`${COLUMN}\`: ${shown(run)}`);
  if (problems.length) assert.fail(problems.join('\n\n'));
});

test('AC9 #1876.6bec2ce3 the hook protocol\'s ack and reply carry `v`, and a planted copy of the ack, or of the reply, without it fails the design links lane', (t) => {
  const copy = clean(t);
  const problems = [];
  // The tree: the checkout's own design.
  const real = hookLines(read(CHECKOUT, DESIGN));
  for (const [name, { number, line }] of [['ack', real.ack], ['reply', real.reply]]) if (!carriesV(line)) problems.push(`the hook protocol's ${name} (${DESIGN}:${number}) carries no \`v\`: ${line.trim()}`);
  // The plants, one at a time on the copy's design as it was: the ack without its `v`, then the reply without its `v`.
  const design = read(copy.repo, DESIGN);
  const own = hookLines(design);
  for (const [name, { number, line }] of [['ack', own.ack], ['reply', own.reply]]) {
    const bare = line.replace(/"v"\s*:\s*[^,}]+,\s*/, '').replace(/,\s*"v"\s*:\s*[^,}]+/, '');
    assert.ok(!carriesV(bare), `the planted ${name} still carries \`v\`: ${bare}`);
    write(copy.repo, DESIGN, design);
    replaceLine(copy.repo, DESIGN, number, bare);
    const run = runLane(copy.repo, copy.issues);
    problems.push(...unfailed(run, `a planted copy of the hook protocol's ${name} without \`v\` (${DESIGN}:${number}: ${bare.trim()})`));
  }
  if (problems.length) assert.fail(problems.join('\n\n'));
});
