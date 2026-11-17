// #457.d97d57d2: "A walkthrough path that passes 0.05 m inside a door frame fails clearance naming the frame, the shot
// and a time within 1/30 s of the deepest point while its twin through the doorway's centre passes; a camera keyed by
// two linear segments meeting at a 40° turn fails corners naming the key while its auto-tangent twin passes; a 3× zoom
// onto a recording captured at 2 px per u, in a 1920-wide export of a 1440 u wide screen, fails raster_max with a
// magnification of 2.0 while a 2× zoom passes at 1.33; a kept item 1 m behind the focus plane at 3 m, through a 50 mm
// lens at f/1.4 on a 36 mm sensor in a 1920-wide frame, fails focus with a circle of confusion of 8.1 px; and an
// explode toggle whose apart setting pushes a part past the frame edge fails at that sweep sample, naming the part and
// the control's value"
//
// Fixtures (helpers.ts), each the one deliverable of a claim of alpha's whose requirement is camera.framing keeping the
// fixture's subject, every path field at its default (path_rate 30, clearance auto, corners refuse, raster_max 1.5,
// focus_coc_max 1.5, sweeps from_brief):
//   - `walkthrough`: a door frame (a 0.05 m tube) and a camera walking through it in the 2 s keyed shot `walk`, along
//     x = −0.4 (0.05 m from the post's surface at t = 1.22 s, inside its auto clearance of about 0.11 m) or x = 0;
//   - `glide`: a camera keyed at `start`, `turn` and `end`, two straight 4 m segments meeting at `turn` at 40°, linear
//     or auto;
//   - `screenFilm`: a 2D film of a 1440 u wide screen, a recording captured at 2 px per u, viewed 480 u (3×) or 720 u
//     (2×) wide, with `render: {widths: [1920]}` on the check input: 1920 ÷ 480 ÷ 2 = 2.0, 1920 ÷ 720 ÷ 2 = 1.33;
//   - `focusShot`: the kept subject 4 m out, a 50 mm lens at f/1.4 on 36 × 24 mm fitted horizontally, 1920 × 1080,
//     dof on and focused at 3 m: c = 0.05² × 1 ÷ (1.4 × 4 × 2.95) m × 1920 ÷ 36 mm = 8.07 px;
//   - `explodeFigure`: a body and its lid; the toggle `explode` puts the lid 4 m to the side, past the frame's edge.
//     One claim's brief sweeps it (`brief: {sweeps: {explode: 2}}`); another's doesn't.
//
// asserts, per part:
//   - the near walk FAILs with a clearance error naming the frame, the shot `walk` and a time within 1/30 s of 1.22 s;
//     the walk through the centre PASSes with nothing raised;
//   - the linear glide FAILs with a corners error that names the key `turn`; the auto glide PASSes with nothing raised;
//   - the 3× zoom FAILs with a raster_max error naming the recording with a magnification within 0.05 of 2.0; the 2×
//     zoom PASSes with nothing raised, its paths reading the recording's magnification within 0.005 of 1.33;
//   - the focus shot FAILs with a focus error naming the subject with a circle of confusion that reads 8.1 px
//     (8.05 to 8.15);
//   - the swept figure FAILs with a camera.framing error naming the lid with `sweep: {control: explode, value}`, the
//     value the toggle's apart setting (true, or 1); unswept, it PASSes with nothing raised.
// Wrong programs: the base (no path measures, no sweeps from the brief: every fixture passes there); a clearance with
// no bound between samples or measured from the camera's point alone (the near walk still fails on its auto
// clearance); corners compared on one side; raster read in the document's own u; a CoC in another unit or linear in
// distance; a sweep that never runs the brief's controls.
import { describe, it } from 'vitest';
import {
  EXPLODE_CHECK, FOCUS_CHECK, GLIDE_CHECK, SCREEN_CHECK, TIMEOUT, WALK, WALK_CHECK, brief, claimId, claimOn, coc, docId, explodeFigure, focusShot, framingIssues,
  glide, names, none, passFailures, pathIssues, pathsOf, proof, putEvidence, recording, reqId, rowOf, run, scenarioOf, screenFilm, secondsOf,
  shotOf, shown, sweepOf, useBuilds, useFolders, valueOf, verdict, walkthrough, type JsonObject, type Row,
} from './helpers.ts';

const ID = '#457.d97d57d2';
const builds = useBuilds();
const folder = useFolders();
const [D1, D2] = [docId(1), docId(2)];
const [C1, C2] = [claimId(1), claimId(2)];
const [R1, R2] = [reqId(1), reqId(2)];

/** Two documents, each the one deliverable of its own claim on `check` (each claim with its own brief when given), judged in one run. */
function pair(evidence: string, docs: [JsonObject, JsonObject], check: JsonObject, briefs: [JsonObject?, JsonObject?] = []): [Row, Row] {
  const claims: JsonObject = { [C1]: claimOn(D1, [[R1, check]], briefs[0]), [C2]: claimOn(D2, [[R2, check]], briefs[1]) };
  const [a, b] = run(builds.debug(), scenarioOf(evidence, { [D1]: docs[0], [D2]: docs[1] }, claims, [verdict(C1), verdict(C2)]));
  return [rowOf(a!, R1, String(docs[0]['title'])), rowOf(b!, R2, String(docs[1]['title']))];
}
const failed = (row: Row, what: string): string[] => (row.result === 'FAIL' ? [] : [`${what} is ${row.result}, not FAIL: ${brief(row.raw)}`]);

