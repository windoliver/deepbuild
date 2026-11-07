// One small film per field family of #149, each drawn in a 2D and a 3D drawing look from the same table of parts. A part
// is placed in px from the frame's centre, x right and y down, so the framing below is one sum for both dimensions.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JsonObject, JsonValue } from '../430/helpers.ts';

export type Dim = '2d' | '3d';
export const SIZE = [960, 540] as const;
/** At 20 fps, and at 40, every frame's time is a whole number of flicks and every key's a short decimal. */
export const FPS = 20;
export const FRAMES = 13;
/** Out and back: frames n and 12 − n hold one evaluated document at two different times. */
const tick = (n: number): number => 6 - Math.abs(n - 6);

// The camera trucks TRUCK px a tick. In 2D it shows 960 u across 960 px, so 1 u is 1 px. In 3D it stands D m from z = 0
// looking along −Z, and `fov` runs across the WIDER side (camera@1): focal = 480 / tan(20°) = 1318.76 px, so z = 0 shows
// ±2.18 m across but only ±1.23 m down, and 1 px there is M = D / focal = 0.00455 m. A point at z m lands at
// u = 480 + (px − TRUCK·tick) · D / (D − z), v = 270 + py · D / (D − z). `framing` holds every corner to that at every tick.
const TRUCK = 5;
const D = 6;
const M = (D * Math.tan((20 * Math.PI) / 180)) / 480;

export interface Part { id: string; shape: 'box' | 'ball' | 'drum' | 'line'; c: [number, number]; s: [number, number]; paint: JsonObject; swing?: number; evolves?: boolean; parent?: string }
export interface Family { name: string; subject: string; parts: Part[]; look?: JsonObject; collections?: JsonObject; group?: string }

const part = (id: string, shape: Part['shape'], c: Part['c'], s: Part['s'], paint: JsonObject, more: Partial<Part> = {}): Part => ({ id, shape, c, s, paint, ...more });
const role = (r: string): JsonObject => ({ fill: { role: r } });
const fill = (name: string, r: string): JsonObject => ({ fill: { fill: name, role: r } });
const line = (name: string, r: string): JsonObject => ({ stroke: { line: name, role: r } });
const depth = (p: Part): number => (p.shape === 'line' ? 0 : p.shape === 'box' ? Math.min(...p.s) * M : p.s[0] * M);

/** Each corner of each part at each tick, nearest the eye the worst, 8 px inside the frame; and something moves in it. */
export function framing(fam: Family): string[] {
  const bad = fam.parts.some((p) => (p.swing ?? 0) !== 0) ? [] : [`${fam.name}: no part moves`];
  for (const p of fam.parts) for (let t = 0; t <= 6; t++) for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) {
    const near = D / (D - depth(p) / 2);
    const u = 480 + (p.c[0] + sx * p.s[0] + ((p.swing ?? 0) - TRUCK) * t) * near;
    const v = 270 + (p.c[1] + sy * p.s[1]) * near;
    if (u < 8 || u > 952 || v < 8 || v > 532) bad.push(`${fam.name}: ${p.id} leaves the frame at tick ${t}: (${u.toFixed(1)}, ${v.toFixed(1)})`);
  }
  return bad;
}

