// AC5 #167.5cc51988: "A label set that reads a bar set's rows through rows_of puts each label at its bar's end within
// 0.5 u at every frame of the race"
//
// AC1's race, whose `labels` set has no rows or columns of its own: `rows_of: "race"`. At each 60 Hz frame, `geometry`
// answers each set's rows. Bars stand side by side, so a bar's end is the top of its middle: ((x + x2) / 2, y); a label
// is placed at (standing through `mid`, value through `ys`). A label set that read the bars' raw rows, or that lagged by
// a frame, misses in the middle of the race. No upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import { AC, LOOK, TIMEOUT, column, frames60, passes, raceDoc, rowsAt, useRender } from './helpers.ts';

const render = useRender();
const ID = AC[5];
const doc = raceDoc();

describe(`${ID} labels read the bars' rows through rows_of`, () => {
  it(`${ID} each label is at its bar's end within 0.5 u at every frame of the race`, () => {
    const bin = render();
    passes(bin, doc, LOOK, 'the race');
    const frames = frames60(1);
    const bars = rowsAt(bin, doc, 'race', frames, LOOK);
    const labels = rowsAt(bin, doc, 'labels', frames, LOOK);
    frames.forEach((_, f) => {
      expect(Object.keys(labels[f]!).sort(), `frame ${f}: one label per bar, by key`).toEqual(Object.keys(bars[f]!).sort());
      for (const [key, bar] of Object.entries(bars[f]!)) {
        const label = labels[f]![key]!;
        expect(bar.place.x2, `frame ${f}: ${key}'s bar has an end`).not.toBeNull();
        const off = Math.hypot(label.place.x - (bar.place.x + bar.place.x2!) / 2, label.place.y - bar.place.y);
        expect(off, `frame ${f}: ${key}'s label is at its bar's end`).toBeLessThanOrEqual(0.5);
        expect(column(label, 'value', key), `frame ${f}: ${key}'s label holds its bar's mixed value`).toBe(column(bar, 'value', key));
      }
    });
    expect(column(bars[15]!['a']!, 'value', 'a'), 'the frames reach the middle of a mix').toBeCloseTo(17.5, 3);
  }, TIMEOUT);
});
