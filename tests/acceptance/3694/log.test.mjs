import assert from 'node:assert/strict';
import test from 'node:test';
import { dump, endedWithin, entryOf, plainTest, sandbox, startOf, tableLog, topLevelBuild } from './helpers.mjs';

function linesOfTheTurn(box, child, name, cls, all) {
  const granted = entryOf(box, child, 'granted');
  assert.ok(granted?.class === cls && granted.grant === 'top-level', `the log shows no top-level granted entry of class ${cls} for ${name}, ${child.named}: ${JSON.stringify(granted)}\n${all()}`);
  const entries = tableLog(box);
  const after = entries.slice(entries.findIndex((e) => e.event === 'granted' && e.id === granted.id));
  const turn = after.find((e) => e.event === 'turn' && e.run === granted.id);
  const released = turn && after.find((e) => e.event === 'released' && e.class === 'turn' && e.id === turn.id);
  return { granted, turn, released };
}

test('#3694.24a531af the log\'s granted line for a plain test request names its turn as an admitted build\'s does: it marks a run\'s admission as the build\'s does, and the turn dealt after it and that turn\'s release name its grant as run', { timeout: 4 * 60_000 }, async (t) => {
  const box = sandbox(t);
  const build = topLevelBuild(box, 'build', '1', 'exit');
  let plain = null;
  const all = () => dump(box, build, plain);
  assert.equal(await endedWithin(build, 120_000), 0, `the top-level build ${build.named} did not run and end with 0 on an empty table\n${all()}`);
  assert.ok(startOf(box, 'build'), `the top-level build's command never started\n${all()}`);
  const ofBuild = linesOfTheTurn(box, build, 'the admitted build', 'build', all);
  assert.ok(ofBuild.turn && ofBuild.released, `the admitted build's grant ${ofBuild.granted.id} has no turn line, or no released line of class turn, naming it as run, so there is nothing to read the plain request's lines against\n${all()}`);

  plain = plainTest(box, 'plain', '1');
  assert.equal(await endedWithin(plain, 120_000), 0, `the plain test request ${plain.named} did not run and end with 0 on a table that holds no test grant\n${all()}`);
  assert.ok(startOf(box, 'plain'), `the plain test request's command never started\n${all()}`);
  const ofPlain = linesOfTheTurn(box, plain, 'the plain test request', 'test', all);

  assert.deepEqual(ofPlain.granted.run, ofBuild.granted.run, `the granted line for the plain test request carries run ${JSON.stringify(ofPlain.granted.run)}, where an admitted build's carries ${JSON.stringify(ofBuild.granted.run)}: ${JSON.stringify(ofPlain.granted)}\n${all()}`);
  assert.ok(ofPlain.turn, `no turn line after the plain test request's granted line names its grant ${ofPlain.granted.id} as run, as the admitted build's turn line names the build's grant ${ofBuild.granted.id}\n${all()}`);
  assert.equal(ofPlain.turn.pid, plain.pid, `the turn line naming the plain request's grant was written by pid ${ofPlain.turn.pid}, not the plain request's ${plain.pid}, where the build's was the build's own\n${all()}`);
  if ('turn' in ofBuild.granted) {
    assert.equal(ofBuild.granted.turn, ofBuild.turn.id, `the admitted build's granted line names turn ${ofBuild.granted.turn}, not the turn ${ofBuild.turn.id} dealt to it\n${all()}`);
    assert.equal(ofPlain.granted.turn, ofPlain.turn.id, `the plain request's granted line names turn ${JSON.stringify(ofPlain.granted.turn)}, not the turn ${ofPlain.turn.id} dealt to it, as an admitted build's names its own\n${all()}`);
  }
  assert.ok(ofPlain.released, `no released line of class turn gives back the plain request's turn ${ofPlain.turn.id}, as one gives back the build's\n${all()}`);
});