const paper = (kind: string, anchor: string, zoom: string): JsonObject => ({
  kind: 'paper',
  params: {
    role: 'ground', spine: { kind: 'none' }, grid: null, seed: 'document', anchor, zoom, tooth: { kind, scale: 8, depth: 0.6, seed: 'document' },
    age: {
      folds: 2, creases: 3, stains: { count: 3, size: 40, role: 'muted' }, foxing: 0.3, plate_mark: { inset: 24, depth: 0.4 }, craquelure: { scale: 18, amount: 0.3 },
      tarnish: { ramp: ['muted', 'accent'], width: 20 }, tape: [[60, 40, 90, 24]], seed: 'document',
    },
  },
});
const kite = (kind: string, i: number): Family => ({
  name: `paper-${kind}`, subject: 'A kite and its tail over a dune.',
  look: { ground: paper(kind, ['world', 'page', 'sheet', 'frame'][i % 4]!, i % 2 ? 'fade_fine' : 'crossfade_octaves'), lines: { crayon: { kind: 'crayon', width: 6, pressure: 0.3 } }, fills: { chalk: { kind: 'flat', pressure: 0.5 } } },
  parts: [
    part('dune', 'box', [0, 170], [760, 120], { ...fill('chalk', 'muted'), ...line('crayon', 'ink') }), part('kite', 'box', [-200, -90], [90, 90], role('accent'), { swing: 50 }),
    part('tail', 'line', [-200, 10], [80, 100], line('crayon', 'ink'), { swing: 50 }),
  ],
});
const noise = (kind: string, i: number): JsonObject => ({
  fill: {
    noise: {
      kind, scale: 90, aspect: 1.2, octaves: 4, roughness: 0.5, contrast: 1.1, brightness: 0.05, offset: [3, 5], rotation: 15, evolution: 0, cycle: i % 2 ? 4 : 'none',
      stops: [{ at: 0, role: 'ground' }, { at: 0.5, role: 'muted' }, { at: 1, role: 'accent' }], anchor: i === 2 ? 'frame' : 'world', seed: 149 + i,
    },
  },
});
const OUTPUTS = ['color', 'coverage', 'pressure', 'height'];
/** A group's pass that adds a sixth of each of the flock's targets to what its group drew (#430's form; the input: #149's). */
function press(): JsonObject {
  const inputs: JsonObject = { src: { type: 'texture', from: { texture: { target: { op: 'core', output: 'color' } } } } };
  const steps: JsonObject = { uv: { op: 'screen_uv@1' }, s0: { op: 'sample@1', args: { tex: 'src', uv: 'uv', lod: 0 } } };
  OUTPUTS.forEach((output, i) => {
    inputs[output] = { type: 'texture', from: { texture: { target: { collection: 'flock', output, resolution: 'half', mips: i === 2 } } } };
    steps[`t${i}`] = { op: 'sample@1', args: { tex: output, uv: 'uv', lod: 0 } };
    steps[`m${i}`] = { op: 'mul@1', args: { a: `t${i}`, b: [1 / 6, 1 / 6, 1 / 6, 0] } };
    steps[i === 3 ? 'out' : `s${i + 1}`] = { op: 'add@1', args: { a: `s${i}`, b: `m${i}` } };
  });
  return { origin: 'composed', about: 'Reads the flock collection.', inputs, steps, outputs: { color: 'out', blend: 'replace' }, resolution: 'full', cost: { ns_per_px: 1 }, fallback: 'look' };
}

