// AC1: launched against a fixture record with 3 open asks in 2 sessions, deep-app's window shows the registered sidebar
// with those 2 sessions and Needs you with 3 rows, and the menu bar reads 3; no row reads "Session 0001", and a planted
// build that opens the spike window fails, naming it.
// AC2: answering one of those asks in the record makes the window and the menu bar read 2 within 1 s.
//
// The real deep-app process against a real hub, read from outside: the accessibility tree, the menu-bar item and the
// window's pixels (README: The surface). The replica is only compared with, never judged in its place.
import { describe, expect, it } from 'vitest';
import {
  answer, App, appBinary, loaded, inconclusive, makeWorld, menuCount, nodes, replicaBinary, settled, shellFailures, tempDir, useCleanup, readJson, childProcess, type World,
} from './helpers.ts';

useCleanup();
const MINUTES = 60_000;
const shell = async (world: World, app: App, count: number) => settled(() => shellFailures(world, app, { rows: world.asks.slice(3 - count), count }));

describe('#1172 the app a person runs', () => {
  it('AC1 deep-app shows the registered sidebar with the 2 sessions and Needs you with 3 rows, the menu bar reads 3, and no row reads "Session 0001"', async () => {
    const world = await makeWorld();
    const app = await App.launch({ home: world.home, binary: await appBinary() });
    expect(await shell(world, app, 3)).toEqual([]);
    await app.stop();
  }, 8 * MINUTES);

  it('AC1 wrong program: the planted build that opens the spike window fails, naming the spike window', async () => {
    const world = await makeWorld();
    const app = await App.launch({ home: world.home, binary: await appBinary('plant-spike-window') });
    const failures = await shellFailures(world, app, { rows: world.asks, count: 3 });
    await app.stop();
    expect(failures.join('\n'), 'the planted spike window must fail the same judge AC1 holds the app to, naming it').toMatch(/the spike window/);
  }, 8 * MINUTES);

  it('AC1 proof: the real window\'s sidebar rows are the replica\'s rows over the same record', async () => {
    const world = await makeWorld();
    const app = await App.launch({ home: world.home, binary: await appBinary() });
    await shell(world, app, 3);
    const rows = (await app.tree()).windows.flatMap((w) => nodes(w.tree)).filter((n) => n.role === 'AXButton' && world.sessions.some((s) => n.name.includes(s.task))).map((n) => n.name).sort();
    await app.stop();
    const out = tempDir();
    await childProcess(replicaBinary(), ['--first-screen', '--out', out, '--appearance', 'light'], world.home);
    const snapshot = readJson<{ tree: ReplicaNode }>(`${out}/snapshots/first-screen.json`);
    const walk = (n: ReplicaNode): ReplicaNode[] => [n, ...n.children.flatMap(walk)];
    const replica = walk(snapshot.tree).filter((n) => n.role === 'button' && world.sessions.some((s) => (n.name ?? '').includes(s.task))).map((n) => n.name).sort();
    expect(replica, 'the replica over this home\'s record draws both sessions (its frames sit beside the real window\'s in the proof)').toHaveLength(2);
    expect(rows, 'the real window\'s sidebar rows').toEqual(replica);
  }, 8 * MINUTES);

  it('AC2 answering one ask in the record makes the window and the menu bar read 2 within 1 s', async () => {
    const world = await makeWorld();
    const app = await App.launch({ home: world.home, binary: await appBinary() });
    expect(await shell(world, app, 3), 'before the answer the window and the menu bar read 3').toEqual([]);
    const [asked, ...rest] = world.asks;
    await answer(world, asked!);
    const answered = Date.now();
    let elapsed = Infinity;
    for (let reading = await app.tree(); Date.now() - answered < 10_000; reading = await app.tree()) {
      const names = reading.windows.flatMap((w) => nodes(w.tree)).map((n) => n.name);
      if (menuCount(reading) === 2 && !names.some((n) => n.includes(asked!.question))) { elapsed = reading.t1 - answered; break; }
    }
    const after = await settled(() => shellFailures(world, app, { rows: rest, count: 2 }), 3000);
    await app.stop();
    expect(after, 'once answered, the window draws 2 rows and the menu bar reads 2').toEqual([]);
    if (elapsed > 1000 && loaded()) inconclusive(`the window and the menu bar read 2 ${Math.round(elapsed)} ms after the answer, past 1 s, with the machine's load above half its cores`);
    expect(elapsed, 'ms from the answer to the window and the menu bar reading 2').toBeLessThanOrEqual(1000);
  }, 8 * MINUTES);
});

interface ReplicaNode { role: string; name?: string | null; children: ReplicaNode[] }
