// The #1219 suite's numbers and judges, with no test runner in them, so each judge can also be run as a plain node
// script: the fixtures' fields (the issue's own values), the closed forms derived from them and the Scope's words, the
// documents the criteria describe, each judge of what a binary answers, and the planted sets every judge must fail
// (`judgeProblems`). Nothing here stands in for a builder, a kind rule, the geometry audit or the scheduler: every value
// a test compares comes from a binary, every expected value from the issue's text and the design.

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type V3 = [number, number, number];

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const brief = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
const isNum = (v: JsonValue | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
/** A length as a failure prints it: four decimals, as the criteria print theirs. */
const m4 = (x: number): string => x.toFixed(4);
/** A fixture's own number as a failure prints it: 17.2, not 17.200000000000003. */
const plain = (x: number): string => String(+x.toFixed(6));

// ---------------------------------------------------------------------------------------------------
// The criteria

/** `#1219.` and the first 8 hex digits of SHA-256 of each criterion's text (scripts/proof-change.mjs, `criterionId`). */
export const CRITERIA = {
  1: '#1219.2fd5962d', 2: '#1219.cd3d7125', 3: '#1219.ccd3f457', 4: '#1219.a68fcbf4', 5: '#1219.643d7509', 6: '#1219.5569643b', 7: '#1219.9c284fc3',
} as const;

/** The criteria's bounds, m: columns on their grid, purlin and ridge heights, the eave line, the bracket set and what it carries. */
export const GRID_TOL = 1e-6;
export const FOLD_TOL = 1e-4;
export const EAVE_TOL = 1e-4;
export const BRACKET_TOL = 1e-3;

// ---------------------------------------------------------------------------------------------------
// The fixtures' numbers (README: The fixtures)

/** Criterion 1's frame: seven bays across, the middle one wider, two depth bays, so it is 29.8 m wide and 8 m deep. */
export const BAYS: readonly number[] = [4.2, 4.2, 4.2, 4.6, 4.2, 4.2, 4.2];
export const DEPTH_BAYS: readonly number[] = [4, 4];
/** The frame's `eave_height` and its columns' diameter: no criterion gives them (README: Readings). */
export const EAVE_HEIGHT = 3.6;
export const COLUMN_DIAMETER = 0.4;
/** Criterion 2's "four purlins a side": a 4 m depth bay holds four purlin spacings of 1 m. */
export const PURLINS_PER_BAY = 4;
/** Criterion 1's omitted grid point, as `omit` writes it: [across, front to back]. */
export const OMIT: [number, number] = [3, 0];
/** Criterion 1's printed centers of the front row, m. */
export const FRONT_X: readonly number[] = [0, 4.2, 8.4, 12.6, 17.2, 21.4, 25.6, 29.8];
/** Criterion 2's roof: `raise: 1/3`, and its printed heights above the eave purlin, m. */
export const RAISE = 1 / 3;
export const PRINTED_RIDGE = 2.6667;
export const PRINTED_PURLINS: readonly (readonly [number, number])[] = [[1, 0.4444], [2, 1.0222], [3, 1.7333]];
export const PRINTED_DIFFERENCE = 0.2667;
/** Criterion 3's corner: the eave rises 0.3 m over the last 3 m, judged at 50 samples. */
export const CORNER_RISE = 0.3;
export const CORNER_REACH = 3;
export const SAMPLES = 50;
/** Criterion 4's bracket set: two steps of 0.45 m reach and 0.3 m height; it reaches 0.90 m and rises 0.60 m. */
export const STEPS = 2;
export const STEP_REACH = 0.45;
export const STEP_HEIGHT = 0.3;
export const PRINTED_REACH = 0.9;
export const PRINTED_HEIGHT = 0.6;
/** The rafter overhang, `arch.roof`'s `overhang`: no criterion gives its value (README: Readings). */
export const OVERHANG = 0.75;

export const FRAME = 'frame';
export const BRACKETS = 'brackets';
export const BETWEEN = 'between';
export const ROOF = 'roof';
export const PROBE = 'probe';
export type RoofType = 'hip_ridge' | 'hip_gable' | 'overhang_gable' | 'flush_gable' | 'pyramid';
/** Criterion 5's four types, beside criterion 2's `hip_ridge`. */
export const OTHER_TYPES: readonly RoofType[] = ['hip_gable', 'overhang_gable', 'flush_gable', 'pyramid'];

/** The kind rules (Scope: Kind rules), by this suite's codes (README: The kind rules). */
export const RULE = {
  column: 'arch.column_on_grid', bracket: 'arch.bracket_meets', folding: 'arch.purlin_folding', eave: 'arch.eave_monotonic', rafter: 'arch.rafter_clear',
} as const;
const RULE_CODES: readonly string[] = Object.values(RULE);

/** The four wrong programs the criteria and the Proof line name, reachable only through the scenario's `planted` (README). */
export const PLANTED = {
  evenColumns: 'bay_frame_even_columns', straightAsFolded: 'roof_straight_as_folded', riseFallsBack: 'eave_rise_falls_back', bracketMisses: 'bracket_misses_purlin',
} as const;

// ---------------------------------------------------------------------------------------------------
// Closed forms, each from the fixture's numbers and the Scope's words

/**
 * The grid lines across (Scope: "column centers on a grid from bay widths across and depth bays front to back"): line i
 * stands at the sum of the bays before it, so n bays give n + 1 lines from 0. The depth lines are the same sums of the
 * depth bays.
 */
export function gridLines(bays: readonly number[]): number[] {
  const out = [0];
  for (const b of bays) out.push(out[out.length - 1]! + b);
  return out;
}

export interface Purlin { in: number; height: number }
export interface Profile { ridge: number; purlins: Purlin[] }

/**
 * Where one side's purlins stand, in plan m in from the eave purlin (Scope: "purlins sit at the bay frame's purlin
 * spacing"): each depth bay is split into `perBay` equal spacings from the front, and a side runs from the eave purlin
 * (0 m in) up to the ridge, which stands over the middle of the depth. The ridge is left out.
 */
export function purlinsIn(depthBays: readonly number[], perBay: number): { ins: number[]; half: number } {
  const half = gridLines(depthBays)[depthBays.length]! / 2;
  const ins: number[] = [];
  let from = 0;
  for (const bay of depthBays) {
    for (let k = 0; k < perBay; k++) {
      const x = from + (bay * k) / perBay;
      if (x < half - 1e-9) ins.push(x);
    }
    from += bay;
  }
  return { ins, half };
}

/**
 * The folding rule (Scope, `profile: folded`), heights above the eave purlin. With the eave purlin at (0, 0), the
 * ridge at (x_n, H), H = raise × depth, and the purlins between at x_1 < … < x_(n−1):
 *   - "the one below the ridge is lowered from the straight line between the ridge and the eave purlin by a tenth of
 *     the raise": h_(n−1) = H × x_(n−1) ÷ x_n − H ÷ 10;
 *   - "each next one down is lowered from the straight line between the purlin above it and the eave purlin by half
 *     the previous drop": h_k = h_(k+1) × x_k ÷ x_(k+1) − (H ÷ 10) ÷ 2^(n−1−k).
 * Dividing by x_k and summing gives the closed form this returns:
 *   h_k = x_k × (H ÷ x_n − (H ÷ 10) × Σ_(m = k … n−1) 1 ÷ (x_m × 2^(n−1−m))).
 * On the 8 m deep frame with a 1 m spacing and raise 1/3: H = 2.6667, and 1.7333, 1.0222 and 0.4444 m at 3, 2 and 1 m in.
 */
export function foldedProfile(raise: number, depthBays: readonly number[], perBay: number): Profile {
  const { ins, half } = purlinsIn(depthBays, perBay);
  const depth = 2 * half;
  const ridge = raise * depth;
  const n = ins.length;
  const purlins = ins.map((x, k): Purlin => {
    if (k === 0) return { in: x, height: 0 };
    let drops = 0;
    for (let m = k; m <= n - 1; m++) drops += 1 / (ins[m]! * 2 ** (n - 1 - m));
    return { in: x, height: x * (ridge / half - (ridge / 10) * drops) };
  });
  return { ridge, purlins };
}
/** The straight profile: each purlin on the line between the eave purlin and the ridge. */
export function straightProfile(raise: number, depthBays: readonly number[], perBay: number): Profile {
  const { ins, half } = purlinsIn(depthBays, perBay);
  const ridge = raise * 2 * half;
  return { ridge, purlins: ins.map((x) => ({ in: x, height: (ridge * x) / half })) };
}
/** Criterion 2's roof by the rule, and the straight roof its planted twin builds. */
export const FOLDED = foldedProfile(RAISE, DEPTH_BAYS, PURLINS_PER_BAY);
export const STRAIGHT = straightProfile(RAISE, DEPTH_BAYS, PURLINS_PER_BAY);

/** A bracket set's totals (Scope: "up to four steps, each reaching out by `reach`"; Fields: reach and height per step). */
export const bracketTotals = (steps: number, reach: number, height: number): { reach: number; height: number } => ({ reach: steps * reach, height: steps * height });
export const TOTALS = bracketTotals(STEPS, STEP_REACH, STEP_HEIGHT);
/** `eave_reach`'s default (Scope): "the brackets' total reach plus the rafter overhang". */
export const EAVE_REACH = TOTALS.reach + OVERHANG;

// ---------------------------------------------------------------------------------------------------
// Documents (README: The documents). Metres, +Y up. A hall is a bay frame, the bracket sets that name it and the roof
// that names it; the brackets and the roof are the frame's children, so the three build in one space, the frame's.

/** A scene in the agent's form: each item given its ID, name and order key, in the order listed. */
export function scene(title: string, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const out: JsonObject = {};
  let k = 0;
  for (const [id, item] of Object.entries(items)) out[id] = { id, name: id, order: `a${String(k++).padStart(4, '0')}`, ...item };
  return {
    format: 1, profile: 'scene', title, description: `${title}: a #1219 acceptance fixture.`, size: [640, 480],
    requires: { modules: { scene3d: '^1', building: '^1' } }, ...extra, items: out,
  };
}

export interface FrameOptions { bays?: readonly number[]; omit?: readonly [number, number][]; at?: V3 }
export const frameItem = (o: FrameOptions = {}): JsonObject => ({
  kind: 'arch.bay_frame@1',
  params: {
    bays: [...(o.bays ?? BAYS)], depth_bays: [...DEPTH_BAYS], eave_height: EAVE_HEIGHT, column: { diameter: COLUMN_DIAMETER }, purlins_per_bay: PURLINS_PER_BAY,
    ...(o.omit ? { omit: o.omit.map((p) => [...p]) } : {}),
  },
  ...(o.at ? { at: { pos: [...o.at] } } : {}),
});
export const bracketItem = (frame: string, on: 'column' | 'between'): JsonObject =>
  ({ kind: 'arch.bracket@1', parent: frame, params: { on, frame, steps: STEPS, reach: STEP_REACH, height: STEP_HEIGHT } });
export const roofItem = (frame: string, type: RoofType, profile: 'folded' | 'straight' = 'folded'): JsonObject => ({
  kind: 'arch.roof@1', parent: frame,
  params: { type, frame, raise: RAISE, profile, corner_rise: CORNER_RISE, corner_reach: CORNER_REACH, overhang: OVERHANG },
});

export interface HallOptions extends FrameOptions { type?: RoofType; profile?: 'folded' | 'straight'; prefix?: string }
/** A whole hall's items: its frame, a bracket set on every column head and one between columns, and its roof. */
export function hallItems(o: HallOptions = {}): Record<string, JsonObject> {
  const id = (name: string): string => `${o.prefix ?? ''}${name}`;
  return {
    [id(FRAME)]: frameItem(o), [id(BRACKETS)]: bracketItem(id(FRAME), 'column'), [id(BETWEEN)]: bracketItem(id(FRAME), 'between'),
    [id(ROOF)]: roofItem(id(FRAME), o.type ?? 'hip_ridge', o.profile),
  };
}

/** Criterion 1: the seven-bay frame alone, whole or with `omit`. */
export const frameDoc = (omit?: readonly [number, number][]): JsonObject =>
  scene(omit ? 'A seven-bay frame less one column' : 'A seven-bay frame', { [FRAME]: frameItem(omit ? { omit } : {}) });
/** Criteria 2 and 3: the frame and a folded `hip_ridge` roof with rising corners on it, with no bracket set. */
export const roofDoc = (): JsonObject => scene('A folded hip-and-ridge roof on a bay frame', { [FRAME]: frameItem(), [ROOF]: roofItem(FRAME, 'hip_ridge') });
/** Criterion 4: the frame, a two-step bracket set on its column heads, and the roof they carry, with no `eave_reach`. */
export const bracketDoc = (): JsonObject =>
  scene('A bracket set under a roof', { [FRAME]: frameItem(), [BRACKETS]: bracketItem(FRAME, 'column'), [ROOF]: roofItem(FRAME, 'hip_ridge') });
/** Criterion 5: the whole hall under one of the other roof types; with `probe`, a 0.6 m box centred there. */
export function hallDoc(type: RoofType, probe?: V3): JsonObject {
  const box: Record<string, JsonObject> = probe ? { [PROBE]: { kind: 'mark.box@1', params: { size: [0.6, 0.6, 0.6] }, at: { pos: [...probe] } } } : {};
  return scene(`A timber hall under a ${type} roof${probe ? ', and a box in its ridge' : ''}`, { ...hallItems({ type }), ...box });
}
/** Criterion 6: two whole halls, `b` 20 m behind `a`; `aMiddleBay` is hall a's middle bay, 4.6 m as written. */
export const HALL_A = [`a-${FRAME}`, `a-${BRACKETS}`, `a-${BETWEEN}`, `a-${ROOF}`] as const;
export const HALL_B = [`b-${FRAME}`, `b-${BRACKETS}`, `b-${BETWEEN}`, `b-${ROOF}`] as const;
export const MIDDLE_BAY_PATH = `items/a-${FRAME}/params/bays/3`;
export function twoHallsDoc(aMiddleBay: number = BAYS[3]!): JsonObject {
  const bays = BAYS.map((b, i) => (i === 3 ? aMiddleBay : b));
  return scene('Two timber halls, one behind the other', { ...hallItems({ prefix: 'a-', bays }), ...hallItems({ prefix: 'b-', at: [0, 0, 20] }) });
}

/** The check inputs of a hall's claim: every kind rule, and the geometry audit at rest with the frame, which stands on the ground, declared floating. */
export const RULES_CHECK: JsonObject = { kind: 'kind_rules' };
export const auditCheck = (floating: readonly string[]): JsonObject => ({ kind: 'geometry.audit', scope: 'scene', states: ['rest'], support: { floating: [...floating] } });

// ---------------------------------------------------------------------------------------------------
// Criterion 7's pictures (README: The taste call): session-form scenes for `view3d`, each a whole hall under a day sky.

export type Size = [number, number];
/** The reference window (technical design, Decided: The reference window): 1512 × 982 points at 2×, in px. */
export const REFERENCE_WINDOW: Size = [2 * 1512, 2 * 982];

const FONTS: JsonObject = {
  body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
};
const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
/** The look the pictures draw in (#2017's filmic look's shape): a physical-basis `look@1`, the filmic tone map, no finish, bloom, ao or 3D ground. */
export const LOOK: JsonObject = {
  id: 'filmic-1219', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'The #1219 acceptance look.',
  palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', white: '#ffffff' },
  roles: { ground: 'night', ink: 'graphite', muted: 'slate' },
  themes: { light: {}, dark: {} }, fonts: FONTS,
  status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
  attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
  tone_map: 'filmic', exposure: 0, finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' },
};

/** A scene document as a `view3d` session holds it (#378): every item in the one writer layer `main`, camera `cam`. */
function sessionDoc(id: string, items: Record<string, JsonObject>): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(4, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #1219 acceptance picture.`, size: [...REFERENCE_WINDOW], camera: 'cam', seed: 1219,
    requires: { modules: { scene3d: '^1', building: '^1' } }, budget: { class: 'work_product' },
    layers: { main: { writer: 'agent:alpha', title: 'Main', order: 'a0' } }, items: withIds,
  };
}
const camera = (position: V3, target: V3, fov: number): JsonObject => ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov, near: 0.1, far: 500 } });
const material = (base: V3, roughness: number, pattern?: string): JsonObject => ({ kind: 'material@1', params: { base_color: [...base, 1], roughness, metallic: 0, ...(pattern ? { pattern } : {}) } });
/** A day sky, a shadowed sun from over the camera's shoulder, a stone ground, timber for frames and brackets, and tiles for roofs. */
const set = (ground: { size: [number, number]; pos: V3 }): Record<string, JsonObject> => ({
  sky: { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.6, 0.7, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } },
  sun: { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: true }, at: { rot: [-40, 205, 0] } },
  timber: material([0.42, 0.13, 0.09], 0.7, 'wood'), tiles: material([0.26, 0.3, 0.3], 0.6, 'roof_tiles'), stone: material([0.6, 0.58, 0.54], 0.9),
  ground: { kind: 'plate@1', params: { grid: [1, 1], size: ground.size }, at: { pos: ground.pos }, material: 'stone' },
});
/** A hall's items dressed for a picture: timber on its frame and brackets, and on its roof a material whose pattern is `roof_tiles`. */
function dressed(o: Parameters<typeof hallItems>[0]): Record<string, JsonObject> {
  const roof = `${o?.prefix ?? ''}${ROOF}`;
  return Object.fromEntries(Object.entries(hallItems(o)).map(([id, item]) => [id, { ...item, material: id === roof ? 'tiles' : 'timber' }]));
}
/** A seven-bay hall under one roof type, seen from in front of its left end. */
export const hallPicture = (type: RoofType): JsonObject =>
  sessionDoc(`hall-${type}`, { cam: camera([-10, 11, -30], [14.9, 3.5, 4], 50), ...set({ size: [70, 50], pos: [14.9, 0, 4] }), ...dressed({ type }) });
