// AC6 #167.3b65833f: "An emphasis on key b holds a and c at opacity 0.3 at mix 1 and at 1 at mix 0, with b at 1
// throughout"
//
// Three bars with `emphasis {keys: ["b"]}` (others by its default, 0.3) and `mix` keyed linearly from 1 at 0 s to 0 at
// 1 s. `geometry`'s rows give each row's opacity; `raster` shows the opacity is what's drawn: at mix 1, a's bar is
// between ink and the ground and b's is ink; at mix 0, a's is ink. No upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import {
  AC, GROUND, INK, LOOK, TIMEOUT, document, f32Column, fixedScale, fl, item, near, passes, pixel, ramp, rasterAt, readPng, rowsAt, same, strColumn, useRender, useTemp,
} from './helpers.ts';

const render = useRender();
const temp = useTemp('emphasis');
const ID = AC[6];
const XS = [40, 120, 200];
const doc = document('dim-167', 'Three bars with one named', [280, 240], 1, [
  fixedScale('ys', 'a0', [0, 40], [220, 20]),
  item('bars', 'marks@1', 'b0', {
    mark: 'bar', n: 3, key: 'key',
    columns: { key: strColumn(['a', 'b', 'c']), x: f32Column(XS), x2: f32Column(XS.map((x) => x + 60)), value: f32Column([10, 20, 30]) },
    transforms: [{ emphasis: { keys: ['b'], mix: 1 } }],
    encode: { x: { column: 'x' }, x2: { column: 'x2' }, y: { column: 'value', scale: 'ys' } },
    paint: { fill: { role: 'ink' } },
  }),
], { channels: { mix: ramp('items/bars/params/transforms/0/emphasis/mix', 1, 0, 1) } });
const TIMES = [0, 0.25, 0.5, 0.75, 1].map(fl);

describe(`${ID} an emphasis dims the rows it doesn't name`, () => {
  it(`${ID} a and c are at 0.3 at mix 1 and at 1 at mix 0, b at 1 throughout, as drawn`, () => {
    const bin = render();
    passes(bin, doc, LOOK, 'the bars');
    const rows = rowsAt(bin, doc, 'bars', TIMES, LOOK);
    for (const k of ['a', 'c']) {
      near(rows[0]![k]!.opacity, 0.3, 1e-6, `${k} at mix 1`);
      near(rows.at(-1)![k]!.opacity, 1, 1e-6, `${k} at mix 0`);
    }
    rows.forEach((r, i) => near(r['b']!.opacity, 1, 1e-6, `b at time ${i}`));
    const [dim, plain] = rasterAt(bin, doc, [0, fl(1)], LOOK, temp(), 'dim').map((f) => readPng(f.out));
    const bar = (i: number): [number, number] => [XS[i]! + 30, 200];
    const a = pixel(dim!, ...bar(0));
    expect(same(a, INK) || same(a, GROUND), `a at mix 1 is dimmed, neither ink nor the ground: ${a.join(' ')}`).toBe(false);
    expect(same(pixel(dim!, ...bar(1)), INK), 'b at mix 1 is ink').toBe(true);
    expect(same(pixel(plain!, ...bar(0)), INK), 'a at mix 0 is ink').toBe(true);
  }, TIMEOUT);
});
