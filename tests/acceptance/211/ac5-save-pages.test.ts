// AC5 #211.0993eba9: "After touching 300 pages of a 2,048-page (128 MiB) world, a save holds 300 map entries and about
// 18.75 MiB of page bytes beside its memory pages, opens, and plays on with the same deep hashes as a run that never
// stopped; a planted save that leaves out the map entries opens with those pages zeroed and fails, naming the first
// page that differs"
//
// Through `deep-logic` (README; #534's saves): the toucher (programs.ts) with pages {max 2,048, slots 64, moves 8,
// lead 4} fills pages 0 to 299, each with 64 KiB of its own incompressible bytes, moves every one of them out by step
// 48 and asks for a save of slot 1 at its end, the save of step 49. One process bakes to step 49 into a saves folder
// and exits; another opens the save (`open_save`) and plays to step 100, in which the toucher asks for pages 0 to 303
// again and copies the first two words of each into `read` as it lands (page p's first word is p). A third bakes 100
// steps and never stops. The save's `pages` (README: SaveWritten) counts its map entries and page bytes.
// `save_drops_page_map` writes and opens saves with no map entries, so the pages open as fresh zeros.

import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, arrayOf, bakeCall, bakeOf, int, logic, none, obj, openSaveCall, pagesOf, piece, show, sizeOf, str, stepsOf,
  useBuilds, useTemp, type Bake, type JsonObject, type LogicPlanted, type LogicStep,
} from './helpers.ts';
import { TOUCHED, touchWrites, toucher } from './programs.ts';

const ID = AC(5);
useBuilds(['logic']);
const temp = useTemp();

const SAVED = 49;
const END = 100;
const PAGE_BYTES = TOUCHED * 65_536;
const worldPiece = (): JsonObject => piece({
  seed: 211_05,
  items: {
    world: {
      program: toucher(), writes: touchWrites, pages: pagesOf({ max: 2048, slots: 64, moves: 8, lead: 4 }),
      budget: { fuel: 10_000_000, memory: 5 }, checkpoint: { every: 10, budget: 268_435_456 }, saves: { slots: 1, request: 'request' },
    },
  },
});
interface Opened { step: number; deep_hash: JsonObject; steps: LogicStep[]; checkpoints: { step: number; deep_hash: string }[] }
/** One process bakes to the save and exits; another opens it and plays on to step 100. */
function saveAndOpen(planted: LogicPlanted[]): { save: JsonObject; opened: Opened } {
  const dir = temp();
  const [baked] = logic([bakeCall(worldPiece(), SAVED, { saves_dir: dir })], { planted });
  const b = bakeOf(baked!, SAVED, 'the bake that saves at the end of step 48');
  expect(b.saves.map((s) => s['step']), `one save, of step ${SAVED}: ${show(b.saves as unknown as JsonObject[])}`).toEqual([SAVED]);
  const [reply] = logic([openSaveCall(worldPiece(), { saves_dir: dir, slot: 1, steps: END })], { planted });
  expect(reply!['ok'], `open_save opens the save: ${show(reply)}`).toBe(true);
  const o = obj(reply!['opened'], 'open_save.opened');
  const cps = obj(reply!['checkpoints'], 'open_save.checkpoints')['world'];
  return {
    save: b.saves[0]!,
    opened: {
      step: int(o['step'], 'opened.step'), deep_hash: obj(reply!['deep_hash'], 'open_save.deep_hash'), steps: stepsOf(reply!['steps'], 'open_save.steps'),
      checkpoints: (Array.isArray(cps) ? cps : []).map((c, i) => ({ step: int(obj(c, `checkpoints[${i}]`)['step'], 'step'), deep_hash: str(obj(c, `checkpoints[${i}]`)['deep_hash'], 'deep_hash') })),
    },
  };
}
const neverStopped = (): Bake => bakeOf(logic([bakeCall(worldPiece(), END)])[0]!, END, 'the run that never stopped');
/** The judge: every page the opened run reads back after the save is the never-stopped run's, by its first two words. */
function judge(opened: LogicStep[], straight: Bake): string[] {
  for (const s of opened) {
    const got = arrayOf(s, 'world.read', 'the opened run');
    const want = arrayOf(straight.steps[s.step]!, 'world.read', 'the never-stopped run');
    for (let j = 0; j < 8; j++) {
      if (got[2 * j] !== want[2 * j] || got[2 * j + 1] !== want[2 * j + 1]) {
        return [`page ${want[2 * j]} differs, first at step ${s.step}: the opened save reads [${got[2 * j]}, ${got[2 * j + 1]}], the run that never stopped [${want[2 * j]}, ${want[2 * j + 1]}]`];
      }
    }
  }
  return [];
}

describe(`${ID} a save of a paged world holds its map entries and their bytes, and plays on as if it never stopped`, () => {
  it(`${ID} after touching 300 pages of a 2,048-page world the save holds 300 map entries and about 18.75 MiB of page bytes, opens and plays on with the never-stopped run's deep hashes`, () => {
    const { save, opened } = saveAndOpen([]);
    const pages = obj(obj(save['pages'], 'the save\'s pages')['world'], 'the save\'s pages.world');
    expect([pages['entries'], pages['bytes']], `the save holds 300 map entries and their 300 pages' bytes once each (18.75 MiB): ${show(pages)}`).toEqual([TOUCHED, PAGE_BYTES]);
    const size = sizeOf(str(save['file'], 'the save\'s file'));
    expect(size, 'the save file holds the 18.75 MiB of page bytes').toBeGreaterThanOrEqual(PAGE_BYTES);
    expect(size, 'and little beside them: its memory pages (two hold a nonzero byte) and its header').toBeLessThanOrEqual(PAGE_BYTES + 1_048_576);
    const straight = neverStopped();
    expect(opened.step, 'the save opens at step 49').toBe(SAVED);
    expect(opened.deep_hash, 'the opened state\'s deep hash is the one recorded when the save was written').toEqual(save['deep_hash']);
    const want = new Map((straight.checkpoints['world'] ?? []).map((c) => [c.step, c.deep_hash]));
    expect(opened.checkpoints.filter((c) => c.step > SAVED && want.get(c.step) !== c.deep_hash).map((c) => c.step), 'every checkpoint after the open has the never-stopped run\'s deep hash').toEqual([]);
    expect(opened.checkpoints.at(-1)?.step, 'the opened run reaches checkpoint 100').toBe(END);
    none(judge(opened.steps, straight), 'every page the opened run reads back');
  }, TIMEOUT);

  it(`${ID} (planted save_drops_page_map) opens with those pages zeroed and fails, naming the first page that differs`, () => {
    const { opened } = saveAndOpen(['save_drops_page_map']);
    const at54 = opened.steps.find((s) => s.step === 54);
    expect(at54 && arrayOf(at54, 'world.read', 'the planted open'), 'the planted save opens page 0 to 7 zeroed (step 54)').toEqual(new Array(16).fill(0));
    const failures = judge(opened.steps, neverStopped());
    expect(failures.length, 'the judge that passes the real save fails the planted one').toBeGreaterThan(0);
    expect(failures[0], 'it names page 0, the first page read back after the open').toMatch(/^page 0 differs, first at step 54/);
  }, TIMEOUT);
});
