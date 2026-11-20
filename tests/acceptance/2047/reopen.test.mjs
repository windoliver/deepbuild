// #2047 AC3: three runs of the sweep over the six closed fixture issues, with the stand-in's GitHub kept between them:
// the first run, a second with nothing changed, and a third after a sixth criterion is added to the third issue
// (README: The fixtures, Comments, Readings).
import { test } from 'node:test';
import { LONG, SIX, assert, body, commentCalls, criterion, dump, fileIssue, issueOf, reopenCalls, sandbox, sixIssues, sweep, sweepComments } from './helpers.mjs';

test('AC3 #2047.2d1ab05b the first run reopens the third issue with one comment naming both unheld criteria; a second run with nothing changed makes 0 reopen and 0 comment calls; after a sixth criterion with no test the next run adds one comment naming only it', LONG, async (t) => {
  const box = await sandbox(t);
  sixIssues(box);
  const { clock } = SIX;
  const [fourth, fifth, sixth] = [criterion(clock, 4), criterion(clock, 5), criterion(clock, 6, clock.sixth)];
  const issues = Object.values(SIX).map(({ number }) => number);
  const states = () => Object.fromEntries(issues.map((n) => [n, issueOf(box, n).state]));

  const before = states();
  const first = await sweep(box);
  let all = dump(first);
  const said = sweepComments(box, clock.number);
  assert.equal(said.length, 1, `the first run made ${said.length} comments on the third fixture issue #${clock.number}, not one naming both its unheld criteria\n${all}`);
  for (const { id, words } of [fourth, fifth]) {
    assert.ok(said[0].body.includes(id) && said[0].body.includes(words), `the first run's comment on #${clock.number} doesn't name its unheld criterion ${id} by ID and first words ("${words}…"):\n${said[0].body}\n${all}`);
  }
  assert.ok(issueOf(box, clock.number).state === 'OPEN' && reopenCalls(first, clock.number).length === 1, `the first run didn't reopen the third fixture issue #${clock.number} with one gh issue reopen\n${all}`);

  // Nothing changed: no issue text and no test. Whoever closed them closes the issues the first run reopened again,
  // and their comments stay, as on GitHub.
  for (const [n, state] of Object.entries(states())) {
    if (before[n] === 'CLOSED' && state === 'OPEN') fileIssue(box, { ...issueOf(box, n), state: 'CLOSED', reason: 'COMPLETED' });
  }
  const second = await sweep(box);
  all = dump(first, second);
  const twice = sweepComments(box, clock.number).length;
  assert.equal(twice, 1, `after two runs with nothing changed the third fixture issue #${clock.number} holds ${twice} comments from the sweep, not 1\n${all}`);
  const calls = { reopen: reopenCalls(second).length, comment: commentCalls(second).length };
  assert.deepEqual(calls, { reopen: 0, comment: 0 }, `the second run, with nothing changed, made ${calls.reopen} reopen calls and ${calls.comment} comment calls, not 0 and 0\n${all}`);

  // A sixth criterion is added to the third issue, and no test names it.
  const clockNow = issueOf(box, clock.number);
  fileIssue(box, { ...clockNow, reason: clockNow.stateReason, body: body(clock.title, [...clock.criteria, clock.sixth]) });
  const counted = Object.fromEntries(issues.map((n) => [n, sweepComments(box, n).length]));
  const third = await sweep(box);
  all = dump(first, second, third);
  const added = issues.flatMap((n) => sweepComments(box, n).slice(counted[n]).map(({ body: text }) => ({ issue: n, body: text })));
  assert.equal(added.length, 1, `after a sixth criterion with no test was added to #${clock.number}, the next run added ${added.length} comments, not 1\n${all}`);
  assert.ok(added[0].issue === clock.number && added[0].body.includes(sixth.id) && added[0].body.includes(sixth.words), `the next run's comment isn't on #${clock.number} naming its sixth criterion ${sixth.id} by ID and first words ("${sixth.words}…"): ${JSON.stringify(added[0])}\n${all}`);
  assert.ok(![fourth.id, fifth.id].some((id) => added[0].body.includes(id)), `the next run's comment on #${clock.number} names its criterion 4 or 5 again, not only the new sixth:\n${added[0].body}\n${all}`);
  assert.deepEqual([first.status, second.status, third.status], [0, 0, 0], `a run with no issue BLOCKED didn't exit 0\n${all}`);
});
