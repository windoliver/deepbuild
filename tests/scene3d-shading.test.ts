// #421's scope past its five criteria, on linear targets read back from `deep-gpu run`'s `view3d` (#378): area
// lights and color temperatures in photometric units, the clear coat, alpha modes in see-through order with
// `sort_bias`, the shadow catcher, procedural patterns in the part's own space, and the shadow budget's notice.
//
// Each check reads values a wrong program changes: an area light shaded as a point light is 4× off on its axis; a
// temperature that isn't at unit luminance changes the illuminance; see-through parts drawn in submission order
// swap the composite when the document order swaps; a catcher that draws its own color or ignores the shadow map
// gives the wrong pixel on either side of the shadow's edge; a pattern in world space moves when the part and the
// camera move together.
import { describe, expect, it } from 'vitest';
import {
  PLAIN_LOOK, box, camera, frameAt, framesOf, material, onFloor, project, readLinear, requireReferenceMac, runGpu,
  sessionDoc, useBins, useDir, view3dCall, writeJson,
  type JsonObject, type Linear, type Pinhole, type V3,
} from './acceptance/421/helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const SIZE: [number, number] = [320, 320];
const FLOOR_CAM: Pinhole = { position: [0, 4, 4], target: [0, 0, 0], fov: 50, size: SIZE };
const lum = (c: [number, number, number]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const white = material({ base_color: [1, 1, 1, 1], metallic: 0, roughness: 1, specular_level: 0 });

/** Renders each document once and reads its linear target back. */
function linear(docs: JsonObject[], size: [number, number] = SIZE): Linear[] {
  const out = dir();
  const replies = runGpu(bins.bin('deep-gpu'), out, docs.map((d, i) => view3dCall({ doc: writeJson(out, `doc-${i}`, d), look: PLAIN_LOOK, size, frames: 1, capture: [0], targets: ['linear'] })));
  return replies.map((r, i) => readLinear(out, frameAt(framesOf(r, `render ${i}`), 0, `render ${i}`).linear, size, `render ${i}: linear`));
}

/** A white Lambertian floor under `light`, seen from FLOOR_CAM. */
const floorDoc = (name: string, light: JsonObject | null): JsonObject => sessionDoc(`shading-${name}`, SIZE, {
  cam: camera(FLOOR_CAM.position, FLOOR_CAM.target, FLOOR_CAM.fov),
  white,
  floor: box([20, 0.1, 20], { pos: [0, -0.05, 0] }, { material: 'white' }),
  ...(light ? { light } : {}),
});

/** Illuminance on the floor at `p` from a one-sided Lambertian rect or disk of `lm` lumens at `c`, facing down: the
 * face integrated by a 200 × 200 midpoint rule, independently of how the shader evaluates it. */
function areaE(lm: number, c: V3, [w, h]: [number, number], disk: boolean, p: V3): number {
  const area = disk ? Math.PI * (w / 2) * (h / 2) : w * h;
  const radiance = lm / (Math.PI * area);
  const n = 200;
  let e = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const u = ((i + 0.5) / n) * 2 - 1; const v = ((j + 0.5) / n) * 2 - 1;
    if (disk && u * u + v * v > 1) continue;
    const q: V3 = [c[0] + (u * w) / 2, c[1], c[2] + (v * h) / 2];
    const d: V3 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const d2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    const cos = d[1] / Math.sqrt(d2);
    e += (radiance * cos * cos) / d2;
  }
  return (e * (w * h)) / (n * n);
}

/** The worst relative error over a 5 × 5 patch around the floor point under `at`, against `want`. */
function patchError(lit: Linear, dark: Linear, at: V3, want: (p: V3) => number): number {
  const [cx, cy] = project(FLOOR_CAM, at).map(Math.floor) as [number, number];
  let worst = 0;
  for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) {
    const e = (lum(lit.at(x, y)) - lum(dark.at(x, y))) * Math.PI;
    worst = Math.max(worst, Math.abs(e / want(onFloor(FLOOR_CAM, x, y)) - 1));
  }
  return worst;
}

