// AC4 #1338.b9228a01: "A hub with no members opens no port, and a planted hub that does fails, naming the port."
//
// maya's hub is told where to listen (`hub.listen`, any free port on 127.0.0.1) and has no project members. Neither it
// nor any process it started may listen on a TCP port, by lsof. So that a hub that never listens can't pass, the same
// hub must open one once a person is invited: until it does, the test reads BLOCKED. The planted hub that listens with
// no members (DEEP_HUB_PLANT=listen-without-members) must fail the same judgment, naming the port lsof finds.
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, invite, listening, sleep, SURFACE, world, type Listener } from './helpers.ts';

afterAll(cleanup, 60_000);

/** How long after its ready line a hub is given to open what it opens. */
const SETTLE_MS = 3000;

/** The criterion's judgment: a hub with no members listens on no TCP port; a failure names each port. */
function noPort(pid: number, ports: readonly Listener[]): void {
  if (ports.length) throw Error(`the hub (pid ${pid}) has no project members and listens on ${ports.map((p) => `port ${p.port} (${p.address}, pid ${p.pid})`).join(', ')}`);
}

describe('AC4 #1338.b9228a01 a hub with no members opens no port; a planted hub that does fails, naming the port', () => {
  it('AC4 #1338.b9228a01 a hub told where to listen opens no port with no members, and opens one once a person is invited', async () => {
    const w = await world();
    await sleep(SETTLE_MS);
    noPort(w.hub.pid, listening(w.hub.pid));
    await invite(w, 'bob');
    const deadline = Date.now() + 15_000;
    while (!listening(w.hub.pid).length && Date.now() < deadline) await sleep(200);
    if (!listening(w.hub.pid).length) throw Error('BLOCKED: the hub opens no port even with a person invited, so "no port without members" proves nothing yet');
  }, 300_000);

  it(`AC4 #1338.b9228a01 (wrong program) a hub that listens with no members (DEEP_HUB_PLANT=${SURFACE.plantListen}) fails, naming the port`, async () => {
    const w = await world({ plant: SURFACE.plantListen });
    await sleep(SETTLE_MS);
    const ports = listening(w.hub.pid);
    let failure: Error | undefined;
    try { noPort(w.hub.pid, ports); } catch (error) { failure = error as Error; }
    expect(failure, `the planted hub passed: lsof found no listening port on it or its processes`).toBeDefined();
    expect(ports.some((p) => failure!.message.includes(`port ${p.port}`)), `the failure names no port lsof found: ${failure!.message}`).toBe(true);
  }, 300_000);
});
