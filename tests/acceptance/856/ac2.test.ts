import { describe, expect, it } from 'vitest';
import { ELLIPSIS, LONG_2000, TEXT_BIN, fitShapingFailures, named, num, obj, runLines, shape, useRelease, type JsonObject } from './helpers.ts';

useRelease('deep-text');

/** The fit: the 2,000-character string in a 300 px box on one line, ellipsized. */
const BOX_W = 300;
const FIT: JsonObject = { text: LONG_2000, size: 13, box: { w: BOX_W }, max_lines: 1, overflow: 'ellipsis' };

describe('AC2 an ellipsis fit shapes each candidate prefix at most once', () => {
  it('AC2 an ellipsis fit over a 2,000-character string shapes each candidate prefix at most once, and shows the longest prefix that fits', () => {
    const { replies } = shape([FIT]);
    const r = replies[0]!;
    // What it shows: a prefix of the string with the ellipsis, inside the box on one line.
    expect(r.shown.endsWith(ELLIPSIS), `the string over its one line is shown with an ellipsis: ${named(r.shown)}`).toBe(true);
    const prefix = r.shown.slice(0, -ELLIPSIS.length);
    expect(prefix.length > 0 && LONG_2000.startsWith(prefix), `the shown text ${named(r.shown)} is a prefix of the string and the ellipsis`).toBe(true);
    expect(r.width <= BOX_W + 0.01, `the shown text's width ${r.width} fits the ${BOX_W} px box`).toBe(true);
    // The longest such prefix: the next longer candidate doesn't fit (measured by the base's own fit check), so
    // a fit that shapes almost nothing and shows a short cut fails here.
    let next = prefix.length + 1;
    while (next <= LONG_2000.length && LONG_2000.slice(0, next).trimEnd().length <= prefix.length) next++;
    const candidate = `${LONG_2000.slice(0, next).trimEnd()}${ELLIPSIS}`;
    const measured = obj(runLines(TEXT_BIN, ['fit'], [{ text: candidate, size: 13, box: { w: BOX_W }, max_lines: 1, overflow: 'mask' }]).lines[0], 'fit of the next candidate');
    expect(measured['ok'], `fit answered ${JSON.stringify(measured)}`).toBe(true);
    expect(measured['fits'], `the next longer candidate ${named(candidate)} (${num(measured['width'], 'its width')} px) does not fit, so the shown prefix is the longest`).toBe(false);
    // The criterion: no candidate shaped twice.
    expect(fitShapingFailures(LONG_2000, r), 'the fit\'s shapings').toEqual([]);
  }, 1_800_000);

  it('AC2 the planted fit that shapes again per step fails, naming the count', () => {
    const { replies } = shape([FIT], 'reshaping_fit');
    const failures = fitShapingFailures(LONG_2000, replies[0]!);
    expect(failures.length, 'the planted fit fails the check').toBeGreaterThan(0);
    expect(failures.join('\n'), 'the failure names a text shaped more than once and how many times').toMatch(/shaped .+ ([2-9]|\d{2,}) times/);
    expect(failures.at(-1), 'the failure names the count of shapings').toMatch(/made \d+ shapings of \d+ distinct texts/);
  }, 1_800_000);
});
