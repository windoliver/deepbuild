// #399.53449721: 1,000,000 rows of seeded noise with one spike row at 1.0, drawn into 3,000 columns without
// antialiasing, equal the line drawn from all rows pixel for pixel; the crosshair at the spike's x reads the raw row; a
// planted decimator that keeps only first and last, and one that keeps only min and max, each differ from the full
// line and fail, naming the column.
//
// `deep-canvas-render raster` (with this suite's `antialias: false`), `crosshair` and `geometry`'s `series.rows`
// (README). The Oracle lane: tsdownsample's M4 test data (100 rising values into 12 = 3 bins × 4) run against our
// decimator, and its Python reference, ported in helpers.ts, against the million rows.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SERIES_COLUMNS, SPIKE, accepted, cleanLook, columnOf, differingColumns, expectBadPlanted, f32, groundOf, m4Reference, readPng, rgbAt, seriesData,
  seriesDoc, seriesRows, useBins, useTemp, type Image, type JsonObject,
} from './helpers.ts';

const ID = '#399.53449721';
const render = useBins(['deep-canvas-render']);
const temp = useTemp('series');

function raster(name: string, doc: JsonObject, planted?: string): Image {
  const out = join(temp(), `${name}.png`);
  accepted(render('deep-canvas-render'), ['raster'], { out, doc, look: cleanLook(render('deep-canvas-render')), t: 0, antialias: false, ...(planted ? { planted } : {}) }, `raster ${name}`);
  const im = readPng(out);
  expect([im.width, im.height], `${name}: the PNG is the document's size`).toEqual([SERIES_COLUMNS, 400]);
  return im;
}
/** null when two pictures are equal pixel for pixel, else the first column where they differ. */
function pixelProblem(decimated: Image, full: Image): string | null {
  const cols = differingColumns(decimated, full);
  return cols.length === 0 ? null : `column ${cols[0]} differs from the full line (${cols.length} columns differ)`;
}
const spikeX = (): number => {
  const { t } = seriesData();
  return (Number(t[SPIKE]! - t[0]!) / Number(t.at(-1)! - t[0]!)) * SERIES_COLUMNS;
};

describe(`${ID} a million rows decimated per pixel column draw the full line`, () => {
  it(`${ID} the M4 line equals the full line pixel for pixel, the crosshair at the spike reads the raw row, and the decimator keeps tsdownsample's rows`, () => {
    const { t, v } = seriesData();
    const full = raster('full', seriesDoc('none'));
    const m4 = raster('m4', seriesDoc('m4'));
    // The line is drawn: every column has ink, and the spike's column reaches highest.
    const ground = groundOf(full);
    const top = Array.from({ length: SERIES_COLUMNS }, (_, x) => { for (let y = 0; y < full.height; y++) if (rgbAt(full, x, y) !== ground) return y; return Infinity; });
    expect(top.filter((y) => y === Infinity).length, 'the full line draws in every column').toBe(0);
    const spikeCol = columnOf(t[SPIKE]!, t[0]!, t.at(-1)!, SERIES_COLUMNS);
    expect(top.every((y, x) => x === spikeCol || y > top[spikeCol]!), `the spike's column ${spikeCol} reaches higher than any other`).toBe(true);
    expect(pixelProblem(m4, full), 'the M4 line equals the line drawn from all rows, pixel for pixel').toBeNull();

    // The crosshair snaps to the nearest raw row, never a decimated vertex.
    const look = cleanLook(render('deep-canvas-render'));
    const at = accepted(render('deep-canvas-render'), ['crosshair'], { doc: seriesDoc('m4'), look, item: 's', x: spikeX() }, 'the crosshair at the spike');
    expect([at['row'], at['t'], at['v']], 'at the spike\'s x the crosshair reads the spike\'s raw row').toEqual([SPIKE, Number(t[SPIKE]!), 1]);
    const near = SPIKE + 100;
    const kept = new Set(m4Reference(t, v, t[0]!, t.at(-1)!, SERIES_COLUMNS));
    expect(columnOf(t[near]!, t[0]!, t.at(-1)!, SERIES_COLUMNS) === spikeCol && !kept.has(near), `row ${near} shares the spike's column and is none of its first, min, max or last`).toBe(true);
    const x = (Number(t[near]! - t[0]!) / Number(t.at(-1)! - t[0]!)) * SERIES_COLUMNS;
    const raw = accepted(render('deep-canvas-render'), ['crosshair'], { doc: seriesDoc('m4'), look, item: 's', x }, `the crosshair at row ${near}`);
    // A crosshair that reads the decimated line answers one of the column's M4 rows here.
    expect([raw['row'], raw['v']], `at row ${near}'s x the crosshair reads that raw row`).toEqual([near, f32(v[near]!)]);

    // Oracle: tsdownsample's test_m4_scalar_with_x_correct, 100 rising values into 3 bins: 0, 0, 33, 33, 34, 34, 66, 66, 67, 67, 99, 99.
    const rising = { t: Array.from({ length: 100 }, (_, i) => BigInt(i)), v: Array.from({ length: 100 }, (_, i) => i) };
    expect([...new Set(m4Reference(rising.t, rising.v, 0n, 99n, 3))], 'the ported reference gives tsdownsample\'s indices').toEqual([0, 33, 34, 66, 67, 99]);
    const small = seriesRows(accepted(render('deep-canvas-render'), ['geometry'], { doc: seriesDoc('m4', rising, 3, 10), look, item: 's' }, 'geometry of the rising series'));
    expect(small, 'our decimator keeps tsdownsample\'s rows for 100 rising values in 3 columns').toEqual([0, 33, 34, 66, 67, 99]);
    const rows = seriesRows(accepted(render('deep-canvas-render'), ['geometry'], { doc: seriesDoc('m4'), look, item: 's' }, 'geometry of the million-row series'));
    expect(rows, 'and the reference\'s rows (first, min, max and last per column) for the million rows').toEqual([...kept].sort((a, b) => a - b));
  });

  it(`${ID} a planted decimator that keeps only first and last differs from the full line and fails, naming the column`, () => {
    const { t } = seriesData();
    const full = raster('full', seriesDoc('none'));
    const planted = raster('first-last', seriesDoc('m4'), 'decimate_first_last');
    expect(pixelProblem(planted, full), 'the pixel comparison fails on the planted decimator, naming the column').toMatch(/^column \d+ differs/);
    const spikeCol = columnOf(t[SPIKE]!, t[0]!, t.at(-1)!, SERIES_COLUMNS);
    expect(differingColumns(planted, full), 'it loses the spike\'s column').toContain(spikeCol);
    expectBadPlanted(render('deep-canvas-render'), ['raster'], { out: join(temp(), 'bad.png'), doc: seriesDoc('m4'), look: cleanLook(render('deep-canvas-render')), t: 0, antialias: false });
  });

  it(`${ID} a planted decimator that keeps only min and max differs from the full line and fails, naming the column`, () => {
    const full = raster('full', seriesDoc('none'));
    const problem = pixelProblem(raster('min-max', seriesDoc('m4'), 'decimate_min_max'), full);
    expect(problem, 'the pixel comparison fails on the planted decimator, naming the column').toMatch(/^column \d+ differs/);
  });
});
