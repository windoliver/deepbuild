// The #194 fixtures (README: Fixtures), as data this suite writes out as files at run time: the catalog of 40 items, 15
// recipes and 4 creatures with its schema, its copy in English and French, its twins (each one row or one cell
// changed), the scenario catalog of criteria 7 and 13, the platformer's tuning table, and the large catalogs the budgets
// time. Every value an expected value comes from is set here; nothing here packs, hashes or checks anything.

/** A cell as this suite writes it: an ID or text, a number, a bool, a list of IDs, or empty (null). */
export type Cell = string | number | boolean | string[] | null;
export type Row = Record<string, Cell>;
/** A table as its file holds it: its columns in file order and its rows in file order. */
export interface FileTable { columns: string[]; rows: Row[] }
export type Tables = Record<string, FileTable>;
/** A schema as the brief gives it (Asset: tables: catalogs `table.layout@1`, As built: a type as a string). */
export interface ColumnSchema { type: string; unit?: string; range?: [number, number] }
export interface TableSchema { id: string; inherit?: string; columns: Record<string, ColumnSchema> }
export type Schema = Record<string, TableSchema>;
/** data.copy: locale → copy table → key → string. */
export type Copy = Record<string, Record<string, Record<string, string>>>;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ---------------------------------------------------------------------------------------------------
// The catalog (criteria 1 to 6, 8 to 11): items, recipes and creatures.

export const SCHEMA: Schema = {
  items: {
    id: 'id', inherit: 'base',
    columns: {
      name: { type: 'copy items' },
      weight: { type: 'f64', unit: 'kg', range: [0, 50] },
      value: { type: 'i32', unit: 'coin', range: [0, 1000] },
      stack: { type: 'bool' },
      damage: { type: 'i32', range: [0, 100] },
    },
  },
  recipes: {
    id: 'id',
    columns: {
      inputs: { type: 'refs items' }, tools: { type: 'refs items' }, outputs: { type: 'refs items' },
      time: { type: 'f64', unit: 's', range: [0, 600] },
    },
  },
  creatures: {
    id: 'id',
    columns: { name: { type: 'copy creatures' }, hp: { type: 'i32' }, drops: { type: 'refs items' }, speed: { type: 'f64', unit: 'm/s' } },
  },
};

