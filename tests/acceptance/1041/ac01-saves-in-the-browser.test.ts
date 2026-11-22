// AC1 #1041.0f4a9de0: "In headless Chrome with WebGPU, a dungeon piece saved at step 1,800 in the web player, the page
// closed and opened again from the browser's storage, then fed the same next 600 steps, gives the same full-state
// hashes at each checkpoint as a run that never closed; the same save exported to a file and imported into a fresh
// browser profile opens at the full-state hash recorded when it was written; and after one good save, with the
// origin's storage quota then set below a second save's size, the second save fails and says so, and the first still
// opens at its recorded full-state hash"
//
// The dungeon (helpers.ts: The pieces) is exported to the web on its recorded track and played in headless Chrome on
// WebGPU; its logic asks for slot 1 at the ends of steps 599, 1,199 and 1,799. One test a leg:
//   - a page plays to the save at step 1,800 and is closed; a new page of the same profile lists the save, a click on
//     "Open save" opens it at the full-state hash it recorded, and played on to step 2,400 on the bundle's recorded
//     track its checkpoints 1,800 to 2,400 have the full-state hashes of a page in another profile that played from
//     the start to the end without closing, which are the app's own;
//   - "Export save" gives a file; in a fresh profile, which holds no save, "Import save" with that file opens it at
//     the full-state hash recorded when it was written;
//   - after the save at step 600, the origin's storage quota is set to 64 bytes: the save at step 1,200 is not
//     written, the page shows a notice of kind `save_failed`, the slot still lists the save at 600, and in a new page
//     that save opens at its recorded full-state hash.
// Wrong programs these fail: the merge base (its player has no `saves`, no control and writes nothing); a save kept in
// the page alone; a save without its input position or its globals (a checkpoint from 1,800 on differs); a save
// replaced before the new one is written whole; a refused write that says nothing.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, END, FIRST_SAVE, SAVED_AT, SAVES_AT, SAVE_FAILED, SLOT, TIMEOUT, appRun, checkpointAt, checkpointSteps, exportPiece, none, openPiece, openSave, opened,
  playMs, playToSave, sleep, slotOf, useBrowsers, useShow, useTemp, type AppRun,
} from './helpers.ts';

const show = useShow();
const temp = useTemp();
const web = useBrowsers();

/** Below any save's size: a save's own hashes alone are more. */
const QUOTA_BYTES = 64;
/** The browser goes on allotting an origin's writes from the space it last measured for up to 30 s (README: The
 * origin's storage quota), so the player is held paused this long after the quota is set. */
const QUOTA_SETTLES_MS = 35_000;

/** The dungeon exported to the web and served: its page's URL, its origin, and the app's replay of it. */
async function dungeon(): Promise<{ url: string; origin: string; app: AppRun }> {
  const evidence = temp();
  const app = appRun(show(), evidence, 'dungeon');
  const root = temp();
  exportPiece(show(), evidence, 'dungeon', join(root, 'dungeon'));
  const origin = await web.serve(root);
  return { url: `${origin}/dungeon/index.html`, origin, app };
}

