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

export const listSchemas = (): SchemaEntry[] => structuredClone([...published]);

export function getSchema(name: string): Schema {
  const schema = byName.get(name);
  if (!schema) throw new ContractError(issue('unknown_schema', '', name));
  return structuredClone(schema);
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
