// The documents and the calls of the #3036 acceptance tests (README: The surface under test, The fixtures), generated
// here so every file sends the same ones. Like judges.ts, this holds nothing of the test runner. Metres, +Y up, right
// +X. A terrain plate is `plate@1` with `params.terrain` (#2014) and, with tracks, `params.tracks` beside it; it has no
// `at`, so its own space is the world's.

import {
  BALL, CAP, CROSSER, CROSSER_BODY, CROSSING, CROWD, GROUND, LANE, LANE_FPS, LANE_SPAN, PLATE, RADIUS, ROLLER, ROLLER_BODY, ROLLERS, ROLLING, STEP_RATE, TRACKS, WORLD, YARD,
  YARD_FPS, YARD_SPAN, flicks, placeAt, yardNodes,
  type JsonObject, type Keys, type Launch, type Motion, type Probe, type Terrain, type Tracks, type V3,
} from './judges.ts';

/**
 * The four wrong programs the criteria name, each reachable only by its name (README: The planted programs): the
 * first three through `deep-show run`'s scenario `planted`, the last through `deep-gpu run --planted <name>`.
 */
export const PLANTED = {
  /** Criterion 1: the plate lowers its surface about each place it read alone, with nothing between them. */
  atSamples: 'tracks_lower_at_samples_only',
  /** Criterion 2: the plate reads each item's x and z alone, never how high it is. */
  groundAlone: 'tracks_read_ground_position',
  /** Criterion 3: the plate's physics shape takes the heights the plate draws. */
  feedsPhysics: 'tracks_feed_physics_shape',
  /** Criterion 4: the plate keeps the surface the frame before drew and lowers it about each item's place now. */
  keepsFrame: 'tracks_keep_last_frame',
} as const;
export type ShowPlanted = typeof PLANTED.atSamples | typeof PLANTED.groundAlone | typeof PLANTED.feedsPhysics;
export type GpuPlanted = typeof PLANTED.keepsFrame;

// ---------------------------------------------------------------------------------------------------
// `deep-show run` (#393): the scenario and its calls

/** The working agent, alpha. */
export const SESSION = 'sess-alpha';
export const docId = (n: number): string => `01JB3036D${String(n).padStart(17, '0')}`;

/** One `deep-show run` scenario: the documents on the panel (each shown by a call), the calls, and a planted program. */
export function scenarioOf(evidence: string, docs: readonly string[], calls: JsonObject[], planted?: ShowPlanted): JsonObject {
  return {
    evidence,
    sessions: { [SESSION]: { thread: 'thread-alpha', name: 'Agent alpha: tracks', process: { pid: 4100, start: 1_000 } } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 4100, ppid: 3000, start: 1_000 }],
    panels: { main: { rect: [0, 0, 1280, 720] } },
    docs: Object.fromEntries(docs.map((d) => [d, { panel: 'main' }])),
    ...(planted ? { planted } : {}), calls,
  };
}
/** The working agent's deep_show of a whole revision (#393's agent form: no `id`, no `layers`). */
export const show = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep_show', session: SESSION, doc, document, include: ['issues'] });
/** #411's `deep_query` of evaluated values at the times given, s. */
export const query = (doc: string, paths: readonly string[], times: readonly number[]): JsonObject =>
  ({ call: 'deep_query', session: SESSION, doc, paths: [...paths], at: times.map((t) => `${t}s`) });
/** #540's `world`: the named world of the document baked over its transport's span, with its step hashes and every body's state after each step. */
export const world = (doc: string, id: string): JsonObject => ({ call: 'world', doc, world: id });

/** Every probe's ray starts here, 2 m over the plates, and runs straight down. */
export const TOP = GROUND + 2;
/**
 * #2014's `terrain_rays` with this suite's `t` (README: The surface under test): each ray met by the surface the
 * plate draws at `t` seconds (`drawn`), by its physics height-field shape (`physics`) and by a pick on it (`pick`).
 * `t` goes as a whole number of flicks.
 */