describe(`${ID} camera.framing follows the whole move`, () => {
  it(`${ID} a walk 0.05 m inside the door frame fails clearance naming the frame, the shot and a time within 1/30 s of its deepest point, and the walk through the centre passes`, () => {
    const [near, middle] = pair(folder(), [walkthrough(-0.4), walkthrough(0)], WALK_CHECK);
    proof('near walk row', near.raw);
    const found = pathIssues(near, 'clearance', 'frame');
    const named = found.filter((i) => shotOf(i) === WALK.shot && secondsOf(i) !== null && Math.abs(secondsOf(i)! - WALK.deepest) <= 1 / 30);
    none([
      ...failed(near, 'the walk past the post'),
      ...(named.length ? [] : [`no clearance error names the frame, the shot ${WALK.shot} and a time within 1/30 s of ${WALK.deepest} s; clearance errors naming the frame: ${found.map(shown).join(' | ') || 'none'}`]),
      ...passFailures(middle, 'the walk through the middle of the doorway'),
    ], 'the walk inside the door frame fails clearance at its deepest point, and its twin passes');
  }, TIMEOUT);

  it(`${ID} two linear segments meeting at a 40° turn fail corners naming the key, and the auto-tangent twin passes`, () => {
    const [linear, auto] = pair(folder(), [glide('linear'), glide('auto')], GLIDE_CHECK);
    proof('linear glide row', linear.raw);
    const found = pathIssues(linear, 'corners');
    none([
      ...failed(linear, 'the glide with a 40° corner'),
      ...(found.some((i) => names(i.raw, 'turn')) ? [] : [`no corners error names the key turn; corners errors: ${found.map(shown).join(' | ') || 'none'}`]),
      ...passFailures(auto, 'the glide with auto tangents'),
    ], 'a 40° corner fails corners naming its key, and auto tangents pass');
  }, TIMEOUT);

  it(`${ID} a 3× zoom onto a recording at 2 px per u in a 1920-wide export of a 1440 u screen fails raster_max at 2.0, and a 2× zoom passes at 1.33`, () => {
    const evidence = folder();
    const sha = putEvidence(evidence, recording());
    const [triple, double] = pair(evidence, [screenFilm(3, sha), screenFilm(2, sha)], SCREEN_CHECK);
    proof('3× zoom row', triple.raw);
    proof('2× zoom row', double.raw);
    const found = pathIssues(triple, 'raster', 'recording');
    const readings = pathsOf(double, 'raster', 'recording').map((r) => r.value).filter((v): v is number => v !== null);
    const most = readings.length ? Math.max(...readings) : null;
    none([
      ...failed(triple, 'the 3× zoom'),
      ...(found.some((i) => valueOf(i) !== null && Math.abs(valueOf(i)! - 2) <= 0.05) ? [] : [`no raster_max error names the recording with a magnification of 2.0; raster errors: ${found.map(shown).join(' | ') || 'none'}`]),
      ...passFailures(double, 'the 2× zoom'),
      ...(most !== null && Math.abs(most - 4 / 3) <= 0.005 ? [] : [`the 2× zoom's paths read the recording's magnification as ${most}, not 1.33: ${brief(double.raw['results'] ?? null, 800)}`]),
    ], 'the 3× zoom fails raster_max at 2.0 and the 2× zoom passes at 1.33');
  }, TIMEOUT);

  it(`${ID} a kept item 1 m behind the focus plane at 3 m, through a 50 mm lens at f/1.4 on a 36 mm sensor in a 1920-wide frame, fails focus at 8.1 px`, () => {
    const expected = coc(0.05, 1.4, 3, 4, 36, 1920);
    const evidence = folder();
    const [v] = run(builds.debug(), scenarioOf(evidence, { [D1]: focusShot() }, { [C1]: claimOn(D1, [[R1, FOCUS_CHECK]]) }, [verdict(C1)]));
    const row = rowOf(v!, R1, 'the subject behind the focus plane');
    proof('focus row', row.raw);
    const found = pathIssues(row, 'focus', 'subject');
    none([
      ...failed(row, 'the subject behind the focus plane'),
      ...(found.some((i) => valueOf(i) !== null && valueOf(i)! >= 8.05 && valueOf(i)! < 8.15) ? [] : [`no focus error names the subject with a circle of confusion of 8.1 px (${expected.toFixed(3)} by the closed form); focus errors: ${found.map(shown).join(' | ') || 'none'}`]),
    ], 'the subject behind the focus plane fails focus at 8.1 px');
  }, TIMEOUT);

  it(`${ID} an explode toggle whose apart setting pushes the lid past the frame's edge fails at that sweep sample, naming the lid and the control's value`, () => {
    const [swept, unswept] = pair(folder(), [explodeFigure(), explodeFigure()], EXPLODE_CHECK, [{ sweeps: { explode: 2 } }]);
    proof('swept figure row', swept.raw);
    const apart = framingIssues(swept, 'lid').filter((i) => sweepOf(i).control === 'explode' && (sweepOf(i).value === true || sweepOf(i).value === 1));
    none([
      ...failed(swept, 'the figure under the brief\'s sweep of explode'),
      ...(apart.length ? [] : [`no camera.framing error names the lid at the sweep's apart sample (sweep: {control: explode, value: true}): ${brief(swept.raw['issues'] ?? null)}`]),
      ...passFailures(unswept, 'the same figure with no sweep in its brief'),
    ], 'the explode toggle\'s apart setting fails at that sweep sample, naming the lid and the value');
  }, TIMEOUT);
});