/** The folded profile beside a straight one: two `hip_ridge` halls, the straight one 14 m behind the folded, seen from the end along their ridges. */
export const profilesPicture = (): JsonObject => sessionDoc('folded-beside-straight', {
  cam: camera([-32, 6.5, 11], [0, 5, 11], 50), ...set({ size: [80, 60], pos: [14.9, 0, 11] }),
  ...dressed({ prefix: 'folded-', profile: 'folded' }), ...dressed({ prefix: 'straight-', profile: 'straight', at: [0, 0, 14] }),
});

// ---------------------------------------------------------------------------------------------------
// Criterion 1's judge: columns on their grid

/** One column as the frame's build answers it: its grid point [i, j], its center in plan [x, z] and its head's height. */
export interface Column { at: [number, number]; center: [number, number]; head: number }
export interface FrameSpec { bays: readonly number[]; depthBays: readonly number[]; omit: readonly [number, number][] }
export const FRAME_SPEC: FrameSpec = { bays: BAYS, depthBays: DEPTH_BAYS, omit: [] };

/**
 * Why `columns` aren't the frame's grid less `omit`: a grid point with no column or with two, a column on a point
 * `omit` names or off the grid, or a column more than 1e-6 m from its grid point. Across, a grid point's x is absolute
 * (the criterion's 0 … 29.8 m). Front to back the grid is held from the front row: row j stands the depth lines' sum
 * from row 0, every row on the same side of it, so the judge reads no sign for "back". Failures come in grid order,
 * the front row first, and each names its column's grid point and that point's x.
 */