export const terrainRays = (doc: string, t: number, probes: readonly Probe[], item: string = PLATE): JsonObject =>
  ({ call: 'terrain_rays', doc, item, t: flicks(t), rays: probes.map((p) => ({ from: [p.x, TOP, p.z], dir: [0, -1, 0] })) });

/** `view3d` (#378) as the base has it: `frames` frames at `fps` from frame `from`, each with its `pixel_hash`; `capture` with `targets: ["final"]` keeps a frame's picture. */
export interface View3d { doc: string; look: JsonObject; size: [number, number]; fps: number; from?: number; frames?: number; capture?: 'every' | number[]; targets?: 'final'[] }
export const view3d = (v: View3d): JsonObject => ({ call: 'view3d', ...(v as unknown as JsonObject) });

// ---------------------------------------------------------------------------------------------------
// Items and documents in the agent's form

/** A terrain plate, with the Scope's `tracks` when given. */
export const plateItem = (t: Terrain, tracks: Tracks | null): JsonObject =>
  ({ kind: 'plate@1', params: { terrain: { ...t, size: [...t.size] }, ...(tracks ? { tracks: { ...tracks } } : {}) } });
/** A ball of radius 0.25 m centred at `at`: `mark.sphere@1` is a unit solid scaled by `params.size`. */
export const ballItem = (at: V3): JsonObject => ({ kind: 'mark.sphere@1', params: { size: [2 * RADIUS, 2 * RADIUS, 2 * RADIUS] }, at: { pos: [...at] } });
/** A linear f32 channel on an item's path, keyed at seconds. */
export const channel = (target: string, keys: Keys): JsonObject =>
  ({ target, type: 'f32', keys: Object.fromEntries(keys.map(([t, value], k) => [`k${k}`, { t: `${t}s`, value, interp: 'linear' }])) });
/** A document collection by list (`collections: {ID → {members: [ID]}}`, as a water's `shore.items` names one). */
export const collection = (members: readonly string[]): JsonObject => ({ members: [...members] });
/** The channels that move the ball along a motion: its x and its y. */
const ballChannels = (m: Motion): JsonObject => ({ roll_x: channel(`items/${BALL}/at/pos/0`, m.x), roll_y: channel(`items/${BALL}/at/pos/1`, m.y) });

/** A scene in the agent's form (no `id`, no `layers`), each item given its ID, name and order key. */
export function scene(title: string, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const entries = Object.entries(items).map(([id, item], k) => [id, { id, name: id, order: `a${String(k).padStart(4, '0')}`, ...item }] as const);
  return {
    format: 1, profile: 'scene', title, description: `${title}: a #3036 acceptance fixture.`, size: [640, 480],
    requires: { modules: { scene3d: '^1' } }, ...extra, items: Object.fromEntries(entries),
  };
}
/** The path of the ball's evaluated place. */
export const BALL_POS = `items/${BALL}/at/pos`;

/**
 * The lane (criteria 1, 2 and 5): the plate `ground` and the ball `ball`, which two channels move along `motion`; the
 * collection `rollers` holds the ball; 12 s at 2 frames a second. `tracks` null leaves the plate without tracks.
 */
export function laneDoc(title: string, motion: Motion, tracks: Tracks | null): JsonObject {
  return scene(title, { [PLATE]: plateItem(LANE, tracks), [BALL]: ballItem(placeAt(motion, 0)) }, {
    transport: { span: `${LANE_SPAN}s`, frame_rate: [LANE_FPS, 1] }, collections: { [ROLLERS]: collection([BALL]) }, channels: ballChannels(motion),
  });
}
/**
 * Criterion 5's plate with 5,000 samples alive (`span` 26), and its twin under the cap (`span` 20): the lane with
 * eight balls `crowd0` … `crowd7` at rest on it, 1 m apart from x = −3.5 m, the collection `crowd` holding them, 30 s
 * at 24 frames a second. `span` null leaves the plate without tracks.
 */