/** Each item: [id, name key, weight, value, stack, damage, en, fr]; null is an empty cell. Cudgel holds key 1042. */
const ITEMS: [string, number, number | null, number, boolean | null, number | null, string, string][] = [
  ['log', 1001, 2.5, 4, true, null, 'Log', 'Bûche'],
  ['stone', 1002, 1.2, 1, true, null, 'Stone', 'Pierre'],
  ['fiber', 1003, 0.1, 1, true, null, 'Fiber', 'Fibre'],
  ['flint', 1004, 0.3, 1, true, null, 'Flint', 'Silex'],
  ['knife', 1005, 0.4, 8, false, 3, 'Knife', 'Couteau'],
  ['torch', 1006, 0.6, 3, true, null, 'Torch', 'Torche'],
  ['bread', 1007, 0.3, 2, true, null, 'Bread', 'Pain'],
  ['waterskin', 1008, 1.0, 3, false, null, 'Waterskin', 'Outre'],
  ['map', 1009, 0.1, 5, false, null, 'Map', 'Carte'],
  ['coin', 1010, 0.01, 1, true, null, 'Coin', 'Pièce'],
  ['lantern', 1011, 1.4, 9, false, null, 'Lantern', 'Lanterne'],
  ['hide', 1012, 1.5, 4, true, null, 'Hide', 'Peau'],
  ['bone', 1013, 0.5, 1, true, null, 'Bone', 'Os'],
  ['meat', 1014, 0.8, 2, true, null, 'Meat', 'Viande'],
  ['gel', 1015, 0.2, 1, true, null, 'Gel', 'Gelée'],
  ['iron_ore', 1016, 3.0, 3, true, null, 'Iron ore', 'Minerai de fer'],
  ['coal', 1017, 1.1, 2, true, null, 'Coal', 'Charbon'],
  ['rough_gem', 1018, 0.2, 10, true, null, 'Rough gem', 'Gemme brute'],
  ['clay', 1019, 2.0, 1, true, null, 'Clay', 'Argile'],
  ['guano', 1020, 0.3, 1, true, null, 'Guano', 'Guano'],
  ['fang', 1021, 0.1, 2, true, null, 'Fang', 'Croc'],
  ['wing', 1022, 0.1, 1, true, null, 'Wing', 'Aile'],
  ['plank', 1023, 0.9, 1, true, null, 'Plank', 'Planche'],
  ['sawdust', 1024, 0.05, 0, true, null, 'Sawdust', 'Sciure'],
  ['board', 1025, 1.7, 2, true, null, 'Board', 'Panneau'],
  ['stick', 1026, 0.2, 1, true, null, 'Stick', 'Bâton'],
  ['rope', 1027, 0.4, 4, true, null, 'Rope', 'Corde'],
  ['stone_axe', 1028, 2.2, 7, false, 8, 'Stone axe', 'Hache de pierre'],
  ['furnace', 1029, 40.0, 6, false, null, 'Furnace', 'Fourneau'],
  ['iron_ingot', 1030, 2.4, 6, true, null, 'Iron ingot', 'Lingot de fer'],
  ['slag', 1031, 1.3, 0, true, null, 'Slag', 'Scories'],
  ['hammer', 1032, 1.6, 3, false, 5, 'Hammer', 'Marteau'],
  ['blade', 1033, 1.1, 13, false, 12, 'Blade', 'Lame'],
  ['chisel', 1034, 0.5, 8, false, 2, 'Chisel', 'Ciseau'],
  ['gem', 1035, 0.1, 12, true, null, 'Gem', 'Gemme'],
  ['gem_dust', 1036, 0.02, 0, true, null, 'Gem dust', 'Poudre de gemme'],
  ['leather', 1037, 0.7, 5, true, null, 'Leather', 'Cuir'],
  ['fat', 1038, 0.4, 1, true, null, 'Fat', 'Graisse'],
  ['cudgel', 1042, 1.8, 6, false, 6, 'Cudgel', 'Gourdin'],
  ['spiked_cudgel', 1043, null, 12, null, null, 'Spiked cudgel', 'Gourdin clouté'],
];
/** The item that inherits, the row it names, and the columns it leaves empty. */
export const INHERITS = { id: 'spiked_cudgel', from: 'cudgel', empty: ['weight', 'stack', 'damage'] } as const;
/** Cudgel's weight in the CSV, and its name key. */
export const CUDGEL = { id: 'cudgel', weight: 1.8, key: 1042, en: 'Cudgel', fr: 'Gourdin' } as const;

/** Each recipe: [id, inputs, tools, outputs, time]. An uncraft is a recipe too. */
const RECIPES: [string, string[], string[], string[], number][] = [
  ['saw_log', ['log'], ['knife'], ['plank', 'plank', 'plank', 'plank', 'sawdust'], 4],
  ['make_board', ['plank', 'plank'], [], ['board'], 6],
  ['uncraft_board', ['board'], [], ['plank', 'plank'], 3],
  ['whittle', ['plank'], ['knife'], ['stick', 'stick'], 2],
  ['twist_rope', ['fiber', 'fiber', 'fiber'], [], ['rope'], 5],
  ['make_axe', ['stone', 'stick', 'rope'], [], ['stone_axe'], 10],
  ['build_furnace', ['stone', 'stone', 'stone', 'stone', 'clay', 'clay'], [], ['furnace'], 30],
  ['smelt_iron', ['iron_ore', 'coal'], ['furnace'], ['iron_ingot', 'slag'], 20],
  ['make_hammer', ['stone', 'stick'], [], ['hammer'], 8],
  ['forge_blade', ['iron_ingot', 'iron_ingot'], ['hammer', 'furnace'], ['blade'], 25],
  ['make_chisel', ['iron_ingot', 'stick'], ['hammer'], ['chisel'], 12],
  ['cut_gem', ['rough_gem'], ['chisel'], ['gem', 'gem_dust'], 15],
  ['tan_hide', ['hide'], ['knife'], ['leather', 'fat'], 9],
  ['carve_cudgel', ['log'], ['knife'], ['cudgel'], 7],
  ['spike_cudgel', ['cudgel', 'fang', 'fang'], ['hammer'], ['spiked_cudgel'], 11],
];
/** Each creature: [id, name key, hp, drops, speed, en, fr]. */
const CREATURES: [string, number, number, string[], number, string, string][] = [
  ['wolf', 2001, 40, ['hide', 'bone', 'meat'], 6.5, 'Wolf', 'Loup'],
  ['slime', 2002, 20, ['gel', 'gel'], 1.5, 'Slime', 'Limon'],
  ['golem', 2003, 180, ['iron_ore', 'coal', 'rough_gem', 'clay'], 1.0, 'Golem', 'Golem'],
  ['bat', 2004, 8, ['guano', 'fang', 'wing'], 9.0, 'Bat', 'Chauve-souris'],
];

