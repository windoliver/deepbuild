// The fixtures of the #458 pairs group, as data: the five pairs' boards (criterion 7), the seeded generators of
// documents and programs with the transforms that must not change their output (criterion 9), and the fleet drawn as
// 25 instances and as 25 separate items (criterion 11). Pure functions of their arguments: no clock, no random source
// but the seed, no file and no binary, so each is checked for the same output from the same seed. Nothing here stands
// in for a renderer, an engine or the sandbox's rewrite. README: Fixtures.

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Box = [number, number, number, number];
export type Size = [number, number];

const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const itemsOf = (doc: JsonObject): Record<string, JsonObject> => doc['items'] as Record<string, JsonObject>;

// ---------------------------------------------------------------------------------------------------
// Seeds (mulberry32, as #1897's suite draws its frames)

/** A seeded generator of 32-bit words. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}
/** A whole number in [0, n) from the generator. */
export const below = (next: () => number, n: number): number => Math.floor((next() / 4294967296) * n);

// ---------------------------------------------------------------------------------------------------
// Criterion 7: the pairs drawn on one backend (Vello CPU snapshots of `deep-show`), as an agent or your shell sends
// a board: no `id`, no `layers`, no item `layer`. Every box sits on whole pixels and the snapshot is the board's size.

export const BOARD: Size = [320, 200];
/** The test pack (fixtures/packs/pairs-1.0.0): the recipe `pairs.badge@1` and the kind `pairs.tile@1`. */
export const PACK = { id: 'test/pairs', version: '1.0.0', folder: 'pairs-1.0.0' } as const;
const PACK_AT = `${PACK.id}@${PACK.version}`;

const STROKE: JsonObject = { role: 'ink', width: 2 };
const rect = (id: string, box: Box, role: string, order: string, extra: JsonObject = {}): JsonObject =>
  ({ id, kind: 'rect@1', name: id, order, params: { box, paint: { fill: { role } } }, ...extra });
/** A rect of `size` at `pos` (its box at the origin, moved by `at`, as a recipe's derived item is), stroked or not. */
const placed = (id: string, pos: [number, number], size: [number, number], role: string, order: string, stroked: boolean): JsonObject =>
  ({ id, kind: 'rect@1', name: id, order, params: { box: [0, 0, size[0], size[1]], paint: { fill: { role }, ...(stroked ? { stroke: STROKE } : {}) } }, at: { pos: [pos[0], pos[1], 0] } });
function board(title: string, items: JsonObject[], packs: string[] = []): JsonObject {
  return {
    format: 1, profile: 'board', title, description: `${title}: one side of a pair of the #458 acceptance tests.`, size: [...BOARD],
    ...(packs.length ? { packs } : {}), items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
  };
}
const GROUND = rect('back', [0, 0, BOARD[0], BOARD[1]], 'ground', 'a0');

/** A stroked item of a pair's expansion: its box in board pixels (the stroke's ring is one pixel either side of it). */
export interface Stroked { item: string; box: Box }
export interface Pair { name: string; a: JsonObject; b: JsonObject; packs: boolean; stroked: Stroked[] }

/** Where the badge and the tile stand on their boards. */
const AT: [number, number] = [24, 24];
const PIPS = 3;
/** A recipe and its expansion into primitives: `pairs.badge@1` with n = 3, and the four rects its steps make, written
 * out by hand from the recipe's text (plate at the instance's origin; pip i at (56 + 24 i, 14) from it). */
