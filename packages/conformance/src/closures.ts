// Closures (#313, AC4 and AC13): the contract step a minor may take under one name, and what a reader built at
// an earlier minor sees of a later value: a member it doesn't know of an extensible enum reads unknown.
import { isUntouched } from '@deepbuild/contracts';
import type { JsonValue, Schema, SchemaEntry } from '@deepbuild/contracts';
import { segment } from './pointer.js';
import { isObject } from './types.js';
import type { Change, Closure } from './types.js';

const mark = (closure: Closure | undefined): 'exhaustive' | 'extensible' | undefined => (isObject(closure as JsonValue) && 'closed' in (closure as object) ? (closure as { mark: 'exhaustive' | 'extensible' }).mark : undefined);

/** The listed property names of a record node, or none for any other node. */
const properties = (node: JsonValue | undefined): string[] => (isObject(node) && isObject(node.properties) ? Object.keys(node.properties) : []);
const required = (node: JsonValue | undefined): string[] => (isObject(node) && Array.isArray(node.required) ? node.required.map(String) : []);

/**
 * The changes `after` makes to a schema `before` has under the same name that a minor may not make: a member
 * added to an exhaustive enum, a member removed from any enum, a field removed, a field made or added as
 * required, or a node retyped or narrowed (a new enum, pattern, format, fixed value or tighter bound). A
 * name only `after` has is a new entry and takes no step.
 */
export function contractStep(before: readonly SchemaEntry[], after: readonly SchemaEntry[]): Change[] {
  const changes: Change[] = [];
  for (const earlierEntry of before) {
    const name = earlierEntry.name;
    const laterEntry = after.find((e) => e.name === name);
    // An unchanged schema takes no step; skipping it keeps a whole-registry step cheap.
    if (!laterEntry) { changes.push({ schema: name, path: '', reason: 'the schema removed: a new major' }); continue; }
    if (isUntouched(earlierEntry) && isUntouched(laterEntry)) continue;
    const was = earlierEntry.schema;
    const now = laterEntry.schema;
    if (JSON.stringify(now) === JSON.stringify(was)) continue;
    // A value an earlier reader or writer took that the later schema refuses, walked through the places a value
    // takes: a field removed or made required, a node retyped or narrowed, a union branch removed.
    paired(was, now, was, now, '', (path, reason) => changes.push({ schema: name, path, reason: `${reason}: a new major` }), 0);
  }
  return changes;
}

/**
 * Walks an earlier and a later schema together through the places a value takes (record fields, items, map
 * values, union branches matched by their tag), each node resolved through `$ref`, so a keyword is never read
 * from a map of property names and an inlined definition compares as itself.
 */
