// #1183.53c5a71a (AC1): "A dot whose offset along a wire is 200,000 × a logic output in metres, with `exaggerate
// {factor: 200000}`, in an assembly with `shown_at: 1`, passes. Its drawn offset is 1.7629 mm when the output reads
// 8.8146 × 10⁻⁹ m, within 1e-6 relative. The same driver without `exaggerate` is refused, naming the dot, the ratio
// 200,000 and the expected 1."
//
// Fixtures (helpers.ts, electronFigure). The electron figure: in assembly `flex` (`shown_at: 1`) a wire along x and the
// dot `dot`, whose x the driver `swing` sets to `200000 * d`, d the logic output `electron.drift` (an f64 write with
// `unit: m`; 8.8146e-9 at every step but 180 to 239), with `exaggerate {factor: 200000, disclose: disclosure}` and its
// disclosure overlay. Worked out: the mapping's ratio, drawn ÷ real, is 200,000 = shown_at (1) × the factor (200,000),
// so it is declared. The twin `undeclared` is the same driver with no `exaggerate` (and no disclosure): its ratio
// 200,000 matches neither shown_at (1) nor a declared factor.
//
// asserts:
//   - the figure's honest-numbers row PASSes with nothing raised, and its `lengths` record names drivers/swing on item
//     dot, `result: pass`, ratio 200,000 (1e-6 relative);
//   - the fixture's program writes 8.8146e-9 m at steps 59, 60 and 61 (run here on Node's own WebAssembly), and alpha's
//     deep_show of the same figure is presented and `eval` at frame 60 (1 s) reads the dot's x as 200,000 × 8.8146e-9 m
//     = 1.76292e-3 m, within 1e-6 relative (the issue's 1.7629 mm is that product rounded; README: Readings);
//   - the twin's row FAILs with a length.ratio_undeclared error naming dot, with ratio 200,000 and expected 1, and its
//     record holds drivers/swing on dot as `refused` at ratio 200,000.
// Wrong programs it fails: the base (`shown_at` is no field there, a driver can't read a logic output, and there is no
// `lengths` record and no refusal); a check that drops the factor (refuses the figure); one that never compares ratios
// (passes the twin); an evaluator that applies the factor again or not at all.
import { describe, it } from 'vitest';
import {
  AC, DRAWN, DRIFT, FACTOR, REL, TIMEOUT, brief, docId, electronFigure, electronProgram, entryFailures, evalCall, isObject, judge, near, none,
  passFailures, programOutput, refusedWith, showCall, useFolders, useShow, type JsonObject,
} from './helpers.ts';

const bin = useShow();
const folder = useFolders();
const FRAME_READ = 60;

/** The program's output around the frame read, and the dot's x there, as failures when either is off. */
function evalFailures(shown: JsonObject | undefined, evaluated: JsonObject | undefined): string[] {
  const failures: string[] = [];
  for (const k of [FRAME_READ - 1, FRAME_READ, FRAME_READ + 1]) {
    const out = programOutput(electronProgram(), k);
    if (out !== DRIFT) failures.push(`the fixture's program writes ${out} at step ${k}, not ${DRIFT} m`);
  }
  if (shown?.['outcome'] !== 'presented') return [...failures, `alpha's deep_show of the electron figure isn't presented: ${brief(shown)}`];
  if (evaluated?.['outcome'] !== 'evaluated') return [...failures, `the eval at frame ${FRAME_READ} isn't evaluated: ${brief(evaluated)}`];
  const pos = isObject(evaluated['values']) ? evaluated['values']['items/dot/at/pos'] : undefined;
  const x = Array.isArray(pos) ? pos[0] : undefined;
  if (typeof x !== 'number' || !near(x, DRAWN, REL)) failures.push(`the dot's drawn offset is ${brief(x)} m at frame ${FRAME_READ}, not ${DRAWN} m within 1e-6 relative (items/dot/at/pos is ${brief(pos)})`);
  return failures;
}

describe(`${AC[1]} a length drawn 200,000 times larger than real`, () => {
  it(`${AC[1]} with exaggerate {factor: 200000} at shown_at 1 the dot's mapping passes and draws 1.76292 mm at 8.8146e-9 m; without exaggerate it is refused naming the dot, the ratio 200,000 and the expected 1`, () => {
    const figs = [electronFigure(docId(1), 'none'), electronFigure(docId(2), 'undeclared')];
    const shown = electronFigure(docId(3), 'none');
    const before = [showCall(shown.doc, shown.document), evalCall(shown.doc, FRAME_READ, ['items/dot/at/pos'])];
    const { judged, replies } = judge(bin(), folder(), figs, { before, shown: [shown.doc] });
    const figure = judged[figs[0]!.name]?.row;
    const twin = judged[figs[1]!.name]?.row;
    none([
      ...passFailures(figure, 'the exaggerated dot'),
      ...entryFailures(figure, 'swing', 'dot', 'pass', FACTOR, 'the exaggerated dot'),
      ...evalFailures(replies[0], replies[1]),
      ...refusedWith(twin, 'dot', FACTOR, 1, 'the same driver without exaggerate'),
      ...entryFailures(twin, 'swing', 'dot', 'refused', FACTOR, 'the same driver without exaggerate'),
    ], 'a dot drawn 200,000× larger than real');
  }, TIMEOUT);
});
