// The one fixture criteria 15 and 16 draw, and the numbers the issue gives for it. Nothing here imports the test
// runner, so the document can be written out and drawn by hand (README: The fixture).
//
// The room: a floor and a back wall meeting in a corner (ambient light from the sky, so ambient occlusion has a corner
// to darken), a ball the lens focuses on, a post close to the camera and a crate far behind (both out of focus), a box
// sliding along x (a declared move, so velocity blur has something to blur), two small emitters at the view's left
// edge and top right corner (bloom reaches the view's edge), and a casting sun.

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type V3 = [number, number, number];
export type Size = [number, number];

/** The issue's numbers (criterion 15): the view, the larger target and the rectangle's top left corner in it. */
export const VIEW: Size = [960, 540];
export const TARGET: Size = [2560, 1440];
export const AT: [number, number] = [317, 211];
/** "Within 32 px of the rectangle's edge" (criterion 15's planted bloom). */
export const EDGE_PX = 32;
/** The noise's recorded seeds: the run both criteria are judged on, and a second one (README: Readings, "seeded"). */
export const SEED = 458;
export const OTHER_SEED = 1516;
/** The frame drawn, at 60 frames a second (the call's `fps` and the document's `transport.frame_rate`, so the 180°
 * shutter is 1/120 s): t = 0.5 s, the slider half way along its move, over the ball. */
export const FPS = 60;
export const FRAME = 30;

const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };

/** The look's `bloom` (the shipped glow's values, #380's and #422's fixtures). */
export const BLOOM: JsonObject = { intensity: 0.3, radius: 0.85 };
/** The look's `ao` with every field at #418's default. */
export const AO: JsonObject = { radius: 0.5, strength: 1, samples: 8, resolution: 'half', multi_bounce: true, specular: true };
/** The look's `motion_blur` by velocity (#419's fields, the design's defaults). */
export const VELOCITY_BLUR: JsonObject = {
  scope: 'declared_moves', method: 'velocity', shutter_angle: 180, phase: 'centred', samples: 8, adaptive: true, exclude: [],
  velocity: { taps: 16, max: 32, tile: 20 },
};
/** `effect@1` of kind dof (#468's fields): the lens's own circle of confusion, focused 6 m away, on the ball. */
export const DOF: JsonObject = { kind: 'effect@1', params: { kind: 'dof', dof: { coc: 'physical', taps: 64, rotate: 'pixel_hash', far_over_near: 'refuse', focus: 6, max_coc: 24 } } };

/**
 * The look: physical basis, tone map none at the exposure whose scale is 1 (so the final target is the linear frame's
 * sRGB encoding), one sub-sample, no deband, no finish; bloom, ambient occlusion and velocity blur on. `change`
 * replaces top-level fields, which is how a premise run turns one effect off.
 */
export function look(change: JsonObject = {}): JsonObject {
  return {
    id: 'look-458-rect', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'The #458 view-rectangle acceptance look.',
    palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3' },
    roles: { ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone' },
    themes: { light: {}, dark: {} },
    fonts: {
      body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
      mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    },
    status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
    attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
    tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', ground_3d: { kind: 'none' },
    samples: { live: 1, export: 1, at_rest: 'none' }, filter: 'box', filter_px: 1, vary: ['pixel'], sequence: 'r2',
    bloom: BLOOM, ao: AO, motion_blur: VELOCITY_BLUR,
    ...change,
  };
}

const box = (size: V3, pos: V3, material: string, extra: JsonObject = {}): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, material, ...extra });
const lit = (color: V3, roughness: number): JsonObject => ({ kind: 'material@1', params: { base_color: [...color, 1], roughness, metallic: 0 } });
const WRITER = 'agent:sess-alpha';

export interface Without { shadow?: boolean; dof?: boolean; sun?: boolean }
/**
 * The scene document, as a session holds it (#378): every item in the one writer layer `main`, camera `cam`. `without`
 * drops one thing for a premise run: the sun's shadow, the depth of field or the sun itself.
 */
export function scene(without: Without = {}): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: {
      kind: 'camera@1',
      params: { projection: 'perspective', position: [0, 1.7, 6], target: [0, 0.9, 0], lens: { focal_length: 35, sensor: [36, 24], fit: 'wider' }, aperture: { f_stop: 1.4, blades: 0 }, near: 0.05, far: 200 },
    },
    sky: { kind: 'sky@1', params: { top: [0.05, 0.07, 0.1, 1], low: [0.03, 0.03, 0.035, 1], ambient_top: [0.2, 0.22, 0.27], ambient_low: [0.1, 0.1, 0.1] } },
    stone: lit([0.45, 0.44, 0.41], 0.8),
    clay: lit([0.7, 0.32, 0.22], 0.6),
    slate: lit([0.25, 0.32, 0.45], 0.5),
    lamp: { kind: 'material@1', params: { base_color: [0, 0, 0, 1], emission: [1, 0.85, 0.6, 1], emission_strength: 6, roughness: 1 } },
    floor: box([16, 0.2, 16], [0, -0.1, 0], 'stone'),
    wall: box([16, 6, 0.3], [0, 3, -3.15], 'stone'),
    ball: { kind: 'ball@1', params: { radius: 0.7, segments: 48 }, at: { pos: [0.4, 0.7, 0] }, material: 'clay' },
    post: box([0.1, 2.4, 0.1], [-0.45, 1.2, 4.5], 'slate'),
    crate: box([1.2, 1.2, 1.2], [2.6, 0.6, -2.2], 'slate', { at: { pos: [2.6, 0.6, -2.2], rot: [0, 28, 0] } }),
    slider: box([0.6, 0.6, 0.6], [-6, 1.9, 0.6], 'clay'),
    glint: box([0.12, 0.5, 0.12], [-2.75, 1.2, 0.4], 'lamp'),
    spark: box([0.3, 0.12, 0.12], [2.65, 2.4, 0.2], 'lamp'),
    ...(without.sun ? {} : { sun: { kind: 'light.sun@1', params: { illuminance: 1.1, color: [1, 0.97, 0.9], shadow: !without.shadow }, at: { rot: [-52, 32, 0] } } }),
    ...(without.dof ? {} : { fx: DOF }),
  };
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id: 'rect-458', profile: 'scene', title: 'View rectangle', description: 'A lit, shadowed room with bloom, ambient occlusion, depth of field and velocity blur: the #458 view-rectangle fixture.',
    size: [...VIEW], camera: 'cam', seed: 458, safe: 24, transport: { span: '4s', frame_rate: FPS },
    requires: { modules: { scene3d: '^1', effects: '^1' } }, budget: { class: 'showpiece' },
    layers: { main: { writer: WRITER, title: 'main', order: 'a0' } },
    // The slider's declared move: 12 m/s along x from 0 s to 1 s.
    channels: { slide: { target: 'items/slider/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: -6, interp: 'linear' }, k1: { t: '1s', value: 6, interp: 'linear' } } } },
    items: withIds,
  };
}
