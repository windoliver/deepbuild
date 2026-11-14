// #524.78f2e1a8: "A 40-particle rope pinned at both ends and the 28 × 10 banner run live on Rapier 0.36.1's soft
// bodies: the built world holds one soft body for each, with 40 and 280 particles, and no rigid body or joint stands in
// for either; the banner pulled past its tear strain writes tear occurrences that list every torn edge once; and seeking
// into the banner from a checkpoint equals playing by step hash for 600 steps"
//
//   1. The world (helpers.ts: ropeAndBanner): the rope, 2 m, pins "0" and "39"; the banner, 28 × 10, swinging down from
//      its pinned row 0; one static floor. `runtime` names rapier3d 0.36.1; `check`'s `backend` (README) counts what the
//      backend built: 2 soft bodies, 320 particles, 1 rigid body (the floor, the one `built` names) and 0 joints, and
//      `soft` holds the rope with 40 particles and the banner with 280. Live: in 120 steps the rope's middle particle
//      and the banner's free row 9 each fall at least 1 cm.
//   2. The tear: the banner upright in the plane z = 0 with no gravity, `tear: {strain: 0.25}`, its column 0 pinned in
//      place and its column 27 pinned to the kinematic body `puller`, which follows the scene's channel 1 m/s along +x,
//      so by 3 s its rows are pulled to twice their length. Its `tear` rows (a: banner) list edges as pairs of
//      addresses; across all of them no edge appears twice, each is two neighbouring particles of the lattice, and every
//      row or column edge (r, c)–(r, c + 1) or (r, c)–(r + 1, c) longer than 1.5 × its 0.1 m at 3 s, which only a torn
//      edge can be, is listed.
//   3. The seek: the banner alone (no rigid body, so its step hash moves only with its particles), baked 720 steps into
//      a store, then #522's `seek` to step 90 playing 600 more: it restores the checkpoint at step 60, and its step
//      hashes and its particles for steps 60 to 690 equal the bake's; and the bake's step hash changes at every step from
//      61 to 180 while the banner swings, so the hash reads the particles.
import { describe, expect, it } from 'vitest';
import {
  BANNER_NU, BANNER_NV, CRITERIA, MATERIALS, SHAPES, TIMEOUT, ask, bake, banner, builtOf, check, cloth, column, dist, hashesOf, indexOf, none, num,
  obj, on, particlesOf, prebuild, rowText, rowsOf, ropeAndBanner, sceneDoc, show, softWorld, str, useTemp, type World,
} from './helpers.ts';

prebuild();
const temp = useTemp();
const ID = CRITERIA[5];

