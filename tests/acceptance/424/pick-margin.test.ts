// AC10 #424.6c2f640a: A click 2 px off a drawn 1 px `mark.line` edge, and one 2 px off a point item, each name that item
// by stable ID; a planted single-pixel readback misses both and fails, naming the item.
//
// The fixture: an orthographic view from +Z (60 px/m) of `edge`, a 1 px `mark.line@1` from (−2, 0, 0) to (2, 0, 0),
// and `dot`, a 4 px `mark.point@1` at (0, 1.5, 0), over a black sky. A first run reads the object-ID target to find
// what each draws: the click on `edge` is 2 px above its topmost drawn pixel at the centre column, the click on `dot` 2
// px right of its rightmost drawn pixel on its middle row; each click pixel and its 8 neighbours show nothing, so the
// click is off the item, and the item is the only thing within 3 px. A second run clicks there (`view3d`'s `clicks`):
// with the default hit margin of 3 px (Control: point, `hit: {margin: px = 3}`) the pick reads the 7 × 7 window of the
// object-ID target and names the nearest drawn ID, so the clicks name `edge` and `dot`. `--planted single_pixel_pick`
// reads only the clicked pixel and fails, naming both items. The base's picks read one pixel, as the plant does.
import { describe, expect, it } from 'vitest';
import {
  AC, DARK_SKY, failsNaming, frameAt, framesOf, ortho, only, readIds, requireMetal, runGpu, sessionDoc, useDir, useGpu, view3dCall, writeJson,
  type GpuPlanted, type Ids,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const SIZE: [number, number] = [480, 360];

const DOC = sessionDoc('margin', SIZE, {
  cam: ortho([0, 0, 0], SIZE[0] / 60), sky: DARK_SKY,
  edge: { kind: 'mark.line@1', params: { points: [[-2, 0, 0], [2, 0, 0]], width: 1, paint: { fill: { role: 'stone' } } } },
  dot: { kind: 'mark.point@1', params: { size: 4, paint: { fill: { role: 'stone' } } }, at: { pos: [0, 1.5, 0] } },
});

function clickSpots(ids: Ids): { item: string; at: [number, number] }[] {
  const cx = SIZE[0] / 2;
  let top = -1;
  for (let y = 0; y < SIZE[1] && top < 0; y++) if (ids.at(cx, y) === 'edge') top = y;
  expect(top, 'the line draws at the centre column').toBeGreaterThanOrEqual(0);
  const dots: [number, number][] = [];
  for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) if (ids.at(x, y) === 'dot') dots.push([x, y]);
  expect(dots.length, 'the point draws').toBeGreaterThan(0);
  const right = Math.max(...dots.map((d) => d[0]));
  const rows = dots.filter((d) => d[0] === right).map((d) => d[1]);
  const row = rows[Math.floor(rows.length / 2)]!;
  const spots: { item: string; at: [number, number] }[] = [{ item: 'edge', at: [cx, top - 2] }, { item: 'dot', at: [right + 2, row] }];
  for (const s of spots) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) expect(ids.at(s.at[0] + dx, s.at[1] + dy), `the click for ${s.item} at (${s.at.join(', ')}) is off every item`).toBeNull();
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const id = ids.at(s.at[0] + dx, s.at[1] + dy); if (id) expect(id, `only ${s.item} is within 3 px of its click`).toBe(s.item); }
  }
  return spots;
}
function clicked(out: string, spots: { item: string; at: [number, number] }[], planted?: GpuPlanted): string[] {
  const doc = writeJson(out, 'margin', DOC);
  const [reply] = runGpu(bin(), out, [view3dCall({ doc, size: SIZE, targets: ['ids'], clicks: spots.map((s) => ({ frame: 0, at: [s.at[0] + 0.5, s.at[1] + 0.5] })) })], planted);
  const f = frameAt(framesOf(reply!, 'the clicks'), 0, 'the clicks');
  expect(f.clicks.length, 'each click is answered').toBe(spots.length);
  return spots.flatMap((s, i) => (f.clicks[i]!.pick === s.item ? [] : [`the click 2 px off ${s.item} at (${s.at.join(', ')}) names ${f.clicks[i]!.pick ?? 'nothing'}, not ${s.item}`]));
}

describe(`${AC[10]} 3D picks honor the hit margin`, () => {
  it(`${AC[10]} clicks 2 px off a 1 px line and off a point name each by stable ID; a planted single-pixel readback misses both, naming the items`, () => {
    requireMetal();
    const out = dir();
    const [first] = runGpu(bin(), out, [view3dCall({ doc: writeJson(out, 'margin', DOC), size: SIZE, targets: ['ids'] })]);
    const spots = clickSpots(readIds(out, only(first!, 'the fixture'), 'the fixture'));
    const failures = clicked(out, spots);
    expect(failures, `the margin picks:\n  ${failures.join('\n  ')}`).toEqual([]);
    failsNaming(clicked(out, spots, 'single_pixel_pick'), ['edge', 'dot'], '--planted single_pixel_pick');
  }, 1_800_000);
});
