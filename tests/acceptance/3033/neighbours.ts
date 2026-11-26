// #166's and #968's documents, for criterion 5 ("With `waves` left as it is, #166's and #968's suites hash the same as
// on the merge base"): the water documents those two suites' tests hash, in the variants, looks, sizes and frames their
// tests draw them at, each with `waves` as that suite wrote it (a list of four, a wind, or absent). Suites don't import
// each other, so the fixtures are repeated here from tests/acceptance/166/helpers.ts (`harbour`, `LAKE_WAVES`,
// `STEEP_WAVES`, `DEFAULTS`) and mirror.test.ts (`pond`), and from tests/acceptance/968/helpers.ts (`channelDoc`,
// `riverDoc`, `FLAT`, `CHANNEL_FLOW`, `RIVER_FLOW`) and taste.test.ts (`BREEZE`, its cameras), with each suite's own
// seed and descriptions (helpers.ts: `sceneDoc`, `look3d`, by the suite's number). README: Criterion 5's fixtures.

import { type JsonObject, type Size, type V3, DAY_SKY, box, camera, filmic, look3d, material, plate, sceneDoc, sun } from './helpers.ts';

/** One fixture: its document, look and size as its suite's own test draws it, the frames whose pixel hash that suite
 * compares, and whether it also compares the `reflection` target's hash there. */
export interface Fixture { name: string; doc: JsonObject; look: JsonObject; size: Size; frames: number[]; reflection?: true }

// ---------------------------------------------------------------------------------------------------
// #166 (tests/acceptance/166/helpers.ts)

type Wave = { direction: number; length: number; amplitude: number; steepness: number };
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
/** Every default of #166's Fields row spelled out. */
const DEFAULTS: JsonObject = {
  waves: { wind: { speed: 3, direction: 0 } }, ripples: { scale: 0.5, strength: 0.3 }, rain: 0,
  absorption: { color: [0.12, 0.42, 0.40], depth: 3 }, distort: 16, foam: { threshold: 1 }, wake: 'none',
};
/** A linear f32 channel on an item's path, keyed at seconds. */
function channel(target: string, keys: [number, number][]): JsonObject {
  return { target, type: 'f32', keys: Object.fromEntries(keys.map(([t, value], k) => [`k${k}`, { t: `${t}s`, value, interp: 'linear' }])) };
}
/** #166's harbour: a 40 m lake of 256 × 256 cells whose material `lake-water` carries `water`, a red post and two
 * crates, a day sky and a sun, seen from a low camera; with `boat`, a boat keyed across the lake. */
function harbour(id: string, size: Size, water: JsonObject, opts: { boat?: boolean; waterExtra?: JsonObject } = {}): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: camera([0, 2.2, 14], [0, 0.6, 0], 50), sky: DAY_SKY, sun: sun(3, [-35, 30, 0]),
    'lake-water': material({ roughness: 0.05, ...(opts.waterExtra ?? {}), water }),
    'post-red': material({ base_color: [0.85, 0.08, 0.06, 1], roughness: 0.5 }),
    'crate-wood': material({ base_color: [0.55, 0.38, 0.2, 1], roughness: 0.7 }),
    'hull-white': material({ base_color: [0.9, 0.9, 0.88, 1], roughness: 0.4 }),
    lake: plate([40, 40], [256, 256], [0, 0, 0], 'lake-water'),
    post: box([0.3, 3, 0.3], [-2, 1, -2], 'post-red'),
    crate1: box([1, 1, 1], [3, 0.3, -5], 'crate-wood'),
    crate2: box([1.4, 0.8, 1.4], [-5, 0.2, -7], 'crate-wood'),
  };
  if (opts.boat) items['boat'] = box([1.8, 0.5, 0.7], [-12, 0.15, 2], 'hull-white');
  return sceneDoc(166, id, size, items, opts.boat ? { channels: { sail: channel('items/boat/at/pos/0', [[0, -12], [24, 12]]) } } : {});
}
/** #166's mirror pond (mirror.test.ts): the lake under a black sky reflecting an unlit red post. */
function pond(id: string, size: Size, water: JsonObject): JsonObject {
  return sceneDoc(166, id, size, {
    cam: camera([0, 1.5, 9], [0, 0.8, 0], 50),
    sky: { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } },
    'lake-water': material({ roughness: 0, water }),
    'post-red': material({ base_color: [1, 0, 0, 1], unlit: true }),
    lake: plate([40, 40], [256, 256], [0, 0, 0], 'lake-water'),
    post: { kind: 'mark.box@1', params: { size: [0.4, 3, 0.4] }, at: { pos: [0, 1, 0] }, material: 'post-red' },
  });
}

