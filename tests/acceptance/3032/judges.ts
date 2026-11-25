// The judges of the #3032 acceptance tests (README: Criteria to tests): pure functions over JSON, Node built-ins
// only, so each can be run against a planted set with no binary. This file holds the criteria's IDs, the issue's
// twenty names, the readers of a census, of a `deep_show` reply and of a `deep_kinds` answer, the conversions the
// lights fixture is held to, and one judge per criterion. Each judge returns its failures as text, none when what
// it reads holds; every failure names what its criterion says a failure names (the name, the field, the word, both
// values). `judgeProblems` runs every judge against planted sets and says which judge, if any, passes a wrong one.
// Nothing here stands in for the census script, the pack check, the document check or deep_kinds: what a judge
// reads is the tree's own files and a binary's own replies.

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed,
 * `- [ ] ` dropped (scripts/proof-change.mjs: criterionId), computed from the issue's body. */
export const AC = {
  1: 'AC1 #3032.dae946a2',
  2: 'AC2 #3032.b6de0329',
  3: 'AC3 #3032.5da79b5b',
  4: 'AC4 #3032.876d5479',
  5: 'AC5 #3032.5d808b13',
} as const;

/** The twenty names the issue's second paragraph lists, in its order. */
export const TWENTY = [
  'DirectionalLight', 'AmbientLight', 'HemisphereLight', 'RectAreaLight', 'OrthographicCamera', 'MeshBasicMaterial', 'MeshLambertMaterial',
  'MeshPhongMaterial', 'MeshPhysicalMaterial', 'MeshToonMaterial', 'Group', 'Mesh', 'Scene', 'Fog', 'FogExp2', 'InstancedMesh', 'Sprite', 'Line',
  'Points', 'TorusKnotGeometry',
] as const;
/** The lights among them. */
export const LIGHTS = ['DirectionalLight', 'AmbientLight', 'HemisphereLight', 'RectAreaLight'] as const;
/** The reference's material that takes shader text (fixtures/names.json: shader_text). */
export const SHADER_TEXT = 'ShaderMaterial';
/** AC1: "at most 402 names open". */
export const OPEN_AT_MOST = 402;
/** A census row's states, and the closed list of reasons a `refused` row gives (canvas primitives: Pack, `census`). */
export const STATES = ['mapped', 'refused', 'open'] as const;
export const REASONS = ['imperative', 'renderer', 'superseded', 'no_counterpart'] as const;

// ---------------------------------------------------------------------------------------------------
// JSON

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: unknown, max = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, max);
const objects = (v: JsonValue | undefined): JsonObject[] => (Array.isArray(v) ? v.filter(isObject) : []);
const text = (v: JsonValue | undefined): string => (typeof v === 'string' ? v : '');
const field = (v: JsonValue | undefined, key: string): JsonValue | undefined => (isObject(v) ? v[key] : undefined);
/** Whether `text` holds `word` as a whole word: not inside a longer name (`Mesh` in `InstancedMesh`). */
export function namesWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`).test(text);
}
/** A number as a failure prints it: ten significant digits, no trailing zeros. */
export const fmt = (x: number): string => String(Number(x.toPrecision(10)));

// ---------------------------------------------------------------------------------------------------
// The census (packs/<folder>/census.json): `names` rows {name, state, target?, reason?}, `params` rows
// {name, param, state, target?, reason?}, `totals` {names, params}, each {mapped, refused, open}.

export interface Row { name: string; state: string; target: string; reason: string }
const rowOf = (r: JsonObject): Row => ({ name: text(r['name']), state: text(r['state']), target: text(r['target']), reason: text(r['reason']) });
/** The census's rows for `name`: one, when the census is right. */
export const rowsFor = (census: JsonObject, name: string): Row[] => objects(census['names']).filter((r) => r['name'] === name).map(rowOf);

/** What the tree's census decides of `names`: its mapped rows, its refused rows, and the names it leaves undecided
 * (open, in no row, or in more than one). */
export interface Decided { mapped: Row[]; refused: Row[]; undecided: string[] }
export function decided(census: JsonObject, names: readonly string[] = TWENTY): Decided {
  const out: Decided = { mapped: [], refused: [], undecided: [] };
  for (const name of names) {
    const rows = rowsFor(census, name);
    const row = rows.length === 1 ? rows[0]! : undefined;
    if (row?.state === 'mapped') out.mapped.push(row);
    else if (row?.state === 'refused') out.refused.push(row);
    else out.undecided.push(name);
  }
  return out;
}

/**
 * AC1's judge on a census: its totals equal its rows, at most 402 names are open, and each of the twenty has one
 * row, mapped or refused. Each failure names the count or the name.
 */
export function censusProblems(census: JsonObject): string[] {
  const out: string[] = [];
  const tables: [string, JsonObject[]][] = [['names', objects(census['names'])], ['params', objects(census['params'])]];
  for (const [table, rows] of tables) {
    const totals = field(census['totals'], table);
    for (const state of STATES) {
      const counted = rows.filter((r) => r['state'] === state).length;
      if (field(totals, state) !== counted) out.push(`totals.${table}.${state} is ${show(field(totals, state))}, and ${counted} of its ${table} rows are ${state}`);
    }
    const stray = rows.filter((r) => !STATES.some((s) => s === r['state']));
    if (stray.length) out.push(`${stray.length} ${table} rows are in no state of ${STATES.join(', ')}: ${show(stray.slice(0, 3))}`);
  }
  const open = tables[0]![1].filter((r) => r['state'] === 'open').length;
  if (open > OPEN_AT_MOST) out.push(`${open} names are open, more than ${OPEN_AT_MOST}`);
  for (const name of TWENTY) {
    const rows = rowsFor(census, name);
    if (rows.length !== 1) out.push(`${name} has ${rows.length} rows, not one`);
    else if (rows[0]!.state !== 'mapped' && rows[0]!.state !== 'refused') out.push(`${name} is ${rows[0]!.state || 'in no state'}, neither mapped nor refused`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// fixtures/names.json: the twenty with their classes in the reference.

/** One of the twenty as fixtures/names.json holds it. */
export interface Named { name: string; file: string; line: number; parameters: string[]; requires: JsonObject; kind: string; holds: JsonObject }
export function namedOf(fixture: JsonObject): Map<string, Named> {
  const out = new Map<string, Named>();
  for (const n of objects(fixture['names'])) {
    const requires = field(n['requires'], 'params');
    out.set(text(n['name']), {
      name: text(n['name']), file: text(n['file']), line: typeof n['line'] === 'number' ? n['line'] : 0,
      parameters: Array.isArray(n['parameters']) ? n['parameters'].map(text) : [],
      requires: isObject(requires) ? requires : {}, kind: text(n['kind']), holds: isObject(n['holds']) ? n['holds'] : {},
    });
  }
  return out;
}
/** Why fixtures/names.json isn't the twenty, each once, in the issue's order; nothing when it is. */
export function namedProblems(fixture: JsonObject): string[] {
  const names = [...namedOf(fixture).keys()];
  return JSON.stringify(names) === JSON.stringify(TWENTY) ? [] : [`fixtures/names.json names ${show(names)}, not the issue's twenty in its order`];
}

