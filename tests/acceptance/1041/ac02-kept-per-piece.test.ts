// AC2 #1041.be83fe52: "Two different pieces exported to one origin each keep their own slot 1 after both save, and the
// same piece re-exported to another path on that origin opens its earlier save; a planted player that keys saves by
// origin or path alone fails, naming the slot the other piece overwrote"
//
// The two pieces are the dungeon and the cellar (helpers.ts: The pieces): two documents with their own IDs, seeds and
// recorded tracks, so the saves they write at step 600 record different full-state hashes. One server serves both
// bundles, each from its own folder, and one browser profile opens them.
//   - the dungeon plays to its first save, then the cellar to its own; opened again, each page lists in slot 1 the
//     save its own piece wrote;
//   - the dungeon saves at one path, is exported again into another folder of the same origin, and the page there
//     lists the earlier save and opens it at its recorded full-state hash;
//   - the planted player `web_saves_keyed_by_origin` (the scenario's `planted` key) fails the first judgement, naming
//     the slot the cellar overwrote.
// Wrong programs these fail: the merge base; saves keyed by the origin alone (the planted twin); saves keyed by the
// page's path, whose re-exported piece finds an empty slot.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FIRST_SAVE, PIECES, SLOT, TIMEOUT, appRun, exportPiece, failsNaming, none, openPiece, openSave, playToSave, slotOf, useBrowsers, useShow, useTemp,
  type PieceName, type StoredSave,
} from './helpers.ts';

const show = useShow();
const temp = useTemp();
const web = useBrowsers();
const PLANTED = 'web_saves_keyed_by_origin';
const BOTH: readonly PieceName[] = ['dungeon', 'cellar'];
const told = (s: StoredSave): string => `step ${s.step}, full-state hash ${s.hash}`;

/** Both pieces exported to one origin, each played to its first save in one profile, then each page opened again:
 * the failures of "each keeps its own slot 1", every one naming the slot, and the piece that overwrote it when the
 * slot holds the other piece's save. */
async function bothSave(planted?: string): Promise<string[]> {
  const evidence = temp();
  const root = temp();
  const apps = { dungeon: appRun(show(), evidence, 'dungeon'), cellar: appRun(show(), evidence, 'cellar') };
  for (const piece of BOTH) exportPiece(show(), evidence, piece, join(root, piece), planted);
  const origin = await web.serve(root);
  const browser = await web.browser();
  const wrote = new Map<PieceName, StoredSave>();
  for (const piece of BOTH) {
    const { page } = await openPiece(browser, `${origin}/${piece}/index.html`, PIECES[piece].title);
    wrote.set(piece, await playToSave(page, FIRST_SAVE, apps[piece], PIECES[piece].title));
    await page.close();
  }
  const failures: string[] = [];
  for (const [piece, other] of [['dungeon', 'cellar'], ['cellar', 'dungeon']] as const) {
    const [name, own, others] = [PIECES[piece].title, wrote.get(piece)!, wrote.get(other)!];
    const { page, start } = await openPiece(browser, `${origin}/${piece}/index.html`, `${name}, opened again`);
    const got = slotOf(start);
    if (!got) failures.push(`slot ${SLOT} of ${name} holds no save after both pieces saved; it wrote ${told(own)}`);
    else if (got.step === others.step && got.hash === others.hash) failures.push(`${PIECES[other].title} overwrote slot ${SLOT} of ${name}: the slot holds the save ${PIECES[other].title} wrote (${told(got)}), not its own (${told(own)})`);
    else if (got.step !== own.step || got.hash !== own.hash) failures.push(`slot ${SLOT} of ${name} holds ${told(got)}, not the save it wrote (${told(own)})`);
    await page.close();
  }
  return failures;
}

describe(`${AC[2]} saves are kept under the piece, within the page's origin`, () => {
  it(`${AC[2]} two different pieces exported to one origin each keep their own slot 1 after both save`, async () => {
    none(await bothSave(), `on one origin, the dungeon and the cellar each keep their own slot ${SLOT}`);
  }, TIMEOUT);

  it(`${AC[2]} the same piece re-exported to another path on that origin opens its earlier save`, async () => {
    const evidence = temp();
    const root = temp();
    const app = appRun(show(), evidence, 'dungeon');
    exportPiece(show(), evidence, 'dungeon', join(root, 'first'));
    const origin = await web.serve(root);
    const browser = await web.browser();
    const { page } = await openPiece(browser, `${origin}/first/index.html`, 'the dungeon at its first path');
    const save = await playToSave(page, FIRST_SAVE, app, 'the dungeon at its first path');
    await page.close();

    exportPiece(show(), evidence, 'dungeon', join(root, 'second'));
    const moved = await openPiece(browser, `${origin}/second/index.html`, 'the dungeon re-exported to another path');
    expect(slotOf(moved.start), `slot ${SLOT} of the re-exported dungeon holds the save it wrote at its first path`).toEqual(save);
    none(await openSave(moved.page, save, 'the dungeon re-exported to another path'), 'the re-exported piece opens its earlier save at its recorded full-state hash');
  }, TIMEOUT);

  it(`${AC[2]} the planted player ${PLANTED} fails, naming the slot the other piece overwrote`, async () => {
    failsNaming(await bothSave(PLANTED), `${PIECES.cellar.title} overwrote slot ${SLOT} of ${PIECES.dungeon.title}`, `the planted player ${PLANTED}`);
  }, TIMEOUT);
});