export function capDoc(title: string, span: number | null): JsonObject {
  const balls = Array.from({ length: CAP.items }, (_, k) => [`${CROWD}${k}`, ballItem([k - 3.5, GROUND + RADIUS, 0])] as const);
  return scene(title, { [PLATE]: plateItem(LANE, span === null ? null : { ...TRACKS, items: CROWD, span }), ...Object.fromEntries(balls) }, {
    transport: { span: `${CAP.seconds}s`, frame_rate: [CAP.fps, 1] }, collections: { [CROWD]: collection(balls.map(([id]) => id)) },
  });
}

/**
 * The yard's world (criterion 3), `physics.world@1` at 120 steps a second on the build's own backend: the static body
 * `ground`, one `heightfield` shape whose `heights` the test gives (159 × 59, the yard's nodes); the dynamic balls
 * `roller` and `crosser`, each a sphere of 0.25 m launched rolling and held to its line by its `locks`; and an output
 * that writes each ball's pose to its drawn item's `at`.
 */
export function yardWorld(heights: readonly number[]): JsonObject {
  const { cols, rows, scale } = yardNodes();
  if (heights.length !== cols * rows) throw Error(`the yard's height field takes ${cols * rows} heights, one a node, not ${heights.length}`);
  const ball = (b: Launch): JsonObject => ({
    kind: 'dynamic', shapes: [{ shape: 'ball', contact_material: 'rubber' }], pose: { pos: [...b.at] }, velocity: { linear: [...b.linear], angular: [...b.angular] },
    locks: { linear: [...b.locks.linear], angular: [...b.locks.angular] }, sleep: false,
  });
  return {
    kind: 'physics.world@1', dimensions: 3, step_rate: STEP_RATE, substeps: 4, gravity: [0, -9.81, 0], seed: 3036, mode: 'dynamic',
    capacity: { bodies: 3, shapes: 3, joints: 0, contacts: 64, particles: 0 },
    contact_materials: { soil: { friction: 0.6, restitution: 0 }, rubber: { friction: 0.6, restitution: 0, density: 500 } },
    shapes: { terrain: { kind: 'heightfield', cols, rows, heights: [...heights], scale: [...scale] }, ball: { kind: 'sphere', radius: RADIUS } },
    bodies: {
      ground: { kind: 'static', shapes: [{ shape: 'terrain', contact_material: 'soil' }], pose: { pos: [0, 0, 0] } },
      [ROLLER_BODY]: ball(ROLLER), [CROSSER_BODY]: ball(CROSSING),
    },
    outputs: { [ROLLER_BODY]: { from: ROLLER_BODY, read: 'pose', to: `items/${BALL}/at` }, [CROSSER_BODY]: { from: CROSSER_BODY, read: 'pose', to: `items/${CROSSER}/at` } },
  };
}
/** The yard: the plate `ground`, the balls `ball` and `crosser` its world `lab` moves, the collection `rollers` holding the first; 5 s at 10 frames a second. */
export function yardDoc(title: string, heights: readonly number[], tracks: Tracks | null): JsonObject {
  return scene(title, { [PLATE]: plateItem(YARD, tracks), [BALL]: ballItem(ROLLER.at), [CROSSER]: ballItem(CROSSING.at) }, {
    transport: { span: `${YARD_SPAN}s`, frame_rate: [YARD_FPS, 1] }, collections: { [ROLLERS]: collection([BALL]) }, worlds: { [WORLD]: yardWorld(heights) },
  });
}
/** The yard's plate as built, at every node: 0.5 m. */
export const builtHeights = (): number[] => yardNodes().probes.map(() => GROUND);

// ---------------------------------------------------------------------------------------------------
// Documents a `view3d` session holds (#378): every item in the one writer layer `main`, camera `cam`

