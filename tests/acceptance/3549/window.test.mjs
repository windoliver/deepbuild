// #3549 criterion 5 (#3549.7ba8246d), its last sentence: a window opens only once every admitted build has ended.
// The window is `throttle.mjs window`, run from a copy of the whole scripts/ folder whose budget-window.mjs is a stub
// that notes its start, and asked under a test grant of the test's own, since a top-level one also waits for the
// machine's load below its cores, which a test can't set. That its request is pending is read from the throttle's own
// count of the requests in line (`throttle.mjs load`, section 6): a wait doesn't run down while a window is pending
// (section 12a), so a request with no wait would wait there, not be refused.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build, copyScripts, dump, ended, endOf, finish, go, inLine, log, probe, refused, running, sandbox, startOf, stepOf, steps, stub, throttle, until } from './helpers.mjs';

/** The chain: a test grant whose command asks `throttle.mjs window --wait 10` at its go file. */
const chained = (box, copy) => throttle(box, 'test', ['--wait', '0.1'], stub(box, 'chain', 'drive', steps(box, 'chain', [{ go: 'window', argv: [process.execPath, copy.throttle, 'window', '--wait', '10'] }])));
const opened = (box) => startOf(box, 'window') || log(box).find((e) => e.event === 'window-open');
/**
 * The window's request stands in line, by two samples one after the other, and the window has not opened while `held`
 * has not ended: time enough for a window that doesn't wait for that build to start its command.
 */
async function pending(box, chain, held, all) {
  for (let k = 0; k < 2; k++) {
    const seen = await inLine(box, (waiting) => waiting.timed >= 1, { stopped: () => Boolean(opened(box)) || !running(chain) });
    assert.equal(opened(box), undefined, `the window opened while the admitted build ${held.named} had not ended\n${all()}`);
    assert.ok(seen.at, `the window's request didn't stand in line while the admitted build ${held.named} had not ended: no sample of throttle.mjs load counted a timed request waiting\n${all()}`);
  }
}
/** The window opens, once `name`'s command has ended; the chain then ends with 0. */
async function opens(box, chain, name, held, all) {
  finish(box, name);
  await until(() => startOf(box, 'window') || !running(chain), 120_000);
  const [open, freed] = [startOf(box, 'window'), endOf(box, name)];
  assert.ok(open && freed && open.at >= freed.at, `the window didn't open once the admitted build ${held.named} had ended (the window's start: ${open?.at}; the build's end: ${freed?.at})\n${all()}`);
  assert.ok(log(box).some((e) => e.event === 'window-open'), `the log has no window-open entry for the window that opened\n${all()}`);
  await until(() => !running(held), 120_000);
  finish(box, 'chain');
  assert.equal(await ended(chain, 120_000), 0, `the chain the window was asked in didn't end with 0\n${all()}`);
}

test('#3549.7ba8246d a window opens only once an admitted build that is under way has ended', { timeout: 10 * 60_000 }, async (t) => {
  const box = sandbox(t, { cores: 5 });
  const copy = copyScripts(box);
  const holder = build(box, 'under-way', ['hold'], '0.1');
  const chain = chained(box, copy);
  const all = () => dump(box, holder, chain);
  await until(() => (startOf(box, 'under-way') && startOf(box, 'chain')) || !running(holder) || !running(chain), 120_000);
  assert.ok(startOf(box, 'under-way') && startOf(box, 'chain'), `the build, or the test grant's command, never started\n${all()}`);

  // The window is asked: its request stands in line while the build is under way, and opens once it has ended.
  go(box, 'window');
  await pending(box, chain, holder, all);
  await opens(box, chain, 'under-way', holder, all);
});

test('#3549.7ba8246d a window opens only once every admitted build has ended: one that waited for its turn when the window asked is dealt the token, runs and ends first', { timeout: 10 * 60_000 }, async (t) => {
  // A pool of one token (a core less one of two).
  const box = sandbox(t, { cores: 2 });
  const copy = copyScripts(box);
  const holder = build(box, 'holds-the-token', ['hold'], '0.1');
  const chain = chained(box, copy);
  let waits = null;
  const all = () => dump(box, holder, chain, waits);
  await until(() => (startOf(box, 'holds-the-token') && startOf(box, 'chain')) || !running(holder) || !running(chain), 120_000);
  assert.ok(startOf(box, 'holds-the-token') && startOf(box, 'chain'), `the build that holds the pool's token, or the test grant's command, never started\n${all()}`);

  // A second build asks: admitted, it waits for the token. Two requests asked after it, one after the other, each run
  // to its end before the window is asked: time enough for a build's admission.
  waits = build(box, 'waits-its-turn');
  for (let k = 0; k < 2; k++) assert.ok((await probe(box)).ran, `a top-level bay-pair request didn't run on a table that holds no bay pair and no timed request\n${all()}`);
  assert.equal(startOf(box, 'waits-its-turn'), undefined, `the build ${waits.named} started beside the build that holds the pool's one token: it took no turn, so no admitted build waits for one\n${all()}`);
  assert.ok(running(waits), `the build ${waits.named} left the line within its 10 min wait (exit ${waits.status})\n${all()}`);

  // The window's request is pending when the token frees. A window stops new grants but not turns (section 6, Drain):
  // the build admitted before it takes the token, and the window still waits while that build runs.
  go(box, 'window');
  await pending(box, chain, waits, all);
  finish(box, 'holds-the-token');
  await until(() => startOf(box, 'waits-its-turn') || opened(box) || !running(waits), 60_000);
  assert.equal(opened(box), undefined, `the window opened before the build ${waits.named}, admitted before the window asked, had had its turn: an admitted build had not ended\n${all()}`);
  assert.ok(startOf(box, 'waits-its-turn'), `the build ${waits.named}, admitted before the window asked, was never dealt the freed token while the window waited (exit ${waits.status})\n${all()}`);
  await pending(box, chain, waits, all);
  await opens(box, chain, 'waits-its-turn', waits, all);
});

