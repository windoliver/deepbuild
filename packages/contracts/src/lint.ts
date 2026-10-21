import { isNullBranch, isObject, resolveRef, segment, type JsonValue, type Schema, type SchemaEntry } from './json.js';
import { compilePattern } from './pattern.js';
import { isPublished, isUntouched } from './schemas.js';
import { FORMATS } from './validate.js';

export interface LintProblem { schema: string; path: string; reason: string }

const ANNOTATIONS = ['title', 'description', 'examples', '$comment'];
const ROOT_ONLY = ['$defs', 'x-hash', 'x-feeds', 'x-closure', 'x-rules'];
/** The keywords each closed node type may use besides its annotations. */
const NODE_KEYWORDS: Record<string, string[]> = {
  string: ['type', 'pattern', 'minLength', 'maxLength', 'enum', 'format', 'x-closure'],
  integer: ['type', 'minimum', 'maximum'],
  number: ['type', 'minimum', 'maximum'],
  boolean: ['type'],
  array: ['type', 'items', 'minItems', 'maxItems'],
  record: ['type', 'properties', 'required', 'additionalProperties'],
  map: ['type', 'propertyNames', 'additionalProperties'],
};
const NUMBER_KEYWORDS = ['minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems'];
const COUNT_KEYWORDS = ['minLength', 'maxLength', 'minItems', 'maxItems'];
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/** Why a pattern can't be used, or undefined: it must compile in JavaScript with `u` and for the Rust matcher. */
const verdicts = new Map<string, string | undefined>();
const unusable = (pattern: unknown): string | undefined => {
  if (typeof pattern !== 'string') return 'a pattern is a string';
  if (!verdicts.has(pattern)) verdicts.set(pattern, compiles(pattern));
  return verdicts.get(pattern);
};
const compiles = (pattern: string): string | undefined => {
  try {
    new RegExp(pattern, 'u');
  } catch {
    return 'a pattern compiles as a Unicode regular expression';
  }
  try {
    compilePattern(pattern);
  } catch (error) {
    return (error as Error).message;
  }
  return undefined;
};

/** The JSON Pointer of every string or key holding half a surrogate pair, which no Rust string can. */
const halfPairs = (value: JsonValue | undefined, path: string): string[] => {
  const half = (text: string) => /\p{Surrogate}/u.test(text);
  const found: string[] = [];
  // The pointer is built only for a hit; almost every schema has none.
  const walk = (at: JsonValue | undefined, keys: (string | number)[]): void => {
    const here = (key?: string | number) => path + [...keys, ...(key === undefined ? [] : [key])].map(segment).join('');
    if (typeof at === 'string') { if (half(at)) found.push(here()); return; }
    if (Array.isArray(at)) { at.forEach((v, i) => { keys.push(i); walk(v, keys); keys.pop(); }); return; }
    if (!isObject(at)) return;
    for (const [key, child] of Object.entries(at)) {
      if (half(key)) { found.push(here(key)); continue; }
      keys.push(key); walk(child, keys); keys.pop();
    }
  };
  walk(value, []);
  return found;
};