/** The catalog's three tables, as their files hold them. */
export function catalog(): Tables {
  return {
    items: {
      columns: ['id', 'base', 'name', 'weight', 'value', 'stack', 'damage'],
      rows: ITEMS.map(([id, name, weight, value, stack, damage]) => ({
        id, base: id === INHERITS.id ? INHERITS.from : null, name, weight, value, stack, damage,
      })),
    },
    recipes: {
      columns: ['id', 'inputs', 'tools', 'outputs', 'time'],
      rows: RECIPES.map(([id, inputs, tools, outputs, time]) => ({ id, inputs, tools: tools.length ? tools : null, outputs, time })),
    },
    creatures: {
      columns: ['id', 'name', 'hp', 'drops', 'speed'],
      rows: CREATURES.map(([id, name, hp, drops, speed]) => ({ id, name, hp, drops, speed })),
    },
  };
}
/** The catalog's copy, data.copy: English and French for every item and creature name key. */
export function copy(): Copy {
  const of = (i: number): Record<string, Record<string, string>> => ({
    items: Object.fromEntries(ITEMS.map((x) => [String(x[1]), String(x[6 + i])])),
    creatures: Object.fromEntries(CREATURES.map((x) => [String(x[1]), String(x[5 + i])])),
  });
  return { en: of(0), fr: of(1) };
}
export const ITEM_COUNT = ITEMS.length;
export const RECIPE_COUNT = RECIPES.length;
export const CREATURE_COUNT = CREATURES.length;

/** The start kit, by IDs, as the brief lists it; the loot table is the creatures' drops. */
export const START_KIT = ['log', 'stone', 'fiber', 'flint', 'knife', 'torch', 'bread', 'waterskin', 'map', 'coin', 'lantern'];
export const ROOTS = [{ table: 'items', ids: START_KIT }, { table: 'creatures', column: 'drops' }];
export const MAKES = [{ table: 'recipes', inputs: 'inputs', tools: 'tools', outputs: 'outputs' }];
/** The brief's range for a creature's hp. */
export const HP_RANGE: [number, number] = [1, 200];
/** The value margin criterion 5 names. */
export const MARGIN = 5;

// ---------------------------------------------------------------------------------------------------
// Twins: each the catalog with one row added or one cell changed.

export function withRow(t: Tables, table: string, row: Row): Tables {
  const out = clone(t);
  out[table]!.rows.push(row);
  return out;
}
export function withCell(t: Tables, table: string, id: string, column: string, value: Cell): Tables {
  const out = clone(t);
  const row = out[table]!.rows.find((r) => r['id'] === id);
  if (!row) throw Error(`no row ${id} in ${table}`);
  row[column] = value;
  return out;
}
/** Criterion 3: a recipe naming plank_oak, which no item holds; and the item that fixes it. */
export const OAK_PANEL: Row = { id: 'oak_panel', inputs: ['plank_oak', 'plank'], tools: null, outputs: ['board'], time: 6 };
export const PLANK_OAK: Row = { id: 'plank_oak', base: null, name: 1044, weight: 0.9, value: 1, stack: true, damage: null };
/** Criterion 4: a recipe needing nails, which nothing yields (no row holds it). */
export const NAIL_BOARD: Row = { id: 'nail_board', inputs: ['plank', 'plank', 'nails'], tools: null, outputs: ['board'], time: 6 };
/** Criterion 2: two IDs whose FNV-1a 32 hashes are equal (both 0x5e4daa9d; helpers' fnv32a checks it at run time). */
export const COLLIDING = ['costarring', 'liquid'] as const;

// ---------------------------------------------------------------------------------------------------
// Criteria 7 and 13: one scenario catalog, its trigger tables each a scenario of its own.

