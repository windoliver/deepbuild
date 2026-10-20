import { isObject, type SchemaEntry } from './json.js';
import { listSchemas } from './schemas.js';

export interface CatalogueEntry { kind: string; version: number; schema: string; feeds: string[] }

/** One entry per event kind schema: a schema whose root lists the projections it feeds in `x-feeds`. */
function buildCatalogue(entries: readonly SchemaEntry[]): CatalogueEntry[] {
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