describe(`${ID} the rope and the banner run live on Rapier 0.36.1's soft bodies, tear by their edges and seek as they play`, () => {
  it(`${ID} the built world holds one soft body for each, with 40 and 280 particles, and no rigid body or joint stands in for either`, () => {
    const w = ropeAndBanner();
    const [checked, runtime, baked] = ask([check(w), { call: 'runtime' }, bake(w, 120)]);
    const backend = obj(runtime!['backend'], 'runtime: backend');
    expect([backend['name'], backend['version']], 'the backend is Rapier 0.36.1').toEqual(['rapier3d', '0.36.1']);
    const b = builtOf(checked, 'the rope and the banner');
    expect([b.soft['rope']?.shape, b.soft['rope']?.particles], 'the rope is one soft body of 40 particles').toEqual(['rope', 40]);
    expect([b.soft['banner']?.shape, b.soft['banner']?.particles], 'the banner is one soft body of 280 particles').toEqual(['cloth', BANNER_NU * BANNER_NV]);
    expect([b.softBodies, b.particles], 'the backend holds two soft bodies, 320 particles in all').toEqual([2, 320]);
    expect([b.rigidBodies, b.joints, b.built], 'no rigid body or joint stands in for either: the backend holds the floor alone and no joint').toEqual([1, 0, ['floor']]);
    const rope = particlesOf(baked, 'rope', 121, 'the rope');
    const flag = particlesOf(baked, 'banner', 121, 'the banner');
    const mid = indexOf(rope, 'the rope')('19');
    expect(rope.positions[0]![mid]![1] - rope.positions[120]![mid]![1], 'the rope\'s middle falls at least 1 cm in 120 steps').toBeGreaterThanOrEqual(0.01);
    const free = indexOf(flag, 'the banner')('r9c14');
    expect(flag.positions[0]![free]![1] - flag.positions[120]![free]![1], 'the banner\'s free row falls at least 1 cm in 120 steps').toBeGreaterThanOrEqual(0.01);
  }, TIMEOUT);

  it(`${ID} the banner pulled past its tear strain writes tear occurrences that list every torn edge once`, () => {
    const doc = softWorld({
      gravity: [0, 0, 0],
      shapes: { ...SHAPES, post: { kind: 'box', half: [0.05, 0.6, 0.05] } },
      contact_materials: MATERIALS,
      bodies: { puller: { kind: 'kinematic', shapes: [{ shape: 'post', contact_material: 'ground', sensor: true }], pose: { pos: [1.35, 1, 0] }, follow: 'items/grip/at/pos' } },
      soft: {
        banner: cloth([-1.35, 1.45, 0], [0.1, 0, 0], [0, -0.1, 0], BANNER_NU, BANNER_NV, {
          pins: column(0, BANNER_NV), pinned_to: Object.fromEntries(column(BANNER_NU - 1, BANNER_NV).map((a) => [a, 'puller'])), tear: { strain: 0.25 },
        }),
      },
    });
    const scene = sceneDoc('Torn banner', '3s', 60, { grip: { kind: 'mark.box@1', params: { size: [0.1, 0.1, 0.1] }, at: { pos: [1.35, 1, 0] } } }, { tear: doc }, {
      channels: { grip: { target: 'items/grip/at/pos', type: 'vec3', keys: { k0: { t: '0s', value: [1.35, 1, 0], interp: 'linear' }, k1: { t: '3s', value: [4.35, 1, 0], interp: 'hold' } } } },
    });
    const w: World = { doc, scene, id: 'tear' };
    const [baked] = ask([bake(w, 360)]);
    const p = particlesOf(baked, 'banner', 361, 'the torn banner');
    const at = indexOf(p, 'the torn banner');
    const tears = rowsOf(baked, 'the torn banner').filter((r) => r.kind === 'tear');
    expect(tears.length, 'the banner pulled past its tear strain writes tear occurrences').toBeGreaterThan(0);
    const fails: string[] = [];
    const listed = new Map<string, number>();
    const local = (a: string): string => (a.startsWith('banner#') ? a.slice('banner#'.length) : a);
    const rc = (a: string): [number, number] | null => { const m = /^r(\d+)c(\d+)$/.exec(a); return m ? [Number(m[1]), Number(m[2])] : null; };
    for (const r of tears) {
      if (r.a !== 'banner') fails.push(`${rowText(r)} names ${r.a}, not the banner`);
      const edges = Array.isArray(r.raw['edges']) ? r.raw['edges'] : [];
      if (!edges.length) fails.push(`${rowText(r)} lists no edges: ${show(r.raw)}`);
      for (const e of edges) {
        const pair = (Array.isArray(e) ? e : []).map((x) => local(str(x, `${rowText(r)}: an edge's address`))).sort();
        const [u, v] = pair.map(rc);
        if (pair.length !== 2 || !u || !v || pair[0] === pair[1] || Math.abs(u[0] - v[0]) > 1 || Math.abs(u[1] - v[1]) > 1) { fails.push(`${rowText(r)} lists ${show(e)}, not an edge between two neighbouring particles`); continue; }
        const key = pair.join('–');
        if (listed.has(key)) fails.push(`the edge ${key} is listed at step ${listed.get(key)} and again at step ${r.step}`);
        listed.set(key, r.step);
      }
    }
    const end = p.positions[360]!;
    const long: string[] = [];
    for (let r = 0; r < BANNER_NV; r++) for (let c = 0; c < BANNER_NU; c++) {
      for (const [r2, c2] of [[r, c + 1], [r + 1, c]] as const) {
        if (r2 >= BANNER_NV || c2 >= BANNER_NU) continue;
        const [a, b] = [`r${r}c${c}`, `r${r2}c${c2}`];
        if (dist(end[at(a)]!, end[at(b)]!) > 0.15) long.push([a, b].sort().join('–'));
      }
    }
    expect(long.length, 'by 3 s the banner has come apart: some edge is longer than 1.5 × its rest length').toBeGreaterThan(0);
    for (const e of long) if (!listed.has(e)) fails.push(`the edge ${e}, torn (longer than 0.15 m at 3 s), is listed in no tear occurrence`);
    none(fails.slice(0, 30), 'the tear occurrences list every torn edge once');
  }, TIMEOUT);

  it(`${ID} seeking into the banner from a checkpoint equals playing by step hash for 600 steps`, () => {
    const w: World = { doc: softWorld({ soft: { banner: banner() } }), id: 'banner' };
    const store = temp();
    const [baked, sought] = ask([bake(w, 720, { store }), { call: 'seek', ...on(w), steps: 720, store, to: 90, play: 600 }]);
    const played = hashesOf(baked, 'the banner\'s bake');
    expect(played.length, 'the bake holds the states 0 to 720').toBe(721);
    const changed = played.slice(61, 181).filter((h, i) => h !== played[60 + i]).length;
    expect(changed, 'with no rigid body in the world, the step hash changes at each of steps 61 to 180 while the banner swings: it reads the particles').toBe(120);
    const from = num(sought!['from'], 'the seek: from');
    expect(from, 'the seek to step 90 restores the checkpoint at step 60').toBe(60);
    const hashes = hashesOf(sought, 'the seek');
    expect(hashes.length, 'the seek answers the states 60 to 690').toBe(631);
    const bad = hashes.map((h, i) => [60 + i, h, played[60 + i]] as const).filter(([, a, b]) => a !== b);
    none(bad.slice(0, 5).map(([k, a, b]) => `step ${k}: the seek's hash ${a}, the bake's ${b}`), 'the seek\'s step hashes for steps 60 to 690 equal the bake\'s');
    const mine = particlesOf(sought, 'banner', 631, 'the seek');
    const theirs = particlesOf(baked, 'banner', 721, 'the bake');
    const moved: string[] = [];
    mine.positions.forEach((ps, i) => ps.forEach((q, j) => {
      const r = theirs.positions[60 + i]![j]!;
      if (q.some((x, c) => !Object.is(x, r[c]))) moved.push(`step ${60 + i}: ${mine.addresses[j]} at ${show(q)} after the seek, ${show(r)} in the bake`);
    }));
    none(moved.slice(0, 5), 'the seek\'s particles for steps 60 to 690 equal the bake\'s');
  }, TIMEOUT);
});

