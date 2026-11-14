// AC2 #1966.bbe0ca22: A 3-item bullet list wraps its second item's long line under its text, not under the marker
//
// One test. A `text@1` of three lines, `list: {marker: bullet}`, in a box 360 u wide whose height grows; the second
// line is long enough to wrap. Through `raster`: the glyphs give each item's visual lines (its glyphs by baseline) and
// the text's x; the PNG gives the markers (ink left of the second item's text). The second item takes two lines or
// more, each wrapped line starts at the x of its first line's text within 0.5 u, and each item has one marker left of
// its text, beside its first line, and none beside a wrapped line. The judge is first shown rejecting the planted wrong
// programs (README: Wrong programs): two drawn by the binary, one painted from the list's own picture.
import { describe, it } from 'vitest';
import { AC, LIST, LOOK, accepted, failsNaming, listDoc, listFailures, markerOnEveryLine, none, rasterAll, useBin, useDir, type Pt } from './helpers.ts';

const ID = AC[2];
const bin = useBin('deep-canvas-render');
const dir = useDir();

const ITEMS = ['Alpha', 'Bravo charlie delta echo foxtrot golf hotel india juliet', 'Kilo'];
const AT: Pt = [40, 30];

describe(`${ID} a bullet list's wrapped line`, () => {
  it(`${ID} a 3-item bullet list wraps its second item's long line under its text, not under the marker`, () => {
    const [list, plain, typed] = rasterAll(bin(), dir(), [
      listDoc('list-1966', ITEMS, { list: { marker: 'bullet' }, at: AT }),
      listDoc('plain-1966', ITEMS, { at: AT }),
      listDoc('typed-1966', ITEMS.map((t) => `• ${t}`), { at: AT }),
    ], LOOK, undefined, LIST).map((d, i) => accepted(d, ['the bullet list', 'the lines with no list', 'the lines with a bullet typed in'][i]!));

    failsNaming(listFailures(plain!, AT, ITEMS, 1), 'marker(s) left of the text', 'the lines drawn with no list (no marker)');
    failsNaming(listFailures(typed!, AT, ITEMS, 1), 'not under its text', 'a bullet typed into each line (the wrap goes under the marker)');

    none(listFailures(list!, AT, ITEMS, 1), 'the 3-item bullet list');
    failsNaming(listFailures(markerOnEveryLine(list!, AT, ITEMS, 1), AT, ITEMS, 1), 'wrapped line 2 has 1 marker(s)', 'the list with a marker beside every visual line');
  });
});
