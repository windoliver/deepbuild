// AC3 #167.0333a2fe: "With top 3 over five keys, a key whose standing goes from 3 to 4 between two periods slides
// below the third bar and reaches opacity 0 at the second period, and a key missing from the first period enters from
// opacity 0"
//
// 2000: a 50, b 40, c 30, d 20; e is missing. 2001: a 50, e 45, b 40, c 30, d 20. So c goes from 3 to 4 and e enters.
// Every 60 Hz frame of the one-second race through `geometry`. Bars stand side by side in standing order, so "slides
// below the third bar" is read along the standing axis: c moves steadily until it starts past the end of the bar at
// standing 3 (README: Readings). `raster` shows that the opacity reported is what's drawn. No upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import {
  AC, GROUND, INK, LOOK, RACE_SCALES, TIMEOUT, atChannel, column, document, frames60, near, passes, pixel, raceBars, rasterAt, readPng, rowsAt, same, useRender, useTemp, type Period, type Row,
} from './helpers.ts';

const render = useRender();
const temp = useTemp('standing');
const ID = AC[3];
const PERIODS: Period[] = [[2000, { a: 50, b: 40, c: 30, d: 20 }], [2001, { a: 50, e: 45, b: 40, c: 30, d: 20 }]];
const doc = document('top-167', 'A race with a top of three', [400, 280], 1, [...RACE_SCALES, raceBars(PERIODS, 3)], { channels: atChannel(2000, 1) });
const FRAMES = frames60(1);

describe(`${ID} past the top a key slides out and fades, and a missing key enters from opacity 0`, () => {
  it(`${ID} (leaves) c slides from standing 3 to 4, below the third bar, reaching opacity 0 at the second period, and d stays hidden`, () => {
    const bin = render();
    passes(bin, doc, LOOK, 'the race');
    const rows = rowsAt(bin, doc, 'race', FRAMES, LOOK);
    const c = rows.map((r) => r['c']!);
    near(column(c[0]!, 'standing', 'c at 2000'), 3, 1e-6, 'c at 2000');
    near(column(c.at(-1)!, 'standing', 'c at 2001'), 4, 1e-6, 'c at 2001');
    near(c[0]!.opacity, 1, 1e-6, 'c\'s opacity at 2000');
    near(c.at(-1)!.opacity, 0, 1e-6, 'c\'s opacity at 2001');
    const third = rows.at(-1)!['b']!;
    near(column(third, 'standing', 'b at 2001'), 3, 1e-6, 'the third bar at 2001 is b');
    expect(third.place.x2, 'the third bar has an end').not.toBeNull();
    expect(c.at(-1)!.place.x, 'c starts past the third bar at 2001').toBeGreaterThanOrEqual(third.place.x2!);
    const middle = c[30]!;
    near(column(middle, 'standing', 'c at 2000.5'), 3.5, 1e-4, 'c glides: its standing at 2000.5');
    expect(middle.opacity > 0 && middle.opacity < 1, `c fades, not pops: opacity ${middle.opacity} at 2000.5`).toBe(true);
    c.slice(1).forEach((r, i) => {
      expect(r.place.x, `c never slides back, frame ${i + 1}`).toBeGreaterThanOrEqual(c[i]!.place.x - 1e-6);
      expect(r.opacity, `c never comes back, frame ${i + 1}`).toBeLessThanOrEqual(c[i]!.opacity + 1e-6);
    });
    expect(rows.map((r) => r['d']!.opacity).filter((o) => o !== 0), 'd is past the top throughout').toEqual([]);
  }, TIMEOUT);

  it(`${ID} (enters) e, missing from 2000, enters from opacity 0 at its 2001 value, fully shown at 2001`, () => {
    const e = rowsAt(render(), doc, 'race', FRAMES, LOOK).map((r) => r['e']!);
    near(e[0]!.opacity, 0, 1e-6, 'e\'s opacity at 2000');
    near(e.at(-1)!.opacity, 1, 1e-6, 'e\'s opacity at 2001');
    expect(e[30]!.opacity > 0 && e[30]!.opacity < 1, `e fades in: opacity ${e[30]!.opacity} at 2000.5`).toBe(true);
    e.forEach((r, i) => near(column(r, 'value', `e, frame ${i}`), 45, 1e-4, `e holds its neighboring period's value, frame ${i}`));
    e.slice(1).forEach((r, i) => expect(r.opacity, `e never fades back, frame ${i + 1}`).toBeGreaterThanOrEqual(e[i]!.opacity - 1e-6));
  }, TIMEOUT);

  it(`${ID} (drawn) c's bar is drawn at 2000 and gone at 2001`, () => {
    const bin = render();
    const ends = [0, FRAMES.at(-1)!];
    const [at0, at1] = rowsAt(bin, doc, 'race', ends, LOOK);
    const inside = (r: Row): [number, number] => [(r.place.x + r.place.x2!) / 2, r.place.y + 20];
    const [first, last] = rasterAt(bin, doc, ends, LOOK, temp(), 'top');
    expect(same(pixel(readPng(first!.out), ...inside(at0!['c']!)), INK), 'c\'s bar at 2000 is ink').toBe(true);
    expect(same(pixel(readPng(last!.out), ...inside(at1!['c']!)), GROUND), 'c\'s place at 2001 shows the ground').toBe(true);
  }, TIMEOUT);
});