/** Every `$ref` anywhere under a value. */
const refsUnder = (value: JsonValue | undefined): string[] => {
  if (Array.isArray(value)) return value.flatMap(refsUnder);
  if (!isObject(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => (key === '$ref' && typeof child === 'string' ? [child] : refsUnder(child)));
};

/** The definitions a `$ref` chain leads back into; neither the validator's types nor the generators' can hold one. */
function cycles(defs: Schema): string[] {
  const state = new Map<string, 'open' | 'done'>();
  const looped = new Set<string>();
  const visit = (name: string, trail: string[]): void => {
    if (state.get(name) === 'open') {
      for (const n of trail.slice(trail.indexOf(name))) looped.add(n);
      return;
    }
    if (state.get(name) === 'done' || !isObject(defs[name])) return;
    state.set(name, 'open');
    for (const ref of refsUnder(defs[name])) visit(ref.slice('#/$defs/'.length), [...trail, name]);
    state.set(name, 'done');
  };
  for (const name of Object.keys(defs)) visit(name, []);
  return [...looped];
}

/** Whether a JSON Pointer names a place the schema types: a listed property, or `*` for every item. */
function resolves(root: Schema, pointer: string): boolean {
  const walk = (at: Schema, keys: string[]): boolean => {
    while (typeof at.$ref === 'string') at = resolveRef(root, at.$ref);
    // A union types the field only if every branch does.
    if (Array.isArray(at.oneOf)) return at.oneOf.length > 0 && at.oneOf.every((branch) => isObject(branch) && walk(branch, keys));
    if (!keys.length) return true;
    const [key, ...rest] = keys as [string, ...string[]];
    const next = key === '*' ? at.items : isObject(at.properties) && Object.hasOwn(at.properties, key) ? at.properties[key] : undefined;
    return isObject(next) && walk(next, rest);
  };
  return walk(root, pointer.split('/').slice(1).map((raw) => raw.replace(/~1/g, '/').replace(/~0/g, '~')));
}

/**
 * The preflight's lint: every contract schema uses only the closed node types both generators map, and a
 * hashed schema (one with `x-hash`) types no integer that can pass 2^53 as a JSON number.
 */
const linted = new Map<string, LintProblem[]>();
export function lintSchemas(entries: readonly SchemaEntry[]): LintProblem[] {
  const problems: LintProblem[] = [];
  for (const entry of entries) {
    // A schema's problems depend on it alone, so an unchanged schema's are read back, not found again; an
    // untouched published entry is keyed by its name, without reading it.
    const name = entry.name;
    const key = isUntouched(entry) ? `${name}\npublished` : `${name}\n${JSON.stringify(entry.schema)}`;
    const known = linted.get(key);
    if (known) { problems.push(...known.map((p) => ({ ...p }))); continue; }
    const schema = entry.schema;
    const hub = isPublished(name);
    const start = problems.length;
    const flag = (path: string, reason: string): void => { problems.push({ schema: name, path, reason }); };
    const hashed = 'x-hash' in schema;
    const defs = isObject(schema.$defs) ? schema.$defs : {};

    const node = (value: JsonValue | undefined, path: string, root = false): void => {
      if (!isObject(value)) return flag(path, 'a schema here must be an object');
      const allowed = (keys: string[]) => {
        for (const key of Object.keys(value)) {
          if (ANNOTATIONS.includes(key) || keys.includes(key) || (root && ROOT_ONLY.includes(key))) continue;
          flag(path + segment(key), `keyword ${key} is not part of the closed node types`);
        }
        for (const key of NUMBER_KEYWORDS) if (key in value && typeof value[key] !== 'number') flag(path + segment(key), `${key} must be a number`);
        for (const key of COUNT_KEYWORDS) if (typeof value[key] === 'number' && !(Number.isInteger(value[key]) && value[key] >= 0)) flag(path + segment(key), `${key} is a count, a whole number from 0`);
      };
      if (typeof value.$ref === 'string') {
        allowed(['$ref']);
        if (!/^#\/\$defs\/[^/]+$/.test(value.$ref) || !isObject(defs[value.$ref.slice('#/$defs/'.length)])) flag(path + '/$ref', `${value.$ref} names no definition in $defs`);
        return;
      }
      if ('x-opaque' in value) {
        allowed(['x-opaque']);
        if (typeof value['x-opaque'] !== 'string') flag(path + '/x-opaque', 'an opaque value says why it is opaque');
        if (hashed) flag(path, 'a hashed schema types every value; an opaque one has no stable hash');
        return;
      }
      if ('const' in value) return allowed(['const']);
      if ('oneOf' in value) return union(value.oneOf, path, allowed);
      let type = value.type;
      if (Array.isArray(type)) {
        if (type.length !== 2 || !type.includes('null') || type[0] === type[1]) return flag(path + '/type', 'a type list is one type beside null');
        if ('enum' in value) flag(path + '/enum', 'an enum beside null: make the enum its own node, nullable where it is used');
        type = type.find((t) => t !== 'null')!;
      }
      if (typeof type !== 'string') return flag(path, 'no closed node type: give type, const, oneOf or $ref');
      if (type === 'object') return object(value, path, allowed);
      const keywords = Object.hasOwn(NODE_KEYWORDS, type) ? NODE_KEYWORDS[type] : undefined;
      if (!keywords) return flag(path + '/type', `type ${type} is not a closed node type`);
      allowed(keywords);
      if (type === 'string') {
        const why = 'pattern' in value ? unusable(value.pattern) : undefined;
        if (why) flag(path + '/pattern', why);
        if ('enum' in value && !(Array.isArray(value.enum) && value.enum.length && value.enum.every((v) => typeof v === 'string'))) flag(path + '/enum', 'an enum lists strings');
        else if (Array.isArray(value.enum) && new Set(value.enum).size !== value.enum.length) flag(path + '/enum', 'an enum lists each value once');
        if ('format' in value && !(typeof value.format === 'string' && Object.hasOwn(FORMATS, value.format))) flag(path + '/format', `format ${JSON.stringify(value.format)} is not a listed format`);
        // Every enum in the hub's schemas says how its set closes (#313); a schema outside them need not.
        if (hub && 'enum' in value && !('x-closure' in value)) flag(path, 'an enum in the hub\'s schemas carries x-closure: a registry, closed with its reason, what reopens it and its mark, or open');
        if ('x-closure' in value) closure(value, path);
      }
      if (type === 'array') node(value.items, path + '/items');
      const safe = typeof value.maximum === 'number' && value.maximum <= MAX_SAFE && typeof value.minimum === 'number' && value.minimum >= -MAX_SAFE;
      if (hashed && (type === 'integer' || type === 'number') && !safe) {
        flag(path, 'a hashed integer that can pass ±2^53 is a decimal string, or gives bounds within ±(2^53 - 1)');
      }
    };

    const object = (value: Schema, path: string, allowed: (keys: string[]) => void): void => {
      if (isObject(value.properties)) {
        allowed(NODE_KEYWORDS.record!);
        if (value.additionalProperties !== false) flag(path + ('additionalProperties' in value ? '/additionalProperties' : ''), 'an object lists its properties and allows no others');
        const required = Array.isArray(value.required) ? value.required : [];
        if ('required' in value && !Array.isArray(value.required)) flag(path + '/required', 'required is a list');
        for (const key of required) if (typeof key !== 'string' || !Object.hasOwn(value.properties, key)) flag(path + '/required', `required names ${JSON.stringify(key)}, which is not a listed property`);
        for (const [key, child] of Object.entries(value.properties)) node(child, path + '/properties' + segment(key));
      } else if (isObject(value.propertyNames) && isObject(value.additionalProperties)) {
        allowed(NODE_KEYWORDS.map!);
        const names = value.propertyNames;
        const why = unusable(names.pattern);
        if (Object.keys(names).some((k) => k !== 'pattern') || why) flag(path + '/propertyNames', `a map's keys take only a pattern: ${why ?? 'no other keyword'}`);
        node(value.additionalProperties, path + '/additionalProperties');
      } else {
        allowed([...NODE_KEYWORDS.record!, 'propertyNames']);
        flag(path + (value.additionalProperties === true ? '/additionalProperties' : ''), 'an open object: list its properties with additionalProperties false, or make it a map with propertyNames');
      }
    };

    const union = (all: JsonValue | undefined, path: string, allowed: (keys: string[]) => void): void => {
      allowed(['oneOf']);
      // One branch may be `{"type": "null"}`, which makes the union nullable, as a type list does a type.
      const nulls = Array.isArray(all) ? all.flatMap((b, i) => (isNullBranch(b) ? [i] : [])) : [];
      const branches = Array.isArray(all) ? all.filter((b) => !isNullBranch(b)) : [];
      if (!Array.isArray(all) || branches.length < 2) return flag(path + '/oneOf', 'a union has two or more branches besides null');
      if (nulls.length > 1) flag(path + '/oneOf', 'a union has at most one null branch');
      for (const i of nulls) for (const key of Object.keys(all[i] as Schema)) if (key !== 'type' && !ANNOTATIONS.includes(key)) flag(`${path}/oneOf/${i}${segment(key)}`, 'a null branch takes only its type');
      all.forEach((branch, i) => { if (!nulls.includes(i)) node(branch, `${path}/oneOf/${i}`); });
      const tagged = (b: JsonValue, key: string) => isObject(b) && isObject(b.properties) && Object.hasOwn(b.properties, key) && isObject(b.properties[key]) && 'const' in b.properties[key]
        && Array.isArray(b.required) && b.required.includes(key);
      const first = branches[0];
      const tags = isObject(first) && isObject(first.properties) ? Object.keys(first.properties).filter((key) => branches.every((b) => tagged(b, key))) : [];
      if (tags.length !== 1) return flag(path + '/oneOf', 'a union is told apart by exactly one required constant field');
      const values = branches.map((b) => ((b as Schema).properties as Schema)[tags[0]!] as Schema).map((s) => s.const);
      if (!(values.every((v) => typeof v === 'string') || values.every((v) => typeof v === 'boolean'))) flag(path + '/oneOf', "a union's tag is a string in every branch, or a boolean in every branch");
      else if (new Set<JsonValue | undefined>(values).size !== values.length) flag(path + '/oneOf', "a union's branches each take their own tag");
    };

    /** The closure beside a listed set: open, a registry, or closed with its reason, what reopens it and its mark. */
    const closure = (value: Schema, path: string): void => {
      const c = value['x-closure'];
      const at = path + '/x-closure';
      if (c === 'open') return;
      if (!isObject(c)) return flag(at, "x-closure is 'open', {registry}, or {closed, reopens, mark}");
      if ('registry' in c) {
        if (Object.keys(c).length !== 1 || typeof c.registry !== 'string' || !/^[a-z][a-z0-9.-]*@[1-9][0-9]*$/.test(c.registry)) flag(at, 'a registry closure names the registry, <name>@<major>, and nothing else');
        return;
      }
      if (typeof c.closed !== 'string' || !c.closed || typeof c.reopens !== 'string' || !c.reopens) return flag(at, 'a closed closure says why it is closed and what would reopen it');
      if (c.mark !== 'exhaustive' && c.mark !== 'extensible') return flag(at, 'a closed enum says which it is: mark exhaustive or extensible');
      if (Object.keys(c).length !== 3) return flag(at, 'a closed closure is {closed, reopens, mark} and nothing else');
      if (c.mark === 'extensible' && Array.isArray(value.enum) && !value.enum.includes('unknown')) flag(path + '/enum', "an extensible enum lists unknown, which a reader takes for a member it doesn't know");
    };
    for (const path of halfPairs(schema, '')) flag(path, 'half a surrogate pair: every string in a schema is well-formed Unicode');
    node(schema, '', true);
    if ('x-closure' in schema && !('enum' in schema)) closure(schema, '');
    if ('x-rules' in schema) {
      const rules = schema['x-rules'];
      if (!Array.isArray(rules) || !rules.every((r) => isObject(r) && typeof r.id === 'string' && /^[a-z][a-z0-9_-]*$/.test(r.id) && typeof r.rule === 'string' && r.rule.length > 0 && Object.keys(r).length === 2)) flag('/x-rules', 'x-rules lists the rules as {id, rule}, each id ^[a-z][a-z0-9_-]*$');
      else if (new Set(rules.map((r) => (r as Schema).id)).size !== rules.length) flag('/x-rules', 'x-rules gives each rule its own id');
    }
    for (const [key, def] of Object.entries(defs)) node(def, '/$defs' + segment(key));
    for (const key of cycles(defs)) flag('/$defs' + segment(key), 'a $ref cycle: a definition reaches itself');
    if ('x-feeds' in schema && !(Array.isArray(schema['x-feeds']) && schema['x-feeds'].every((f) => typeof f === 'string'))) flag('/x-feeds', 'x-feeds lists projection names');
    const marker = schema['x-hash'];
    if ('x-hash' in schema && !(isObject(marker) && Array.isArray(marker.excludes) && marker.excludes.every((p) => typeof p === 'string' && p.startsWith('/')))) {
      flag('/x-hash', 'x-hash lists the JSON Pointers its hash leaves out, as excludes');
    } else if (isObject(marker) && Array.isArray(marker.excludes) && !cycles(defs).length) {
      for (const pointer of marker.excludes as string[]) {
        // A trailing `*` names every item of an array, not a field; to leave the array out, exclude the array.
        if (pointer.endsWith('/*')) { flag('/x-hash', `x-hash excludes ${pointer}, which ends in every item of an array, not at a field; exclude ${pointer.slice(0, -2)}`); continue; }
        let found = false;
        try { found = resolves(schema, pointer); } catch { /* a $ref already flagged */ }
        if (!found) flag('/x-hash', `x-hash excludes ${pointer}, which names no field the schema types`);
      }
    }
    if (linted.size >= 4096) linted.clear();
    linted.set(key, problems.slice(start).map((p) => ({ ...p })));
  }
  return problems;
}