// ---------------------------------------------------------------------------------------------------
// AC2: a mapped name's recipe and its parameter rows.

/** The recipe a mapped row's name maps to: the alias's target, the row's target and a recipe of the pack, all one. */
export function recipeProblems(manifest: JsonObject, row: Row): string[] {
  const target = field(field(manifest['aliases'], row.name), 'target');
  if (typeof target !== 'string') return [`${row.name} is mapped in the census, and pack.json's aliases hold no ${row.name} with a recipe as its target (${show(field(manifest['aliases'], row.name))})`];
  const out: string[] = [];
  if (target !== row.target) out.push(`${row.name}: its row maps to ${show(row.target)}, and its alias to ${show(target)}`);
  if (typeof field(manifest['recipes'], target) !== 'string') out.push(`${row.name}: its target ${target} is no recipe of the pack (its recipes are ${Object.keys(isObject(manifest['recipes']) ? manifest['recipes'] : {}).join(', ')})`);
  return out;
}
/** The recipe kind `name` maps to, by pack.json's aliases; empty when it has none. */
export const recipeFor = (manifest: JsonObject, name: string): string => text(field(field(manifest['aliases'], name), 'target'));

/**
 * AC2's second clause on the census: each parameter of the mapped name `n` has exactly one `params` row, mapped or
 * refused (the Scope: "each mapped or refused"), a refused one with a reason from the list. Each failure names the
 * name and the parameter.
 */
export function paramRowProblems(census: JsonObject, n: Named): string[] {
  const out: string[] = [];
  const rows = objects(census['params']).filter((r) => r['name'] === n.name);
  for (const param of n.parameters) {
    const of = rows.filter((r) => r['param'] === param);
    const word = `${n.name}.${param} (${n.file}:${n.line})`;
    if (of.length !== 1) out.push(`${word} has ${of.length} params rows, not one`);
    else if (of[0]!['state'] === 'refused' && !REASONS.some((r) => r === of[0]!['reason'])) out.push(`${word} is refused with ${of[0]!['reason'] === undefined ? 'no reason' : `the reason ${show(of[0]!['reason'])}`}, not one of ${REASONS.join(', ')}`);
    else if (of[0]!['state'] !== 'mapped' && of[0]!['state'] !== 'refused') out.push(`${word} is ${show(of[0]!['state'])}, neither mapped nor refused`);
  }
  return out;
}

/** What an instance of the mapped name `n` writes: only the inputs its reference itself requires (canvas primitives,
 * Pack), each when the tree's census maps that parameter; the reference's own default stands for the rest. */
export function requiredParams(census: JsonObject, n: Named): JsonObject {
  const mapped = (param: string): boolean => objects(census['params']).some((r) => r['name'] === n.name && r['param'] === param && r['state'] === 'mapped');
  return Object.fromEntries(Object.entries(n.requires).filter(([param]) => mapped(param)));
}

// ---------------------------------------------------------------------------------------------------
// A `deep_show` reply: `outcome`, `issues`, `notices`, and `expansions` [{instance, kind, pack, key, derived}].

/** A derived item a recipe instance wrote, as the reply's `expansions` row holds it. */
export interface Derived { id: string; kind: string; params: JsonObject }
/** The derived items `instance` expanded to in this reply; none when it has no row. */
export function derivedOf(reply: JsonObject, instance: string): Derived[] {
  const row = objects(reply['expansions']).find((r) => r['instance'] === instance);
  const derived = row?.['derived'];
  if (!isObject(derived)) return [];
  return Object.entries(derived).map(([id, item]) => {
    const params = field(item, 'params');
    return { id, kind: text(field(item, 'kind')), params: isObject(params) ? params : {} };
  });
}
const drawn = (list: Derived[]): string => (list.length ? list.map((d) => `${d.id} ${d.kind}`).join(', ') : 'nothing');
/** Why a revision isn't presented clean: an outcome other than `presented`, an error among its issues, or an item
 * skipped as an unknown kind. */
export function presentedProblems(reply: JsonObject, what: string): string[] {
  const out: string[] = [];
  const errors = objects(reply['issues']).filter((i) => i['severity'] === 'error');
  const unknown = objects(reply['notices']).filter((n) => n['code'] === 'unknown_kind');
  if (reply['outcome'] !== 'presented') out.push(`${what}: the revision is ${show(reply['outcome'])}, not presented; its issues were ${show(reply['issues'], 1200)}`);
  else if (errors.length) out.push(`${what}: the revision holds an error: ${show(errors, 1200)}`);
  if (unknown.length) out.push(`${what}: an item is skipped as an unknown kind: ${show(unknown, 800)}`);
  return out;
}

/**
 * AC2's first clause on a reply: the revision that holds one instance of the mapped name's recipe is presented, and
 * the instance lowers to exactly one item, of the kind the issue pairs the name with (when it pairs one) holding
 * what the issue says of it, and never to a recipe of the pack. Each failure names the name.
 */
