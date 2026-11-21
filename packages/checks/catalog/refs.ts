// catalog.refs (Check input: catalog kinds): every ref and refs column names a row its table holds. The probe packs a
// ref to an ID no row holds as 0xFFFFFFFF and lists it in the record, so each the record lists is a finding, naming
// the table, the row's ID, the column and the missing ID. It judges the rows of every table holding a ref column.
import { isResult, judged, opened, type Carried, type CatalogResult } from './check.ts';

export interface RefsInput { catalog: string; by?: 'agent' }

/** catalog.refs; `planted` is the kit's planted runner, refs_skips_lists, which passes a refs column's missing IDs. */
export function runRefs(input: RefsInput, carried: Carried, planted = false): CatalogResult {
  const t0 = performance.now();
  const cat = opened('catalog.refs', input.catalog, carried, t0);
  if (isResult(cat)) return cat;
  let rows = 0;
  for (const t of cat.tables.values()) if ([...t.columns.values()].some((c) => c.type === 'ref' || c.type === 'refs')) rows += t.ids.length;
  const findings = cat.missing.flatMap((m) => {
    const c = cat.tables.get(m.table)?.columns.get(m.column);
    if (planted && c?.type === 'refs') return [];
    return [{
      found: { code: 'catalog.ref_missing' as const, table: m.table, row: m.id, column: m.column, ref: m.ref },
      test: `${m.table}.${m.id}`,
      message: `catalog.ref_missing: ${m.table}.${m.id}'s ${m.column} names ${m.ref}, which no row of ${c?.target} holds`,
    }];
  });
  return judged('catalog.refs', input.catalog, t0, rows, findings);
}
