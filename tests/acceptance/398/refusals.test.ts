// AC1: A malformed or scripted SVG is refused with the reason.
import { describe, expect, it } from 'vitest';
import {
  check, errorsOf, expectClean, expectRasterRefused, listIssues, pixel, put, raster, role, same, scratch, useRenderBinary, vectorDoc, vectorItem,
} from './helpers.ts';

useRenderBinary();
const dir = scratch('refusals');

const COLORS = { '#000000': 'ink' };

function docFor(fixture: string): { doc: ReturnType<typeof vectorDoc>; store: string } {
  const src = put(dir, fixture);
  return { doc: vectorDoc(`ac1-${fixture}`, [100, 60], [vectorItem('art', { src, size: [100, 60], colors: COLORS })]), store: dir };
}

const CASES: [string, string, string][] = [
  ['malformed-unclosed.svg', 'svg_malformed', 'an element left open (a <g> never closed)'],
  ['malformed-not-xml.svg', 'svg_malformed', 'bytes that are not XML at all'],
  ['malformed-root.svg', 'svg_malformed', 'an XML document whose root is not <svg>'],
  ['scripted-script.svg', 'svg_script', 'a <script> element'],
  ['scripted-onload.svg', 'svg_script', 'an onload event attribute'],
  ['scripted-href.svg', 'svg_script', 'a javascript: link'],
];

describe('AC1 a malformed or scripted SVG is refused with the reason', () => {
  it('AC1 the clean twin of every refused fixture imports: the check passes and the raster draws its bar in ink', () => {
    const { doc, store } = docFor('clean.svg');
    expectClean(doc, store, 'clean.svg');
    const image = raster(dir, doc, store, 0, 'clean.svg');
    expect(same(pixel(image, 50, 30), role('ink')), `the bar's middle is ink, got ${JSON.stringify(pixel(image, 50, 30))}`).toBe(true);
    expect(same(pixel(image, 5, 5), role('ground')), 'outside the bar is the ground').toBe(true);
  });

  for (const [fixture, code, what] of CASES) {
    it(`AC1 ${fixture} (${what}) is refused with ${code}, naming the item, and is never drawn`, () => {
      const { doc, store } = docFor(fixture);
      const result = check(doc, store);
      const errors = errorsOf(result);
      expect(result.ok, `${fixture}: the check refuses it: ${JSON.stringify(listIssues(result.issues))}`).toBe(false);
      expect(errors.length, `${fixture}: at least one error`).toBeGreaterThan(0);
      expect(errors.map((e) => e.code), `${fixture}: every error carries the reason ${code}`).toEqual(errors.map(() => code));
      for (const e of errors) expect(e.ids, `${fixture}: the ${code} error names the item`).toContain('art');
      expectRasterRefused(dir, doc, store, code, `${fixture} holds ${what}`);
    });
  }
});
