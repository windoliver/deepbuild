// AC1 #1217.727f50dc: A fixture column 5.000 m tall: with snapping, clicks on the centers of its top and bottom caps
// read distance 5.00 m, run 0.00 m and rise 5.00 m.
//
// The fixture (README: Fixtures, the column): `column`, a `lathe@1` cylinder of radius 1.25 m from y = 0 to y = 5,
// 16 segments, flat caps, each cap a fan about a centre vertex. No pose outside a column sees the faces of both caps,
// so the eye is inside it, at (−1, 2.5, 0) looking along +x with a 150° field of view on an 800 × 800 frame: the
// bottom cap's centre (0, 0, 0) projects at (400, 667.95) and the top's (0, 5, 0) at (400, 132.05). The document
// offers the tool (`viewer_tools: {measure: true}`), and the viewer turns it on.
//
// The two clicks are 4.5 px off those projections, inside `snap` (8 px): the bottom cap first, at −(4, 2) px, then the
// top, at +(4, 2) px. The test first reads the column's built mesh (`geometry`) and holds the fixture to it: each
// centre is a vertex of that mesh, each click is within 6 px of its centre's projection, no other vertex or edge
// midpoint projects within 16 px of a click, and the unsnapped rays meet the caps more than 5 cm apart across.
// Then, from the replies: A is on `column` at the bottom centre and B at the top centre, each within 1e-5 m, and the
// readout is distance "5.00 m", run "0.00 m" and rise "5.00 m"; the selection and the open card are as they were.
//
// Wrong programs this fails on: the base (no `viewer_tools`, no tool); a tool that doesn't snap, or takes its point at
// the pixel's centre or from depth (the run then reads 0.08 m); run and rise swapped, or taken along another axis
// than +Y (run 5.00 m, rise 0.00 m); a readout at another precision; a click that selects the column or opens its card.
import { describe, expect, it } from 'vitest';
import {
  AC, COLUMN, TIMEOUT, Script, at, builtOf, cameraDiffers, clickProblem, columnInside, dist, fmt, insideClicks, measureIn, meetPlane, notPresented,
  readoutText, requireMetal, runShow, scenario, show, useShow, useTemp,
} from './helpers.ts';

const bin = useShow();
const temp = useTemp();
/** The criterion's bound on a placed point: the hit path's (#1976), 1e-5 m. */
const BOUND = 1e-5;

describe(`${AC[1]} the column's two caps, measured with snapping`, () => {
  it(`${AC[1]} clicks 4.5 px off the centres of a 5.000 m column's bottom and top caps place A and B on the centres and read distance 5.00 m, run 0.00 m and rise 5.00 m`, () => {
    requireMetal();
    const f = columnInside(1);
    const clicks = insideClicks(f);

    const s = new Script();
    const shown = s.present(f.id, f.document);
    const before = s.scope();
    const geometry = s.geometry(f.id, ['column']);
    const on = s.measure(true);
    const [, first] = s.click(clicks.bottom);
    const [, second] = s.click(clicks.top);
    const after = s.scope();
    const answer = runShow(bin(), scenario(temp(), f.id, f.size, s.calls), 'AC1 the column');
    expect(answer.ok, `deep-show run takes the scenario: ${show(answer.raw, 2000)}`).toBe(true);
    const r = answer.replies;

    expect(notPresented(r[shown]), 'the column, a document that offers the measure tool (viewer_tools: {measure: true}), is presented').toBe('');
    expect(cameraDiffers(r[before], f.cam), 'the panel shows the column through the fixture\'s camera').toBe('');

    // The fixture, held to the mesh the app built.
    const { built, problem } = builtOf(r[geometry], { column: [0, 0, 0] });
    expect(problem, 'the fixture: geometry gives the column\'s built mesh').toBe('');
    expect(clickProblem(f.cam, built, clicks.bottom, 'column', COLUMN.bottom), 'the fixture: the first click snaps to the bottom cap\'s centre and to nothing else').toBe('');
    expect(clickProblem(f.cam, built, clicks.top, 'column', COLUMN.top), 'the fixture: the second click snaps to the top cap\'s centre and to nothing else').toBe('');
    const rawA = meetPlane(f.cam, clicks.bottom, [0, 1, 0], 0)!;
    const rawB = meetPlane(f.cam, clicks.top, [0, 1, 0], COLUMN.height)!;
    const across = Math.hypot(rawA[0] - rawB[0], rawA[2] - rawB[2]);
    expect(across, `the fixture: without a snap the two rays meet the caps ${across.toFixed(4)} m apart across, so a run of 0.00 m needs the snap`).toBeGreaterThan(0.05);

    // The tool.
    expect(measureIn(r[on]).on, `the viewer's setting turns the tool on: state.measure is ${show(at(r[on], 'state', 'measure'))}`).toBe(true);
    const one = measureIn(r[first]);
    expect(one.a?.item, `the first click places A on the column: state.measure is ${show(one.raw)}`).toBe('column');
    expect(dist(one.a!.point, COLUMN.bottom), `A is the bottom cap's centre ${fmt(COLUMN.bottom)} within ${BOUND} m, got ${fmt(one.a!.point)} (an unsnapped hit is at ${fmt(rawA)})`).toBeLessThanOrEqual(BOUND);
    expect(one.b, 'B is not placed after one click').toBeNull();

    const two = measureIn(r[second]);
    expect(two.a?.item, `A stays on the column after the second click: ${show(two.raw)}`).toBe('column');
    expect(dist(two.a!.point, COLUMN.bottom), `A stays at the bottom cap's centre, got ${fmt(two.a!.point)}`).toBeLessThanOrEqual(BOUND);
    expect(two.b?.item, `the second click places B on the column: state.measure is ${show(two.raw)}`).toBe('column');
    expect(dist(two.b!.point, COLUMN.top), `B is the top cap's centre ${fmt(COLUMN.top)} within ${BOUND} m, got ${fmt(two.b!.point)} (an unsnapped hit is at ${fmt(rawB)})`).toBeLessThanOrEqual(BOUND);
    console.log(`${AC[1]}: A ${fmt(two.a!.point)}, B ${fmt(two.b!.point)}; ${readoutText(two.readout)}`);
    expect(two.readout?.distance, `the readout's distance: ${readoutText(two.readout)}`).toBe('5.00 m');
    expect(two.readout?.run, `the readout's run, the distance across the plane normal to +Y: ${readoutText(two.readout)}`).toBe('0.00 m');
    expect(two.readout?.rise, `the readout's rise, the distance along +Y: ${readoutText(two.readout)}`).toBe('5.00 m');

    // It neither changes the selection nor opens a card.
    expect([at(r[after], 'state', 'selection') ?? null, at(r[after], 'state', 'details') ?? null], 'the clicks the tool takes leave the selection and the open card as they were')
      .toEqual([at(r[before], 'state', 'selection') ?? null, at(r[before], 'state', 'details') ?? null]);
    expect(at(r[after], 'state', 'selection'), 'no item is selected').toEqual([]);
  }, TIMEOUT);
});
