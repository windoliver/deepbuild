import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { ContractError, issue } from './errors.js';
import type { JsonValue, Schema, SchemaEntry } from './json.js';
import { registry } from './validate.js';

const SCHEMAS = new URL('../schemas/', import.meta.url);
const FIXTURES = new URL('../fixtures/', import.meta.url);
const readJson = (url: URL): JsonValue => JSON.parse(readFileSync(url, 'utf8')) as JsonValue;

/** The published schemas, one file per name: schemas/<name>.json. */
const published: readonly SchemaEntry[] = readdirSync(SCHEMAS).filter((file) => file.endsWith('.json')).sort()
  .map((file) => ({ name: file.slice(0, -'.json'.length), schema: readJson(new URL(file, SCHEMAS)) as Schema }));
const byName = new Map(published.map((entry) => [entry.name, entry.schema]));

// Callers get their own copies; parsing the JSON text is cheaper than a structured clone.
const textByName = new Map(published.map((entry) => [entry.name, JSON.stringify(entry.schema)]));

/** The entries listSchemas() handed out whose schema nobody has read or replaced: each equals the published one. */
const untouched = new WeakSet<SchemaEntry>();
const lazyEntry = (name: string, text: string): SchemaEntry => {
  let schema: Schema | undefined;
  const entry: SchemaEntry = {
    get name() { return name; },
    set name(next: string) { untouched.delete(entry); name = next; },
    get schema() { untouched.delete(entry); return (schema ??= JSON.parse(text) as Schema); },
    set schema(next: Schema) { untouched.delete(entry); schema = next; },
  };
  untouched.add(entry);
  return entry;
};
/** Every published schema, each copied when first read, so a caller that reads few schemas pays for few. */
export const listSchemas = (): SchemaEntry[] => published.map((entry) => lazyEntry(entry.name, textByName.get(entry.name)!));
/** Whether a name is a published contract schema's. */
export const isPublished = (name: string): boolean => textByName.has(name);
/** Whether an entry from listSchemas() is untouched: its schema never read or replaced, so it equals the published one. */
export const isUntouched = (entry: SchemaEntry): boolean => untouched.has(entry);

export function getSchema(name: string): Schema {
  const text = textByName.get(name);
  if (text === undefined) throw new ContractError(issue('unknown_schema', '', name));
  return JSON.parse(text) as Schema;
}

/** A schema's valid fixtures, fixtures/<name>/*.json, by file name. */
export function fixtures(name: string): JsonValue[] {
  if (!byName.has(name)) return [];
  const dir = new URL(`${encodeURIComponent(name)}/`, FIXTURES);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((file) => file.endsWith('.json')).sort().map((file) => readJson(new URL(file, dir)));
}

/** The frozen digest of every published schema: digests.json. */
export const frozenDigests = (): Record<string, string> =>
  readJson(new URL('../digests.json', import.meta.url)) as Record<string, string>;

const contracts = registry(published);
export const { validate, decode, encode } = contracts;
