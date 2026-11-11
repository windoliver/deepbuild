// AC1 #535.ae486076: A 96 × 96 atlas layer with grid.size [96, 96], whose tile column reads a logic item's 9,216-value
// i32 array as u16, draws at each cell (cx, cy) the tile that the value at index 96 × cy + cx names; after a step that
// changes only cell (40, 7), the data module's remap count for that step is 1 row, and the frame's pixel hash equals
// that of the same frame remapped in full; and a planted hand-over that drops the last of a step's changed ranges, on a
// step that changes cells (0, 0) and (95, 95), leaves (95, 95) showing its old tile and fails the full-remap
// comparison, naming the frame and row 9,215
//
// The layer (fixtures.ts) reads `map.cells`, whose program (programs.ts `layerProgram`) changes only (40, 7) at step 30
// and only (0, 0) and (95, 95) at step 60. The played frame is `determinism`'s play side (every 60 Hz frame from 0 in one
// session, remapping what each step changed); the same frame remapped in full is its seek side (a fresh session one
// second later, then back to the frame: a seek remaps every row). The remap count is `frames`' `remaps` (README).
import { describe, expect, it } from 'vitest';
import { CELLS, COLS, LAST, ONE_CELL, ONE_CELL_STEP, TWO_CELL_STEP, cellValue, layerProgram } from './programs.ts';
import { TEN, layerAtlas, layerDoc, layerPixel } from './fixtures.ts';
import {
  AC, DOC, arr, at, binOf, determinismCall, failsNaming, framesCall, framesOf, near, none, num, obj, pixel, pngOf, prebuild, presented,
  putEvidence, runShow, sOf, scenario, show, showCall, str, useTemp, blocked, type Image, type JsonObject, type Planted,
} from './helpers.ts';

prebuild(['full']);
const temp = useTemp();
const D = DOC(1);

const cell = (i: number): string => `row ${i} (cell (${i % COLS}, ${Math.floor(i / COLS)}))`;
/** The tile a cell's pixel shows (within 3 codes of one of the ten tile colors), or -1. */
const tileAt = (im: Image, i: number): number => { const [x, y] = layerPixel(i); return TEN.findIndex((c) => near(pixel(im, x, y), c)); };
/** Each cell whose pixel doesn't show the tile its value at step k names. */
function cellFailures(im: Image, k: number, what: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < CELLS; i++) {
    const shown = tileAt(im, i);
    if (shown !== cellValue(i, k)) out.push(`${what}: ${cell(i)} shows ${shown < 0 ? `no tile (${JSON.stringify(pixel(im, ...layerPixel(i)))})` : `tile ${shown}`}, not the tile ${cellValue(i, k)} its value at step ${k} names`);
  }
  return out;
}

interface Side { pixels: string; hash: string }
const sideOf = (v: JsonObject, what: string): Side => ({ pixels: str(v['pixels'], `${what}.pixels`), hash: str(v['pixel_hash'], `${what}.pixel_hash`) });
/** `determinism`'s sides at each time asked. */
function sidesOf(reply: JsonObject, times: number[], what: string): Map<number, { play: Side; seek: Side }> {
  if (reply['code'] === 'gpu_unavailable') blocked('this machine has no GPU for the pixel hash');
  expect(reply['outcome'], `${what} compared the played frames with the seeked ones: ${show(reply)}`).toBe('compared');
  const out = new Map<number, { play: Side; seek: Side }>();
  for (const [i, f] of arr(reply['frames'], `${what}: frames`).entries()) {
    const o = obj(f, `${what}: frames[${i}]`);
    out.set(num(o['t'], `${what}: frames[${i}].t`), { play: sideOf(obj(o['play'], `${what}: frames[${i}].play`), 'play'), seek: sideOf(obj(o['seek'], `${what}: frames[${i}].seek`), 'seek') });
  }
  expect([...out.keys()], `${what}: a frame at each time asked`).toEqual(times);
  return out;
}
/** The full-remap comparison: the played frame's pixel hash against the full remap's; on a difference, the rows whose
 * pixels differ between the two pictures. Each failure names the frame. */
function fullRemapFailures(ev: string, t: number, s: { play: Side; seek: Side }): string[] {
  if (s.play.hash === s.seek.hash) return [];
  const play = pngOf(ev, s.play.pixels, `the played frame at ${sOf(t)}`);
  const seek = pngOf(ev, s.seek.pixels, `the full remap at ${sOf(t)}`);
  const rows: string[] = [];
  for (let i = 0; i < CELLS; i++) {
    const [x, y] = layerPixel(i);
    if (!near(pixel(play, x, y), pixel(seek, x, y), 0)) rows.push(cell(i));
  }
  return [`frame ${sOf(t)} (step ${t / at(1)}): the played frame's pixel hash ${s.play.hash} is not the one of the same frame remapped in full, ${s.seek.hash}; the rows whose pixels differ: ${rows.slice(0, 20).join(', ') || 'none at the cells\' sample pixels'}`];
}

