// #408.6a23d77a: "In a 1920×1080 film whose axis line passes through a text@1 label from 2.0 s to 3.5 s, layout.crossing
// fails once, naming the label, the axis and t = 2.0 s with every cue end it holds; the twin with a 4 px paper halo
// passes, and a grid line drawn under the label never fails"
//
// Fixtures (helpers.ts): 1920 × 1080 films whose cue ends are 1, 2, 2.5 (a hold's), 3.5 and 4.5 s. `crossingFilm`: the
// text@1 label `speed-label` ("Speed", 32 u, centred on (616, 500)) drawn over the axis@1 `x-axis`, whose line runs
// from x = 100 to 1820 along y = 900; a hold-keyed channel moves it to y = 500, through the label's middle, at 2.0 s
// and back at 3.75 s, so it passes through the label at the cue ends 2, 2.5 and 3.5 s. The twin gives the label
// `halo: [{width: 4, role: ground}]`, the shipped looks' paper. `gridFilm`: an axis with grid lines along y = 536,
// 15 u below the label's box, the label over its first tick, so that tick's grid line runs up through the label; the
// axis drawn under the label, and, as the control that the grid line reaches the label, over it.
//
// asserts: one verdict per film on this Mac, each on one requirement `{kind: film.layout}`:
//   - crossed: FAIL, exactly one layout.crossing, an error, its text the label and its stroke the axis, t = 2.0 s and
//     ts = [2, 2.5, 3.5] s;
//   - the halo twin: PASS, nothing raised;
//   - the grid line under the label: PASS, nothing raised;
//   - control, the same axis drawn after the label: FAIL, one layout.crossing naming the label and the axis from the
//     first cue end, 1 s (design: only grid lines under a text are let off).
import { describe, it } from 'vitest';
import {
  AC, AXIS, CROSS_FIRST, CROSS_TIMES, FULL, LABEL, TIMEOUT, crossingFailures, crossingFilm, docId, gridFilm, judge, none, passFailures,
  speedLabel, useBuilds, useFolders, type Film,
} from './helpers.ts';

const bin = useBuilds([FULL]);
const folder = useFolders();

describe(`${AC[1]} an axis line through a text@1 label fails layout.crossing once; a halo and a grid line under it pass`, () => {
  it(`${AC[1]} the axis line through the label from 2.0 s to 3.5 s fails once at t = 2.0 s with every cue end it holds; the 4 px paper halo twin and the grid line under the label pass`, () => {
    const films: Film[] = [
      { name: 'the axis line through the label', doc: docId(1), document: crossingFilm(docId(1), speedLabel(false)) },
      { name: 'the twin with a 4 px paper halo', doc: docId(2), document: crossingFilm(docId(2), speedLabel(true)) },
      { name: 'the grid line under the label', doc: docId(3), document: gridFilm(docId(3), false) },
      { name: 'the grid line over the label', doc: docId(4), document: gridFilm(docId(4), true) },
    ];
    const { rows } = judge(bin(FULL), folder(), films);
    none(crossingFailures(rows[films[0]!.name], LABEL, AXIS, 2, CROSS_TIMES), 'the axis line through the label from 2.0 s to 3.5 s');
    none(passFailures(rows[films[1]!.name], films[1]!.name), 'the halo twin');
    none(passFailures(rows[films[2]!.name], films[2]!.name), 'the grid line drawn under the label');
    none(crossingFailures(rows[films[3]!.name], LABEL, AXIS, CROSS_FIRST, null), 'control: the same grid line drawn over the label crosses it');
  }, TIMEOUT);
});
