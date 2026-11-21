// #1558's acceptance tests with a hub up (README): one `deep lease -- /bin/sh -c 'sleep 300 & echo $!; exit 3'` run in
// #1015's world (a temp home, the hub as a process, memory pressure pinned normal). AC1 reads `deep lease`'s own end:
// exit 3, under 5000 ms after its command exited, the leftover sleep still running. AC2 reads the record: the run's
// `cpu.slot` acquired once, not released while the sleep lives (with `deep lease` already gone), and released within
// 5 s of the sleep's SIGKILL, which only the hub's tick can then do.
//
// Safety: #1015's world (folders under /tmp/dh1015-*, the hub stopped by its PID after the file) and helpers.ts here
// (the sleep SIGKILLed by the PID its command printed, `deep lease` by its PID).
import { describe, expect, it } from 'vitest';
import { leaseRows, shownLeases, World, type LeaseRow } from '../1015/helpers.ts';
import { AC1, AC2, alive, EXIT_CODE, killSleep, leaseRun, RELEASE_MS, RETURN_MS, sleep, watch, type Returned } from './helpers.ts';

/** How long the lease is watched with `deep lease` gone and the sleep still running: six of the hub's ticks and more. */
const HELD_MS = 3000;

describe('#1558 with a hub up: `deep lease` ends with its command; the hub holds the slot until the group ends', () => {
  const world = new World({ pressure: 'normal' });
  let returned: Returned | undefined;
  let why: string | undefined;
  let returnedAt = 0;

  it(`${AC1} \`deep lease -- <cmd>\` returns within a second of \`<cmd>\` exiting, with \`<cmd>\`'s exit code, even when \`<cmd>\` left a child running: \`/bin/sh -c 'sleep 300 & echo $!; exit 3'\` returns 3 at once, the sleep still running`, async () => {
    await world.startHub();
    const run = leaseRun(world.env(), world.dir);
    ({ returned, why } = await watch(run));
    returnedAt = Date.now();
    console.log(`AC1 with a hub: ${returned ? `deep lease exited ${returned.code ?? returned.signal} ${returned.ms} ms after its command exited; the leftover sleep ${returned.sleep} ${returned.sleepRan ? 'still running' : 'gone'}` : why}`);
    expect(why, why).toBeUndefined();
    expect(returned!.code, `deep lease's exit code is its command's (${EXIT_CODE}); stderr: ${run.err().slice(0, 600)}`).toBe(EXIT_CODE);
    expect(returned!.ms, `deep lease returned ${returned!.ms} ms after its command exited`).toBeLessThan(RETURN_MS);
    expect(returned!.sleepRan, `the leftover sleep ${returned!.sleep} was still running when deep lease returned`).toBe(true);
  }, 600_000);

  it(`${AC2} With a hub up, the cpu slot the lease held is not released while the leftover child lives, and is released within 5 s of that child ending: the hub's tick, not the client, returns it`, async () => {
    // Only once `deep lease` has gone can a release be the hub's tick's rather than the client's.
    expect(why, `precondition: deep lease must have returned while the leftover sleep lived, so the client can't be what releases the slot; ${why}`).toBeUndefined();
    expect(returned?.sleepRan, `precondition: the leftover sleep ${returned?.sleep} was still running when deep lease returned`).toBe(true);
    const hub = world.hub!;
    await sleep(Math.max(0, returnedAt + HELD_MS - Date.now()));
    const sleepPid = returned!.sleep;
    const before = await leaseRows(hub);
    const stillRan = alive(sleepPid);
    const slots = before.filter((r) => r.kind === 'cpu.slot');
    console.log(`AC2 ${HELD_MS} ms after deep lease returned, the sleep ${stillRan ? 'running' : 'gone'}: ${shownLeases(before)}`);
    expect(stillRan, `the leftover sleep ${sleepPid} still runs ${HELD_MS} ms after deep lease returned`).toBe(true);
    expect(slots.length, `lease.acquired once for the run's cpu.slot: ${shownLeases(before)}`).toBe(1);
    const slot: LeaseRow = slots[0]!;
    expect(slot.released, `the cpu.slot is not released while the leftover sleep ${sleepPid} lives (deep lease gone ${HELD_MS} ms): ${shownLeases(before)}`).toBeUndefined();

    const killedAt = Date.now();
    killSleep(sleepPid);
    let released: LeaseRow | undefined;
    // Watched past the limit, so a late release is measured rather than only missed.
    while (Date.now() - killedAt < RELEASE_MS + 10_000) {
      released = (await leaseRows(hub)).find((r) => r.id === slot.id && r.released !== undefined);
      if (released) break;
      await sleep(100);
    }
    const ms = released ? Date.now() - killedAt : undefined;
    console.log(`AC2 the cpu.slot ${released ? `released about ${ms} ms after the sleep's SIGKILL` : `still not released ${RELEASE_MS + 10_000} ms after the sleep's SIGKILL`}`);
    expect(released, `lease.released for the cpu.slot within ${RELEASE_MS} ms of the leftover sleep's SIGKILL, with deep lease long gone, so the hub's tick returned it: ${shownLeases(await leaseRows(hub))}`).toBeDefined();
    expect(ms!, `the cpu.slot was released ${ms} ms after the leftover sleep's SIGKILL`).toBeLessThan(RELEASE_MS);
    const after = await leaseRows(hub);
    expect(after.filter((r) => r.kind === 'cpu.slot').length, `still lease.acquired once for the cpu.slot: ${shownLeases(after)}`).toBe(1);
  }, 120_000);
});
