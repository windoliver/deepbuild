// AC1 #1966.3e2ae44d: A highlight on lines 3 to 5 dims every other line to 40% opacity, and a path attached to
// `#line:4` ends at that line's box edge within 0.5 u while the code scrolls
//
// Two tests, one per half. The code is a seven-line function (README: Documents) under `highlight: [{lines: [3, 5]}]`
// in its default treatment. (dims) Through `raster`: each line's ink, as a share of the same line drawn with no
// highlight, is the share the item drawn at `adjust.opacity` 0.4 keeps on lines 1, 2, 6 and 7, and all of it on lines 3
// to 5. (anchor) The same code scrolls up 100 u over 2 s while a path from a fixed start is attached to `cfg#line:4`
// with no gap; through `path` and `geometry` at eight times, the path's end lies on the edge of the box `geometry` gives
// for `cfg#line:4` within 0.5 u, and that box is line 4's where the scroll has put it. Each test first shows its judge
// rejects the planted wrong programs (README: Wrong programs), built from the binary's own answers.
import { describe, expect, it } from 'vitest';
import {
  AC, ANCHOR, CODE, HIGHLIGHT, LINES, LOOK, START, STILL_AT, accepted, bandsOf, boxHit, boxesAt, dimFailures, endFailures,
  failsNaming, film, fl, glyphsIn, none, pathEnds, rangesIn, rasterAll, scrollY, spliced, still, useBin, useDir,
  FILM_X, type Box, type LineAt, type Pt,
} from './helpers.ts';

const ID = AC[1];
const bin = useBin('deep-canvas-render');
const dir = useDir();

describe(`${ID} a highlight on lines 3 to 5`, () => {
  it(`${ID} (dims) dims every other line to 40% opacity and keeps lines 3 to 5 whole`, () => {
    const [lit, full, at40, at50] = rasterAll(bin(), dir(), [
      still('highlight-1966', { highlight: HIGHLIGHT }), still('plain-1966'), still('at40-1966', { opacity: 0.4 }), still('at50-1966', { opacity: 0.5 }),
    ], LOOK).map((d, i) => accepted(d, ['with the highlight', 'with no highlight', 'at opacity 0.4', 'at opacity 0.5'][i]!));
    const bands = bandsOf(full!, STILL_AT, LINES);
    const [im, whole, forty, fifty] = [lit!.image!, full!.image!, at40!.image!, at50!.image!];
    // The reference is dimmed: at opacity 0.4 every line keeps visibly less than the whole of its ink.
    expect(dimFailures(whole, whole, forty, bands, [0, 0]).length, 'the item at opacity 0.4 dims every line').toBe(LINES.length);

    failsNaming(dimFailures(whole, whole, forty, bands, [3, 5]), 'line 1 keeps 1.00', 'a renderer that ignores the highlight');
    failsNaming(dimFailures(forty, whole, forty, bands, [3, 5]), 'line 4 keeps', 'one that dims every line, the highlighted ones too');
    failsNaming(dimFailures(fifty, whole, forty, bands, [3, 5]), 'line 6 keeps', 'one that dims the other lines to 50%');
    failsNaming(dimFailures(spliced(whole, forty, bands, [2, 4]), whole, forty, bands, [3, 5]), 'line 2 keeps', 'one that keeps lines 2 to 4');

    none(dimFailures(im, whole, forty, bands, [3, 5]), 'the code with lines 3 to 5 highlighted: each line\'s share of its ink');
  });

  it(`${ID} (anchor) a path attached to ${ANCHOR} ends at that line's box edge within 0.5 u at every time while the code scrolls`, () => {
    const seconds = [0, 0.37, 0.5, 1, 1.13, 1.5, 1.71, 2];
    const times = seconds.map(fl);
    // Where line 4 is: the glyphs' baselines and x from the code's own origin (raster at 0 s), moved by the scroll.
    const [drawn] = rasterAll(bin(), dir(), [film(false)], LOOK, undefined, CODE).map((d) => accepted(d, 'the scrolling code at 0 s'));
    const ranges = rangesIn(drawn!.shown, LINES, 'the code');
    const rows = [2, 3, 4].map((i) => glyphsIn(drawn!, ranges[i]!));
    const lineAt = (s: number): LineAt => ({
      b3: scrollY(s) + rows[0]![0]!.y, b4: scrollY(s) + rows[1]![0]!.y, b5: scrollY(s) + rows[2]![0]!.y,
      x0: FILM_X + Math.min(...rows[1]!.map((g) => g.x)), x1: FILM_X + Math.max(...rows[1]!.map((g) => g.x + g.advance)),
    });

    // The planted wrong programs, from the boxes `geometry` gives at each time (README: Wrong programs).
    const asks: [string, number][] = times.flatMap((t) => [[ANCHOR, t], [`${CODE}#line:5`, t], [CODE, t]] as [string, number][]);
    const got = boxesAt(bin(), film(false), asks);
    const at = (k: number, i: number): Box => { const b = got[i * 3 + k]; expect(b, `geometry gives a box for ${asks[i * 3 + k]![0]} at ${seconds[i]} s`).toBeDefined(); return b!; };
    const plant = (box: (i: number) => Box, end: (i: number) => Pt): string[] => seconds.flatMap((s, i) => endFailures(`at ${s} s`, box(i), end(i), lineAt(s)));
    failsNaming(plant((i) => at(0, i), () => boxHit(at(0, 0), START)), 'from the edge of line 4\'s box', 'an end not re-solved while the code scrolls');
    failsNaming(plant((i) => at(0, i), (i) => boxHit(at(2, i), START)), 'from the edge of line 4\'s box', 'an end on the whole code item\'s box');
    failsNaming(plant((i) => at(1, i), (i) => boxHit(at(1, i), START)), 'doesn\'t hold line 4\'s baseline', '#line:4 read as the fifth line');
    failsNaming(plant(() => at(0, 0), () => boxHit(at(0, 0), START)), 'doesn\'t hold line 4\'s baseline', 'a line box that doesn\'t scroll with the code');

    // The film itself: the line's box from `geometry` and the path's end from `path`, at each time.
    const doc = film(true);
    const ends = pathEnds(bin(), doc, 'pointer', times);
    const boxes = boxesAt(bin(), doc, times.map((t) => [ANCHOR, t]));
    none(seconds.flatMap((s, i) => endFailures(`at ${s} s`, boxes[i], ends[i]!, lineAt(s))), `the path attached to ${ANCHOR} while the code scrolls`);
  });
});
