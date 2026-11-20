// What the catalog plug-in's six kinds share (Check input: catalog kinds, as built): opening the catalog an input
// names, the result each returns, and the rows a `makes` table's recipes name. A result is check.kind@1's: testsRun
// the rows judged, the evidence the catalog's asset ID, one failure per finding, its message led by its code and
// naming, as written, everything the finding names, and beside it `catalog: {kind, ms, found}`, `ms` the wall time of
// the check's own work.
import type { CheckResult, Failure } from '@deepbuild/conformance';
import type { Code } from './codes.ts';
import { NONE, open, type Catalog, type Column, type Packed, type Table, type Ty } from './layout.ts';

export type Kind = 'catalog.refs' | 'catalog.reach' | 'catalog.economy' | 'catalog.bounds' | 'catalog.copy' | 'scenario.reach';
/** The catalogs a check's spec carries, by asset ID. */
export type Carried = Record<string, Packed> | undefined;
/** A finding as `catalog.found` lists it. */
export interface Found { code: Code; [field: string]: unknown }
export interface CatalogResult extends CheckResult { catalog: { kind: Kind; ms: number; found: Found[] } }
/** A finding and the failure that reports it. */
export interface Finding { found: Found; test: string; message: string }

export const failure = (test: string, message: string, assertion = true): Failure => ({ test, file: '', line: 0, stack: null, assertion, message });

/** A check that judged `rows` rows and found `findings`; `more` are failures that aren't findings. */
export function judged(kind: Kind, asset: string, t0: number, rows: number, findings: Finding[], more: Failure[] = []): CatalogResult {
  const failures = [...findings.map((f) => failure(f.test, f.message)), ...more];
  return { outcome: failures.length ? 'failed' : 'passed', testsRun: rows, failures, evidence: [asset], read: [], mask: null, catalog: { kind, ms: performance.now() - t0, found: findings.map((f) => f.found) } };
}

/** A check that judged nothing, with one failure saying why. */
export function refused(kind: Kind, asset: string, t0: number, message: string, outcome: CheckResult['outcome'] = 'failed'): CatalogResult {
  return { outcome, testsRun: 0, failures: [failure(kind, message, false)], evidence: [asset], read: [], mask: null, catalog: { kind, ms: performance.now() - t0, found: [] } };
}

/**
 * The catalog an input names, opened from the spec's `catalogs`, or the result refusing it: BLOCKED when the spec
 * doesn't carry it, so nothing unread passes, and `catalog.layout:` when it isn't table.layout@1 as its record names it.
 */
export function opened(kind: Kind, asset: string, carried: Carried, t0: number): Catalog | CatalogResult {
  if (!carried?.[asset]) return refused(kind, asset, t0, `BLOCKED: the catalog ${asset} isn't carried in the spec's catalogs`, 'missing');
  const cat = open(asset, carried);
  return typeof cat === 'string' ? refused(kind, asset, t0, `catalog.layout: ${cat}`) : cat;
}

/** Whether `opened` refused. */
export const isResult = (c: Catalog | CatalogResult): c is CatalogResult => 'outcome' in c;

/** What an input names that the catalog doesn't hold, as a refusal's words. */
export const lacks = (what: string): string => `the input names ${what}, which the catalog doesn't hold`;

/** Table `table`'s column `name` when its type is one of `types`, else what the input names that the catalog lacks. */
export function columnOf(cat: Catalog, table: string, name: string, types: Ty[]): Column | string {
  const c = cat.tables.get(table)?.columns.get(name);
  return c && types.includes(c.type) ? c : lacks(`${table}.${name} as a ${types.join(' or ')} column`);
}

/**
 * Every row of the catalog as one node: a table's rows follow the tables before it in directory order, so a check
 * keeps one array a row however many tables it reads.
 */
export class Nodes {
  readonly base = new Map<string, number>();
  readonly count: number;
  private readonly order: Table[];
  private readonly starts: number[] = [];
  constructor(cat: Catalog) {
    this.order = [...cat.tables.values()];
    let n = 0;
    for (const t of this.order) {
      this.base.set(t.name, n);
      this.starts.push(n);
      n += t.ids.length;
    }
    this.count = n;
  }
  /** The node's table and row: the last table starting at or before it. */
  place(node: number): [Table, number] {
    let lo = 0;
    for (let hi = this.starts.length - 1; lo < hi;) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid]! <= node) lo = mid;
      else hi = mid - 1;
    }
    return [this.order[lo]!, node - this.starts[lo]!];
  }
  /** The node's ID, as written. */
  id(node: number): string {
    const [t, row] = this.place(node);
    return t.ids[row]!;
  }
  /** The nodes a ref or refs cell names, those to an ID no row holds left out. */
  at(cat: Catalog, c: Column | undefined, row: number): number[] {
    if (!c || (c.type !== 'ref' && c.type !== 'refs')) return [];
    const base = this.base.get(c.target!)!;
    if (c.type === 'ref') {
      const v = c.values[row]!;
      return v === NONE ? [] : [base + v];
    }
    const out: number[] = [];
    for (let i = c.values[2 * row]!, end = i + c.values[2 * row + 1]!; i < end; i++) if (cat.pool[i] !== NONE) out.push(base + cat.pool[i]!);
    return out;
  }
}

/** A `makes` entry: the table whose rows are recipes, and its columns of inputs, tools and outputs. */
export interface Makes { table: string; inputs: string; tools: string; outputs: string }
/** A recipe: its table, row and ID, and what it names, each a node, or the ID the record lists as missing. */
export interface Recipe { table: string; row: number; id: string; inputs: (number | string)[]; tools: (number | string)[]; outputs: (number | string)[] }

/** Every row of each `makes` table as a recipe, in `makes` order, or what the input names that the catalog lacks. */
export function recipesOf(cat: Catalog, nodes: Nodes, makes: Makes[]): Recipe[] | string {
  // The record lists each missing ID by table, row and column, in the order the cell names it.
  const missing = new Map<string, string[]>();
  for (const m of cat.missing) {
    const key = `${m.table}\0${m.id}\0${m.column}`;
    (missing.get(key) ?? missing.set(key, []).get(key)!).push(m.ref);
  }
  const out: Recipe[] = [];
  for (const m of makes) {
    const t = cat.tables.get(m.table);
    if (!t) return lacks(`the table ${m.table}`);
    const cols: Column[] = [];
    for (const name of [m.inputs, m.tools, m.outputs]) {
      const c = columnOf(cat, m.table, name, ['ref', 'refs']);
      if (typeof c === 'string') return c;
      cols.push(c);
    }
    for (let row = 0; row < t.ids.length; row++) {
      const id = t.ids[row]!;
      const cell = (c: Column): (number | string)[] => {
        const lost = missing.get(`${m.table}\0${id}\0${c.name}`) ?? [];
        const base = nodes.base.get(c.target!)!;
        if (c.type === 'ref') {
          const v = c.values[row]!;
          return v !== NONE ? [base + v] : lost.slice(0, 1);
        }
        const named: (number | string)[] = [];
        let k = 0;
        for (let i = c.values[2 * row]!, end = i + c.values[2 * row + 1]!; i < end; i++) named.push(cat.pool[i] === NONE ? lost[k++] ?? '' : base + cat.pool[i]!);
        return named;
      };
      out.push({ table: m.table, row, id, inputs: cell(cols[0]!), tools: cell(cols[1]!), outputs: cell(cols[2]!) });
    }
  }
  return out;
}
