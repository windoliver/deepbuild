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

/** The keys from the root down to the first value that isn't JSON, deepest last; built only on a refusal. */
type Found = { keys: (string | number)[]; value: unknown };

function walk(value: unknown, depth: number): Found | undefined {
  if (depth > MAX_DEPTH) return { keys: [], value };
  if (value === null || typeof value === 'boolean') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? undefined : { keys: [], value };
  if (typeof value === 'string') return halfPair(value) ? { keys: [], value } : undefined;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = Object.hasOwn(value, i) ? walk(value[i], depth + 1) : { keys: [], value: undefined };
      if (found) return found.keys.unshift(i), found;
    }
    return undefined;
  }
  if (!isPlainObject(value)) return { keys: [], value };
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    const found = halfPair(key) ? { keys: [], value: key } : walk(value[key], depth + 1);
    if (found) return found.keys.unshift(key), found;
  }
  return undefined;
}

/**
 * The first place a value isn't JSON both languages read alike, or undefined: JSON is null, a boolean, a
 * finite number, a well-formed Unicode string (I-JSON's), an array without holes or a plain object with
 * well-formed keys, nested at most 256 deep. A getter that throws throws here.
 */
export function notJson(value: unknown): { path: string; value: unknown } | undefined {
  const found = walk(value, 0);
  return found && { path: found.keys.map(segment).join(''), value: found.value };
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
