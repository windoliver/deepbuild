// #524.f18cb67c: "A 28 × 10 cloth skinned onto a plate whose grid has 28 × 10 vertices draws every vertex at its
// particle's interpolated position within 1e-6 m at 20 sampled times, and with `item: auto` the core builds that plate
// itself; a flat cloth at rest has every normal within 0.1° of its plane's; a 40-particle rope skinned onto a tube passes
// through its particles in index order; and a plate with 27 × 10 vertices is refused at check, naming both items"
//
// Where an item is drawn at t is deep-show's `geometry` of it at t (README: The surface under test: its positions in
// world metres, its normals, a tube's rings), on the document the session presented; where a particle is, is
// deep-physics's bake of the same scene's world, every step, lerped between the two steps that hold t (Physics output:
// α exact from flicks). The 20 sampled times are 50 fps frames 3, 7, … 79 (0.06 s to 1.58 s): 16 fall between 120 Hz
// steps (α 0.2, 0.4, 0.6, 0.8) and 4 on one. A plate's vertex (col, row) of its grid is particle r{row}c{col}; a
// two-sided plate repeats its vertices, so vertex k is particle k mod 280.
//   1. The swinging banner `flag` (helpers.ts: skinnedCloth(28)) skinned onto `sheet`, a plate whose grid has 28 × 10
//      vertices, and onto the plate the core builds for `item: auto` (`lab.onto_own`, a plate@1 of 280 or 560 vertices):
//      every vertex of each within 1e-6 m of its particle's interpolated position at each sampled time.
//   2. A flat 28 × 10 cloth at rest (no gravity, nothing touching it) in the plane z = 0 skinned onto `pane`: at 0, 0.5
//      and 1 s every normal lies within 0.1° of the plane's normal, all on one side. The plate's own normals point +Y,
//      90° off, so a skin that keeps them fails.
//   3. A 40-particle rope pinned at particle 0, swinging down, skinned onto `hose`, a tube whose path is the rope's 40
//      resting points: at each sampled time the centre of ring k (the mean of its ring's vertices) is within 1e-6 m of
//      particle k's interpolated position, for k = 0 … 39 in order.
//   4. The same banner skinned onto a plate whose grid has 27 × 10 vertices is refused at the document check, an error
//      issue naming both the plate `sheet` and the cloth `flag`; with 28 × 10 the document is presented with no error.
import { describe, expect, it } from 'vitest';
import {
  BANNER_NU, BANNER_NV, CRITERIA, DOC, FPS, FRAME, OWN_PLATE, SAMPLED, TIMEOUT, admitted, ask, bake, check, cleanBuilds, cloth, dist, dot,
  cross, drawnOf, geometryCall, indexOf, interpolated, issuesIn, isObject, mean, none, particlesOf, plate, prebuild, presented, rope, runShow,
  scenario, sceneDoc, show, showBin, showCall, skin, skinnedCloth, softWorld, stepAt, sub, useTemp, type Drawn, type JsonObject, type JsonValue,
  type Particles, type V3, type World,
} from './helpers.ts';

prebuild();
cleanBuilds();
const temp = useTemp();
const ID = CRITERIA[4];
const TOL = 1e-6;
const N = BANNER_NU * BANNER_NV;
const BAKED = 200;

/** Every vertex of `d` against its particle (`particleOf(k)`) at time t: the first failures, naming the vertex. */
function vertexFailures(d: Drawn, p: Particles, particleOf: (k: number) => number, t: number, what: string): string[] {
  const f: string[] = [];
  d.positions.forEach((pos, k) => {
    const i = particleOf(k);
    const want = interpolated(p, i, t);
    const gap = dist(pos, want);
    if (!(gap <= TOL)) f.push(`${what}: vertex ${k} is drawn at ${show(pos)}, ${gap.toExponential(2)} m from particle ${p.addresses[i]}'s interpolated ${show(want)}`);
  });
  return f.slice(0, 5);
}

/** Whether an issue, or the physics issues it carries in `actual`, names `word` in its ids, path or what. */
function names(issue: JsonValue | undefined, word: string): boolean {
  if (!isObject(issue)) return false;
  const re = new RegExp(`(^|[^A-Za-z0-9_])${word}($|[^A-Za-z0-9_])`);
  const own = [issue['ids'], issue['path'], issue['what']].some((v) => v !== undefined && re.test(typeof v === 'string' ? v : JSON.stringify(v)));
  return own || (Array.isArray(issue['actual']) && issue['actual'].some((x) => names(x, word)));
}

