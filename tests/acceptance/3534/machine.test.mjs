// #3534 criteria 4, 5 and 6: the minutes an issue waits on builds, tests and jobs, with the machine's build and test
// lines over the span; the minutes it loses to tool calls a hook left unanswered, with each day that had over 10 of
// them; and the quality counts. Written blind from issue #3534 at base 5a81b58de (README). One fixture serves every
// test of this file; the command runs once a span.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { cleanup, fixture, LATER, MACHINE, near, partOf, QUALITY, reading, rowOf, show, SPAN, TEST } from './helpers.mjs';

after(cleanup);

const READ = ['A', 'B', 'C'];

test("#3534.f9de4edc a tool call that runs over a minute, and a turn's end until a background job's notice, are job minutes", TEST, () => {
  const read = reading(SPAN);
  const notes = {
    A: 'calls of 3 minutes (allowed by a rule, not by a person), of 90 seconds twice, and of 5 minutes',
    B: "a call of 13 minutes; 18 and 6 minutes from a turn's end to a job's notice; and 9 minutes from a turn's end to a person's prompt while the job the session started still ran",
    C: 'calls of 4 and of 8 minutes',
  };
  for (const name of READ) {
    const want = fixture().rows[name];
    const row = rowOf(read, want);
    assert.equal(row.causes.job, want.causes.job, `issue #${want.issue}: job is ${row.causes.job} minutes, not ${want.causes.job}: ${notes[name]}\ncauses ${show(row.causes)}, the fixture's ${show(want.causes)}\n${read.said}`);
  }
});

test("#3534.f9de4edc the machine's build and test lines give the top-level grants, the requests that timed out, the share of samples held, the requests waiting on average and a request's average wait", TEST, () => {
  const read = reading(SPAN);
  const machine = partOf(read, 'machine');
  const logs = {
    build: 'in the span the throttle log has 3 top-level build grants, 2 nested ones and 1 build timeout, and the load log 20 samples: a build grant is held in 10, and 48 build requests wait in them in all',
    test: 'in the span the throttle log has 4 top-level test grants, 1 nested one and 1 test timeout, and the load log 20 samples: a test grant is held in 4, and 10 test requests wait in them in all',
  };
  for (const cls of ['build', 'test']) {
    const line = machine[cls], want = MACHINE[cls];
    assert.ok(line && typeof line === 'object', `machine.${cls} is ${show(line)}, not { grants, timeouts, held, waiting, wait }\n${read.said}`);
    const said = `${logs[cls]}; rows of other days, of the classes timed and bay-pair, and passes, turns and releases count for nothing\nmachine.${cls} ${show(line)}\n${read.said}`;
    assert.equal(line.grants, want.grants, `machine.${cls}.grants is ${show(line.grants)}, not the ${want.grants} top-level grants: ${said}`);
    assert.equal(line.timeouts, want.timeouts, `machine.${cls}.timeouts is ${show(line.timeouts)}, not ${want.timeouts}: ${said}`);
    assert.ok(near(line.held, want.held), `machine.${cls}.held is ${show(line.held)}, not ${want.held}, the share of the span's samples in which a ${cls} grant is held: ${said}`);
    assert.ok(near(line.waiting, want.waiting), `machine.${cls}.waiting is ${show(line.waiting)}, not ${want.waiting}, the ${cls} requests waiting in a sample on average: ${said}`);
    assert.ok(near(line.wait, want.wait), `machine.${cls}.wait is ${show(line.wait)}, not ${want.wait} minutes: a minute for each request waiting in each sample, over the ${want.grants} grants and the ${want.timeouts} timeout together: ${said}`);
  }
});

test('#3534.2c0280c9 a tool call whose result says a hook did not answer is hook minutes', TEST, () => {
  const read = reading(SPAN);
  const notes = {
    A: 'none of its calls was left unanswered',
    B: '11 calls of 10 minutes each, 6 in its first session and 5 in its second',
    C: '10 calls of 4 minutes each',
  };
  for (const name of READ) {
    const want = fixture().rows[name];
    const row = rowOf(read, want);
    assert.equal(row.causes.hook, want.causes.hook, `issue #${want.issue}: hook is ${row.causes.hook} minutes, not ${want.causes.hook}: ${notes[name]}, each with a result that starts "PreToolUse hook did not respond before its timeout"\ncauses ${show(row.causes)}, the fixture's ${show(want.causes)}\n${read.said}`);
  }
});

test('#3534.2c0280c9 a day with over 10 tool calls a hook left unanswered is named with its calls and its sessions, and a day with 10 is not', TEST, () => {
  const read = reading(SPAN);
  const days = partOf(read, 'days');
  const fx = fixture(), want = fx.hookDay;
  const dayOf = (entry) => String(entry?.day).slice(0, 10);
  const quiet = days.find((entry) => dayOf(entry) === fx.quietDay);
  assert.equal(quiet, undefined, `${fx.quietDay} had 10 tool calls a hook left unanswered, in one session of issue #${fx.rows.C.issue}, which is not over 10, and the day is named: ${show(quiet)}\ndays ${show(days)}\n${read.said}`);
  assert.deepEqual(days.map(dayOf), [want.day], `the one day with over 10 such calls is ${want.day}, with ${want.hook_calls} over two sessions, and days names ${show(days.map((entry) => entry?.day))}\n${read.said}`);
  const [entry] = days;
  assert.equal(entry.hook_calls, want.hook_calls, `${want.day} had ${want.hook_calls} tool calls a hook left unanswered, 6 in one session and 5 in another, and its hook_calls is ${show(entry.hook_calls)}\n${read.said}`);
  // A session is named by its id, the transcript's file name, alone or inside a longer string such as its path.
  const strings = (value) => (typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : []);
  const named = fx.sessionIds.filter((id) => strings(entry.sessions).some((word) => word.includes(id)));
  assert.deepEqual(named.sort(), [...want.sessions].sort(), `${want.day} is named with its sessions, ${want.sessions.join(' and ')}, and its sessions are ${show(entry.sessions)}\n${read.said}`);
});

test('#3534.9ca3cb3b quality over the span gives the PRs merged, those that are a revert, the failures listed, those dated in the span, and the skips', TEST, () => {
  for (const [days, want, notes] of [
    [SPAN, QUALITY.span, { merged: 'six PRs merged in the span: three whose issues are read, one whose issue is not read, one whose body names no issue and one revert', reverts: 'one title starts with Revert; another only mentions a revert', failures_added: 'two entries end "added 2025-03-11" and "added 2025-03-12"; the other three are dated before and after the span' }],
    [LATER, QUALITY.later, { merged: 'one PR merged in the span', reverts: 'no title in the span starts with Revert', failures_added: 'one entry ends "added 2025-03-17"; the other four are dated before the span' }],
  ]) {
    const read = reading(days);
    const quality = partOf(read, 'quality');
    for (const [field, note] of Object.entries({ ...notes, failures: 'scripts/known-failures.json of the tree lists five failures', skips: 'scripts/known-failures.json of the tree lists three skips' })) {
      assert.equal(quality[field], want[field], `over ${days.join(' ')}, quality.${field} is ${show(quality[field])}, not ${want[field]}: ${note}\nquality ${show(quality)}\n${read.said}`);
    }
  }
});
