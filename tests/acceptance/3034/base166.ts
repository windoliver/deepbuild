// #166's suite, drawn again: criterion 5's "#166's suite hashes the same as on the merge base".
//
// Suites don't import each other, so the documents, looks and calls of tests/acceptance/166/ are written out again
// here, value for value: its lake seen from above (waves.test.ts), its harbour with waves, ripples and rain
// (seek.test.ts), its pond under a post (mirror.test.ts), its pool over a sinking bed (tint.test.ts), `water: {}`
// (defaults.test.ts), its lake in the rain (rain.test.ts), its foam and a boat's wake (foam.test.ts), its floating
// body's wake (physics.test.ts), its screenshot of the lake (taste.test.ts) and the two scenes its budgets time
// (budgets.test.ts). Each is seeded 166 and described as #166's own are, so `view3d` gets the document #166's suite
// gives it. Every one of them holds its camera above the water, so each is a frame the issue says doesn't change.
//
// What is hashed, for each frame named: the frame's `pixel_hash` (the SHA-256 of the slot drawn, as #166's seek,
// defaults, rain, foam and physics tests compare it) and, where #166's test reads a float target instead of the
// picture, that target's file by its SHA-256 (`depth` for the waves, `reflection` for the mirror, `pre_tone` for the
// tint). The merge base's hashes are a fact of the base, held in base-hashes.json (README: The merge base's hashes).

import {
  DARK_SKY, DAY_SKY, STILL, type JsonObject, type Target, type V3, type View3d, type Water, type Wave, box, camera, channel, look3d, material, plate,
  sceneDoc, sun, view3d, waterMaterial, writeJson,
} from './helpers.ts';

const look166 = (id: string, change: JsonObject = {}): JsonObject => look3d(id, change, 166);
/** #166's filmic look (its taste call's and its budgets'). */
const FILMIC_166 = look166('filmic-166', { tone_map: 'filmic', exposure: 0 });
const doc166 = (id: string, size: readonly [number, number], items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject => sceneDoc(id, size, items, extra, 166);

/** #166's four waves of the lake fixture, and its steeper ones. */
const LAKE_WAVES: Wave[] = [
  { direction: 20, length: 9, amplitude: 0.12, steepness: 0.5 },
  { direction: 110, length: 6, amplitude: 0.08, steepness: 0.6 },
  { direction: 235, length: 4.5, amplitude: 0.05, steepness: 0.4 },
  { direction: 300, length: 3.2, amplitude: 0.03, steepness: 0.7 },
];
const STEEP_WAVES: Wave[] = [
  { direction: 15, length: 7, amplitude: 0.35, steepness: 0.9 },
  { direction: 80, length: 5, amplitude: 0.22, steepness: 0.9 },
  { direction: 200, length: 4, amplitude: 0.15, steepness: 0.8 },
  { direction: 320, length: 3, amplitude: 0.1, steepness: 0.8 },
];

/** #166's harbour (its helpers.ts): the lake plate `lake`, 40 m × 40 m of 256 × 256 cells, a red post and two crates on
 * the shore, a day sky and a sun, seen from a low camera; with `boat`, a boat keyed across the lake. */
function harbour(id: string, size: readonly [number, number], water: Water, opts: { boat?: boolean } = {}): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: camera([0, 2.2, 14], [0, 0.6, 0], 50), sky: DAY_SKY, sun: sun(3, [-35, 30, 0]),
    'lake-water': waterMaterial(water, { roughness: 0.05 }),
    'post-red': material({ base_color: [0.85, 0.08, 0.06, 1], roughness: 0.5 }),
    'crate-wood': material({ base_color: [0.55, 0.38, 0.2, 1], roughness: 0.7 }),
    'hull-white': material({ base_color: [0.9, 0.9, 0.88, 1], roughness: 0.4 }),
    lake: plate([40, 40], [256, 256], [0, 0, 0], 'lake-water'),
    post: box([0.3, 3, 0.3], [-2, 1, -2], 'post-red'),
    crate1: box([1, 1, 1], [3, 0.3, -5], 'crate-wood'),
    crate2: box([1.4, 0.8, 1.4], [-5, 0.2, -7], 'crate-wood'),
  };
  if (opts.boat) items['boat'] = box([1.8, 0.5, 0.7], [-12, 0.15, 2], 'hull-white');
  return doc166(id, size, items, opts.boat ? { channels: { sail: channel('items/boat/at/pos/0', [[0, -12], [24, 12]]) } } : {});
}

