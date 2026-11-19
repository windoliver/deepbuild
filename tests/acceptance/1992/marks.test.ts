// AC3 #1992.5703f3eb: Under the linear fixture, a world-size `mark.line` 0.1 m wide, a `mark.point` 0.2 m across and
// a camera-facing image mark, each unlit white at 30 m, read 0.75 within 1/255. The same marks with `fog: false`, and
// a `mark.text` label by default, read 1.0. A mark with a status binding reads its exact status color at 60 m under
// every curve, and a planted fog that tints it fails, naming the mark.
//
// The marks fixture (helpers: marksDoc): the linear fixture's sky (ID `sky`, black background, fog color 0.5, `linear
// {near: 10, far: 50}`); a camera at the origin looking along −Z through a long lens (fov 12° across 640 × 360, about
// 101 px to the metre at 30 m), so each mark is several px wide; and, each 30 m from the eye and painted the look's
// `white` (#ffffff, linear 1): `line`, a `mark.line@1` of one 1.2 m segment, `width: 0.1`, `size_space: world`;
// `point`, a `mark.point@1`, `size: 0.2`, `size_space: world`; `image`, a `mark.image@1` (README: The surface under
// test) of a white 8 × 8 PNG, 0.6 m square, `facing: camera`; and `label`, a `mark.text@1` reading TEXT in 1.2 m type,
// `size_space: world`. The line, the point and the image are read on the linear target at the pixel their own centre
// projects to; the label at every pixel its ink covers whole, found in the same document drawn with no fog.
//   1. Default fog: the line, the point and the image read 0.75 within 1/255. Fixture: each centre is 30 m from the
//      eye; by the pinhole each mark reaches at least 4 px to either side of its judged pixel; and the 5 × 5 pixels
//      around it read one value within 1/255 (no edge crosses them).
//   2. `fog: false` on the three: each reads 1.0 within 1/255, the same fixture checks. The label, with no `fog`
//      written, reads 1.0 on every pixel of its ink (40 or more, each 30 m from the eye within 0.2 m). Planted, by a
//      real field: the same document with `fog: true` on the label, the default the criterion rules out; the same
//      judge fails on its frame, naming the mark `label`.
//   3. Status: `bound`, a `mark.box@1` in the unlit white material 60 m from the eye, its badge slot bound to a verdict
//      whose state is `fail` (Status binding; #382's `status_bindings` and `states`). Under linear, exp at 0.0231 and
//      exp2 at 0.02775: the chip `view3d` reports for it holds the look's `fail` color, #bf232b, exactly, on the final
//      target (the color most of its box's pixels hold, 60 or more of them). Planted, on the CPU (README: Planted
//      programs): that color with the curve's share of the fog mixed in at 60 m, through the same judge, fails naming
//      the mark. And the fixture's fog does reach the mark: its body reads what the curve gives an unlit white
//      surface at 60 m (0.5, 0.625, 0.531) within 1/255, so the color is exact on a mark the fog covers.
// Wrong programs: the base (no fog on a line or a point, no image mark, no `fog` read); a mark fogged by its view
// depth; `fog: false` ignored; a label fogged by default; a status color fogged, tone mapped or blended with the fog.
import { describe, expect, it } from 'vitest';
import {
  AC, BOUND, CURVES, LABEL_ROWS_FROM, LINEAR, MARKS_SIZE, STATE, STATUS, STATUS_CAM, STATUS_SIZE, TOL, VERDICT, WHITE, clearMarksDoc, failsNaming, fmt, fogged, fromHex,
  judgeMarks, judgeStatus, labelPixels, markPixel, marksDoc, modal, none, off, only, readIds, readLinear, readPanel, readPng, requireMetal, runGpu,
  statusDoc, statusMark, tintedStatus, useBin, useDir, view3dCall, writeJson, writeWhitePng, type JsonObject, type Linear, type MarkReading,
} from './helpers.ts';

const bin = useBin();
const dir = useDir();
const THREE = ['line', 'point', 'image'] as const;

