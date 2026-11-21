// catalog.bounds (Check input: catalog kinds): each column held to its declared range, [min, max] inclusive: the
// range `ranges` gives `table.column`, from the brief, the definition or a kit, else the schema's range for that
// column. Each value outside is a finding naming the row. It judges the rows of every table with a column held.
import { columnOf, isResult, judged, opened, refused, type Carried, type CatalogResult, type Finding } from './check.ts';

export interface BoundsInput { catalog: string; ranges: Record<string, [number, number]>; by?: 'agent' }

/** catalog.bounds; `planted` is the kit's planted runner, bounds_schema_only, which holds only the schema's ranges. */
export function runBounds(input: BoundsInput, carried: Carried, planted = false): CatalogResult {
  const kind = 'catalog.bounds';
  const t0 = performance.now();
  const cat = opened(kind, input.catalog, carried, t0);
  if (isResult(cat)) return cat;
  for (const name of Object.keys(input.ranges)) {
    const dot = name.indexOf('.');
    const c = columnOf(cat, name.slice(0, dot), name.slice(dot + 1), ['i32', 'f64']);
    if (typeof c === 'string') return refused(kind, input.catalog, t0, c);
  }
  const findings: Finding[] = [];
  let rows = 0;
  for (const t of cat.tables.values()) {
    let held = false;
    for (const c of t.columns.values()) {
      const range = (planted ? undefined : input.ranges[`${t.name}.${c.name}`]) ?? c.range;
      if (!range) continue;
      if (c.type !== 'i32' && c.type !== 'f64') return refused(kind, input.catalog, t0, `the schema gives ${t.name}.${c.name} a range, and it is a ${c.type} column, not an i32 or f64 one`);
      held = true;
      const [min, max] = range;
      for (let row = 0; row < t.ids.length; row++) {
        const value = c.values[row]!;
        if (value >= min && value <= max) continue;
        const id = t.ids[row]!;
        findings.push({
          found: { code: 'catalog.out_of_range', table: t.name, row: id, column: c.name, value, range: [min, max] },
          test: `${t.name}.${id}`,
          message: `catalog.out_of_range: ${t.name}.${id}'s ${c.name}, ${value}, is outside [${min}, ${max}]`,
        });
      }
    }
    if (held) rows += t.ids.length;
  }
  return judged(kind, input.catalog, t0, rows, findings);
}
