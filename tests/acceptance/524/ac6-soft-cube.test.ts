// #524.49daa6e5: "A soft volume from a built 1 m cube with inflate 1.2 runs live on Rapier 0.36.1's soft bodies as one
// soft body with one particle per welded vertex of the cube, and no rigid body or joint stands in for it; once settled
// on the ground it holds 1.2 m³ within 2%; a 1 kg ball launched into it at 5 m/s dents it, and it returns to within 2%
// of 1.2 m³ within 2 s; its skin draws each vertex of the cube at its particle's interpolated position within 1e-6 m at
// 20 sampled times; seeking into it from a checkpoint equals playing by step hash for 600 steps; a cube with one face
// removed is refused at check, naming an open edge; and a planted volume built without its volume constraint holds no
// more than its rest 1 m³ and fails, naming the body"
//
// The cube (helpers.ts: cubeScene): the built item `cube`, `slab@1 {size: [1, 1, 1]}` 2 cm above the ground plane, the
// source of the soft volume `jelly` (inflate 1.2, 1 kg a particle, stretch 8 Hz), its skin `item: auto` (for a volume,
// its source); the 1 kg ball 1.5 m to its −x side, launched along +x at 5 m/s at step 360 (3 s) by an entry of the
// world's input `kick`. Volumes are measured here from the particles (the kit's rule), never read from the backend.
//   1. Built: one soft body, `volume`, of 8 particles (a box's 8 welded vertices) addressed v0 … v7 at the cube's 8
//      corners; the backend holds 2 rigid bodies (ground, ball) and no joint.
//   2. Settled, dented, returned: at every step from 300 to 360 the cube holds 1.2 m³ within 2% (1.176 to 1.224 m³),
//      its lowest particle on the ground (within −2 cm to 3 cm of it); after the launch (the ball at 5 m/s) some
//      distance between two of its particles moves at least 5 mm from its settled length (a dent: no rigid motion does
//      that); and from 2 s after the dent starts (its first 1 mm) to 2.5 s after, every step holds 1.2 m³ within 2%.
//   3. The skin: `geometry` of `cube` at the 20 sampled times (50 fps frames 3, 7, … 79) draws each of its vertices at
//      the interpolated position of the particle v{i}, i its welded vertex in the cube's own vertex order (the cube alone
//      in a document of its own, welded at 1e-6 m in order of first appearance), within 1e-6 m; and at step 0 particle
//      v{i} is that welded vertex.
//   4. The seek: baked 780 steps with the launch into a store, #522's `seek` to step 150 playing 600 more restores the
//      checkpoint at step 120, and its step hashes and particles for steps 120 to 750 equal the bake's.
//   5. The refusal: two lathe@1 cubes (4 segments from 45°, so a 1 m square, 1 m tall), one closed by its outline
//      through the axis at both ends and one whose top is left open; a volume from the closed one is admitted at check,
//      one from the open one is refused with an error issue whose `edge` names two welded vertices v{i}, v{j} of the open
//      cube whose edge lies on one triangle only (read from `geometry` of the open cube in a document of its own).
//   6. The planted twin `volume_without_constraint`: settled at steps 300 to 360 it holds no more than 1.02 m³ (its rest
//      1 m³ within the criterion's 2%), and the judge of clause 2 fails on it, naming jelly.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, CUBE_AT, DOC, FPS, FRAME, GROUND, LAUNCH, LAUNCH_STEP, SAMPLED, TARGET_VOLUME, TIMEOUT, admitted, arr, ask, bake, builtOf, caught,
  check, cleanBuilds, cornersOf, cubeScene, cubeVolume, dist, drawnOf, errorsOf, geometryCall, hashesOf, inBand, indexOf, interpolated, none, num, obj,
  on, particlesOf, prebuild, presented, runShow, scenario, sceneDoc, show, showBin, showCall, softWorld, str, useTemp, weld,
  type JsonObject, type Particles, type V3,
} from './helpers.ts';

prebuild();
cleanBuilds();
const temp = useTemp();
const ID = CRITERIA[6];
const RUN = 780;

/** The cube's volume at each of steps `from` to `to`, measured from its particles. */
const volumes = (p: Particles, corner: number[], from: number, to: number): [number, number][] =>
  Array.from({ length: to - from + 1 }, (_, i) => [from + i, cubeVolume(p.positions[from + i]!, corner)]);