/** waves.test.ts: a 16 m lake of 512 × 512 cells with the four waves, seen straight down from 10 m. */
const lakeDepth = (): JsonObject => doc166('lake-depth', [640, 480], {
  cam: camera([0, 10, 0], [0, 0, 0], 40), sky: DARK_SKY,
  'lake-water': waterMaterial({ waves: LAKE_WAVES, ripples: { strength: 0 }, rain: 0 }, { roughness: 0.05 }),
  lake: plate([16, 16], [512, 512], [0, 0, 0], 'lake-water'),
});

/** mirror.test.ts: the pond under a red post, its water at roughness 0. */
const pond = (id: string, water: Water): JsonObject => doc166(id, [640, 360], {
  cam: camera([0, 1.5, 9], [0, 0.8, 0], 50), sky: DARK_SKY, 'lake-water': waterMaterial(water, { roughness: 0 }),
  'post-red': material({ base_color: [1, 0, 0, 1], unlit: true }),
  lake: plate([40, 40], [256, 256], [0, 0, 0], 'lake-water'),
  post: { kind: 'mark.box@1', params: { size: [0.4, 3, 0.4] }, at: { pos: [0, 1, 0] }, material: 'post-red' },
});

/** tint.test.ts: the still pool over an unlit bed that a channel holds 0.2 m, 1 m and 5 m under the water. */
const TINT_DEPTHS: [number, number][] = [[0.2, 0], [1, 30], [5, 60]];
function pool(bed: V3): JsonObject {
  return doc166(`pool-water-${bed[0]}`, [400, 400], {
    cam: camera([0, 6, 0], [0, 0, 0], 20), sky: DARK_SKY,
    'bed-paint': material({ base_color: [...bed, 1], unlit: true }),
    bed: { kind: 'mark.box@1', params: { size: [30, 0.2, 30] }, at: { pos: [0, -0.3, 0] }, material: 'bed-paint' },
    'lake-water': waterMaterial({ ...STILL, distort: 0, absorption: { depth: 3 } }, { mirror: { strength: 0, blur: 0, plane: 'lake' } }),
    lake: plate([30, 30], [8, 8], [0, 0, 0], 'lake-water'),
  }, { channels: { sink: channel('items/bed/at/pos/1', TINT_DEPTHS.map(([d], k): [number, number] => [k, -d - 0.1])) } });
}

/** rain.test.ts: a still 6 m lake in rain at 50 drops per m² per s, seen straight down from 8 m. */
const rainLake = (): JsonObject => doc166('rain-166-50', [480, 480], {
  cam: camera([0, 8, 0], [0, 0, 0], 45), sky: DAY_SKY, sun: sun(3, [-40, 25, 0]),
  'lake-water': waterMaterial({ ...STILL, rain: 50 }, { roughness: 0.05 }),
  lake: plate([6, 6], [64, 64], [0, 0, 0], 'lake-water'),
}, { seed: 166 });