/** The line's, the point's and the image's readings at their judged pixels, and the fixture's problems there. */
function three(lin: Linear, what: string): { readings: MarkReading[]; problems: string[] } {
  const problems: string[] = [];
  const readings = THREE.map((id): MarkReading => {
    const { pixel, distance, halfPx } = markPixel(id);
    if (Math.abs(distance - 30) > 0.01) problems.push(`${what}: the mark \`${id}\`'s centre is ${distance.toFixed(3)} m from the eye, not 30 m`);
    if (halfPx < 4) problems.push(`${what}: the mark \`${id}\` reaches ${halfPx.toFixed(1)} px from (${pixel.join(', ')}), under 4 px`);
    const value = lin.at(pixel[0], pixel[1]);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const v = lin.at(pixel[0] + dx, pixel[1] + dy);
      if (Math.max(...[0, 1, 2].map((k) => Math.abs(v[k]! - value[k]!))) > TOL) { problems.push(`${what}: an edge of the mark \`${id}\` crosses the 5 × 5 pixels around (${pixel.join(', ')}): (${pixel[0] + dx}, ${pixel[1] + dy}) reads ${fmt(v)}, the judged pixel ${fmt(value)}`); dy = 3; break; }
    }
    return { mark: id, pixel, value };
  });
  return { readings, problems };
}
function marksCall(out: string, name: string, doc: JsonObject, image: { sha: string; path: string }): JsonObject {
  return view3dCall({ doc: writeJson(out, name, doc), size: MARKS_SIZE, targets: ['linear'], assets: { [image.sha]: image.path } });
}

