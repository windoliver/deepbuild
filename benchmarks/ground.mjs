import { FLARE_SIZE } from './stages.mjs';

const VASE = [[0, 0], [0.3, 0.02], [0.34, 0.1], [0.36, 0.3], [0.3, 0.5], [0.2, 0.62], [0.16, 0.7], [0.18, 0.8], [0.22, 0.86], [0.2, 0.9], [0, 0.9]].map((p) => [...p, false]);
export const groundMaterial = (base, roughness = 0.8) => ({ kind: 'material@1', params: { base_color: [...base, 1], roughness, metallic: 0 } });
const groundBox = (size, pos, material, more = {}) => ({ kind: 'mark.box@1', params: { size }, at: { pos }, material, ...more });
const groundFlat = (size, pos, material) => ({ kind: 'plate@1', params: { grid: [1, 1], size }, at: { pos }, material });
export const groundCamera = (position, target) => ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov: 60, near: 0.5, far: 2000 } });
export const groundSun = { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: false }, at: { rot: [-35, 30, 0] } };
const groundSky = { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.6, 0.7, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } };
const groundMaterials = () => ({ clay: groundMaterial([0.62, 0.4, 0.3], 0.6), leaves: groundMaterial([0.2, 0.42, 0.18], 0.9), petals: groundMaterial([0.85, 0.4, 0.55], 0.7), soil: groundMaterial([0.35, 0.28, 0.2], 1) });
const groundProtos = () => ({ bush: groundBox([0.6, 0.6, 0.6], [0, 0.3, 0], 'leaves', { visible: false }), flower: groundBox([0.2, 0.2, 0.2], [0, 0.1, 0], 'petals', { visible: false }) });
const groundProp = (segments, pos) => ({ kind: 'lathe@1', params: { outline: VASE, segments }, material: 'clay', at: { pos },
  modifiers: [{ kind: 'mod.bevel@1', params: { width: 0.002, segments: 2 } }, { kind: 'mod.normals@1', params: { mode: 'weighted' } }] });
const groundMesh = (segments, pos) => ({ kind: 'lathe@1', params: { outline: VASE, segments }, material: 'clay', at: { pos }, modifiers: [{ kind: 'mod.subdivide@1', params: { levels: 2 } }] });
const groundPath = (spans, c) => ({ kind: 'curve@1', params: { mode: 'catmull_rom',
  points: Array.from({ length: spans + 1 }, (_, k) => [c[0] + 20 * Math.cos(k * 0.05), c[1] + 0.01 * k, c[2] + 20 * Math.sin(k * 0.05)]) } });
const groundScatter = (on, max) => ({ kind: 'instance@1', params: { of: ['bush', 'flower'],
  from: { distribute: { on, mode: 'poisson', min_distance: 0.5, prune: 'larger_first', seed: 2017, ...(max === undefined ? {} : { max }) } } } });
const GROUND_PLATE = { height: '0.03 * (1 - 4 * fract(position.x * 0.5)) + 6 * sin(position.x * 0.025) * cos(position.z * 0.019) + 2 * sin((position.x + position.z) * 0.07)',
  size: [512, 512], spacing: 1, tile: 64, lod_levels: 6 };
export function groundDoc(id, size, items) {
  let order = 0;
  for (const [key, item] of Object.entries(items)) Object.assign(item, { id: key, name: key, order: `a${String(order++).padStart(4, '0')}`, layer: 'main' });
  return { format: 1, id, profile: 'scene', title: id, description: `${id}: the #2017 budgets' fixture.`, size, camera: 'cam', seed: 2017,
    requires: { modules: { scene3d: '^1' } }, budget: { class: 'work_product' }, layers: { main: { writer: 'agent:alpha', title: 'Main', order: 'a0' } }, items };
}
export const groundStages = () => ({
  budget: groundDoc('budgets-2017', [640, 360], { cam: groundCamera([0, 30, 150], [0, 0, 0]), sun: groundSun, ...groundMaterials(),
    prop: groundProp(1000, [0, 0, 0]), mesh: groundMesh(100, [2, 0, 0]), field: groundFlat([200, 200], [0, 0, 0], 'soil'), ...groundProtos(),
    scatter: groundScatter('field', 100_000), path: groundPath(1000, [0, 1, 0]) }),
  bare: groundDoc('still-2017-bare', [640, 360], { cam: groundCamera([0, 25, 300], [0, 0, 0]), sky: groundSky, sun: groundSun, turf: groundMaterial([0.3, 0.42, 0.2], 0.9),
    ...groundMaterials(), block: groundBox([1, 1, 1], [0, 12.5, 230], 'clay') }),
  still: groundDoc('still-2017', [640, 360], { cam: groundCamera([0, 25, 300], [0, 0, 0]), sky: groundSky, sun: groundSun, turf: groundMaterial([0.3, 0.42, 0.2], 0.9),
    ...groundMaterials(), ground: { kind: 'plate@1', params: { terrain: { ...GROUND_PLATE } }, material: 'turf' },
    lawn: groundFlat([10, 10], [0, 12, 230], 'soil'), ...groundProtos(), shrubs: groundScatter('lawn'), prop: groundProp(64, [-6, 12, 240]), mesh: groundMesh(16, [6, 12, 240]),
    path: groundPath(100, [0, 14, 200]),
    rail: { kind: 'extrude@1', params: { outline: [[0, -0.05], [0.1, -0.05], [0.1, 0.05], [0, 0.05]], along: { curve: 'path', range: [0, 1], rings: 256 } }, material: 'clay' } }),
  ...Object.fromEntries([true, false].map((swaying) => {
    const pos = Array.from({ length: 10_000 }, (_, k) => [3 * (k % 100), 0, 3 * Math.floor(k / 100)]);
    return [swaying ? 'forestOn' : 'forestOff', groundDoc(`forest-2017-${swaying}`, FLARE_SIZE, {
      cam: groundCamera([148.5, 35, 360], [148.5, 0, 140]), sky: groundSky, sun: groundSun, needles: groundMaterial([0.18, 0.4, 0.2], 0.9), soil: groundMaterial([0.35, 0.28, 0.2], 1),
      earth: groundFlat([320, 320], [148.5, 0, 148.5], 'soil'),
      tree: { kind: 'lathe@1', params: { outline: [[0, 0, false], [0.25, 0.1, false], [0.25, 1, false], [1.2, 1.2, false], [0, 3.5, false]], segments: 249 }, material: 'needles', visible: false,
        modifiers: [{ kind: 'mod.sway@1', enabled: swaying, params: { amount: 0.3, wind: { direction: 0, speed: 5, gust: { scale: 20 } }, seed: 7 } }] },
      forest: { kind: 'instance@1', params: { of: ['tree'], ids: pos.map((_, k) => k), proto: pos.map(() => 0), pos, yaw: pos.map((_, k) => (k * 137.5) % 360), scale: pos.map(() => 1) } },
    })];
  })),
});
