// #3549 criterion 1 (#3549.b6b01435): on a test's own table with a pool of 4 tokens, one stub build that runs for
// 400 s is under way and a second, of 40 s, asks 30 s later. The second ends within 60 s of asking. On the merge base
// it starts only when the first has ended, and a planted throttle that serves top-level builds one at a time fails,
// naming the second build. Each build is `throttle.mjs build -- node stub.mjs <name> sleep <s>`. The second test
// holds the issue's Scope beside it: an admitted build waits for a turn with no wait limit, asked through
// scripts/lease too, and its command gets a jobserver of its own.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build, clock, copyScripts, dump, ended, endOf, finish, log, refused, running, sandbox, since, start, startOf, stub, throttle, until } from './helpers.mjs';

const POOL = 4;
// The criterion's numbers.
const FIRST_S = 400, SECOND_S = 40, LATER_MS = 30_000, WITHIN_MS = 60_000;

/**
 * What a top-level build's command is given (Scope, A turn; section 6): a build grant of its own, which the log shows
 * granted, and a jobserver of its own, a named pipe through CARGO_MAKEFLAGS. Returns the grant's ID and the pipe.
 */
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

test('#3549.b6b01435 on a pool of 4 tokens a second stub build of 40 s, asked 30 s after one of 400 s, ends within 60 s of asking, each under a jobserver of its own, and with four builds under way a fifth waits for one to end', { timeout: 8 * 60_000 }, async (t) => {
  // The pool is a core less one of the table's readings (section 6). The load reads above the cores, as on the Mac
  // the issue names: a build's admission doesn't read it.
  const box = sandbox(t, { cores: POOL + 1, load: 50 });
  const first = build(box, 'first', ['sleep', String(FIRST_S)]);
  let second = null;
  const more = [];
  const all = () => dump(box, first, second, more);
  await until(() => startOf(box, 'first') || !running(first), 120_000);
  assert.ok(startOf(box, 'first') && running(first), `the first build, ${first.named}, never got under way\n${all()}`);
  // deadline: the criterion's schedule, the second build asks 30 s after the first.
  await clock(first.asked + LATER_MS);
  second = build(box, 'second', ['sleep', String(SECOND_S)]);
  // deadline: the criterion's bound, 60 s from the second build's asking.
  await until(() => !running(second), second.asked + WITHIN_MS - Date.now());

  const zero = first.asked, begun = startOf(box, 'second');
  const state = running(second) ? 'had not ended' : `ended at ${since(zero, second.ended)}, ${((second.ended - second.asked) / 1000).toFixed(1)} s after asking`;
  const timeline = [
    `the first build asked at +0 s and its command started at ${since(zero, startOf(box, 'first').at)}; ${endOf(box, 'first') ? `it ended at ${since(zero, endOf(box, 'first').at)}` : `it was still under way ${WITHIN_MS / 1000} s after the second asked`}`,
    `the second build asked at ${since(zero, second.asked)}; its command ${begun ? `started at ${since(zero, begun.at)}` : 'had not started'}; it ${state}`,
  ].join('\n');
  t.diagnostic(timeline);
  // deadline: the criterion's 60 s, from the second build's asking to its end, on this process's clock.
  assert.ok(!running(second) && second.ended - second.asked <= WITHIN_MS, `the second build, ${second.named}, ${state}: not within ${WITHIN_MS / 1000} s of asking. It waited behind the first, of ${FIRST_S} s\n${timeline}\n${all()}`);
  assert.equal(second.status, 0, `the second build, ${second.named}, exited ${second.status}\n${all()}`);
  assert.equal(endOf(box, 'second')?.slept, true, `the second build's command didn't run its ${SECOND_S} s\n${all()}`);
  assert.ok(running(first) && !endOf(box, 'first'), `the first build wasn't under way all the while, so the second never ran beside it\n${all()}`);

  // Each took a turn: a grant of its own in the log, and a jobserver of its own.
  const turns = [turnOf(box, 'first', all), turnOf(box, 'second', all)];
  assert.notEqual(turns[0].id, turns[1].id, `the two builds ran under one grant, ${turns[0].id}\n${all()}`);
  assert.notEqual(turns[0].pipe, turns[1].pipe, `the two builds were given one jobserver, not one each: ${turns[0].pipe}\n${all()}`);

  // The line is in force on this table: with four builds under way, the first among them, a fifth doesn't start (past
  // the ceiling of 4 on the Mac; with no token of the 4 free on the Linux machine) until one of them ends.
  const fillers = [1, 2, 3].map((k) => build(box, `filler-${k}`));
  more.push(...fillers);
  await until(() => fillers.every((_, k) => startOf(box, `filler-${k + 1}`)) || fillers.some((child) => !running(child)), 120_000);
  const under = fillers.filter((_, k) => startOf(box, `filler-${k + 1}`)).length;
  assert.equal(under, 3, `only ${under} of three more builds got under way beside the first on a pool of ${POOL} tokens\n${all()}`);
  const fifth = build(box, 'fifth', ['exit']);
  more.push(fifth);
  // Two requests asked after it, one after the other, each run to its end: time enough for a build that needn't wait.
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

test('#3549.b6b01435 on a pool of 1 token a build asked beside one under way, by throttle.mjs build and through scripts/lease, is admitted, waits for its turn past its own wait limit, and then runs under a jobserver of its own', { timeout: 6 * 60_000 }, async (t) => {
  // A pool of one token (a core less one of two). The load reads far above the cores: a build's admission doesn't read
  // it, and a second test grant does (section 6), which is what the witness below waits on.
  const box = sandbox(t, { cores: 2, load: 1000 });
  const copy = copyScripts(box);
  const holder = build(box, 'under-way', ['hold'], '0.1');
  const beside = throttle(box, 'test', ['--wait', '0.1'], stub(box, 'test-holder', 'hold'));
  let direct = null, leased = null, witness = null;
  const all = () => dump(box, holder, beside, direct, leased, witness);
  await until(() => (startOf(box, 'under-way') && startOf(box, 'test-holder')) || !running(holder) || !running(beside), 120_000);
  assert.ok(startOf(box, 'under-way') && startOf(box, 'test-holder'), `the build that holds the pool's one token, or the test grant's holder, never started\n${all()}`);

  // Each asks with a wait of 0.05 min, 3 s: its wait for admission. The script asks as a session's build does.
  direct = build(box, 'direct', ['exit'], '0.05');
  leased = start(box, [copy.lease, 'node', box.stub, 'leased', 'exit'], { env: { ...copy.env, DEEP_LEASE_WAIT: '0.05' }, label: 'scripts/lease node stub.mjs leased exit (DEEP_LEASE_WAIT=0.05)' });
  // A request asked after them whose own wait, 0.1 min, does run out: a second test grant, kept out by the load.
  witness = throttle(box, 'test', ['--wait', '0.1'], stub(box, 'witness', 'exit'));
  await ended(witness, 120_000);
  assert.ok(refused(witness) && !startOf(box, 'witness'), `the test request that was to wait out its 0.1 min behind a held test grant, at a load above the cores, didn't (exit ${witness.status}), so nothing shows the builds' 0.05 min had passed\n${all()}`);
  const asked = [['direct', direct], ['leased', leased]];
  for (const [name, child] of asked) {
    assert.equal(startOf(box, name), undefined, `the build \`${name}\`, ${child.named}, started beside the build that holds the pool's one token: it took no turn\n${all()}`);
    assert.ok(running(child), `the build \`${name}\`, ${child.named}, left the line while the pool's one token was held (exit ${child.status}): it wasn't admitted, or its turn had a wait limit\n${all()}`);
  }

  // The token goes back: each runs, one after the other, and neither read INCONCLUSIVE.
  finish(box, 'under-way');
  for (const [name, child] of asked) assert.equal(await ended(child, 120_000), 0, `the build \`${name}\`, ${child.named}, didn't run and end with 0 once the token went back\n${all()}`);
  const freed = endOf(box, 'under-way');
  const turns = asked.map(([name, child]) => {
    const begun = startOf(box, name);
    assert.ok(begun && freed && begun.at >= freed.at, `the build \`${name}\`, ${child.named}, didn't start once the build that held the token had ended (its start: ${begun?.at}; that build's end: ${freed?.at})\n${all()}`);
    assert.doesNotMatch(child.output(), /INCONCLUSIVE/, `the build \`${name}\`, ${child.named}, printed an INCONCLUSIVE line, though it was admitted\n${all()}`);
    return turnOf(box, name, all);
  });
  assert.notEqual(turns[0].pipe, turns[1].pipe, `the two builds were given one jobserver, not one each: ${turns[0].pipe}\n${all()}`);
});
