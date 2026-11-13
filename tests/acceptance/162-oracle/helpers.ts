// Test-side tools for the #162 Oracle lane: the upstream files vendored in vendor/ (NOTICE.md), read at run time; the
// Lottie spec's schema validation as its own test runs it (tests/validate_animations.test.js: the 1.0.1 schema compiled
// by a JSON Schema 2020-12 validator with the `$version` keyword), its schema merged from its parts here as the spec's
// build does it (each part under `$defs.<folder>.<name>`, and the unknown shape and layer types' `enum`, which the build
// fills with every type the parts define); the walk that names a layer or shape type the schema doesn't define; and the
// colours and expressions a Lottie file holds, for the import's judges. Everything else, the surfaces, the documents
// and the readers, is the #162 suite's (`../162/helpers.ts`).

import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isObject, type JsonObject, type JsonValue } from '../162/helpers.ts';

export * from '../162/helpers.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The Lottie spec at 4b55957472 (vendor/NOTICE.md). */
const SPEC = join(HERE, 'vendor', 'lottie-spec-4b55957472');
/** The upstream renderer's test corpus at bede03d25d (vendor/NOTICE.md). */
export const CORPUS = join(HERE, 'vendor', 'lottie-web-bede03d25d', 'test', 'animations');
export const EXAMPLES = join(SPEC, 'docs', 'static', 'examples');
/** The spec's 20 examples, by file name. */
export const exampleNames = (): string[] => readdirSync(EXAMPLES).filter((f) => f.endsWith('.json')).sort();
export const readJson = (path: string): JsonObject => JSON.parse(readFileSync(path, 'utf8')) as JsonObject;
export const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ---------------------------------------------------------------------------------------------------
// The schema, merged from its parts, and the upstream validation

interface Validator { (data: unknown): boolean; errors?: unknown[] | null }
interface Compiler { compile(schema: unknown): Validator }
const require = createRequire(import.meta.url);

