// AC11: killing the hub between storing a run's items and saving its read position, and between saving the position
// and storing the items, loses no item and makes none twice on the next run; an item the provider stamps 3 s before
// the newest one read, written after that read, is taken in on the next run.
// The record runs on its test VFS, which keeps only what a sync made durable. A clean run is counted first: how many
// syncs it makes from its start to its end. Then the same run is cut at each of them in turn, the power cut as that
// sync is asked for, so every point between two of the run's durable writes is a kill point, whichever order a hub
// writes its items and its position in; files the host wrote before the cut stay, as a disk keeps them. The hub then
// starts on what was kept and runs again.
import { describe, expect, it } from 'vitest';
import { testStorage, type Backend, type TestStorage } from '../../../packages/record/src/index.ts';
import { AC11, at, killPlugin, MINUTE, runNow, SECOND, sleep, startHub, stopHub, tasksOf } from './helpers.ts';
import { REPO_WEB } from './providers.ts';
import { trackerWorld } from './worlds.ts';

const T0 = at('2026-11-02T09:00');
const ITEMS = [1, 2, 3].map((n) => `${REPO_WEB}#${n}`);

/** The test VFS, its power cut as the `at`-th sync after `arm` is asked for; `count` counts them. */
function cuttable(): TestStorage & { arm(at: number): void; count: number } {
  const inner = testStorage() as TestStorage & Backend;
  let armed = Infinity;
  const s: TestStorage & Backend & { arm(at: number): void; count: number } = {
    name: 'test', count: 0,
    get refuseWrites() { return inner.refuseWrites; },
    set refuseWrites(v: boolean) { inner.refuseWrites = v; },
    cutPower: () => inner.cutPower(),
    syncs: () => inner.syncs(),
    open: (path) => inner.open(path),
    commit: (db, mode, work) => {
      if (mode === 'full' && ++s.count >= armed) {
        armed = Infinity;
        inner.cutPower();
        throw Error('SQLITE_IOERR: the power was cut');
      }
      inner.commit(db, mode, work);
    },
    close: (db) => inner.close(db),
    arm: (k) => { armed = k; s.count = 0; },
  };
  return s;
}

/** One run of the three items, cut at the `cut`-th sync (Infinity: not cut); then the next start and run. The run's sync count and each item's tasks after. */
async function scenario(cut: number): Promise<{ syncs: number; tasks: Record<string, number> }> {
  const storage = cuttable();
  const t = await trackerWorld(T0, { storage });
  for (const n of [1, 2, 3]) t.tr.add({ n, created: T0 + MINUTE, updated: T0 + MINUTE + n * SECOND });
  t.c.set(T0 + 2 * MINUTE);
  await t.w.record.sync();
  storage.arm(cut);
  await Promise.race([runNow(t.h, t.handle).catch(() => undefined), sleep(60_000)]);
  const syncs = storage.count;
  let h = t.h;
  if (cut !== Infinity) {
    await killPlugin(t.w, t.h, 'test/tracker');
    await Promise.race([stopHub(t.h, t.w).catch(() => undefined), sleep(20_000)]);
    storage.arm(Infinity);
    t.c.set(T0 + 10 * MINUTE);
    h = (await startHub(t.w, t.seams, storage)).h;
    await runNow(h, t.handle);
  }
  const tasks = Object.fromEntries(ITEMS.map((id) => [id, 0]));
  for (const task of await tasksOf(h, t.handle)) if (task.id in tasks) tasks[task.id]!++;
  return { syncs, tasks };
}

describe(`${AC11} Killing the hub between storing a run's items and saving its read position, and between saving the position and storing the items, loses no item and makes none twice on the next run; an item the provider stamps 3 s before the newest one read, written after that read, is taken in on the next run`, () => {
  it('AC11 cut at each of the run\'s syncs, the next run leaves each item exactly one task', async () => {
    const clean = await scenario(Infinity);
    expect(clean.tasks, 'the clean run makes one task per item').toEqual(Object.fromEntries(ITEMS.map((id) => [id, 1])));
    expect(clean.syncs, 'the run made its items durable').toBeGreaterThan(0);
    const wrong: string[] = [];
    for (let k = 1; k <= clean.syncs; k++) {
      const { tasks } = await scenario(k);
      for (const [id, n] of Object.entries(tasks)) if (n !== 1) wrong.push(`cut at sync ${k} of ${clean.syncs}: ${id} is ${n} tasks`);
    }
    expect(wrong).toEqual([]);
  }, 900_000);

  it('AC11 an item stamped 3 s before the newest one read, written after that read, is taken in on the next run', async () => {
    const { c, h, tr, handle } = await trackerWorld(T0);
    tr.add({ n: 1, created: T0 + MINUTE, updated: T0 + MINUTE });
    tr.add({ n: 2, created: T0 + MINUTE, updated: T0 + MINUTE + 10 * SECOND });
    c.set(T0 + 2 * MINUTE);
    await runNow(h, handle);
    expect((await tasksOf(h, handle)).map((t) => t.id).sort()).toEqual([`${REPO_WEB}#1`, `${REPO_WEB}#2`]);
    tr.add({ n: 4, created: T0 + MINUTE + 7 * SECOND, updated: T0 + MINUTE + 7 * SECOND });
    c.set(T0 + 3 * MINUTE);
    await runNow(h, handle);
    expect((await tasksOf(h, handle)).map((t) => t.id).sort(), 'issue 4, stamped 3 s before issue 2, is taken in').toEqual([`${REPO_WEB}#1`, `${REPO_WEB}#2`, `${REPO_WEB}#4`]);
  }, 300_000);
});
