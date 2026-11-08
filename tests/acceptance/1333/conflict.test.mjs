// #1333 AC4: a clean first run, five landings of which the second breaks a test and the third tidies the broken line, so
// a revert of the second conflicts; the attempt it starts changes nothing (README: The scenes).
import { test } from 'node:test';
import { BROKEN_SUM, LANDINGS, LONG, TIDIED_SUM, agentRuns, assert, asks, dump, land, originMain, sandbox, status, tick, watched } from './helpers.mjs';

test(`#1333.ed47bc1a a revert that conflicts starts an attempt and raises no ask; if that attempt ends with main still red, one ask is raised and landings stay paused`, LONG, async (t) => {
  const box = await sandbox(t);
  const fx = watched(box);
  const first = await tick(box, fx);
  for (let k = 1; k <= LANDINGS; k++) land(box, fx, k === 2 ? { files: { 'lib/sum.mjs': BROKEN_SUM }, closes: true } : k === 3 ? { files: { 'lib/sum.mjs': TIDIED_SUM } } : {});
  const head = originMain(fx), broken = fx.landings[1];
  // Ticks until an ask is raised, then one more: the attempt may run within a tick or between them.
  const ticks = [];
  for (let i = 0; i < 4 && asks(box).length === 0; i++) ticks.push(await tick(box, fx));
  ticks.push(await tick(box, fx));
  const after = await status(box, fx);
  const all = dump(box, first, ...ticks);
  // The conflict starts an attempt on the broken landing's issue.
  const attempts = agentRuns(box).filter(({ args, stdin }) => `${args.join(' ')}\n${stdin}`.includes(`#${broken.issue}`));
  assert.ok(attempts.length > 0, `the conflicting revert started no attempt on issue #${broken.issue}: no claude or codex run was told #${broken.issue}\n${all}`);
  // No ask before that attempt ended; once it ended with main still red, exactly one, naming the issue.
  const ends = Math.min(...attempts.map(({ end }) => end));
  const raised = asks(box);
  assert.deepEqual(raised.filter(({ t }) => t < ends).map(({ title }) => title), [], `an ask was raised before the attempt ended\n${all}`);
  assert.equal(raised.length, 1, `the attempt ended with main still red, and ${raised.length} asks were raised, not one: ${JSON.stringify(raised.map(({ title }) => title))}\n${all}`);
  assert.ok(`${raised[0].title}\n${raised[0].body}`.includes(`#${broken.issue}`), `the ask doesn't name issue #${broken.issue}: ${raised[0].title}\n${all}`);
  // Landings stay paused, and nothing landed.
  assert.equal(after.state, 'paused', `landings didn't stay paused with main still red: ${after.line}\n${all}`);
  assert.equal(originMain(fx), head, `something landed on main while it was red\n${all}`);
});