/** The trigger table's columns, by the names scenario.reach reads (Check input: catalog kinds, As built). */
const TRIGGER_SCHEMA: TableSchema = {
  id: 'id',
  columns: {
    trigger: { type: 'ref forms' }, n: { type: 'i32' }, flag: { type: 'ref flags' }, side: { type: 'ref sides' }, cells: { type: 'refs map' },
    kind: { type: 'ref kinds' }, when: { type: 'refs flags' }, sets: { type: 'refs flags' }, shows: { type: 'refs messages' }, ends: { type: 'ref ends' },
    spawn: { type: 'ref kinds' }, spawn_side: { type: 'ref sides' }, spawn_at: { type: 'refs map' }, allow: { type: 'refs kinds' }, deny: { type: 'refs kinds' },
  },
};
const TRIGGER_COLUMNS = ['id', ...Object.keys(TRIGGER_SCHEMA.columns)];
/** The map: 10 × 6 cells `c<x>_<y>`; the river is x = 5, closed in every row; both sides' units stand west of it. */
export const MAP = { w: 10, h: 6, river: 5, units: [{ cell: 'c1_2', side: 'self', kind: 'soldier' }, { cell: 'c2_4', side: 'enemy', kind: 'soldier' }] };
/** The ambush's cells, east of the river; the same ambush's cells west of it. */
export const AMBUSH_EAST = ['c7_2', 'c7_3'];
export const AMBUSH_WEST = ['c3_2', 'c3_3'];
/** The messages' copy keys: the victory shows msg_win, 7003. */
export const MESSAGES: Record<string, number> = { msg_intro: 7001, msg_scout: 7002, msg_win: 7003, msg_lose: 7004 };
export const MESSAGE_COPY: Record<string, string> = { 7001: 'Night falls on the valley', 7002: 'Scouts report movement', 7003: 'Victory', 7004: 'Defeat' };

const trigger = (id: string, fields: Row): Row => ({ id, ...fields });
/** Each scenario's trigger rows, by its trigger table's name. */
export const SCENARIOS: Record<string, Row[]> = {
  // Criterion 7: the victory needs bridge_burned, which no row sets; fixed, a row west of the river sets it.
  flag_twin: [
    trigger('start', { trigger: 'turn', n: 0, shows: ['msg_intro'] }),
    trigger('scout', { trigger: 'turn', n: 3, sets: ['scouted'], shows: ['msg_scout'] }),
    trigger('victory', { trigger: 'flag', flag: 'bridge_burned', ends: 'victory', shows: ['msg_win'] }),
  ],
  flag_fixed: [
    trigger('start', { trigger: 'turn', n: 0, shows: ['msg_intro'] }),
    trigger('scout', { trigger: 'turn', n: 3, sets: ['scouted'], shows: ['msg_scout'] }),
    trigger('burn', { trigger: 'enter', side: 'self', cells: ['c3_2'], sets: ['bridge_burned'] }),
    trigger('victory', { trigger: 'flag', flag: 'bridge_burned', ends: 'victory', shows: ['msg_win'] }),
  ],
  // Criterion 7: the ambush triggers on entering cells east of the river; fixed, the same cells west of it.
  ambush_twin: [
    trigger('start', { trigger: 'turn', n: 0, shows: ['msg_intro'] }),
    trigger('ambush', { trigger: 'enter', side: 'self', cells: AMBUSH_EAST, sets: ['ambushed'] }),
    trigger('victory', { trigger: 'turn', n: 10, ends: 'victory', shows: ['msg_win'] }),
  ],
  ambush_fixed: [
    trigger('start', { trigger: 'turn', n: 0, shows: ['msg_intro'] }),
    trigger('ambush', { trigger: 'enter', side: 'self', cells: AMBUSH_WEST, sets: ['ambushed'] }),
    trigger('victory', { trigger: 'turn', n: 10, ends: 'victory', shows: ['msg_win'] }),
  ],
  // Criterion 7: the victory shows msg_win; the twin is the copy without its key.
  shows: [
    trigger('start', { trigger: 'turn', n: 0, shows: ['msg_intro'] }),
    trigger('victory', { trigger: 'turn', n: 5, ends: 'victory', shows: ['msg_win'] }),
  ],
  // Criterion 13: extractors denied at the start and never allowed; then allowed at time 60.
  mission_denied: [
    trigger('start', { trigger: 'time', n: 0, deny: ['extractor'] }),
    trigger('victory', { trigger: 'built', side: 'self', kind: 'extractor', n: 3, ends: 'victory' }),
  ],
  mission_allowed: [
    trigger('start', { trigger: 'time', n: 0, deny: ['extractor'] }),
    trigger('unlock', { trigger: 'time', n: 60, allow: ['extractor'] }),
    trigger('victory', { trigger: 'built', side: 'self', kind: 'extractor', n: 3, ends: 'victory' }),
  ],
};
/** Each scenario's goals, as the brief lists them; the turns every scenario runs. */
export const GOALS: Record<string, string[]> = {
  flag_twin: ['victory'], flag_fixed: ['victory'], ambush_twin: ['victory', 'ambush'], ambush_fixed: ['victory', 'ambush'], shows: ['victory'],
  mission_denied: ['victory'], mission_allowed: ['victory'],
};
export const TURNS = 20;

