// AC10: on the reference Mac, the live window's tree read through AppKit holds one node marked as a polite live region
// whose value is the last line, and the first criterion's run gives the same entries live as in the replica. If the
// platform can't be read, this criterion is BLOCKED, naming where it stopped.
//
// The live window is the real `deep-app` on a real hub in a temp HOME, read from outside its process through the
// Accessibility API (probe.swift), as #1459's identifier test reads it. The first criterion's run, live: an agent's
// session's page open in the app's window, the window in front, and an ask from that session opens, raised by the hub
// itself for the session's held `git push` (#1101's fixture push, the hub on the wall clock). The replica follows the
// same hub: a copy of its record taken before the ask, the same page open, and everything the hub appends fed to it
// in log order, each time once the hub has appended all of it: its log still before the ask, and after the ask its
// listing of the ask recorded and its log still (README, The fixtures: the live run; Readings 20). Nothing here passes
// without the tree: a machine that isn't a reference Mac, a missing permission, a locked session or a window that
// can't come to the front is BLOCKED.
import { afterAll, describe, expect, it } from 'vitest';
import { deep } from '../16/helpers.ts';
import { Agent, awaitRecord, held, PUSH } from '../1101/helpers.ts';
import { appBin, blocked, canReadWindows, cleanup, liveWorld, MIN, quiet, RealApp, referenceProblem, SECOND, settled, Stage } from './helpers.ts';
import { addedSince, axFlat, ID, liveTree, said, type AxNode } from './judges.ts';

afterAll(cleanup, 5 * MIN);

describe(`AC10 ${ID.live} the live window's tree holds the region, and a live run's entries are the replica's`, () => {
  it(`AC10 ${ID.live}: on the reference Mac, the live window's tree read through AppKit holds one node marked as a polite live region whose value is the last line, and the first criterion's run gives the same entries live as in the replica; BLOCKED, naming where it stopped, if the platform can't be read`, async () => {
    const machine = await referenceProblem();
    if (machine) blocked(`the live tree is read on the reference Mac, and this is ${machine}`);
    await canReadWindows();
    await appBin();
    const w = await liveWorld();
    const a = await Agent.start(w);
    const address = `session/${a.id}`;
    const live = await RealApp.launch(w.home);
    const stage = await Stage.on(w);
    try {
      // Session A's page, in the real window and in the replica.
      const opened = await deep(w.home, ['open', address], { timeoutMs: MIN });
      if (opened.code !== 0) blocked(`the platform can't be read: deep open ${address} didn't reach the real app (exit ${String(opened.code)}): ${opened.stderr.slice(-400)}`);
      const nodes = async (): Promise<AxNode[]> => (await live.tree()).flatMap((window) => axFlat(window));
      const shown = await settled(async () => ((await nodes()).some((n) => n.identifier === address) ? [] : [`the real window doesn't show ${address}`]), 30 * SECOND);
      if (shown.length) blocked(`the platform can't be read: ${shown.join('; ')} after deep open, so the first criterion's run can't be made live`);
      await stage.feedNew();
      await stage.d.open(address);
      await stage.d.wait(3 * SECOND);
      // The window in front: the key one.
      const front = await live.front();
      if (!front.front || !front.main) blocked(`the platform can't be read: the real app's window didn't come to the front (${said(front)}), so it isn't the key window`);
      // Whatever the hub wrote while the app started is the record before the ask, in the replica too: all of it, so
      // the feed waits for the hub's log to be still.
      await quiet(w.hub);
      await stage.feedNew();
      await stage.d.wait(3 * SECOND);
      const before = await stage.read();
      // An ask from A opens: the hub holds its push and raises the ask. `held` returns at the hub's `ask.created`, and
      // an ask is in sight only once the hub's list holds it: the hub's next reading of its sessions, a moment later,
      // records the session's row, needs you, and the ask's own (`row.set`, `listed`). The replica is fed all of it
      // before it is read: the listing recorded and the hub's log still. BLOCKED if the hub never lists the ask.
      const ask = await held(w, a, PUSH);
      await awaitRecord(w, (all) => all.find((e) => e.kind === 'row.set' && e.data.id === ask.ask && e.data.listed === true), `the fixture didn't hold: the hub's listing of ${ask.ask} (its row.set, listed), which puts the ask in sight`);
      await quiet(w.hub);
      await stage.feedNew();
      await stage.d.wait(3 * SECOND);
      const { added, problem } = addedSince(before, await stage.read());
      expect(problem, `the replica's announcements for the ask ${ask.ask} ("${ask.question}")`).toBeUndefined();
      expect(added.length, `the replica made an entry for the ask ${ask.ask} ("${ask.question}"), which the live run is held to`).toBeGreaterThan(0);
      const still = await live.front();
      if (!still.front) blocked('the platform can\'t be read: another window took the front while the ask opened, so the real window wasn\'t the key one');
      expect(await settled(async () => liveTree({ windows: await live.tree(), entries: added }), 30 * SECOND)).toEqual([]);
    } finally {
      await stage.stop();
      await live.stop();
    }
  }, 600 * MIN);
});
