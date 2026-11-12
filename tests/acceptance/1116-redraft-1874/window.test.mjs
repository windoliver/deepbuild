// Blind redraft, under #1874's rule, of the two #1116 scene tests that expect a window to close an issue (REDRAFT.md).
// The scene is #1116's, but for its fixture: the task names each fixture issue's budget criterion by ID, in a commit
// before the first window's mark, so a window that meets #1874 can close them. n0 and n1 stand where r0 and r1 stood:
// a forks from n0, before the mark, and b from n1, the mark. Names and expected values are #1116's.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { dump, ended, fileIssue, followUps, fullWindow, hold, issue, LIMIT, logLines, LONG, marked, fixture, openWindow, recordOf, records, REGRESSED, samples, sandbox, started, TASK, until } from '../1116/helpers.mjs';
import { named, plain } from './helpers.mjs';

const PLAIN = 9101, SLOW = 9102, LATE = 9103, NEXT = 9104, UNPROVEN = 9105;
const box = sandbox({ after });
const SLOTS = Object.entries(LIMIT).flatMap(([kind, count]) => Array.from({ length: count }, (_, k) => ({ kind, name: `holder-${kind}-${k}` })));

async function play() {
  const repo = fixture(box);
  for (const number of [PLAIN, SLOW, LATE, NEXT]) fileIssue(box, number);
  fileIssue(box, UNPROVEN, { proven: false });
  const n0 = named(box, repo, [PLAIN, SLOW, LATE, NEXT, UNPROVEN], 'n0'), n1 = plain(box, repo, 'n1');
  await marked(box, repo);

  // Three pull requests, each from its own fork point, and none the commit before its merge on main. a forked before
  // the mark. c forked before b merged, so main carries b's regression into c's merge, and c's own change has none.
  const a = repo.branch('a', n0, PLAIN);
  const b = repo.branch('b', n1, SLOW, { 'work.sh': REGRESSED });
  const mergedA = repo.merge('a', PLAIN);
  const c = repo.branch('c', mergedA, LATE);
  const mergedB = repo.merge('b', SLOW);
  const mergedC = repo.merge('c', LATE);
  const e = repo.branch('e', mergedC, UNPROVEN);

  const logStart = logLines(box).length;
  const holders = SLOTS.map(({ kind, name }) => hold(box, repo, kind, 5, { name, hold: 6000 }));
  for (const { name } of SLOTS) await started(box, name);
  const window = openWindow(box, repo);
  // Best effort, so the queued requests come after the window's: the table shows a pending timed request.
  await until(() => {
    try {
      return window.exited || /"timed"/.test(readFileSync(join(box.home, '.deepbuild/throttle/table.json'), 'utf8'));
    } catch {
      return false;
    }
  }, 5000);
  const queued = ['build', 'test', 'bay-pair'].map((kind) => hold(box, repo, kind, 10, { name: `queued-${kind}` }));

  // The first sample proves the window is measuring: from here the two late commits land and an agent asks for a build.
  await until(() => window.exited || samples(box).length > 0, 240_000);
  const sampled = !window.exited && samples(box).length > 0;
  let d, mergedE, duringBuild, requested, merged;
  if (sampled) {
    d = repo.push('d', NEXT);
    mergedE = repo.merge('e', UNPROVEN);
    merged = Date.now();
    requested = Date.now();
    duringBuild = hold(box, repo, 'build', 10, { name: 'during-build' });
  }
  const run = await ended(window, 300_000);
  const first = { records: records(box), samples: samples(box), issues: Object.fromEntries([NEXT, UNPROVEN].map((number) => [number, issue(box, number).state])) };
  await Promise.all([...holders, ...queued, ...(duringBuild ? [duringBuild] : [])].map((child) => ended(child, 90_000)));
  const next = await fullWindow(box, repo);
  return { repo, a, b, c, d, e, mergedA, mergedB, mergedC, mergedE, sampled, merged, requested, run, next, first, log: logLines(box).slice(logStart) };
}
let played;
const scene = () => (played ??= play());