describe(`${ID} soft bodies drawn through skins on their own lattices`, () => {
  it(`${ID} a 28 × 10 cloth skinned onto a plate of 28 × 10 vertices, and onto the plate the core builds for item: auto, draws every vertex at its particle's interpolated position within 1e-6 m at 20 sampled times`, () => {
    const w = skinnedCloth(BANNER_NU);
    const [baked] = ask([bake(w, BAKED)]);
    const p = particlesOf(baked, 'flag', BAKED + 1, 'the banner\'s bake');
    const at = indexOf(p, 'the banner');
    const particleOf = (k: number): number => at(`r${Math.floor((k % N) / BANNER_NU)}c${(k % N) % BANNER_NU}`);
    const doc = DOC(1);
    const r = runShow(showBin(), scenario(temp(), [doc], [showCall(doc, w.scene!), ...SAMPLED.map((f) => geometryCall(doc, ['sheet', OWN_PLATE], f * FRAME))]), 'the skinned banner');
    presented(r[0], 'the skinned banner');
    const fails: string[] = [];
    SAMPLED.forEach((f, s) => {
      const t = f * FRAME;
      const sheet = drawnOf(r[1 + s], 'sheet', `frame ${f}`);
      const own = drawnOf(r[1 + s], OWN_PLATE, `frame ${f}`);
      if (sheet.kind !== 'plate@1' || sheet.positions.length !== N) fails.push(`frame ${f}: sheet is a ${sheet.kind} of ${sheet.positions.length} vertices, not the plate of ${N}`);
      if (own.kind !== 'plate@1' || ![N, 2 * N].includes(own.positions.length)) fails.push(`frame ${f}: the core's own item for item: auto is a ${own.kind} of ${own.positions.length} vertices, not a plate on the cloth's 28 × 10 lattice`);
      fails.push(...vertexFailures(sheet, p, particleOf, t, `frame ${f}, sheet`), ...vertexFailures(own, p, particleOf, t, `frame ${f}, ${OWN_PLATE}`));
    });
    none(fails.slice(0, 30), 'every vertex of both plates at its particle\'s interpolated position, within 1e-6 m, at the 20 sampled times');
  }, TIMEOUT);

  it(`${ID} a flat cloth at rest has every normal within 0.1° of its plane's`, () => {
    const calm = softWorld({ gravity: [0, 0, 0], soft: { still: cloth([-1.35, 2, 0], [0.1, 0, 0], [0, -0.1, 0], BANNER_NU, BANNER_NV) }, outputs: { onto_pane: skin('still', 'pane') } });
    const w: World = { doc: calm, scene: sceneDoc('Flat cloth', '2s', FPS, { pane: plate(BANNER_NU, BANNER_NV) }, { calm }), id: 'calm' };
    const [baked] = ask([bake(w, 120)]);
    const p = particlesOf(baked, 'still', 121, 'the flat cloth\'s bake');
    const at = indexOf(p, 'the flat cloth');
    const frames = [0, 25, 50];
    const doc = DOC(2);
    const r = runShow(showBin(), scenario(temp(), [doc], [showCall(doc, w.scene!), ...frames.map((f) => geometryCall(doc, ['pane'], f * FRAME))]), 'the flat cloth');
    presented(r[0], 'the flat cloth');
    const fails: string[] = [];
    const cos = Math.cos((0.1 * Math.PI) / 180);
    frames.forEach((f, s) => {
      const ps = p.positions[stepAt(f * FRAME).k]!;
      const off = ps.map((q) => Math.abs(q[2])).reduce((a, b) => Math.max(a, b), 0);
      expect(off, `frame ${f}: the cloth at rest lies flat in z = 0 (its particles within 1e-4 m of it)`).toBeLessThanOrEqual(1e-4);
      const n = cross(sub(ps[at('r0c27')]!, ps[at('r0c0')]!), sub(ps[at('r9c0')]!, ps[at('r0c0')]!));
      const plane: V3 = n.map((x) => x / Math.hypot(...n)) as V3;
      const pane = drawnOf(r[1 + s], 'pane', `frame ${f}`);
      if (pane.normals.length !== pane.positions.length || pane.normals.length !== N) fails.push(`frame ${f}: pane has ${pane.normals.length} normals for ${pane.positions.length} vertices, not one for each of ${N}`);
      const sides = new Set<number>();
      pane.normals.forEach((nv, v) => {
        const c = dot(nv, plane) / Math.hypot(...nv);
        sides.add(Math.sign(c));
        if (!(Math.abs(c) >= cos)) fails.push(`frame ${f}: vertex ${v}'s normal ${show(nv)} is ${((Math.acos(Math.min(1, Math.abs(c))) * 180) / Math.PI).toFixed(3)}° off the plane's ${show(plane)}`);
      });
      if (sides.size > 1) fails.push(`frame ${f}: the one-sided plate's normals point to both sides of the plane`);
    });
    none(fails.slice(0, 30), 'every normal of the flat cloth within 0.1° of its plane\'s');
  }, TIMEOUT);

  it(`${ID} a 40-particle rope skinned onto a tube passes through its particles in index order`, () => {
    const rest: V3[] = Array.from({ length: 40 }, (_, k) => [0.05 * k, 2, 0]);
    const line = softWorld({ soft: { cord: rope([0, 2, 0], [1.95, 2, 0], 40, { pins: ['0'] }) }, outputs: { onto_hose: skin('cord', 'hose') } });
    const w: World = { doc: line, scene: sceneDoc('Rope on a tube', '2s', FPS, { hose: { kind: 'tube@1', params: { path: rest, radius: 0.02, segments: 8, caps: 'none' } } }, { line }), id: 'line' };
    const [baked] = ask([bake(w, BAKED)]);
    const p = particlesOf(baked, 'cord', BAKED + 1, 'the rope\'s bake');
    const at = indexOf(p, 'the rope');
    const doc = DOC(3);
    const r = runShow(showBin(), scenario(temp(), [doc], [showCall(doc, w.scene!), ...SAMPLED.map((f) => geometryCall(doc, ['hose'], f * FRAME))]), 'the rope on its tube');
    presented(r[0], 'the rope on its tube');
    const fails: string[] = [];
    SAMPLED.forEach((f, s) => {
      const hose = drawnOf(r[1 + s], 'hose', `frame ${f}`);
      if (hose.rings.length !== 40) { fails.push(`frame ${f}: the tube lists ${hose.rings.length} rings, not one for each of the rope's 40 particles`); return; }
      hose.rings.forEach((ring, k) => {
        const centre = mean(ring.map((v) => hose.positions[v]!));
        const want = interpolated(p, at(String(k)), f * FRAME);
        const gap = dist(centre, want);
        if (!(gap <= TOL)) fails.push(`frame ${f}: ring ${k}'s centre ${show(centre)} is ${gap.toExponential(2)} m from particle ${k}'s interpolated ${show(want)}`);
      });
    });
    none(fails.slice(0, 30), 'the tube through the rope\'s particles in index order at the 20 sampled times');
  }, TIMEOUT);

  it(`${ID} a plate with 27 × 10 vertices is refused at check, naming both items, and one with 28 × 10 is not`, () => {
    const [good, bad] = [skinnedCloth(BANNER_NU), skinnedCloth(BANNER_NU - 1)];
    admitted(ask([check(good)])[0], 'the banner skinned onto a plate of 28 × 10 vertices');
    const [ok, refused] = [DOC(4), DOC(5)];
    const r = runShow(showBin(), scenario(temp(), [ok, refused], [showCall(ok, good.scene!), showCall(refused, bad.scene!)]), 'the two pairings');
    presented(r[0], 'the banner on a plate of 28 × 10 vertices');
    expect(issuesIn(r[0], 'the 28 × 10 pairing').filter((i) => i['severity'] === 'error').map((i) => show(i)), 'the 28 × 10 pairing: no error issue').toEqual([]);
    expect(r[1]!['outcome'], `the 27 × 10 pairing is refused: ${show(r[1])}`).toBe('refused');
    const errors = issuesIn(r[1], 'the 27 × 10 pairing').filter((i) => i['severity'] === 'error');
    expect(errors.filter((i) => names(i, 'sheet') && names(i, 'flag')).map((i) => show(i as JsonObject)), `an error issue names both the plate sheet and the cloth flag: ${show(errors)}`).not.toEqual([]);
  }, TIMEOUT);
});