/** Clause 2's settled judge: every step from 300 to 360 within 2% of 1.2 m³, each failure naming the body. */
const settledFailures = (p: Particles, corner: number[], id: string): string[] =>
  volumes(p, corner, 300, LAUNCH_STEP).filter(([, v]) => !inBand(v)).map(([k, v]) => `${id} holds ${v.toFixed(4)} m³ at step ${k}, not ${TARGET_VOLUME} m³ within 2% (1.176 to 1.224)`);
/** The largest change, from step `ref`, of any distance between two particles at step k. */
function deformation(p: Particles, ref: number, k: number): number {
  const [a, b] = [p.positions[ref]!, p.positions[k]!];
  let most = 0;
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) most = Math.max(most, Math.abs(dist(b[i]!, b[j]!) - dist(a[i]!, a[j]!)));
  return most;
}

describe(`${ID} a soft volume from a built 1 m cube, live on Rapier 0.36.1's soft bodies`, () => {
  it(`${ID} the cube runs as one soft body with one particle per welded vertex, and no rigid body or joint stands in for it`, () => {
    const w = cubeScene();
    const [checked, baked] = ask([check(w), bake(w, 1)]);
    const b = builtOf(checked, 'the soft cube');
    expect([b.soft['jelly']?.shape, b.soft['jelly']?.particles], 'jelly is one soft volume of 8 particles, the cube\'s 8 welded vertices').toEqual(['volume', 8]);
    expect([b.softBodies, b.rigidBodies, b.joints, [...b.built].sort()], 'the backend holds one soft body, the two declared rigid bodies and no joint').toEqual([1, 2, 0, ['ball', 'ground']]);
    const p = particlesOf(baked, 'jelly', 2, 'the soft cube');
    expect([...p.addresses].sort(), 'its particles are addressed v0 to v7').toEqual(Array.from({ length: 8 }, (_, i) => `v${i}`).sort());
    const corners: V3[] = [];
    for (const x of [-0.5, 0.5]) for (const y of [0, 1]) for (const z of [-0.5, 0.5]) corners.push([x + CUBE_AT[0], y + CUBE_AT[1], z + CUBE_AT[2]]);
    const unmatched = corners.filter((c) => !p.positions[0]!.some((q) => dist(q, c) <= 1e-6));
    expect(unmatched, `the 8 particles rest at the cube's 8 corners: ${show(p.positions[0]!)}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} settled on the ground it holds 1.2 m³ within 2%; the 1 kg ball at 5 m/s dents it; it returns to 1.2 m³ within 2% within 2 s`, () => {
    const w = cubeScene();
    const [baked] = ask([bake(w, RUN, { track: [LAUNCH] })]);
    const p = particlesOf(baked, 'jelly', RUN + 1, 'the soft cube');
    const corner = cornersOf(p.positions[0]!, 'the soft cube');
    none(settledFailures(p, corner, 'jelly'), 'settled on the ground, the cube holds 1.2 m³ within 2%');
    const low = Math.min(...p.positions[LAUNCH_STEP]!.map((q) => q[1]));
    expect(low >= -0.02 && low <= 0.03, `settled, its lowest particle is on the ground (at ${low} m)`).toBe(true);
    const ball = arr(obj(baked!['bodies'], 'the bake: bodies')['ball'], 'the bake: bodies.ball');
    const v = num(arr(obj(ball[LAUNCH_STEP + 1], 'the ball after the launch')['linear'], 'the ball: linear')[0], 'the ball: linear[0]');
    expect(Math.abs(v - 5), `the ball is launched at 5 m/s (it moves at ${v} m/s after the launch's step)`).toBeLessThanOrEqual(0.05);
    const after = Array.from({ length: RUN - LAUNCH_STEP }, (_, i) => LAUNCH_STEP + 1 + i);
    const dent = Math.max(...after.map((k) => deformation(p, LAUNCH_STEP, k)));
    expect(dent, 'the ball dents the cube: some distance between two of its particles moves at least 5 mm').toBeGreaterThanOrEqual(0.005);
    const start = after.find((k) => deformation(p, LAUNCH_STEP, k) >= 0.001)!;
    expect(start + 300, `the dent starts within 1 s of the launch (step ${start}), so 2.5 s after it is in the run`).toBeLessThanOrEqual(RUN);
    none(volumes(p, corner, start + 240, start + 300).filter(([, x]) => !inBand(x)).map(([k, x]) => `jelly holds ${x.toFixed(4)} m³ at step ${k}, ${((k - start) / 120).toFixed(2)} s after the dent began`), 'within 2 s it is back within 2% of 1.2 m³, and stays');
  }, TIMEOUT);

  it(`${ID} its skin draws each vertex of the cube at its particle's interpolated position within 1e-6 m at 20 sampled times`, () => {
    const w = cubeScene();
    const [baked] = ask([bake(w, 200)]);
    const p = particlesOf(baked, 'jelly', 201, 'the soft cube');
    const at = indexOf(p, 'the soft cube');
    const alone = sceneDoc('The cube alone', '2s', FPS, { cube: { kind: 'slab@1', params: { size: [1, 1, 1] }, at: { pos: CUBE_AT } } }, {});
    const [own, soft] = [DOC(1), DOC(2)];
    const r = runShow(showBin(), scenario(temp(), [own, soft], [
      showCall(own, alone), showCall(soft, w.scene!), geometryCall(own, ['cube'], 0), ...SAMPLED.map((f) => geometryCall(soft, ['cube'], f * FRAME)),
    ]), 'the cube and its skin');
    presented(r[0], 'the cube alone');
    presented(r[1], 'the soft cube');
    const rest = drawnOf(r[2], 'cube', 'the cube alone');
    const { of, welded } = weld(rest.positions);
    expect(welded.length, 'the cube welds to 8 vertices').toBe(8);
    const fails: string[] = [];
    welded.forEach((q, i) => { const g = dist(p.positions[0]![at(`v${i}`)]!, q); if (!(g <= 1e-6)) fails.push(`at step 0 particle v${i} is ${g.toExponential(2)} m from the cube's welded vertex ${i} ${show(q)}`); });
    SAMPLED.forEach((f, s) => {
      const d = drawnOf(r[3 + s], 'cube', `the soft cube at frame ${f}`);
      if (d.positions.length !== rest.positions.length) { fails.push(`frame ${f}: the cube draws ${d.positions.length} vertices, its mesh has ${rest.positions.length}`); return; }
      d.positions.forEach((pos, k) => {
        const want = interpolated(p, at(`v${of[k]}`), f * FRAME);
        const g = dist(pos, want);
        if (!(g <= 1e-6)) fails.push(`frame ${f}: vertex ${k} (v${of[k]}) is drawn at ${show(pos)}, ${g.toExponential(2)} m from its particle's interpolated ${show(want)}`);
      });
    });
    none(fails.slice(0, 30), 'the cube drawn by its skin at the 20 sampled times');
  }, TIMEOUT);

  it(`${ID} seeking into it from a checkpoint equals playing by step hash for 600 steps`, () => {
    const w = cubeScene();
    const store = temp();
    const [baked, sought] = ask([bake(w, RUN, { store, track: [LAUNCH] }), { call: 'seek', ...on(w), track: [LAUNCH], steps: RUN, store, to: 150, play: 600 }]);
    const played = hashesOf(baked, 'the soft cube\'s bake');
    expect(num(sought!['from'], 'the seek: from'), 'the seek to step 150 restores the checkpoint at step 120').toBe(120);
    const hashes = hashesOf(sought, 'the seek');
    expect(hashes.length, 'the seek answers the states 120 to 750').toBe(631);
    none(hashes.map((h, i) => [120 + i, h] as const).filter(([k, h]) => h !== played[k]).slice(0, 5).map(([k, h]) => `step ${k}: the seek's hash ${h}, the bake's ${played[k]}`), 'the seek\'s step hashes equal the bake\'s for steps 120 to 750');
    const mine = particlesOf(sought, 'jelly', 631, 'the seek');
    const theirs = particlesOf(baked, 'jelly', RUN + 1, 'the bake');
    const moved: string[] = [];
    mine.positions.forEach((ps, i) => ps.forEach((q, j) => { if (q.some((x, c) => !Object.is(x, theirs.positions[120 + i]![j]![c]))) moved.push(`step ${120 + i}: ${mine.addresses[j]} differs after the seek`); }));
    none(moved.slice(0, 5), 'the seek\'s particles equal the bake\'s for steps 120 to 750');
  }, TIMEOUT);

  it(`${ID} a cube with one face removed is refused at check, naming an open edge`, () => {
    const R = Math.SQRT1_2;
    const lathe = (outline: [number, number, boolean][], x: number): JsonObject => ({ kind: 'lathe@1', params: { outline, segments: 4, from: 45, caps: 'none' }, at: { pos: [x, 0.02, 0] } });
    const items = { shut: lathe([[0, 0, false], [R, 0, false], [R, 1, false], [0, 1, false]], -2), open: lathe([[0, 0, false], [R, 0, false], [R, 1, false]], 2) };
    const volume = (from: string): JsonObject => softWorld({ bodies: { ground: GROUND }, soft: { jelly: { shape: 'volume', from, inflate: 1.2, masses: { default: 1 }, stretch: { hz: 8, damping_ratio: 0.5 }, contact_material: 'jelly' } } });
    const scene = sceneDoc('Two lathe cubes', '2s', FPS, items, { closed: volume('shut'), holed: volume('open') });
    const [closed, holed] = ask([check({ doc: volume('shut'), scene, id: 'closed' }), check({ doc: volume('open'), scene, id: 'holed' })]);
    admitted(closed, 'a volume from the closed lathe cube');
    const errors = errorsOf(holed, 'a volume from the lathe cube with its top removed');
    const named = errors.find((e) => Array.isArray(e['edge']));
    expect(named, `an error issue names an open edge in \`edge\`: ${show(errors)}`).toBeDefined();
    const edge = arr(named!['edge'], 'the issue\'s edge').map((v, i) => str(v, `edge[${i}]`));
    const welded = edge.map((a) => /^v(\d+)$/.exec(a)).map((m) => (m ? Number(m[1]) : NaN));
    expect(welded.length === 2 && welded.every(Number.isInteger) && welded[0] !== welded[1], `the edge is two welded vertices v{i}, v{j}: ${show(edge)}`).toBe(true);
    const doc = DOC(3);
    const r = runShow(showBin(), scenario(temp(), [doc], [showCall(doc, sceneDoc('The open cube', '2s', FPS, { open: items.open }, {})), geometryCall(doc, ['open'], 0)]), 'the open cube');
    presented(r[0], 'the open cube alone');
    const open = drawnOf(r[1], 'open', 'the open cube');
    const { of } = weld(open.positions);
    const uses = new Map<string, number>();
    for (let t = 0; t + 2 < open.indices.length; t += 3) {
      const tri = [0, 1, 2].map((c) => of[open.indices[t + c]!]!);
      for (let e = 0; e < 3; e++) { const key = [tri[e]!, tri[(e + 1) % 3]!].sort((a, b) => a - b).join('-'); uses.set(key, (uses.get(key) ?? 0) + 1); }
    }
    const openEdges = [...uses].filter(([, n]) => n === 1).map(([k]) => k);
    expect(openEdges.length, 'the open cube has open edges, around its missing top').toBeGreaterThan(0);
    expect(openEdges, `the named edge v${welded[0]}–v${welded[1]} is one of the open cube's open edges (${openEdges.join(', ')})`).toContain([...welded].sort((a, b) => a - b).join('-'));
  }, TIMEOUT);

  it(`${ID} a planted volume built without its volume constraint (volume_without_constraint) holds no more than its rest 1 m³ and fails, naming the body`, () => {
    const w = cubeScene();
    const [baked] = ask([bake(w, LAUNCH_STEP)], { planted: 'volume_without_constraint' });
    const p = particlesOf(baked, 'jelly', LAUNCH_STEP + 1, 'the planted cube');
    const corner = cornersOf(p.positions[0]!, 'the planted cube');
    const most = Math.max(...volumes(p, corner, 300, LAUNCH_STEP).map(([, v]) => v));
    expect(most, 'settled, the volume built without its constraint holds no more than its rest 1 m³ (1.02 m³ with the 2%)').toBeLessThanOrEqual(1.02);
    const failures = settledFailures(p, corner, 'jelly');
    caught(failures, 'volume_without_constraint (the settled judge that passes the real program)');
    expect(failures.every((f) => f.includes('jelly')), 'its failures name the body, jelly').toBe(true);
  }, TIMEOUT);
});

