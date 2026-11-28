import assert from 'node:assert/strict';
import test from 'node:test';
import { build, clock, copyScripts, dump, ended, endOf, finish, log, refused, running, sandbox, since, start, startOf, stub, throttle, until } from '../3549/helpers.mjs';

const POOL = 4;
const FIRST_S = 400, SECOND_S = 40, LATER_MS = 30_000, WITHIN_MS = 60_000;
const SHORT = '0.05', LONG = '10', BOUND_MS = 60_000;

function turnOf(box, name, all) {
  const begun = startOf(box, name);
  const id = String(begun?.throttle).match(/^build:([0-9a-f]+)$/)?.[1];
  assert.ok(id, `the build \`${name}\` ran under no build grant of its own (its command's DEEP_THROTTLE: ${begun?.throttle})\n${all()}`);
  const entry = log(box).find((e) => e.event === 'granted' && e.id === id);
  assert.ok(entry?.class === 'build' && entry?.grant === 'top-level', `the log shows no top-level granted of class build for the build \`${name}\`'s grant ${id}: ${JSON.stringify(entry)}\n${all()}`);
  assert.match(String(begun.makeflags), /--jobserver-auth=fifo:\S+/, `the build \`${name}\` got no jobserver of its own, lent from the pool (its command's CARGO_MAKEFLAGS: ${begun.makeflags}): it took no turn\n${all()}`);
  assert.equal(begun.fifo, true, `the jobserver the build \`${name}\`'s CARGO_MAKEFLAGS names is no named pipe\n${all()}`);
  return { id, pipe: begun.makeflags };
}

const at = (box, child, event) => log(box).findIndex((e) => e.event === event && e.pid === child.pid);

test('#3549.b6b01435 on a pool of 4 tokens a second stub build of 40 s, asked 30 s after one of 400 s, ends within 60 s of asking, each under a jobserver of its own, and with four builds under way a fifth waits for one to end', { timeout: 8 * 60_000 }, async (t) => {
  const box = sandbox(t, { cores: POOL + 1, load: 50 });
  const first = build(box, 'first', ['sleep', String(FIRST_S)]);
  let second = null;
  const more = [];
  const all = () => dump(box, first, second, more);
  await until(() => startOf(box, 'first') || !running(first), 120_000);
  assert.ok(startOf(box, 'first') && running(first), `the first build, ${first.named}, never got under way\n${all()}`);
  await clock(first.asked + LATER_MS);
  second = build(box, 'second', ['sleep', String(SECOND_S)]);
  await until(() => !running(second), second.asked + WITHIN_MS - Date.now());

  const zero = first.asked, begun = startOf(box, 'second');
  const state = running(second) ? 'had not ended' : `ended at ${since(zero, second.ended)}, ${((second.ended - second.asked) / 1000).toFixed(1)} s after asking`;
  const timeline = [
    `the first build asked at +0 s and its command started at ${since(zero, startOf(box, 'first').at)}; ${endOf(box, 'first') ? `it ended at ${since(zero, endOf(box, 'first').at)}` : `it was still under way ${WITHIN_MS / 1000} s after the second asked`}`,
    `the second build asked at ${since(zero, second.asked)}; its command ${begun ? `started at ${since(zero, begun.at)}` : 'had not started'}; it ${state}`,
  ].join('\n');
  t.diagnostic(timeline);
  assert.ok(!running(second) && second.ended - second.asked <= WITHIN_MS, `the second build, ${second.named}, ${state}: not within ${WITHIN_MS / 1000} s of asking. It waited behind the first, of ${FIRST_S} s\n${timeline}\n${all()}`);
  assert.equal(second.status, 0, `the second build, ${second.named}, exited ${second.status}\n${all()}`);
  assert.equal(endOf(box, 'second')?.slept, true, `the second build's command didn't run its ${SECOND_S} s\n${all()}`);
  assert.ok(running(first) && !endOf(box, 'first'), `the first build wasn't under way all the while, so the second never ran beside it\n${all()}`);

  const turns = [turnOf(box, 'first', all), turnOf(box, 'second', all)];
  assert.notEqual(turns[0].id, turns[1].id, `the two builds ran under one grant, ${turns[0].id}\n${all()}`);
  assert.notEqual(turns[0].pipe, turns[1].pipe, `the two builds were given one jobserver, not one each: ${turns[0].pipe}\n${all()}`);

  const fillers = [1, 2, 3].map((k) => build(box, `filler-${k}`));
  more.push(...fillers);
  await until(() => fillers.every((_, k) => startOf(box, `filler-${k + 1}`)) || fillers.some((child) => !running(child)), 120_000);
  const under = fillers.filter((_, k) => startOf(box, `filler-${k + 1}`)).length;
  assert.equal(under, 3, `only ${under} of three more builds got under way beside the first on a pool of ${POOL} tokens\n${all()}`);
  const fifth = build(box, 'fifth', ['exit']);
  more.push(fifth);
  for (const k of [1, 2]) {
    const control = throttle(box, 'test', ['--wait', '0'], stub(box, `control-${k}`, 'exit'));
    more.push(control);
    assert.equal(await ended(control, 120_000), 0, `a test request on a table that holds no test grant didn't run: ${control.named}\n${all()}`);
  }
  assert.equal(startOf(box, 'fifth'), undefined, `the fifth build, ${fifth.named}, started beside four builds under way on a pool of ${POOL} tokens: nothing made it wait\n${all()}`);
  finish(box, 'filler-1');
  await until(() => startOf(box, 'fifth') || !running(fifth), 120_000);
  const [taken, freed] = [startOf(box, 'fifth'), endOf(box, 'filler-1')];
  assert.ok(taken && freed && taken.at >= freed.at, `the fifth build, ${fifth.named}, didn't start once one of the four had ended (its start: ${taken?.at}; that build's end: ${freed?.at})\n${all()}`);
});

