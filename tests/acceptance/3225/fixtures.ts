import type { Expected, JsonObject, JsonValue } from './judges.ts';

export type V3 = [number, number, number];
export interface Pose { pos: V3; rot: V3 }

const box = (size: readonly number[], pos: V3, rot: V3 = [0, 0, 0]): JsonObject =>
  ({ kind: 'mark.box@1', params: { size: [...size] }, at: { pos, rot } });
const standing = (size: readonly number[], x: number, z: number, yaw = 0): JsonObject => box(size, [x, size[1]! / 2, z], [0, yaw, 0]);

function scene(title: string, description: string, size: [number, number], items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const out: JsonObject = {};
  let order = 0;
  for (const [id, item] of Object.entries(items)) out[id] = { id, name: id, order: `a${String(order++).padStart(3, '0')}`, ...item };
  return { format: 1, profile: 'scene', title, description, size, requires: { modules: { scene3d: '^1', motion: '^1' } }, ...extra, items: out };
}
const fixture = (title: string, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject =>
  scene(title, `${title}: a #3225 acceptance fixture.`, [480, 360], items, extra);
const floorOver = (x: [number, number], z: [number, number]): JsonObject =>
  box([x[1] - x[0], 0.1, z[1] - z[0]], [(x[0] + x[1]) / 2, -0.05, (z[0] + z[1]) / 2]);

export const SIZE = {
  floor: [4.2, 0.1, 3.2], wall_ns: [4.2, 2.5, 0.1], wall_ew: [0.1, 2.5, 3.0],
  table: [1.2, 0.75, 0.8], chair: [0.65, 0.85, 0.65], lamp: [0.2, 0.45, 0.2], shelf: [0.9, 1.8, 0.35], rug: [1.0, 0.01, 0.6],
} as const satisfies Record<string, V3>;
export const SHELL = ['floor', 'wall_n', 'wall_e', 'wall_s', 'wall_w'] as const;
export const FOUR = ['chair_1', 'chair_2', 'chair_3', 'chair_4'] as const;
export const ARRANGED = ['table', ...FOUR, 'lamp', 'shelf', 'rug'] as const;
export const ARRANGEMENT = 'arrangement';
export const TABLE_HEIGHT = SIZE.table[1];

export const ROOM_RELATIONS: Expected[] = [
  ...FOUR.map((c) => ({ a: c, rel: 'next_to', b: 'table' })),
  ...FOUR.map((c) => ({ a: c, rel: 'facing', b: 'table' })),
  { a: 'lamp', rel: 'on', b: 'table' },
  { a: 'shelf', rel: 'against', b: 'wall_n' },
  { a: 'rug', rel: 'on', b: 'floor' },
  { a: 'table', rel: 'inside', b: 'room' },
];
export const LAMP_ON_TABLE: Expected = { a: 'lamp', rel: 'on', b: 'table' };

function shell(): Record<string, JsonObject> {
  return {
    floor: box(SIZE.floor, [0, -0.05, 0]),
    wall_n: box(SIZE.wall_ns, [0, 1.25, -1.55]),
    wall_s: box(SIZE.wall_ns, [0, 1.25, 1.55]),
    wall_e: box(SIZE.wall_ew, [2.05, 1.25, 0]),
    wall_w: box(SIZE.wall_ew, [-2.05, 1.25, 0]),
  };
}
function room(items: Record<string, JsonObject>, title = 'A furnished room', issue = 1732): JsonObject {
  return scene(title, `${title}: a #${issue} acceptance fixture.`, [480, 360], items, {
    collections: { room: { members: [...SHELL] } },
    audit: { scope: 'scene', overlap: { pairs: 'all', tolerance: 0.001 }, support: { floating: ['floor'] } },
  });
}
const STARTS: Record<(typeof ARRANGED)[number], [number, number, number]> = {
  table: [0, 0, 0], chair_1: [-0.9, 1.1, 0], chair_2: [0.9, 1.1, 0], chair_3: [-0.9, -1.0, 0], chair_4: [0.9, -1.0, 0],
  lamp: [1.7, 0, 0], shelf: [0, -1.2, 0], rug: [1.6, 0.95, 90],
};
const sizeOf = (id: string): readonly number[] => (id.startsWith('chair_') ? SIZE.chair : SIZE[id as 'table' | 'lamp' | 'shelf' | 'rug']);

export function roomDoc(): JsonObject {
  return room({
    ...shell(),
    ...Object.fromEntries(ARRANGED.map((id) => [id, standing(sizeOf(id), ...STARTS[id])])),
    [ARRANGEMENT]: { kind: 'arrange@1', params: { items: [...ARRANGED], relations: ROOM_RELATIONS as unknown as JsonValue[] } },
  });
}
const furnitureAt = (poses: Readonly<Record<string, Pose>>): Record<string, JsonObject> =>
  Object.fromEntries(ARRANGED.map((id) => [id, box(sizeOf(id), [...poses[id]!.pos], [...poses[id]!.rot])]));
export const roomAt = (poses: Readonly<Record<string, Pose>>): JsonObject => room({ ...shell(), ...furnitureAt(poses) });
export function withLampAt(doc: JsonObject, to: V3): JsonObject {
  const out = JSON.parse(JSON.stringify(doc)) as { items: { lamp: { at: { pos: V3 } } } };
  out.items.lamp.at.pos = to;
  return out as unknown as JsonObject;
}
export const LIFT_OUT = 0.3;

const yawed = (pos: V3, yaw = 0): Pose => ({ pos, rot: [0, yaw, 0] });
const PLACED: Readonly<Record<string, Pose>> = {
  table: yawed([0, 0.375, 0]),
  chair_1: yawed([0, 0.425, 0.725], 180),
  chair_2: yawed([0, 0.425, -0.725], 0),
  chair_3: yawed([0.925, 0.425, 0], -90),
  chair_4: yawed([-0.925, 0.425, 0], 90),
  shelf: yawed([-1.2, 0.9, -1.325]),
  rug: yawed([1.4, 0.005, 1.1]),
};
export const LAMP_PLACES = {
  table: yawed([0, 0.975, 0]),
  floor: yawed([0.8, 0.225, 0.6]),
  lifted: yawed([0, 1.175, 0]),
} as const satisfies Record<string, Pose>;
export const LIFT = 0.2;
export const placedRoom = (lamp: keyof typeof LAMP_PLACES): JsonObject =>
  room({ ...shell(), ...furnitureAt({ ...PLACED, lamp: LAMP_PLACES[lamp] }) }, 'A room placed by hand', 3225);
export const placedPoses = (lamp: keyof typeof LAMP_PLACES): Record<string, Pose> => ({ ...PLACED, lamp: LAMP_PLACES[lamp] });

export const TURNED = { away: 90, slightly: 15 } as const;
export const FACING_CONE = 20;
export function chairsDoc(): JsonObject {
  return fixture('Two turned chairs', {
    floor: floorOver([-2, 4], [-2, 3]),
    table: standing(SIZE.table, 0, 0),
    chair_90: standing(SIZE.chair, 0, 1.5, 180 - TURNED.away),
    chair_15: standing(SIZE.chair, 2.4, 0, -90 + TURNED.slightly),
  });
}
export const CHAIR_90: Expected = { a: 'chair_90', rel: 'facing', b: 'table' };
export const CHAIR_15: Expected = { a: 'chair_15', rel: 'facing', b: 'table' };

export const RUG_OUT = 0.3;
export const ROOM_BOUNDS = { x: 2.1, z: 1.6, y: [-0.1, 2.5] } as const;
export const RUG_YAW = 45;
export const rugX = (): number => {
  const t = (RUG_YAW * Math.PI) / 180;
  return ROOM_BOUNDS.x + RUG_OUT - (SIZE.rug[0] / 2) * Math.cos(t) - (SIZE.rug[2] / 2) * Math.sin(t);
};
export function rugDoc(): JsonObject {
  return room({ ...shell(), rug: box(SIZE.rug, [rugX(), SIZE.rug[1] / 2, 0], [0, RUG_YAW, 0]) }, 'A rug across the wall', 3225);
}
export const RUG_INSIDE: Expected = { a: 'rug', rel: 'inside', b: 'room' };

export const CRATE = { edge: 0.5, gap: 0.3, d: 0.5 } as const;
export function cratesDoc(): JsonObject {
  const size = [CRATE.edge, CRATE.edge, CRATE.edge];
  return fixture('Two crates', {
    floor: floorOver([-1, 2], [-1, 1]),
    crate_a: standing(size, 0, 0),
    crate_b: standing(size, 0.8, 0),
  });
}
export const CRATES_APART: Expected = { a: 'crate_a', rel: 'apart', b: 'crate_b', d: CRATE.d };
export const CRATES_NEAR: Expected = { a: 'crate_a', rel: 'near', b: 'crate_b', d: CRATE.d };

export const BOOKS = ['book_1', 'book_2', 'book_3', 'book_4'] as const;
export const ON_SHELF = ['book_1', 'book_2', 'book_3'] as const;
export function booksDoc(): JsonObject {
  const book = (pos: V3): JsonObject => box([0.04, 0.24, 0.16], pos);
  return fixture('Four books', {
    floor: floorOver([-2, 2], [-1, 1]),
    shelf: standing([0.9, 1.0, 0.3], 0, 0),
    book_1: book([-0.2, 1.12, 0]), book_2: book([0, 1.12, 0]), book_3: book([0.2, 1.12, 0]),
    book_4: book([0.8, 0.12, 0.3]),
  }, { collections: { books: { members: [...BOOKS] } } });
}
export const booksOnShelf = (count: number | [number, number]): Expected => ({ a: 'books', rel: 'on', b: 'shelf', count });

export const TIP = 30;
export const tippedY = (): number => {
  const t = (TIP * Math.PI) / 180;
  return (SIZE.chair[1] / 2) * Math.cos(t) + (SIZE.chair[2] / 2) * Math.sin(t);
};
export function tippedDoc(): JsonObject {
  return fixture('A tipped chair', {
    floor: floorOver([-2, 2], [-2, 3]),
    table: standing(SIZE.table, 0, 0),
    chair_tipped: box(SIZE.chair, [0, tippedY(), 1.2], [-TIP, 180, 0]),
  });
}
export const TIPPED_FACING: Expected = { a: 'chair_tipped', rel: 'facing', b: 'table' };

export const SEEDED = { seed: 3225, poses: 1000, perDoc: 100, perCheck: 9, apart: 6 } as const;
export const RELS = ['on', 'inside', 'next_to', 'against', 'facing', 'near', 'apart'] as const;

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}
export interface Placed { id: string; size: V3; pos: V3; yaw: number }
export interface PosePair { k: number; a: Placed; b: Placed; near: number }

