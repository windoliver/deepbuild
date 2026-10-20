export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
/** One JSON Schema document. */
export type Schema = JsonObject;
export interface SchemaEntry { name: string; schema: Schema }

export const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** How deep a document may nest, counted from its root, as deep-contracts' parser counts it. */
const MAX_DEPTH = 256;

/** An object JSON writes as an object: one whose prototype is Object's, or none. */
export const isPlainObject = (value: unknown): value is JsonObject => {
  if (!isObject(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
};

// A cheap test first, since nearly every string holds no surrogate at all.
const halfPair = (text: string): boolean => /[\uD800-\uDFFF]/.test(text) && /\p{Surrogate}/u.test(text);

/** Where a walk stopped: the keys from the root down to the first value that isn't JSON, deepest last. */
type Found = { keys: (string | number)[]; value: unknown };
const REFUSED: unique symbol = Symbol('refused');

// Each property and index is read once, into a plain copy, so a getter or a proxy can't answer the check
// one way and the writer another.
function copy(value: unknown, depth: number, stop: { found?: Found }): JsonValue | typeof REFUSED {
  const refuse = (at: unknown): typeof REFUSED => ((stop.found = { keys: [], value: at }), REFUSED);
  if (depth > MAX_DEPTH) return refuse(value);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : refuse(value);
  if (typeof value === 'string') return halfPair(value) ? refuse(value) : value;
  if (Array.isArray(value)) {
    const out: JsonValue[] = [];
    for (let i = 0, n = value.length; i < n; i++) {
      const item = Object.hasOwn(value, i) ? copy(value[i], depth + 1, stop) : refuse(undefined);
      if (item === REFUSED) return stop.found!.keys.unshift(i), REFUSED;
      out.push(item);
    }
    return out;
  }
  if (!isPlainObject(value)) return refuse(value);
  const out: JsonObject = {};
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    const item = halfPair(key) ? refuse(key) : copy(value[key], depth + 1, stop);
    if (item === REFUSED) return stop.found!.keys.unshift(key), REFUSED;
    if (key === '__proto__') Object.defineProperty(out, key, { value: item, enumerable: true, writable: true, configurable: true });
    else out[key] = item;
  }
  return out;
}

/**
 * A plain copy of a value, read once, or the first place it isn't JSON both languages read alike: JSON is
 * null, a boolean, a finite number, a well-formed Unicode string (I-JSON's), an array without holes or a
 * plain object with well-formed keys, nested at most 256 deep. A getter or a proxy that throws throws here.
 */
export function readJson(value: unknown): { json: JsonValue } | { path: string; value: unknown } {
  const stop: { found?: Found } = {};
  const json = copy(value, 0, stop);
  if (json !== REFUSED) return { json };
  return { path: stop.found!.keys.map(segment).join(''), value: stop.found!.value };
}

/** One JSON Pointer segment, escaped. */
export const segment = (key: string | number): string => `/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;

/** The one field every branch of a union fixes and requires: its tag, as the lint requires. */
export const unionTag = (branches: Schema[]): string => Object.keys(branches[0]!.properties as object).find((key) => branches.every((b) =>
  isObject(b.properties) && Object.hasOwn(b.properties, key) && isObject(b.properties[key]) && 'const' in b.properties[key]
  && Array.isArray(b.required) && b.required.includes(key)))!;

/** The schema a local `#/$defs/<name>` reference points at. */
export function resolveRef(root: Schema, ref: string): Schema {
  const name = /^#\/\$defs\/([^/]+)$/.exec(ref)?.[1];
  const defs = root.$defs;
  const target = name !== undefined && isObject(defs) ? defs[name] : undefined;
  if (!isObject(target)) throw Error(`unresolved $ref ${ref}`);
  return target;
}
