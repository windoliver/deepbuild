// #3549 criterion 5 (#3549.7ba8246d), its first two sentences: with a timed request pending, no build is admitted
// and no turn is dealt; with a timed grant held, no build outside its chain runs. Each reads as on the merge base. The
// timed request is a plain one, asked under a test grant of the test's own, since a top-level one also waits for the
// machine's load below its cores, which a test can't set; it waits on a test grant outside its chain until the test
// lets that end. That it is pending is read from what it does: a top-level bay-pair request with no wait is refused.
import assert from 'node:assert/strict';
import test from 'node:test';
import { THROTTLE, build, drains, dump, ended, endOf, finish, go, probe, refused, running, sandbox, startOf, stepOf, steps, stub, throttle, until } from './helpers.mjs';

/** The chain, whose command asks `throttle.mjs timed --wait 10 -- <command>` at its go file, and the grant outside it. */
function scene(box, command) {
  const chain = throttle(box, 'test', ['--wait', '0.1'], stub(box, 'chain', 'drive', steps(box, 'chain', [{ go: 'timed', argv: [process.execPath, THROTTLE, 'timed', '--wait', '10', '--', ...command] }])));
  const blocker = throttle(box, 'test', ['--wait', '0.1'], stub(box, 'blocker', 'hold'));
  return [chain, blocker];
}
/** Asks for timed and waits until the request stands pending, never granted while the grant outside its chain is held. */
async function pending(box, chain, all) {
  go(box, 'timed');
  const refusing = await drains(box, { halted: () => Boolean(startOf(box, 'timed')) || !running(chain) });
  assert.equal(startOf(box, 'timed'), undefined, `the timed request was granted while a test grant outside its chain was held: nothing made it wait\n${all()}`);
  assert.ok(refusing, `the timed request never stood pending: no top-level bay-pair request with a wait of 0 was refused\n${all()}`);
}
/** A build asked with no wait, which must be refused at once: `when` says under what. */
async function turnedAway(box, name, when, all) {
  const child = build(box, name, ['exit'], '0');
  await until(() => startOf(box, name) || !running(child), 60_000);
  assert.equal(startOf(box, name), undefined, `the build request ${child.named} started ${when}\n${all()}`);
  assert.ok(refused(child), `the build request ${child.named}, asked with a wait of 0 ${when}, wasn't refused at once, with exit 3 and INCONCLUSIVE no grant: ${running(child) ? 'it still waits, admitted or in line' : `it ended with ${child.status}`}\n${all()}`);
}

test('#3549.7ba8246d with a timed request pending no build is admitted, with the timed grant held no build outside its chain runs while one inside it does, and the build that waited starts once the grant goes back', { timeout: 10 * 60_000 }, async (t) => {
  const box = sandbox(t, { cores: 5 });
  // The timed command asks for a build of its own at its go file: a request inside the grant's chain.
  const inside = steps(box, 'timed', [{ go: 'inside', argv: [process.execPath, THROTTLE, 'build', '--wait', '0', '--', ...stub(box, 'inside', 'exit')] }]);
  const [chain, blocker] = scene(box, stub(box, 'timed', 'drive', inside));
  let outside = null;
  const all = () => dump(box, chain, blocker, outside);
  await until(() => (startOf(box, 'chain') && startOf(box, 'blocker')) || !running(chain) || !running(blocker), 120_000);
  assert.ok(startOf(box, 'chain') && startOf(box, 'blocker'), `the two test grants' commands never both started\n${all()}`);

  // Pending: no build is admitted, though the table holds no build and every token is free.
  await pending(box, chain, all);
  await turnedAway(box, 'refused-pending', 'while the timed request was pending', all);
  outside = build(box, 'outside', ['exit']);

  // The grant outside the chain ends: the timed request is granted, and its command holds the grant.
  finish(box, 'blocker');
  await until(() => startOf(box, 'timed') || !running(chain), 120_000);
  assert.ok(startOf(box, 'timed'), `the timed request wasn't granted once the test grant outside its chain had ended\n${all()}`);
  // Held: no build outside its chain runs, and one inside it does.
  await turnedAway(box, 'refused-held', 'while the timed grant was held, outside its chain', all);
  go(box, 'inside');
  await until(() => stepOf(box, 'timed', 0, 'answered') || !running(chain), 120_000);
  assert.ok(startOf(box, 'inside') && stepOf(box, 'timed', 0, 'answered')?.status === 0, `the build request inside the timed grant's chain didn't run (it ended with ${stepOf(box, 'timed', 0, 'answered')?.status})\n${all()}`);
  assert.equal(startOf(box, 'outside'), undefined, `the build request ${outside.named}, outside the timed grant's chain, ran before the grant went back\n${all()}`);
  assert.ok(running(outside), `the build request ${outside.named} left the line within its 10 min wait (exit ${outside.status})\n${all()}`);

  // The grant goes back: the build that waited is admitted and runs.
  finish(box, 'timed');
  await until(() => startOf(box, 'outside') || !running(outside), 120_000);
  const [taken, over] = [startOf(box, 'outside'), endOf(box, 'timed')];
  assert.ok(taken && over && taken.at >= over.at, `the build request ${outside.named} didn't start once the timed grant had gone back (its start: ${taken?.at}; the timed command's end: ${over?.at})\n${all()}`);
  assert.equal(await ended(outside, 120_000), 0, `the build request ${outside.named} didn't end with 0\n${all()}`);
  finish(box, 'chain');
  assert.equal(await ended(chain, 120_000), 0, `the chain didn't end with 0\n${all()}`);
});