/** The first window after the mark: its log lines, and its open and close. */
function windowOf(s) {
  const open = s.log.findIndex(({ event }) => event === 'window-open');
  const close = s.log.findIndex(({ event }) => event === 'window-close');
  assert.ok(open >= 0 && close > open, `the throttle log has no window-open before a window-close\n${dump(box, s.run)}`);
  return { open, close, opened: Date.parse(s.log[open].at), closed: Date.parse(s.log[close].at) };
}

test('#1116.dead61b9 a planted 2× regression in one of three commits leaves only that issue open, naming that commit, with one budget follow-up', LONG, async () => {
  const s = await scene();
  const record = recordOf(box, s.mergedB);
  assert.equal(record?.state, 'FAIL', `the regressed commit's record\n${dump(box, s.run)}`);
  assert.equal(record.tests.find(({ id }) => id === TASK)?.state, 'FAIL', `the regressed budget's state: ${JSON.stringify(record)}`);
  for (const commit of [s.mergedA, s.mergedC]) assert.equal(recordOf(box, commit)?.state, 'PASS', `${commit} didn't pass\n${dump(box, s.run)}`);
  assert.equal(issue(box, PLAIN).state, 'CLOSED', `the first commit's issue stayed open\n${dump(box, s.run)}`);
  assert.equal(issue(box, LATE).state, 'CLOSED', `the commit merged after the regression has its issue open: it was measured against another base or on main's tree\n${dump(box, s.run)}`);
  const slow = issue(box, SLOW);
  assert.equal(slow.state, 'OPEN', `the regressed commit's issue was closed\n${dump(box, s.run)}`);
  const said = slow.comments.join('\n');
  assert.ok(said.includes(s.mergedB.slice(0, 7)), `the open issue doesn't name the commit ${s.mergedB}\n${dump(box, s.run)}`);
  assert.ok(said.includes(TASK), `the open issue doesn't name the regression, ${TASK}\n${dump(box, s.run)}`);
  // Exactly one, after both windows: a miss is never asked about twice.
  const filed = followUps(box);
  assert.equal(filed.length, 1, `follow-ups filed: ${JSON.stringify(filed)}`);
  const text = `${filed[0].title}\n${filed[0].body}`;
  assert.ok(/budget/i.test(text) && text.includes(`#${SLOW}`) && text.includes(s.mergedB.slice(0, 7)) && text.includes(TASK), `the follow-up doesn't name the budget, the issue and the commit: ${text}`);
});

test('#1116.5aa02a5a a commit merged during a window is measured in the next one, and till then its issue stays open', LONG, async () => {
  const s = await scene();
  assert.ok(s.sampled, `the window took no sample\n${dump(box, s.run)}`);
  const { opened, closed } = windowOf(s);
  assert.ok(s.merged > opened && s.merged < closed, `the fixture's commit landed outside the window: ${s.merged}, ${opened} to ${closed}\n${dump(box, s.run)}`);
  for (const commit of [s.d, s.mergedE]) assert.ok(!s.first.records.some((record) => record.commit === commit), `${commit} has a record from the window it merged in\n${dump(box, s.run)}`);
  assert.ok(!s.first.samples.some(({ tags }) => tags.includes('d') || tags.includes('e')), `the window sampled a commit merged during it\n${dump(box, s.run)}`);
  assert.deepEqual(s.first.issues, { [NEXT]: 'OPEN', [UNPROVEN]: 'OPEN' }, `an unmeasured commit's issue left open: ${dump(box, s.run)}`);

  const record = recordOf(box, s.d);
  assert.equal(record?.state, 'PASS', `the next window didn't measure ${s.d}\n${dump(box, s.next)}`);
  assert.equal(record.base, s.mergedC, `a commit straight on main is measured against its parent\n${JSON.stringify(record)}`);
  assert.equal(issue(box, NEXT).state, 'CLOSED', `the next window's pass didn't close the issue\n${dump(box, s.next)}`);
  // The next window measures only what's new: one record a commit, and nothing of the three again.
  const all = records(box).map(({ commit }) => commit);
  assert.deepEqual([...all].sort(), [s.mergedA, s.mergedB, s.mergedC, s.d, s.mergedE].sort(), `the records after two windows\n${dump(box, s.next)}`);
});