// ---------------------------------------------------------------------------------------------------
// #968 (tests/acceptance/968/helpers.ts)

const line = (points: V3[]): JsonObject => ({ kind: 'curve@1', params: { points, mode: 'linear' } });
const FLAT: JsonObject = { waves: { wind: { speed: 0, direction: 0 } }, ripples: { scale: 0.5, strength: 0.1 }, rain: 0, foam: { threshold: 1 } };
const CHANNEL_FLOW: JsonObject = { along: 'c', speed: 1.5, cycle: 2 };
const RIVER_FLOW: JsonObject = { along: { x: '0.5 + 0.0625 * (x + 20)', z: '0' }, speed: 1, cycle: 2 };
const BANKS = { stone: material({ base_color: [0.5, 0.48, 0.45, 1], roughness: 0.9 }), sand: material({ base_color: [0.55, 0.48, 0.36, 1], roughness: 0.9 }) };
/** #968's straight 40 m channel: a 40 m × 8 m plate of 512 × 128 cells, the curve `c` along its centre, banks and a bed. */
function channelDoc(id: string, size: Size, cam: JsonObject, water: JsonObject): JsonObject {
  return sceneDoc(968, id, size, {
    cam, sky: DAY_SKY, sun: sun(3, [-35, 30, 0]),
    'channel-water': material({ roughness: 0.05, water }),
    ...BANKS,
    c: line([[-20, 0, 0], [20, 0, 0]]),
    channel: plate([40, 8], [512, 128], [0, 0, 0], 'channel-water'),
    'bank-left': box([40, 2, 3], [0, 0.2, -5.5], 'stone'),
    'bank-right': box([40, 2, 3], [0, 0.2, 5.5], 'stone'),
    bed: box([40, 0.2, 8], [0, -1.6, 0], 'sand'),
  });
}
/** #968's river with rapids: a 40 m × 10 m plate of 512 × 128 cells, banks and a bed. */
function riverDoc(id: string, size: Size, cam: JsonObject, water: JsonObject): JsonObject {
  return sceneDoc(968, id, size, {
    cam, sky: DAY_SKY, sun: sun(3, [-35, 30, 0]),
    'river-water': material({ roughness: 0.05, water }),
    ...BANKS,
    river: plate([40, 10], [512, 128], [0, 0, 0], 'river-water'),
    'bank-left': box([40, 2, 3], [0, 0.2, -6.5], 'stone'),
    'bank-right': box([40, 2, 3], [0, 0.2, 6.5], 'stone'),
    bed: box([40, 0.2, 10], [0, -1.6, 0], 'sand'),
  });
}

// ---------------------------------------------------------------------------------------------------
// The fixtures and frames those suites' tests hash