const FONTS: JsonObject = {
  body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
};
const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
/** A physical-basis `look@1` (#166's shape): tone map none at the exposure whose scale is 1, no finish, deband, bloom, ao or 3D ground. */
export function look3d(id: string, change: JsonObject = {}): JsonObject {
  return {
    id, format: 1, basis: 'physical', license: 'Apache-2.0', description: `The #3036 acceptance look ${id}.`,
    palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', white: '#ffffff' },
    roles: { ground: 'night', ink: 'graphite', muted: 'slate' },
    themes: { light: {}, dark: {} }, fonts: FONTS,
    status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
    attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
    tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' },
    ...change,
  };
}
/** The look criterion 4's film is drawn in, and the look the still is drawn in, as a film would. */
export const PLAIN = look3d('plain-3036');
export const FILMIC = look3d('filmic-3036', { tone_map: 'filmic', exposure: 0 });

const DAY_SKY: JsonObject = { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.6, 0.7, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } };
/** A sun: it shines along its local −Z, so `at.rot` [−e, y, 0] puts it e degrees above the horizon, turned y about +Y. */
const sun = (illuminance: number, rot: V3, shadow: boolean): JsonObject => ({ kind: 'light.sun@1', params: { illuminance, color: [1, 1, 1], shadow }, at: { rot } });
const camera = (position: V3, target: V3, fov: number): JsonObject => ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov, near: 0.1, far: 500 } });
const material = (base: [number, number, number], roughness: number): JsonObject => ({ kind: 'material@1', params: { base_color: [...base, 1], roughness, metallic: 0 } });
export function sessionDoc(id: string, size: readonly [number, number], items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(4, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #3036 acceptance fixture.`, size: [...size], camera: 'cam', seed: 3036,
    requires: { modules: { scene3d: '^1' } }, budget: { class: 'work_product' },
    layers: { main: { writer: 'agent:alpha', title: 'Main', order: 'a0' } }, ...extra, items: withIds,
  };
}

/** Criterion 4's frame size. */
export const FILM_SIZE: [number, number] = [480, 270];
/**
 * Criterion 4's film: the lane and its rolling ball as a session holds them, seen whole from (0, 6, 12) m looking at
 * the plate's centre (60° across the frame's width: 7.7 m either side at that distance), brown soil and a red ball
 * under a day sky and a sun with no shadow. `tracks` null leaves the plate without tracks.
 */
export function laneFilm(id: string, tracks: Tracks | null): JsonObject {
  return sessionDoc(id, FILM_SIZE, {
    cam: camera([0, 6, 12], [0, GROUND, 0], 60), sky: DAY_SKY, sun: sun(3, [-35, 30, 0], false),
    soil: material([0.45, 0.36, 0.25], 0.9), rubber: material([0.75, 0.2, 0.15], 0.5),
    [PLATE]: { ...plateItem(LANE, tracks), material: 'soil' }, [BALL]: { ...ballItem(placeAt(ROLLING, 0)), material: 'rubber' },
  }, { transport: { span: `${LANE_SPAN}s`, frame_rate: [LANE_FPS, 1] }, collections: { [ROLLERS]: collection([BALL]) }, channels: ballChannels(ROLLING) });
}

// ---- Criterion 6: the field with wheel tracks

/** The still's size, and the frame it is: 8 s at 30 frames a second. */
export const STILL_SIZE: [number, number] = [1280, 720];
export const STILL_FPS = 30;
export const STILL_FRAME = 240;
/** The field: 24 × 16 m at 0.05 m (481 × 321 samples), gentle rises up to 0.12 m. */
export const FIELD: Terrain = { height: '0.12 * sin(position.x * 0.35) * cos(position.z * 0.27)', size: [24, 16], spacing: 0.05, tile: 8, lod_levels: 1 };
export const fieldHeight = (x: number, z: number): number => 0.12 * Math.sin(x * 0.35) * Math.cos(z * 0.27);
/** The cart's wheels, by ID, and the tracks they leave: 0.3 m wide, 6 cm deep, darkened by 0.4. */
export const WHEELS = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'] as const;
export const FIELD_TRACKS: Tracks = { items: 'wheels', width: 0.3, depth: 0.06, darken: 0.4 };
const WHEEL_RADIUS = 0.3;
/**
 * The field with wheel tracks: a cart, a box on four wheels (cylinders 0.6 m across and 0.2 m wide, their axles
 * 1.8 m apart and 1.4 m long), driven in a straight line from (−10, −5) to (10, 5) m over 10 s. Each wheel's place
 * is keyed every 0.25 s, its centre one radius over the field's height under it, so its lowest point stays on the
 * ground (within a millimetre: the field's rises bend by under 0.015 a metre). The collection `wheels` holds the four
 * wheels. A low sun casts shadows; the camera stands 2.4 m up beside the cart's line and looks along the tracks toward
 * the cart, about 13 m off at 8 s. 12 s at 30
 * frames a second: at most 4 × 361 samples alive. `tracks` false leaves the plate without tracks.
 */
