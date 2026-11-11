import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { ContractError, issue } from './errors.js';
import type { JsonValue, Schema, SchemaEntry } from './json.js';
import { registry, type Registry } from './validate.js';
import { MACHINE_FILE } from './lifecycle.js';

const SCHEMAS = new URL('../schemas/', import.meta.url);
const FIXTURES = new URL('../fixtures/', import.meta.url);
const readJson = (url: URL): JsonValue => JSON.parse(readFileSync(url, 'utf8')) as JsonValue;

/**
 * The published schemas' names, one file per name: schemas/<name>.json. A file is read only when its schema is.
 * A lifecycle table beside them is no schema (lifecycle.ts reads it).
 */
const names: readonly string[] = readdirSync(SCHEMAS).filter((file) => file.endsWith('.json') && !MACHINE_FILE.test(file)).sort().map((file) => file.slice(0, -'.json'.length));
const published = new Set(names);
const read = (name: string): string => readFileSync(new URL(`${name}.json`, SCHEMAS), 'utf8');
// Each file's text, read the first time getSchema needs it: a process that validates a few kinds reads only those.
// Callers get their own copies; parsing the JSON text is cheaper than a structured clone. An entry keeps its own
// parsed schema and no text: the record reads every schema once at its open, and their texts would stay for good.
const texts = new Map<string, string>();
const textOf = (name: string): string => {
  let text = texts.get(name);
  if (text === undefined) texts.set(name, (text = read(name)));
  return text;
};

/** The entries listSchemas() handed out whose schema nobody has read or replaced: each equals the published one. */
const untouched = new WeakSet<SchemaEntry>();
const lazyEntry = (name: string): SchemaEntry => {
  let schema: Schema | undefined;
  const entry: SchemaEntry = {
    get name() { return name; },
    set name(next: string) { untouched.delete(entry); name = next; },
    get schema() { untouched.delete(entry); return (schema ??= JSON.parse(read(name)) as Schema); },
    set schema(next: Schema) { untouched.delete(entry); schema = next; },
  };
  untouched.add(entry);
  return entry;
};
/** Every published schema, each read and copied when first read, so a caller that reads few schemas pays for few. */
export const listSchemas = (): SchemaEntry[] => names.map(lazyEntry);
/** Whether a name is a published contract schema's. */
export const isPublished = (name: string): boolean => published.has(name);
/** Whether an entry from listSchemas() is untouched: its schema never read or replaced, so it equals the published one. */
export const isUntouched = (entry: SchemaEntry): boolean => untouched.has(entry);

export function getSchema(name: string): Schema {
  if (!published.has(name)) throw new ContractError(issue('unknown_schema', '', name));
  return JSON.parse(textOf(name)) as Schema;
}

/** A schema's valid fixtures, fixtures/<name>/*.json, by file name. */
export function fixtures(name: string): JsonValue[] {
  if (!published.has(name)) return [];
  const dir = new URL(`${encodeURIComponent(name)}/`, FIXTURES);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((file) => file.endsWith('.json')).sort().map((file) => readJson(new URL(file, dir)));
}

/** The frozen digest of every published schema: digests.json. */
export const frozenDigests = (): Record<string, string> =>
  readJson(new URL('../digests.json', import.meta.url)) as Record<string, string>;

// The registry compiles a schema's check the first time it validates that name, and reads its file then.
const contracts: Registry = registry(listSchemas());
export const { validate, decode, encode } = contracts;