/** physics.test.ts: the stand-in world's buoyant skiff, poked at 5 s, and its wake. */
const float = (): JsonObject => doc166('float', [320, 180], {
  cam: camera([0, 3, 14], [0, 0.3, 0], 50), sky: DAY_SKY, sun: sun(3, [-35, 30, 0]),
  'lake-water': waterMaterial({ waves: STEEP_WAVES, foam: { threshold: 0.6 }, wake: { item: 'harbour-world#skiff', span: 8 } }, { roughness: 0.05 }),
  'hull-white': material({ base_color: [0.9, 0.9, 0.88, 1], roughness: 0.4 }),
  lake: plate([40, 40], [256, 256], [0, 0, 0], 'lake-water'),
  'harbour-world': {
    kind: 'fixture.world@1', material: 'hull-white',
    params: {
      step_hz: 120, span: '25s', gravity: -9.81, floor: -10, restitution: 0,
      bodies: { skiff: { radius: 0.4, pos: [-6, 0.6, 1], vel: [0, 0, 0], density: 500 } },
      buoyancy: { level: 0, density: 1000 },
      inputs: [{ step: 600, kind: 'poke', target: 'skiff', data: { push: [0.6, 0, 0] } }],
    },
  },
});

/** budgets.test.ts: the lake filling the lower half of a 1080p frame, with its twelve crates, and the far pond. */
function budgetLake(): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: camera([0, 2, 0], [0, 2, -100], 60), sky: DAY_SKY, sun: sun(3, [-30, 30, 0]),
    'lake-water': waterMaterial({ waves: LAKE_WAVES, ripples: { strength: 0.3 }, rain: 50 }, { roughness: 0 }),
    crate: material({ base_color: [0.55, 0.38, 0.2, 1], roughness: 0.7 }),
    lake: plate([400, 400], [256, 256], [0, 0, 0], 'lake-water'),
  };
  for (let k = 0; k < 12; k++) items[`crate${k}`] = box([1.5, 1.5, 1.5], [-15 + 2.7 * k, 0.5, -20 - 4 * (k % 3)], 'crate');
  return doc166('lake-water', [1920, 1080], items);
}
const budgetPond = (): JsonObject => doc166('pond-water', [1920, 1080], {
  cam: camera([0, 40, 300], [0, 0, 0], 60), sky: DAY_SKY, sun: sun(3, [-30, 30, 0]),
  'lake-water': waterMaterial({ waves: LAKE_WAVES, ripples: { strength: 0 }, rain: 0 }, { roughness: 0 }),
  lake: plate([10, 10], [256, 256], [0, 0, 0], 'lake-water'),
});

/** One of #166's draws: the name it is held under, its document, its call's fields as #166's test gives them, the
 * frames read, and the float target hashed beside each frame's `pixel_hash` when #166's test reads one. */
export interface Draw {
  name: string; doc: JsonObject; call: Omit<View3d, 'doc'>; frames: number[]; target?: Exclude<Target, 'final' | 'linear'>;
}
const seek = (look: JsonObject, size: [number, number], n: number): Omit<View3d, 'doc'> => ({ look, size, from: n, frames: 1, fps: 30 });