export function loweredProblems(reply: JsonObject, instance: string, n: Named, recipes: readonly string[]): string[] {
  const out = presentedProblems(reply, n.name);
  const derived = derivedOf(reply, instance);
  if (derived.length !== 1) return [...out, `${n.name}: its recipe lowers to ${derived.length} items (${drawn(derived)}), not one`];
  const [item] = derived as [Derived];
  if (recipes.includes(item.kind)) out.push(`${n.name}: its recipe lowers to ${item.kind}, a recipe of the pack, not an item of a kind`);
  if (n.kind && item.kind !== n.kind) out.push(`${n.name}: its recipe lowers to one ${item.kind}, not one ${n.kind}`);
  for (const [key, value] of Object.entries(n.holds)) {
    if (JSON.stringify(item.params[key]) !== JSON.stringify(value)) out.push(`${n.name}: its ${item.kind} has ${key} ${show(item.params[key])}, not ${show(value)}`);
  }
  return out;
}

/** The errors of a refused pack that name the kind kit's part `part` as data (#1493's reading of the pack check). */
export function kitPartErrors(reply: JsonObject, part: string): JsonObject[] {
  return objects(reply['issues']).filter((i) => i['severity'] === 'error' && i['code'] !== 'unknown_field' && names(i, part));
}
/** Every value in `v`, deep, leaving out an issue's prose (`what`, `fix`): what the issue names as data. */
function named(v: JsonValue | undefined): JsonValue[] {
  if (Array.isArray(v)) return [v, ...v.flatMap(named)];
  if (isObject(v)) return [v, ...Object.entries(v).filter(([k]) => k !== 'what' && k !== 'fix').flatMap(([, x]) => named(x))];
  return v === undefined ? [] : [v];
}
/** Whether `v` names `value` as data: a string equal to it. */
export const names = (v: JsonValue | undefined, value: string): boolean => named(v).some((x) => x === value);

/**
 * AC2's planted program against the pack check's reply: the pack whose recipe accepts `field` and draws nothing from
 * it is refused, with an error that names the kit part `field.effect` and the field as data. Each failure names the
 * field.
 */
export function inertProblems(reply: JsonObject, fieldName: string): string[] {
  if (reply['outcome'] !== 'refused') return [`field ${fieldName}: the pack whose recipe accepts it and draws nothing from it is ${show(reply['outcome'])}, not refused: ${show(reply, 1200)}`];
  const failing = kitPartErrors(reply, 'field.effect');
  if (!failing.length) return [`field ${fieldName}: the refusal holds no error naming the kit's part field.effect: ${show(reply['issues'], 1500)}`];
  return failing.some((i) => names(i, fieldName)) ? [] : [`field ${fieldName}: no error of field.effect names it: ${show(failing, 1500)}`];
}

// ---------------------------------------------------------------------------------------------------
// AC3: a refused name at the document check.

/** Why `name`'s row isn't a refusal with a reason and the nearest thing ours has; nothing when it is. */
export function refusedRowProblems(census: JsonObject, name: string): string[] {
  const rows = rowsFor(census, name);
  if (rows.length !== 1) return [`${name} has ${rows.length} rows in the census, not one`];
  const [row] = rows as [Row];
  if (row.state !== 'refused') return [`${name} is ${row.state || 'in no state'} in the census, not refused with its reason and what ours has in its place`];
  const out: string[] = [];
  if (!REASONS.some((r) => r === row.reason)) out.push(`${name} is refused with ${row.reason ? `the reason ${show(row.reason)}` : 'no reason'}, not one of ${REASONS.join(', ')}`);
  if (!row.target.trim()) out.push(`${name} is refused, and its row's target names no kind or recipe of ours to write instead`);
  return out;
}

/**
 * AC3's judge on a reply: the revision whose item `item` has the refused name as its `kind` isn't presented, and its
 * issues hold one at `items/<item>/kind` whose `close` holds the pack's entry {name: pack, refuses: the name, reason,
 * target} as the row gives them, and whose `fix` holds the reason and the target; nothing is drawn for the item. Each
 * failure names the name.
 */