describe(`${AC[3]} fog on unlit 3D marks, and never on a status color`, () => {
  it(`${AC[3]} under the linear fixture a world-size mark.line 0.1 m wide, a mark.point 0.2 m across and a camera-facing image mark, each white at 30 m, read 0.75 within 1/255`, () => {
    requireMetal();
    const out = dir();
    const image = writeWhitePng(out);
    const [reply] = runGpu(bin(), out, [marksCall(out, 'marks-default', marksDoc(LINEAR.sky, image.sha), image)]);
    const lin = readLinear(out, only(reply!, 'the marks, default fog'), MARKS_SIZE, 'the marks, default fog');
    const { readings, problems } = three(lin, 'default fog');
    expect(fogged(LINEAR.share(30)), 'the linear curve gives 0.75 at 30 m').toBe(0.75);
    console.log(`${AC[3]} default fog: ${readings.map((r) => `${r.mark} reads ${fmt(r.value)}`).join('; ')}`);
    none(judgeMarks(readings, 0.75, 'by default, 30 m from the eye under fog_curve linear {near: 10, far: 50}'), 'the line, the point and the image take the sky\'s fog');
    none(problems, 'each judged pixel lies whole inside its mark, 30 m from the eye');
  }, 1_800_000);

  it(`${AC[3]} the same marks with fog: false, and a mark.text label by default, read 1.0; a planted default of fog: true on the label fails, naming the mark`, () => {
    requireMetal();
    const out = dir();
    const image = writeWhitePng(out);
    const [unfogged, clear, planted] = runGpu(bin(), out, [
      marksCall(out, 'marks-fog-false', marksDoc(LINEAR.sky, image.sha, { fog: false }), image),
      marksCall(out, 'marks-clear', clearMarksDoc(image.sha), image),
      marksCall(out, 'marks-label-fog-true', marksDoc(LINEAR.sky, image.sha, { fog: false, textFog: true }), image),
    ]);
    const lin = readLinear(out, only(unfogged!, 'the marks, fog: false'), MARKS_SIZE, 'the marks, fog: false');

    // The label: its ink's whole pixels, from the frame with no fog, below the row the other three end above.
    expect(THREE.map((id) => markPixel(id)).every((m) => m.pixel[1] + m.halfPx + 2 < LABEL_ROWS_FROM), `the line, the point and the image end above row ${LABEL_ROWS_FROM}`).toBe(true);
    const ink = labelPixels(readLinear(out, only(clear!, 'the marks with no fog'), MARKS_SIZE, 'the marks with no fog'));
    expect(ink.length, 'the label draws 40 or more pixels its ink covers whole, 5 px wide').toBeGreaterThanOrEqual(40);
    expect(ink.filter((p) => !(Math.abs(p.distance - 30) <= 0.2)).map((p) => `(${p.pixel.join(', ')}) is ${p.distance.toFixed(2)} m from the eye`), 'the label\'s ink is 30 m from the eye').toEqual([]);
    const label = (l: Linear): MarkReading[] => ink.map((p): MarkReading => ({ mark: 'label', pixel: p.pixel, value: l.at(p.pixel[0], p.pixel[1]) }));
    console.log(`${AC[3]} the label: ${ink.length} pixels of ink, the first at (${ink[0]!.pixel.join(', ')}) reads ${fmt(lin.at(...ink[0]!.pixel))}`);
    none(judgeMarks(label(lin), WHITE, 'by default, 30 m from the eye under fog_curve linear {near: 10, far: 50}'), 'a mark.text label takes no fog by default');

    // The line, the point and the image with fog: false.
    const { readings, problems } = three(lin, 'fog: false');
    console.log(`${AC[3]} fog: false: ${readings.map((r) => `${r.mark} reads ${fmt(r.value)}`).join('; ')}`);
    none(judgeMarks(readings, WHITE, 'with fog: false, 30 m from the eye under fog_curve linear {near: 10, far: 50}'), 'the line, the point and the image with fog: false keep their color');
    none(problems, 'each judged pixel lies whole inside its mark, 30 m from the eye');

    // The planted default: fog: true written on the label, through the label's judge.
    const fogs = judgeMarks(label(readLinear(out, only(planted!, 'the label with fog: true'), MARKS_SIZE, 'the label with fog: true')), WHITE, 'with the planted default fog: true');
    failsNaming(fogs, 'the mark `label`', 'the planted default of fog: true on text');
  }, 1_800_000);

  it(`${AC[3]} a mark with a status binding reads its exact status color at 60 m under linear, exp and exp2; a planted fog that tints it fails, naming the mark`, () => {
    requireMetal();
    const out = dir();
    const replies = runGpu(bin(), out, CURVES.map((c) => view3dCall({ doc: writeJson(out, `status-${c.name}`, statusDoc(c.sky)), size: STATUS_SIZE, targets: ['final', 'linear', 'ids'], states: { [VERDICT]: STATE } })));
    const problems: string[] = []; const fixture: string[] = [];
    const want = fromHex(STATUS[STATE]!);
    CURVES.forEach((curve, i) => {
      const what = `the bound mark under ${curve.name}`;
      const f = only(replies[i]!, what);
      const mark = statusMark(replies[i]!, BOUND.id, what);
      expect(mark.state, `${what}: its state is the verdict's`).toBe(STATE);
      expect(mark.color, `${what}: view3d reports the look's ${STATE} color`).toEqual(want);
      const chip = modal(readPng(out, f.final, what), mark.bounds);
      expect(chip.count, `${what}: its chip's color fills 60 or more pixels of its box`).toBeGreaterThanOrEqual(60);
      problems.push(...judgeStatus(BOUND.id, chip.color, curve));

      const tinted = tintedStatus(curve);
      expect(Math.max(...tinted.map((v, k) => Math.abs(v - want[k]!))), `${what}: the planted fog moves the status color by 8 codes or more`).toBeGreaterThanOrEqual(8);
      failsNaming(judgeStatus(BOUND.id, tinted, curve), `the mark \`${BOUND.id}\``, `the planted fog that tints the status color under ${curve.name}`);

      const body = readPanel(STATUS_CAM, BOUND, readLinear(out, f, STATUS_SIZE, what), readIds(out, f, what), what);
      fixture.push(...body.problems);
      const fog = fogged(curve.share(BOUND.distance));
      if (off(body.value, fog) > TOL) fixture.push(`${what}: the fog doesn't reach the mark: its body 60 m from the eye reads ${fmt(body.value)}, should read ${fog.toFixed(4)} under ${curve.text}`);
    });
    none(problems, 'the status color is exact at 60 m under every curve');
    none(fixture, 'the fog covers the bound mark, whose status color it leaves alone');
  }, 1_800_000);
});
