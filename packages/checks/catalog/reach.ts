// catalog.reach (Check input: catalog kinds): a fixed point from the roots the brief or the definition gives. A root
// {table, ids} makes those rows reachable, and {table, column} every row the ref or refs column holds in any row of
// the table (the start kit's items, the loot table's drops); a recipe, a row of a `makes` table, is reachable once every
// row its inputs and tools name is, and then the rows its outputs name are. Each recipe counts what it still waits for
// and each row lists the recipes waiting on it, so the fixed point takes each row and each reference once: O(rows +
// refs). Each row of an `every` table left unreachable is a finding naming it and, for a recipe, the first of its
// inputs, then its tools, that isn't reachable: its ID, or the missing ID the record lists.
import { columnOf, isResult, judged, lacks, Nodes, opened, recipesOf, refused, type Carried, type CatalogResult, type Finding, type Makes } from './check.ts';

export interface Root { table: string; ids?: string[]; column?: string }
export interface ReachInput { catalog: string; roots: Root[]; makes: Makes[]; every: string[]; by?: 'agent' }

/** catalog.reach; `planted` is the kit's planted runner, reach_any_input, which takes a recipe once any one need is. */
export function runReach(input: ReachInput, carried: Carried, planted = false): CatalogResult {
  const kind = 'catalog.reach';
  const t0 = performance.now();
  const cat = opened(kind, input.catalog, carried, t0);
  if (isResult(cat)) return cat;
  const no = (why: string): CatalogResult => refused(kind, input.catalog, t0, why);
  const nodes = new Nodes(cat);
  const recipes = recipesOf(cat, nodes, input.makes);
  if (typeof recipes === 'string') return no(recipes);
  for (const table of input.every) if (!cat.tables.has(table)) return no(lacks(`the table ${table}`));
  const reached = new Uint8Array(nodes.count);
  const queue = new Int32Array(nodes.count);
  let tail = 0;
  const reach = (n: number): void => {
    if (!reached[n]) {
      reached[n] = 1;
      queue[tail++] = n;
    }
  };
  for (const r of input.roots) {
    const t = cat.tables.get(r.table);
    if (!t) return no(lacks(`the table ${r.table}`));
    const base = nodes.base.get(r.table)!;
    for (const id of r.ids ?? []) {
      const row = t.index.get(id);
      if (row === undefined) return no(lacks(`${r.table}.${id}`));
      reach(base + row);
    }
    if (r.column !== undefined) {
      const c = columnOf(cat, r.table, r.column, ['ref', 'refs']);
      if (typeof c === 'string') return no(c);
      for (let row = 0; row < t.ids.length; row++) for (const n of nodes.at(cat, c, row)) reach(n);
    }
  }
  // What each recipe waits for, a repeated need counted each time it's named, and the recipes each row holds back,
  // as one array indexed by row; a missing ID is waited for and never comes.
  const needs = recipes.map((r) => r.inputs.concat(r.tools));
  const waiting = new Int32Array(recipes.length);
  const at = new Int32Array(nodes.count + 1);
  needs.forEach((need, i) => {
    for (const n of need) if (typeof n === 'number') at[n + 1] = at[n + 1]! + 1;
    waiting[i] = planted ? Math.min(need.length, 1) : need.length;
  });
  for (let n = 0; n < nodes.count; n++) at[n + 1] = at[n + 1]! + at[n]!;
  const held = new Int32Array(at[nodes.count]!);
  const next = at.slice(0, nodes.count);
  needs.forEach((need, i) => {
    for (const n of need) {
      if (typeof n !== 'number') continue;
      held[next[n]!] = i;
      next[n] = next[n]! + 1;
    }
  });
  const recipeNode = recipes.map((r) => nodes.base.get(r.table)! + r.row);
  const fire = (i: number): void => {
    reach(recipeNode[i]!);
    for (const n of recipes[i]!.outputs) if (typeof n === 'number') reach(n);
  };
  for (let i = 0; i < recipes.length; i++) if (waiting[i] === 0) fire(i);
  for (let head = 0; head < tail; head++) {
    const n = queue[head]!;
    for (let k = at[n]!; k < at[n + 1]!; k++) {
      const i = held[k]!;
      waiting[i] = waiting[i]! - 1;
      if (waiting[i] === 0) fire(i);
    }
  }
  const recipeAt = new Map<number, number>();
  recipeNode.forEach((n, i) => { if (!recipeAt.has(n)) recipeAt.set(n, i); });
  const findings: Finding[] = [];
  let rows = 0;
  for (const table of input.every) {
    const t = cat.tables.get(table)!;
    const base = nodes.base.get(table)!;
    rows += t.ids.length;
    for (let row = 0; row < t.ids.length; row++) {
      if (reached[base + row]) continue;
      const id = t.ids[row]!;
      const i = recipeAt.get(base + row);
      const k = i === undefined ? -1 : needs[i]!.findIndex((n) => typeof n === 'string' || !reached[n]);
      const n = k < 0 ? undefined : needs[i!]![k]!;
      const need = n === undefined ? null : typeof n === 'string' ? n : nodes.id(n);
      const what = need === null ? '' : `: ${k < recipes[i!]!.inputs.length ? 'its input' : 'its tool'} ${need}${typeof n === 'string' ? ', which no row holds,' : ''} is never reached`;
      findings.push({ found: { code: 'catalog.unreachable', table, row: id, input: need }, test: `${table}.${id}`, message: `catalog.unreachable: ${table}.${id} is unreachable from the roots${what}` });
    }
  }
  return judged(kind, input.catalog, t0, rows, findings);
}
