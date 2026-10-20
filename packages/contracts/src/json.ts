export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
/** One JSON Schema document. */
export type Schema = JsonObject;
export interface SchemaEntry { name: string; schema: Schema }

export const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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
