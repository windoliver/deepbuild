// #2457.abde2f93: "A soft volume from a closed glTF cube asset with `inflate: 1.2` builds one soft body with one
// particle per welded vertex, holds 1.2 × its rest volume within 2% once settled, and its skin draws each vertex at its
// particle's interpolated position within 1e-6 m at 20 sampled times"
//
// The cube (helpers.ts: CUBE, softCube): a glTF 2.0 binary written here from 24 vertices and 12 triangles, a cube of
// 0.5 m whose six faces share no vertex in the file, kept in an evidence store by its SHA-256 and placed by the
// `mesh.asset@1` item `cube` at (1.5, 0.5, 0.75); the world `lab` over the ground plane, its soft volume `jelly` built
// from `cube` with `inflate: 1.2` and drawn back on it by a skin. Every expected number is worked here from those
// vertices and triangles: the 8 welded vertices in the order the file first holds each, the 0.125 m³ they enclose, and
// where a frame shows each particle (Physics output's rule). Volumes are measured here from the particles, never read
// from the backend.
//   1. Built: `check` admits the world and answers one soft body, `volume`, of 8 particles; a bake addresses them v0 to
//      v7, and as built particle v{i} is at the asset's welded vertex i, where the item is drawn.
//   2. Settled: at every step from 300 to 360 (2.5 s to 3 s, #524's reading of "once settled") the particles enclose
//      1.2 × 0.125 m³ within 2%; as built they don't, so the judge reads what the body does.
//   3. The skin: `geometry` of `cube` at the 20 sampled times (50 fps frames 3, 7, … 79, #524's) draws each of the
//      asset's 24 vertices within 1e-6 m of the interpolated position of the particle of its welded vertex. At every
//      one of those times some vertex is drawn away from where the asset alone is drawn, and at one of them at least a
//      particle is between its two steps' positions, so a skin that draws the asset at rest, or holds a step, fails.
import { describe, expect, it } from 'vitest';
import {
  AC, BOUND, CUBE, DOC, FRAME, INFLATE, ITEM, SAMPLED, SETTLED, SIDE, SOFT, TIMEOUT, bake, betweenFrames, builtFailures, builtOf, byWelded, check, cubeAlone,
  dist, drawn, enclosed, framesOf, geometryCall, holds, openEdges, particlesOf, placed, presented, refusals, scenario, settledFailures, showCall,
  skinFailures, softCube, stillFrames, usePhysics, useShow, useTemp, welded, xyz, type Frame, type Particles, type V3,
} from './helpers.ts';

const ask = usePhysics();
const present = useShow();
const temp = useTemp();
const ID = AC[1];

/** The cube asset as the file holds it, welded: 8 vertices, each triangle wound outward. */
const cube = welded(CUBE);
/** Its rest volume, the closed form of what a cube of 0.5 m encloses: 0.125 m³. */
const REST = SIDE ** 3;

