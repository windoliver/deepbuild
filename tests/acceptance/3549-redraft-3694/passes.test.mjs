import assert from 'node:assert/strict';
import test from 'node:test';
import { CEILING, GiB, THROTTLE, build, copyScripts, dump, ended, endOf, finish, go, log, readings, refused, running, sandbox, start, startOf, stepOf, steps, stub, throttle, until } from '../3549/helpers.mjs';
import { turnsOf } from './helpers.mjs';

test('#3549.c607aa63 with every build slot and every token of the pool held, a build request under a build grant of the caller and one under a test grant of the caller start at once on that grant, with no grant, turn or jobserver of their own', { timeout: 10 * 60_000 }, async (t) => {
  const box = sandbox(t, { cores: CEILING + 2 });
  const inner = (name) => [{ go: name, argv: [process.execPath, THROTTLE, 'build', '--wait', '0', '--', ...stub(box, name, 'exit')] }];
  const callers = [
    throttle(box, 'build', ['--wait', '0'], stub(box, 'build-caller', 'drive', steps(box, 'build-caller', inner('under-build')))),
    throttle(box, 'test', ['--wait', '0.1'], stub(box, 'test-caller', 'drive', steps(box, 'test-caller', inner('under-test')))),
  ];
  const held = [];
  const all = () => dump(box, callers, held);
  await until(() => (startOf(box, 'build-caller') && startOf(box, 'test-caller')) || callers.some((child) => !running(child)), 120_000);
  assert.ok(startOf(box, 'build-caller') && startOf(box, 'test-caller'), `the callers' commands never both started under their grants\n${all()}`);
  readings(box, { memory: 1024 * GiB, load: 0, cores: CEILING + 1 + turnsOf(box, 'test-caller') });

  let over = null;
  for (let k = 1; k <= CEILING + 1 && !over; k++) {
    const child = build(box, `held-${k}`, ['hold'], '0');
    held.push(child);
    await until(() => startOf(box, `held-${k}`) || !running(child), 120_000);
    if (!startOf(box, `held-${k}`)) over = child;
  }
  assert.ok(over && refused(over), `no build request was refused: ${held.filter((_, k) => startOf(box, `held-${k + 1}`)).length + 1} builds are held at once on a table whose ceiling is ${CEILING}, so starting at once shows nothing${over ? ` (${over.named} ended with ${over.status})` : ''}\n${all()}`);

  go(box, 'under-build');
  go(box, 'under-test');
  await until(() => ['build-caller', 'test-caller'].every((caller) => stepOf(box, caller, 0, 'answered')) || callers.some((child) => !running(child)), 120_000);
  for (const [cls, name, caller] of [['build', 'under-build', 'build-caller'], ['test', 'under-test', 'test-caller']]) {
    const begun = startOf(box, name), asked = stepOf(box, caller, 0, 'asked'), answer = stepOf(box, caller, 0, 'answered');
    const request = `the build request under the caller's ${cls} grant, \`throttle.mjs build --wait 0 -- node stub.mjs ${name} exit\` (throttle pid ${asked?.child})`;
    const token = startOf(box, caller).throttle;
    assert.match(String(token), new RegExp(`^${cls}:[0-9a-f]+$`), `the caller's command ran under no ${cls} grant (DEEP_THROTTLE ${token})\n${all()}`);
    assert.ok(begun, `${request} didn't start at once, with every build slot held: ${answer ? `it ended with ${answer.status}` : 'it still waits'}\n${all()}`);
    assert.equal(answer?.status, 0, `${request} ended with ${answer?.status}\n${all()}`);
    assert.equal(begun.throttle, token, `${request} doesn't hold its caller's grant ${token} (its command's DEEP_THROTTLE: ${begun.throttle})\n${all()}`);
    assert.ok(log(box).some((e) => e.event === 'passed' && e.class === 'build' && e.pid === asked.child && e.through === token), `the log shows no passed entry through the caller's grant ${token} for ${request}\n${all()}`);
    const own = log(box).filter((e) => e.pid === asked.child && ['granted', 'timeout', 'turn'].includes(e.event));
    assert.deepEqual(own, [], `the log shows a grant, a timeout or a turn of its own for ${request}\n${all()}`);
    const lent = startOf(box, caller).makeflags;
    assert.ok(begun.makeflags === null || begun.makeflags === lent, `${request} was given a jobserver of its own (CARGO_MAKEFLAGS ${begun.makeflags}; its caller's: ${lent}): it took a turn\n${all()}`);
  }
});