function paired(rootWas: Schema, rootNow: Schema, was: JsonValue | undefined, now: JsonValue | undefined, pointer: string, push: (path: string, reason: string) => void, depth: number): void {
  const a = resolve(rootWas, was);
  const b = resolve(rootNow, now);
  if (!isObject(a) || !isObject(b) || depth > 64) return;
  if (Array.isArray(a.oneOf) || Array.isArray(b.oneOf)) {
    if (!Array.isArray(a.oneOf) || !Array.isArray(b.oneOf)) return push(pointer, Array.isArray(b.oneOf) ? 'made a union' : 'no longer a union');
    // Both unions are keyed by one tag field, chosen over the branches of both.
    const key = tagKey([[rootWas, a.oneOf], [rootNow, b.oneOf]]);
    const later = branches(rootNow, b.oneOf, key);
    const earlier = branches(rootWas, a.oneOf, key);
    for (const [tag, { index, node }] of earlier) {
      const match = later.get(tag);
      if (!match) push(`${pointer}/oneOf/${index}`, `the ${tag} branch removed`);
      else paired(rootWas, rootNow, node, match.node, `${pointer}/oneOf/${index}`, push, depth + 1);
    }
    // A tagged branch added is a member added to the union's set of tags: a reader at the earlier minor has no
    // branch to read it by, unless the union has an unknown branch, which makes its tags extensible.
    if (key !== undefined && !earlier.has(`${key}="unknown"`)) for (const [tag, { index }] of later) if (!earlier.has(tag)) push(`${pointer}/oneOf/${index}`, `the ${tag} branch added to a closed union`);
    return;
  }
  const narrowed = narrowing(a, b);
  if (narrowed) push(pointer, narrowed);
  if (Array.isArray(a.enum) && Array.isArray(b.enum)) {
    const added = b.enum.filter((v) => !(a.enum as JsonValue[]).includes(v));
    const removed = a.enum.filter((v) => !(b.enum as JsonValue[]).includes(v));
    if (added.length && mark(a['x-closure'] as Closure | undefined) !== 'extensible') push(`${pointer}/enum`, `${added.join(', ')} added to an enum not marked extensible (or mark the set extensible with unknown)`);
    if (removed.length) push(`${pointer}/enum`, `${removed.join(', ')} removed from an enum`);
    const marks = [mark(a['x-closure'] as Closure | undefined), mark(b['x-closure'] as Closure | undefined)];
    if (marks[0] !== undefined && marks[0] !== marks[1]) push(`${pointer}/x-closure`, `the closure mark changed from ${marks[0]} to ${marks[1] ?? 'none'}`);
  }
  for (const key of properties(a)) if (!properties(b).includes(key)) push(`${pointer}/properties${segment(key)}`, 'a field removed');
  for (const key of required(b)) if (!required(a).includes(key)) push(`${pointer}/required`, `${key} ${properties(a).includes(key) ? 'made required' : 'added as a required field'}`);
  if (isObject(a.properties) && isObject(b.properties)) {
    for (const [key, child] of Object.entries(a.properties)) if (Object.hasOwn(b.properties, key)) paired(rootWas, rootNow, child, b.properties[key], `${pointer}/properties${segment(key)}`, push, depth + 1);
  }
  if (isObject(a.items) && isObject(b.items)) paired(rootWas, rootNow, a.items, b.items, `${pointer}/items`, push, depth + 1);
  if (isObject(a.propertyNames) && isObject(b.propertyNames)) paired(rootWas, rootNow, a.propertyNames, b.propertyNames, `${pointer}/propertyNames`, push, depth + 1);
  else if (isObject(b.propertyNames)) push(`${pointer}/propertyNames`, 'map keys given a rule');
  if (isObject(a.additionalProperties) && isObject(b.additionalProperties)) paired(rootWas, rootNow, a.additionalProperties, b.additionalProperties, `${pointer}/additionalProperties`, push, depth + 1);
}

const constOf = (node: JsonValue | undefined, key: string): JsonValue | undefined => {
  const p = isObject(node) && isObject(node.properties) ? node.properties[key] : undefined;
  return isObject(p) && 'const' in p ? p.const : undefined;
};

/** Unions' tag field: the const field every non-null branch of each carries with a value of its own in it. */
function tagKey(unions: [Schema, JsonValue[]][]): string | undefined {
  const each = unions.map(([root, list]) => list.map((branch) => resolve(root, branch)).filter((n) => isObject(n) && n.type !== 'null'));
  const keys = [...new Set(each.flat().flatMap((n) => (isObject(n) && isObject(n.properties) ? Object.keys(n.properties) : [])))];
  return keys.find((k) => each.every((tagged) => tagged.every((n) => constOf(n, k) !== undefined) && new Set(tagged.map((n) => JSON.stringify(constOf(n, k)))).size === tagged.length));
}

/** A union's branches by tag: the tag field's value, null for the null branch, else the position. */
function branches(root: Schema, list: JsonValue[], key: string | undefined): Map<string, { index: number; node: JsonValue }> {
  const out = new Map<string, { index: number; node: JsonValue }>();
  const nodes = list.map((branch) => resolve(root, branch));
  nodes.forEach((node, index) => {
    const tag = isObject(node) && node.type === 'null' ? 'null' : key !== undefined ? `${key}=${JSON.stringify(constOf(node, key))}` : `#${index}`;
    out.set(tag, { index, node: list[index]! });
  });
  return out;
}