test('#3549.7ba8246d a window does not open while an admitted build still waits for its turn: asked under the build that holds the one token of the pool, its request runs out its wait', { timeout: 10 * 60_000 }, async (t) => {
  // A pool of one token (a core less one of two). The load reads far above the cores: a build's admission doesn't read
  // it, and a second test grant does (section 6), which is what the witness below waits on.
  const box = sandbox(t, { cores: 2, load: 1000 });
  const copy = copyScripts(box);
  // The build that holds the token asks for the window itself, with a wait of 0.05 min, at its go file: the build that
  // waits can't have its turn before the window's request is over, so it can't end, and the window can't open.
  const holder = throttle(box, 'build', ['--wait', '0.1'], stub(box, 'holds-the-token', 'drive', steps(box, 'holds-the-token', [{ go: 'window', argv: [process.execPath, copy.throttle, 'window', '--wait', '0.05'] }])));
  const beside = throttle(box, 'test', ['--wait', '0.1'], stub(box, 'test-holder', 'hold'));
  let waits = null, witness = null;
  const all = () => dump(box, holder, beside, waits, witness);
  await until(() => (startOf(box, 'holds-the-token') && startOf(box, 'test-holder')) || !running(holder) || !running(beside), 120_000);
  assert.ok(startOf(box, 'holds-the-token') && startOf(box, 'test-holder'), `the build that holds the pool's token, or the test grant's holder, never started\n${all()}`);

  // A second build asks, with a wait of 0.05 min for its admission. A test request asked after it waits out its own
  // 0.1 min, kept out by the load: the build is still there, so it was admitted, and it waits for its turn.
  waits = build(box, 'waits-its-turn', ['exit'], '0.05');
  witness = throttle(box, 'test', ['--wait', '0.1'], stub(box, 'witness', 'exit'));
  await ended(witness, 120_000);
  assert.ok(refused(witness) && !startOf(box, 'witness'), `the test request that was to wait out its 0.1 min behind a held test grant, at a load above the cores, didn't (exit ${witness.status}), so nothing shows the build's 0.05 min had passed\n${all()}`);
  assert.equal(startOf(box, 'waits-its-turn'), undefined, `the build ${waits.named} started beside the build that holds the pool's one token: it took no turn, so no admitted build waits for one\n${all()}`);
  assert.ok(running(waits), `the build ${waits.named} left the line while the pool's one token was held (exit ${waits.status}): it wasn't admitted, so no admitted build waits for a turn\n${all()}`);

  // The test grant ends, so the window's request waits on no grant outside its chain but the admitted build's.
  finish(box, 'test-holder');
  assert.equal(await ended(beside, 120_000), 0, `the test grant's holder didn't end with 0\n${all()}`);
  go(box, 'window');
  await until(() => stepOf(box, 'holds-the-token', 0, 'answered') || opened(box) || !running(holder), 120_000);
  assert.equal(opened(box), undefined, `the window opened while the admitted build ${waits.named} still waited for its turn: an admitted build had not ended\n${all()}`);
  const answer = stepOf(box, 'holds-the-token', 0, 'answered');
  assert.ok(answer?.status === 3 && /^INCONCLUSIVE no grant: /m.test(holder.output()), `the window's request, asked with a wait of 0.05 min while an admitted build could not end, didn't run out its wait with exit 3 and INCONCLUSIVE no grant (it ended with ${answer?.status})\n${all()}`);
  assert.equal(startOf(box, 'waits-its-turn'), undefined, `the build ${waits.named} started while the build that asked for the window still held the pool's one token\n${all()}`);

  // The build that holds the token ends: the one that waited is dealt it, and runs.
  finish(box, 'holds-the-token');
  assert.equal(await ended(waits, 120_000), 0, `the build ${waits.named} didn't run and end with 0 once the pool's token went back\n${all()}`);
  const [taken, freed] = [startOf(box, 'waits-its-turn'), endOf(box, 'holds-the-token')];
  assert.ok(taken && freed && taken.at >= freed.at, `the build ${waits.named} didn't start once the build that held the token had ended (its start: ${taken?.at}; that build's end: ${freed?.at})\n${all()}`);
});
