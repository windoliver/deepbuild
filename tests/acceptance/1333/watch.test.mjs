// #1333 AC1, AC2 and AC6 on one scene: a clean first run, then five landings of which the second breaks a test, then the
// scheduled ticks until the job's revert lands (README: The scenes).
import { after, before, test } from 'node:test';
import { writeFileSync } from 'node:fs';
import {
  BROKEN_SUM, FLAKY, LANDINGS, LONG, OTHER, SUM, SUM_ID, agentRuns, assert, asks, dump, events, ghCalls, gitIn, issue, land,
  namesCommit, onTree, originMain, pulls, sandbox, sha7, status, tick, watched,
} from './helpers.mjs';

let scene;
// The scene's sandbox is removed once every test of this file has read it.
const cleanups = [];
after(async () => { for (const cleanup of cleanups) await cleanup(); });
before(async () => {
  const box = await sandbox({ after: (cleanup) => cleanups.push(cleanup) });
  const fx = watched(box);
  const first = await tick(box, fx);
  const clean = events(box).length;
  for (let k = 1; k <= LANDINGS; k++) land(box, fx, k === 2 ? { files: { 'lib/sum.mjs': BROKEN_SUM }, closes: true } : {});
  const head = originMain(fx);
  // The hold keeps the run on the revert's tree waiting until landings read paused (README: The fixture).
  writeFileSync(box.env.T1333_HOLD, 'hold\n');
  const ticks = [];
  for (let i = 0; i < 4 && originMain(fx) === head; i++) ticks.push(await tick(box, fx, { poll: true, release: true }));
  scene = { box, fx, first, clean, head, ticks, after: await status(box, fx), broken: fx.landings[1] };
});

const all = () => dump(scene.box, scene.first, ...scene.ticks);

test(`#1333.f14d14bc a planted landing that breaks a test is named by the job within one schedule, and landings stop; a job that reports only that main is red fails, naming the missing landing`, LONG, () => {
  const { box, fx, clean, ticks, broken } = scene;
  assert.ok(clean > 0, `the first tick ran no lane on main, so there is no clean run to start from\n${all()}`);
  assert.ok(ticks.length > 0, `no tick ran after the five landings\n${all()}`);
  // Within one schedule: the first tick due after the break names its landing and its issue.
  assert.ok(namesCommit(ticks[0].stdout, broken.sha, `#${broken.issue}`),
    `the job named no landing: the first tick due after the break printed no line naming landing ${sha7(broken.sha)} (PR #${broken.pr}) with its issue #${broken.issue}\n${all()}`);
  // Named by bisection with the failing test alone: it ran on the landing and on the one before it, and nothing else ran
  // on a landing between the clean run and main's head.
  const runs = events(box).slice(clean);
  const [l1, l2] = fx.landings;
  assert.ok(runs.some((run) => run.test === 'sum' && run.ok && onTree(run.tags, l1)) && runs.some((run) => run.test === 'sum' && !run.ok && onTree(run.tags, l2)),
    `the job named the landing without running the failing test on it and on the landing before it\n${all()}`);
  const between = runs.filter((run) => run.tags.includes('l1') && !run.tags.includes('l5'));
  assert.deepEqual([...new Set(between.map((run) => run.test))], ['sum'], `the job ran more than the failing test on the landings since the last clean run\n${all()}`);
  assert.ok(!runs.some((run) => run.test === 'typecheck'), `the job ran a lane other than unit and lint\n${all()}`);
  // Landings stop: asked while the job ran, landings read paused before the revert landed.
  const polls = ticks.flatMap((run) => run.polls);
  assert.ok(polls.some((seen) => seen.state === 'paused'), `landings never read paused while main was red: ${JSON.stringify(polls.map(({ state, line }) => `${state}: ${line}`))}\n${all()}`);
});

test(`#1333.747cd5ee the revert lands, the issue reopens naming the failure, and landings resume, with no ask raised`, LONG, () => {
  const { box, fx, head, after, broken } = scene;
  const git = gitIn(fx.origin);
  const now = originMain(fx);
  assert.notEqual(now, head, `nothing landed on main after the break: the revert of ${sha7(broken.sha)} never landed\n${all()}`);
  // The revert: main's tree now differs from the broken head only by what the broken landing changed, undone.
  const changed = git('diff', '--name-only', head, now).split('\n').filter(Boolean).sort();
  assert.deepEqual(changed, ['lib/sum.mjs', 'tags/l2'], `main changed by more or less than the broken landing's own files\n${all()}`);
  assert.equal(git('show', `${now}:lib/sum.mjs`), git('show', `${broken.sha}^1:lib/sum.mjs`), `lib/sum.mjs on main isn't as it was before the break\n${all()}`);
  // It landed as the job's pull request, merged through gh.
  const merged = pulls(box).filter((pr) => pr.state === 'MERGED');
  assert.equal(merged.length, 1, `the revert didn't land as one pull request the job opened and merged: ${JSON.stringify(pulls(box))}\n${all()}`);
  // It landed when the failing test passed on it and nothing else changed: every test ran on the revert's tree and
  // passed, before the merge.
  const mergedAt = ghCalls(box).find(({ args }) => args[0] === 'pr' && args[1] === 'merge')?.t ?? 0;
  const onRevert = events(box).filter((run) => run.tags.includes('l5') && !run.tags.includes('l2') && run.t <= mergedAt);
  for (const test of ['sum', 'other', 'flaky']) {
    assert.ok(onRevert.some((run) => run.test === test && run.ok), `the revert landed before ${test === 'sum' ? `the failing test (${SUM})` : `the test ${test === 'other' ? OTHER : FLAKY}`} passed on it\n${all()}`);
  }
  assert.ok(!onRevert.some((run) => !run.ok), `a test failed on the revert, and it landed anyway\n${all()}`);
  // The issue reopens, naming the failure.
  const reopened = issue(box, broken.issue);
  assert.equal(reopened.state, 'OPEN', `issue #${broken.issue}, which the broken landing closed, wasn't reopened\n${all()}`);
  assert.ok(reopened.comments.some((comment) => comment.includes(SUM)), `issue #${broken.issue} names no failure: no comment holds "${SUM}" (${SUM_ID})\n${all()}`);
  // Landings resume, and no one was asked.
  assert.equal(after.state, 'open', `landings didn't resume once main was clean: ${after.line}\n${all()}`);
  assert.deepEqual(asks(box), [], `the job raised an ask on a revert that landed\n${all()}`);
});

test(`#1333.6c0af23f the job makes no model call and starts no hosted workflow`, LONG, () => {
  const { box } = scene;
  assert.deepEqual(agentRuns(box), [], `the job started an agent CLI\n${all()}`);
  assert.deepEqual(box.requests, [], `the job made an HTTP request through the proxy or a model endpoint\n${all()}`);
  const hosted = ghCalls(box).filter(({ args }) => ['workflow', 'run', 'cache'].includes(args[0]) || (args[0] === 'api' && args.some((arg) => /dispatches|\/actions\//.test(arg))));
  assert.deepEqual(hosted, [], `the job started or touched a hosted workflow\n${all()}`);
  // Not judged on nothing: the job ran, ran the failing test on the landings and called gh.
  assert.ok(scene.ticks.length > 0 && scene.ticks.every((run) => run.status === 0) && events(box).length > scene.clean && ghCalls(box).length > 0,
    `the job didn't run its course (a tick failed, or it ran no test after the landings, or never called gh), so nothing shows it works without a model\n${all()}`);
});