export function columnFailures(spec: FrameSpec, columns: readonly Column[], tol = GRID_TOL): string[] {
  const xs = gridLines(spec.bays), depths = gridLines(spec.depthBays);
  const omitted = (i: number, j: number): boolean => spec.omit.some((p) => p[0] === i && p[1] === j);
  const want = (xs.length * depths.length) - spec.omit.length;
  const out: string[] = [];
  if (columns.length !== want) out.push(`the frame stands ${columns.length} columns, not ${want}`);
  const by = new Map<string, Column[]>();
  for (const c of columns) by.set(`${c.at[0]},${c.at[1]}`, [...(by.get(`${c.at[0]},${c.at[1]}`) ?? []), c]);
  for (const [key, list] of by) {
    const [i, j] = key.split(',').map(Number) as [number, number];
    if (!(i >= 0 && i < xs.length && j >= 0 && j < depths.length)) out.push(`a column stands on [${i}, ${j}], which is no point of the grid`);
    else if (omitted(i, j)) out.push(`a column stands on [${i}, ${j}] (x ${plain(xs[i]!)} m), the grid point omit names`);
    if (list.length > 1) out.push(`${list.length} columns stand on grid point [${i}, ${j}]`);
  }
  const front = columns.filter((c) => c.at[1] === 0).sort((a, b) => a.at[0] - b.at[0])[0];
  if (!front) return [...out, 'the front row (j = 0) stands no column'];
  const z0 = front.center[1];
  const back = columns.find((c) => c.at[1] > 0 && Math.abs(c.center[1] - z0) > tol);
  const side = back && back.center[1] < z0 ? -1 : 1;
  for (let j = 0; j < depths.length; j++) for (let i = 0; i < xs.length; i++) {
    if (omitted(i, j)) continue;
    const c = by.get(`${i},${j}`)?.[0];
    if (!c) { out.push(`no column stands on grid point [${i}, ${j}] (x ${plain(xs[i]!)} m)`); continue; }
    const off = Math.hypot(c.center[0] - xs[i]!, c.center[1] - (z0 + side * depths[j]!));
    if (!(off <= tol)) out.push(`column [${i}, ${j}], whose grid point is at x ${plain(xs[i]!)} m, ${plain(depths[j]!)} m back, stands at x ${plain(c.center[0])} m, ${plain(Math.abs(c.center[1] - z0))} m back: ${m4(off)} m off its grid point, past ${tol} m`);
  }
  return out;
}

/** A planted set for the column judge: the columns a frame stands when its grid lines across are `xs` (depth along `side` z). */
export function columnsAt(xs: readonly number[], spec: FrameSpec, side: 1 | -1 = 1): Column[] {
  const depths = gridLines(spec.depthBays);
  const out: Column[] = [];
  for (let j = 0; j < depths.length; j++) for (let i = 0; i < xs.length; i++) {
    if (!spec.omit.some((p) => p[0] === i && p[1] === j)) out.push({ at: [i, j], center: [xs[i]!, side * depths[j]!], head: EAVE_HEIGHT });
  }
  return out;
}
/** The planted frame's lines across: every bay as wide as the first of `bays`. */
export const evenLines = (bays: readonly number[]): number[] => bays.map((_, i) => i * bays[0]!).concat(bays.length * bays[0]!);

// ---------------------------------------------------------------------------------------------------
// Criterion 2's judge: the ridge and each purlin against the folding rule

/**
 * Why a roof's outputs aren't `want` (heights above the eave purlin): another count of purlins a side, no eave purlin
 * (the one 0 m in), a ridge that isn't `want.ridge` above it, or a purlin that isn't the rule's height above it,
 * within 1e-4 m. `got`'s heights are in the frame's space; the judge takes them above the eave purlin's. Failures run
 * from the ridge down, as the rule does, and each names its purlin's place in from the eave and its difference.
 */
export function profileFailures(want: Profile, got: Profile, tol = FOLD_TOL): string[] {
  const out: string[] = [];
  if (got.purlins.length !== want.purlins.length) out.push(`the roof answers ${got.purlins.length} purlins a side, not ${want.purlins.length}`);
  const at = (x: number): Purlin | undefined => got.purlins.find((p) => Math.abs(p.in - x) <= GRID_TOL);
  const eave = at(0);
  if (!eave) return [...out, `no purlin stands 0 m in: the roof answers no eave purlin (its purlins are ${got.purlins.map((p) => `${plain(p.in)} m in`).join(', ') || 'none'})`];
  const ridge = got.ridge - eave.height;
  if (!(Math.abs(ridge - want.ridge) <= tol)) out.push(`the ridge is ${m4(ridge)} m above the eave purlin, ${m4(Math.abs(ridge - want.ridge))} m off raise × depth = ${m4(want.ridge)} m`);
  for (const p of [...want.purlins].reverse()) {
    if (p.in === 0) continue;
    const found = at(p.in);
    if (!found) { out.push(`no purlin stands ${plain(p.in)} m in from the eave`); continue; }
    const h = found.height - eave.height;
    if (!(Math.abs(h - p.height) <= tol)) out.push(`the purlin ${plain(p.in)} m in from the eave is ${m4(h)} m above the eave purlin, ${m4(Math.abs(h - p.height))} m off the folding rule's ${m4(p.height)} m`);
  }
  return out;
}
/** A planted set for the profile judge: `profile` as a roof whose eave purlin sits at `base` answers it. */
export const lifted = (profile: Profile, base: number): Profile => ({ ridge: profile.ridge + base, purlins: profile.purlins.map((p) => ({ in: p.in, height: p.height + base })) });

// ---------------------------------------------------------------------------------------------------
// Criterion 3's judge: the eave line toward each corner

/**
 * One eave of the eave line read toward one of its two corners: its level height (the eave's middle), how far its
 * height is from level anywhere more than the reach from the corner, its rise at the corner, its rise at the 50
 * samples, and the first sample that is lower than the one before it.
 */
export interface Approach { eave: string; corner: string; level: number; beyond: number; atCorner: number; samples: number[]; fall: number | null }
/** Sample k of the reach (k = 0 … 49): `reach × (49 − k) ÷ 49` m from the corner along the eave, so sample 0 is where the rise starts and sample 49 the corner. */
export const sampleFromCorner = (k: number, reach: number): number => (reach * (SAMPLES - 1 - k)) / (SAMPLES - 1);

/**
 * The eave line of a hipped roof, read eave by eave. The line is the points `[x, y, z]` around the roof's eave edge; in
 * plan it is a rectangle, so each of the four eaves is the points on one side of the line's own plan bounds, and its two
 * ends are corners. A height between two points is read along the straight line between them. `problems` says why the
 * line can't be read so: fewer than four points, an eave that doesn't run corner to corner, or one too short to hold a
 * level stretch between two reaches.
 */
