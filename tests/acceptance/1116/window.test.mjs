// #1116: one real scene, as the issue's Proof asks: a fixture repository, three merged commits with a planted 2×
// regression in one, every slot of the sandbox's throttle held, and a real window run through `throttle.mjs window`,
// then the next window. Each test reads what the scene left. It runs once, on the first test's turn. #1116.dead61b9
// and #1116.5aa02a5a, which expect a close, run from tests/acceptance/1116-redraft-1874/ under #1874's rule.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { dump, ended, fileIssue, fullWindow, hold, holder, issue, LIMIT, logLines, LONG, marked, fixture, openWindow, recordOf, records, REGRESSED, samples, sandbox, started, TASK, until } from './helpers.mjs';

const PLAIN = 9101, SLOW = 9102, LATE = 9103, NEXT = 9104, UNPROVEN = 9105;
const box = sandbox({ after });
const agentClass = (line) => ['build', 'test', 'bay-pair'].includes(line.class);
const SLOTS = Object.entries(LIMIT).flatMap(([kind, count]) => Array.from({ length: count }, (_, k) => ({ kind, name: `holder-${kind}-${k}` })));

async function play() {
  const repo = fixture(box);
  for (const number of [PLAIN, SLOW, LATE, NEXT]) fileIssue(box, number);
  fileIssue(box, UNPROVEN, { proven: false });
  await marked(box, repo);

  // Three pull requests, each from its own fork point, and none the commit before its merge on main. a forked before
  // the mark. c forked before b merged, so main carries b's regression into c's merge, and c's own change has none.
  const a = repo.branch('a', repo.r0, PLAIN);
  const b = repo.branch('b', repo.r1, SLOW, { 'work.sh': REGRESSED });
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
const spanOf = (list) => ({ first: Math.min(...list.map(({ start }) => start)), last: Math.max(...list.map(({ end }) => end)) });
const sameTags = (tags) => ({ tags: seen }) => seen.join() === [...tags].sort().join();

test('#1116.8a08ae16 a window drains every slot before its first sample and reopens after its last', LONG, async () => {
  const s = await scene();
  assert.ok(s.sampled, `the window took no sample\n${dump(box, s.run)}`);
  const { first, last } = spanOf(s.first.samples);
  for (const { name } of SLOTS) {
    const end = holder(box, name, 'end');
    assert.ok(end, `${name} never ended\n${dump(box, s.run)}`);
    assert.ok(end.t < first, `${name} ran until ${end.t}, after the first sample at ${first}\n${dump(box, s.run)}`);
  }
  for (const kind of ['build', 'test', 'bay-pair']) {
    const begun = holder(box, `queued-${kind}`, 'start');
    assert.ok(begun, `a ${kind} asked for during the drain never started\n${dump(box, s.run)}`);
    assert.ok(begun.t > last, `a ${kind} started at ${begun.t}, before the last sample ended at ${last}\n${dump(box, s.run)}`);
  }
  // The same story by the throttle log, which the issue's Proof names.
  const { open, close, opened, closed } = windowOf(s);
  const before = s.log.slice(0, open).filter(agentClass);
  assert.equal(before.filter(({ event }) => event === 'granted').length, SLOTS.length, `every slot was to be held before the window\n${dump(box, s.run)}`);
  assert.equal(before.filter(({ event }) => event === 'released').length, SLOTS.length, `the window opened with a slot held\n${dump(box, s.run)}`);
  assert.deepEqual(s.log.slice(open, close).filter((line) => agentClass(line) && line.event === 'granted'), [], `a slot was granted inside the window\n${dump(box, s.run)}`);
  assert.ok(first >= opened, `a sample started at ${first}, before the log's window-open\n${dump(box, s.run)}`);
  assert.ok(last <= closed, `a sample ended at ${last}, after the log's window-close\n${dump(box, s.run)}`);
  assert.ok(s.log.slice(close).filter((line) => agentClass(line) && line.event === 'granted').length >= 3, `the window never reopened\n${dump(box, s.run)}`);
});

test('#1116.8e06730a three commits merged between windows get three records, each against its own merge base, with 20 samples a side', LONG, async () => {
  const s = await scene();
  const { repo } = s;
  assert.deepEqual(s.first.records.map(({ commit }) => commit).sort(), [s.mergedA, s.mergedB, s.mergedC].sort(), `the window's records aren't one per merged commit\n${dump(box, s.run)}`);
  const cases = [
    { commit: s.mergedA, tip: s.a, base: repo.r0, side: ['r0', 'a'], against: ['r0'] },
    { commit: s.mergedB, tip: s.b, base: repo.r1, side: ['r0', 'r1', 'b'], against: ['r0', 'r1'] },
    { commit: s.mergedC, tip: s.c, base: s.mergedA, side: ['r0', 'r1', 'a', 'c'], against: ['r0', 'r1', 'a'] },
  ];
  for (const { commit, tip, base, side, against } of cases) {
    const record = s.first.records.find((one) => one.commit === commit);
    assert.equal(record.base, base, `${commit}'s record names another base than its own merge base\n${dump(box, s.run)}`);
    assert.equal(record.tree, repo.tree(tip), `${commit}'s record names another tree than the one measured\n${JSON.stringify(record)}`);
    assert.ok(record.lane && record.host === hostname() && String(record.platform).startsWith(process.platform), `${commit}'s record isn't T9b's shape: ${JSON.stringify(record)}`);
    assert.ok(record.tests.some(({ id, state }) => id === TASK && state), `${commit}'s record has no state for ${TASK}: ${JSON.stringify(record)}`);
    // The samples' own evidence of the tree they ran on, not the record's word.
    for (const [name, tags] of [['change', side], ['merge base', against]]) {
      const taken = s.first.samples.filter(sameTags(tags)).length;
      assert.ok(taken >= 20, `${commit}'s ${name} side took ${taken} samples on the tree holding ${tags.join(', ')}, not 20\n${dump(box, s.run)}`);
    }
  }
});

test('a pass leaves its issue open while another of its criteria isn\'t proven', LONG, async () => {
  const s = await scene();
  assert.equal(recordOf(box, s.mergedE)?.state, 'PASS', `the commit was to pass\n${dump(box, s.next)}`);
  assert.equal(recordOf(box, s.mergedE).base, s.mergedC, `its merge base, with a commit landed on main since it forked\n${dump(box, s.next)}`);
  assert.equal(issue(box, UNPROVEN).state, 'OPEN', `a pass closed an issue with a criterion unproven\n${dump(box, s.next)}`);
});

test('#1116.96a59f57 an agent\'s build requested during a window starts within a minute of the window ending', LONG, async () => {
  const s = await scene();
  assert.ok(s.sampled, `the window took no sample\n${dump(box, s.run)}`);
  const { closed } = windowOf(s);
  const { last } = spanOf(s.first.samples);
  assert.ok(s.requested < closed, `the build was asked for after the window: ${s.requested}, ${closed}\n${dump(box, s.run)}`);
  const begun = holder(box, 'during-build', 'start');
  assert.ok(begun, `the build never started\n${dump(box, s.run)}`);
  assert.ok(begun.t > last, `the build started inside the window\n${dump(box, s.run)}`);
  assert.ok(begun.t - closed < 60_000, `the build started ${begun.t - closed} ms after the window ended\n${dump(box, s.run)}`);
});