test('#3549.c607aa63 inside an admitted run whose job holds the one token of the pool, a command scripts/lease runs starts at once with no turn, while a build request of the run waits for its turn', { timeout: 10 * 60_000 }, async (t) => {
  const box = sandbox(t, { cores: 2 });
  const copy = copyScripts(box);
  const job = (cls, name, mode) => [process.execPath, copy.throttle, cls, '--wait', '30', '--', ...stub(box, name, mode)];
  const list = [
    { argv: job('test', 'holds-the-token', 'hold') },
    { go: 'waits', argv: job('build', 'waits-its-turn', 'exit') },
    { go: 'lint', argv: [copy.lease, 'node', box.stub, 'lint', 'exit'] },
  ];
  const run = start(box, [process.execPath, copy.throttle, 'test', '--wait', '1', '--', ...stub(box, 'run', 'drive', steps(box, 'run', list))], {
    env: { ...copy.env, DEEP_THROTTLE_RUN: '0' }, label: 'DEEP_THROTTLE_RUN=0 throttle.mjs test --wait 1 -- node stub.mjs run drive (the admitted run)',
  });
  const all = () => dump(box, run);
  await until(() => startOf(box, 'holds-the-token') || !running(run), 120_000);
  assert.ok(startOf(box, 'run') && startOf(box, 'holds-the-token'), `the run was never admitted, or its job never took the pool's token\n${all()}`);
  const token = startOf(box, 'run').throttle;
  assert.match(String(token), /^test:[0-9a-f]+$/, `the run's command ran under no test grant (DEEP_THROTTLE ${token})\n${all()}`);
  const passed = () => log(box).filter((e) => e.event === 'passed' && e.through === token);
  const turns = () => log(box).filter((e) => e.event === 'turn' && (e.run === token || `test:${e.run}` === token));

  go(box, 'waits');
  await until(() => passed().length >= 2 || !running(run), 120_000);
  assert.equal(passed().length, 2, `the run's build request never asked through the run's grant ${token}: the log shows ${passed().length} passed entries, not its job's and its own\n${all()}`);
  go(box, 'lint');
  await until(() => startOf(box, 'lint') || stepOf(box, 'run', 2, 'answered') || !running(run), 60_000);
  const lint = startOf(box, 'lint'), answer = stepOf(box, 'run', 2, 'answered');
  const request = `the command scripts/lease runs inside the admitted run, \`scripts/lease node stub.mjs lint exit\` (throttle pid ${stepOf(box, 'run', 2, 'asked')?.child})`;
  assert.ok(lint, `${request}, didn't start at once while the run's job held the pool's one token: ${answer ? `it ended with ${answer.status}` : 'it waits'}\n${all()}`);
  assert.equal(endOf(box, 'holds-the-token'), undefined, `the job that was to hold the pool's token had ended, so starting at once shows nothing\n${all()}`);
  assert.equal(startOf(box, 'waits-its-turn'), undefined, `the run's build request started while the run's job held the pool's one token: the pool made nothing wait, so starting at once shows nothing\n${all()}`);
  assert.equal(lint.throttle, token, `${request}, doesn't hold its run's grant ${token} (its command's DEEP_THROTTLE: ${lint.throttle})\n${all()}`);
  assert.equal(passed().length, 3, `the log shows no passed entry through the run's grant ${token} for ${request}\n${all()}`);
  assert.equal(turns().length, 1, `the log names ${turns().length} turns of the run, not the one its job holds: ${request}, took a turn\n${all()}`);
  const own = log(box).filter((e) => e.class === 'build' && ['granted', 'timeout'].includes(e.event));
  assert.deepEqual(own, [], `the log shows a build grant or timeout: ${request}, asked for a grant of its own\n${all()}`);

  finish(box, 'holds-the-token');
  await until(() => startOf(box, 'waits-its-turn') || !running(run), 120_000);
  const [taken, freed] = [startOf(box, 'waits-its-turn'), endOf(box, 'holds-the-token')];
  assert.ok(taken && freed && taken.at >= freed.at, `the run's build request didn't start once the pool's token went back (its start: ${taken?.at}; the job's end: ${freed?.at})\n${all()}`);
  await until(() => stepOf(box, 'run', 1, 'answered') || !running(run), 120_000);
  finish(box, 'run');
  assert.equal(await ended(run, 120_000), 0, `the run didn't end with 0\n${all()}`);
});
