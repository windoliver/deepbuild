// AC6 #223.bc85d7ee: "In a build without the data module, a flow whose streams names a test canvas module's item that
// builds a streams@1 table for the field (−y, x) carries a unit square through 90° in time π/2 within 0.5 px; and a
// planted warp that resolves flow by the vector_field@1 kind refuses that item, naming it, and fails this"
//
// The build: `deep-show --no-default-features --features full,test-leave-out-data,test-swirl` (README: Run), the full
// set without the data module, with the test canvas module `test.swirl`, whose kind `test.swirl@1` builds at check a
// stream table in data layout `streams@1` for the field (−y, x) at its `step` (README: The test canvas module).
// The film (640 × 480, 1 s, `requires.modules` naming test.swirl): `swirl`, a `test.swirl@1` item with `step: 0.01`;
// group `g` on the plane of origin (320, 240) u, unit 100 u, y up, warped by the identity `linear {matrix: [[1, 0],
// [0, 1]]}` at mix 1 with `flow: {streams: "swirl", time: π/2}`; its child `square`, the closed path through the
// plane's (1, 0), (2, 0), (2, 1), (1, 1) and back (u 420 240, 520 240, 520 140, 420 140, 420 240).
// The judge, on `deep show` and deep-show's `path` at t = 0 (README: what this suite adds): the film is presented with
// no error, and the square's drawn outline lies within 0.5 u of the unit square turned 90° counterclockwise about the
// plane's origin, (0, 1), (0, 2), (−1, 2), (−1, 1), both ways. The build seals without the data module, and its
// `data.layout@1` lists `streams@1` (the core's entry).
// The planted program, the scenario's `planted: "flow_by_vector_field_kind"`: a warp that resolves `flow.streams` by
// requiring a `vector_field@1` item. It refuses the film with an error naming `swirl`, and the judge fails, a failure
// naming it.
// Wrong programs: the base (no test-swirl feature: the build fails; no warp, no flow); a flow that reads the vector
// field's kind (refuses the test module's item, as the plant does); a flow that needs the data module (the build
// without it can't resolve the table); a field read y down (the square turns clockwise).
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, arr, bothWays, docId, errorsOf, failsNaming, figure, isObject, item, mentions, none, notPresented, pathItem, planeJson, present,
  registryRow, run, scenario, sealed, shellFilm, showPathCall, showSubpaths, toScreen, useBins, useFolders, warpGroup, type JsonObject, type Plane,
  type Pt,
} from './helpers.ts';

const bin = useBins(['show-swirl']);
const folder = useFolders();
const DOC = docId(6);
const FLOW_PLANE: Plane = { origin: [320, 240], unit: 100, y: 'up' };
const PLANT = 'flow_by_vector_field_kind';
const corners = (q: Pt[]): Pt[] => [...q, q[0]!].map((p) => toScreen(FLOW_PLANE, p));
const SQUARE = corners([[1, 0], [2, 0], [2, 1], [1, 1]]);
const TURNED = corners([[0, 1], [0, 2], [-1, 2], [-1, 1]]);

const FILM: JsonObject = shellFilm(figure('warp-flow', [640, 480], [
  item('swirl', 'test.swirl@1', 'a0', { step: 0.01 }),
  warpGroup('g', { linear: { matrix: [[1, 0], [0, 1]] }, mix: 1, plane: planeJson(FLOW_PLANE), flow: { streams: 'swirl', time: Math.PI / 2 } }, 'a1'),
  // Written back to its start rather than closed by Z, so every side is drawn as a segment of its own.
  pathItem('square', 'a2', `M ${SQUARE.map((p) => `${p[0]} ${p[1]}`).join(' L ')}`, 2, {}, { parent: 'g' }),
], { transport: { span: '1s' }, requires: { modules: { 'test.swirl': '^1' } } }));

/** The judge: the film presented, and the square carried through 90° within 0.5 px. */
function judgeFlow(shown: JsonObject, drawn: JsonObject): string[] {
  const failures = notPresented(shown, ['test.swirl@1']);
  if (failures.length) return failures;
  if (drawn['outcome'] === 'refused' || !Array.isArray(drawn['subpaths'])) return [`deep-show path answers no drawn square: ${JSON.stringify(drawn).slice(0, 600)}`];
  return bothWays(showSubpaths(drawn, 'the square under the flow'), [TURNED], 0.5, 'the square carried by the flow for π/2');
}

describe(`${AC[6]} a flow reads a stream table by its layout, in a build without the data module`, () => {
  it(`${AC[6]} a flow along a test module's streams@1 table for (−y, x) carries a unit square through 90° in time π/2 within 0.5 px`, () => {
    const modules = sealed(bin('show-swirl'), 'the build without data');
    expect(modules, 'the build holds no data module').not.toContain('data');
    expect(modules, 'the build holds marks2d').toContain('marks2d');
    const [registries, shown, drawn] = run(bin('show-swirl'), scenario(folder(), [{ call: 'registries' }, present(DOC, FILM), showPathCall(DOC, 'square', 0)]));
    const layouts = arr(registryRow(registries!, 'data.layout@1')['entries'], 'data.layout@1: entries').filter(isObject).map((e) => e['name']);
    expect(layouts, 'the core\'s data.layout@1 holds streams@1 in a build without the data module').toContain('streams@1');
    none(judgeFlow(shown!, drawn!), 'the flow carries the unit square through 90°');
  }, TIMEOUT);

  it(`${AC[6]} a planted warp that resolves flow by the vector_field@1 kind refuses the test module's item, naming it, and fails`, () => {
    const [shown, drawn] = run(bin('show-swirl'), scenario(folder(), [present(DOC, FILM), showPathCall(DOC, 'square', 0)], { planted: PLANT }));
    expect(shown!['outcome'], `under ${PLANT} the film is refused`).toBe('refused');
    expect(errorsOf(shown!).some((e) => mentions(e, 'swirl')), `under ${PLANT} an error names the item swirl: ${JSON.stringify(errorsOf(shown!)).slice(0, 800)}`).toBe(true);
    failsNaming(judgeFlow(shown!, drawn!), ['swirl'], `the judge under ${PLANT}`);
  }, TIMEOUT);
});