export const SCENARIO_SCHEMA: Schema = {
  forms: { id: 'id', columns: {} },
  ends: { id: 'id', columns: {} },
  flags: { id: 'id', columns: {} },
  sides: { id: 'id', columns: {} },
  resources: { id: 'id', columns: {} },
  kinds: { id: 'id', columns: { yields: { type: 'refs resources' } } },
  messages: { id: 'id', columns: { text: { type: 'copy messages' } } },
  map: { id: 'id', columns: { x: { type: 'i32' }, y: { type: 'i32' }, open: { type: 'bool' }, side: { type: 'ref sides' }, kind: { type: 'ref kinds' } } },
  ...Object.fromEntries(Object.keys(SCENARIOS).map((t) => [t, TRIGGER_SCHEMA])),
};
export function scenarioTables(): Tables {
  const ids = (list: string[]): FileTable => ({ columns: ['id'], rows: list.map((id) => ({ id })) });
  const cells: Row[] = [];
  for (let y = 0; y < MAP.h; y++) {
    for (let x = 0; x < MAP.w; x++) {
      const id = `c${x}_${y}`;
      const unit = MAP.units.find((u) => u.cell === id);
      cells.push({ id, x, y, open: x !== MAP.river, side: unit?.side ?? null, kind: unit?.kind ?? null });
    }
  }
  return {
    forms: ids(['turn', 'flag', 'enter', 'defeated', 'built', 'killed', 'stored', 'time']),
    ends: ids(['victory', 'defeat', 'none']),
    flags: ids(['bridge_burned', 'scouted', 'ambushed', 'alarm']),
    sides: ids(['self', 'enemy']),
    resources: ids(['ore']),
    kinds: { columns: ['id', 'yields'], rows: [{ id: 'soldier', yields: null }, { id: 'extractor', yields: ['ore'] }, { id: 'barracks', yields: null }] },
    messages: { columns: ['id', 'text'], rows: Object.entries(MESSAGES).map(([id, text]) => ({ id, text })) },
    map: { columns: ['id', 'x', 'y', 'open', 'side', 'kind'], rows: cells },
    ...Object.fromEntries(Object.entries(SCENARIOS).map(([t, rows]) => [t, { columns: TRIGGER_COLUMNS, rows }])),
  };
}
/** The scenarios' copy, in English: every message, or every message but `without`. */
export const messageCopy = (without: number[] = []): Copy =>
  ({ en: { messages: Object.fromEntries(Object.entries(MESSAGE_COPY).filter(([k]) => !without.includes(Number(k)))) } });

// ---------------------------------------------------------------------------------------------------
// Criterion 12: the platformer's tuning table, one row per feel value, as a patch would write it.

export const TUNING_SCHEMA: Schema = {
  tuning: { id: 'id', columns: { value: { type: 'f64' }, min: { type: 'f64' }, max: { type: 'f64' } } },
};
/** The tuning table's file: jump_height at `value` (its text as written), within [0.5, 2.0]. */
export const tuningCsv = (value: string): string => `id,value,min,max\njump_height,${value},0.5,2.0\n`;

// ---------------------------------------------------------------------------------------------------
// Criterion 11: the large catalogs the budgets time.