export function refusalProblems(reply: JsonObject, item: string, row: Row, pack: string): string[] {
  const out: string[] = [];
  const path = `items/${item}/kind`;
  if (reply['outcome'] === 'presented') out.push(`${row.name}: the revision that uses it is presented, not refused at check`);
  const at = objects(reply['issues']).filter((i) => i['path'] === path);
  if (!at.length) return [...out, `${row.name}: the revision's issues hold none at ${path}: ${show(reply['issues'], 1500)}`];
  const whole = at.some((i) => {
    const entry = objects(i['close']).some((c) => c['name'] === pack && c['refuses'] === row.name && c['reason'] === row.reason && c['target'] === row.target);
    const fix = text(i['fix']);
    return entry && namesWord(fix, row.reason) && fix.includes(row.target);
  });
  if (!whole) {
    out.push(`${row.name}: no issue at ${path} names it refused by ${pack} for ${row.reason} with ${show(row.target)} in its place, in its close ({name, refuses, reason, target}) and in its fix: ${show(at.map((i) => ({ code: i['code'] ?? null, close: i['close'] ?? null, fix: i['fix'] ?? null })), 1500)}`);
  }
  const made = derivedOf(reply, item);
  if (made.length) out.push(`${row.name}: refused, yet drawn as ${drawn(made)}`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// AC4: the lights' conversions. Every expected number is derived here from the library's words; the fixture states
// the same numbers, and `fixtureProblems` fails a fixture that states another.

/** The library's own defaults, each with the line of the reference at the pin it is read from. */
const INTENSITY = 1; // src/lights/Light.js:30: constructor( color, intensity = 1 )
const AREA_SIDE = 10; // src/lights/RectAreaLight.js:38: constructor( color, intensity, width = 10, height = 10 )
const written = (params: JsonObject, word: string, unwritten: number): number => {
  const value = params[word];
  return typeof value === 'number' ? value : unwritten;
};

/**
 * What each light's expanded item must hold for the library's words `params`, the light's color left white.
 *
 * - DirectionalLight: its number is the illuminance on a surface that faces it (src/renderers/webgl/WebGLLights.js:332,
 *   color × intensity; lights_physical_pars_fragment.glsl.js:557, irradiance = dotNL × that), in lux where a point
 *   light's is candela (src/lights/PointLight.js:25). Ours is `illuminance` in lux: the same number.
 * - AmbientLight: its number is the illuminance every surface receives (WebGLLights.js:273-277; lights_pars_begin.glsl.js
 *   :48-54), which a diffuse surface reflects as illuminance × color ÷ π (lights_physical_pars_fragment.glsl.js:651;
 *   common.glsl.js:103-107). Our sky's `ambient_top` and `ambient_low` are that reflected radiance for a white
 *   surface facing up and down (fixtures/lights.json: ours), so each is the number ÷ π.
 * - HemisphereLight: the same, the sky color lighting a surface that faces up and the ground color one that faces
 *   down, mixed between by n.y ÷ 2 + ½ in the library (lights_pars_begin.glsl.js:222-231) and in ours alike.
 * - RectAreaLight: its number is its face's luminance in nits, and the library's own lumens are
 *   intensity × width × height × π (src/lights/RectAreaLight.js:77-82). Ours is `power` in lumens over `size` in metres.
 */
export const CONVERSIONS: Record<string, (params: JsonObject) => JsonObject> = {
  DirectionalLight: (p) => ({ illuminance: written(p, 'intensity', INTENSITY) }),
  AmbientLight: (p) => {
    const radiance = written(p, 'intensity', INTENSITY) / Math.PI;
    return { ambient_top: [radiance, radiance, radiance], ambient_low: [radiance, radiance, radiance] };
  },
  HemisphereLight: (p) => {
    const radiance = written(p, 'intensity', INTENSITY) / Math.PI;
    return { ambient_top: [radiance, radiance, radiance], ambient_low: [radiance, radiance, radiance] };
  },
  RectAreaLight: (p) => {
    const [width, height] = [written(p, 'width', AREA_SIDE), written(p, 'height', AREA_SIDE)];
    return { power: written(p, 'intensity', INTENSITY) * width * height * Math.PI, size: [width, height] };
  },
};

/** One case of a light: the library's words, its value, and what the expanded item must hold. */
export interface LightCase { id: string; params: JsonObject; library: number; ours: JsonObject }
/** One light of fixtures/lights.json. */
export interface Light {
  name: string; kind: string; word: string; unit: string; fields: Record<string, string>; conversion: string;
  sameNumber: boolean; planted: JsonObject | undefined; cases: LightCase[];
}
export interface Tolerance { relative: number; absolute: number }
export function lightsOf(fixture: JsonObject): Light[] {
  return objects(fixture['lights']).map((l) => {
    const fields = field(l['ours'], 'fields');
    return {
      name: text(l['name']), kind: text(l['kind']), word: text(field(l['library'], 'word')), unit: text(field(l['library'], 'unit')),
      fields: Object.fromEntries(Object.entries(isObject(fields) ? fields : {}).map(([k, v]) => [k, text(v)])),
      conversion: text(l['conversion']), sameNumber: l['same_number'] === true, planted: isObject(l['planted']) ? l['planted'] : undefined,
      cases: objects(l['cases']).map((c) => ({
        id: text(c['id']), params: isObject(c['params']) ? c['params'] : {}, library: typeof c['library'] === 'number' ? c['library'] : NaN,
        ours: isObject(c['ours']) ? c['ours'] : {},
      })),
    };
  });
}
export function toleranceOf(fixture: JsonObject): Tolerance {
  const t = fixture['tolerance'];
  return { relative: Number(field(t, 'relative')), absolute: Number(field(t, 'absolute')) };
}

/** A value as numbers: a number, or a list's leading numbers. */
const numbers = (v: JsonValue | undefined): number[] | undefined => {
  if (typeof v === 'number') return [v];
  if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'number')) return v as number[];
  return undefined;
};
const near = (got: number, want: number, t: Tolerance): boolean => Math.abs(got - want) <= (want === 0 ? t.absolute : t.relative * Math.abs(want));
const printed = (v: number[]): string => (v.length === 1 ? fmt(v[0]!) : `[${v.map(fmt).join(', ')}]`);

/** The library's value of a case as a failure prints it: `intensity 2 cd/m²`. */
export const libraryText = (light: Light, c: LightCase): string => `${light.word} ${fmt(c.library)} ${light.unit}`;
/** Ours, each field as a failure prints it: `power 9.424777961 lm`. */
export const oursText = (light: Light, c: LightCase): string[] =>
  Object.entries(light.fields).map(([name, unit]) => `${name} ${printed(numbers(c.ours[name]) ?? [NaN])} ${unit}`);

/**
 * Why the fixture isn't the derivation: the four lights each once, every case's library value the word as written
 * (or the library's default) and every number of `ours` what CONVERSIONS gives for its params, a light with the same
 * number in both having no planted program and every other light one. Nothing when it is.
 */
