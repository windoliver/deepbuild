// #1700.7a26c76e: "A window, a 1 × 1 × 0.1 m slab with four 0.2 m square through holes along z, reads parts 1, closed
// true and holes 4; a solid 1 m cube reads holes 0; a torus of radius 1 m and tube radius 0.25 m reads holes 1. A
// planted reading that counts hole contours on faces reads 8 for the window and fails, naming the part"
//
// Fixtures (helpers.ts), each a stored scene, the one deliverable of its own claim of alpha's:
//   - `windowDoc`: `window`, an `extrude@1` of a 1 × 1 m square outline (x and y from −0.5 to 0.5) with four 0.2 m
//     square holes centred at (±0.25, ±0.25) m, 0.1 m along +z;
//   - `cubeDoc`: `cube`, a `slab@1` of size [1, 1, 1];
//   - `torusDoc`: `torus`, a `lathe@1` of a closed 32-point circle of radius 0.25 m centred 1 m from the y axis.
// The checks: `{kind: geometry.shape, of: window, readings: [parts, closed, holes], expect: {parts: 1, closed: true,
// holes: 4}}`, `{of: cube, readings: [holes], expect: {holes: 0}}` and `{of: torus, readings: [holes], expect: {holes:
// 1}}`.
//
// asserts:
//   - each requirement PASSes; the window's parts reads one result of 1, its closed one result (one part) of true
//     naming `window#<n>`, its holes one result of 4 naming `window#<n>`; the cube's holes one result of 0, the
//     torus's one of 1;
//   - with the planted `holes_count_face_contours` (holes counts the inner contours of the part's flat faces, four on
//     the front and four on the back, in place of the genus): the window's holes reads 8, its requirement FAILs, and a
//     geometry.reading issue on readings/2 names `window#<n>`, the reading holes, expected 4 and actual 8.
import { describe, expect, it } from 'vitest';
import {
  PLANTED, TIMEOUT, brief, claimId, claimOf, cubeDoc, decided, docId, namesPart, oneAt, readingIssuesAt, reqId, rowOf, run, scenarioOf,
  shape, torusDoc, useBuild, useFolders, verdict, windowDoc,
} from './helpers.ts';

/** The criterion's ID: `#1700.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#1700.7a26c76e';
const bin = useBuild();
const folder = useFolders();

const [WINDOW, CUBE, TORUS] = [docId(1), docId(2), docId(3)];
const WINDOW_CHECK = shape('window', ['parts', 'closed', 'holes'], { parts: 1, closed: true, holes: 4 });
const claims = {
  [claimId(1)]: claimOf(WINDOW, [{ id: reqId(1), check: WINDOW_CHECK }]),
  [claimId(2)]: claimOf(CUBE, [{ id: reqId(2), check: shape('cube', ['holes'], { holes: 0 }) }]),
  [claimId(3)]: claimOf(TORUS, [{ id: reqId(3), check: shape('torus', ['holes'], { holes: 1 }) }]),
};

describe(`${ID} holes is a closed part's genus, whatever its faces show`, () => {
  it(`${ID} the window reads parts 1, closed true and holes 4, the cube holes 0 and the torus holes 1; a planted reading that counts hole contours on faces reads 8 for the window and fails, naming the part`, () => {
    const [onWindow, onCube, onTorus] = run(bin(), scenarioOf(folder(), { [WINDOW]: windowDoc(), [CUBE]: cubeDoc(), [TORUS]: torusDoc() }, claims,
      [verdict(claimId(1)), verdict(claimId(2)), verdict(claimId(3))]));

    const w = rowOf(onWindow!, reqId(1), 'the window');
    decided(w, 'PASS', 'the window read for parts 1, closed true and holes 4');
    expect(oneAt(w, 0, 'the window: parts').value, 'the window reads parts 1').toBe(1);
    const closed = oneAt(w, 1, 'the window: closed, one result for its one part');
    expect(closed.value, 'the window reads closed true').toBe(true);
    expect(namesPart(closed.ids, 'window'), `its closed result names the part window#<n>: ${brief(closed.raw)}`).toBe(true);
    const holes = oneAt(w, 2, 'the window: holes, one result for its one part');
    expect(holes.value, 'the window reads holes 4').toBe(4);
    expect(namesPart(holes.ids, 'window'), `its holes result names the part window#<n>: ${brief(holes.raw)}`).toBe(true);

    const c = rowOf(onCube!, reqId(2), 'the cube');
    decided(c, 'PASS', 'the cube read for holes 0');
    expect(oneAt(c, 0, 'the cube: holes').value, 'the solid 1 m cube reads holes 0').toBe(0);
    const t = rowOf(onTorus!, reqId(3), 'the torus');
    decided(t, 'PASS', 'the torus read for holes 1');
    expect(oneAt(t, 0, 'the torus: holes').value, 'the torus reads holes 1').toBe(1);

    // The planted reading that counts hole contours on faces.
    const [planted] = run(bin(), scenarioOf(folder(), { [WINDOW]: windowDoc() }, { [claimId(1)]: claims[claimId(1)]! }, [verdict(claimId(1))], PLANTED.holes));
    const p = rowOf(planted!, reqId(1), `the window under ${PLANTED.holes}`);
    expect(oneAt(p, 2, `the window under ${PLANTED.holes}: holes`).value, 'the planted reading counts four contours on each face: 8').toBe(8);
    decided(p, 'FAIL', `the window under ${PLANTED.holes}`);
    const issue = readingIssuesAt(p, 2).find((i) => namesPart(i.ids, 'window'));
    expect(issue, `a geometry.reading issue on readings/2 names the part window#<n>: ${brief(p.raw['issues'] ?? null, 3000)}`).toBeDefined();
    expect(issue!.reading, `the issue names the reading holes: ${brief(issue!.raw)}`).toBe('holes');
    expect([issue!.expected, issue!.actual], `the issue names both values, expected 4 and actual 8: ${brief(issue!.raw)}`).toEqual([4, 8]);
  }, TIMEOUT);
});
