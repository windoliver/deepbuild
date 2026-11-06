// Criterion 6, second part: "a linear key on a frame's layout from row to grid over 1 s puts each child at the
// midpoint of its two layout positions at 0.5 s within 0.5 px, seeking equal to playing"
//
// Through `deep-motion eval`. A frame@1 `box` at [20, 10] with `gap: 10` and `grid: {cols: [40, 40]}` lays out four
// 40 × 30 rect@1 children a, b, c, d (flow children, in order). In a row they sit at x = 20, 70, 120, 170, y = 10;
// in the two-column grid at (20, 10), (70, 10), (20, 50), (70, 50) (worked out here by hand from the fields; the
// base's `deep-layout solve` gives the same boxes). An enum channel on `items/box/params/layout` keys `row` at 0 s
// with `interp: linear` and `grid` at 1 s. Each frame's `boxes` (README: The surface under test) gives each laid-out
// item's [x, y, w, h]: at 0 s the row's, at 1 s the grid's, and at 0.5 s each child at the midpoint of the two, size
// 40 × 30, within 0.5 px. A seek to 0.5 s gives the boxes a play through 0, 0.25, 0.5, 0.75 and 1 s gives there.
// No upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import { TIMEOUT, accepted, boxAt, evalAll, film, fl, none, show, useMotion, type JsonObject } from './helpers.ts';

const motion = useMotion();
const KIDS = ['a', 'b', 'c', 'd'];
const ROW: Record<string, [number, number]> = { a: [20, 10], b: [70, 10], c: [120, 10], d: [170, 10] };
const GRID: Record<string, [number, number]> = { a: [20, 10], b: [70, 10], c: [20, 50], d: [70, 50] };

function glideDoc(): JsonObject {
  const kid = (id: string, i: number): JsonObject => ({ id, kind: 'rect@1', name: `Tile ${id}`, order: `a${i}`, parent: 'box', params: { box: [0, 0, 40, 30], paint: { fill: { role: 'ink' } } }, at: { pos: [0, 0, 0] } });
  return film('glide', [
    { id: 'box', kind: 'frame@1', name: 'Box', order: 'a', params: { box: [20, 10, 300, 200], layout: 'row', gap: 10, grid: { cols: [40, 40] } }, at: { pos: [0, 0, 0] } },
    ...KIDS.map(kid),
  ], {
    channels: { lay: { target: 'items/box/params/layout', type: 'enum', keys: { row: { t: '0s', value: 'row', interp: 'linear' }, grid: { t: '1s', value: 'grid', interp: 'hold' } } } },
  }, { span: '2s' });
}

describe('criterion 6: a frame\'s layout is a channel target, and a row glides into a grid', () => {
  it('criterion 6: a linear key from row to grid over 1 s puts each child at the midpoint of its two layout positions at 0.5 s within 0.5 px, seeking equal to playing', () => {
    const play = [0, fl(0.25), fl(0.5), fl(0.75), fl(1)];
    const doc = glideDoc();
    const [p, s] = evalAll(motion.bin(), [{ doc, times: play }, { doc, times: [fl(0.5)] }]);
    const played = accepted(p!, play, 'the played glide');
    const sought = accepted(s!, [fl(0.5)], 'the seek to 0.5 s');
    const failures: string[] = [];
    const near = (when: string, id: string, got: [number, number, number, number], want: [number, number]): void => {
      const wantBox = [want[0], want[1], 40, 30];
      if (got.some((g, i) => Math.abs(g - wantBox[i]!) > 0.5)) failures.push(`${when}: child ${id} at ${JSON.stringify(got)}, not within 0.5 px of ${JSON.stringify(wantBox)}`);
    };
    for (const id of KIDS) {
      near('at 0 s (row)', id, boxAt(played.frames[0]!, id), ROW[id]!);
      near('at 1 s (grid)', id, boxAt(played.frames[4]!, id), GRID[id]!);
      const mid: [number, number] = [(ROW[id]![0] + GRID[id]![0]) / 2, (ROW[id]![1] + GRID[id]![1]) / 2];
      near('at 0.5 s (played)', id, boxAt(played.frames[2]!, id), mid);
    }
    none(failures, 'each child at its row, grid and midpoint positions');
    const seekBoxes = KIDS.map((id) => boxAt(sought.frames[0]!, id));
    const playBoxes = KIDS.map((id) => boxAt(played.frames[2]!, id));
    expect(seekBoxes, `the seek to 0.5 s gives the played boxes: ${show(sought.frames[0]!.boxes)}`).toEqual(playBoxes);
  }, TIMEOUT);
});