export const FAMILIES: Family[] = [
  {
    name: 'light', subject: 'A night ferry under its swinging lantern.', collections: { crew: { members: ['hull', 'cabin'] } },
    look: {
      ground: paper('cold_press', 'world', 'crossfade_octaves'),
      light: { dir: 120, elevation: 40, rim: { role: 'accent', width: 3, toward: 'light', on: 'crew' }, cast: { role: 'muted', length: 60, softness: 8 }, weight: 0.6, relief: { from: 'tooth', strength: 0.5 }, back: { lamps: ['lantern'], transmission: { crew: 0.5 } } },
    },
    parts: [part('hull', 'box', [-40, 100], [420, 90], role('ink')), part('cabin', 'drum', [-60, 10], [120, 90], role('muted')), part('lantern', 'ball', [-150, -120], [50, 50], role('accent'), { swing: 40 })],
  },
  ...['cold_press', 'laid', 'wove', 'canvas', 'linen', 'silk', 'stone', 'wood'].map(kite),
  {
    name: 'lines', subject: 'A heron wading through reeds.',
    look: { lines: { reed: { kind: 'brush', width: 7, dry: 0.4, pressure: 0.6, profile: { taper_in: 0.3, taper_out: 0.4, swell: 0.5, flick: 6, overshoot: 4, breaks: { every: 40, gap: 6 }, double: { offset: 3, opacity: 0.5 }, dry_tail: 0.4, seed: 'item' } } } },
    parts: [
      part('body', 'box', [0, -40], [200, 90], { ...role('raised'), ...line('reed', 'ink') }), part('neck', 'line', [-120, -60], [120, 220], line('reed', 'ink'), { swing: 36 }),
      part('leg', 'line', [60, 90], [40, 240], line('reed', 'ink')), part('stem', 'line', [260, 40], [60, 360], line('reed', 'muted')),
    ],
  },
  {
    name: 'fills', subject: 'A market stall of five crates under an awning.', collections: { canvas: { members: ['awning'] } },
    look: {
      fills: {
        printed: { kind: 'ink', coverage: 0.9, starve: { scale: 30, amount: 0.4 }, pinholes: 0.2, streaks: { angle: 20, density: 0.3 }, spread: 2, edge: 'ragged', seed: 'item' },
        watered: { kind: 'wash', pool: 0.5, granulation: 0.4, blooms: { count: 3, size: 30 }, bleed: 4, wet_in_wet: true, oversize: 0.2, resist: { by: 'canvas' }, seed: 'item' },
        flecked: { kind: 'spatter', dot: [1, 3], density: 0.4, angle: 30, where: 'all', seed: 'item' },
        slipped: { kind: 'flat', offset: { dx: 5, dy: 3, oversize: 0.2, seed: 'item' }, seed: 'item' },
        shaded: { kind: 'hatch', angle: 45, gap: 8, width: 1, follow: 'outline', by_tone: [{ below: 0.5, passes: 2, cross: true }], stipple: { dot: 2, density: 0.3 }, min_width: 1, seed: 'item' },
      },
    },
    parts: [
      part('awning', 'box', [0, -200], [800, 50], role('muted')), part('ink', 'box', [-340, 30], [130, 190], fill('printed', 'ink')), part('wash', 'box', [-170, 30], [130, 190], fill('watered', 'accent'), { swing: 22 }),
      part('spatter', 'box', [0, 30], [130, 190], fill('flecked', 'ink')), part('offset', 'box', [170, 30], [130, 190], fill('slipped', 'accent')), part('hatch', 'box', [340, 30], [130, 190], fill('shaded', 'ink')),
    ],
  },
  {
    name: 'targets', subject: 'A flock and its wake over a marsh.', collections: { flock: { members: ['lead', 'wing', 'wake'] } }, group: 'gang',
    look: { lines: { trail: { kind: 'crayon', width: 5, pressure: 0.5, profile: { swell: 0.5, seed: 'item' } } }, fills: { pressed: { kind: 'flat', pressure: 0.6 } } },
    parts: [
      part('marsh', 'box', [0, 190], [800, 80], role('muted')), part('lead', 'ball', [-260, -100], [60, 60], fill('pressed', 'ink'), { swing: 30, parent: 'gang' }),
      part('wing', 'ball', [-60, -40], [50, 50], fill('pressed', 'accent'), { swing: 20, parent: 'gang' }), part('wake', 'line', [100, 70], [240, 60], line('trail', 'ink'), { swing: 30, parent: 'gang' }),
    ],
  },
  {
    name: 'noise', subject: 'A weather chart of four fronts.',
    parts: ['fractal', 'turbulent', 'cells', 'value'].map((kind, i) => part(kind, 'box', [-315 + 210 * i, 0], [150, 300], noise(kind, i), { evolves: true, ...(i === 3 ? { swing: 10 } : {}) })),
  },
  {
    name: 'strokes', subject: 'A cart passing an orchard tree on a hillside.',
    look: { strokes: { on: 'all', density: 0.004, size: [6, 16], orient: 'surface', palette: { all: ['lagoon', 'slate'] }, layers: 2, seed: 'item', dry: 0.3 } },
    parts: [
      part('hill', 'box', [0, 180], [820, 90], role('muted')), part('crown', 'ball', [-220, -20], [150, 150], role('accent')), part('trunk', 'drum', [-220, 110], [30, 110], role('ink')),
      part('cart', 'box', [180, 60], [140, 80], role('raised'), { swing: -24 }),
    ],
  },
];

const HERE = dirname(fileURLToPath(import.meta.url));
const CLEAN = JSON.parse(readFileSync(join(HERE, '..', '..', '..', 'crates', 'deep-canvas-marks', 'looks', 'clean.json'), 'utf8')) as JsonObject;

/** A channel on `target`, held from just before each frame, so a frame and its mirror hold exactly one value. */
function hold(target: string, value: (t: number) => number): JsonObject {
  const key = (n: number): [string, JsonValue] => [`k${String(n).padStart(2, '0')}`, { t: n === 0 ? '0s' : `${(2 * n - 1) / (2 * FPS)}s`, value: value(tick(n)), interp: 'hold' }];
  return { target, type: 'f32', keys: Object.fromEntries(Array.from({ length: FRAMES }, (_, n) => key(n))) };
}
const item = (id: string, kind: string, order: number, params: JsonObject, more: JsonObject = {}): JsonObject =>
  ({ id, kind, layer: 'main', name: id, order: `a${String(order).padStart(2, '0')}`, params, ...more });