export function fieldDoc(id: string, tracks: boolean): JsonObject {
  const from: [number, number] = [-10, -5], to: [number, number] = [10, 5], seconds = 10;
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const heading: [number, number] = [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
  const side: [number, number] = [-heading[1], heading[0]];
  const yaw = (-Math.atan2(heading[1], heading[0]) * 180) / Math.PI;
  const centre = (t: number): [number, number] => { const u = Math.min(1, Math.max(0, t / seconds)); return [from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u]; };
  const offsets: Record<(typeof WHEELS)[number], [number, number]> = { wheel_fl: [0.9, -0.7], wheel_fr: [0.9, 0.7], wheel_rl: [-0.9, -0.7], wheel_rr: [-0.9, 0.7] };
  const wheelAt = (id: (typeof WHEELS)[number], t: number): V3 => {
    const [cx, cz] = centre(t), [along, across] = offsets[id];
    const x = cx + along * heading[0] + across * side[0], z = cz + along * heading[1] + across * side[1];
    return [x, fieldHeight(x, z) + WHEEL_RADIUS, z];
  };
  const bodyAt = (t: number): V3 => {
    const [cx, cz] = centre(t);
    return [cx, WHEELS.reduce((sum, w) => sum + wheelAt(w, t)[1], 0) / WHEELS.length + 0.45, cz];
  };
  const times = Array.from({ length: seconds * 4 + 1 }, (_, k) => k / 4);
  const moved = (target: string, at: (t: number) => V3): JsonObject =>
    ({ target, type: 'vec3', keys: Object.fromEntries(times.map((t, k) => [`k${k}`, { t: `${t}s`, value: at(t), interp: 'linear' }])) });
  const wheels = Object.fromEntries(WHEELS.map((w) => [w, { kind: 'mark.cylinder@1', params: { size: [2 * WHEEL_RADIUS, 0.2, 2 * WHEEL_RADIUS] }, at: { pos: wheelAt(w, 0), rot: [90, yaw, 0] }, material: 'tyre' }]));
  const channels = Object.fromEntries([...WHEELS.map((w) => [`${w}_pos`, moved(`items/${w}/at/pos`, (t) => wheelAt(w, t))] as const), ['cart_pos', moved('items/cart/at/pos', bodyAt)] as const]);
  return sessionDoc(id, STILL_SIZE, {
    cam: camera([-6.5, 2.4, -1.3], [4, 0, 2.3], 50), sky: DAY_SKY, sun: sun(3, [-25, 120, 0], true),
    earth: material([0.42, 0.33, 0.22], 0.95), tyre: material([0.08, 0.08, 0.09], 0.8), paint: material([0.2, 0.35, 0.6], 0.5),
    [PLATE]: { ...plateItem(FIELD, tracks ? FIELD_TRACKS : null), material: 'earth' },
    cart: { kind: 'mark.box@1', params: { size: [2.4, 0.5, 1.2] }, at: { pos: bodyAt(0), rot: [0, yaw, 0] }, material: 'paint' },
    ...wheels,
  }, { transport: { span: '12s', frame_rate: [STILL_FPS, 1] }, collections: { wheels: collection(WHEELS) }, channels });
}
