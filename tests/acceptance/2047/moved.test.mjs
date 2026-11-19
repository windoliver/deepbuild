// #2047 AC7: a closed issue whose third criterion line ends `(moved to #<m>)`, with #<m> an open issue and the first two
// named by ID on main (README: Moved).
import { test } from 'node:test';
import { LONG, assert, body, criterion, dump, fileIssue, issueOf, namesIssue, reopenCalls, repo, sandbox, sweep, sweepComments, unheldOf } from './helpers.mjs';

const MOVED_TO = 9132;
const MAP = { number: 9131, title: 'the map', criteria: ['The map shows every road in the town', 'Zooming in keeps every label readable', `Fog covers the tiles not yet visited (moved to #${MOVED_TO})`] };

test('AC7 #2047.a0828b81 a criterion line ending (moved to #<m>) is listed as moved, naming #<m>, and its issue is not reopened', LONG, async (t) => {
  const box = await sandbox(t);
  repo(box, {
    'tests/acceptance/9131/map.test.mjs': ["import test from 'node:test';", '', `test('${criterion(MAP, 1).id} every road shows', () => {});`, `test('${criterion(MAP, 2).id} labels stay readable', () => {});`, ''].join('\n'),
  });
  fileIssue(box, { number: MAP.number, title: `Fixture: ${MAP.title}`, body: body(MAP.title, MAP.criteria) });
  fileIssue(box, { number: MOVED_TO, title: 'Fixture: the fog', body: body('the fog', ['Fog covers the tiles not yet visited']), state: 'OPEN' });

  const run = await sweep(box);
  const all = dump(run);
  assert.ok(reopenCalls(run, MAP.number).length === 0 && issueOf(box, MAP.number).state === 'CLOSED', `#${MAP.number} was reopened, though the one criterion no test names, its third, ends (moved to #${MOVED_TO})\n${all}`);
  assert.ok(run.lines.some((line) => /\bmoved\b/.test(line) && namesIssue(line, MAP.number) && namesIssue(line, MOVED_TO)), `#${MAP.number}'s third criterion isn't listed as moved, naming #${MOVED_TO}\n${all}`);
  assert.deepEqual(unheldOf(run, MAP.number), [], `#${MAP.number} reads a criterion unheld: its first two are named by ID and its third moved to #${MOVED_TO}\n${all}`);
  assert.deepEqual(sweepComments(box, MAP.number), [], `the run commented on #${MAP.number}\n${all}`);
  assert.equal(run.status, 0, `the run, with no issue BLOCKED, didn't exit 0\n${all}`);
});