describe('#421 the light and material scope on linear targets', () => {
  it('a rect and a disk area light give the illuminance their faces integrate to, within 1%; a 2700 K light keeps its lumens', () => {
    requireReferenceMac();
    const LM = 800;
    // Its local X along the world's X (0.8 m) and its local Y along −Z (0.4 m), shining down.
    const area = (shape: string): JsonObject => ({ kind: 'light.area@1', params: { power: LM, shape, size: [0.8, 0.4] }, at: { pos: [0, 1, 0], rot: [-90, 0, 0] } });
    const point = (params: JsonObject): JsonObject => ({ kind: 'light.point@1', params: { power: LM, ...params }, at: { pos: [0, 1, 0] } });
    const [dark, rect, disk, plain, warm] = linear([
      floorDoc('dark', null), floorDoc('rect', area('rect')), floorDoc('disk', area('disk')),
      floorDoc('plain', point({ color: [1, 1, 1] })), floorDoc('warm', point({ temperature: 2700 })),
    ]);
    for (const at of [[0, 0, 0], [0.6, 0, 0.3]] as V3[]) {
      const r = patchError(rect!, dark!, at, (p) => areaE(LM, [0, 1, 0], [0.8, 0.4], false, p));
      const d = patchError(disk!, dark!, at, (p) => areaE(LM, [0, 1, 0], [0.8, 0.4], true, p));
      expect(r, `the rect at ${at}: worst error ${(r * 100).toFixed(2)}%`).toBeLessThan(0.01);
      expect(d, `the disk at ${at}: worst error ${(d * 100).toFixed(2)}%`).toBeLessThan(0.01);
    }
    const [cx, cy] = project(FLOOR_CAM, [0, 0, 0]).map(Math.floor) as [number, number];
    const w = warm!.at(cx, cy); const p = plain!.at(cx, cy);
    expect(lum(w) / lum(p), 'a temperature changes the color, never the lumens').toBeCloseTo(1, 2);
    expect(w[0] / w[2], `2700 K is warm: ${w}`).toBeGreaterThan(1.5);
  }, 900_000);

  it('a clear coat adds a sharp highlight and takes what it reflects from the layers below', () => {
    const cam: V3 = [0, 4, 4];
    // The sun shines along (0, −0.707, 0.707), so its mirror direction off the floor's centre meets the camera.
    const doc = (coat: number): JsonObject => sessionDoc(`coat-${coat}`, SIZE, {
      cam: camera(cam, [0, 0, 0], 50),
      paint: material({ base_color: [0.5, 0.5, 0.5, 1], roughness: 0.6, coat, coat_roughness: 0.05 }),
      floor: box([20, 0.1, 20], { pos: [0, -0.05, 0] }, { material: 'paint' }),
      sun: { kind: 'light.sun@1', params: { illuminance: 100, color: [1, 1, 1] }, at: { rot: [-135, 0, 0] } },
    });
    const [bare, coated] = linear([doc(0), doc(1)]);
    const [cx, cy] = project(FLOOR_CAM, [0, 0, 0]).map(Math.round) as [number, number];
    const hi = (l: Linear): number => { let m = 0; for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) m = Math.max(m, lum(l.at(x, y))); return m; };
    expect(hi(coated!) / hi(bare!), 'the coat\'s highlight at the mirror angle').toBeGreaterThan(1.5);
    // Well away from the highlight, the coat's own reflection is small and what it took from below shows.
    const far = (l: Linear): number => lum(l.at(cx, SIZE[1] - 8));
    expect(far(coated!) / far(bare!), 'away from the highlight the coated floor is darker').toBeLessThan(0.99);
  }, 900_000);

  it('see-through parts composite back to front by depth plus sort_bias, ties by ID, whatever the document order; add parts add; mask parts cut at 0.5', () => {
    const cam: V3 = [0, 0, 5];
    const unlit = (rgb: V3, alpha: number, alpha_mode: string): JsonObject => material({ base_color: [...rgb, 1], alpha, alpha_mode, unlit: true });
    const doc = (name: string, panels: [string, JsonObject, number, JsonObject?][], mats: Record<string, JsonObject>): JsonObject => {
      const items: Record<string, JsonObject> = { cam: camera(cam, [0, 0, 0], 40), wall_mat: unlit([1, 1, 1], 1, 'opaque'), ...mats };
      items['wall'] = box([10, 10, 0.1], { pos: [0, 0, -2] }, { material: 'wall_mat' });
      for (const [id, m, z, extra] of panels) items[id] = box([2, 2, 0.01], { pos: [0, 0, z] }, { material: (m as { name: string }).name, ...(extra ?? {}) });
      return sessionDoc(`clear-${name}`, SIZE, items);
    };
    const mats = { red: unlit([1, 0, 0], 0.5, 'blend'), blue: unlit([0, 0, 1], 0.5, 'blend'), radd: unlit([1, 0, 0], 0.5, 'add'), gadd: unlit([0, 1, 0], 0.5, 'add'), mlo: unlit([1, 0, 0], 0.4, 'mask'), mhi: unlit([1, 0, 0], 0.6, 'mask') };
    const m = (name: string): JsonObject => ({ name });
    const [frontFirst, backFirst, biased, addAB, addBA, maskLo, maskHi] = linear([
      doc('front-first', [['a', m('red'), 0], ['b', m('blue'), -0.5]], mats),
      doc('back-first', [['b', m('blue'), -0.5], ['a', m('red'), 0]], mats),
      // A sort_bias of 2 m sorts the nearer red panel as if behind the blue one.
      doc('biased', [['a', m('red'), 0, { sort_bias: 2 }], ['b', m('blue'), -0.5]], mats),
      doc('add-ab', [['a', m('radd'), 0], ['b', m('gadd'), -0.5]], mats),
      doc('add-ba', [['b', m('gadd'), -0.5], ['a', m('radd'), 0]], mats),
      doc('mask-lo', [['a', m('mlo'), 0]], mats),
      doc('mask-hi', [['a', m('mhi'), 0]], mats),
    ]);
    const c = (l: Linear): number[] => l.at(SIZE[0] / 2, SIZE[1] / 2).map((v) => Number(v.toFixed(4)));
    // over(red, over(blue, white)) = [0.75, 0.25, 0.5]; drawn the other way it would be [0.5, 0.25, 0.75].
    expect(c(frontFirst!), 'red over blue over the wall').toEqual([0.75, 0.25, 0.5]);
    expect(c(backFirst!), 'the same with the document order swapped').toEqual([0.75, 0.25, 0.5]);
    expect(c(biased!), 'sort_bias draws the nearer panel first').toEqual([0.5, 0.25, 0.75]);
    expect(c(addAB!), 'two add parts add to the wall').toEqual([1.5, 1.5, 1]);
    expect(c(addBA!), 'in either order').toEqual(c(addAB!));
    expect(c(maskLo!), 'a mask part below its cutoff draws nothing').toEqual([1, 1, 1]);
    expect(c(maskHi!), 'one above it draws opaque').toEqual([1, 0, 0]);
  }, 900_000);

  it('a shadow catcher darkens what is behind it by the share of light its shadow removes, and draws nothing elsewhere', () => {
    // A box on a catcher over a white backdrop, the sun shining toward the camera so the shadow lies in front of the box.
    const doc = (withBox: boolean): JsonObject => sessionDoc(`catch-${withBox}`, SIZE, {
      cam: camera(FLOOR_CAM.position, FLOOR_CAM.target, FLOOR_CAM.fov),
      back: material({ base_color: [1, 1, 1, 1], unlit: true }),
      catcher: material({ catch: 'shadow' }),
      backdrop: box([20, 0.1, 20], { pos: [0, -0.3, 0] }, { material: 'back' }),
      floor: box([20, 0.1, 20], { pos: [0, -0.05, 0] }, { material: 'catcher' }),
      ...(withBox ? { block: box([1, 1, 1], { pos: [0, 0.5, 0] }, { material: 'back' }) } : {}),
      sun: { kind: 'light.sun@1', params: { illuminance: 100, color: [1, 1, 1], shadow: true }, at: { rot: [-135, 0, 0] } },
    });
    const [shadowed, open] = linear([doc(true), doc(false)]);
    const at = (l: Linear, p: V3): number => { const [x, y] = project(FLOOR_CAM, p).map(Math.floor) as [number, number]; return lum(l.at(x, y)); };
    // The shadow of the box's top front edge (y 1, z 0.5) lands at z = 1.5; (0, 0, 1) is well inside it.
    expect(at(shadowed!, [0, 0, 1]), 'inside the shadow the catcher is black').toBeLessThan(0.05);
    expect(at(shadowed!, [1.6, 0, 1]), 'beside it the backdrop shows unchanged').toBeCloseTo(1, 2);
    expect(at(open!, [0, 0, 1]), 'with no caster the catcher draws nothing').toBeCloseTo(1, 2);
  }, 900_000);

  it('a pattern lives in its part\'s own space and its seed: varied, the same for one seed, moved with its part', () => {
    const wall = (name: string, x: number, params: JsonObject): JsonObject => sessionDoc(`pattern-${name}`, SIZE, {
      cam: camera([x, 0, 4], [x, 0, 0], 40),
      stone: material({ base_color: [0.8, 0.7, 0.6, 1], unlit: true, ...params }),
      wall: box([3, 3, 0.2], { pos: [x, 0, 0] }, { material: 'stone' }),
    });
    const [flat, a, a2, b, moved] = linear([
      wall('flat', 0, {}),
      wall('a', 0, { pattern: 'stone_courses', pattern_seed: 1 }),
      wall('a-again', 0, { pattern: 'stone_courses', pattern_seed: 1 }),
      wall('b', 0, { pattern: 'stone_courses', pattern_seed: 2 }),
      wall('moved', 0.37, { pattern: 'stone_courses', pattern_seed: 1 }),
    ]);
    const region: [number, number][] = [];
    for (let y = 100; y < 220; y += 3) for (let x = 100; x < 220; x += 3) region.push([x, y]);
    const values = (l: Linear): number[] => region.map(([x, y]) => lum(l.at(x, y)));
    const spread = (v: number[]): number => Math.max(...v) - Math.min(...v);
    expect(spread(values(flat!)), 'no pattern: one tone').toBeLessThan(1e-4);
    expect(spread(values(a!)), 'stone courses: stones and mortar').toBeGreaterThan(0.05);
    expect(values(a2!), 'one seed, the same pixels').toEqual(values(a!));
    const differ = values(b!).filter((v, i) => Math.abs(v - values(a!)[i]!) > 1e-3).length;
    expect(differ, 'another seed, other stones').toBeGreaterThan(region.length / 10);
    const same = values(moved!).filter((v, i) => Math.abs(v - values(a!)[i]!) < 1e-3).length;
    expect(same / region.length, 'moved with its camera, the pattern moves with the part').toBeGreaterThan(0.99);
  }, 900_000);

  it('lights asking for a shadow the budget leaves without one are named in lights_over_budget', () => {
    const out = dir();
    const spot = (z: number): JsonObject => ({ kind: 'light.spot@1', params: { power: 800, shadow: true }, at: { pos: [0, 2, z], rot: [-90, 0, 0] } });
    const sun = (lx: number): JsonObject => ({ kind: 'light.sun@1', params: { illuminance: lx, shadow: true }, at: { rot: [-90, 0, 0] } });
    const doc = sessionDoc('shadow-budget', SIZE, {
      cam: camera(FLOOR_CAM.position, FLOOR_CAM.target, FLOOR_CAM.fov), white,
      floor: box([20, 0.1, 20], { pos: [0, -0.05, 0] }, { material: 'white' }),
      'sun-a': sun(200), 'sun-b': sun(100), 's1': spot(0), 's2': spot(1),
    });
    const [reply] = runGpu(bins.bin('deep-gpu'), out, [view3dCall({ doc: writeJson(out, 'doc', doc), look: PLAIN_LOOK, size: SIZE, frames: 1, capture: [0], targets: ['linear'] })]);
    const frame = (reply!['frames'] as JsonObject[])[0]!;
    const notices = frame['notices'] as JsonObject[];
    // One sun keeps the key shadow; the second sun is past the budget, and spot maps land with local shadows (#446).
    expect(notices, JSON.stringify(frame).slice(0, 600)).toEqual([{ code: 'lights_over_budget', lights: [], shadows: ['s1', 's2', 'sun-b'] }]);
  }, 900_000);
});
