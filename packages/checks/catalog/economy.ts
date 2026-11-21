// catalog.economy (Check input: catalog kinds): no cycle of recipes, an uncraft being a recipe too, makes something
// from nothing. One recipe leads to another when its outputs hold a row the other's inputs take; within each strongly
// connected set, each elementary cycle (Johnson's search, at most 100,000 a check) is made once around, and a cycle
// whose net count, outputs less inputs with tools left out, is 0 or more for every row and more than 0 for one gains,
// a finding naming the cycle, the row and the gain. Past the cap the check fails as unsettled, never passes, since a
// cycle it didn't make might gain. With a value column, a recipe whose outputs' summed value less its inputs' passes
// the margin is a finding too, naming it.
import { columnOf, failure, isResult, judged, Nodes, opened, recipesOf, refused, type Carried, type CatalogResult, type Finding, type Makes } from './check.ts';

export interface EconomyInput { catalog: string; makes: Makes[]; value?: { table: string; column: string }; margin?: number; by?: 'agent' }
/** The most elementary cycles a check makes. */
export const CAP = 100_000;

/** What the cycle search tells its caller: each vertex as its path takes it on and lets it go, and each cycle it closes. */
export interface Walk { enter(v: number): void; leave(v: number): void; closed(path: readonly number[]): void }

/**
 * Each elementary cycle of the graph whose vertex v leads to `to[at[v]]` up to `to[at[v + 1]]`, closed on `walk` with
 * its path from the least vertex: Johnson's search from the least vertex of each strongly connected set, which is then
 * set aside and the rest split into its own strongly connected sets. False once the graph holds more than `cap`.
 */
export function cycles(n: number, at: Int32Array, to: Int32Array, cap: number, walk: Walk): boolean {
  // The stamp of the set each vertex is in now: a search and a split see only the vertices of theirs.
  const mark = new Int32Array(n).fill(1);
  let stamp = 1;
  const index = new Int32Array(n);
  const low = new Int32Array(n);
  const on = new Uint8Array(n);
  // Tarjan's strongly connected sets of the vertices `vs`, all marked `s`, without recursion.
  const split = (vs: number[], s: number): number[][] => {
    for (const v of vs) index[v] = -1;
    const sets: number[][] = [];
    const stack: number[] = [];
    let count = 0;
    for (const root of vs) {
      if (index[root] !== -1) continue;
      const call = [root];
      const edge = [at[root]!];
      index[root] = low[root] = count++;
      stack.push(root);
      on[root] = 1;
      while (call.length) {
        const top = call.length - 1;
        const v = call[top]!;
        const e = edge[top]!;
        if (e < at[v + 1]!) {
          edge[top] = e + 1;
          const w = to[e]!;
          if (mark[w] !== s) continue;
          if (index[w] === -1) {
            index[w] = low[w] = count++;
            stack.push(w);
            on[w] = 1;
            call.push(w);
            edge.push(at[w]!);
          } else if (on[w]) low[v] = Math.min(low[v]!, index[w]!);
          continue;
        }
        call.pop();
        edge.pop();
        if (call.length) low[call[top - 1]!] = Math.min(low[call[top - 1]!]!, low[v]!);
        if (low[v] === index[v]) {
          const set: number[] = [];
          let w: number;
          do {
            w = stack.pop()!;
            on[w] = 0;
            set.push(w);
          } while (w !== v);
          sets.push(set);
        }
      }
    }
    return sets;
  };
  const blocked = new Uint8Array(n);
  // Johnson's B: the vertices to unblock once each vertex is.
  const waits: Set<number>[] = Array.from({ length: n }, () => new Set());
  const unblock = (u: number): void => {
    const stack = [u];
    while (stack.length) {
      const x = stack.pop()!;
      blocked[x] = 0;
      for (const w of waits[x]!) if (blocked[w]) stack.push(w);
      waits[x]!.clear();
    }
  };
  let found = 0;
  const pending = split(Array.from({ length: n }, (_, v) => v), stamp);
  while (pending.length) {
    const set = pending.pop()!;
    let s = set[0]!;
    for (const v of set) if (v < s) s = v;
    if (set.length === 1) {
      let loop = false;
      for (let e = at[s]!; e < at[s + 1]!; e++) if (to[e] === s) loop = true;
      if (!loop) continue;
    }
    stamp++;
    for (const v of set) {
      mark[v] = stamp;
      blocked[v] = 0;
      waits[v]!.clear();
    }
    const path = [s];
    const edge = [at[s]!];
    const hit = [false];
    blocked[s] = 1;
    walk.enter(s);
    while (path.length) {
      const top = path.length - 1;
      const v = path[top]!;
      const e = edge[top]!;
      if (e < at[v + 1]!) {
        edge[top] = e + 1;
        const w = to[e]!;
        if (mark[w] !== stamp) continue;
        if (w === s) {
          if (++found > cap) return false;
          walk.closed(path);
          hit[top] = true;
        } else if (!blocked[w]) {
          path.push(w);
          edge.push(at[w]!);
          hit.push(false);
          blocked[w] = 1;
          walk.enter(w);
        }
        continue;
      }
      const closed = hit.pop()!;
      path.pop();
      edge.pop();
      walk.leave(v);
      if (closed) {
        unblock(v);
        if (hit.length) hit[hit.length - 1] = true;
      } else {
        for (let k = at[v]!; k < at[v + 1]!; k++) {
          const w = to[k]!;
          if (mark[w] === stamp) waits[w]!.add(v);
        }
      }
    }
    stamp++;
    const rest = set.filter((v) => v !== s);
    for (const v of rest) mark[v] = stamp;
    for (const sub of split(rest, stamp)) pending.push(sub);
  }
  return true;
}

