// #2047 AC1 and AC2: one run of the sweep over the six closed fixture issues and their tree of tests on main
// (README: The fixtures, Lines).
import { test } from 'node:test';
import { LONG, SIX, assert, commentCalls, criterion, dump, lineWith, namesIssue, reopenCalls, sandbox, sixIssues, sweep, unheldOf } from './helpers.mjs';

test('AC1 #2047.de9de3ac of six closed issues the sweep reads five: 4 criteria held by ID, 3 held by AC<n> in a suite naming no ID, criteria 4 and 5 of 5 unheld by ID and first words, 3 of 3 unheld with no test, and the not-planned one unread', LONG, async (t) => {
  const box = await sandbox(t);
  sixIssues(box);
  const run = await sweep(box);
  const all = dump(run);
  const { lamp, kettle, clock, fan, toaster } = SIX;
  // The third issue: criteria 4 and 5 came after its suite, so no test names them.
  for (const k of [4, 5]) {
    const { id, words } = criterion(clock, k);
    assert.ok(lineWith(run, `unheld ${id}`, words), `the third fixture issue #${clock.number} (5 criteria, 4 and 5 added after its suite) has no line naming its unheld criterion ${k} by ID and first words: unheld ${id} "${words}…"\n${all}`);
  }
  assert.deepEqual(unheldOf(run, clock.number), [criterion(clock, 4).id, criterion(clock, 5).id].sort(), `the third fixture issue #${clock.number} reads unheld criteria other than its 4 and 5; its suite names 1 to 3 by ID\n${all}`);
  // The fourth: no test at all, so all three.
  for (const k of [1, 2, 3]) {
    const { id, words } = criterion(fan, k);
    assert.ok(lineWith(run, `unheld ${id}`, words), `the fourth fixture issue #${fan.number}, with no test at all, has no line naming its criterion ${k} unheld by ID and first words: unheld ${id} "${words}…"\n${all}`);
  }
  assert.deepEqual(unheldOf(run, fan.number), [1, 2, 3].map((k) => criterion(fan, k).id).sort(), `the fourth fixture issue #${fan.number} reads other criteria unheld than its three\n${all}`);
  // The first and second: every criterion held, by ID (two in its helper) and by AC<n>.
  assert.deepEqual(unheldOf(run, lamp.number), [], `#${lamp.number}'s 4 criteria are each named by ID on main (2 in its test file, 2 in its suite's helper), yet some read unheld\n${all}`);
  assert.deepEqual(unheldOf(run, kettle.number), [], `#${kettle.number}'s suite names no criterion ID and a test for each of AC1 to AC3, yet some of its 3 criteria read unheld\n${all}`);
  // The fifth, closed as not planned: not read, so not named and not written to.
  assert.ok(!run.lines.some((line) => namesIssue(line, toaster.number) || line.includes(`#${toaster.number}.`)), `#${toaster.number}, closed as not planned, was read: a line names it\n${all}`);
  assert.deepEqual([...reopenCalls(run, toaster.number), ...commentCalls(run).filter(({ args }) => args.includes(String(toaster.number)))], [], `#${toaster.number}, closed as not planned, was reopened or commented on\n${all}`);
  // The summary: five read (the sixth is AC2's door), two of them held.
  assert.equal(run.summary?.read, 5, `the summary doesn't count 5 issues read (the six less the one closed as not planned): ${run.summary?.line ?? 'no one summary line'}\n${all}`);
  assert.equal(run.summary.held, 2, `the summary doesn't count 2 issues held (#${lamp.number} by ID, #${kettle.number} by AC<n>): ${run.summary.line}\n${all}`);
  assert.equal(run.status, 0, `the run, with no issue BLOCKED, didn't exit 0\n${all}`);
});

test('AC2 #2047.3e6fece2 a criterion reworded after its suite was written reads unheld, and the ID its suite still names is listed as stale, naming the test', LONG, async (t) => {
  const box = await sandbox(t);
  sixIssues(box);
  const run = await sweep(box);
  const all = dump(run);
  const { door } = SIX;
  const now = criterion(door, 2), before = criterion(door, 2, door.before);
  const suite = 'tests/acceptance/9106/door.test.mjs';
  assert.ok(lineWith(run, `unheld ${now.id}`, now.words), `criterion 2 of #${door.number}, reworded after its suite was written, now ${now.id} "${now.text}", isn't reported unheld: its suite's test names ${before.id}, the old wording's ID\n${all}`);
  assert.deepEqual(unheldOf(run, door.number), [now.id], `#${door.number} reads other criteria unheld than its reworded second; its suite names 1 and 3 by ID\n${all}`);
  assert.ok(lineWith(run, `stale ${before.id}`, suite), `the ID ${before.id}, which no live criterion of #${door.number} has, isn't listed as stale naming its test ${suite}\n${all}`);
  assert.equal(run.status, 0, `the run, with no issue BLOCKED, didn't exit 0\n${all}`);
});