export const RECIPE_PAIR: Pair = {
  name: 'recipe-expansion',
  a: board('A badge, by its recipe', [GROUND, { id: 'b1', kind: 'pairs.badge@1', name: 'b1', order: 'a1', params: { n: PIPS }, at: { pos: [AT[0], AT[1], 0] } }], [PACK_AT]),
  b: board('A badge, written out', [
    GROUND, placed('plate', AT, [40, 40], 'muted', 'a1', true),
    ...Array.from({ length: PIPS }, (_, i) => placed(`pip${i}`, [AT[0] + 56 + 24 * i, AT[1] + 14], [12, 12], 'muted', `a${2 + i}`, true)),
  ]),
  packs: true,
  stroked: [
    { item: 'b1.plate', box: [AT[0], AT[1], 40, 40] },
    ...Array.from({ length: PIPS }, (_, i): Stroked => ({ item: `b1.pips.${i}`, box: [AT[0] + 56 + 24 * i, AT[1] + 14, 12, 12] })),
  ],
};
/** A pack kind and its expansion: an item of the kind `pairs.tile@1` at its defaults, and the two rects its recipe makes. */
export const KIND_PAIR: Pair = {
  name: 'pack-kind-expansion',
  a: board('A tile, by its kind', [GROUND, { id: 't1', kind: 'pairs.tile@1', name: 't1', order: 'a1', params: {}, at: { pos: [AT[0], AT[1], 0] } }], [PACK_AT]),
  b: board('A tile, written out', [GROUND, placed('rim', AT, [40, 40], 'muted', 'a1', true), placed('bar', [AT[0] + 56, AT[1] + 16], [48, 8], 'ink', 'a2', false)]),
  packs: true,
  stroked: [{ item: 't1.rim', box: [AT[0], AT[1], 40, 40] }],
};
const CARD: Box = [40, 40, 120, 80];
const DOT: Box = [100, 80, 100, 60];
const cardItems = (parent: JsonObject): JsonObject[] => [
  { id: 'card', kind: 'rect@1', name: 'card', order: 'a1', params: { box: CARD, paint: { fill: { role: 'muted' }, stroke: STROKE } }, ...parent },
  { id: 'dot', kind: 'rect@1', name: 'dot', order: 'a2', params: { box: DOT, paint: { fill: { role: 'ink' } } }, ...parent },
];
/** An item in a group at opacity 1 and the same item with no group: two overlapping rects, one stroked. */
export const GROUP_PAIR: Pair = {
  name: 'group-opacity-1',
  a: board('Two rects in a group at opacity 1', [GROUND, { id: 'g', kind: 'group@1', name: 'g', order: 'a1', params: { opacity: 1 } }, ...cardItems({ parent: 'g' })]),
  b: board('The same two rects with no group', [GROUND, ...cardItems({})]),
  packs: false,
  stroked: [{ item: 'card', box: CARD }],
};
/** The two pairs the test names itself and draws through other suites' boards (README: The pairs). */
export const LAYER_PAIR = 'gpui-gpu-layer';
export const SEEK_PAIR = 'seek-play';

// ---------------------------------------------------------------------------------------------------
// Criterion 9, documents: a figure of solid rects on whole pixels and one blended group, from a seed.

export const FIGURE: Size = [256, 128];
export const BLENDS = ['normal', 'multiply', 'screen'] as const;
export type Blend = (typeof BLENDS)[number];
const FILLS = ['ink', 'accent', 'muted'] as const;
/** The role map the figures draw with on Vello CPU and the GPU layer (#391's form, as #385's suite passes one). */
export const FIGURE_LOOK: JsonObject = { light: { ground: [255, 255, 255], ink: [24, 26, 31], accent: [26, 163, 200], muted: [139, 143, 151] } };

export interface Figure { seed: number; blend: Blend; wash: Box; rects: Record<string, Box>; doc: JsonObject }
/** The generated figure of `seed`, as an agent sends it: a ground, 2 to 4 rects, and a group in a seeded blend mode
 * holding one rect (`wash`) over them. Every edge is on a multiple of 8 px. */
export function figure(seed: number): Figure {
  const next = seeded(seed);
  const items: JsonObject[] = [rect('back', [0, 0, FIGURE[0], FIGURE[1]], 'ground', 'a0')];
  const rects: Record<string, Box> = {};
  const count = 2 + below(next, 3);
  for (let k = 0; k < count; k++) {
    const w = 24 + 8 * below(next, 12);
    const h = 16 + 8 * below(next, 8);
    const box: Box = [8 * below(next, (FIGURE[0] - w) / 8 + 1), 8 * below(next, (FIGURE[1] - h) / 8 + 1), w, h];
    rects[`r${k}`] = box;
    items.push(rect(`r${k}`, box, FILLS[below(next, FILLS.length)]!, `a${k + 1}`));
  }
  const blend = BLENDS[below(next, BLENDS.length)]!;
  const wash: Box = [32 + 8 * below(next, 8), 16 + 8 * below(next, 4), 96 + 8 * below(next, 8), 48 + 8 * below(next, 4)];
  items.push({ id: 'mix', kind: 'group@1', name: 'mix', order: 'a8', params: { blend } }, rect('wash', wash, 'accent', 'a9', { parent: 'mix' }));
  const doc: JsonObject = {
    format: 1, profile: 'figure', title: `Generated figure ${seed}`, description: `A figure generated from the seed ${seed} for the #458 acceptance tests.`,
    size: [...FIGURE], items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
  };
  return { seed, blend, wash, rects, doc };
}

