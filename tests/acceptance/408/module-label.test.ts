// #408.022d8403: "In a 1920×1080 film, a label of a test canvas module's kind that contributes to the core's glyph-box
// array, crossed by an axis line from 2.0 s to 3.5 s, fails layout.crossing once, naming the label, the axis and t =
// 2.0 s, with film.layout unchanged; and a planted film.layout that selects text by the kinds text@1, vector@1,
// mark.text and counter misses the label and fails this"
//
// Fixture (helpers.ts: `crossingFilm` with `probeLabel`): criterion 1's film, cue ends 1, 2, 2.5, 3.5 and 4.5 s, with
// its label replaced by `probe-label`, an item of `test.label@1`, the kind of the test canvas module `test.label` that
// the build `full,test-glyph-label` adds (README: The test canvas module). Its glyph box, 100 × 32 u centred on
// (616, 500), is all it contributes, to the core's glyph-box array; it draws no stroke or fill. The axis@1 line drawn
// under it moves through its middle at 2.0 s and away at 3.75 s. The film declares `requires.modules: {test.label}`.
//
// asserts: in `full,test-glyph-label` on this Mac, the requirement `{kind: film.layout}` FAILs with exactly one
// layout.crossing, an error, naming probe-label as its text and x-axis as its stroke, t = 2.0 s; and film.layout is
// unchanged by the module: no Rust source outside crates/deep-canvas-test-modules names the kind `test.label`. The
// planted `layout_text_by_kind` (the scenario's `planted`: film.layout's text is the items of kind text@1, vector@1,
// mark.text and counter) misses the label and fails the same check, naming probe-label.
import { describe, it } from 'vitest';
import {
  AC, AXIS, LABEL_BUILD, PROBE, TIMEOUT, crossingFailures, crossingFilm, docId, failsNaming, judge, none, probeLabel, rustNaming, useBuilds, useFolders,
  type Film,
} from './helpers.ts';

const bin = useBuilds([LABEL_BUILD]);
const folder = useFolders();
const FILM: Film = { name: "the test module's label crossed by the axis line", doc: docId(1), document: crossingFilm(docId(1), probeLabel(), ['test.label']) };
const crossed = (planted?: string): string[] =>
  crossingFailures(judge(bin(LABEL_BUILD), folder(), [FILM], planted ? { planted } : {}).rows[FILM.name], PROBE, AXIS, 2, null);

describe(`${AC[4]} film.layout finds text through the core's glyph-box array, so a test module's label is checked with film.layout unchanged`, () => {
  it(`${AC[4]} the test module's label crossed by the axis line from 2.0 s to 3.5 s fails layout.crossing once at t = 2.0 s, and no Rust source outside the test module names its kind`, () => {
    none(crossed(), FILM.name);
    none(rustNaming('test.label', ['crates/deep-canvas-test-modules']).map((f) => `${f} names the test kind test.label, so film.layout is not unchanged by it`), 'film.layout unchanged');
  }, TIMEOUT);

  it(`${AC[4]} a planted film.layout that selects text by the kinds text@1, vector@1, mark.text and counter misses the label and fails this, naming probe-label`, () => {
    failsNaming(crossed('layout_text_by_kind'), [PROBE], 'film.layout selecting text by kind');
  }, TIMEOUT);
});
