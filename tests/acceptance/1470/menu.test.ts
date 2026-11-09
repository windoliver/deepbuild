// Acceptance tests for #1470: menus pick on release. Written first, blind (README); the implementing agent never edits
// this file. Every reading is the replica's own text snapshot of the fixture panel (fixtures/menu/main.js), driven by the
// real `deep-drive` binary. macOS only: the replica renders with GPUI's offscreen Metal renderer; elsewhere it fails as
// INCONCLUSIVE, never passes.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  AC1, AC2, AC3, AC4, PLANT, close, ROW, ROW_IDS, TRIGGER, Drive, cleanup, clickNoDrag, click, keys, open, pressSlideRelease,
  ran, releaseOutside, requireMacos, rowCenters, see, settle, shown, type RowId,
} from './helpers.ts';

beforeAll(requireMacos);
afterEach(cleanup, 60_000);

const TEST_MS = 20 * 60_000;

describe('menus pick on release', () => {
  it(`${AC1}: a press on the trigger, a move to row 2 and a release there runs row 2 once and closes the menu`, async () => {
    const drive = await Drive.start();
    expect(await pressSlideRelease(drive)).toEqual([]);
  }, TEST_MS);

  it(`${AC2}: press and release within 3 px leaves it open, and a later click picks`, async () => {
    const drive = await Drive.start();
    expect(await clickNoDrag(drive)).toEqual([]);
  }, TEST_MS);

  it(`${AC2}: the planted always-release closes the menu at once and fails the journey; it still meets criteria 1 and 3`, async () => {
    // DEEP_DRIVE_PLANT=menu-release-always: a build with the env-plants feature runs the Menu with every release over an
    // open menu treated as a pick or a close, the wrong program the criterion names.
    // The rows' places come from an honest drive: the plant closes the menu on a click's release, so it can't show them,
    // and where a row is drawn doesn't depend on what a release does.
    const honest = await Drive.start();
    const at = await rowCenters(honest);
    await honest.stop();
    const plant = await Drive.start({ plant: PLANT });
    const problems = await clickNoDrag(plant);
    expect(problems.length, `the planted always-release must fail the no-drag journey, it said: ${JSON.stringify(problems)}`).toBeGreaterThan(0);
    expect(problems.join('\n'), 'it fails by closing the menu on the release').toMatch(/left the menu closed/);
    // What it gets right is what criteria 1 and 3 test, so the plant differs from the honest program on this one only.
    expect(await pressSlideRelease(plant, at), 'the plant picks on a release over row 2').toEqual([]);
    expect(await releaseOutside(plant, at), 'the plant closes on a release off every row').toEqual([]);
  }, TEST_MS);

  it(`${AC3}: a release outside closes it and runs nothing`, async () => {
    const drive = await Drive.start();
    expect(await releaseOutside(drive)).toEqual([]);
  }, TEST_MS);

  describe('keyboard use of the menu is unchanged', () => {
    /**
     * A fresh replica; the trigger given the keyboard by a click on it (the window has no Tab traversal into panel
     * content), the menu that click opened closed with Escape, then `sequence`; what the snapshot shows.
     */
    async function typed(sequence: string, drive?: Drive) {
      const r = await open(undefined, drive);
      await click(r, TRIGGER);
      await keys(r, 'escape');
      if (sequence) await keys(r, sequence);
      await settle(r);
      const s = await see(r);
      await close(r);
      return { s };
    }
    /** The one row a pick ran, once, with the menu closed; fails the test naming what the snapshot showed instead. */
    function picked(s: Awaited<ReturnType<typeof see>>, what: string): RowId {
      const n = ran(s);
      const rows = ROW_IDS.filter((id) => n[id] > 0);
      expect(n.total, `${what} ran one row once: ${JSON.stringify(n)}`).toBe(1);
      expect(rows.length, `${what} ran one row: ${JSON.stringify(n)}`).toBe(1);
      expect(shown(s), `${what} closes the menu`).toEqual([]);
      return rows[0]!;
    }

    it(`${AC4}: Enter and Space open the menu on the focused trigger, its rows in order, and run nothing`, async () => {
      const drive = await Drive.start();
      for (const key of ['enter', 'space']) {
        const { s } = await typed(key, drive);
        expect(shown(s), `${key} on the trigger opens the menu`).toEqual(ROW_IDS);
        expect(ran(s).total, `${key} runs no row`).toBe(0);
      }
      const before = await typed('', drive);
      expect(shown(before.s), 'the focusing click and Escape alone leave the menu closed').toEqual([]);
    }, TEST_MS);

    it(`${AC4}: the open menu's text is the same opened by Enter, Space or a click`, async () => {
      const drive = await Drive.start();
      const byEnter = (await typed('enter', drive)).s.texts;
      const bySpace = (await typed('space', drive)).s.texts;
      const r = await open(undefined, drive);
      await click(r, TRIGGER);
      await settle(r);
      const byClick = (await see(r)).texts;
      await close(r);
      const same = (t: string[]) => JSON.stringify([...new Set(t)].sort());
      expect(same(bySpace), 'Space and Enter show the same text').toBe(same(byEnter));
      expect(same(byClick), 'a click and Enter show the same text').toBe(same(byEnter));
    }, TEST_MS);

    it(`${AC4}: Escape closes the menu and runs nothing`, async () => {
      const drive = await Drive.start();
      const { s } = await typed('enter escape', drive);
      expect(shown(s), 'Escape closes the menu').toEqual([]);
      expect(ran(s).total, 'Escape runs no row').toBe(0);
    }, TEST_MS);

    it(`${AC4}: Down and Up move the highlighted row and Enter picks it, once, and closes the menu`, async () => {
      const drive = await Drive.start();
      const one = picked((await typed('enter down enter', drive)).s, 'Enter after one Down');
      const two = picked((await typed('enter down down enter', drive)).s, 'Enter after two Downs');
      const back = picked((await typed('enter down down up enter', drive)).s, 'Enter after two Downs and an Up');
      expect(ROW_IDS.indexOf(two), `a second Down moves one row on from ${one}`).toBe(ROW_IDS.indexOf(one) + 1);
      expect(back, 'Up moves back to the row one Down picked').toBe(one);
      expect(Object.values(ROW).length, 'the fixture has three rows').toBe(3);
    }, TEST_MS);
  });
});
