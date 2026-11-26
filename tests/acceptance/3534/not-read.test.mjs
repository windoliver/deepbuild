// #3534 criterion 8: an issue whose sessions left no transcript the command can read is listed as not read, with its
// PR, and is in no average. Written blind from issue #3534 at base 5a81b58de (README). The fixture's issue 7106 has a
// merged PR in the span and no transcript: none holds its PR link and none is on its head branch.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { cleanup, clock, fixture, near, NOT_READ, numberOf, OUTSIDE, partOf, reading, rowsOf, show, SPAN, TEST } from './helpers.mjs';

after(cleanup);

test('#3534.087b8d1d an issue whose sessions left no transcript is listed as not read, with its PR and why, and has no row of minutes', TEST, () => {
  const read = reading(SPAN);
  const list = partOf(read, 'not_read');
  const rows = rowsOf(read).filter((row) => numberOf(row?.issue) === NOT_READ.issue);
  assert.deepEqual(rows, [], `issue #${NOT_READ.issue} has no transcript, and the table gives it a row${rows[0]?.minutes === 0 ? ' of zero minutes' : ''}: ${show(rows[0])}. No transcript holds the link of its PR #${NOT_READ.pr} and none is on its head branch, so it is not read: nothing says it took no time\n${read.said}`);
  const found = list.filter((entry) => numberOf(entry?.issue) === NOT_READ.issue);
  assert.equal(found.length, 1, `issue #${NOT_READ.issue} has a PR merged in the span and no transcript, and not_read lists it ${found.length} times: ${show(list)}\n${read.said}`);
  const [entry] = found;
  assert.equal(numberOf(entry.pr), NOT_READ.pr, `issue #${NOT_READ.issue} is listed as not read with the PR ${show(entry.pr)}, not its PR #${NOT_READ.pr}\n${show(entry)}`);
  assert.ok(typeof entry.why === 'string' && entry.why.trim() !== '', `issue #${NOT_READ.issue} is listed as not read with no why: ${show(entry)}`);
  // Nothing else is not read: a PR whose body names no issue is left out, and so is one merged outside the span.
  const others = list.filter((other) => other !== entry);
  assert.deepEqual(others, [], `not_read lists more than issue #${NOT_READ.issue}: ${show(others)}. PR #${OUTSIDE.noIssue.pr} and the revert #${OUTSIDE.revert.pr} name no issue and are left out; PR #${OUTSIDE.before.pr} merged ${clock(OUTSIDE.before.merged)} and PR #${OUTSIDE.after.pr} ${clock(OUTSIDE.after.merged)}, outside the span\n${read.said}`);
});

test('#3534.087b8d1d the issue that is not read is in no average: the totals are those of the issues read', TEST, () => {
  const read = reading(SPAN);
  const total = partOf(read, 'total');
  const fx = fixture(), want = fx.total;
  const minutes = ['A', 'B', 'C'].map((name) => fx.rows[name].minutes);
  const times = minutes.join(', ');
  // What the averages read when the issue with no transcript is counted as a fourth issue of zero minutes.
  const diluted = { mean: minutes.reduce((one, two) => one + two, 0) / 4, person: want.causes.person * 3 / 4, prompts: want.prompts * 3 / 4 };
  const asZero = (value, zeroed) => (near(value, zeroed) ? `; that is the average with issue #${NOT_READ.issue} counted as zero minutes` : '');
  assert.equal(total.issues, want.issues, `total.issues is ${show(total.issues)}, not the ${want.issues} issues read (${['A', 'B', 'C'].map((name) => `#${fx.rows[name].issue}`).join(', ')}): issue #${NOT_READ.issue} has no transcript, is not read, and counts in no average\n${read.said}`);
  assert.ok(near(total.mean, want.mean), `total.mean is ${show(total.mean)}, not the ${want.mean} minutes an issue of the three read (${times})${asZero(total.mean, diluted.mean)}\n${read.said}`);
  assert.ok(near(total.median, want.median), `total.median is ${show(total.median)}, not ${want.median}, the middle of the three read (${times}): issue #${NOT_READ.issue} has no transcript and is in no average\n${read.said}`);
  assert.ok(near(total.causes?.person, want.causes.person), `total.causes.person is ${show(total.causes?.person)}, not the ${want.causes.person} minutes an issue of the three read${asZero(total.causes?.person, diluted.person)}\n${read.said}`);
  assert.ok(near(total.prompts, want.prompts), `total.prompts is ${show(total.prompts)}, not the ${want.prompts} prompts an issue of the three read${asZero(total.prompts, diluted.prompts)}\n${read.said}`);
});