function layerScenario(ev: string, planted?: Planted, withFrames = true): JsonObject[] {
  const program = layerProgram();
  putEvidence(ev, program.bytes);
  const atlas = putEvidence(ev, layerAtlas());
  const calls = [showCall(D, layerDoc(program, atlas)), ...(withFrames ? [framesCall(D, ONE_CELL_STEP + 1)] : []), determinismCall(D, [at(ONE_CELL_STEP), at(TWO_CELL_STEP)])];
  return runShow(binOf(), scenario(ev, [D], calls, planted ? { planted } : {}), `AC1 the 96 × 96 layer`);
}

describe(`${AC[1]} a 96 × 96 atlas layer reading a logic item's 9,216-value array: each cell's tile, a remap of one row, and the full-remap comparison`, () => {
  it(`${AC[1]} the layer draws at each cell the tile its value names; the step that changes only cell (40, 7) remaps 1 row; and each frame's pixel hash equals that of the same frame remapped in full`, () => {
    const ev = temp();
    const [shown, frames, det] = layerScenario(ev) as [JsonObject, JsonObject, JsonObject];
    presented(shown, 'the 96 × 96 layer');

    // The data module's remap count for step 30, the step that changes only (40, 7), read where the play applies it.
    const entries = framesOf(frames, ONE_CELL_STEP + 1, 'frames 0 to 30').flatMap((f, n) =>
      arr(f['remaps'], `frames[${n}].remaps (each set's remaps for the steps the frame applied)`).map((r, j) => obj(r, `frames[${n}].remaps[${j}]`)));
    const step30 = entries.filter((r) => r['set'] === 'layer' && r['step'] === ONE_CELL_STEP);
    expect(step30.map((r) => r['rows']), `the layer's remap count for step 30, which changes only cell (40, 7), is one entry of 1 row: ${show(step30)}`).toEqual([1]);

    // Each frame, played and remapped in full: every cell shows its value's tile, and the two pixel hashes are equal.
    const sides = sidesOf(det, [at(ONE_CELL_STEP), at(TWO_CELL_STEP)], 'determinism of the layer');
    const failures: string[] = [];
    for (const [t, s] of sides) {
      const k = t / at(1);
      failures.push(...cellFailures(pngOf(ev, s.play.pixels, `the played frame at step ${k}`), k, `the played frame at step ${k}`).slice(0, 10));
      failures.push(...cellFailures(pngOf(ev, s.seek.pixels, `the full remap at step ${k}`), k, `the full remap at step ${k}`).slice(0, 10));
      failures.push(...fullRemapFailures(ev, t, s));
    }
    expect(cellValue(ONE_CELL.index, ONE_CELL_STEP), 'the fixture: (40, 7) changes at step 30').not.toBe(cellValue(ONE_CELL.index, ONE_CELL_STEP - 1));
    none(failures, 'the layer at steps 30 and 60, played and remapped in full');
  }, 1_800_000);

  it(`${AC[1]} planted hand_over_drops_last_range: on the step that changes (0, 0) and (95, 95), (95, 95) keeps its old tile, and the full-remap comparison fails naming the frame and row 9,215`, () => {
    const ev = temp();
    const [shown, det] = layerScenario(ev, 'hand_over_drops_last_range', false) as [JsonObject, JsonObject];
    presented(shown, 'the 96 × 96 layer under the planted hand-over');
    const sides = sidesOf(det, [at(ONE_CELL_STEP), at(TWO_CELL_STEP)], 'determinism of the layer under the planted hand-over');
    const t = at(TWO_CELL_STEP);
    const s = sides.get(t)!;
    const played = pngOf(ev, s.play.pixels, 'the played frame at step 60');
    const old = cellValue(LAST.index, TWO_CELL_STEP - 1);
    expect(tileAt(played, LAST.index), `the planted hand-over leaves (95, 95) showing its old tile ${old}, not ${LAST.value}`).toBe(old);
    failsNaming(fullRemapFailures(ev, t, s), [/frame 1\.000 s/, /row 9215 /], 'the full-remap comparison of step 60 under hand_over_drops_last_range');
  }, 1_800_000);
});
