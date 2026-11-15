// #2067 scope / AC4 + design "Carried across sessions": release inheritance survives shared reuse.
import { afterEach, expect, it } from 'vitest';
import { clean, releaseRuns, start, world } from './fixture.ts';
import { CHECKS, Session, WORK_LINK, claimsOf, draftFor, itemTask, lastPos, lockedFor, receipt, replyText, settle, taskVerdicts, workItem } from '../325/helpers.ts';
import { CRITERIA, openPr, PR_URL } from '../325/scenarios.ts';
afterEach(clean, 60_000);

it('#2067 scope / AC4: another session on the same head keeps the inherited release failure BLOCKED', async () => {
  const otherIssue = 2068; // Fixture-only task: keep task ownership separate from shared check evidence.
  const r = await start(world({
    drafts: [2067, otherIssue].map((n) => draftFor(n, [{ text: CRITERIA.expired, check: CHECKS.expired }])),
    readings: [2067, otherIssue].map((n) => workItem(n, 'Expired tokens are accepted', [CRITERIA.expired])),
    files: {
      'src/release-state.js': 'module.exports = { ready: false };\n',
      'tests/release.test.js': "const test = require('node:test');\nconst assert = require('node:assert/strict');\ntest('release is ready', () => {\n  assert.equal(require('../src/release-state.js').ready, true);\n});\n",
    },
  }));
  const head = r.w.head();
  const branch = r.g('branch', '--show-current');
  // Lock B on the original base too, not on the already-fixed head where its fix check would pass.
  // Only this fixture's checkout moves; both PR claims below see the restored, identical head.
  r.g('checkout', '--quiet', '--detach', r.w.base);
  const s = new Session(r.w);
  await s.start();
  await s.typed(`Fix ${WORK_LINK(otherIssue)} and open a pull request, then stop.`);
  await s.read('src/auth.js');
  const locked = await settle(r.hub, (ev) => { const task = itemTask(ev, s); return !!task && lockedFor(ev, task).length > 0; }, 60_000);
  const task = itemTask(locked, s);
  expect(task, 'second session has its own issue task').toBeDefined();
  expect(lockedFor(locked, task!), 'second definition is locked before any claim').toHaveLength(1);
  for (const ref of [r.task, task!]) expect(lockedFor(locked, ref)[0]!.data.base_commit, 'both definitions pin the same original base').toBe(r.w.base);
  r.g('checkout', '--quiet', branch);
  expect(r.w.head()).toBe(head);
  expect(r.g('merge-base', head, r.w.main)).toBe(r.w.base);
  expect(s.id, 'two independent sessions, not two turns of one session').not.toBe(r.s.id);
  expect(task, 'separate task ownership').not.toBe(r.task);
  await s.edit('src/auth.js', 'note: 0', 'note: 1');
  await s.edit('src/auth.js', 'note: 1', 'note: 0');
  const ordinarySince = await lastPos(r.hub);
  await s.stop('Expired tokens are rejected.');
  const ordinary = await settle(r.hub, (ev) => taskVerdicts(ev, task!, ordinarySince).length > 0, 240_000);
  expect(taskVerdicts(ordinary, task!, ordinarySince).at(-1)?.data.outcome, 'B ordinary requirements pass before either PR claim').toBe('PASS');

  const first = await r.open();
  const runs = releaseRuns(first.events);
  const expectedTree = r.g('merge-tree', '--write-tree', head, r.w.main);
  const merged = runs.filter(({ started }) => {
    const commit = String(started.data.commit);
    return r.g('rev-parse', `${commit}^{tree}`) === expectedTree
      && r.g('show', '-s', '--format=%P', commit).split(' ').sort().join(' ') === [head, r.w.main].sort().join(' ');
  });
  expect(merged, 'one actual merged-head release run').toHaveLength(1);
  const base = runs.filter(({ started }) => started.data.commit === r.w.base);
  expect(base, 'one actual base comparison, not another head run').toHaveLength(1);
  expect(runs, 'one merged run and its base proof').toHaveLength(2);
  for (const run of runs) {
    expect(run.finished?.data.outcome, 'real release assertion fails on both commits').toBe('failed');
    expect(run.finished?.data.tests_run, 'release test really ran').toBe(1);
    expect(JSON.stringify(run.finished?.data.findings)).toMatch(/release is ready/);
  }
  console.log(`2067 cross-session first ${JSON.stringify({ session: r.s.id, claim: first.id, head, main: r.w.main, base: r.w.base, verdict: first.verdict.data, runs: runs.map((run) => ({ started: run.started.data, finished: run.finished?.data })) })}`);
  expect(first.verdict.data.outcome, 'control: first session is BLOCKED as inherited').toBe('BLOCKED');
  expect(JSON.stringify(first.verdict.data.reasons)).toMatch(/preflight.*inherited/i);

  // B does work with no net change to any input, then claims the same PR through its own hooks.
  await s.edit('src/auth.js', 'note: 0', 'note: 1');
  await s.edit('src/auth.js', 'note: 1', 'note: 0');
  const opened = await openPr(s, `Part of #${otherIssue}`);
  expect(opened.allowed, `second session's Part of is allowed: ${replyText(opened.before)}`).toBe(true);
  const since = await lastPos(r.hub);
  await s.stop(`Opened ${PR_URL} (Part of #${otherIssue}).`);
  const events = await settle(r.hub, (ev) => taskVerdicts(ev, task!, since).length > 0, 120_000);
  const made = claimsOf(events, task!, since).at(-1);
  const verdict = taskVerdicts(events, task!, since).at(-1);
  console.log(`2067 cross-session second record ${JSON.stringify({ session: s.id, task, claim: made, verdict, releaseRuns: releaseRuns(events).map((run) => ({ started: run.started.data, finished: run.finished?.data })) })}`);
  expect(made, 'second session made a fresh PR claim').toBeDefined();
  expect(made!.session, 'the new claim belongs to B, not A').toBe(s.id);
  expect(made!.id).not.toBe(first.id);
  expect(verdict, 'second claim reached a verdict, not a timeout').toBeDefined();
  expect(verdict!.data.claim).toBe(`claim:${made!.id}`);
  const change = await receipt(r.hub, `claim:${made!.id}`);
  expect(Array.isArray(change.checks), 'second public receipt exists').toBe(true);
  console.log(`2067 cross-session second ${JSON.stringify({ session: s.id, claim: made!.id, verdict: verdict!.data, checks: change.checks, releaseRuns: releaseRuns(events).map((run) => ({ run: run.started.data.run, commit: run.started.data.commit, outcome: run.finished?.data.outcome })) })}`);
  expect(verdict!.data.commit, 'B claims the same unchanged head').toBe(head);
  expect(r.w.head(), 'judging leaves the branch head unchanged').toBe(head);
  expect(r.g('rev-parse', 'main'), 'mainline is unchanged across claims').toBe(r.w.main);
  expect(r.g('status', '--porcelain'), 'no net input change').toBe('');
  expect.soft(verdict!.data.outcome, 'cross-session reuse preserves inherited BLOCKED, never FAIL or PASS').toBe('BLOCKED');
  expect.soft(JSON.stringify(verdict!.data.reasons), 'B still names inherited preflight').toMatch(/preflight.*inherited/i);
  expect.soft(releaseRuns(events).map((run) => run.started.data.run), 'unchanged head and base reuse the same release runs across sessions').toEqual(runs.map((run) => run.started.data.run));
}, 540_000);