export function seededPairs(): PosePair[] {
  const next = mulberry32(SEEDED.seed);
  const u = (lo: number, hi: number): number => lo + (hi - lo) * (((next() >>> 5) * 67108864 + (next() >>> 6)) / 9007199254740992);
  const id = (who: string, k: number): string => `${who}_${String(k).padStart(4, '0')}`;
  return Array.from({ length: SEEDED.poses }, (_, k) => {
    const cell = [((k % SEEDED.perDoc) % 10) * 10, Math.floor((k % SEEDED.perDoc) / 10) * 10] as const;
    const bSize: V3 = [u(0.3, 1.5), u(0.3, 1.5), u(0.3, 1.5)];
    const bYaw = u(0, 360);
    const aSize: V3 = [u(0.2, 1.0), u(0.2, 1.0), u(0.2, 1.0)];
    const aYaw = u(-180, 180);
    const off = [u(-2, 2), u(-2, 2)] as const;
    const mode = Math.floor(u(0, 3));
    const lifted = u(0, 2);
    const bottom = mode === 0 ? 0 : mode === 1 ? bSize[1] : lifted;
    const near = u(0.05, 1.0);
    return {
      k, near,
      b: { id: id('b', k), size: bSize, pos: [cell[0], bSize[1] / 2, cell[1]], yaw: bYaw },
      a: { id: id('a', k), size: aSize, pos: [cell[0] + off[0], bottom + aSize[1] / 2, cell[1] + off[1]], yaw: aYaw },
    };
  });
}
export const pairRelations = (p: PosePair): Expected[] => RELS.map((rel) => ({
  a: p.a.id, rel, b: p.b.id, ...(rel === 'near' ? { d: p.near } : rel === 'apart' ? { d: SEEDED.apart } : {}),
}));
export const poseOf = (e: Expected): number => Number(e.a.slice(2));
export const poseText = (p: PosePair): string => {
  const at = (x: Placed): string => `${x.id} ${JSON.stringify(x.size)} m at ${JSON.stringify(x.pos)} yaw ${x.yaw}°`;
  return `${at(p.a)}; ${at(p.b)}; near d ${p.near}`;
};
export function posesDoc(pairs: readonly PosePair[]): JsonObject {
  const placed = (x: Placed): JsonObject => box(x.size, x.pos, [0, x.yaw, 0]);
  return fixture('Seeded poses of two boxes', {
    ...Object.fromEntries(pairs.flatMap((p) => [[p.a.id, placed(p.a)], [p.b.id, placed(p.b)]])),
    [ARRANGEMENT]: { kind: 'arrange@1', params: { items: [], relations: pairs.flatMap(pairRelations) as unknown as JsonValue[] } },
  });
}
export const chunks = <T>(list: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, k) => list.slice(k * size, (k + 1) * size));

