// AC2 #167.cf27c591: "A reveal over a line of ten yearly rows, with to keyed linearly from 2010 to 2019, ends the line
// at the point mixed at to within 0.01 u at 100 random times, and a counter on #head shows that point's value at its
// column's precision"
//
// One seeded draw of 100 times over the nine-second span. Expected, for each: `to` from the key's line, the point
// mixed between the two neighboring rows, through the fixture's two scales. `geometry`'s `subpaths` (#373's) give the
// drawn line: its last point is that point, and the points before it are the rows up to `to`. The counter reads
// `items/line#head/value`; the column is i32, so its precision is whole numbers: `raster`'s `texts` show the mixed value
// rounded. Every fifth time is drawn, enough to see a counter that holds a stale or an unrounded value.
// No upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import {
  AC, LINE_SPAN, LINE_VALUES, LOOK, TIMEOUT, arr, fl, geometryAt, lineDoc, lineX, lineY, near, num, obj, passes, rasterAt, seeded, shownText, useRender, useTemp,
} from './helpers.ts';

const render = useRender();
const temp = useTemp('reveal');
const ID = AC[2];
const doc = lineDoc();
const span = fl(LINE_SPAN);
const random = seeded(167);
const TIMES = Array.from({ length: 100 }, () => Math.floor(random() * (span + 1)));

/** `to` at a time, its row below, the fraction to the next row, and the mixed value. */
function mixedAt(t: number): { to: number; row: number; f: number; value: number } {
  const to = 2010 + (9 * t) / span;
  const row = Math.min(Math.floor(to - 2010), 8);
  const f = to - 2010 - row;
  return { to, row, f, value: LINE_VALUES[row]! + (LINE_VALUES[row + 1]! - LINE_VALUES[row]!) * f };
}

describe(`${ID} a reveal ends at the point mixed at to, and a counter on #head shows its value`, () => {
  it(`${ID} (end) at 100 random times the drawn line ends at the point mixed at to within 0.01 u, through the rows up to to`, () => {
    const bin = render();
    passes(bin, doc, LOOK, 'the revealed line');
    expect(new Set(TIMES.map((t) => mixedAt(t).row)).size, 'the times cover the whole line').toBe(9);
    geometryAt(bin, doc, 'line', TIMES, LOOK).forEach((a, i) => {
      const t = TIMES[i]!;
      const m = mixedAt(t);
      const what = `at ${t} flicks (to ${m.to.toFixed(5)})`;
      const subpaths = arr(obj(a, what)['subpaths'], `${what}: subpaths`);
      expect(subpaths.length, `${what}: one line`).toBe(1);
      const points = arr(obj(subpaths[0], `${what}: the line`)['points'], `${what}: points`).map((p) => arr(p, 'point').map((c) => num(c, 'point coordinate')));
      const end = points.at(-1)!;
      expect(Math.hypot(end[0]! - lineX(m.to), end[1]! - lineY(m.value)), `${what}: the end (${end.join(', ')}) against the mixed point`).toBeLessThanOrEqual(0.01);
      if (m.f > 1e-6) {
        expect(points.length, `${what}: the rows up to to, then the head`).toBe(m.row + 2);
        near(points[m.row]![0]!, lineX(2010 + m.row), 0.01, `${what}: the last whole row's x`);
        near(points[m.row]![1]!, lineY(LINE_VALUES[m.row]!), 0.01, `${what}: the last whole row's y`);
      }
    });
  }, TIMEOUT);

  it(`${ID} (counter) a counter on #head shows the mixed value at its integer column's precision`, () => {
    const times = TIMES.filter((_, i) => i % 5 === 0);
    rasterAt(render(), doc, times, LOOK, temp(), 'head').forEach(({ answer }, i) => {
      const m = mixedAt(times[i]!);
      const shown = shownText(answer, 'count', `to ${m.to}`);
      expect(shown, `the counter at to ${m.to.toFixed(5)} shows a whole number`).toMatch(/^\d+$/);
      // A value within a thousandth of a tie may land on either side in f32.
      const tie = Math.abs((m.value % 1) - 0.5) < 1e-3;
      expect(tie ? [Math.floor(m.value), Math.ceil(m.value)] : [Math.round(m.value)], `the counter at to ${m.to.toFixed(5)}, value ${m.value}`).toContain(Number(shown));
    });
  }, TIMEOUT);
});
