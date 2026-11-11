// Criterion 2 (no upstream test): "An item with a 9,216-element i32 array, a 96 × 96 grid, whose steps change 2
// elements each, played by a recorded track for 108,000 steps (30 minutes at 60 Hz), keeps its arrays in under
// 80 MiB of its bake, against about 3.7 GiB kept whole each step, and playback from the bake gives the arrays the
// program wrote at 100 sampled steps; and a planted range writer that drops the second changed range at step
// 5,000 fails logic.determinism at step 5,000, naming the array and the element"
//
// Through this suite's `playback` and `determinism` (README). `grid` (programs.ts) changes two cells of its 9,216
// each step, 4,608 apart, on a seeded brush track of 108,000 steps. The bake's arrays (its `stored` bytes) are under
// 80 MiB, against 108,000 × 36,864 bytes (3.7 GiB) kept whole each step, and at least the values the steps changed
// (2 × 4 bytes a step). Playback from the bake gives, at 100 seeded steps, the grid this test works out from the
// program's own rule and the track (cellsOf, valueOf). With `ranges_drop_second_at_step_5000` the bake loses cell
// 7,672's change at step 5,000 (the second of 3,064 and 7,672), and logic.determinism's playback names step 5,000,
// grid.cells and element 7,672; without it, logic.determinism passes.
import { describe, expect, it } from 'vitest';
import {
  AC, MIB, TIMEOUT, checkCall, determinismCall, determinismOf, logicBin, none, offsetOf, onMac, piece, playbackCall, playbackOf, prebuild,
  seeded, sliderTrack, FLICKS, type Entry, type JsonObject,
} from './helpers.ts';
import { CELLS, cellsOf, grid, valueOf } from './programs.ts';

prebuild(() => { logicBin(); grid(); });

const ID = 'grid';
const ARRAY = 'grid.cells';
const STEPS = 108_000;
const LIMIT = 80 * MIB;
const WHOLE_EACH_STEP = STEPS * CELLS * 4;
const PLANTED_STEP = 5000;
const track = (): Entry[] => sliderTrack('brush', 547_02, STEPS, 120, 4);
const pieceOf = (): JsonObject => piece({ seed: 547, controls: ['brush'], items: { [ID]: { program: grid(), reads: ['brush'], writes: { cells: { type: 'i32', count: CELLS } } } } });
/** 100 seeded steps of the 108,000, ascending. */
function sampled(): number[] {
  const r = seeded(547_021);
  return [...new Set(Array.from({ length: 100 }, () => Math.floor(r() * STEPS)))].sort((a, b) => a - b);
}
/** The grid the program writes, as each step in `at` leaves it, from its rule and the track: what playback must give. */
function written(entries: Entry[], at: number[]): Map<number, number[]> {
  const byStep = new Map<number, number>();
  for (const e of entries) byStep.set(Math.round(e.t / (FLICKS / 60)), e.value);
  const cells = new Int32Array(CELLS);
  const out = new Map<number, number[]>();
  const wanted = new Set(at);
  let brush = 0;
  const last = Math.max(...at);
  for (let k = 0; k <= last; k++) {
    if (byStep.has(k)) brush = Math.trunc(byStep.get(k)!);
    const [a, b] = cellsOf(k);
    const v = valueOf(k, brush);
    cells[a] = v;
    cells[b] = -v;
    if (wanted.has(k)) out.set(k, Array.from(cells));
  }
  return out;
}

describe(`${AC[2]} bakes keep each step's changed array ranges, with every array whole at each checkpoint`, () => {
  it(`${AC[2]} 108,000 steps of a 96 × 96 grid that changes 2 cells a step keep their arrays in under 80 MiB of the bake, and playback gives the grid the program wrote at 100 sampled steps`, () => {
    const [checked] = onMac([checkCall(pieceOf())]);
    expect(offsetOf(checked!, ID, 'reads', 'brush'), 'the brush slider\'s slot is at offset 0 of the read region').toBe(0);
    expect(offsetOf(checked!, ID, 'writes', 'cells'), 'cells is at offset 0 of the write region').toBe(0);
    expect(cellsOf(PLANTED_STEP), 'step 5,000 changes cells 3,064 and 7,672').toEqual([3064, 7672]);
    expect(WHOLE_EACH_STEP / 2 ** 30, 'every array kept whole each step would be about 3.7 GiB').toBeCloseTo(3.7, 1);

    const at = sampled();
    expect(at.length, '100 sampled steps').toBe(100);
    const p = playbackOf(onMac([playbackCall(pieceOf(), { steps: STEPS, track: track() }, at)])[0]!, 'playback of the 108,000-step bake');
    const stored = p.stored[ID];
    expect(stored, 'the bake reports the bytes it keeps for the grid\'s arrays').toBeDefined();
    expect(stored!, `the grid's arrays take ${stored} bytes of the bake, under 80 MiB (${LIMIT}), against ${WHOLE_EACH_STEP} (about 3.7 GiB) kept whole each step`).toBeLessThan(LIMIT);
    expect(stored!, 'the bake keeps at least the values its steps changed (2 cells × 4 bytes × 108,000 steps)').toBeGreaterThanOrEqual(STEPS * 2 * 4);

    expect(p.arrays.map((x) => x.step), 'playback answers each sampled step, in order').toEqual(at);
    const want = written(track(), at);
    const wrong: string[] = [];
    for (const x of p.arrays) {
      const got = x.arrays[ARRAY] ?? [];
      const w = want.get(x.step)!;
      const i = w.findIndex((v, j) => got[j] !== v);
      if (got.length !== CELLS || i >= 0) wrong.push(`step ${x.step}: ${ARRAY} has ${got.length} values${i >= 0 ? `, element ${i} is ${String(got[i])}, the program wrote ${w[i]}` : ''}`);
    }
    none(wrong, 'playback from the bake gives the arrays the program wrote');
  }, TIMEOUT);

  it(`${AC[2]} a planted range writer that drops the second changed range at step 5,000 (ranges_drop_second_at_step_5000) fails logic.determinism at step 5,000, naming grid.cells and element 7,672`, () => {
    const det = determinismOf(onMac([determinismCall(pieceOf(), { steps: STEPS, track: track() }, [1])], ['ranges_drop_second_at_step_5000'])[0]!, 'logic.determinism with ranges_drop_second_at_step_5000');
    expect(det.verdict, 'logic.determinism fails the planted range writer').toBe('FAIL');
    const playback = det.failures.filter((f) => f.run === 'playback');
    expect(playback.map((f) => ({ item: f.item, step: f.step, field: f.field, array: f.array, element: f.element })), `playback from the bake fails at step 5,000, naming the array and the element: ${JSON.stringify(det.failures).slice(0, 1200)}`)
      .toEqual([{ item: ID, step: PLANTED_STEP, field: 'array', array: ARRAY, element: 7672 }]);

    const straight = determinismOf(onMac([determinismCall(pieceOf(), { steps: STEPS, track: track() }, [1])])[0]!, 'logic.determinism of grid');
    expect(straight.failures, 'without the plant, logic.determinism finds nothing').toEqual([]);
    expect(straight.verdict, 'without the plant, logic.determinism passes grid').toBe('PASS');
  }, TIMEOUT);
});