/** The `ty` constants the schema parts of one folder define, the unknown type's own part left out. */
function typesOf(parts: Record<string, JsonObject>, unknown: string): JsonValue[] {
  const out: JsonValue[] = [];
  const walk = (v: JsonValue | undefined): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isObject(v)) {
      const props = v['properties'];
      if (isObject(props) && isObject(props['ty']) && 'const' in props['ty']) out.push(props['ty']['const']!);
      Object.values(v).forEach(walk);
    }
  };
  for (const [name, part] of Object.entries(parts)) if (name !== unknown) walk(part);
  return [...new Set(out.map((x) => JSON.stringify(x)))].map((x) => JSON.parse(x) as JsonValue);
}
let merged: { schema: JsonObject; shapes: JsonValue[]; layers: JsonValue[] } | undefined;
/** The 1.0.1 schema: root.json with every part under `$defs.<folder>.<name>`, and the types it defines. */
export function schema(): { schema: JsonObject; shapes: JsonValue[]; layers: JsonValue[] } {
  if (merged) return merged;
  const root = readJson(join(SPEC, 'schema', 'root.json'));
  const defs: Record<string, Record<string, JsonObject>> = {};
  for (const dir of readdirSync(join(SPEC, 'schema'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    defs[dir] = {};
    for (const f of readdirSync(join(SPEC, 'schema', dir)).filter((x) => x.endsWith('.json')).sort()) {
      const part = readJson(join(SPEC, 'schema', dir, f));
      delete part['$schema'];
      defs[dir]![f.slice(0, -5)] = part;
    }
  }
  const shapes = typesOf(defs['shapes']!, 'unknown-shape');
  const layers = typesOf(defs['layers']!, 'unknown-layer');
  ((defs['shapes']!['unknown-shape']!['properties'] as JsonObject)['ty'] as JsonObject)['not'] = { enum: shapes };
  ((defs['layers']!['unknown-layer']!['properties'] as JsonObject)['ty'] as JsonObject)['not'] = { enum: layers };
  root['$defs'] = defs as unknown as JsonObject;
  merged = { schema: root, shapes, layers };
  return merged;
}
let validator: Validator | undefined;
/** validate_animations.test.js's validator: the schema compiled by the JSON Schema 2020-12 validator it requires, with
 * the keyword `$version` (the repo's own copy in node_modules, a dependency of its dev tools). */
export function validate(data: JsonValue): { valid: boolean; errors: string } {
  if (!validator) {
    let Validator2020: new (o: unknown) => Compiler;
    try {
      const m = require('ajv/dist/2020') as { default?: new (o: unknown) => Compiler } & (new (o: unknown) => Compiler);
      Validator2020 = m.default ?? m;
    } catch (e) {
      throw Error(`BLOCKED: the spec's validation needs a JSON Schema 2020-12 validator and node_modules has none (${(e as Error).message}); this is not a pass. Unblock: npm ci`);
    }
    validator = new Validator2020({ keywords: [{ keyword: '$version' }] }).compile(schema().schema);
  }
  const valid = validator(data);
  return { valid, errors: valid ? '' : JSON.stringify(validator.errors).slice(0, 1500) };
}
/** The upstream test's three sets, as it reads them: the examples and the valid files must pass, the invalid fail.
 * Checked before any of our files is judged, so the port is the upstream test's verdict on upstream's own files. */
export function upstreamVerdicts(): string[] {
  const sets: [string, boolean][] = [['docs/static/examples', true], ['tests/animations/valid', true], ['tests/animations/invalid', false]];
  return sets.flatMap(([dir, want]) => readdirSync(join(SPEC, dir)).filter((f) => f.endsWith('.json')).sort().flatMap((f) => {
    const r = validate(readJson(join(SPEC, dir, f)) as JsonValue);
    return r.valid === want ? [] : [`${dir}/${f}: the upstream test expects ${want ? 'valid' : 'invalid'}, the port reads ${r.valid ? 'valid' : `invalid (${r.errors})`}`];
  }));
}
/** Every layer and shape type in a file that the 1.0.1 schema doesn't define, each named with where it sits. */
export function undefinedTypes(anim: JsonObject): string[] {
  const { shapes, layers } = schema();
  const out: string[] = [];
  const shapeWalk = (list: JsonValue | undefined, where: string): void => {
    for (const s of Array.isArray(list) ? list : []) {
      if (!isObject(s)) continue;
      if (!shapes.includes(s['ty'] as JsonValue)) out.push(`${where}: shape type ${JSON.stringify(s['ty'])}`);
      if (s['ty'] === 'gr') shapeWalk(s['it'], `${where}/${String(s['nm'] ?? 'group')}`);
    }
  };
  const comps: [string, JsonValue | undefined][] = [['root', anim['layers']], ...(Array.isArray(anim['assets']) ? anim['assets'] : []).filter(isObject).filter((a) => Array.isArray(a['layers'])).map((a): [string, JsonValue | undefined] => [`asset ${String(a['id'])}`, a['layers']])];
  for (const [comp, list] of comps) {
    for (const l of Array.isArray(list) ? list : []) {
      if (!isObject(l)) continue;
      const where = `${comp}/${String(l['nm'] ?? l['ind'])}`;
      if (!layers.includes(l['ty'] as JsonValue)) out.push(`${where}: layer type ${JSON.stringify(l['ty'])}`);
      shapeWalk(l['shapes'], where);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// What a Lottie file holds, for the import's judges

/** `#rrggbb` of a colour Lottie writes as 0..1 components. */
const hexOf = (c: number[]): string => `#${c.slice(0, 3).map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('')}`;
const colourValues = (prop: JsonValue | undefined): number[][] => {
  if (!isObject(prop)) return [];
  const k = prop['k'];
  if (Array.isArray(k) && k.length > 0 && isObject(k[0])) return k.filter(isObject).flatMap((key) => [key['s'], key['e']].filter(Array.isArray) as number[][]);
  return Array.isArray(k) ? [k as number[]] : [];
};
/** Every literal colour a file writes: fills' and strokes' `c` (static or each key's), gradients' colour stops and
 * solid layers' `sc`, as `#rrggbb`. */
export function literalColours(anim: JsonObject): string[] {
  const out = new Set<string>();
  const walk = (v: JsonValue | undefined): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!isObject(v)) return;
    if (v['ty'] === 'fl' || v['ty'] === 'st') for (const c of colourValues(v['c'])) out.add(hexOf(c));
    if ((v['ty'] === 'gf' || v['ty'] === 'gs') && isObject(v['g'])) {
      const count = Number(v['g']['p']);
      for (const flat of colourValues(v['g']['k'])) for (let i = 0; i < count; i++) out.add(hexOf(flat.slice(4 * i + 1, 4 * i + 4)));
    }
    if (v['ty'] === 1 && typeof v['sc'] === 'string') out.add(v['sc'].slice(0, 7).toLowerCase());
    Object.values(v).forEach(walk);
  };
  walk(anim);
  return [...out].sort();
}
/** Each layer that carries an expression (a property whose `x` is a string), by name. */
export function layersWith(anim: JsonObject, has: (layer: JsonObject) => boolean): string[] {
  const comps: JsonValue[] = [anim['layers'] ?? [], ...(Array.isArray(anim['assets']) ? anim['assets'] : []).filter(isObject).map((a) => a['layers'] ?? [])];
  return comps.flatMap((list) => (Array.isArray(list) ? list : []).filter(isObject).filter(has).map((l) => String(l['nm'])));
}
const holds = (v: JsonValue | undefined, test: (o: JsonObject) => boolean): boolean => {
  if (Array.isArray(v)) return v.some((x) => holds(x, test));
  if (!isObject(v)) return false;
  return test(v) || Object.values(v).some((x) => holds(x, test));
};
export const hasExpression = (layer: JsonObject): boolean => holds(layer, (o) => typeof o['x'] === 'string' && ('k' in o || 'a' in o));
export const hasMergePath = (layer: JsonObject): boolean => holds(layer['shapes'], (o) => o['ty'] === 'mm');
export const isTextLayer = (layer: JsonObject): boolean => layer['ty'] === 5;
/** The hex literal colours a document writes in its items or channels (names and text left out). */
export function hexLiterals(doc: JsonObject): string[] {
  const out: string[] = [];
  const walk = (v: JsonValue | undefined, key: string): void => {
    if (typeof v === 'string' && key !== 'name' && key !== 'text' && key !== 'description' && /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) out.push(v);
    else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (isObject(v)) for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(doc['items'], 'items'); walk(doc['channels'], 'channels');
  return out;
}
/** Whether two `#rrggbb` colours are within one code value on each channel. */
export const nearColour = (a: string, b: string): boolean => [1, 3, 5].every((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 1);