export function fixtureProblems(fixture: JsonObject): string[] {
  const lights = lightsOf(fixture);
  const out: string[] = [];
  if (JSON.stringify(lights.map((l) => l.name)) !== JSON.stringify(LIGHTS)) out.push(`fixtures/lights.json holds ${show(lights.map((l) => l.name))}, not the four lights of the twenty`);
  const exact: Tolerance = { relative: 1e-15, absolute: 0 };
  for (const light of lights) {
    const convert = CONVERSIONS[light.name];
    if (!convert) { out.push(`${light.name}: judges.ts derives no conversion for it`); continue; }
    if (light.cases.length === 0) out.push(`${light.name}: the fixture states no case`);
    let same = true;
    for (const c of light.cases) {
      if (c.library !== written(c.params, light.word, INTENSITY)) out.push(`${light.name} ${c.id}: the fixture states the library's ${light.word} as ${c.library}, and its params write ${show(c.params[light.word] ?? 'nothing, so the default 1')}`);
      const want = convert(c.params);
      if (JSON.stringify(Object.keys(want).sort()) !== JSON.stringify(Object.keys(c.ours).sort()) || JSON.stringify(Object.keys(want).sort()) !== JSON.stringify(Object.keys(light.fields).sort())) {
        out.push(`${light.name} ${c.id}: the fixture states ${show(Object.keys(c.ours))} of fields ${show(Object.keys(light.fields))}, and the derivation gives ${show(Object.keys(want))}`);
        continue;
      }
      for (const [name, value] of Object.entries(want)) {
        const [w, o] = [numbers(value)!, numbers(c.ours[name])];
        if (!o || o.length !== w.length || o.some((x, i) => !near(x, w[i]!, exact))) out.push(`${light.name} ${c.id}: the fixture states ${name} ${show(c.ours[name])}, and ${light.conversion} gives ${printed(w)}`);
        if (w.some((x) => x !== c.library)) same = false;
      }
    }
    if (light.sameNumber !== same) out.push(`${light.name}: the fixture says its number is ${light.sameNumber ? 'the same' : 'not the same'} in the library and in ours, and its cases say otherwise`);
    if (light.sameNumber === (light.planted !== undefined)) out.push(`${light.name}: a light whose number is the same in both has no planted program, and every other light has one`);
  }
  return out;
}

/**
 * AC4's judge on a reply: the revision that holds one instance of the light's recipe with the case's words is
 * presented, the instance lowers to one item of the light's kind, and each field of `ours` is the fixture's within
 * the tolerance (an area light also of shape rect). Each failure names both values: the library's and ours.
 */
export function lightProblems(reply: JsonObject, instance: string, light: Light, c: LightCase, t: Tolerance): string[] {
  const states = `${light.name} ${c.id}: the library's ${libraryText(light, c)} is ours ${oursText(light, c).join(', ')} (${light.conversion})`;
  const out = presentedProblems(reply, `${light.name} ${c.id}`).map((p) => `${states}; ${p}`);
  const of = derivedOf(reply, instance).filter((d) => d.kind === light.kind);
  if (of.length !== 1) return [...out, `${states}; the instance lowers to ${of.length} ${light.kind} items (it lowered to ${drawn(derivedOf(reply, instance))})`];
  const [item] = of as [Derived];
  for (const name of Object.keys(light.fields)) {
    const [want, got] = [numbers(c.ours[name]) ?? [], numbers(item.params[name])];
    // A color the kind takes with an alpha may carry one: only the numbers the fixture states are read.
    if (!got || got.length < want.length || want.some((w, i) => !near(got[i]!, w, t))) out.push(`${states}; the recipe's ${light.kind} has ${name} ${got ? printed(got) : show(item.params[name])}`);
  }
  if (light.kind === 'light.area@1' && item.params['shape'] !== undefined && item.params['shape'] !== 'rect') out.push(`${states}; the recipe's ${light.kind} has shape ${show(item.params['shape'])}, not rect`);
  return out;
}

/** The number a planted recipe that copies the library's number as written leaves in `name` of the item `instance`
 * lowered to: undefined when no number is there. */
export function copiedNumber(reply: JsonObject, instance: string, light: Light, name: string): number | undefined {
  const of = derivedOf(reply, instance).filter((d) => d.kind === light.kind);
  return of.length === 1 ? numbers(of[0]!.params[name])?.[0] : undefined;
}

// ---------------------------------------------------------------------------------------------------
// AC5: deep_kinds' answer for a word.

/**
 * AC5's judge on `deep_kinds {op: "word"}`'s answer for one of the twenty: its recipe ({state: "mapped", target}, the
 * recipe pack.json's alias maps it to) when the census maps it, its refusal ({state: "refused", reason, target}, as
 * its row gives them) when the census refuses it, and a failure when the census leaves it undecided. Each failure
 * names the name.
 */
export function wordProblems(answer: JsonObject, name: string, census: JsonObject, manifest: JsonObject): string[] {
  const out: string[] = [];
  if (answer['word'] !== name) out.push(`${name}: the answer is for the word ${show(answer['word'])}`);
  const rows = rowsFor(census, name);
  const row = rows.length === 1 ? rows[0]! : undefined;
  if (row?.state === 'mapped') {
    const recipe = recipeFor(manifest, name);
    if (answer['state'] !== 'mapped' || answer['target'] !== recipe || !recipe) out.push(`${name}: mapped in the census to ${show(row.target)}; deep_kinds answers ${show(answer)}, not its recipe ${show(recipe)} as {state: "mapped", target}`);
    else if (typeof field(manifest['recipes'], recipe) !== 'string') out.push(`${name}: deep_kinds answers ${recipe}, which is no recipe of the pack`);
  } else if (row?.state === 'refused') {
    const whole = answer['state'] === 'refused' && answer['reason'] === row.reason && answer['target'] === row.target && REASONS.some((r) => r === row.reason) && row.target.trim() !== '';
    if (!whole) out.push(`${name}: refused in the census for ${show(row.reason)} with ${show(row.target)} in its place; deep_kinds answers ${show(answer)}, not that refusal as {state: "refused", reason, target}`);
  } else {
    out.push(`${name}: ${rows.length === 1 ? `${row?.state || 'in no state'} in the census` : `${rows.length} rows in the census`}, so deep_kinds has neither a recipe nor a refusal to return; it answers ${show(answer)}`);
  }
  return out;
}

/** A name of the census still open that is none of `decided`, the first by row; undefined when none is left. */
export function openWord(census: JsonObject, decidedNames: readonly string[]): string | undefined {
  const row = objects(census['names']).find((r) => r['state'] === 'open' && !decidedNames.includes(text(r['name'])));
  return row ? text(row['name']) : undefined;
}
/** AC5's second sentence on an answer: the word still open answers that it is undecided ({word, state: "open"}),
 * never `no_match` and never an answer with no state. Each failure names the word. */
