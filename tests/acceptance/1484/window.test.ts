// AC7 #1484.2d4b65dd: "A 13 u label at weight 700 in the body role draws in the live window with the glyph coverage of
// its Vello CPU snapshot, at #390's bar. On the merge base the window draws the default weight and this fails, naming
// the run"
//
// The label (`Hamburgefonts`, 13 u, weight 700, `font: body`) is the only thing in a figure drawn in the shipped clean
// look's dark theme at the reference window's scale, zoom 2 (26 device px a em, so the window draws it from the atlas),
// by GPUI's frame path (`deep-canvas-render render`, what the live window draws) and by Vello CPU (`raster`, its
// snapshot). "#390's bar" is read as the window's glyph run against Vello CPU's as the repo holds it since #390 made
// the atlas Vello CPU's raster: #385's first criterion, the run's summed coverage within 2% and its coverage centroid
// within 0.1 device px (README: Readings). At the base the atlas rasterizes the label at the variable face's default
// instance, 400, while the snapshot draws 700: the window's run holds about a third less coverage, and the failure
// names the run.
import { describe, expect, it } from 'vitest';
import { AC, TEXT, drawLine, lookColors, needsMac, picture, run, runName, runProblems, textDoc, useBin, useDir, type Item } from './helpers.ts';

const ID = AC[7];
const bin = useBin('deep-canvas-render');
const dir = useDir('deep-1484-window-');

const LABEL: Item = { id: 'label', text: TEXT, size: 13, weight: 700, pos: [8, 4] };

describe(`${ID} a 13 u label at weight 700 draws in the window with its Vello CPU snapshot's glyph coverage`, () => {
  it(`${ID} the window's run of the 13 u label at 700 holds Vello CPU's summed coverage within 2% and its centroid within 0.1 device px, at zoom 2`, () => {
    needsMac();
    const doc = textDoc('window-1484', [120, 28], [LABEL]);
    const live = drawLine(dir(), doc, 2);
    const snap = drawLine(dir(), doc, 2);
    const [g] = run(bin(), ['render'], [live]);
    const [v] = run(bin(), ['raster'], [snap]);
    const problems = runProblems(runName(LABEL), picture(live, g!, 'render (the window)'), picture(snap, v!, 'raster (Vello CPU)'), lookColors('dark'), 'at zoom 2');
    expect(problems, 'the window against Vello CPU\'s snapshot').toEqual([]);
  }, 1_800_000);
});