/** catalog.economy; `planted` is the kit's planted runner, economy_gains_every_row, which needs every row to gain. */
export function runEconomy(input: EconomyInput, carried: Carried, planted = false): CatalogResult {
  const kind = 'catalog.economy';
  const t0 = performance.now();
  const cat = opened(kind, input.catalog, carried, t0);
  if (isResult(cat)) return cat;
  const nodes = new Nodes(cat);
  const recipes = recipesOf(cat, nodes, input.makes);
  if (typeof recipes === 'string') return refused(kind, input.catalog, t0, recipes);
  const value = input.value && columnOf(cat, input.value.table, input.value.column, ['i32', 'f64']);
  if (typeof value === 'string') return refused(kind, input.catalog, t0, value);
  // A missing ID is catalog.refs' finding; it counts for nothing here.
  const known = (ns: (number | string)[]): number[] => ns.filter((n): n is number => typeof n === 'number');
  const ins = recipes.map((r) => known(r.inputs));
  const outs = recipes.map((r) => known(r.outputs));
  // The recipes taking each row, each once, then each recipe's edges to them through its outputs, each once.
  const takes = new Map<number, number[]>();
  ins.forEach((ns, r) => {
    for (const n of new Set(ns)) (takes.get(n) ?? takes.set(n, []).get(n)!).push(r);
  });
  const at = new Int32Array(recipes.length + 1);
  const to: number[] = [];
  const seen = new Int32Array(recipes.length).fill(-1);
  outs.forEach((ns, r) => {
    for (const n of ns) {
      for (const s of takes.get(n) ?? []) {
        if (seen[s] === r) continue;
        seen[s] = r;
        to.push(s);
      }
    }
    at[r + 1] = to.length;
  });
  const findings: Finding[] = [];
  // The path's net count of each row, kept as the search takes recipes on and off it, with how many rows stand below
  // and above 0, so a closed cycle is judged at once: it gains when none is below and one is above.
  const net = new Int32Array(nodes.count);
  let below = 0;
  let above = 0;
  const add = (n: number, by: number): void => {
    const was = net[n]!;
    const now = was + by;
    net[n] = now;
    below += Number(now < 0) - Number(was < 0);
    above += Number(now > 0) - Number(was > 0);
  };
  const make = (r: number, times: number): void => {
    for (const n of ins[r]!) add(n, -times);
    for (const n of outs[r]!) add(n, times);
  };
  const named = (path: readonly number[]): number[] => path.flatMap((r) => [...ins[r]!, ...outs[r]!]);
  const settled = cycles(recipes.length, at, Int32Array.from(to), CAP, {
    enter: (r) => make(r, 1),
    leave: (r) => make(r, -1),
    closed: (path) => {
      const gains = planted ? named(path).every((n) => net[n]! > 0) : below === 0 && above > 0;
      if (!gains) return;
      const row = named(path).find((n) => net[n]! > 0)!;
      const cycle = path.map((r) => recipes[r]!.id);
      findings.push({
        found: { code: 'catalog.gain_cycle', cycle, row: nodes.id(row), gain: net[row]! },
        test: cycle.join(' → '),
        message: `catalog.gain_cycle: ${cycle.join(' → ')}, each made once, ends with ${net[row]} more ${nodes.id(row)} than it began`,
      });
    },
  });
  if (input.value && value) {
    const base = nodes.base.get(input.value.table)!;
    const rows = cat.tables.get(input.value.table)!.ids.length;
    const worth = (ns: number[]): number => ns.reduce((sum, n) => sum + (n >= base && n < base + rows ? value.values[n - base]! : 0), 0);
    const margin = input.margin ?? 0;
    recipes.forEach((r, i) => {
      const [inputs, outputs] = [worth(ins[i]!), worth(outs[i]!)];
      if (outputs - inputs <= margin) return;
      findings.push({
        found: { code: 'catalog.gain_cycle', recipe: r.id, inputs, outputs, margin },
        test: `${r.table}.${r.id}`,
        message: `catalog.gain_cycle: ${r.table}.${r.id}'s outputs are worth ${outputs} and its inputs ${inputs}, past the margin ${margin}`,
      });
    });
  }
  const unsettled = settled ? [] : [failure(kind, `unsettled: the recipes hold more than ${CAP} elementary cycles, the check's cap, so whether one gains isn't settled`, false)];
  return judged(kind, input.catalog, t0, recipes.length, findings, unsettled);
}
