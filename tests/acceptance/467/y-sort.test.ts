// AC3 #467.2c11652d: The isometric sorting line orders its figures by foot position at every t, ties by order key then
// ID, and the same order results from playing and seeking
//
// The sorting line (helpers.ts `sortingLine`): six solid figures in a `sort: y` group, two walking past four that
// stand, with ties at 2 s and two standing ties all the time, one decided by order key against ID and one by ID with the
// later ID written first. At 121 frame times and 40 seeded off-grid times, each drawn by `deep-canvas-render raster`
// (Vello CPU, every platform) in one process (a play), every pixel at least 1 px from every figure's edge must show the
// figure the criterion's order puts on top there, or the floor. Eleven of those times, each drawn in a fresh process (a
// seek), must give the played bytes.
import { describe, expect, it } from 'vitest';
import {
  AC, FIGURES, LINE_SIZE, LINE_SPAN, boxAt, fl, footOrder, keyedAt, px, rasterLine, render, drawn, role, seeded,
  sortingLine, useBin, useDir, type Image,
} from './helpers.ts';

const ID = AC[3];
const bin = useBin('deep-canvas-render');
const dir = useDir();

/** Where the order at `t` shows the wrong figure, at pixel centers clear of every edge by 1 px. */
function orderProblems(image: Image, t: number): string[] {
  const order = footOrder(t);
  const boxes = order.map((f) => ({ f, b: boxAt(f, t) }));
  const problems: string[] = [];
  for (let y = 0; y < LINE_SIZE[1]; y++) for (let x = 0; x < LINE_SIZE[0]; x++) {
    const cx = x + 0.5; const cy = y + 0.5;
    const inside = (b: number[], m: number): boolean => cx > b[0]! + m && cx < b[0]! + b[2]! - m && cy > b[1]! + m && cy < b[1]! + b[3]! - m;
    if (boxes.some(({ b }) => inside(b, -1) && !inside(b, 1))) continue;
    const top = [...boxes].reverse().find(({ b }) => inside(b, 0));
    const want = role(top ? top.f.role : 'paper');
    const got = px(image, x, y);
    if (got[0] !== want[0] || got[1] !== want[1] || got[2] !== want[2]) {
      problems.push(`at ${t} flicks, pixel (${x}, ${y}) shows [${got.slice(0, 3).join(', ')}], not ${top ? `figure ${top.f.id}` : 'the floor'} [${want.join(', ')}]; the order by foot, order key and ID is ${order.map((f) => f.id).join(' < ')}`);
      if (problems.length > 5) return problems;
    }
  }
  return problems;
}
/** Two figures whose feet differ, but by less than 1e-3 u, at `t`: a time too close to a crossing to judge. */
function nearTie(t: number): boolean {
  const feet = FIGURES.map((f) => keyedAt(f.y, t));
  return feet.some((a, i) => feet.some((b, j) => j > i && a !== b && Math.abs(a - b) < 1e-3));
}

describe(`${ID} the isometric sorting line`, () => {
  it(`${ID} orders its figures by foot position at every t, ties by order key then ID, and seeking gives the played order`, () => {
    const rand = seeded(467);
    const frames = Array.from({ length: LINE_SPAN * 30 + 1 }, (_, k) => fl(k / 30));
    const off = Array.from({ length: 200 }, () => Math.floor(rand() * fl(LINE_SPAN))).filter((t) => !nearTie(t)).slice(0, 40);
    expect(off.length, 'forty off-grid times clear of a crossing').toBe(40);
    const times = [...new Set([...frames, ...off])].sort((a, b) => a - b);
    expect(times, 'the play holds 2 s, where the walkers\' feet meet each other and the standing pair\'s').toContain(fl(2));
    const doc = sortingLine();
    // The play: one process drawing each time in order.
    const lines = times.map((t) => rasterLine(dir(), doc, t));
    const answers = render(bin(), 'raster', lines);
    const play = lines.map((l, i) => drawn(l, answers[i], `the sorting line at ${times[i]} flicks`).image);
    const problems = times.flatMap((t, i) => orderProblems(play[i]!, t));
    expect(problems, `the figures draw in foot order at every time:\n${problems.slice(0, 20).join('\n')}`).toEqual([]);

    const seeks = [fl(2), frames[30]!, frames[90]!, ...off.slice(0, 8)];
    for (const t of seeks) {
      const line = rasterLine(dir(), doc, t);
      const seek = drawn(line, render(bin(), 'raster', [line])[0], `the sorting line sought to ${t} flicks`).image;
      const at = times.indexOf(t);
      const same = seek.rgba.length === play[at]!.rgba.length && seek.rgba.every((v, k) => v === play[at]!.rgba[k]);
      expect(same, `at ${t} flicks the seek, in a fresh process, draws the play's pixels`).toBe(true);
    }
  });
});
