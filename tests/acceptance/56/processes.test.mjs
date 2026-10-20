// #56: no process from the hub's process groups survives a cancel, SIGTERM, or kill -9 followed by
// a restart, in either build. Each hold runs the check fixture, which binds its leased port and
// leaves grandchildren in its process group; all of them ignore SIGTERM, SIGHUP and SIGINT.
// Run: node --test --test-concurrency=1 tests/acceptance/56/processes.test.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import {
  ATTEMPTS, assertNoLeases, busyPorts, CHECK, holdCheck, leases, living, request, setup, sleep, startHub, VARIANTS, waitFor, waitGone, within,
} from './helpers.mjs';

const ID = '#56.d29f38cc';
const GRANDCHILDREN = 2;

// Five sessions, each holding a hook on a check that hangs with two grandchildren. Waits until
// every check has bound its port and started its grandchildren, and checks they're all alive.
async function fiveHanging({ hub, fx }) {
  const holds = Array.from({ length: 5 }, (_, index) => holdCheck(hub.socket, fx.check(`s${index}`, ['hang'], GRANDCHILDREN)));
  for (const { handle } of holds) assert.ok('ack' in await within(handle.ack, 5000, 'an acknowledgement'), 'every hold is acknowledged');
  await waitFor(() => holds.every(({ key }) => fx.bound(key, 1) && fx.grandchildren(key, 1).length === GRANDCHILDREN), 15_000, 'every check to bind its port and start its grandchildren');
  for (const { marker, key } of holds) assert.ok(living(marker).length >= 1 + GRANDCHILDREN, `${key}'s check and grandchildren run before anything stops them`);
  return holds;
}

const aborted = (fx, id) => fx.extension().some((line) => line.event === 'aborted' && line.id === id);

