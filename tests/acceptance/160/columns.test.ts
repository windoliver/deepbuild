// AC8: "A path whose `opacity` column is one row short of its points is refused with `column_length`, naming the
// column; a union of a path with an `opacity` column and one without draws the joined points at opacity 1; a planted
// merge that zero-fills draws them invisible and fails by evaluated value, naming the column"
//
// Through `check`, `raster` and `path`. Per-point columns are written in the mark set's column form (`{dtype: "f32",
// len, data}`, base64 of little-endian values); a path's point count is its points, here M and L vertices only. The
// union is a group's union outline (Frame and group: union outline), whose `path` frame reports its joined rows as
// `columns` (its children's rows in draw order; README: The surface under test). The planted merge is
// `merge_zero_fills` (`path` and `raster`): the new rows of a column a part lacks are zero-filled instead of taking
// the column's default.
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, check, errorsOf, expectClean, expectRefused, f32Column, failsNaming, figure, item, none, pathAt, pathItem,
  pixel, raster, rasterInput, role, same, scratch, useRenderBinary, WHITE, type JsonObject, type PathFrame,
} from './helpers.ts';

useRenderBinary();
const dir = scratch('columns');
const FOUR = 'M 20 50 L 120 50 L 220 50 L 320 50'; // four points

function short(column: 'opacity' | 'width'): JsonObject {
  const values = column === 'opacity' ? [1, 0.5, 0.25] : [4, 6, 8];
  return figure(`columns-${column}`, [360, 120], [pathItem('stroke', 'a0', FOUR, { [column]: f32Column(values) })]);
}

// The union: p1 has an opacity column, p2 has none; both are children of a group with a union outline.
const OPACITY = [0.25, 0.5, 0.75, 1];
const union = figure('columns-union', [360, 240], [
  item('pair', 'group@1', 'a0', { outline: { kind: 'union', width: 3, role: 'rim' } }),
  pathItem('p1', 'a1', FOUR, { opacity: f32Column(OPACITY), paint: { stroke: { role: 'ink', width: 8 } } }, { parent: 'pair' }),
  pathItem('p2', 'a2', 'M 40 160 L 180 160 L 320 160', { paint: { stroke: { role: 'ink', width: 8 } } }, { parent: 'pair' }),
]);

/** The evaluated check of the union's joined rows: p1's four values, then p2's three at the column's default, 1. */
function joinedFailures(f: PathFrame): string[] {
  const got = f.columns?.['opacity'];
  if (!got) return ['the union reports no joined opacity column'];
  const want = [...OPACITY, 1, 1, 1];
  const failures: string[] = [];
  if (got.length !== want.length) failures.push(`the joined opacity column has ${got.length} rows, not ${want.length}`);
  want.forEach((w, i) => { if (!(Math.abs((got[i] ?? NaN) - w) <= 1e-6)) failures.push(`row ${i} of the joined opacity column evaluates to ${got[i]}, not ${w}${i >= 4 ? ' (the column\'s default, for a part that has none)' : ''}`); });
  return failures;
}

describe('AC8 per-point columns never zero-fill', () => {
  for (const column of ['opacity', 'width'] as const) {
    it(`AC8 a path whose ${column} column is one row short of its points is refused with column_length, naming the column`, () => {
      const doc = short(column);
      const errors = errorsOf(check(doc));
      expect(errors.map((e) => e.code), 'the only error is the column\'s length').toEqual(['column_length']);
      expect(errors[0]!.ids, 'it names the path').toContain('stroke');
      expect(errors[0]!.path, 'it names the column').toBe(`items/stroke/params/${column}`);
      expectRefused('raster', rasterInput(dir, doc), 'column_length', `the ${column} column has 3 rows for 4 points`);
      // The same column at its points' length passes.
      const fit = figure('columns-fit', [360, 120], [pathItem('stroke', 'a0', FOUR, { [column]: f32Column(column === 'opacity' ? [1, 0.5, 0.25, 1] : [4, 6, 8, 4]) })]);
      expectClean(fit, `a ${column} column of four rows`);
    }, TIMEOUT);
  }

  it('AC8 a union of a path with an opacity column and one without draws the joined points at opacity 1', () => {
    expectClean(union, 'the union');
    none(joinedFailures(pathAt(union, 'pair', 'the union')), 'the union\'s joined rows');
    const { image } = raster(dir, union, 'the union');
    expect(pixel(image, 110, 160), 'p2, which has no opacity column, draws in full ink').toEqual(role('ink'));
  }, TIMEOUT);

  it('AC8 a planted merge that zero-fills draws the joined points invisible and fails by evaluated value, naming the column', () => {
    const { image } = raster(dir, union, 'the union under the planted merge', 0, { planted: 'merge_zero_fills' });
    expect(same(pixel(image, 110, 160), WHITE), `under the plant p2 draws invisible: ${JSON.stringify(pixel(image, 110, 160))}`).toBe(true);
    failsNaming(joinedFailures(pathAt(union, 'pair', 'the union under the planted merge', 0, { planted: 'merge_zero_fills' })), ['opacity column'], 'the planted merge');
  }, TIMEOUT);
});