const LOWER = ['minLength', 'minItems', 'minimum'] as const;
const UPPER = ['maxLength', 'maxItems', 'maximum'] as const;
/** How the later node refuses what the earlier took, or undefined when it doesn't narrow it. */
function narrowing(was: { [k: string]: JsonValue }, now: { [k: string]: JsonValue }): string | undefined {
  if (JSON.stringify(was.type) !== JSON.stringify(now.type)) return `retyped from ${JSON.stringify(was.type ?? null)} to ${JSON.stringify(now.type ?? null)}`;
  if ('const' in now && JSON.stringify(was.const) !== JSON.stringify(now.const)) return 'given a fixed value';
  if (Array.isArray(now.enum) && !Array.isArray(was.enum)) return 'narrowed to an enum';
  for (const key of ['pattern', 'format'] as const) if (key in now && now[key] !== was[key]) return `given a new ${key}`;
  for (const key of LOWER) if (typeof now[key] === 'number' && !(typeof was[key] === 'number' && was[key] >= now[key])) return `${key} raised`;
  for (const key of UPPER) if (typeof now[key] === 'number' && !(typeof was[key] === 'number' && was[key] <= now[key])) return `${key} lowered`;
  if (now.additionalProperties === false && was.additionalProperties !== false && isObject(was.properties)) return 'closed to unlisted fields';
  if (now.additionalProperties === false && isObject(was.additionalProperties)) return 'a map closed to listed fields';
  return undefined;
}

/** Follows a `$ref` to its definition. */
const resolve = (root: Schema, node: JsonValue | undefined): JsonValue | undefined => {
  let at = node;
  for (let hops = 0; isObject(at) && typeof at.$ref === 'string' && hops < 32; hops++) {
    const defs = isObject(root.$defs) ? root.$defs : {};
    at = defs[at.$ref.replace(/^#\/\$defs\//, '')];
  }
  return at;
};

/**
 * What a reader built at `schema` sees of `value`: a member of an extensible enum it doesn't know reads
 * unknown, and a field a record doesn't list is left out. Everything the schema knows is as it was.
 */
export function serveAt(schema: Schema, value: JsonValue): JsonValue {
  const serve = (node: JsonValue | undefined, v: JsonValue): JsonValue => {
    const s = resolve(schema, node);
    if (!isObject(s)) return v;
    if (Array.isArray(s.oneOf)) {
      const branches = s.oneOf.map((b) => resolve(schema, b)).filter(isObject);
      const tag = isObject(v) ? branches.find((b) => isObject(b.properties) && Object.entries(b.properties).some(([k, p]) => isObject(p) && 'const' in p && isObject(v) && v[k] === p.const)) : undefined;
      if (tag) return serve(tag, v);
      // An unlisted tag of a union with an unknown branch reads as that branch, as an extensible enum's member does.
      const key = tagKey([[schema, s.oneOf]]);
      const unknown = key !== undefined ? branches.find((b) => constOf(b, key) === 'unknown') : undefined;
      return unknown && isObject(v) && key !== undefined && typeof v[key] === 'string' ? serve(unknown, { ...v, [key]: 'unknown' }) : v;
    }
    if (typeof v === 'string' && Array.isArray(s.enum) && !s.enum.includes(v)) return mark(s['x-closure'] as Closure | undefined) === 'extensible' && s.enum.includes('unknown') ? 'unknown' : v;
    if (Array.isArray(v) && isObject(s.items)) return v.map((item) => serve(s.items, item));
    if (isObject(v) && isObject(s.properties)) {
      const out: { [k: string]: JsonValue } = {};
      for (const [key, child] of Object.entries(v)) if (Object.hasOwn(s.properties, key) || s.additionalProperties !== false) out[key] = Object.hasOwn(s.properties, key) ? serve(s.properties[key], child) : child;
      return out;
    }
    if (isObject(v) && isObject(s.additionalProperties)) return Object.fromEntries(Object.entries(v).map(([key, child]) => [key, serve(s.additionalProperties, child)]));
    return v;
  };
  return serve(schema, structuredClone(value));
}