export function eaveApproaches(line: readonly V3[], reach: number): { approaches: Approach[]; problems: string[] } {
  if (line.length < 4) return { approaches: [], problems: [`the eave line holds ${line.length} points: no line around a roof`] };
  const xs = line.map((p) => p[0]), zs = line.map((p) => p[2]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const sides: { name: string; on: (p: V3) => boolean; along: 0 | 2; lo: number; hi: number }[] = [
    { name: `the eave along z = ${plain(z0)}`, on: (p) => Math.abs(p[2] - z0) <= GRID_TOL, along: 0, lo: x0, hi: x1 },
    { name: `the eave along z = ${plain(z1)}`, on: (p) => Math.abs(p[2] - z1) <= GRID_TOL, along: 0, lo: x0, hi: x1 },
    { name: `the eave along x = ${plain(x0)}`, on: (p) => Math.abs(p[0] - x0) <= GRID_TOL, along: 2, lo: z0, hi: z1 },
    { name: `the eave along x = ${plain(x1)}`, on: (p) => Math.abs(p[0] - x1) <= GRID_TOL, along: 2, lo: z0, hi: z1 },
  ];
  const approaches: Approach[] = [], problems: string[] = [];
  for (const side of sides) {
    const pts = line.filter(side.on).map((p): [number, number] => [p[side.along], p[1]]).sort((a, b) => a[0] - b[0]);
    const length = side.hi - side.lo;
    if (pts.length < 2 || Math.abs(pts[0]![0] - side.lo) > GRID_TOL || Math.abs(pts[pts.length - 1]![0] - side.hi) > GRID_TOL) {
      problems.push(`${side.name} doesn't run from corner to corner: ${pts.length} of the line's points lie on it`);
      continue;
    }
    if (!(length > 2 * reach)) { problems.push(`${side.name} is ${m4(length)} m long: too short to be level between two reaches of ${reach} m`); continue; }
    const heightAt = (s: number): number => {
      const c = Math.min(Math.max(s, side.lo), side.hi);
      let k = 0;
      while (k < pts.length - 2 && pts[k + 1]![0] < c) k++;
      const [a, b] = [pts[k]!, pts[k + 1]!];
      return b[0] === a[0] ? Math.max(a[1], b[1]) : a[1] + ((b[1] - a[1]) * (c - a[0])) / (b[0] - a[0]);
    };
    const level = heightAt((side.lo + side.hi) / 2);
    const axis = side.along === 0 ? 'x' : 'z';
    for (const [corner, from, dir] of [[`its ${axis} = ${plain(side.lo)} corner`, side.lo, 1], [`its ${axis} = ${plain(side.hi)} corner`, side.hi, -1]] as const) {
      const at = (d: number): number => heightAt(from + dir * d) - level;
      // "Level more than 3 m from a corner": every point of the eave in that stretch, and 50 heights read across it.
      const stretch = [...pts.map((p) => Math.abs(p[0] - from)).filter((d) => d > reach + 1e-9 && d <= length / 2), ...Array.from({ length: SAMPLES }, (_, j) => reach + ((length / 2 - reach) * (j + 1)) / SAMPLES)];
      const samples = Array.from({ length: SAMPLES }, (_, k) => at(sampleFromCorner(k, reach)));
      const fall = samples.findIndex((y, k) => k > 0 && y < samples[k - 1]! - 1e-9);
      approaches.push({ eave: side.name, corner, level, beyond: Math.max(...stretch.map((d) => Math.abs(at(d)))), atCorner: at(0), samples, fall: fall < 0 ? null : fall });
    }
  }
  return { approaches, problems };
}

/**
 * Why the eave line isn't level more than `reach` from each corner, doesn't rise `rise` at each corner within 1e-4 m,
 * or doesn't rise monotonically toward it at the 50 samples. Each failure names its eave and corner; a rise that falls
 * back names the first sample lower than the one before it.
 */
export function eaveFailures(line: readonly V3[], rise: number, reach: number, tol = EAVE_TOL): string[] {
  const { approaches, problems } = eaveApproaches(line, reach);
  const out = [...problems];
  if (!problems.length && approaches.length !== 8) out.push(`the eave line has ${approaches.length} corner approaches, not a hipped roof's eight`);
  for (const a of approaches) {
    const where = `${a.eave}, toward ${a.corner}`;
    if (!(a.beyond <= tol)) out.push(`${where}: the eave line is ${m4(a.beyond)} m off level more than ${reach} m from the corner`);
    if (!(Math.abs(a.atCorner - rise) <= tol)) out.push(`${where}: the eave line rises ${m4(a.atCorner)} m at the corner, not ${m4(rise)} m`);
    if (a.fall !== null) out.push(`${where}: sample ${a.fall} of ${SAMPLES} (${m4(sampleFromCorner(a.fall, reach))} m from the corner) is ${m4(a.samples[a.fall]!)} m up, under sample ${a.fall - 1}'s ${m4(a.samples[a.fall - 1]!)} m: the rise falls back`);
  }
  return out;
}
/** The first falling sample of each corner approach whose rise falls back. */
export const fallingSamples = (line: readonly V3[], reach: number): number[] => eaveApproaches(line, reach).approaches.flatMap((a) => (a.fall === null ? [] : [a.fall]));

/** The cubic ease in and out, the look's default `time.state.interp` (Look `look@1`); one of the eases the planted sets rise along. */
export const inOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** The planted program's rise from the shipped one, `ease`: as shipped over the first four fifths of the reach, then straight back to level at the corner. */
export const fallsBack = (ease: (t: number) => number) => (t: number): number => (t <= 0.8 ? ease(t) : (ease(0.8) * (1 - t)) / 0.2);
/**
 * A planted set for the eave judge: the eave line of a roof whose eave edge is the plan rectangle `box` at height
 * `level`, rising toward each corner over `reach` by `rise × shape(t)`, t running from 0 where the rise starts to 1 at
 * the corner. Each eave holds its two corners and the 50 samples of each reach.
 */
export function eaveLoop(box: { x0: number; x1: number; z0: number; z1: number }, level: number, rise: number, reach: number, shape: (t: number) => number): V3[] {
  const along = (length: number): [number, number][] => {
    const d = Array.from({ length: SAMPLES }, (_, k) => sampleFromCorner(k, reach));
    const s = [...new Set([...d, ...d.map((x) => length - x)])].sort((a, b) => a - b);
    return s.map((x) => { const near = Math.min(x, length - x); return [x, level + (near < reach ? rise * shape(1 - near / reach) : 0)]; });
  };
  const [w, h] = [box.x1 - box.x0, box.z1 - box.z0];
  return [
    ...along(w).map(([s, y]): V3 => [box.x0 + s, y, box.z0]), ...along(h).map(([s, y]): V3 => [box.x1, y, box.z0 + s]),
    ...along(w).map(([s, y]): V3 => [box.x1 - s, y, box.z1]), ...along(h).map(([s, y]): V3 => [box.x0, y, box.z1 - s]),
  ];
}

// ---------------------------------------------------------------------------------------------------
// Criterion 4's judges: the bracket set, the eave purlin it carries, and how far the eave projects

export interface BracketReading { id: string; totalReach: number; totalHeight: number; top: number; heads: number[]; eavePurlin: number }
/**
 * Why a bracket set doesn't reach and rise `want`, the eave purlin it carries doesn't sit `want.height` above the
 * column head, or the set's top doesn't meet that purlin, each within 1 mm. `top` is the highest point of the set's
 * mesh, `heads` the heights of the front row's column heads and `eavePurlin` the height of the roof's purlin 0 m in.
 */
export function bracketFailures(got: BracketReading, want: { reach: number; height: number }, tol = BRACKET_TOL): string[] {
  const out: string[] = [];
  if (!(Math.abs(got.totalReach - want.reach) <= tol)) out.push(`${got.id} answers total_reach ${m4(got.totalReach)} m, not ${m4(want.reach)} m`);
  if (!(Math.abs(got.totalHeight - want.height) <= tol)) out.push(`${got.id} answers total_height ${m4(got.totalHeight)} m, not ${m4(want.height)} m`);
  if (!got.heads.length) return [...out, 'the front row has no column head to measure from'];
  const head = Math.min(...got.heads);
  if (!(Math.max(...got.heads) - head <= tol)) out.push(`the front row's column heads stand between ${m4(head)} and ${m4(Math.max(...got.heads))} m: not one height`);
  const sits = got.eavePurlin - head;
  if (!(Math.abs(sits - want.height) <= tol)) out.push(`the eave purlin sits ${m4(sits)} m above the column head, not ${m4(want.height)} m`);
  const miss = got.eavePurlin - got.top;
  if (!(Math.abs(miss) <= tol)) out.push(`${got.id}'s top is ${m4(Math.abs(miss))} m ${miss > 0 ? 'under' : 'over'} the eave purlin it carries, past ${tol} m`);
  return out;
}

/**
 * Why the eave doesn't project `want` past the column line within 1 mm: on each of its four sides, how far the eave
 * line's plan bounds lie outside the bounds of the columns' centers.
 */
export function eaveReachFailures(line: readonly V3[], columns: readonly Column[], want: number, tol = BRACKET_TOL): string[] {
  if (!line.length || !columns.length) return [`there is no eave line (${line.length} points) or no column (${columns.length}) to measure between`];
  const ext = (v: number[]): [number, number] => [Math.min(...v), Math.max(...v)];
  const [ex, ez] = [ext(line.map((p) => p[0])), ext(line.map((p) => p[2]))];
  const [cx, cz] = [ext(columns.map((c) => c.center[0])), ext(columns.map((c) => c.center[1]))];
  const sides: [string, number][] = [[`x = ${plain(cx[0])}`, cx[0] - ex[0]], [`x = ${plain(cx[1])}`, ex[1] - cx[1]], [`z = ${plain(cz[0])}`, cz[0] - ez[0]], [`z = ${plain(cz[1])}`, ez[1] - cz[1]]];
  return sides.filter(([, d]) => !(Math.abs(d - want) <= tol)).map(([name, d]) => `the eave projects ${m4(d)} m past the column line ${name}, not ${m4(want)} m`);
}

// ---------------------------------------------------------------------------------------------------
// A verdict's requirement rows: the kind rules' and the geometry audit's (README: The kind rules; The geometry audit)

export interface Issue { code: string; severity: string; ids: string[]; actual: JsonObject; raw: JsonObject }
/** One rule run on one item, as the `kind_rules` row lists it. */
export interface RuleRun { item: string; rule: string; holds: boolean }
export interface Row { result: string; issues: Issue[]; runs: RuleRun[] | null; raw: JsonObject }

/** The row of requirement `req` in a verdict, or null. `ids` read with any sub-address `<id>#<part>` as `<id>`; `runs` is null when the row carries no `results` list. */
export function rowOf(verdict: JsonObject, req: string): Row | null {
  const rows = Array.isArray(verdict['requirements']) ? verdict['requirements'].filter(isObject) : [];
  const raw = rows.find((r) => r['id'] === req);
  if (!raw) return null;
  const issues = (Array.isArray(raw['issues']) ? raw['issues'].filter(isObject) : []).map((o): Issue => ({
    code: String(o['code']), severity: String(o['severity']),
    ids: [...new Set((Array.isArray(o['ids']) ? o['ids'] : []).filter((x): x is string => typeof x === 'string').map((s) => s.split('#')[0]!))].sort(),
    actual: isObject(o['actual']) ? o['actual'] : {}, raw: o,
  }));
  const runs = Array.isArray(raw['results'])
    ? raw['results'].filter(isObject).filter((r) => typeof r['item'] === 'string' && typeof r['rule'] === 'string' && typeof r['holds'] === 'boolean')
      .map((r): RuleRun => ({ item: r['item'] as string, rule: r['rule'] as string, holds: r['holds'] as boolean }))
    : null;
  return { result: String(raw['result']), issues, runs, raw };
}

/**
 * Why a `kind_rules` row doesn't show that every rule of `expected` ran on its item and holds: a result other than
 * PASS, no list of rule runs, a rule that didn't run on its item, a run that doesn't hold, or an issue one of this
 * suite's rules raised.
 */
export function ruleFailures(row: Row | null, expected: readonly (readonly [item: string, rule: string])[]): string[] {
  if (!row) return ['the verdict has no row for the kind_rules requirement'];
  const out: string[] = [];
  if (row.result !== 'PASS') out.push(`the kind_rules requirement is ${row.result}, not PASS: ${brief(row.raw, 1200)}`);
  if (!row.runs) return [...out, 'the kind_rules row lists no rule runs (`results`), so nothing shows a rule ran'];
  for (const [item, rule] of expected) {
    const runs = row.runs.filter((r) => r.item === item && r.rule === rule);
    if (!runs.length) out.push(`${rule} didn't run on ${item}; the runs: ${row.runs.map((r) => `${r.rule} on ${r.item}`).join(', ') || 'none'}`);
  }
  for (const r of row.runs.filter((x) => !x.holds)) out.push(`${r.rule} doesn't hold on ${r.item}`);
  for (const i of row.issues.filter((x) => RULE_CODES.includes(x.code))) out.push(`${i.code} is raised on ${i.ids.join(', ') || 'no item'}: ${brief(i.raw, 600)}`);
  return out;
}
/** The issue a failed rule raised on an item: its `code` the rule's, its `ids` holding the item. */
export const ruleIssue = (row: Row | null, rule: string, item: string): Issue | undefined => row?.issues.find((i) => i.code === rule && i.ids.includes(item));
/** Why a `kind_rules` row doesn't show `rule` failing on `item`: a result other than FAIL, no run of it there that doesn't hold, or no issue of it naming the item. */
export function ruleBreakFailures(row: Row | null, rule: string, item: string): string[] {
  if (!row) return ['the verdict has no row for the kind_rules requirement'];
  const out: string[] = [];
  if (row.result !== 'FAIL') out.push(`the kind_rules requirement is ${row.result}, not FAIL: ${brief(row.raw, 1200)}`);
  if (!row.runs?.some((r) => r.item === item && r.rule === rule && !r.holds)) out.push(`no run of ${rule} on ${item} that doesn't hold is listed; the runs: ${row.runs?.map((r) => `${r.rule} on ${r.item}: ${r.holds ? 'holds' : 'fails'}`).join(', ') ?? 'no list'}`);
  if (!ruleIssue(row, rule, item)) out.push(`no ${rule} issue names ${item}; the issues: ${brief(row.issues.map((i) => i.raw), 1200)}`);
  return out;
}
/** Whether a column rule's issue names the column on grid line `i` across whose grid point is at `x`: `actual.column: [i, j]`, `actual.at: [x, y]`. */
export function namesColumn(issue: Issue | undefined, i: number, x: number): boolean {
  const [column, at] = [issue?.actual['column'], issue?.actual['at']];
  return Array.isArray(column) && column[0] === i && Array.isArray(at) && isNum(at[0]) && Math.abs(at[0] - x) <= GRID_TOL;
}
/** Whether a folding rule's issue names the purlin `inFromEave` m in and a difference of `difference` m within 1e-4 m: `actual.in`, `actual.difference`. */
export function namesPurlin(issue: Issue | undefined, inFromEave: number, difference: number): boolean {
  const [at, d] = [issue?.actual['in'], issue?.actual['difference']];
  return isNum(at) && Math.abs(at - inFromEave) <= GRID_TOL && isNum(d) && Math.abs(Math.abs(d) - difference) <= FOLD_TOL;
}
/** The sample an eave rule's issue names: `actual.sample`, a whole number from 0 to 49, or null. */
export function sampleNamed(issue: Issue | undefined): number | null {
  const k = issue?.actual['sample'];
  return isNum(k) && Number.isInteger(k) && k >= 0 && k < SAMPLES ? k : null;
}

/** The issues that count against a check: errors and warnings. */
const raised = (row: Row): Issue[] => row.issues.filter((i) => i.severity === 'error' || i.severity === 'warning');
/** Why a geometry audit's row isn't a pass with nothing raised. */
export function auditPassFailures(row: Row | null): string[] {
  if (!row) return ['the verdict has no row for the geometry.audit requirement'];
  return [
    ...(row.result === 'PASS' ? [] : [`the geometry audit is ${row.result}, not PASS: ${brief(row.raw, 1200)}`]),
    ...raised(row).map((i) => `the geometry audit raises ${i.code} on ${i.ids.join(' and ') || 'no part'}: ${brief(i.raw, 600)}`),
  ];
}
/** Why a geometry audit's row doesn't show the audit reading `a`'s true shape: it isn't FAIL, or no overlap names exactly `a` and `b`. */
export function auditOverlapFailures(row: Row | null, a: string, b: string): string[] {
  if (!row) return ['the verdict has no row for the geometry.audit requirement'];
  const pair = [a, b].sort().join(' and ');
  const found = raised(row).some((i) => i.code === 'geometry.overlap' && i.ids.join(' and ') === pair);
  return [
    ...(row.result === 'FAIL' ? [] : [`the geometry audit is ${row.result}, not FAIL: ${brief(row.raw, 1200)}`]),
    ...(found ? [] : [`no geometry.overlap names ${pair}; raised: ${raised(row).map((i) => `${i.code} on ${i.ids.join(' and ')}`).join('; ') || 'nothing'}`]),
  ];
}

// ---------------------------------------------------------------------------------------------------
// Criterion 6's judge: what a change rebuilds, by content key

/** One node of a frame (#387's `eval`): its operator, its item, its content key and how its result was had. */
export interface Node { operator: string; item: string | null; key: string; run: string }
/** A building kind's build operator at the base. */
export const BUILD = 'building.build';

/**
 * Why the frame after a change doesn't rebuild exactly `changed`: an item of `changed` or `untouched` with no build
 * node before the change (nothing was built, so nothing can show); an item of `changed` whose build node didn't run or
 * kept its key; an item of `untouched` whose build node's key moved or any of whose nodes ran; or a build node that ran
 * on an item outside `changed`.
 */
export function rebuildFailures(before: readonly Node[], after: readonly Node[], changed: readonly string[], untouched: readonly string[]): string[] {
  const build = (nodes: readonly Node[], item: string): Node | undefined => nodes.find((n) => n.operator === BUILD && n.item === item);
  const out: string[] = [];
  for (const id of [...changed, ...untouched]) {
    const [b, a] = [build(before, id), build(after, id)];
    if (!b) { out.push(`${id} has no ${BUILD} node before the change: nothing was built`); continue; }
    if (!a) { out.push(`${id} has no ${BUILD} node after the change`); continue; }
    if (changed.includes(id)) {
      if (a.run !== 'ran') out.push(`${id} didn't rebuild: its ${BUILD} node is ${a.run} after the change`);
      if (a.key === b.key) out.push(`${id}'s ${BUILD} node kept its content key ${a.key} across the change`);
    } else {
      if (a.key !== b.key) out.push(`${id}'s ${BUILD} node's content key moved from ${b.key} to ${a.key}, though nothing it reads changed`);
      for (const n of after.filter((x) => x.item === id && x.run === 'ran')) out.push(`${id} reran ${n.operator}, though nothing it reads changed`);
    }
  }
  const rebuilt = after.filter((n) => n.operator === BUILD && n.run === 'ran').map((n) => String(n.item)).sort();
  if (rebuilt.join(',') !== [...changed].sort().join(',')) out.push(`the change rebuilt ${rebuilt.join(', ') || 'nothing'}, not exactly ${[...changed].sort().join(', ')}`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 7's judge: the recorded taste call

export type Taste = { state: 'looks_right'; who: string; when: string } | { state: 'inconclusive' | 'fail'; why: string };
/**
 * What a recorded call says of `hashes`, this run's pictures by name: no call, or one made on other pictures, is
 * inconclusive; a call that isn't this criterion's, is misshapen or says `looks_wrong` fails; `looks_right` on exactly
 * these pictures passes.
 */
export function tasteOf(call: JsonValue | undefined, hashes: Record<string, string>): Taste {
  if (call === undefined) return { state: 'inconclusive', why: 'no taste call is recorded' };
  if (!isObject(call)) return { state: 'fail', why: 'TASTE.json is not an object' };
  if (call['issue'] !== 1219 || call['criterion'] !== CRITERIA[7]) return { state: 'fail', why: `TASTE.json is not a call on ${CRITERIA[7]}: issue ${brief(call['issue'])}, criterion ${brief(call['criterion'])}` };
  const [who, when, verdict, shots] = [call['who'], call['when'], call['verdict'], call['screenshots']];
  if (typeof who !== 'string' || who.trim() === '') return { state: 'fail', why: 'TASTE.json doesn\'t say who made the call' };
  if (typeof when !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(when) || Number.isNaN(Date.parse(when))) return { state: 'fail', why: 'TASTE.json\'s `when` is not an ISO 8601 time' };
  if (verdict !== 'looks_right' && verdict !== 'looks_wrong') return { state: 'fail', why: `TASTE.json's verdict is ${brief(verdict)}, not looks_right or looks_wrong` };
  if (!isObject(shots) || Object.keys(shots).sort().join() !== Object.keys(hashes).sort().join()) return { state: 'fail', why: `TASTE.json's screenshots don't name exactly ${Object.keys(hashes).sort().join(', ')}` };
  const other = Object.keys(hashes).filter((n) => shots[n] !== hashes[n]);
  if (other.length) return { state: 'inconclusive', why: `the recorded call (${who}, ${when}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${brief(shots[n])}, drawn ${hashes[n]}`).join('; ')}` };
  if (verdict === 'looks_wrong') return { state: 'fail', why: `the owner's taste call (${who}, ${when}) says they don't look right${typeof call['note'] === 'string' ? `: ${call['note']}` : ''}` };
  return { state: 'looks_right', who, when };
}

// ---------------------------------------------------------------------------------------------------
// Every judge on the sets it must fail. Each list names what a judge got wrong on a planted set, and is empty when the
// judges behave: a judge that passes everything can't pass a file.

const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;
/** `problems` gains `what` unless `ok`. */
const hold = (problems: string[], ok: boolean, what: string): void => { if (!ok) problems.push(what); };

/** Criterion 1: the grid's closed form against the printed centers, and the column judge on its planted sets. */
export function columnJudgeProblems(): string[] {
  const p: string[] = [];
  const xs = gridLines(BAYS), less: FrameSpec = { ...FRAME_SPEC, omit: [OMIT] };
  hold(p, xs.length === FRONT_X.length && xs.every((x, i) => near(x, FRONT_X[i]!, 1e-9)), `the bays' sums ${xs.join(', ')} are the criterion's front row ${FRONT_X.join(', ')}`);
  hold(p, xs.length * gridLines(DEPTH_BAYS).length === 24, 'eight lines across by three front to back are 24 grid points');
  hold(p, columnFailures(FRAME_SPEC, columnsAt(xs, FRAME_SPEC)).length === 0, 'the column judge passes the grid');
  hold(p, columnFailures(FRAME_SPEC, columnsAt(xs, FRAME_SPEC, -1)).length === 0, 'the column judge passes the grid whose rows run back along −z');
  hold(p, columnFailures(less, columnsAt(xs, less)).length === 0, 'the column judge passes the grid less [3, 0]');
  const even = columnFailures(FRAME_SPEC, columnsAt(evenLines(BAYS), FRAME_SPEC));
  hold(p, even.length === 12 && even[0]!.includes('column [4, 0]') && even[0]!.includes('x 17.2 m') && even[0]!.includes('0.4000 m off'), `the column judge fails every bay as wide as the first, naming the column at 17.2 m first: ${even[0]}`);
  const mean = columnFailures(FRAME_SPEC, columnsAt(BAYS.map((_, i) => (i * 29.8) / 7).concat(29.8), FRAME_SPEC));
  hold(p, mean.length === 18 && mean.some((f) => f.includes('column [4, 0]') && f.includes('x 17.2 m')), 'the column judge fails columns spaced by the mean bay, the column at 17.2 m among them');
  const nudged = columnsAt(xs, FRAME_SPEC).map((c): Column => (c.at[0] === 5 && c.at[1] === 2 ? { ...c, center: [c.center[0] + 2e-6, c.center[1]] } : c));
  hold(p, columnFailures(FRAME_SPEC, nudged).length === 1, 'the column judge fails one column 2e-6 m off its grid point');
  const shallow = columnsAt(xs, { ...FRAME_SPEC, depthBays: [4, 3.9] });
  hold(p, columnFailures(FRAME_SPEC, shallow).length === 8, 'the column judge fails a back row 0.1 m short of its depth line');
  hold(p, columnFailures(less, columnsAt(xs, FRAME_SPEC)).some((f) => f.includes('omit names')), 'the column judge fails a frame that stands the omitted column');
  hold(p, columnFailures(less, columnsAt(xs, { ...FRAME_SPEC, omit: [OMIT, [4, 0]] })).some((f) => f.includes('no column stands on grid point [4, 0]')), 'the column judge fails a frame that drops a second column with the omitted one');
  hold(p, columnFailures(FRAME_SPEC, []).length > 0, 'the column judge fails a frame that stands nothing');
  return p;
}

/** Criterion 2: the folding rule's closed form against the printed heights, and the profile judge on its planted sets. */
export function profileJudgeProblems(): string[] {
  const p: string[] = [];
  hold(p, purlinsIn(DEPTH_BAYS, PURLINS_PER_BAY).ins.join() === '0,1,2,3' && purlinsIn(DEPTH_BAYS, PURLINS_PER_BAY).half === 4, 'four purlins a side stand 0, 1, 2 and 3 m in, the ridge 4 m in');
  hold(p, near(FOLDED.ridge, PRINTED_RIDGE, 5e-5), `raise × depth ${FOLDED.ridge} is the criterion's ${PRINTED_RIDGE} m`);
  for (const [x, h] of PRINTED_PURLINS) hold(p, near(FOLDED.purlins.find((q) => q.in === x)?.height ?? NaN, h, 5e-5), `the rule's height ${x} m in is the criterion's ${h} m`);
  // The rule as the Scope words it, step by step from the ridge down, against the closed form.
  let [above, drop] = [FOLDED.ridge, FOLDED.ridge / 10];
  for (const x of [3, 2, 1]) {
    above = (above * x) / (x + 1) - drop;
    drop /= 2;
    hold(p, near(FOLDED.purlins[x]!.height, above, 1e-12), `the closed form ${x} m in equals the rule taken step by step`);
  }
  hold(p, near(STRAIGHT.purlins[3]!.height - FOLDED.purlins[3]!.height, PRINTED_DIFFERENCE, 5e-5) && near(FOLDED.ridge / 10, PRINTED_DIFFERENCE, 5e-5), `a straight roof's purlin 3 m in is a tenth of the raise, the criterion's ${PRINTED_DIFFERENCE} m, over the rule's`);
  hold(p, profileFailures(FOLDED, lifted(FOLDED, 0)).length === 0 && profileFailures(FOLDED, lifted(FOLDED, EAVE_HEIGHT + TOTALS.height)).length === 0, 'the profile judge passes the folded roof, wherever its eave purlin sits');
  const straight = profileFailures(FOLDED, lifted(STRAIGHT, EAVE_HEIGHT));
  hold(p, straight.length === 3 && straight[0]!.includes('the purlin 3 m in') && straight[0]!.includes(`${PRINTED_DIFFERENCE} m off`), `the profile judge fails the straight roof, naming the purlin 3 m in and its 0.2667 m difference first: ${straight[0]}`);
  const sameDrop: Profile = { ridge: FOLDED.ridge, purlins: [0, 1, 2, 3].map((x) => ({ in: x, height: x === 0 ? 0 : (FOLDED.ridge * x) / 4 - FOLDED.ridge / 10 })) };
  hold(p, profileFailures(FOLDED, sameDrop).length === 2 && !profileFailures(FOLDED, sameDrop).join().includes('3 m in'), 'the profile judge fails a roof that lowers every purlin by the same tenth, at 2 and 1 m in');
  const low: Profile = { ...FOLDED, ridge: FOLDED.ridge - 2e-4 };
  hold(p, profileFailures(FOLDED, low).length === 1 && profileFailures(FOLDED, low)[0]!.includes('the ridge'), 'the profile judge fails a ridge 2e-4 m low');
  hold(p, profileFailures(FOLDED, { ridge: FOLDED.ridge, purlins: FOLDED.purlins.slice(0, 3) }).some((f) => f.includes('no purlin stands 3 m in')), 'the profile judge fails a roof with three purlins a side');
  hold(p, profileFailures(FOLDED, { ridge: FOLDED.ridge, purlins: FOLDED.purlins.slice(1) }).some((f) => f.includes('no eave purlin')), 'the profile judge fails a roof with no eave purlin');
  hold(p, profileFailures(FOLDED, { ridge: 0, purlins: [] }).length > 0, 'the profile judge fails a roof that answers nothing');
  return p;
}

/** The eave edge of the 29.8 × 8 m frame's roof with no bracket set: the column lines and 0.75 m of rafter overhang. */
const EDGE = { x0: -OVERHANG, x1: 29.8 + OVERHANG, z0: -OVERHANG, z1: 8 + OVERHANG };
/** Criterion 3: the eave judge on its planted sets. */
export function eaveJudgeProblems(): string[] {
  const p: string[] = [];
  const loop = (shape: (t: number) => number, rise = CORNER_RISE, reach = CORNER_REACH): V3[] => eaveLoop(EDGE, 4.1, rise, reach, shape);
  for (const [name, ease] of [['a straight rise', (t: number): number => t], ['the cubic ease in and out', inOutCubic], ['a square ease in', (t: number): number => t * t]] as const)
    hold(p, eaveFailures(loop(ease), CORNER_RISE, CORNER_REACH).length === 0, `the eave judge passes ${name}`);
  hold(p, eaveApproaches(loop(inOutCubic), CORNER_REACH).approaches.length === 8, 'a hipped roof\'s eave line is read toward eight corners');
  const fell = loop(fallsBack(inOutCubic));
  const falls = fallingSamples(fell, CORNER_REACH);
  hold(p, falls.length === 8 && falls.every((k) => k === 40), `the eave judge finds the rise that falls back in its last fifth falling first at sample 40, toward every corner: ${falls.join(', ')}`);
  hold(p, eaveFailures(fell, CORNER_RISE, CORNER_REACH).filter((f) => f.includes('sample 40 of 50') && f.includes('the rise falls back')).length === 8, 'the eave judge fails it, naming the sample');
  hold(p, fallingSamples(loop(fallsBack((t) => t)), CORNER_REACH).every((k) => k === 40) && fallingSamples(loop(fallsBack((t) => t * t)), CORNER_REACH).every((k) => k === 40), 'whichever ease the shipped rise follows, the planted rise falls first at sample 40');
  const flat = eaveFailures(loop(() => 0), CORNER_RISE, CORNER_REACH);
  hold(p, flat.length === 8 && flat.every((f) => f.includes('rises 0.0000 m at the corner')), 'the eave judge fails a level eave line');
  hold(p, eaveFailures(loop(inOutCubic, 0.3002), CORNER_RISE, CORNER_REACH).length === 8, 'the eave judge fails a rise of 0.3002 m at the corner');
  const long = eaveFailures(loop((t) => t, CORNER_RISE, 4), CORNER_RISE, CORNER_REACH);
  hold(p, long.length === 8 && long.every((f) => f.includes('off level more than 3 m from the corner')), 'the eave judge fails a rise that starts 4 m from the corner');
  const ramp: V3[] = [[EDGE.x0, 4.4, EDGE.z0], [EDGE.x0 + 6, 4.1, EDGE.z0], [EDGE.x1 - 6, 4.1, EDGE.z0], [EDGE.x1, 4.4, EDGE.z0], ...loop((t) => t).filter((q) => q[2] !== EDGE.z0)];
  hold(p, eaveFailures(ramp, CORNER_RISE, CORNER_REACH).filter((f) => f.includes(`z = ${-OVERHANG}`) && f.includes('off level')).length === 2, 'the eave judge fails an eave of four points that ramps over 6 m, read between its points');
  hold(p, eaveFailures(loop((t) => t).filter((q) => !(q[0] === EDGE.x1 && q[2] === EDGE.z0)), CORNER_RISE, CORNER_REACH).filter((f) => f.includes('doesn\'t run from corner to corner')).length === 2, 'the eave judge fails a line with one corner missing, on the two eaves that meet there');
  hold(p, eaveFailures(loop((t) => t).filter((q) => q[0] !== EDGE.x1 || q[2] === EDGE.z0 || q[2] === EDGE.z1), CORNER_RISE, CORNER_REACH).filter((f) => f.includes(`x = ${plain(EDGE.x1)}`) && f.includes('rises 0.0000 m')).length === 2, 'the eave judge fails an eave that is its two corners alone');
  hold(p, eaveFailures([], CORNER_RISE, CORNER_REACH).length > 0, 'the eave judge fails a roof that answers no eave line');
  return p;
}

/** Criterion 4: the bracket set's totals against the printed ones, and the bracket and eave-reach judges on their planted sets. */
export function bracketJudgeProblems(): string[] {
  const p: string[] = [];
  hold(p, near(TOTALS.reach, PRINTED_REACH, 1e-12) && near(TOTALS.height, PRINTED_HEIGHT, 1e-12), 'two steps of 0.45 m and 0.3 m reach 0.90 m and rise 0.60 m');
  const good: BracketReading = { id: BRACKETS, totalReach: 0.9, totalHeight: 0.6, top: EAVE_HEIGHT + 0.6, heads: FRONT_X.map(() => EAVE_HEIGHT), eavePurlin: EAVE_HEIGHT + 0.6 };
  hold(p, bracketFailures(good, TOTALS).length === 0, 'the bracket judge passes the set that meets its purlin');
  const short = bracketFailures({ ...good, top: EAVE_HEIGHT + 0.3 }, TOTALS);
  hold(p, short.length === 1 && short[0]!.includes(`${BRACKETS}'s top is 0.3000 m under the eave purlin it carries`), `the bracket judge fails a set built one step short, naming it and the 0.3 m it misses by: ${short[0]}`);
  hold(p, bracketFailures({ ...good, top: good.top + 0.002 }, TOTALS).some((f) => f.includes('0.0020 m over')), 'the bracket judge fails a top 2 mm over the purlin');
  hold(p, bracketFailures({ ...good, eavePurlin: EAVE_HEIGHT, top: EAVE_HEIGHT }, TOTALS).some((f) => f.includes('sits 0.0000 m above the column head')), 'the bracket judge fails an eave purlin left on the column head');
  hold(p, bracketFailures({ ...good, totalReach: 0.45, totalHeight: 0.3 }, TOTALS).length === 2, 'the bracket judge fails one step\'s reach and height answered as the totals');
  hold(p, bracketFailures({ ...good, heads: [] }, TOTALS).length > 0, 'the bracket judge fails a frame with no column head');
  const columns = columnsAt(gridLines(BAYS), FRAME_SPEC);
  const edge = (reach: number): V3[] => eaveLoop({ x0: -reach, x1: 29.8 + reach, z0: -reach, z1: 8 + reach }, 4.1, CORNER_RISE, CORNER_REACH, inOutCubic);
  hold(p, near(EAVE_REACH, 1.65, 1e-12) && eaveReachFailures(edge(EAVE_REACH), columns, EAVE_REACH).length === 0, 'the eave-reach judge passes an eave 0.90 + 0.75 m past the column line');
  for (const [reach, what] of [[TOTALS.reach, 'the brackets\' reach alone'], [OVERHANG, 'the rafter overhang alone'], [STEP_REACH + OVERHANG, 'one step\'s reach and the overhang'], [EAVE_REACH + 0.002, '2 mm more']] as const)
    hold(p, eaveReachFailures(edge(reach), columns, EAVE_REACH).length === 4, `the eave-reach judge fails an eave projecting ${what}`);
  hold(p, eaveReachFailures([], columns, EAVE_REACH).length > 0, 'the eave-reach judge fails a roof with no eave line');
  return p;
}

const rulesRow = (result: string, runs: JsonValue[] | null, issues: JsonObject[] = []): JsonObject =>
  ({ requirements: [{ id: 'r', kind: 'kind_rules', result, issues, ...(runs ? { results: runs } : {}) }] });
const ran = (item: string, rule: string, holds = true): JsonObject => ({ doc: 'd', item, rule, holds });
/** Criteria 1 to 5: the judges of a `kind_rules` row and of a `geometry.audit` row on their planted sets. */
export function rowJudgeProblems(): string[] {
  const p: string[] = [];
  const want = [[FRAME, RULE.column], [ROOF, RULE.folding]] as const;
  const clean = [ran(FRAME, RULE.column), ran(ROOF, RULE.folding), ran(ROOF, RULE.eave)];
  hold(p, ruleFailures(rowOf(rulesRow('PASS', clean), 'r'), want).length === 0, 'the rule judge passes a row whose rules ran and hold');
  hold(p, ruleFailures(rowOf(rulesRow('PASS', null), 'r'), want).some((f) => f.includes('lists no rule runs')), 'the rule judge fails a pass that lists no runs');
  hold(p, ruleFailures(rowOf(rulesRow('PASS', []), 'r'), want).length === 2, 'the rule judge fails a pass on which no rule ran');
  hold(p, ruleFailures(rowOf(rulesRow('PASS', [ran(FRAME, RULE.column), ran(BRACKETS, RULE.folding)]), 'r'), want).some((f) => f.includes(`${RULE.folding} didn't run on ${ROOF}`)), 'the rule judge fails a rule that ran on another item');
  hold(p, ruleFailures(rowOf(rulesRow('INCONCLUSIVE', clean), 'r'), want).length === 1, 'the rule judge fails a row that isn\'t PASS');
  hold(p, ruleFailures(rowOf(rulesRow('BLOCKED', null), 'r'), want).length === 2, 'the rule judge fails the base\'s blocked row');
  hold(p, ruleFailures(rowOf(rulesRow('PASS', clean), 'other'), want).length === 1, 'the rule judge fails a verdict with no such row');
  const column: JsonObject = { code: RULE.column, severity: 'warning', ids: [FRAME], path: `items/${FRAME}/params/bays`, actual: { rule: RULE.column, column: [4, 0], at: [17.2, 0], center: [16.8, 0], off: 0.4 } };
  const broken = rowOf(rulesRow('FAIL', [ran(FRAME, RULE.column, false), ran(ROOF, RULE.folding)], [column]), 'r');
  hold(p, ruleFailures(broken, want).length === 3, 'the rule judge fails a row whose rule doesn\'t hold: its result, its run and its issue');
  hold(p, ruleBreakFailures(broken, RULE.column, FRAME).length === 0 && namesColumn(ruleIssue(broken, RULE.column, FRAME), 4, 17.2), 'the break judge passes the failed column rule, whose issue names the column at 17.2 m');
  hold(p, ruleBreakFailures(rowOf(rulesRow('PASS', clean), 'r'), RULE.column, FRAME).length === 3, 'the break judge fails a row whose rule holds');
  hold(p, ruleBreakFailures(broken, RULE.column, ROOF).length === 2 && ruleBreakFailures(broken, RULE.folding, ROOF).length === 2, 'the break judge fails another item or another rule');
  hold(p, !namesColumn({ ...ruleIssue(broken, RULE.column, FRAME)!, actual: { column: [1, 0], at: [4.2, 0] } }, 4, 17.2) && !namesColumn(undefined, 4, 17.2), 'an issue naming the column at 4.2 m, or no issue, doesn\'t name the column at 17.2 m');
  const fold = (actual: JsonObject): Issue => ({ code: RULE.folding, severity: 'warning', ids: [ROOF], actual, raw: {} });
  hold(p, namesPurlin(fold({ in: 3, difference: 0.26667 }), 3, FOLDED.ridge / 10) && namesPurlin(fold({ in: 3, difference: -0.26667 }), 3, FOLDED.ridge / 10), 'an issue with in 3 and a difference of 0.2667 m either way names the purlin 3 m in');
  hold(p, !namesPurlin(fold({ in: 2, difference: 0.3111 }), 3, FOLDED.ridge / 10) && !namesPurlin(fold({ in: 3, difference: 0.2 }), 3, FOLDED.ridge / 10) && !namesPurlin(fold({ in: 3 }), 3, FOLDED.ridge / 10), 'another purlin, another difference or none doesn\'t');
  hold(p, sampleNamed(fold({ sample: 40 })) === 40 && sampleNamed(fold({ sample: 50 })) === null && sampleNamed(fold({ sample: 40.5 })) === null && sampleNamed(fold({})) === null, 'a sample is a whole number from 0 to 49');
  const audit = (result: string, issues: JsonObject[]): Row | null => rowOf({ requirements: [{ id: 'a', kind: 'geometry.audit', result, issues }] }, 'a');
  const overlap = (ids: string[]): JsonObject => ({ check: 'geometry.audit', code: 'geometry.overlap', severity: 'error', ids });
  hold(p, auditPassFailures(audit('PASS', [])).length === 0, 'the audit judge passes a clean pass');
  hold(p, auditPassFailures(audit('BLOCKED', [])).length === 1 && auditPassFailures(audit('FAIL', [overlap([`${ROOF}#rafter.3`, `${ROOF}#purlin.2`])])).length === 2, 'the audit judge fails a blocked row, and a rafter through a purlin');
  hold(p, auditPassFailures(audit('PASS', [{ code: 'geometry.floating', severity: 'error', ids: [ROOF] }])).length === 1, 'the audit judge fails a pass that raises a floating roof');
  hold(p, auditOverlapFailures(audit('FAIL', [overlap([`${ROOF}#ridge`, PROBE])]), ROOF, PROBE).length === 0, 'the overlap judge passes the box in the ridge, named by the roof\'s part');
  hold(p, auditOverlapFailures(audit('PASS', []), ROOF, PROBE).length === 2, 'the overlap judge fails an audit that doesn\'t see the roof');
  hold(p, auditOverlapFailures(audit('FAIL', [overlap([BRACKETS, PROBE])]), ROOF, PROBE).length === 1, 'the overlap judge fails an overlap with another item');
  return p;
}

/** Criterion 6: the rebuild judge on its planted sets. */
export function rebuildJudgeProblems(): string[] {
  const p: string[] = [];
  const node = (item: string, key: string, run = 'kept', operator = BUILD): Node => ({ operator, item, key, run });
  const before = [...HALL_A, ...HALL_B].flatMap((id) => [node(id, `k-${id}`, 'ran'), node(id, `s-${id}`, 'ran', 'building.shade')]);
  const after = (change: (n: Node) => Node = (n) => n): Node[] => before.map((n) => change((HALL_A as readonly string[]).includes(n.item!) && n.operator === BUILD ? { ...n, key: `${n.key}'`, run: 'ran' } : { ...n, run: 'kept' }));
  const judge = (nodes: Node[], from = before): string[] => rebuildFailures(from, nodes, HALL_A, HALL_B);
  hold(p, judge(after()).length === 0, 'the rebuild judge passes hall a rebuilt and hall b kept');
  hold(p, judge(before.map((n) => ({ ...n, run: 'kept' }))).length === 9, 'the rebuild judge fails a change that rebuilds nothing');
  hold(p, judge(after((n) => (n.item === HALL_A[3] && n.operator === BUILD ? { ...n, run: 'kept' } : n))).length === 2, 'the rebuild judge fails a roof that didn\'t rebuild');
  hold(p, judge(after((n) => (n.item === HALL_A[1] && n.operator === BUILD ? { ...n, key: `k-${HALL_A[1]}` } : n))).length === 1, 'the rebuild judge fails brackets that reran under their old key');
  hold(p, judge(after((n) => (n.item === HALL_B[3] && n.operator === BUILD ? { ...n, run: 'ran' } : n))).length === 2, 'the rebuild judge fails the second hall\'s roof rebuilt');
  hold(p, judge(after((n) => (n.item === HALL_B[0] && n.operator === BUILD ? { ...n, key: 'moved' } : n))).length === 1, 'the rebuild judge fails the second hall\'s frame under a new key');
  hold(p, judge(after((n) => (n.item === HALL_B[2] && n.operator !== BUILD ? { ...n, run: 'ran' } : n))).length === 1, 'the rebuild judge fails the second hall\'s brackets reshaded');
  hold(p, judge([...after(), node('ground', 'g', 'ran')]).length === 1, 'the rebuild judge fails another item rebuilt');
  hold(p, judge(after(), []).length === 8 && judge([], before).length === 9, 'the rebuild judge fails a document that built nothing, before or after');
  return p;
}

/** Criterion 7: the taste judge on its planted sets. */
export function tasteJudgeProblems(): string[] {
  const p: string[] = [];
  const hashes = { 'a.png': 'a'.repeat(64), 'b.png': 'b'.repeat(64) };
  const call = (over: JsonObject = {}): JsonObject => ({ issue: 1219, criterion: CRITERIA[7], verdict: 'looks_right', who: 'the owner', when: '2026-11-23T09:00:00Z', screenshots: { ...hashes }, ...over });
  hold(p, tasteOf(call(), hashes).state === 'looks_right', 'the taste judge passes looks_right on exactly this run\'s pictures');
  hold(p, tasteOf(undefined, hashes).state === 'inconclusive', 'no recorded call is inconclusive');
  hold(p, tasteOf(call({ screenshots: { ...hashes, 'b.png': 'c'.repeat(64) } }), hashes).state === 'inconclusive', 'a call made on another picture is inconclusive');
  hold(p, tasteOf(call({ verdict: 'looks_wrong', screenshots: { ...hashes, 'b.png': 'c'.repeat(64) } }), hashes).state === 'inconclusive', 'looks_wrong on another picture is inconclusive too');
  hold(p, tasteOf(call({ verdict: 'looks_wrong' }), hashes).state === 'fail', 'looks_wrong on these pictures fails');
  for (const [bad, what] of [[{ criterion: CRITERIA[6] }, 'another criterion\'s call'], [{ issue: 2017 }, 'another issue\'s call'], [{ who: ' ' }, 'a call nobody made'], [{ when: 'yesterday' }, 'a call with no time'],
    [{ verdict: 'fine' }, 'another verdict'], [{ screenshots: { 'a.png': hashes['a.png'] } }, 'a call that leaves a picture out'], [{ screenshots: { ...hashes, 'c.png': 'c'.repeat(64) } }, 'a call on a picture this run didn\'t draw']] as [JsonObject, string][])
    hold(p, tasteOf(call(bad), hashes).state === 'fail', `${what} fails`);
  hold(p, tasteOf([call()], hashes).state === 'fail' && tasteOf('looks_right', hashes).state === 'fail', 'a call that isn\'t an object fails');
  return p;
}

/** Every judge's problems on its planted sets, by judge. */
export const judgeProblems = (): Record<string, string[]> => ({
  columns: columnJudgeProblems(), profile: profileJudgeProblems(), eave: eaveJudgeProblems(), brackets: bracketJudgeProblems(), rows: rowJudgeProblems(),
  rebuild: rebuildJudgeProblems(), taste: tasteJudgeProblems(),
});