export const BUDGET = { items: 1000, groups: 333, rows: 9, pitch: 3, relations: 64, ms: 5 } as const;
const groupId = (who: string, g: number): string => `${who}_${String(g).padStart(3, '0')}`;
const cellOf = (g: number): [number, number] => [Math.floor(g / BUDGET.rows) * BUDGET.pitch, (g % BUDGET.rows) * BUDGET.pitch];
export function budgetDoc(): JsonObject {
  const items: Record<string, JsonObject> = { floor: floorOver([-2, 113], [-2, 27]) };
  for (let g = 0; g < BUDGET.groups; g++) {
    const [x, z] = cellOf(g);
    items[groupId('plinth', g)] = standing([1, 0.5, 1], x, z);
    items[groupId('vase', g)] = box([0.2, 0.3, 0.2], [x, 0.65, z]);
    items[groupId('crate', g)] = standing([0.4, 0.4, 0.4], x + 0.7, z, 90);
  }
  return fixture('A hall of plinths', items, { collections: { hall: { members: Object.keys(items) } } });
}
export function budgetRelations(): Expected[] {
  const out: Expected[] = [];
  for (let g = 0; g < BUDGET.rows; g++) {
    const [plinth, vase, crate, onward] = [groupId('plinth', g), groupId('vase', g), groupId('crate', g), groupId('plinth', g + BUDGET.rows)];
    out.push(
      { a: vase, rel: 'on', b: plinth }, { a: vase, rel: 'inside', b: 'hall' },
      { a: crate, rel: 'next_to', b: plinth }, { a: crate, rel: 'against', b: plinth }, { a: crate, rel: 'facing', b: onward },
      { a: crate, rel: 'near', b: vase, d: 1 }, { a: plinth, rel: 'apart', b: onward, d: 1.5 },
    );
  }
  out.push({ a: groupId('vase', BUDGET.rows), rel: 'on', b: groupId('plinth', BUDGET.rows) });
  return out;
}
