// #2975 AC1, AC2 and AC3: on the installed root a SIGTERM or SIGINT, sent by PID from a process that holds no
// confirmation, is a restart: the stop is recorded as signal:<name>, the hub exits 75 at once, and the login service
// starts it again (README: The surface).
import { test } from 'node:test';
import {
  CLI, LONG, NODE, assert, backAfter, events, exitOf, hello, killAs, launch, launchd, redact, runs, sandbox, startInstalled, stopsIn, until, wait,
} from './helpers.mjs';

/** The scene of AC1 and AC2: the installed hub, `kill -<signal>` to its PID, its exit, its return and the record. */
async function signalRestarts(t, signal) {
  const box = await sandbox(t);
  const first = await startInstalled(box);
  assert.equal(await killAs(box, signal, first.pid), 0, `BLOCKED: kill -${signal} ${first.pid} (the installed hub's PID, by hub.health) failed`);

  const exit = await until(() => exitOf(box, first.pid), 60_000);
  assert.ok(exit, `the installed hub (PID ${first.pid}) still ran 60 s after kill -${signal}`);
  assert.deepEqual({ code: exit.code, signal: exit.signal }, { code: 75, signal: null }, `after kill -${signal} the installed hub must exit 75 (RESTART_EXIT), a restart the login service undoes; it exited ${exit.code === null ? `on ${exit.signal}` : exit.code}`);

  const back = await backAfter(box, first.hello.start);
  const after = launchd(box).filter((e) => e.t > exit.t);
  assert.ok(back, `after kill -${signal} and its exit ${exit.code}, no hub answered hub.health with a new start ID within the login service's restart window (the stand-in's events since: ${redact(JSON.stringify(after), box)})`);
  assert.notEqual(back.pid, first.pid, 'the hub that answers after the signal must be a new process');
  assert.notEqual(back.hello.start, first.hello.start, 'the hub that answers after the signal must have a new start ID');
  assert.ok(after.some((e) => e.event === 'start' && e.pid === back.pid), `the login service (its stand-in) must be what started the new hub (PID ${back.pid}): ${redact(JSON.stringify(after), box)}`);

  const record = await events(box, { ms: 120_000 });
  assert.ok(record, 'BLOCKED: the new hub never answered events.read');
  assert.deepEqual(stopsIn(record).slice(first.stops.length), [`signal:SIG${signal}`], `the record must hold one stop since the first hub started, with reason signal:SIG${signal}`);
}

test('#2975.0cab1d79 on the installed root a kill -TERM from a process with no confirmation records signal:SIGTERM, exits 75, and the login service brings the hub back with a new PID and start ID', LONG, (t) => signalRestarts(t, 'TERM'));

test('#2975.8459f39f on the installed root a kill -INT records signal:SIGINT, exits 75, and the login service starts the hub again', LONG, (t) => signalRestarts(t, 'INT'));

test('#2975.20c7734e a SIGTERM to an installed hub listening for 1 s exits within 5 s: it does not wait out RESTART_AFTER_MS', LONG, async (t) => {
  const box = await sandbox(t);
  const starting = launch(box, [NODE, CLI, 'hub', 'start']);
  // The first hello is the socket listening; its PID is the job the login service's stand-in started.
  const up = await until(() => hello(box, { ms: 1000 }), 120_000, 20);
  const listened = Date.now();
  assert.ok(up, 'BLOCKED: the installed hub never answered its hello after deep hub start');
  const job = launchd(box).filter((e) => e.event === 'start').at(-1);
  assert.ok(job?.pid && runs(job.pid), 'BLOCKED: the login service\'s stand-in recorded no running job for the installed hub');
  await wait(Math.max(0, listened + 1000 - Date.now()));

  const sent = Date.now();
  process.kill(job.pid, 'SIGTERM');
  // Gone: its PID no longer runs, or the stand-in saw it exit, whichever is first (a zombie not yet reaped still runs).
  const gone = await until(() => {
    const exit = exitOf(box, job.pid);
    if (exit) return Math.min(exit.t, Date.now());
    return runs(job.pid) ? undefined : Date.now();
  }, 60_000, 20);
  await starting.done;
  assert.ok(gone, `the installed hub (PID ${job.pid}) still ran 60 s after a SIGTERM`);
  const took = gone - sent;
  t.diagnostic(`SIGTERM to exit: ${took} ms (hub listening ${sent - listened} ms when signalled)`);
  assert.ok(took <= 5000, `a SIGTERM to an installed hub listening for 1 s must end it within 5 s, so a logout isn't held up; it took ${took} ms`);
});
