// #2732: a hub stop that lands while the core's `init` is running, before it creates the job pool, must not leave
// `<root>/jobserver` behind; a stop after a ready start must go on removing it. Through a real dev hub
// (`deep hub run --root`), the `hub.stop` call on its socket, the hub process's exit and `<root>/jobserver`.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { answered, cleanup, ended, kind, logged, lstatOrNull, marked, marks, runHub, stopCall, world } from './helpers.ts';

afterEach(cleanup);

/** How long a stopped hub may take to exit: the hub gives its core's stop 20 s, its start can take longer under load. */
const EXIT_MS = 120_000;

describe("a hub's job pool pipe once its stop has finished", () => {
  it('#2732.86d07610 AC1: stopped while init is running, before it creates the job pool, the hub leaves no <root>/jobserver once it has exited', async () => {
    const w = world();
    const hub = runHub(w, true);
    const talk = await answered(w, hub);
    // The core's init has started and is held: the stop goes now, before init can reach the job pool.
    await marked(w, 'init-running', hub, 120_000);
    await stopCall(w, talk);
    const end = await ended(hub, EXIT_MS);
    const log = readFileSync(w.log, 'utf8');
    expect(end, `BLOCKED: the hub was still running ${EXIT_MS} ms after hub.stop:\n${log}`).toBeDefined();
    const seen = marks(w);
    const names = seen.map((m) => m.mark);
    const told = `marks ${JSON.stringify(names)}, exit ${end!.code ?? end!.signal}`;
    // The scene played as it should: the stop reached the core while its init ran, before the pool's pipe was made.
    expect(names, `BLOCKED: the stall gave up waiting for the stop (${told})`).not.toContain('gave-up');
    expect(names, `BLOCKED: the stop never reached the core (${told})`).toContain('stop-received');
    if (names.includes('started')) expect(names.indexOf('stop-received'), `BLOCKED: the core finished its init before the stop reached it (${told})`).toBeLessThan(names.indexOf('started'));
    for (const pool of seen.filter((m) => m.mark === 'pool')) expect(pool.stopSeen, `BLOCKED: the core made its job pool before the stop reached it (${told})`).toBe(true);
    const left = lstatOrNull(w.jobserver);
    expect(kind(left), `what is at ${w.jobserver} once the hub stopped during its init has exited (${told}); hub.log:\n${log}`).toBe('nothing');
  }, 240_000);

  it('#2732.9eef3fb9 AC2: stopped after a ready start, the hub still removes <root>/jobserver', async () => {
    const w = world();
    const hub = runHub(w);
    const talk = await answered(w, hub);
    await logged(w, '"ready":true', hub, 180_000);
    expect(kind(lstatOrNull(w.jobserver)), `BLOCKED: a ready hub has no job pool pipe at ${w.jobserver}`).toBe('a named pipe');
    await stopCall(w, talk);
    const end = await ended(hub, EXIT_MS);
    const log = readFileSync(w.log, 'utf8');
    expect(end, `BLOCKED: the hub was still running ${EXIT_MS} ms after hub.stop:\n${log}`).toBeDefined();
    expect(kind(lstatOrNull(w.jobserver)), `what is at ${w.jobserver} once the hub stopped after a ready start has exited (exit ${end!.code ?? end!.signal}); hub.log:\n${log}`).toBe('nothing');
  }, 300_000);
});