/** #166's draws, in the order they are drawn: 17 calls, 23 frames. */
export function draws166(): Draw[] {
  const SEEK = look166('seek-166'); const MIRROR = look166('mirror-166');
  const lakeSeek = harbour('lake-seek', [480, 270], { waves: LAKE_WAVES, ripples: { strength: 0.3 }, rain: 50 });
  const quarter = LAKE_WAVES.map((w) => ({ ...w, amplitude: w.amplitude / 4 }));
  const mirrorCall: Omit<View3d, 'doc'> = { look: MIRROR, size: [640, 360], from: 30, frames: 1, fps: 30, capture: [30], targets: ['reflection'] };
  const tintCall: Omit<View3d, 'doc'> = { look: look166('tint-166'), size: [400, 400], frames: 61, fps: 30, capture: TINT_DEPTHS.map(([, n]) => n), targets: ['pre_tone'] };
  return [
    { name: 'waves: the lake from above', doc: lakeDepth(), call: { look: look166('depth-166'), size: [640, 480], frames: 1, from: 75, fps: 30, capture: [75], targets: ['depth'] }, frames: [75], target: 'depth' },
    { name: 'seek: the harbour with waves, ripples and rain, seeked to 17', doc: lakeSeek, call: seek(SEEK, [480, 270], 17), frames: [17] },
    { name: 'seek: the harbour with waves, ripples and rain, seeked to 44', doc: lakeSeek, call: seek(SEEK, [480, 270], 44), frames: [44] },
    { name: 'seek: the harbour with waves, ripples and rain, seeked to 89', doc: lakeSeek, call: seek(SEEK, [480, 270], 89), frames: [89] },
    { name: 'seek: the harbour without rain', doc: harbour('lake-dry', [480, 270], { waves: LAKE_WAVES, ripples: { strength: 0.3 }, rain: 0 }), call: seek(SEEK, [480, 270], 44), frames: [44] },
    { name: 'seek: the harbour without ripples', doc: harbour('lake-smooth', [480, 270], { waves: LAKE_WAVES, ripples: { strength: 0 }, rain: 50 }), call: seek(SEEK, [480, 270], 44), frames: [44] },
    { name: 'mirror: the post in wavy water', doc: pond('wavy', { waves: quarter, ripples: { strength: 0.3 }, rain: 0, distort: 16 }), call: mirrorCall, frames: [30], target: 'reflection' },
    { name: 'mirror: the post in calm water', doc: pond('calm', { waves: LAKE_WAVES.map((w) => ({ ...w, amplitude: 0 })), ripples: { strength: 0 }, rain: 0, distort: 16 }), call: mirrorCall, frames: [30], target: 'reflection' },
    { name: 'tint: the white bed under the pool', doc: pool([1, 1, 1]), call: tintCall, frames: TINT_DEPTHS.map(([, n]) => n), target: 'pre_tone' },
    { name: 'tint: the black bed under the pool', doc: pool([0, 0, 0]), call: tintCall, frames: TINT_DEPTHS.map(([, n]) => n), target: 'pre_tone' },
    { name: 'defaults: water: {}', doc: harbour('lake-bare', [480, 270], {}), call: { look: look166('defaults-166'), size: [480, 270], frames: 46, fps: 30 }, frames: [0, 20, 45] },
    { name: 'rain: the lake in the rain', doc: rainLake(), call: { look: look166('rain-166'), size: [480, 480], from: 45, frames: 1, fps: 30, capture: [45], rings: true }, frames: [45] },
    { name: 'foam: foam and a boat\'s wake at 20 s', doc: harbour('lake-foamy', [320, 180], { waves: STEEP_WAVES, foam: { threshold: 0.6 }, wake: { item: 'boat', span: 8 } }, { boat: true }), call: seek(look166('foam-166'), [320, 180], 600), frames: [600] },
    { name: 'physics: a floating body\'s wake at 20 s', doc: float(), call: seek(look166('physics-166'), [320, 180], 600), frames: [600] },
    { name: 'taste: the lake with waves and ripples', doc: harbour('lake', [1280, 720], { waves: LAKE_WAVES, ripples: { strength: 0.3 } }), call: { look: FILMIC_166, size: [1280, 720], from: 30, frames: 1, fps: 30, capture: [30], targets: ['final'] }, frames: [30] },
    { name: 'budgets: the lake filling half a 1080p frame', doc: budgetLake(), call: { look: FILMIC_166, size: [1920, 1080], frames: 1, fps: 30 }, frames: [0] },
    { name: 'budgets: the far pond', doc: budgetPond(), call: { look: FILMIC_166, size: [1920, 1080], frames: 1, fps: 30 }, frames: [0] },
  ];
}
/** The `view3d` call of a draw, its document written under `dir`. */
export const call166 = (dir: string, d: Draw, k: number): JsonObject => view3d({ doc: writeJson(dir, `base166-${k}`, d.doc), ...d.call });