describe(`${ID} a soft volume from a closed glTF cube asset with inflate 1.2`, () => {
  it(`${ID} builds one soft body with one particle per welded vertex of the asset, v{i} in welded order`, () => {
    expect([CUBE.positions.length, CUBE.triangles.length, cube.points.length, openEdges(cube.triangles)], 'the fixture: 24 file vertices and 12 triangles that weld to 8 vertices, every edge on two triangles').toEqual([24, 12, 8, []]);
    const w = softCube(temp());
    const run = ask([check(w), bake(w, 1)]);
    expect(run.problem, `${run.what} answers`).toBe('');
    const [checked, baked] = [run.replies[0]!, run.replies[1]!];
    expect(refusals(checked), 'a soft volume from the closed cube asset is admitted at check: no error issue').toEqual([]);
    const b = builtOf(checked);
    expect(typeof b === 'string' ? b : '', 'the check answers what the backend built').toBe('');
    const built = b as Exclude<typeof b, string>;
    expect([Object.keys(built.soft), built.soft[SOFT]?.shape, built.soft[SOFT]?.particles, built.softBodies, built.particles], `one soft body, ${SOFT}, a volume of 8 particles: one for each welded vertex of the asset's 24`).toEqual([[SOFT], 'volume', 8, 1, 8]);
    const p = particlesOf(baked, SOFT, 1);
    expect(typeof p === 'string' ? p : '', `the bake answers ${SOFT}'s particles`).toBe('');
    expect([...(p as Particles).addresses].sort(), 'its particles are addressed v0 to v7').toEqual(cube.points.map((_, i) => `v${i}`).sort());
    const states = byWelded(p as Particles, cube.points.length);
    expect(typeof states === 'string' ? states : '', 'each of v0 to v7 names one particle').toBe('');
    const failures = builtFailures((states as V3[][])[0]!, cube.points);
    expect(failures, `as built, particle v{i} is the asset's welded vertex i (the order the file's vertices first hold each), where the item is drawn:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} once settled it holds 1.2 × its rest volume within 2%`, () => {
    const measured = enclosed(cube.points, cube.triangles);
    expect(Math.abs(measured - REST) <= 1e-12, `the measure reads the fixture's own rest volume: its welded vertices and triangles enclose ${measured} m³, a cube of ${SIDE} m ${REST} m³`).toBe(true);
    const w = softCube(temp());
    const run = ask([bake(w, 360)]);
    expect(run.problem, `${run.what} answers`).toBe('');
    const p = particlesOf(run.replies[0]!, SOFT, 360);
    expect(typeof p === 'string' ? p : '', `the soft cube asset bakes 360 steps (3 s), ${SOFT}'s particles after each`).toBe('');
    const read = byWelded(p as Particles, cube.points.length);
    expect(typeof read === 'string' ? read : '', 'each of v0 to v7 names one particle').toBe('');
    const states = read as V3[][];
    const volumes = SETTLED.map((k) => enclosed(states[k]!, cube.triangles));
    const asBuilt = enclosed(states[0]!, cube.triangles);
    console.log(`${SOFT}: ${asBuilt.toFixed(6)} m³ as built; ${Math.min(...volumes).toFixed(6)} to ${Math.max(...volumes).toFixed(6)} m³ over steps 300 to 360; ${INFLATE} × ${REST} m³ is ${INFLATE * REST} m³`);
    const failures = settledFailures(states, cube.triangles, REST, SOFT);
    expect(failures, `settled (every step from 2.5 s to 3 s), the cube holds 1.2 × its rest volume within 2%:\n  ${failures.slice(0, 10).join('\n  ')}`).toEqual([]);
    // The judge reads what the body does: the body as built holds its rest volume, which the same judge refuses.
    expect(holds(asBuilt, REST), `as built the particles enclose ${asBuilt.toFixed(6)} m³, which is not 1.2 × the rest volume within 2%: the settled volume is not the built one`).toBe(false);
  }, TIMEOUT);

  it(`${ID} its skin draws each vertex at its particle's interpolated position within 1e-6 m at 20 sampled times`, () => {
    const store = temp();
    const w = softCube(store);
    const run = ask([bake(w, 200)]);
    expect(run.problem, `${run.what} answers`).toBe('');
    const p = particlesOf(run.replies[0]!, SOFT, 200);
    expect(typeof p === 'string' ? p : '', `the soft cube asset bakes 200 steps, ${SOFT}'s particles after each`).toBe('');
    const states = byWelded(p as Particles, cube.points.length);
    expect(typeof states === 'string' ? states : '', 'each of v0 to v7 names one particle').toBe('');
    // Where each of the asset's 24 vertices is at rest, and where a frame at each sampled time shows its particle.
    const rest = CUBE.positions.map(placed);
    const read = framesOf(states as V3[][], cube.of, SAMPLED, FRAME);
    expect(typeof read === 'string' ? read : '', 'the bake holds the two steps around each sampled time').toBe('');
    const frames = read as Frame[];
    expect(frames.length, 'the 20 sampled times').toBe(20);
    // Not vacuous: the particles have left the asset's rest positions at every sampled time, and at some of them a
    // particle is between its two steps' positions by more than the bound.
    expect(stillFrames(frames, rest), 'at each sampled time some particle is more than 1e-6 m from its rest position, so a skin that draws the asset at rest fails').toEqual([]);
    const between = betweenFrames(frames);
    expect(between.length, `at one sampled time at least, a particle's interpolated position is more than 1e-6 m from its position at the step before and at the step after, so a skin that holds a step fails (frames ${between.join(', ') || 'none'})`).toBeGreaterThan(0);

    const [own, soft] = [DOC(1), DOC(2)];
    const shown = present(scenario(store, [own, soft], [
      showCall(own, cubeAlone(store)), showCall(soft, w.scene), geometryCall(own, [ITEM], 0), ...SAMPLED.map((f) => geometryCall(soft, [ITEM], f * FRAME)),
    ]));
    expect(shown.problem, `${shown.what} answers`).toBe('');
    const r = shown.replies;
    expect(presented(r[0]), 'the cube asset alone is presented').toBe('');
    expect(presented(r[1]), 'the scene whose soft volume is built from the cube asset is presented').toBe('');
    const alone = drawn(r[2], ITEM);
    expect(typeof alone === 'string' ? alone : '', 'geometry answers the cube asset alone').toBe('');
    const off = (alone as V3[]).length !== rest.length
      ? [`the asset alone is drawn with ${(alone as V3[]).length} vertices, its file holds ${rest.length}`]
      : (alone as V3[]).map((q, k) => (dist(q, rest[k]!) <= BOUND ? '' : `vertex ${k} of the asset alone is drawn at ${xyz(q)}, its file holds it at ${xyz(rest[k]!)}`)).filter((x) => x !== '');
    expect(off, `with no soft body on it, the asset is drawn as its file holds it, vertex by vertex:\n  ${off.slice(0, 10).join('\n  ')}`).toEqual([]);
    const failures = skinFailures(frames, r.slice(3), ITEM, cube.of);
    expect(failures, `${ITEM} drawn by its skin at the 20 sampled times, each of its 24 vertices at its particle's interpolated position within 1e-6 m:\n  ${failures.slice(0, 30).join('\n  ')}`).toEqual([]);
  }, TIMEOUT);
});
