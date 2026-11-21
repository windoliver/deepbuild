// catalog.copy (Check input: catalog kinds): every key a shown copy column holds has an entry in that column's copy
// table, the document's data.copy[locale][table], in every locale the input names; each key missing in a locale is a
// finding naming the key and the locale. Whether the copy fits stays the text module's check.
import { columnOf, isResult, judged, opened, refused, type Carried, type CatalogResult, type Finding } from './check.ts';

/** The document's data.copy: each locale's copy tables, a key's entry a string or its plural forms. */
export type Copy = Record<string, Record<string, Record<string, unknown>>>;
export interface CopyInput { catalog: string; shown: string[]; locales: string[]; copy: Copy; by?: 'agent' }

/** Whether `copy` holds an entry for `key` in `locale`'s copy table `table`. */
export const hasCopy = (copy: Copy, locale: string, table: string, key: number): boolean => copy[locale]?.[table]?.[String(key)] != null;

/** catalog.copy; `planted` is the kit's planted runner, copy_first_locale, which looks only in the first locale. */
export function runCopy(input: CopyInput, carried: Carried, planted = false): CatalogResult {
  const kind = 'catalog.copy';
  const t0 = performance.now();
  const cat = opened(kind, input.catalog, carried, t0);
  if (isResult(cat)) return cat;
  const locales = planted ? input.locales.slice(0, 1) : input.locales;
  const findings: Finding[] = [];
  const tables = new Set<string>();
  for (const name of input.shown) {
    const dot = name.indexOf('.');
    const table = name.slice(0, dot);
    const c = columnOf(cat, table, name.slice(dot + 1), ['copy']);
    if (typeof c === 'string') return refused(kind, input.catalog, t0, c);
    tables.add(table);
    const ids = cat.tables.get(table)!.ids;
    for (let row = 0; row < ids.length; row++) {
      const key = c.values[row]!;
      for (const locale of locales) {
        if (hasCopy(input.copy, locale, c.copy!, key)) continue;
        findings.push({
          found: { code: 'catalog.copy_missing', table, row: ids[row]!, column: c.name, key, locale, copy: c.copy },
          test: `${table}.${ids[row]}`,
          message: `catalog.copy_missing: ${table}.${ids[row]}'s ${c.name} holds key ${key}, which has no entry in ${locale}'s copy table ${c.copy}`,
        });
      }
    }
  }
  const rows = locales.length ? [...tables].reduce((n, t) => n + cat.tables.get(t)!.ids.length, 0) : 0;
  return judged(kind, input.catalog, t0, rows, findings);
}