export function openWordProblems(answer: JsonObject, word: string): string[] {
  if (answer['code'] !== undefined) return [`${word}: open in the census; deep_kinds answers ${show(answer)}, a reply with a code and no state`];
  return answer['word'] === word && answer['state'] === 'open' ? [] : [`${word}: open in the census; deep_kinds answers ${show(answer)}, not that it is undecided as {word, state: "open"}`];
}

// ---------------------------------------------------------------------------------------------------
// The judges against planted sets: each judge passes the set that is right and fails each wrong one, naming what
// its criterion names. A test runs this before it asks for a binary; a judge that can't fail proves nothing.

const PACK = 'deepbuild/familiar@1.0.0';
/** A census of `open` open names beside the twenty, each of the twenty in `state`, with totals that count its rows. */
function plantedCensus(open: number, state: 'mapped' | 'refused' | 'open'): JsonObject {
  const names: JsonObject[] = TWENTY.map((name) => (state === 'mapped' ? { name, state, target: `familiar.${name.toLowerCase()}@1` }
    : state === 'refused' ? { name, state, reason: 'no_counterpart', target: 'group@1' } : { name, state }));
  for (let i = 0; i < open; i++) names.push({ name: `Open${i}`, state: 'open' });
  const params: JsonObject[] = [
    { name: 'RectAreaLight', param: 'color', state: 'mapped', target: 'color' }, { name: 'RectAreaLight', param: 'intensity', state: 'mapped', target: 'intensity' },
    { name: 'RectAreaLight', param: 'width', state: 'mapped', target: 'width' }, { name: 'RectAreaLight', param: 'height', state: 'refused', reason: 'renderer' },
    { name: 'Fog', param: 'color', state: 'mapped', target: 'color' },
  ];
  const count = (rows: JsonObject[]): JsonObject => Object.fromEntries(STATES.map((s) => [s, rows.filter((r) => r['state'] === s).length]));
  return { names, params, totals: { names: count(names), params: count(params) } };
}
const AREA: Named = { name: 'RectAreaLight', file: 'src/lights/RectAreaLight.js', line: 38, parameters: ['color', 'intensity', 'width', 'height'], requires: {}, kind: 'light.area@1', holds: {} };
const BASIC: Named = { name: 'MeshBasicMaterial', file: 'src/materials/MeshBasicMaterial.js', line: 25, parameters: ['color'], requires: {}, kind: 'material@1', holds: { unlit: true } };
const shown = (instance: string, derived: JsonObject, more: JsonObject = {}): JsonObject =>
  ({ outcome: 'presented', issues: [], notices: [], expansions: [{ instance, kind: 'familiar.planted@1', pack: PACK, key: 'k', derived }], ...more });
const edited = (census: JsonObject, change: (c: JsonObject) => void): JsonObject => {
  const copy = JSON.parse(JSON.stringify(census)) as JsonObject;
  change(copy);
  return copy;
};