function mark(p: Part, dim: Dim, order: number, paint: JsonObject): JsonObject {
  const [x, y] = p.c; const [w, h] = p.s;
  const zig = [[-w / 2, h / 2], [-w / 6, -h / 2], [w / 6, h / 2], [w / 2, -h / 2]] as const;
  const parent: JsonObject = p.parent ? { parent: p.parent } : {};
  if (dim === '2d') {
    const at = { at: { pos: [480 + x, 270 + y, 0] }, ...parent };
    if (p.shape === 'ball') return item(p.id, 'circle@1', order, { center: [0, 0], r: w / 2, paint }, at);
    if (p.shape === 'line') return item(p.id, 'path@1', order, { d: `M ${zig.map((q) => q.join(' ')).join(' L ')}`, paint }, at);
    return item(p.id, 'rect@1', order, { box: [-w / 2, -h / 2, w, h], paint }, at);
  }
  const at = { at: { pos: [x * M, -y * M, 0] }, ...parent };
  if (p.shape === 'ball') return item(p.id, 'mark.sphere@1', order, { size: [w * M, w * M, w * M], paint }, at);
  if (p.shape === 'drum') return item(p.id, 'mark.cylinder@1', order, { size: [w * M, h * M, w * M], paint }, at);
  if (p.shape === 'line') return item(p.id, 'mark.line@1', order, { points: zig.map(([a, b]) => [a * M, -b * M, 0]), width: 3, paint }, at);
  return item(p.id, 'mark.box@1', order, { size: [w * M, h * M, depth(p)], paint }, at);
}

/** Every name of `names`, drawn `as`. */
const off = (names: JsonValue | undefined, as: JsonObject): JsonObject => Object.fromEntries(Object.keys((names ?? {}) as JsonObject).map((k) => [k, as]));

/** The family's document and look; `plain`, the same film with the family's fields off: flat fills, exact lines, no pass. */
export function drawn(fam: Family, dim: Dim, plain = false): { doc: JsonObject; look: JsonObject } {
  const two = dim === '2d';
  const items: JsonObject = {
    cam: two
      ? item('cam', 'camera@1', 0, { projection: 'orthographic', target: [480, 270, 0], view_width: 960 })
      : item('cam', 'camera@1', 0, { projection: 'perspective', position: [0, 0, D], target: [0, 0, 0], fov: 40, near: 0.1 }),
  };
  const channels: JsonObject = two
    ? { truck: hold('items/cam/params/target/0', (t) => 480 + TRUCK * t) }
    : { truck: hold('items/cam/params/target/0', (t) => TRUCK * t * M), eye: hold('items/cam/params/position/0', (t) => TRUCK * t * M) };
  if (fam.group) {
    items[fam.group] = item(fam.group, 'group@1', 1, { isolate: true, passes: plain ? [] : [{ op: 'press', params: {} }] });
    if (!plain) items['press'] = item('press', 'gpu.pass@1', 2, press());
  }
  fam.parts.forEach((p, i) => {
    items[p.id] = mark(p, dim, 3 + i, plain && p.evolves ? role('accent') : p.paint);
    const swing = p.swing;
    if (swing) channels[`${p.id}-x`] = hold(`items/${p.id}/at/pos/0`, (t) => (two ? 480 + p.c[0] + swing * t : (p.c[0] + swing * t) * M));
    if (p.evolves && !plain) channels[`${p.id}-phase`] = hold(`items/${p.id}/params/paint/fill/noise/evolution`, (t) => 30 * t);
  });
  const doc: JsonObject = {
    format: 1, id: `ac5-${fam.name}-${dim}${plain ? '-plain' : ''}`, profile: two ? 'film' : 'scene', title: fam.name, description: fam.subject, size: [...SIZE], seed: 149,
    transport: { span: '2s' }, requires: { modules: two ? { effects: '^1' } : { scene3d: '^1', effects: '^1' } }, budget: { class: 'showpiece' },
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a1' } }, camera: 'cam', items, channels, ...(fam.collections ? { collections: fam.collections } : {}),
  };
  const lines = CLEAN['lines'] as JsonObject; const fills = CLEAN['fills'] as JsonObject; const own = fam.look ?? {};
  const base: JsonObject = { ...CLEAN, id: `ac5-${fam.name}`, basis: 'drawing' };
  const look: JsonObject = plain
    ? { ...base, lines: { ...lines, ...off(own['lines'], { kind: 'exact', width: 2 }) }, fills: { ...fills, ...off(own['fills'], { kind: 'flat' }) } }
    : { ...base, ...own, lines: { ...lines, ...(own['lines'] as JsonObject | undefined) }, fills: { ...fills, ...(own['fills'] as JsonObject | undefined) } };
  return { doc, look };
}
