import { issue, type ContractIssue } from './errors.js';
import { isObject, type SchemaEntry } from './json.js';
import { listSchemas } from './schemas.js';
import type { Validation } from './validate.js';

export interface CatalogueEntry { kind: string; version: number; schema: string; feeds: string[] }

/** One entry per event kind schema: a schema whose root lists the projections it feeds in `x-feeds`. */
export function buildCatalogue(entries: readonly SchemaEntry[]): CatalogueEntry[] {
  return entries.flatMap(({ name, schema }) => {
    const properties = isObject(schema.properties) ? schema.properties : {};
    const kind = isObject(properties.kind) ? properties.kind.const : undefined;
    const version = isObject(properties.v) ? properties.v.const : undefined;
    const feeds = schema['x-feeds'];
    if (!Array.isArray(feeds) || typeof kind !== 'string' || typeof version !== 'number') return [];
    return [{ kind, version, schema: name, feeds: feeds.map(String) }];
  });
}

let published: CatalogueEntry[] | undefined;
export const catalogue = (): CatalogueEntry[] => structuredClone((published ??= buildCatalogue(listSchemas())));

const KIND = /`([a-z][a-z_]*)\.([a-z][a-z_]*)`/g;

/**
 * The event kinds a text names in backticks that the catalogue lacks. A backticked `<family>.<name>` is
 * read as an event kind when its family is the family of a catalogued kind, so `rules.json` is not one.
 */
export function catalogueDrift(sources: readonly { where: string; text: string }[]): { kind: string; where: string }[] {
  const kinds = new Set(catalogue().map((e) => e.kind));
  const families = new Set([...kinds].map((kind) => kind.split('.')[0]));
  return sources.flatMap(({ where, text }) => {
    const named = new Set([...text.matchAll(KIND)].filter((m) => families.has(m[1]!)).map((m) => `${m[1]}.${m[2]}`));
    return [...named].filter((kind) => !kinds.has(kind)).map((kind) => ({ kind, where }));
  });
}

/** A view binds only to catalogued event kinds; each other kind is refused at its index. */
export function checkViewBindings(kinds: readonly string[]): Validation {
  const known = new Set(catalogue().map((e) => e.kind));
  const issues: ContractIssue[] = kinds.flatMap((kind, i) => (known.has(kind) ? [] : [issue('uncatalogued_kind', `/${i}`, kind)]));
  return issues.length ? { ok: false, issues } : { ok: true };
}
