// AC1 #1430.76f8be84: "Laying a text out at 100 widths in turn shapes each paragraph once, and a counter proves it. A
// planted cache keyed on width fails, naming the count"
//
// One `deep-text shape` process lays the long text (100 paragraphs, 51,299 bytes) out at the 100 widths in turn. The
// counter is each reply's `shaped`: every shaping made to answer the line, one entry per paragraph shaped (README). The
// first layout shapes each paragraph once; the 99 after it shape nothing. The scope's "both caches keep the existing
// byte bound and count hits" is read here too, from each reply's `caches`, since this run is where both caches work:
// 100 layout keys of one text, each reusing its shaped runs (README: Readings, 7). `--planted keyed_on_width` is the
// criterion's wrong program: one cache whose key holds the width, as at the base.
import { describe, expect, it } from 'vitest';
import {
  AC, LONG_TEXT, TIMEOUT, WIDTHS, cacheFailures, cachesOf, countIn, failsNaming, layoutAt, longTextFailures, none, shapeLines, useRelease,
  widthFailures,
} from './helpers.ts';

useRelease('deep-text');
const ID = AC[1];

describe(`${ID} a width change breaks lines again from the kept shaped runs and reshapes nothing`, () => {
  it(`${ID} laying a 50 KB text of 100 paragraphs out at 100 widths in turn shapes each paragraph once, as the shaping counter shows; both caches keep the existing byte bound and count their hits`, () => {
    none(longTextFailures(), 'the long text');
    // The 100 layouts, then the last asked again at once, which the layout cache answers.
    const { raw, replies } = shapeLines([...WIDTHS.map((w) => layoutAt(LONG_TEXT, w)), layoutAt(LONG_TEXT, WIDTHS.at(-1)!)]);
    none(widthFailures(LONG_TEXT, WIDTHS, replies.slice(0, WIDTHS.length)), 'the shapings over 100 widths');
    none(cacheFailures(raw.map((line, i) => cachesOf(line, `shape line ${i + 1}`)), replies.at(-1)!), 'the shape and layout caches (the issue\'s scope)');
  }, TIMEOUT);

  it(`${ID} the planted cache keyed on width shapes the text again at each width and fails, naming the count`, () => {
    const { replies } = shapeLines(WIDTHS.map((w) => layoutAt(LONG_TEXT, w)), 'keyed_on_width');
    const failures = widthFailures(LONG_TEXT, WIDTHS, replies);
    failsNaming(failures, [/^line 2, laid out at 160 px, shaped [\d,]+ texts? again/], 'the planted cache keyed on width');
    expect(countIn(failures, /the 99 layouts after it made ([\d,]+) shapings?/, 'the planted cache keyed on width'), 'the count names a shaping at each of the 99 later widths').toBeGreaterThanOrEqual(99);
  }, TIMEOUT);
});