// The transforms that must not change the output (each returns a new document).
/** An invisible item: a rect over the whole figure, on top, with `visible: false`. */
export function withInvisibleItem(doc: JsonObject): JsonObject {
  const out = clone(doc);
  const size = out['size'] as number[];
  itemsOf(out)['ghost'] = rect('ghost', [0, 0, size[0]!, size[1]!], 'ink', 'az', { visible: false });
  return out;
}
/** An identity group: `item` moved into a new `group@1` with no params, which takes its place in the order. */
export function withIdentityGroup(doc: JsonObject, item: string): JsonObject {
  const out = clone(doc);
  const items = itemsOf(out);
  const it = items[item]!;
  items['wrap'] = { id: 'wrap', kind: 'group@1', name: 'wrap', order: it['order']!, params: {}, ...(it['parent'] === undefined ? {} : { parent: it['parent'] }), ...(it['role'] === undefined ? {} : { role: it['role'] }) };
  items[item] = { ...it, parent: 'wrap' };
  return out;
}
/** Renamed IDs: every item's ID gains the prefix `x`, in its key, its `id`, each `parent`, the document's `camera`
 * and every driver's target. */
export function withRenamedIds(doc: JsonObject): JsonObject {
  const out = clone(doc);
  const renamed: Record<string, JsonObject> = {};
  for (const [id, it] of Object.entries(itemsOf(out))) renamed[`x${id}`] = { ...it, id: `x${id}`, ...(typeof it['parent'] === 'string' ? { parent: `x${it['parent']}` } : {}) };
  out['items'] = renamed;
  if (typeof out['camera'] === 'string') out['camera'] = `x${out['camera']}`;
  for (const d of Object.values((out['drivers'] ?? {}) as Record<string, JsonObject>)) d['target'] = String(d['target']).replace(/^items\//, 'items/x');
  return out;
}
/** The four renderings of a figure the layer pair draws: as generated, and under each document transform. */
export const VARIANTS = ['plain', 'invisible_item', 'identity_group', 'renamed_ids'] as const;
export type Variant = (typeof VARIANTS)[number];
export function variant(f: Figure, v: Variant): JsonObject {
  if (v === 'invisible_item') return withInvisibleItem(f.doc);
  if (v === 'identity_group') return withIdentityGroup(f.doc, 'r0');
  if (v === 'renamed_ids') return withRenamedIds(f.doc);
  return clone(f.doc);
}
/** A document as a session holds it (#378): an `id`, one writer layer `main`, every item in it. */
export function sessionForm(doc: JsonObject, id: string, writer = 'agent-a'): JsonObject {
  const out = clone(doc);
  for (const it of Object.values(itemsOf(out))) it['layer'] = 'main';
  return { ...out, id, layers: { main: { writer, title: 'Main', order: 'a1' } } };
}
/** A document as the hub stored it (#306's form): your writer layer `you-main`, every item in it. Patches from your
 * shell apply to such a document. */
export function storedForm(doc: JsonObject): JsonObject {
  const out = clone(doc);
  for (const it of Object.values(itemsOf(out))) it['layer'] = 'you-main';
  return { ...out, layers: { 'you-main': { writer: 'you:you', title: 'You', order: 'a0' } } };
}
/** A patch split in two: the figure with `r0` and `r1` at a placeholder box, and the two `set` ops that put each at
 * its generated box. One patch holding both, or two patches of one each, must leave the same document. */
export const PLACEHOLDER: Box = [0, 0, 8, 8];
export function splitPatch(f: Figure): { base: JsonObject; ops: [JsonObject, JsonObject] } {
  const base = clone(f.doc);
  const op = (id: string): JsonObject => ({ op: 'set', id, path: `items/${id}/params/box`, value: [...f.rects[id]!] });
  for (const id of ['r0', 'r1']) (itemsOf(base)[id]!['params'] as JsonObject)['box'] = [...PLACEHOLDER];
  return { base, ops: [op('r0'), op('r1')] };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 9, documents in the app and the web player: a 2D film whose dot two drivers move with time, from a seed
// (the shape of #172's piece with stages: a camera, a ground, a band, a dot; no logic and no world, so its evaluated
// data alone says where it is).

export interface Film { seed: number; doc: JsonObject; paths: [string, string] }
export function film(seed: number, id: string): Film {
  const next = seeded(seed);
  const [a, b, c, d] = [below(next, 40), 1 + below(next, 20), 10 + below(next, 60), 1 + below(next, 9)];
  const flat = (item: string, box: Box, role: string, k: number, is: string): JsonObject =>
    ({ id: item, kind: 'rect@1', name: item, order: `a${String(k).padStart(4, '0')}`, params: { box, paint: { fill: { role } } }, at: { pos: [0, 0, 0] }, role: is });
  const items = [
    { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0000cam', params: { projection: 'orthographic', target: [160, 90, 0], view_width: 320 } },
    flat('back', [0, 0, 320, 180], 'ground', 1, 'decoration'),
    flat('band', [0, 100 + 4 * below(next, 10), 320, 40], 'ink', 2, 'decoration'),
    flat('dot', [0, 0, 12, 12], 'accent', 3, 'part'),
  ];
  const doc: JsonObject = {
    format: 1, id, profile: 'film', title: `Generated film ${seed}`, description: `A dot two drivers move with time, generated from the seed ${seed} for the #458 acceptance tests.`,
    size: [320, 180], camera: 'cam', transport: { span: '4s', frame_rate: [30, 1] },
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
    drivers: {
      walk: { target: 'items/dot/at/pos/0', expr: `${a} + ${b} * t`, vars: { t: 'time' } },
      lift: { target: 'items/dot/at/pos/1', expr: `${c} + ${d} * t`, vars: { t: 'time' } },
    },
  };
  return { seed, doc, paths: ['items/dot/at/pos/0', 'items/dot/at/pos/1'] };
}
/** The film under the three document transforms at once: an invisible item, the band in an identity group, and every
 * ID renamed. Its dot's paths are the renamed ones, in the same order. */
export function transformedFilm(f: Film, id: string): Film {
  const ghosted = withInvisibleItem(f.doc);
  (itemsOf(ghosted)['ghost'] as JsonObject)['role'] = 'decoration';
  (itemsOf(ghosted)['ghost'] as JsonObject)['at'] = { pos: [0, 0, 0] };
  const doc = { ...withRenamedIds(withIdentityGroup(ghosted, 'band')), id };
  return { seed: f.seed, doc, paths: ['items/xdot/at/pos/0', 'items/xdot/at/pos/1'] };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 9, programs: a provider in the one subset, from a seed. `gen(arg: i64) → i32` folds `arg` through a loop
// of 3 to 6 i64 operations with seeded constants, 3 to 10 trips; it leaves the 64-bit result at memory 0 and returns
// its low 32 bits. Integers only: no float, so no NaN rule applies; a few dozen operations, far inside any fuel budget;
// no call, so no stack rule applies. So the rewrite must leave its result as the program as written gives it.

const OPS = [
  ['i64.add', 0x7c], ['i64.sub', 0x7d], ['i64.mul', 0x7e], ['i64.xor', 0x85], ['i64.or', 0x84], ['i64.and', 0x83],
  ['i64.shl', 0x86], ['i64.shr_u', 0x88], ['i64.rotl', 0x89],
] as const;
export type Op = (typeof OPS)[number][0];
export interface Step { op: Op; code: number; c: bigint }
export interface Program { seed: number; c0: bigint; trips: number; steps: Step[]; bytes: Uint8Array; b64: string }
const MASK = (1n << 64n) - 1n;
const word64 = (next: () => number): bigint => (BigInt(next()) << 32n) | BigInt(next());

function uleb(n: number): number[] {
  const out: number[] = [];
  do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n);
  return out;
}
function sleb(v: bigint | number): number[] {
  let n = BigInt.asIntN(64, BigInt(v));
  const out: number[] = [];
  for (;;) {
    const b = Number(n & 0x7fn);
    n >>= 7n;
    if ((n === 0n && !(b & 0x40)) || (n === -1n && (b & 0x40))) { out.push(b); return out; }
    out.push(b | 0x80);
  }
}
const named = (s: string): number[] => [...uleb(s.length), ...Buffer.from(s, 'latin1')];
const section = (id: number, body: number[]): number[] => [id, ...uleb(body.length), ...body];
const vec = (entries: number[][]): number[] => [...uleb(entries.length), ...entries.flat()];

/** The program's bytes: a provider as the sandbox's check takes one (`memory` of one page, fixed; `gen`; the immutable
 * i32 globals `params_at`, `assets_at`, `out_at`), no import, no table, no data. Locals: 1 the value, 2 the trip count. */
function assemble(c0: bigint, trips: number, steps: readonly Step[]): Uint8Array {
  const i64 = (v: bigint | number): number[] => [0x42, ...sleb(v)];
  const code = [0x20, 0x00, ...i64(c0), 0x85, 0x21, 0x01, 0x03, 0x40];
  for (const s of steps) code.push(0x20, 0x01, ...i64(s.c), s.code, 0x21, 0x01);
  code.push(0x20, 0x02, ...i64(1), 0x7c, 0x21, 0x02, 0x20, 0x02, ...i64(trips), 0x54, 0x0d, 0x00, 0x0b);
  code.push(0x41, 0x00, 0x20, 0x01, 0x37, 0x03, 0x00, 0x20, 0x01, 0xa7, 0x0b);
  const body = [...vec([[0x02, 0x7e]]), ...code];
  const global = (v: number): number[] => [0x7f, 0x00, 0x41, ...sleb(v), 0x0b];
  return Uint8Array.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([[0x60, 0x01, 0x7e, 0x01, 0x7f]])),
    ...section(3, vec([[0x00]])),
    ...section(5, vec([[0x01, 0x01, 0x01]])),
    ...section(6, vec([global(61440), global(62464), global(63488)])),
    ...section(7, vec([[...named('memory'), 0x02, 0x00], [...named('params_at'), 0x03, 0x00], [...named('assets_at'), 0x03, 0x01], [...named('out_at'), 0x03, 0x02], [...named('gen'), 0x00, 0x00]])),
    ...section(10, vec([[...uleb(body.length), ...body]])),
  ]);
}
/** The generated program of `seed`. */
export function program(seed: number): Program {
  const next = seeded(seed);
  const c0 = word64(next);
  const trips = 3 + below(next, 8);
  const steps = Array.from({ length: 3 + below(next, 4) }, (): Step => {
    const [op, code] = OPS[below(next, OPS.length)]!;
    const c = code >= 0x86 ? BigInt(1 + below(next, 63)) : word64(next) | (op === 'i64.and' ? 0xffff0000ffff0000n : 1n);
    return { op, code, c };
  });
  const bytes = assemble(c0, trips, steps);
  return { seed, c0, trips, steps, bytes, b64: Buffer.from(bytes).toString('base64') };
}
function apply(op: Op, x: bigint, c: bigint): bigint {
  const s = c & 63n;
  switch (op) {
    case 'i64.add': return (x + c) & MASK;
    case 'i64.sub': return (x - c) & MASK;
    case 'i64.mul': return (x * c) & MASK;
    case 'i64.xor': return x ^ c;
    case 'i64.or': return x | c;
    case 'i64.and': return x & c;
    case 'i64.shl': return (x << s) & MASK;
    case 'i64.shr_u': return x >> s;
    case 'i64.rotl': return ((x << s) | (x >> ((64n - s) & 63n))) & MASK;
  }
}
/** A run's observable result, as the sandbox's `run` reports one: `gen`'s i32 return and the 8 bytes at memory 0. */
export interface Result { result: number; hex: string }
const resultOf = (x: bigint): Result => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(x);
  return { result: Number(BigInt.asIntN(32, x)), hex: b.toString('hex') };
};
/** What the program computes for `arg`, by the WebAssembly specification's integer rules in BigInt arithmetic: the
 * expected value, set outside any engine. `rotlAsRotr` models the planted rewrite, for the fixture's own check only. */
