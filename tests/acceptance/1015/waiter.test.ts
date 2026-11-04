// #1015 AC4: a waiting `deep lease` killed with SIGTERM, as an agent's tool timeout kills it, leaves no lease and no place
// in the queue within 2 s; and a command whose process group keeps running after its parent exits keeps its slot until
// the whole group has ended. The hub told 12 cores, so slow work holds at most 5 slots; five `deep lease` commands of
// one session hold them, two more sessions' commands wait, the first of them is killed, and a slot freed 2 s later
// goes to the second. Then `deep lease -- spawner`: its parent exits at once, its child (same group) runs on.
import { describe, expect, it } from 'vitest';
import {
  AC4, CARGO_TEST, claudeCall, folder, heldNow, leaseRows, LIMIT, mustFail, running, Session, shownLeases, sleep, slotsOf, terminateGroup, until,
  waitLines, World, type LeaseRow,
} from './helpers.ts';

const LEASED = `deep lease -- ${CARGO_TEST}`;

describe(`${AC4} a killed waiter leaves nothing behind, and a lease ends only with its whole process group`, () => {
  it(`${AC4} a waiting \`deep lease\` killed with SIGTERM leaves no lease and no place in the queue within 2 s: the slot freed next goes to the waiter behind it`, async () => {
    const w = new World();
    await w.startHub();
    const h = new Session(w, 'claude', folder(w, 'holder'));
    const k = new Session(w, 'claude', folder(w, 'killed'));
    const n = new Session(w, 'claude', folder(w, 'next'));
    try {
      await Promise.all([h, k, n].map((s) => s.begin()));
      const holders = await Promise.all(Array.from({ length: LIMIT }, (_, i) => claudeCall(h, LEASED, { cwd: folder(w, `h-${i + 1}`) })));
      expect(await until(() => holders.every((_, i) => w.started(`h-${i + 1}`)), 180_000), `the ${LIMIT} holders' commands run on the ${LIMIT} slots slow work may hold`).toBe(true);
      const killed = await claudeCall(k, LEASED);
      expect(await until(() => waitLines(killed.bash!.output()).length > 0 || Boolean(w.started(k.label)), 90_000), `the killed-to-be command waits and says so: ${JSON.stringify(killed.bash!.output())}`).toBe(true);
      expect(w.started(k.label), `with every slot slow work may hold taken, \`${LEASED}\` in ${k.label} waits`).toBeUndefined();
      const next = await claudeCall(n, LEASED);
      expect(await until(() => waitLines(next.bash!.output()).length > 0 || Boolean(w.started(n.label)), 90_000), `the next command waits behind it and says so: ${JSON.stringify(next.bash!.output())}`).toBe(true);
      await sleep(1000);

      // The agent's tool timeout: SIGTERM to the command's process group.
      const t0 = Date.now();
      terminateGroup(await killed.bash!.pid);
      await sleep(Math.max(0, t0 + 2000 - Date.now()));
      const at2s = heldNow(await leaseRows(w.hub!));
      w.go('h-1');
      const nextRan = await until(() => Boolean(w.started(n.label)), 120_000);
      const rows = await leaseRows(w.hub!);
      console.log(`AC4 killed waiter: leases of ${k.label} 2 s after SIGTERM: ${shownLeases(slotsOf(at2s, k))}; ${n.label} ${nextRan ? `started ${w.started(n.label)!.ms - t0} ms after the kill` : 'never started'}; every lease of ${k.label}: ${shownLeases(rows.filter((r) => slotsOf([r], k).length))}`);
      expect(slotsOf(at2s, k), `the killed waiter (session ${k.id}) must hold no lease 2 s after SIGTERM: ${shownLeases(at2s)}`).toEqual([]);
      expect(nextRan, `the slot freed 2 s after the kill must go to the waiter behind the killed one (${n.label}); the killed waiter kept its place in the queue`).toBe(true);
      expect(rows.filter((r) => slotsOf([r], k).length && r.at >= t0).map((r) => r.id), `no lease is granted to the killed waiter after its SIGTERM`).toEqual([]);
      expect(w.started(k.label), `the killed waiter's command never runs`).toBeUndefined();
      w.go('all');
      await Promise.race([Promise.all([...holders, next].map((c) => c.after)), sleep(120_000)]);
    } finally {
      for (const s of [h, k, n]) s.stop();
      await w.stopHub();
    }
  }, 900_000);

  /** `deep lease -- spawner`: its parent exits at once and its child, in the same group, runs on until its go file. */
  async function groupLease(plant?: string): Promise<() => void> {
    const w = new World(plant ? { plant } : {});
    await w.startHub();
    const s = new Session(w, 'claude', folder(w, 'group'));
    try {
      await s.begin();
      const call = await claudeCall(s, 'deep lease -- spawner');
      expect(await until(() => w.stamps().some((x) => x.kind === 'P'), 120_000), `\`deep lease -- spawner\` runs: ${JSON.stringify(call.bash?.output())}`).toBe(true);
      const p = w.stamps().find((x) => x.kind === 'P')!;
      await until(() => !running(p.pid), 15_000, 50);
      const parentGone = Date.now();
      // While the child runs on, after its parent's exit: the session's slot, sampled for 6 s.
      const samples: { at: number; slots: LeaseRow[]; child: boolean }[] = [];
      while (Date.now() - parentGone < 6000) {
        samples.push({ at: Date.now() - parentGone, slots: slotsOf(heldNow(await leaseRows(w.hub!)), s), child: running(p.child!) });
        await sleep(500);
      }
      w.go(s.label);
      const childGone = await until(() => !running(p.child!), 30_000, 50);
      const released = await until(async () => slotsOf(heldNow(await leaseRows(w.hub!)), s).length === 0, 30_000, 250);
      console.log(`AC4 group ${plant ?? 'as built'}: parent ${p.pid}, child ${p.child}, group ${p.group}; slot held after the parent's exit: ${samples.map((x) => `+${x.at} ms ${x.slots.length ? 'held' : 'free'}${x.child ? '' : ' (child gone)'}`).join(', ')}; released after the group ended: ${released}`);
      await Promise.race([call.after, sleep(60_000)]);
      return () => {
        expect(samples.length, 'the slot is sampled while the child runs').toBeGreaterThan(0);
        expect(samples[0]!.child, `pid ${p.child} of process group ${p.group} runs on after its parent exits: nothing may stop it`).toBe(true);
        for (const x of samples.filter((y) => y.child)) {
          expect(x.slots.length, `process group ${p.group}: pid ${p.child} still ran ${x.at} ms after its parent ${p.pid} exited, so the command's slot must still be held; it was released early`).toBeGreaterThanOrEqual(1);
        }
        expect(childGone, `the group's last process ends on its go file`).toBe(true);
        expect(released, `process group ${p.group} ended, so its slot is released (on the supervisor's proof)`).toBe(true);
      };
    } finally {
      s.stop();
      await w.stopHub();
    }
  }
  it(`${AC4} a command whose process group keeps running after its parent exits keeps its slot until the whole group has ended`, async () => {
    (await groupLease())();
  }, 600_000);
  it(`${AC4} (wrong program) a release on the parent's exit (DEEP_HUB_PLANT=releases-on-parent-exit) frees the slot early and fails this test, naming the group`, async () => {
    const judged = await groupLease('releases-on-parent-exit');
    await mustFail('releases-on-parent-exit', judged, ['process group']);
  }, 600_000);
});