test('#3549.7ba8246d with a timed request pending no turn is dealt: an admitted build that waits for the one token of the pool is not given it when it frees, and starts once the timed request is over', { timeout: 10 * 60_000 }, async (t) => {
  // A pool of one token (a core less one of two).
  const box = sandbox(t, { cores: 2 });
  const holder = build(box, 'holds-the-token', ['hold'], '0.1');
  const [chain, blocker] = scene(box, stub(box, 'timed', 'exit'));
  let waits = null;
  const all = () => dump(box, holder, chain, blocker, waits);
  await until(() => ['holds-the-token', 'chain', 'blocker'].every((name) => startOf(box, name)) || [holder, chain, blocker].some((child) => !running(child)), 120_000);
  assert.ok(['holds-the-token', 'chain', 'blocker'].every((name) => startOf(box, name)), `the build that holds the pool's token, or one of the two test grants' commands, never started\n${all()}`);

  // A second build asks: admitted, it waits for the token. Two requests asked after it, one after the other, each run
  // to its end before the timed request is asked: time enough for a build's admission.
  waits = build(box, 'waits-its-turn', ['exit']);
  for (let k = 0; k < 2; k++) assert.ok((await probe(box)).ran, `a top-level bay-pair request didn't run on a table that holds no bay pair and no timed request\n${all()}`);
  assert.equal(startOf(box, 'waits-its-turn'), undefined, `the build ${waits.named} started beside the build that holds the pool's one token: it took no turn, so no turn can be shown withheld\n${all()}`);
  assert.ok(running(waits), `the build ${waits.named} left the line within its 10 min wait (exit ${waits.status})\n${all()}`);

  // The timed request is pending when the token frees. Three more requests are refused, one after the other, before
  // the grant it waits on ends: time enough for a turn dealt on the freed token to start its command.
  await pending(box, chain, all);
  finish(box, 'holds-the-token');
  assert.equal(await ended(holder, 120_000), 0, `the build that held the pool's token didn't end with 0\n${all()}`);
  for (let k = 0; k < 3; k++) assert.ok((await probe(box)).refused, `the timed request no longer stood pending, though the test grant outside its chain is still held\n${all()}`);
  assert.equal(startOf(box, 'timed'), undefined, `the timed request was granted while a test grant outside its chain was held\n${all()}`);
  assert.equal(startOf(box, 'waits-its-turn'), undefined, `the admitted build ${waits.named} was dealt the freed token while the timed request was pending\n${all()}`);

  // The grant outside the chain ends: the timed request is granted, its command runs and ends, and then the turn is dealt.
  finish(box, 'blocker');
  await until(() => startOf(box, 'waits-its-turn') || !running(waits), 120_000);
  const [taken, over] = [startOf(box, 'waits-its-turn'), endOf(box, 'timed')];
  assert.ok(taken && over && taken.at >= over.at, `the admitted build ${waits.named} didn't start once the timed request was over (its start: ${taken?.at}; the timed command's end: ${over?.at})\n${all()}`);
  assert.equal(await ended(waits, 120_000), 0, `the build ${waits.named} didn't end with 0\n${all()}`);
  finish(box, 'chain');
  assert.equal(await ended(chain, 120_000), 0, `the chain didn't end with 0\n${all()}`);
});