/** Every fixture, each named `<suite>/<document>`; every frame is opened by a seek at 30 fps. */
export function neighbourFixtures(): Fixture[] {
  const room: Size = [640, 360]; const shot: Size = [1280, 720]; const lake: Size = [480, 270]; const small: Size = [320, 180]; const square: Size = [256, 256];
  const [seek166, defaults166, foam166, mirror166, channel968] = [look3d(166, 'seek-166'), look3d(166, 'defaults-166'), look3d(166, 'foam-166'), look3d(166, 'mirror-166'), look3d(968, 'channel-968')];
  const named: JsonObject = { mirror: { strength: 1, blur: 0, plane: 'lake' } };
  const waves: JsonObject = { waves: LAKE_WAVES, ripples: { strength: 0.3 } };
  const foamy: JsonObject = { waves: STEEP_WAVES, foam: { threshold: 0.6 }, wake: { item: 'boat', span: 8 } };
  const breeze: JsonObject = { waves: { wind: { speed: 1.5, direction: 90 } }, ripples: { strength: 0.5 } };
  const channelCam = (): JsonObject => camera([-17, 3.5, 5], [6, 0, -1], 50);
  return [
    // ../166/seek.test.ts
    { name: '166/lake-seek', doc: harbour('lake-seek', lake, { ...waves, rain: 50 }), look: seek166, size: lake, frames: [17, 44, 89] },
    { name: '166/lake-dry', doc: harbour('lake-dry', lake, { ...waves, rain: 0 }), look: seek166, size: lake, frames: [44] },
    { name: '166/lake-smooth', doc: harbour('lake-smooth', lake, { waves: LAKE_WAVES, ripples: { strength: 0 }, rain: 50 }), look: seek166, size: lake, frames: [44] },
    // ../166/defaults.test.ts
    { name: '166/lake-bare', doc: harbour('lake-bare', lake, {}, { waterExtra: {} }), look: defaults166, size: lake, frames: [0, 20, 45] },
    { name: '166/lake-spelled', doc: harbour('lake-spelled', lake, DEFAULTS, { waterExtra: named }), look: defaults166, size: lake, frames: [0, 20, 45] },
    { name: '166/lake-wind6', doc: harbour('lake-wind6', lake, { ...DEFAULTS, waves: { wind: { speed: 6, direction: 0 } } }, { waterExtra: named }), look: defaults166, size: lake, frames: [20] },
    { name: '166/lake-half-mirror', doc: harbour('lake-half-mirror', lake, DEFAULTS, { waterExtra: { mirror: { strength: 0.5, blur: 0, plane: 'lake' } } }), look: defaults166, size: lake, frames: [20] },
    { name: '166/lake-red-tint', doc: harbour('lake-red-tint', lake, { ...DEFAULTS, absorption: { color: [0.5, 0.1, 0.1], depth: 3 } }, { waterExtra: named }), look: defaults166, size: lake, frames: [20] },
    // ../166/foam.test.ts
    { name: '166/lake-foamy', doc: harbour('lake-foamy', small, foamy, { boat: true }), look: foam166, size: small, frames: [600] },
    { name: '166/lake-no-foam', doc: harbour('lake-no-foam', small, { ...foamy, foam: { threshold: 1 } }, { boat: true }), look: foam166, size: small, frames: [600] },
    { name: '166/lake-no-wake', doc: harbour('lake-no-wake', small, { ...foamy, wake: 'none' }, { boat: true }), look: foam166, size: small, frames: [600] },
    // ../166/mirror.test.ts: the water's `reflection` target, which that suite compares by its hash
    { name: '166/pond-wavy', doc: pond('wavy', room, { waves: LAKE_WAVES.map((w) => ({ ...w, amplitude: w.amplitude / 4 })), ripples: { strength: 0.3 }, rain: 0, distort: 16 }), look: mirror166, size: room, frames: [30], reflection: true },
    { name: '166/pond-calm', doc: pond('calm', room, { waves: LAKE_WAVES.map((w) => ({ ...w, amplitude: 0 })), ripples: { strength: 0 }, rain: 0, distort: 16 }), look: mirror166, size: room, frames: [30], reflection: true },
    // ../166/taste.test.ts
    { name: '166/taste-lake', doc: harbour('lake', shot, waves), look: filmic(166), size: shot, frames: [30] },
    { name: '166/taste-rain', doc: harbour('rain', shot, { ...waves, rain: 50 }), look: filmic(166), size: shot, frames: [30] },
    { name: '166/taste-foam', doc: harbour('foam', shot, foamy, { boat: true }), look: filmic(166), size: shot, frames: [360] },
    { name: '166/taste-rain-wake', doc: harbour('rain-wake', room, { waves: LAKE_WAVES, rain: 50, foam: { threshold: 0.6 }, wake: { item: 'boat', span: 8 } }, { boat: true }), look: filmic(166), size: room, frames: [270, 359] },
    // ../968/channel.test.ts: the flowing channel at its 30 times over 4 s
    { name: '968/channel-flowing', doc: channelDoc('channel-flowing', square, camera([0, 6, 0], [0, 0, 0], 30), { ...FLAT, flow: CHANNEL_FLOW }), look: channel968, size: square, frames: Array.from({ length: 30 }, (_, k) => 4 * (k + 1)) },
    // ../968/taste.test.ts
    { name: '968/taste-channel', doc: channelDoc('channel-taste', shot, channelCam(), { ...breeze, flow: CHANNEL_FLOW }), look: filmic(968), size: shot, frames: [45] },
    { name: '968/taste-river', doc: riverDoc('river-taste', shot, camera([-24, 7, 8], [8, 0, 0], 50), { ...breeze, foam: { speed: 2 }, flow: RIVER_FLOW }), look: filmic(968), size: shot, frames: [45] },
    { name: '968/taste-running', doc: channelDoc('channel-running', room, channelCam(), { ...breeze, flow: CHANNEL_FLOW }), look: filmic(968), size: room, frames: [30, 90, 149] },
  ];
}
