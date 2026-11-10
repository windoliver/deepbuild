// AC2 #1463.824c8001: `deep` prints the list and exits 0, and on a machine that isn't set up it runs setup first; a
// planted second count fails, naming it. AC3 #1463.59289fca: with the hub stopped, `deep` prints the rows it can read
// from the database and says the hub isn't answering and since when, and no count reads 0. The list is the app's, read
// in the replica over the same hub's record; the machine not set up is #1359's world, its login service a stand-in.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { deep as deepIn, cleanup as cleanup1359, needHook, world as freshWorld, shown as shown1359 } from '../1359/helpers.ts';
import {
  afterListFailures, appList, cleanup, clocksBetween, countFailures, countsIn, deep, downFailures, ID, MAIN, makeWorld, NOON, quiet, shown, stopHub,
  textRowFailures, type AppList, type World,
} from './helpers.ts';

afterAll(async () => { await cleanup(); await cleanup1359(); }, 60_000);

let made: Promise<{ w: World; app: AppList }> | undefined;
const listed = (): Promise<{ w: World; app: AppList }> => (made ??= (async () => {
  const w = await makeWorld(MAIN, { clock: NOON });
  await quiet(w.hub);
  return { w, app: await appList(w) };
})());

describe(ID.deep, () => {
  test(`${ID.deep}: deep prints the list, the same rows and count as the app, then nothing else, and exits 0`, async () => {
    const { w, app } = await listed();
    const r = await deep(w, []);
    console.log(`deep:\n${r.stdout}`);
    expect(r.code, `deep exits 0: ${shown(r)}`).toBe(0);
    const rows = app.rows ?? [];
    expect([
      ...afterListFailures(r.stdout, rows, 'deep'),
      ...countFailures(r.stdout, app.count, 'deep'),
      ...(app.rows ? textRowFailures(r.stdout, rows, 'deep') : ["deep_drive's see answers no rows beside its snapshot (README, Pinned 5), so deep's rows can't be held to the app's"]),
    ], `deep beside the app's list (${rows.length} rows, count ${app.count.join('/')})`).toEqual([]);
  }, 900_000);

  test(`${ID.deep}: a planted second count fails, naming it`, async () => {
    const { w, app } = await listed();
    const r = await deep(w, [], 'deep-second-count');
    const failures = countFailures(r.stdout, app.count, 'deep');
    expect(failures.some((f) => /second count/.test(f) && countsIn(r.stdout).some((n) => f.includes(`"${n} ask`))), `DEEP_HUB_PLANT=deep-second-count must fail naming its count: ${JSON.stringify(failures)}; ${shown(r)}`).toBe(true);
  }, 900_000);

  test(`${ID.deep}: on a machine that isn't set up, deep runs setup first, then prints the list and exits 0`, async () => {
    needHook();
    const fw = freshWorld();
    const r = await deepIn(fw, [], { hub: 'starts', timeoutMs: 180_000 });
    console.log(`deep in a home nobody set up:\n${r.stdout}${r.stderr}`);
    expect(existsSync(join(fw.home, '.deepbuild', 'setup-finished.json')), `deep must run setup first in a home nobody set up, as the first deep command does: no ~/.deepbuild/setup-finished.json after it (${shown1359(r)})`).toBe(true);
    expect(r.code, `deep exits 0 after setting up: ${shown1359(r)}`).toBe(0);
    expect(afterListFailures(r.stdout, [], 'deep').filter((f) => /help|plumbing/.test(f)), `deep prints the list, not help: ${shown1359(r)}`).toEqual([]);
  }, 300_000);
});

describe(ID.down, () => {
  test(`${ID.down}: with the hub stopped, deep prints the rows it can read from the database, says the hub isn't answering and since when, and no count reads 0`, async () => {
    const { w, app } = await listed();
    const up = await deep(w, []);
    expect(up.code, `deep with the hub up: ${shown(up)}`).toBe(0);
    const upCount = countsIn(up.stdout);
    const stoppedAt = Date.now();
    await stopHub(w.hub);
    const r = await deep(w, []);
    console.log(`deep with the hub stopped:\n${r.stdout}${r.stderr}`);
    // Since when: a clock time from the hub's last start to now, by the wall clock or by the hub's own (README, The fixture).
    const since = [...clocksBetween(w.startedAt, Date.now()), ...(w.clock === undefined ? [] : clocksBetween(w.clock + 20 * 60_000, w.clock + 20 * 60_000 + (Date.now() - w.startedAt)))];
    expect([
      ...downFailures(`${r.stdout}\n${r.stderr}`, since),
      ...(app.rows ? textRowFailures(`${r.stdout}\n${r.stderr}`, app.rows, 'deep with the hub stopped') : ["deep_drive's see answers no rows beside its snapshot (README, Pinned 5), so the rows deep reads from the database can't be held to the app's"]),
      ...countsIn(`${r.stdout}\n${r.stderr}`).filter((n) => !upCount.includes(n)).map((n) => `deep with the hub stopped counts ${n}; with it up, ${upCount.join('/') || 'nothing'}`),
    ], `deep with the hub stopped at ${new Date(stoppedAt).toTimeString().slice(0, 5)}`).toEqual([]);
  }, 900_000);
});