export function expected(p: Program, arg: number, rotlAsRotr = false): Result {
  let x = (BigInt.asUintN(64, BigInt(arg)) ^ p.c0) & MASK;
  for (let trip = 0; trip < p.trips; trip++) for (const s of p.steps) x = apply(s.op, x, rotlAsRotr && s.op === 'i64.rotl' ? 64n - s.c : s.c);
  return resultOf(x);
}
/** The program as written, run unrewritten by this process's own WebAssembly engine. */
export function runAsWritten(p: Program, arg: number): Result {
  const instance = new WebAssembly.Instance(new WebAssembly.Module(Buffer.from(p.bytes)), {});
  const gen = instance.exports['gen'] as (arg: bigint) => number;
  const memory = instance.exports['memory'] as WebAssembly.Memory;
  const result = gen(BigInt(arg));
  return { result, hex: Buffer.from(new Uint8Array(memory.buffer, 0, 8)).toString('hex') };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 11: 25 boxes on a 5 × 5 grid 2 m apart, sliding 3 m along x over 2 s under a camera that orbits a quarter
// turn in the same 2 s; once as 25 instances of one prototype, once as 25 separate items. Every number is a small
// multiple of a power of two, and at 32 frames a second every sampled time is one too, so the element's place
// (instancer + its row) and the item's (its own channel) are the same number however each is composed.

export const FLEET = {
  size: [320, 240] as Size, fps: 32, count: 25, side: 5, spacing: 2, slide: [-1.5, 1.5] as [number, number], span: 2,
  /** The 10 sampled frames: t = n ÷ 32 s, 0.125 s to 1.8125 s. */
  sampled: [4, 10, 16, 22, 28, 34, 40, 46, 52, 58],
  targets: ['ids', 'normal', 'depth', 'velocity'] as const,
};
/** Box k's place on the grid, before the slide. */
export const gridPos = (k: number): [number, number, number] => [(k % FLEET.side - 2) * FLEET.spacing, 0.5, (Math.floor(k / FLEET.side) - 2) * FLEET.spacing];
export const itemId = (k: number): string => `fleet-${String(k).padStart(2, '0')}`;
const slideKeys = (from: number): JsonObject => ({ k0: { t: '0s', value: from + FLEET.slide[0], interp: 'linear' }, k1: { t: `${FLEET.span}s`, value: from + FLEET.slide[1], interp: 'linear' } });
/** A black sky with no ambient (#431's): the background reads 0. */
const DARK_SKY: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
const PROTO_SIZE = [0.75, 0.75, 0.75];

/** The fleet as a `view3d` session holds it (#378): one writer layer, every item in it, the camera `cam`. */
export function fleetDoc(as: 'instances' | 'items'): JsonObject {
  const k25 = Array.from({ length: FLEET.count }, (_, k) => k);
  const fleet: Record<string, JsonObject> = as === 'instances'
    ? {
        fleet: { kind: 'instance@1', params: { of: ['proto'], ids: k25, pos: k25.map(gridPos) }, at: { pos: [FLEET.slide[0], 0, 0] } },
        proto: { kind: 'mark.box@1', params: { size: PROTO_SIZE }, material: 'white', visible: false },
      }
    : Object.fromEntries(k25.map((k) => { const p = gridPos(k); return [itemId(k), { kind: 'mark.box@1', params: { size: PROTO_SIZE }, material: 'white', at: { pos: [p[0] + FLEET.slide[0], p[1], p[2]] } }]; }));
  const channels: JsonObject = { spin: { target: 'items/cam/params/orbit/azimuth', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: `${FLEET.span}s`, value: 90, interp: 'linear' } } } };
  if (as === 'instances') channels['slide'] = { target: 'items/fleet/at/pos/0', type: 'f32', keys: slideKeys(0) };
  else for (const k of k25) channels[`slide-${String(k).padStart(2, '0')}`] = { target: `items/${itemId(k)}/at/pos/0`, type: 'f32', keys: slideKeys(gridPos(k)[0]) };
  const all: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 0, elevation: 35, distance: 18 }, fov: 40 } },
    sky: DARK_SKY,
    white: { kind: 'material@1', params: { base_color: [1, 1, 1, 1], unlit: true } },
    ...fleet,
  };
  const items: JsonObject = {};
  let order = 0;
  for (const [id, item] of Object.entries(all)) items[id] = { id, name: id, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id: `fleet-458-${as}`, profile: 'scene', title: `A fleet of 25, as ${as}`, description: `25 boxes sliding under an orbiting camera, drawn as ${as}: a #458 acceptance fixture.`,
    size: [...FLEET.size], camera: 'cam', transport: { span: `${FLEET.span}s` }, requires: { modules: { scene3d: '^1' } }, budget: { class: 'work_product' },
    layers: { main: { writer: 'agent:alpha', title: 'Main', order: 'a0' } }, channels, items,
  };
}
/** A plain physical look (#431's): tone map none at the exposure whose scale is 1, no bloom, no deband and no motion
 * blur, so the shutter is the design's 180°. */
export const FLEET_LOOK: JsonObject = {
  id: 'look-458-pairs', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'The plain look of the #458 pairs fixtures.',
  palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3' },
  roles: { ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone' },
  themes: { light: {}, dark: {} },
  fonts: {
    body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  },
  tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
  status: { pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464' },
  status_treatment: { core_min_px: 4, glyph: { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' } },
  min_distance: 0.1, attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
};
