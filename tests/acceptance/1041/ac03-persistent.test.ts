// AC3 #1041.4e56c211: "In headless Chrome with a test shim over the browser's storage: with persistence granted, the
// dungeon saved at step 1,800 survives a journey that clears the origin's non-persistent storage and opens at its
// recorded full-state hash; with it refused, the player says so once across 3 saves, and the save exported to a file
// still opens; a planted player that never asks loses the save in that journey and fails, naming the slot"
//
// The shim (helpers.ts: `Shim`; README: The shim over the browser's storage) answers the browser's own ask to keep the
// origin's storage persistent and counts it. The journey: the page is closed, the origin's storage is cleared unless
// the shim granted persistence, and the page is opened again.
//   - granted: the dungeon plays to its save at step 1,800; after the journey slot 1 lists that save, and "Open save"
//     opens it at its recorded full-state hash;
//   - refused: the dungeon's three saves (steps 600, 1,200 and 1,800) are each written, and the page shows exactly one
//     notice of kind `saves_not_persistent`; "Export save" gives a file; the journey clears the storage; "Import save"
//     with the file opens the save at its recorded full-state hash;
//   - the planted player `web_saves_never_ask_persistence` (the scenario's `planted` key), under a shim that would
//     grant: it never asks, the journey clears its save, and the first judgement fails, naming the slot.
// Wrong programs these fail: the merge base; a player that never asks (the planted twin); one that says so at every
// save, or never; an export that can't be imported.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, NOT_PERSISTENT, SAVED_AT, SAVES_AT, SLOT, TIMEOUT, appRun, exportPiece, failsNaming, none, openPiece, openSave, opened, playToSave, sleep, slotOf,
  useBrowsers, useShow, useTemp, type AppRun, type Page, type StoredSave,
} from './helpers.ts';

const show = useShow();
const temp = useTemp();
const web = useBrowsers();
const PLANTED = 'web_saves_never_ask_persistence';

/** The dungeon exported (with `planted`, the wrong player) and served. */
async function dungeon(planted?: string): Promise<{ url: string; origin: string; app: AppRun }> {
  const evidence = temp();
  const app = appRun(show(), evidence, 'dungeon');
  const root = temp();
  exportPiece(show(), evidence, 'dungeon', join(root, 'dungeon'), planted);
  const origin = await web.serve(root);
  return { url: `${origin}/dungeon/index.html`, origin, app };
}

/** Under a shim that grants persistence when asked: the dungeon saved at step 1,800, then the journey. The save, the
 * page opened after the journey, and the failures of "the save survives the journey", each naming the slot. */
async function journey(planted?: string): Promise<{ save: StoredSave; page: Page; failures: string[] }> {
  const { url, origin, app } = await dungeon(planted);
  const browser = await web.browser();
  const first = await openPiece(browser, url, 'the dungeon', { grants: true });
  const save = await playToSave(first.page, SAVED_AT, app, 'the dungeon');
  const { asked, granted } = await first.page.asked('the dungeon');
  await first.page.close();
  await browser.clearNonPersistent(origin, granted);
  const again = await openPiece(browser, url, 'the dungeon after the journey', { grants: true, granted });
  const kept = slotOf(again.start);
  const failures = kept?.step === save.step && kept.hash === save.hash ? [] : [
    `slot ${SLOT}'s save is lost in the journey: saved at step ${save.step} with the full-state hash ${save.hash}, and after the origin's non-persistent storage was cleared the slot holds ${kept ? `step ${kept.step}, ${kept.hash}` : 'no save'}; the player asked the browser to keep the origin's storage persistent ${asked} times`,
  ];
  return { save, page: again.page, failures };
}

describe(`${AC[3]} the first save asks the browser to keep the origin's storage persistent, and the player says once when it isn't`, () => {
  it(`${AC[3]} with persistence granted, the dungeon saved at step 1,800 survives a journey that clears the origin's non-persistent storage and opens at its recorded full-state hash`, async () => {
    const { save, page, failures } = await journey();
    none(failures, 'the save survives the journey');
    none(await openSave(page, save, 'the dungeon after the journey'), 'after the journey the save opens at its recorded full-state hash');
  }, TIMEOUT);

  it(`${AC[3]} with persistence refused, the player says so once across 3 saves, and the save exported to a file still opens`, async () => {
    const { url, origin, app } = await dungeon();
    const browser = await web.browser();
    const first = await openPiece(browser, url, 'the dungeon', { grants: false });
    const saves: StoredSave[] = [];
    for (const step of SAVES_AT) saves.push(await playToSave(first.page, step, app, `the dungeon's save at step ${step}`));
    await sleep(2_000);
    const notices = await first.page.notices();
    expect(notices.filter((n) => n.kind === NOT_PERSISTENT).length, `across its ${saves.length} saves the page says once, in a notice of kind ${NOT_PERSISTENT}, that saves in this browser may be cleared; its notices: ${JSON.stringify(notices)}`).toBe(1);
    const { granted } = await first.page.asked('the dungeon');
    expect(granted, 'the shim refused persistence').toBe(false);
    const file = await first.page.exportSave(temp(), 'the dungeon');
    await first.page.close();

    await browser.clearNonPersistent(origin, granted);
    const again = await openPiece(browser, url, 'the dungeon after the journey', { grants: false });
    expect(again.start.saves, 'the journey cleared the origin\'s storage, which was never persistent').toEqual([]);
    await again.page.importSave(file, 'the dungeon after the journey');
    none(await opened(again.page, saves[saves.length - 1]!, 'the save kept as a file'), 'the save exported to a file still opens, at its recorded full-state hash');
  }, TIMEOUT);

  it(`${AC[3]} the planted player ${PLANTED} loses the save in that journey and fails, naming the slot`, async () => {
    failsNaming((await journey(PLANTED)).failures, `slot ${SLOT}'s save is lost`, `the planted player ${PLANTED}`);
  }, TIMEOUT);
});