/** A seeded generator (mulberry32), so a failing run replays. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 10,000 rows of 20 columns: the ID and 19 typed columns (6 i32, 6 f64, 3 bool, 2 copy, a ref and a refs). */
export function wideTable(rows = 10_000): { tables: Tables; schema: Schema } {
  const r = seeded(194_011);
  const types: [string, ColumnSchema][] = [
    ...[0, 1, 2, 3, 4, 5].map((i): [string, ColumnSchema] => [`i${i}`, { type: 'i32', range: [-1_000_000, 1_000_000] }]),
    ...[0, 1, 2, 3, 4, 5].map((i): [string, ColumnSchema] => [`f${i}`, { type: 'f64', unit: 'm' }]),
    ...[0, 1, 2].map((i): [string, ColumnSchema] => [`b${i}`, { type: 'bool' }]),
    ...[0, 1].map((i): [string, ColumnSchema] => [`k${i}`, { type: 'copy labels' }]),
    ['next', { type: 'ref wide' }], ['links', { type: 'refs wide' }],
  ];
  const out: Row[] = [];
  for (let k = 0; k < rows; k++) {
    const row: Row = { id: `w${k}` };
    for (const [name, c] of types) {
      if (c.type === 'i32') row[name] = Math.floor(r() * 2_000_000) - 1_000_000;
      else if (c.type === 'f64') row[name] = Math.round(r() * 1e6) / 1e3;
      else if (c.type === 'bool') row[name] = r() < 0.5;
      else if (c.type.startsWith('copy')) row[name] = 5000 + Math.floor(r() * 1000);
      else if (c.type === 'ref wide') row[name] = `w${Math.floor(r() * rows)}`;
      else row[name] = [`w${Math.floor(r() * rows)}`, `w${Math.floor(r() * rows)}`];
    }
    out.push(row);
  }
  return { tables: { wide: { columns: ['id', ...types.map(([n]) => n)], rows: out } }, schema: { wide: { id: 'id', columns: Object.fromEntries(types) } } };
}
/** 5,000 recipes in a chain: recipe r<k> takes a<k> and makes a<k+1>; the root is a0. Every item and recipe is reachable. */
export function chain(recipes = 5_000): Tables {
  return {
    items: { columns: ['id', 'value'], rows: Array.from({ length: recipes + 1 }, (_, k) => ({ id: `a${k}`, value: 1 })) },
    recipes: { columns: ['id', 'inputs', 'tools', 'outputs'], rows: Array.from({ length: recipes }, (_, k) => ({ id: `r${k}`, inputs: [`a${k}`], tools: null, outputs: [`a${k + 1}`] })) },
  };
}
/** 5,000 recipes in 2,500 pairs: c<k> makes y<k> from two x<k>, and u<k> gives the two back; no cycle gains. */
export function pairs(recipes = 5_000): Tables {
  const n = recipes / 2;
  const items: Row[] = [];
  const rs: Row[] = [];
  for (let k = 0; k < n; k++) {
    items.push({ id: `x${k}`, value: 1 }, { id: `y${k}`, value: 2 });
    rs.push({ id: `c${k}`, inputs: [`x${k}`, `x${k}`], tools: null, outputs: [`y${k}`] }, { id: `u${k}`, inputs: [`y${k}`], tools: null, outputs: [`x${k}`, `x${k}`] });
  }
  return { items: { columns: ['id', 'value'], rows: items }, recipes: { columns: ['id', 'inputs', 'tools', 'outputs'], rows: rs } };
}
export const RECIPE_SCHEMA: Schema = {
  items: { id: 'id', columns: { value: { type: 'i32' } } },
  recipes: { id: 'id', columns: { inputs: { type: 'refs items' }, tools: { type: 'refs items' }, outputs: { type: 'refs items' } } },
};

// ---------------------------------------------------------------------------------------------------
// Files: a table as CSV (a header, then a row a line; a list's IDs separated by `;`; an empty cell empty) or as JSON lines
// (an object a line; a list as an array of IDs; an empty cell null). This suite's cells hold no comma, quote or newline.

const csvCell = (v: Cell | undefined): string => (v === null || v === undefined ? '' : Array.isArray(v) ? v.join(';') : String(v));
export const csvText = (t: FileTable): string => `${[t.columns.join(','), ...t.rows.map((r) => t.columns.map((c) => csvCell(r[c])).join(','))].join('\n')}\n`;
export const jsonlText = (t: FileTable): string => `${t.rows.map((r) => JSON.stringify(Object.fromEntries(t.columns.map((c) => [c, r[c] ?? null])))).join('\n')}\n`;