test('#3549.b6b01435 #3660.a7f3d0fa on a pool of 1 token a build asked beside one under way, by throttle.mjs build and through scripts/lease, is admitted and waits for its turn on its own wait: with 0.05 min it ends INCONCLUSIVE at that wait with its command never started, and with 10 min it runs under a jobserver of its own once the token goes back', { timeout: 8 * 60_000 }, async (t) => {
  const box = sandbox(t, { cores: 2, load: 1000 });
  const copy = copyScripts(box);
  const holder = build(box, 'under-way', ['hold'], '0.1');
  const beside = throttle(box, 'test', ['--wait', '0.1'], stub(box, 'test-holder', 'hold'));
  const asked = [];
  let witness = null;
  const all = () => dump(box, holder, beside, asked.map(([, child]) => child), witness);
  await until(() => (startOf(box, 'under-way') && startOf(box, 'test-holder')) || !running(holder) || !running(beside), 120_000);
  assert.ok(startOf(box, 'under-way') && startOf(box, 'test-holder'), `the build that holds the pool's one token, or the test grant's holder, never started\n${all()}`);

  const lease = (name, wait) => start(box, [copy.lease, 'node', box.stub, name, 'exit'], { env: { ...copy.env, DEEP_LEASE_WAIT: wait }, label: `scripts/lease node stub.mjs ${name} exit (DEEP_LEASE_WAIT=${wait})` });
  const short = [['direct-short', build(box, 'direct-short', ['exit'], SHORT)], ['leased-short', lease('leased-short', SHORT)]];
  asked.push(...short);
  for (const [name, child] of short) {
    await until(() => !running(child), child.asked + BOUND_MS - Date.now());
    assert.ok(!running(child), `the build \`${name}\`, ${child.named}, asked with a wait of ${SHORT} min while the pool's one token was held, was still waiting ${BOUND_MS / 1000} s after asking: its wait for its turn ran past its own wait\n${all()}`);
    assert.ok(refused(child), `the build \`${name}\`, ${child.named}, didn't end at its wait as an admission timeout does, with exit 3 and INCONCLUSIVE no grant (exit ${child.status})\n${all()}`);
    assert.equal(startOf(box, name), undefined, `the build \`${name}\`, ${child.named}, started its command, though the pool's one token was held all its wait\n${all()}`);
    const [granted, timeout] = [at(box, child, 'granted'), at(box, child, 'timeout')];
    const admission = log(box)[granted];
    assert.ok(admission?.class === 'build' && admission?.grant === 'top-level', `the log shows no top-level granted of class build for the build \`${name}\`, ${child.named}: it wasn't admitted, so its timeout is its admission's, not its turn's: ${JSON.stringify(admission)}\n${all()}`);
    const out = log(box)[timeout];
    assert.ok(timeout > granted && out?.class === 'build' && Number(out?.wait) === Number(SHORT), `the log shows no timeout of class build with wait ${SHORT} after the build \`${name}\`'s granted: ${JSON.stringify(out)}\n${all()}`);
  }

  const long = [['direct', build(box, 'direct', ['exit'], LONG)], ['leased', lease('leased', LONG)]];
  asked.push(...long);
  witness = throttle(box, 'test', ['--wait', '0.1'], stub(box, 'witness', 'exit'));
  await ended(witness, 120_000);
  assert.ok(refused(witness) && !startOf(box, 'witness'), `the test request that was to wait out its 0.1 min behind a held test grant, at a load above the cores, didn't (exit ${witness.status}), so nothing shows the builds had waited longer than ${SHORT} min\n${all()}`);
  for (const [name, child] of long) {
    assert.equal(startOf(box, name), undefined, `the build \`${name}\`, ${child.named}, started beside the build that holds the pool's one token: it took no turn\n${all()}`);
    assert.ok(running(child), `the build \`${name}\`, ${child.named}, left the line while the pool's one token was held (exit ${child.status}), inside its wait of ${LONG} min\n${all()}`);
    const admission = log(box)[at(box, child, 'granted')];
    assert.ok(admission?.class === 'build' && admission?.grant === 'top-level', `the log shows no top-level granted of class build for the build \`${name}\`, ${child.named}, while it waited: it waits for its admission, not for its turn: ${JSON.stringify(admission)}\n${all()}`);
  }

  finish(box, 'under-way');
  for (const [name, child] of long) assert.equal(await ended(child, 120_000), 0, `the build \`${name}\`, ${child.named}, didn't run and end with 0 once the token went back\n${all()}`);
  const freed = endOf(box, 'under-way');
  const turns = long.map(([name, child]) => {
    const begun = startOf(box, name);
    assert.ok(begun && freed && begun.at >= freed.at, `the build \`${name}\`, ${child.named}, didn't start once the build that held the token had ended (its start: ${begun?.at}; that build's end: ${freed?.at})\n${all()}`);
    assert.doesNotMatch(child.output(), /INCONCLUSIVE/, `the build \`${name}\`, ${child.named}, printed an INCONCLUSIVE line, though it was admitted and its turn came inside its wait\n${all()}`);
    return turnOf(box, name, all);
  });
  assert.notEqual(turns[0].pipe, turns[1].pipe, `the two builds were given one jobserver, not one each: ${turns[0].pipe}\n${all()}`);
});
