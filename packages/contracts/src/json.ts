export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
/** One JSON Schema document. */
export type Schema = JsonObject;
export interface SchemaEntry { name: string; schema: Schema }

export const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** How deep a document may nest, counted from its root, as deep-contracts' parser counts it. */
const MAX_DEPTH = 256;

/**
 * The first place a value isn't JSON both languages read alike, or undefined: JSON is null, a boolean, a
 * finite number, a well-formed Unicode string (I-JSON's), an array without holes or a plain object with
 * well-formed keys, nested at most 256 deep. A getter that throws throws here.
 */
export function notJson(value: unknown, path = '', depth = 0): { path: string; value: unknown } | undefined {
  if (depth > MAX_DEPTH) return { path, value };
  if (value === null || typeof value === 'boolean') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? undefined : { path, value };
  if (typeof value === 'string') return /\p{Surrogate}/u.test(value) ? { path, value } : undefined;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = Object.hasOwn(value, i) ? notJson(value[i], `${path}/${i}`, depth + 1) : { path: `${path}/${i}`, value: undefined };
      if (found) return found;
    }
    return undefined;
  }
  if (!isObject(value)) return { path, value };
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) return { path, value };
  for (const key of Object.keys(value)) {
    const at = path + segment(key);
    const found = /\p{Surrogate}/u.test(key) ? { path: at, value: key } : notJson(value[key], at, depth + 1);
    if (found) return found;
  }
  return undefined;
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
