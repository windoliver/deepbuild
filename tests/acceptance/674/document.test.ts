import { describe, expect, it } from 'vitest';
import {
  check, checkerDoc, checkerPng, clone, gpuiAnswerOf, imageCaches, put, rasterAnswerOf, scratch, session, useBinaries, type JsonObject, type JsonValue,
} from './helpers.ts';

useBinaries('deep-canvas-render');
const dir = scratch('document');
const asset = put(dir, checkerPng());
/** The item every document here names, so a refusal's path is `items/checker/params/sampling`. */
const PATH = 'items/checker/params/sampling';

describe('AC4 a sampling value other than linear, nearest and cubic is refused, naming items/<id>/params/sampling', () => {
  // Vello's own names for its samplers, a capital, a typo, an empty string, a number and a list: none is one of the three.
  const WRONG: JsonValue[] = ['bilinear', 'bicubic', 'Nearest', 'lanczos', '', 3, ['nearest']];

  it('AC4 the check refuses each wrong value with an error naming the field, and passes the three values and no field', () => {
    for (const value of WRONG) {
      const result = check(checkerDoc(asset, { sampling: value }));
      const errors = result.issues.filter((i) => i.severity === 'error');
      expect(result.ok, `check of sampling ${JSON.stringify(value)}: refused`).toBe(false);
      expect(errors.map((e) => e.path), `check of sampling ${JSON.stringify(value)}: an error names the field`).toContain(PATH);
    }
    for (const value of [undefined, 'linear', 'nearest', 'cubic']) {
      const result = check(checkerDoc(asset, { sampling: value }));
      expect(result.issues.filter((i) => i.severity === 'error').map((e) => `${e.code} ${e.path}`), `check of sampling ${JSON.stringify(value)}: no error`).toEqual([]);
      expect(result.ok, `check of sampling ${JSON.stringify(value)}: passes`).toBe(true);
    }
  }, 300_000);

  it('AC4 Vello CPU raster and GPUI refuse a wrong value too, naming the field, and write no picture', () => {
    for (const value of WRONG) {
      const doc = checkerDoc(asset, { sampling: value });
      const raster = rasterAnswerOf(dir, doc, { zoom: 1 }).out;
      expect(raster['ok'], `raster of sampling ${JSON.stringify(value)}: refused`).toBe(false);
      expect(JSON.stringify(raster), `raster of sampling ${JSON.stringify(value)}: the refusal names the field`).toContain(PATH);
      const view = gpuiAnswerOf(dir, doc, { zoom: 1 }).out;
      expect(view['ok'], `GPUI render of sampling ${JSON.stringify(value)}: refused`).toBe(false);
      expect(JSON.stringify(view), `GPUI render of sampling ${JSON.stringify(value)}: the refusal names the field`).toContain(PATH);
    }
  }, 300_000);
});

describe('AC4 a document whose only change is its sampling gets a new content key for that image', () => {
  it('AC4 nearest, cubic and linear each have their own key; the same sampling has the same key; no field is linear', () => {
    const of = (sampling: string | undefined): JsonObject => clone(checkerDoc(asset, { sampling }));
    const steps = [undefined, 'nearest', 'cubic', 'linear', 'nearest'].map((s) => ({ doc: of(s), t: 0, frames: 1 }));
    const reports = session(dir, steps, 'GPUI session over five revisions that differ only in the image\'s sampling');
    const [none, nearest, cubic, linear, nearestAgain] = reports.map((r, i) => {
      const entry = imageCaches(r, i).get('checker');
      expect(entry, `steps[${i}].caches.images holds an entry for the image item "checker"`).toBeDefined();
      return entry!.key;
    }) as [string, string, string, string, string];
    expect(nearest, 'sampling nearest has a new content key against no field').not.toBe(none);
    expect(cubic, 'sampling cubic has a new content key against no field').not.toBe(none);
    expect(cubic, 'sampling cubic has a new content key against nearest').not.toBe(nearest);
    expect(linear, 'sampling linear is the default: the key of no field').toBe(none);
    expect(nearestAgain, 'the same document again, sampling nearest: the same key as before').toBe(nearest);
  }, 300_000);
});
