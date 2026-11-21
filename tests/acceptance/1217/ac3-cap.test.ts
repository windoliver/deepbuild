// AC3 #1217.21c1b4f7: A click on a cutaway's cap places its point on the cap plane within 1e-5 m.
//
// The fixture (README: Fixtures, the cut cube): `solid`, a closed `slab@1` cube of 2 m standing on the origin
// (x and z from −1 to 1, y from 0 to 2), and `cut`, a `cutaway@1` of one plane, normal (1, 0, 0) and offset 0.25, with
// `cap: "accent"`: a view cutaway at the planes the document declares, which hides the cube where x > 0.25 and fills
// the cut face. The eye is at (6, 1, 0) looking at (0, 1, 0), fov 40°, 800 × 600, so it looks straight at the cap, a
// 2 m square in the plane x = 0.25.
//
// One click, at the projection of the cap point (0.25, 1.45, 0.3). The fixture is held to the cube's built mesh
// (`geometry`): no vertex or edge midpoint of it, kept or cut away, projects within 16 px of the click, so no snap
// moves the point. From the reply: A is on `solid`, its point within 1e-5 m of the plane (|n · p − offset|), and
// within 1e-5 m of where the click's ray meets that plane (Scope: each point is the exact hit, and a cap counts as a
// surface).
//
// Wrong programs this fails on: the base; a point on the geometry behind the cap (the hit path keeps only what the
// cutaway keeps, so the ray lands on the cube's far wall at x = −1, 1.25 m off the plane); a point taken on the wall
// behind and pushed onto the plane along its normal (on the plane, 0.1 m from the click's ray); a point read from depth.
import { describe, expect, it } from 'vitest';
import {
  AC, CUT, TIMEOUT, Script, at, builtOf, cameraDiffers, clickProblem, cutCube, dist, dot, fmt, measureIn, meetPlane, notPresented, project, requireMetal,
  runShow, scenario, show, useShow, useTemp, type V2,
} from './helpers.ts';

const bin = useShow();
const temp = useTemp();
/** The criterion's bound. */
const BOUND = 1e-5;

describe(`${AC[3]} a click on a cutaway's cap`, () => {
  it(`${AC[3]} a click on the cap of a cube cut at x > 0.25 places its point on the plane x = 0.25 within 1e-5 m, where the click's ray meets it`, () => {
    requireMetal();
    const f = cutCube(3);
    const exact = project(f.cam, CUT.on)!;
    const click: V2 = [Math.round(exact[0] * 64) / 64, Math.round(exact[1] * 64) / 64];
    const onCap = meetPlane(f.cam, click, CUT.normal, CUT.offset)!;
    const behind = meetPlane(f.cam, click, CUT.normal, CUT.behind)!;

    const s = new Script();
    const shown = s.present(f.id, f.document);
    const before = s.scope();
    const geometry = s.geometry(f.id, ['solid']);
    const on = s.measure(true);
    const [, placed] = s.click(click);
    const answer = runShow(bin(), scenario(temp(), f.id, f.size, s.calls), 'AC3 the cut cube');
    expect(answer.ok, `deep-show run takes the scenario: ${show(answer.raw, 2000)}`).toBe(true);
    const r = answer.replies;

    expect(notPresented(r[shown]), 'the cut cube, a document that offers the measure tool (viewer_tools: {measure: true}), is presented').toBe('');
    expect(cameraDiffers(r[before], f.cam), 'the panel shows the cut cube through the fixture\'s camera').toBe('');

    // The fixture: the click is on the cap, inside the cube's section, clear of everything a snap could reach, and
    // the wall behind the cap is far from the plane.
    const { built, problem } = builtOf(r[geometry], { solid: [0, 0, 0] });
    expect(problem, 'the fixture: geometry gives the cube\'s built mesh').toBe('');
    expect(clickProblem(f.cam, built, click, 'solid', null), 'the fixture: no vertex or edge midpoint of the cube projects within 16 px of the click, so nothing snaps').toBe('');
    expect(onCap[1] > 0.2 && onCap[1] < 1.8 && Math.abs(onCap[2]) < 0.8, `the fixture: the click's ray meets the cap plane at ${fmt(onCap)}, well inside the cube's 2 m section`).toBe(true);
    expect(behind[1] > 0.2 && behind[1] < 1.8 && Math.abs(behind[2]) < 0.8, `the fixture: behind the cap the ray meets the cube's far wall at ${fmt(behind)}`).toBe(true);
    expect(dist(behind, onCap), 'the fixture: the wall behind the cap is more than 1 m from the cap along the ray').toBeGreaterThan(1);

    // The tool.
    expect(measureIn(r[on]).on, `the viewer's setting turns the tool on: state.measure is ${show(at(r[on], 'state', 'measure'))}`).toBe(true);
    const m = measureIn(r[placed]);
    expect(m.a?.item, `the click on the cap places A on the cut cube: state.measure is ${show(m.raw)}`).toBe('solid');
    const p = m.a!.point;
    const offPlane = Math.abs(dot(CUT.normal, p) - CUT.offset);
    console.log(`${AC[3]}: A ${fmt(p)}; ${offPlane.toExponential(3)} m from the cap plane; ${dist(p, onCap).toExponential(3)} m from where the click's ray meets it ${fmt(onCap)}`);
    expect(offPlane, `A lies on the cap plane x = ${CUT.offset} within ${BOUND} m: got ${fmt(p)} (the geometry behind the cap is at ${fmt(behind)})`).toBeLessThanOrEqual(BOUND);
    expect(dist(p, onCap), `A is where the click's ray meets the cap plane, ${fmt(onCap)}, within ${BOUND} m: got ${fmt(p)}`).toBeLessThanOrEqual(BOUND);
    expect(m.b, 'B is not placed after one click').toBeNull();
  }, TIMEOUT);
});