/** Each judge that passes a planted wrong set, fails the right one, or fails without naming what it must. */
export function judgeProblems(lights: Light[], t: Tolerance): string[] {
  const out: string[] = [];
  /** `problems` must be empty for a right set, and otherwise hold a failure that names each of `naming`. */
  const held = (judge: string, set: string, problems: string[], naming?: string[]): void => {
    if (!naming) {
      if (problems.length) out.push(`${judge} fails the right set, ${set}: ${problems.join(' | ')}`);
    } else if (!problems.length) out.push(`${judge} passes the planted set, ${set}`);
    else if (!problems.some((p) => naming.every((n) => p.includes(n)))) out.push(`${judge} fails the planted set, ${set}, without naming ${naming.join(' and ')}: ${problems.join(' | ')}`);
  };

  // AC1
  const right = plantedCensus(OPEN_AT_MOST, 'mapped');
  held('censusProblems', 'the twenty mapped and 402 open', censusProblems(right));
  held('censusProblems', 'the twenty refused and none open', censusProblems(plantedCensus(0, 'refused')));
  held('censusProblems', '403 open', censusProblems(plantedCensus(OPEN_AT_MOST + 1, 'mapped')), ['403']);
  held('censusProblems', 'the merge base: the twenty open among 422', censusProblems(plantedCensus(OPEN_AT_MOST, 'open')), ['422']);
  held('censusProblems', 'the twenty open', censusProblems(plantedCensus(0, 'open')), ['Scene']);
  held('censusProblems', 'a total one off', censusProblems(edited(right, (c) => { (field(c['totals'], 'names') as JsonObject)['mapped'] = 21; })), ['totals.names.mapped']);
  held('censusProblems', 'a params total one off', censusProblems(edited(right, (c) => { (field(c['totals'], 'params') as JsonObject)['refused'] = 0; })), ['totals.params.refused']);
  held('censusProblems', 'Mesh with no row', censusProblems(edited(right, (c) => {
    c['names'] = objects(c['names']).filter((r) => r['name'] !== 'Mesh');
    (field(c['totals'], 'names') as JsonObject)['mapped'] = 19;
  })), ['Mesh has 0 rows']);
  if (decided(right).mapped.length !== 20 || decided(plantedCensus(3, 'open')).undecided.length !== 20 || decided(plantedCensus(3, 'refused')).refused.length !== 20) out.push('decided misreads a planted census');

  // AC2
  held('paramRowProblems', 'each parameter mapped or refused', paramRowProblems(right, AREA));
  held('paramRowProblems', 'a parameter with no row', paramRowProblems(edited(right, (c) => { c['params'] = objects(c['params']).filter((r) => r['param'] !== 'width'); }), AREA), ['RectAreaLight.width']);
  held('paramRowProblems', 'a parameter left open', paramRowProblems(edited(right, (c) => { objects(c['params'])[1]!['state'] = 'open'; }), AREA), ['RectAreaLight.intensity']);
  held('paramRowProblems', 'a parameter refused with no reason', paramRowProblems(edited(right, (c) => { delete objects(c['params'])[3]!['reason']; }), AREA), ['RectAreaLight.height']);
  const manifest: JsonObject = { recipes: { 'familiar.area@1': 'area@1.json' }, aliases: { RectAreaLight: { target: 'familiar.area@1', conversion: 'stated' } } };
  const areaRow: Row = { name: 'RectAreaLight', state: 'mapped', target: 'familiar.area@1', reason: '' };
  held('recipeProblems', 'an alias onto a recipe of the pack', recipeProblems(manifest, areaRow));
  held('recipeProblems', 'a row with no alias', recipeProblems({ recipes: {}, aliases: {} }, areaRow), ['RectAreaLight']);
  held('recipeProblems', 'an alias onto a kind that is no recipe', recipeProblems({ recipes: {}, aliases: { RectAreaLight: { target: 'light.area@1' } } }, { ...areaRow, target: 'light.area@1' }), ['RectAreaLight']);
  if (JSON.stringify(requiredParams(right, { ...AREA, name: 'Fog', requires: { color: 16777215, near: 1 } })) !== JSON.stringify({ color: 16777215 })) out.push('requiredParams writes a parameter the census does not map, or leaves out one it maps');
  const recipes = ['familiar.area@1'];
  held('loweredProblems', 'one light.area@1', loweredProblems(shown('word', { 'word.light': { kind: 'light.area@1', params: {} } }), 'word', AREA, recipes));
  held('loweredProblems', 'two items', loweredProblems(shown('word', { 'word.a': { kind: 'light.area@1' }, 'word.b': { kind: 'light.area@1' } }), 'word', AREA, recipes), ['RectAreaLight', '2 items']);
  held('loweredProblems', 'no item', loweredProblems(shown('other', {}), 'word', AREA, recipes), ['RectAreaLight', '0 items']);
  held('loweredProblems', 'one item of another kind', loweredProblems(shown('word', { 'word.light': { kind: 'light.point@1' } }), 'word', AREA, recipes), ['RectAreaLight', 'light.point@1']);
  held('loweredProblems', 'a lit material', loweredProblems(shown('word', { 'word.m': { kind: 'material@1', params: { unlit: false } } }), 'word', BASIC, recipes), ['MeshBasicMaterial', 'unlit']);
  held('loweredProblems', 'an unlit material', loweredProblems(shown('word', { 'word.m': { kind: 'material@1', params: { unlit: true } } }), 'word', BASIC, recipes));
  held('loweredProblems', 'a recipe of the pack', loweredProblems(shown('word', { 'word.r': { kind: 'familiar.area@1' } }), 'word', { ...AREA, kind: '' }, recipes), ['RectAreaLight', 'a recipe of the pack']);
  held('loweredProblems', 'a revision refused', loweredProblems(shown('word', { 'word.light': { kind: 'light.area@1' } }, { outcome: 'refused', issues: [{ code: 'out_of_range', severity: 'error', path: 'items/word/params/width' }] }), 'word', AREA, recipes), ['RectAreaLight', 'not presented']);
  held('loweredProblems', 'an item skipped as an unknown kind', loweredProblems(shown('word', { 'word.light': { kind: 'light.area@1' } }, { notices: [{ code: 'unknown_kind', path: 'items/word.light/kind' }] }), 'word', AREA, recipes), ['RectAreaLight', 'unknown kind']);
  const effect: JsonObject = { code: 'out_of_range', severity: 'error', path: 'recipes/familiar.area@1', actual: { part: 'field.effect', field: 'gloss', tried: [0, 1] }, what: 'field `gloss` leaves the evaluated frame unchanged' };
  held('inertProblems', 'refused by field.effect naming the field', inertProblems({ outcome: 'refused', issues: [effect] }, 'gloss'));
  held('inertProblems', 'installed', inertProblems({ outcome: 'installed', issues: [] }, 'gloss'), ['gloss', 'not refused']);
  held('inertProblems', 'refused for another field', inertProblems({ outcome: 'refused', issues: [effect] }, 'sheen'), ['sheen']);
  held('inertProblems', 'refused by another rule', inertProblems({ outcome: 'refused', issues: [{ code: 'out_of_range', severity: 'error', path: 'census/gloss', what: 'gloss' }] }, 'gloss'), ['gloss', 'field.effect']);

  // AC3
  const refusedCensus = plantedCensus(3, 'refused');
  const scene: Row = { name: 'Scene', state: 'refused', reason: 'no_counterpart', target: 'group@1' };
  held('refusedRowProblems', 'a row refused with a reason and a target', refusedRowProblems(refusedCensus, 'Scene'));
  held('refusedRowProblems', 'an open row', refusedRowProblems(plantedCensus(3, 'open'), 'Scene'), ['Scene is open']);
  held('refusedRowProblems', 'a refusal with no target', refusedRowProblems(edited(refusedCensus, (c) => { delete objects(c['names']).find((r) => r['name'] === 'Scene')!['target']; }), 'Scene'), ['Scene', 'target']);
  held('refusedRowProblems', 'a refusal with a reason off the list', refusedRowProblems(edited(refusedCensus, (c) => { objects(c['names']).find((r) => r['name'] === 'Scene')!['reason'] = 'unwanted'; }), 'Scene'), ['Scene', 'unwanted']);
  const close: JsonObject = { name: PACK, refuses: 'Scene', reason: 'no_counterpart', target: 'group@1' };
  const fix = `${PACK} refuses \`Scene\`: no_counterpart; write group@1 instead.`;
  const refusal = (issue: JsonObject, more: JsonObject = {}): JsonObject => ({ outcome: 'refused', issues: [{ code: 'out_of_range', severity: 'error', path: 'items/word/kind', actual: 'Scene', ...issue }], notices: [], expansions: [], ...more });
  held('refusalProblems', 'refused with the name, its reason and its target', refusalProblems(refusal({ close: [close], fix }), 'word', scene, PACK));
  held('refusalProblems', 'the base: refused as text that is no kind, with no close name', refusalProblems(refusal({ what: 'not family.name@major', fix: '' }), 'word', scene, PACK), ['Scene', 'no_counterpart', 'group@1']);
  held('refusalProblems', 'another reason', refusalProblems(refusal({ close: [{ ...close, reason: 'renderer' }], fix }), 'word', scene, PACK), ['Scene']);
  held('refusalProblems', 'no target in the close entry', refusalProblems(refusal({ close: [{ name: PACK, refuses: 'Scene', reason: 'no_counterpart' }], fix }), 'word', scene, PACK), ['Scene']);
  held('refusalProblems', 'a fix that names no target', refusalProblems(refusal({ close: [close], fix: `${PACK} refuses \`Scene\`: no_counterpart.` }), 'word', scene, PACK), ['Scene']);
  held('refusalProblems', 'a pack that maps the word', refusalProblems(refusal({ close: [{ name: PACK, maps: 'Scene', target: 'familiar.scene@1', conversion: 'stated' }], fix: `${PACK} maps \`Scene\` to familiar.scene@1` }), 'word', scene, PACK), ['Scene']);
  held('refusalProblems', 'an issue at another path', refusalProblems({ outcome: 'refused', issues: [{ code: 'out_of_range', path: 'items/word/params/x', close: [close], fix }] }, 'word', scene, PACK), ['Scene', 'items/word/kind']);
  held('refusalProblems', 'a revision presented', refusalProblems(refusal({ close: [close], fix }, { outcome: 'presented' }), 'word', scene, PACK), ['Scene', 'presented']);
  held('refusalProblems', 'the word drawn', refusalProblems(refusal({ close: [close], fix }, { expansions: [{ instance: 'word', derived: { 'word.g': { kind: 'group@1' } } }] }), 'word', scene, PACK), ['Scene', 'drawn']);

  // AC4
  for (const light of lights) {
    const convert = CONVERSIONS[light.name];
    for (const c of light.cases) {
      const item = (params: JsonObject): JsonObject => shown(c.id, { [`${c.id}.light`]: { kind: light.kind, params } });
      held('lightProblems', `${light.name} ${c.id} as derived`, lightProblems(item(convert ? convert(c.params) : {}), c.id, light, c, t));
      const copied = Object.fromEntries(Object.keys(light.fields).map((name) => [name, Array.isArray(c.ours[name]) ? (c.ours[name] as JsonValue[]).map(() => c.library) : c.library]));
      const naming = [light.name, libraryText(light, c), ...oursText(light, c)];
      if (!light.sameNumber) held('lightProblems', `${light.name} ${c.id} with its number copied`, lightProblems(item(copied), c.id, light, c, t), naming);
      held('lightProblems', `${light.name} ${c.id} with no number`, lightProblems(item({}), c.id, light, c, t), naming);
      held('lightProblems', `${light.name} ${c.id} lowered to nothing`, lightProblems(shown('other', {}), c.id, light, c, t), naming);
      held('lightProblems', `${light.name} ${c.id} one part in a million off`, lightProblems(item(Object.fromEntries(Object.entries(convert ? convert(c.params) : {}).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => (x as number) * 1.000001) : (v as number) * 1.000001]))), c.id, light, c, t), naming);
    }
  }

  // AC5
  const mappedAnswer: JsonObject = { word: 'RectAreaLight', state: 'mapped', target: 'familiar.area@1', conversion: 'stated', pack: PACK };
  const mappedCensus = edited(right, (c) => { objects(c['names']).find((r) => r['name'] === 'RectAreaLight')!['target'] = 'familiar.area@1'; });
  held('wordProblems', 'a mapped word answered with its recipe', wordProblems(mappedAnswer, 'RectAreaLight', mappedCensus, manifest));
  held('wordProblems', 'a mapped word answered open', wordProblems({ word: 'RectAreaLight', state: 'open', pack: PACK }, 'RectAreaLight', mappedCensus, manifest), ['RectAreaLight']);
  held('wordProblems', 'a mapped word answered with another target', wordProblems({ ...mappedAnswer, target: 'light.area@1' }, 'RectAreaLight', mappedCensus, manifest), ['RectAreaLight']);
  held('wordProblems', 'a mapped word with no recipe behind it', wordProblems(mappedAnswer, 'RectAreaLight', mappedCensus, { recipes: {}, aliases: manifest['aliases']! }), ['RectAreaLight', 'no recipe']);
  const refusedAnswer: JsonObject = { word: 'Scene', state: 'refused', reason: 'no_counterpart', target: 'group@1', pack: PACK };
  held('wordProblems', 'a refused word answered with its refusal', wordProblems(refusedAnswer, 'Scene', refusedCensus, manifest));
  held('wordProblems', 'a refused word answered with no reason', wordProblems({ word: 'Scene', state: 'refused', target: 'group@1' }, 'Scene', refusedCensus, manifest), ['Scene']);
  held('wordProblems', 'a refused word answered with no target', wordProblems({ word: 'Scene', state: 'refused', reason: 'no_counterpart' }, 'Scene', refusedCensus, manifest), ['Scene']);
  held('wordProblems', 'a refused word answered no_match', wordProblems({ word: 'Scene', code: 'no_match' }, 'Scene', refusedCensus, manifest), ['Scene']);
  held('wordProblems', 'the merge base: a word of the twenty still open', wordProblems({ word: 'Scene', state: 'open', pack: PACK }, 'Scene', plantedCensus(3, 'open'), manifest), ['Scene', 'open in the census']);
  held('openWordProblems', 'an open word answered open', openWordProblems({ word: 'Open0', state: 'open', pack: PACK }, 'Open0'));
  held('openWordProblems', 'an open word answered no_match', openWordProblems({ word: 'Open0', code: 'no_match' }, 'Open0'), ['Open0']);
  held('openWordProblems', 'an open word answered with nothing', openWordProblems({}, 'Open0'), ['Open0']);
  held('openWordProblems', 'an open word answered with no state', openWordProblems({ word: 'Open0', pack: PACK }, 'Open0'), ['Open0']);
  if (openWord(right, [...TWENTY, SHADER_TEXT]) !== 'Open0' || openWord(plantedCensus(0, 'mapped'), TWENTY) !== undefined) out.push('openWord misreads a planted census');
  return out;
}
