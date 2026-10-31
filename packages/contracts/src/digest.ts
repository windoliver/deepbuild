import { canonicalize, plainJson, sha256Hex } from './canonical.js';
import { ContractError, issue } from './errors.js';
import { isObject, resolveRef, type JsonObject, type JsonValue, type Schema, type SchemaEntry } from './json.js';
import { getSchema } from './schemas.js';

// A closure (x-closure) and the adapter rules (x-rules) describe a set's governance, not its shape, so a minor may
// change them without a new digest; so does an entry's history (#139), and `x-acts`, which marks a field a reader must
// act on and is read by the contract step, never by a reader of the shape.
const ANNOTATIONS = new Set(['title', 'description', 'examples', '$comment', 'x-closure', 'x-rules', 'x-since', 'x-stability', 'x-tracking', 'x-deprecated_since', 'x-replaced_by', 'x-acts']);
const SCHEMA_MAPS = new Set(['properties']);
const SCHEMA_SLOTS = new Set(['items', 'additionalProperties', 'propertyNames']);

/** A schema with its annotations dropped and every `$ref` replaced by its definition, `$defs` gone. */
function normalize(node: JsonValue, root: Schema, seen: readonly string[] = []): JsonValue {
  if (!isObject(node)) return node;
  if (typeof node.$ref === 'string') {
    if (seen.includes(node.$ref)) throw Error(`a $ref cycle through ${node.$ref}`);
    return normalize(resolveRef(root, node.$ref), root, [...seen, node.$ref]);
  }
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (ANNOTATIONS.has(key) || key === '$defs') continue;
    if (SCHEMA_MAPS.has(key) && isObject(value)) {
      out[key] = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v, root, seen)]));
    } else if (SCHEMA_SLOTS.has(key)) out[key] = normalize(value, root, seen);
    else if (key === 'oneOf' && Array.isArray(value)) out[key] = value.map((v) => normalize(v, root, seen));
    else out[key] = value;
  }
  return out;
}

/** A method's shape digest: SHA-256 of the RFC 8785 bytes of its normalized schema. */
export const d1Digest = (schema: Schema): string => `d1:${sha256Hex(canonicalize(normalize(schema, schema)))}`;

export function parseDigest(text: string): { algorithm: 'd1'; hex: string } {
  const hex = /^d1:([0-9a-f]{64})$/.exec(text)?.[1];
  if (hex === undefined) throw new ContractError(issue('digest_algorithm', '', text));
  return { algorithm: 'd1', hex };
}

/** The schemas, in entry order, whose frozen digest is missing, malformed or no longer their d1. */
export const frozenDrift = (entries: readonly SchemaEntry[], frozen: Readonly<Record<string, string>>): string[] =>
  entries.filter(({ name, schema }) => frozen[name] !== d1Digest(schema)).map((e) => e.name);

/** Removes the members a pointer names, `*` standing for every array item. */
function drop(value: JsonValue, keys: readonly string[]): void {
  const [head, ...rest] = keys;
  if (head === undefined) return;
  if (head === '*') {
    if (Array.isArray(value)) for (const child of value) drop(child, rest);
  } else if (isObject(value) && Object.hasOwn(value, head)) {
    if (rest.length) drop(value[head]!, rest);
    else delete value[head];
  }
}

/** A hashed record's SHA-256 over its RFC 8785 bytes, without the pointers its schema's `x-hash.excludes` lists. */
export function recordHash(name: string, record: JsonValue): string {
  const marker = getSchema(name)['x-hash'];
  const excludes = isObject(marker) && Array.isArray(marker.excludes) ? marker.excludes.map(String) : [];
  // A plain copy, read once, to drop the excludes from.
  const copy = plainJson(record);
  for (const pointer of excludes) drop(copy, pointer.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~')));
  return sha256Hex(canonicalize(copy));
}