describe(`${AC[1]} a dungeon's saves are kept in the browser's storage, written whole, and leave and enter as a file`, () => {
  it(`${AC[1]} saved at step 1,800, the page closed and the save opened again from the browser's storage, the same next 600 steps give a never-closed run's full-state hash at each checkpoint`, async () => {
    const { url, app } = await dungeon();

    const one = await web.browser();
    const never = await openPiece(one, url, 'the run that never closed');
    await never.page.play();
    const whole = await never.page.reached(END, 'the run that never closed', playMs(END));
    none(checkpointSteps(0).filter((k) => checkpointAt(whole, k) !== app.checkpoints.get(k))
      .map((k) => `checkpoint ${k}: the player's full-state hash is ${String(checkpointAt(whole, k))}, the app's ${String(app.checkpoints.get(k))}`), 'the run that never closed has the app\'s full-state hash at every checkpoint');
    await one.close();

    const two = await web.browser();
    const first = await openPiece(two, url, 'the dungeon');
    expect(first.start.saves, 'a fresh profile holds no save').toEqual([]);
    const save = await playToSave(first.page, SAVED_AT, app, 'the dungeon');
    await first.page.close();
    const again = await openPiece(two, url, 'the dungeon, its page opened again');
    expect(slotOf(again.start), `the browser's storage still holds slot ${SLOT}'s save once the page has closed`).toEqual(save);
    none(await openSave(again.page, save, 'the dungeon, its page opened again'), 'the save opens from the browser\'s storage at the full-state hash recorded when it was written');
    await again.page.play();
    const end = await again.page.reached(END, 'the reopened run', playMs(END - SAVED_AT));
    none(checkpointSteps(SAVED_AT).filter((k) => checkpointAt(end, k) !== checkpointAt(whole, k))
      .map((k) => `checkpoint ${k}: the reopened run's full-state hash is ${String(checkpointAt(end, k))}, the run that never closed has ${String(checkpointAt(whole, k))}`), 'fed the same next 600 steps, the reopened run has the never-closed run\'s full-state hash at each checkpoint');
  }, TIMEOUT);

  it(`${AC[1]} the same save exported to a file and imported into a fresh browser profile opens at the full-state hash recorded when it was written`, async () => {
    const { url, app } = await dungeon();
    const one = await web.browser();
    const first = await openPiece(one, url, 'the dungeon');
    const save = await playToSave(first.page, SAVED_AT, app, 'the dungeon');
    const file = await first.page.exportSave(temp(), 'the dungeon');
    await one.close();

    const two = await web.browser();
    const fresh = await openPiece(two, url, 'the dungeon in a fresh profile');
    expect(fresh.start.saves, 'a fresh profile holds no save').toEqual([]);
    await fresh.page.importSave(file, 'the dungeon in a fresh profile');
    none(await opened(fresh.page, save, 'the imported save'), 'the imported save opens at the full-state hash recorded when it was written');
  }, TIMEOUT);

  it(`${AC[1]} after one good save, with the origin's storage quota set below a second save's size, the second save fails and says so, and the first still opens at its recorded full-state hash`, async () => {
    const { url, origin, app } = await dungeon();
    const browser = await web.browser();
    const first = await openPiece(browser, url, 'the dungeon');
    const good = await playToSave(first.page, FIRST_SAVE, app, 'the first save');
    await browser.quota(origin, QUOTA_BYTES);
    await sleep(QUOTA_SETTLES_MS);
    await first.page.play();
    await first.page.reached(SAVES_AT[1], 'the second save', playMs(SAVES_AT[1] - FIRST_SAVE));
    const said = await first.page.noticed(SAVE_FAILED, 30_000);
    await first.page.pause();
    const after = await first.page.probe('after the second save');
    expect(said.length, `under a quota of ${QUOTA_BYTES} bytes the save at step ${SAVES_AT[1]} fails and the page says so in a notice of kind ${SAVE_FAILED}; the page's notices: ${JSON.stringify(await first.page.notices())}, probe().saves: ${JSON.stringify(after.saves)}`).toBeGreaterThan(0);
    expect(said.every((n) => n.text !== ''), `the notice says so in words: ${JSON.stringify(said)}`).toBe(true);
    expect(slotOf(after), `slot ${SLOT} keeps its last good save, the one at step ${FIRST_SAVE}`).toEqual(good);
    await browser.quota(origin, null);
    await first.page.close();

    const again = await openPiece(browser, url, 'the dungeon, its page opened again');
    expect(slotOf(again.start), `slot ${SLOT} still holds the first save in a new page`).toEqual(good);
    none(await openSave(again.page, good, 'the first save'), 'the first save still opens at its recorded full-state hash');
  }, TIMEOUT);
});