for (const variant of VARIANTS) {
  test(`${ID} [${variant}] a cancel stops that session's check and its grandchildren, frees its lease, and touches no other session`, { timeout: 90_000 }, async (t) => {
    const env = await setup(t, variant);
    const { hub, fx, ports } = env;
    const holds = await fiveHanging(env);

    const cancel = await request(hub.socket, { op: 'cancel', session: 's0' });
    assert.deepEqual({ ok: cancel.ok, cancelled: cancel.cancelled }, { ok: true, cancelled: 1 }, `cancel names the one hold it cancelled: ${JSON.stringify(cancel)}`);
    const reply = await within(holds[0].handle.reply, 2000, "the cancelled hold's reply");
    assert.equal(reply.outcome, 'cancelled', JSON.stringify(reply));
    assert.deepEqual(await waitGone(holds[0].marker, 2000), [], 'no process of the cancelled hold survives the cancel');
    for (const { marker, key } of holds.slice(1)) assert.ok(living(marker).length >= 1 + GRANDCHILDREN, `a cancel of s0 leaves ${key} running`);
    const { held } = await leases(hub.socket);
    assert.equal(held.length, 4, `the cancelled hold's lease is free and the other four are held: ${JSON.stringify(held)}`);
    assert.ok(!held.some(({ session }) => session === 's0'), JSON.stringify(held));
    await waitFor(() => aborted(fx, holds[0].key), 2000, "the cancelled hold's extension signal to abort");

    for (const index of [1, 2, 3, 4]) assert.equal((await request(hub.socket, { op: 'cancel', session: `s${index}` })).cancelled, 1);
    for (const { handle } of holds.slice(1)) assert.equal((await within(handle.reply, 2000, 'a cancelled reply')).outcome, 'cancelled');
    assert.deepEqual(await waitGone(fx.run, 2000), [], 'no process of any cancelled hold survives');
    await assertNoLeases(hub.socket, ports);
    assert.deepEqual(await busyPorts(ports), [], 'nothing listens on a pool port any more');
    assert.ok(holds.every(({ key }) => aborted(fx, key)), `every hold's extension signal aborted: ${JSON.stringify(fx.extension())}`);
    assert.deepEqual(fx.problems(), [], 'no attempt ran without its port or on a port another attempt held');
  });

  test(`${ID} [${variant}] a check that passes or fails leaves none of its grandchildren behind, and a failing one is retried three times`, { timeout: 90_000 }, async (t) => {
    const { hub, fx, ports } = await setup(t, variant);
    const passing = holdCheck(hub.socket, fx.check('s0', ['pass'], GRANDCHILDREN));
    const failing = holdCheck(hub.socket, fx.check('s1', ['fail'], 1));
    const passed = await within(passing.handle.reply, 5000, 'the passing hold');
    const failed = await within(failing.handle.reply, 5000, 'the failing hold');
    assert.deepEqual({ outcome: passed.outcome, attempts: passed.attempts }, { outcome: 'pass', attempts: 1 }, JSON.stringify(passed));
    assert.deepEqual({ outcome: failed.outcome, attempts: failed.attempts }, { outcome: 'fail', attempts: ATTEMPTS }, `a check that always fails runs once and is retried three times: ${JSON.stringify(failed)}`);
    assert.equal(fx.starts(failing.key), ATTEMPTS, 'the failing check started exactly four times');
    assert.equal(fx.grandchildren(passing.key).length, GRANDCHILDREN, 'the passing check left grandchildren behind when it exited');
    assert.deepEqual(await waitGone(fx.run, 2000), [], 'no grandchild of an ended check survives it');
    await assertNoLeases(hub.socket, ports);
  });

  test(`${ID} [${variant}] SIGTERM to the hub stops every process it started, with an extension that ignores its abort signal still running`, { timeout: 90_000 }, async (t) => {
    const env = await setup(t, variant);
    const { hub, fx, ports } = env;
    await fiveHanging(env);
    process.kill(hub.pid, 'SIGTERM');
    const exit = await within(hub.exited, 5000, 'the hub to exit after SIGTERM').catch((error) => assert.fail(`${error.message}: an extension's open timer or promise must not keep the hub from stopping\nstderr:\n${hub.stderr()}`));
    assert.ok(exit, 'the hub exited');
    assert.deepEqual(await waitGone(fx.run, 2000), [], 'no process the hub started survives its SIGTERM');
    assert.deepEqual(await busyPorts(ports), [], 'nothing listens on a pool port any more');
  });

  test(`${ID} [${variant}] after kill -9, the restarted hub stops every process the killed hub started, and nothing it didn't start`, { timeout: 90_000 }, async (t) => {
    const env = await setup(t, variant, { extraPorts: 1 });
    const { hub, fx, ports, state, extra } = env;
    // A decoy: the same check fixture with the same kind of marker, started by the test, not the hub.
    const decoyCheck = fx.check('decoy', ['hang'], 1);
    const decoy = spawn(decoyCheck.argv[0], decoyCheck.argv.slice(1), { env: { ...process.env, PORT: String(extra[0]) }, detached: true, stdio: 'ignore' });
    decoy.unref();
    await waitFor(() => fx.bound(decoyCheck.key, 1) && fx.grandchildren(decoyCheck.key, 1).length === 1, 10_000, 'the decoy to start');
    const holds = await fiveHanging(env);

    process.kill(hub.pid, 'SIGKILL');
    await within(hub.exited, 5000, 'the killed hub to exit');
    await sleep(300);
    const orphans = holds.flatMap(({ marker }) => living(marker));
    assert.ok(orphans.length >= holds.length * (1 + GRANDCHILDREN), `kill -9 leaves the hub's processes running, so the restart is what must stop them: ${orphans.length} alive`);

    const restarted = await startHub(t, { variant, state, ports, extensionLog: fx.extensionLog });
    for (const { marker, key } of holds) assert.deepEqual(await waitGone(marker, 5000), [], `the restarted hub stops ${key}'s check and grandchildren`);
    assert.ok(living(decoyCheck.marker).length >= 2, 'a process the hub never started survives the restart, though it runs the same command');
    await assertNoLeases(restarted.socket, ports);
    assert.deepEqual(await busyPorts(ports), [], 'nothing listens on a pool port any more');

    const after = holdCheck(restarted.socket, fx.check('s9', ['pass']));
    assert.equal((await within(after.handle.reply, 5000, 'a hold after the restart')).outcome, 'pass', 'the restarted hub leases from the whole pool again');
    assert.deepEqual(fx.problems(), [], 'no attempt ran without its port or on a port another attempt held');
  });
}
