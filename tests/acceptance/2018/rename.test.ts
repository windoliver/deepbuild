// AC6 #2018.13e5e71e: Rename from the Session menu puts the caret in the page's title, and Return saves the name to the
// row and to `deep status`. A planted app with no way to rename fails.
//
// The app is the replica over a copy of a real hub's record. A replica's calls never reach a hub (#1462), so what the
// app sent on Return is read from `see`'s `hub` and sent to the real hub as the app sends it, on an app connection;
// `deep status` then reads that hub (README, Pinned 6).
import { afterAll, describe, expect, test } from 'vitest';
import {
  byId, caretFailures, cleanup, control, deep, type HubCall, ID, linesWith, makeWorld, MIN, none, quiet, renameCalls, renameItem, Replica, rowOf, savedFailures, statusRows,
  wordsOf, type World,
} from './helpers.ts';

afterAll(cleanup, 120_000);
const WAS = 'Billing page';
let made: Promise<World> | undefined;
const world = (): Promise<World> => (made ??= makeWorld({ repos: ['shop', 'docs'], seed: async (s, T) => {
  await s.start('rename', 'shop', T - 30 * MIN);
  await s.task('rename', WAS, T - 30 * MIN + 1000);
  await s.prompt('rename', 'lay out the billing page', T - 30 * MIN + 2000);
  await s.start('other', 'docs', T - 22.5 * MIN);
  await s.task('other', 'Docs refresh', T - 22.5 * MIN + 1000);
  await s.prompt('other', 'refresh the docs', T - 22.5 * MIN + 2000);
  await s.toolStart('rename', T - 2.5 * MIN);
}}));

/**
 * The rename, by menu and keys alone: the session's page, Session › Rename, the caret, the new name typed over the
 * old, Return. What was wrong, and the calls the app sent its hub on Return that name the session and the name.
 */
async function rename(w: World, name: string, was: string, o: { plant?: string; build?: 'plain' | 'plants' } = {}): Promise<{ failures: string[]; calls: HubCall[] }> {
  const s = w.sessions.rename!;
  const r = await Replica.of(w, o.plant, o.build ?? (o.plant ? 'plants' : 'plain'));
  try {
    await r.open(`session/${s.id}`);
    await r.wait(300);
    const before = await r.see();
    const title = wordsOf(before.snapshot, byId(before.snapshot, 'page-title'));
    if (!title.includes(was)) return { failures: [`the session's page title reads ${JSON.stringify(title)} before the rename, not "${was}"`], calls: [] };
    const item = renameItem(before.menus);
    if (!item.title) return { failures: item.failures, calls: [] };
    const picked = await r.menu(['Session', item.title]);
    if (picked.ok !== true) return { failures: [`no way to rename: picking Session › ${item.title} failed: ${JSON.stringify(picked.error ?? picked).slice(0, 200)}`], calls: [] };
    const caret = caretFailures((await r.see()).snapshot, was);
    if (caret.length) return { failures: caret, calls: [] };
    await r.press('cmd-a');
    await r.type(name);
    await r.press('enter');
    await r.wait(500);
    const after = await r.see();
    const sent = renameCalls(after.hub.slice(before.hub.length), s.id, name);
    return { failures: [...savedFailures(after.snapshot, s.id, name, was), ...sent.failures], calls: sent.calls };
  } finally {
    await r.stop();
  }
}

describe(ID.rename, () => {
  test(`${ID.rename}: Rename from the Session menu puts the caret in the page's title, and Return saves the name to the row and to deep status`, async () => {
    const w = await world();
    const s = w.sessions.rename!;
    const NAME = 'Checkout retries';
    const { failures, calls } = await rename(w, NAME, WAS);
    none(failures, 'the rename in the app: the menu item, the caret, the row and the title after Return');
    // What the app sent, sent to the hub it copied its record from.
    const conn = await control(w.hub, 'app');
    try {
      for (const c of calls) {
        const reply = await conn.call(c.method, c.params, 30_000);
        expect('result' in reply, `the hub takes the app's ${c.method} ${JSON.stringify(c.params)}: ${JSON.stringify(reply).slice(0, 300)}`).toBe(true);
      }
    } finally {
      conn.close();
    }
    await quiet(w.hub);
    const row = rowOf((await statusRows(w)).rows, s.id);
    expect(row?.title, `deep status --json's row session:${s.id} holds the name Return saved`).toBe(NAME);
    const text = (await deep(w, ['status'])).stdout;
    expect(linesWith(text, NAME).length, `deep status has a line reading "${NAME}": ${JSON.stringify(text.slice(0, 600))}`).toBeGreaterThan(0);
    none(linesWith(text, WAS), `deep status no longer reads "${WAS}"`);
  }, 30 * MIN);

  test(`${ID.rename}: a planted app with no way to rename fails`, async () => {
    const w = await world();
    const now = String(rowOf((await statusRows(w)).rows, w.sessions.rename!.id)?.title);
    // The same build renames with no plant chosen, so the plant is what takes the way to rename away.
    const unplanted = await rename(w, 'Cart rounding', now, { build: 'plants' });
    none(unplanted.failures, "the replica's env-plants build, with no plant chosen, renames as the app does");
    const planted = await rename(w, 'Cart rounding', now, { plant: 'no-rename' });
    expect(planted.failures.some((f) => f.startsWith('no way to rename:')), `DEEP_HUB_PLANT=no-rename in the replica's env-plants build must fail for want of a way to rename: ${JSON.stringify(planted.failures)}`).toBe(true);
  }, 30 * MIN);
});
