// mods.lib@1's rule, worked here from the issue's text and README: The surface, never from a library: the brute-force
// recompute every expected total comes from, and the seeded trees and edits (README: Generated cases). Each total is
// recomputed from the whole tree as it stands after the edit: which rows reach the node, which of their filters hold
// on the node's own catalog row, then (base + Σ add) × (1 + Σ percent ÷ 100), the last set by the tie rule, the lowest
// cap, and one rounding toward zero at the end. Nothing here remembers a total from one edit to the next.

import { ABSENT, KINDS, NO_ROW, cell, cellsOf, kindRow } from './catalog.ts';

export const MAX_NODES = 512;
export const MAX_STATS = 16;
export const MAX_ADDS = 4096;
export const MAX_FILTERS = 4;

export const OP = { add: 0, percent: 1, set: 2, cap: 3 } as const;
export const REACH = { down: 0, side: 1, all: 2 } as const;
export const CMP = { eq: 0, ge: 1, le: 2 } as const;
export const DURATION = { none: 0, turns: 1, rounds: 2 } as const;
export const BOUNDARY = { turn: 0, round: 1 } as const;
type Op = (typeof OP)[keyof typeof OP];
type Reach = (typeof REACH)[keyof typeof REACH];
type Cmp = (typeof CMP)[keyof typeof CMP];

export interface Filter { column: string; cmp: Cmp; value: number }
/** A modifier row (README: Modifier row). */
export interface ModRow {
  source: number; stat: number; op: Op; value: number; filters: Filter[];
  duration: { kind: (typeof DURATION)[keyof typeof DURATION]; count: number }; reach: Reach;
}
export type Edit =
  | { kind: 'attach'; node: number; parent: number; row: string }
  | { kind: 'detach'; node: number }
  | { kind: 'add'; row: ModRow }
  | { kind: 'remove'; id: number }
  | { kind: 'tick'; boundary: 0 | 1 };
/** One total, or every stat of `count` nodes from `first` (node by node, stat by stat). */
export type Read = { node: number; stat: number } | { first: number; count: number };
/** One step of a piece's script: its edits in order, then its reads. */
export interface Step { edits: Edit[]; reads: Read[]; note: string }
/** A script: the base column of each stat (the tree header's), and its steps. */
export interface Plan { stats: string[]; steps: Step[] }

/** A row with the strong defaults: reach down, no duration, no filters. */
export const row = (source: number, stat: number, op: Op, value: number, more: Partial<ModRow> = {}): ModRow =>
  ({ source, stat, op, value, filters: [], duration: { kind: DURATION.none, count: 0 }, reach: REACH.down, ...more });

const OPS = ['add', 'percent', 'set', 'cap'];
const REACHES = ['down', 'side', 'all'];
const CMPS = ['=', '≥', '≤'];
export function describe(e: Edit, stats: string[]): string {
  switch (e.kind) {
    case 'attach': return `attach(node ${e.node}, parent ${e.parent}, row ${e.row})`;
    case 'detach': return `detach(node ${e.node})`;
    case 'remove': return `remove(id ${e.id})`;
    case 'tick': return `tick(${e.boundary === 0 ? 'turn' : 'round'})`;
    case 'add': {
      const r = e.row;
      const f = r.filters.map((x) => `${x.column} ${CMPS[x.cmp]} ${x.value}`).join(', ');
      const d = r.duration.kind === 0 ? '' : `, ${r.duration.count} ${r.duration.kind === 1 ? 'turns' : 'rounds'}`;
      return `add(source ${r.source}, ${stats[r.stat] ?? `stat ${r.stat}`} ${OPS[r.op]} ${r.value}, reach ${REACHES[r.reach]}${f ? `, filters [${f}]` : ''}${d})`;
    }
  }
}

interface Held { row: ModRow; alive: boolean; remaining: number }

/** The tree as the rule sees it: each node's state (0 never attached, 1 attached, 2 detached), parent and row. */
export class Tree {
  readonly state = new Int8Array(MAX_NODES);
  readonly parent = new Int32Array(MAX_NODES).fill(-1);
  readonly rowOf: (string | null)[] = new Array<string | null>(MAX_NODES).fill(null);
  readonly rows: Held[] = [];
  readonly stats: string[];
  constructor(stats: string[]) { this.stats = stats; }

  /** A strict ancestor of `n` is `a`, through parent links as they stand. */
  under(n: number, a: number): boolean {
    for (let p = this.state[n] === 0 ? -1 : this.parent[n]!, g = 0; p >= 0 && g < MAX_NODES; p = this.parent[p]!, g++) if (p === a) return true;
    return false;
  }
  /** In the tree: attached, and so is every ancestor up to a root. */
  live(n: number): boolean {
    for (let p = n, g = 0; g <= MAX_NODES; g++) {
      if (this.state[p] !== 1) return false;
      p = this.parent[p]!;
      if (p < 0) return true;
    }
    return false;
  }
  root(n: number): number {
    let p = n;
    while (this.parent[p]! >= 0) p = this.parent[p]!;
    return p;
  }
  /** The id of the next add, or -1 once the tree has taken MAX_ADDS. */
  get nextId(): number { return this.rows.length < MAX_ADDS ? this.rows.length : -1; }

  /** Applies one edit as README: The surface says; an add returns its id (-1 when refused). */
  apply(e: Edit): number | null {
    switch (e.kind) {
      case 'attach': {
        const { node: n, parent: p } = e;
        if (n < 0 || n >= MAX_NODES || p < -1 || p >= MAX_NODES) return null;
        if (p >= 0 && (p === n || this.under(p, n))) return null;
        this.state[n] = 1;
        this.parent[n] = p;
        this.rowOf[n] = e.row;
        return null;
      }
      case 'detach':
        if (e.node >= 0 && e.node < MAX_NODES && this.state[e.node] === 1) { this.state[e.node] = 2; this.parent[e.node] = -1; }
        return null;
      case 'add': {
        const r = e.row;
        const ok = this.rows.length < MAX_ADDS && r.source >= 0 && r.source < MAX_NODES && r.stat >= 0 && r.stat < this.stats.length
          && r.op >= 0 && r.op <= 3 && r.reach >= 0 && r.reach <= 2 && r.duration.kind >= 0 && r.duration.kind <= 2 && r.filters.length <= MAX_FILTERS;
        if (!ok) return -1;
        this.rows.push({ row: r, alive: true, remaining: r.duration.count });
        return this.rows.length - 1;
      }
      case 'remove':
        if (e.id >= 0 && e.id < this.rows.length) this.rows[e.id]!.alive = false;
        return null;
      case 'tick':
        for (const h of this.rows) {
          if (!h.alive || h.row.duration.kind !== e.boundary + 1) continue;
          h.remaining -= 1;
          if (h.remaining <= 0) h.alive = false;
        }
        return null;
    }
  }

  /** A node's base for a stat: its row's value of the stat's base column, 0 with no row or no such column. */
  base(n: number, s: number): number {
    return (this.state[n] === 0 ? null : cell(this.rowOf[n] ?? null, this.stats[s]!)) ?? 0;
  }
  /** Every total of every node, recomputed from the whole tree: totals[n][s]. */
  totals(nodes: number): number[][] {
    const S = this.stats.length;
    const live = Array.from({ length: nodes }, (_, n) => this.live(n));
    const root = Array.from({ length: nodes }, (_, n) => (live[n] ? this.root(n) : -1));
    const children: number[][] = Array.from({ length: nodes }, () => []);
    for (let n = 0; n < nodes; n++) if (live[n] && this.parent[n]! >= 0) children[this.parent[n]!]!.push(n);
    // Each node's own catalog row, which filters read: none for a node never attached or attached with no row.
    const cells = Array.from({ length: nodes }, (_, n) => (this.state[n] === 0 ? null : cellsOf(this.rowOf[n] ?? null)));
    interface Acc { add: number; pct: number; set: number | null; setSrc: number; cap: number | null }
    const acc: Acc[][] = Array.from({ length: nodes }, () => Array.from({ length: S }, () => ({ add: 0, pct: 0, set: null, setSrc: -1, cap: null })));
    this.rows.forEach((h) => {
      const r = h.row;
      if (!h.alive || r.source >= nodes || !live[r.source]) return;
      const take = (n: number): void => {
        if (r.filters.length) {
          // Every filter must hold on the receiving node's own row.
          const c = cells[n];
          if (!c) return;
          for (const f of r.filters) {
            const v = c[f.column];
            if (v === undefined || (f.cmp === CMP.eq ? v !== f.value : f.cmp === CMP.ge ? v < f.value : v > f.value)) return;
          }
        }
        const a = acc[n]![r.stat]!;
        if (r.op === OP.add) a.add += r.value;
        else if (r.op === OP.percent) a.pct += r.value;
        else if (r.op === OP.set) { if (a.set === null || r.source >= a.setSrc) { a.set = r.value; a.setSrc = r.source; } }
        else if (a.cap === null || r.value < a.cap) a.cap = r.value;
      };
      if (r.reach === REACH.down) {
        const stack = [...children[r.source]!];
        while (stack.length) { const n = stack.pop()!; take(n); for (const k of children[n]!) stack.push(k); }
      } else if (r.reach === REACH.side) {
        const side = root[r.source]!;
        for (let n = 0; n < nodes; n++) if (live[n] && root[n] === side && n !== side) take(n);
      } else {
        for (let n = 0; n < nodes; n++) if (live[n]) take(n);
      }
    });
    return Array.from({ length: nodes }, (_, n) => Array.from({ length: S }, (_, s) => {
      const b = this.base(n, s);
      if (!live[n]) return b;
      return finish(b, acc[n]![s]!);
    }));
  }
}

/**
 * The stacking order, exactly, in integers: x = (base + Σ add) × (100 + Σ percent), or 100 × the last set; then the
 * lowest cap × 100 if lower; then x ÷ 100 rounded toward zero, once.
 */
export function finish(base: number, a: { add: number; pct: number; set: number | null; cap: number | null }): number {
  let x = a.set !== null ? a.set * 100 : (base + a.add) * (100 + a.pct);
  if (a.cap !== null && a.cap * 100 < x) x = a.cap * 100;
  if (!Number.isSafeInteger(x)) throw Error(`BLOCKED: a seeded total left the safe integers (${x})`);
  return (x - (x % 100)) / 100;
}

/** What a step's arrays must hold: the totals read, in read order, which node and stat each is, and the last add's id. */
export interface Expected { values: number[]; at: { node: number; stat: number }[]; lastId: number }
/** Runs a plan through the rule: one Expected per step. */
export function expectedOf(plan: Plan, nodes: number): Expected[] {
  const tree = new Tree(plan.stats);
  let lastId = -1;
  return plan.steps.map((step) => {
    for (const e of step.edits) { const id = tree.apply(e); if (e.kind === 'add') lastId = id!; }
    const all = step.reads.length ? tree.totals(nodes) : [];
    const at: { node: number; stat: number }[] = [];
    for (const r of step.reads) {
      if ('node' in r) at.push({ node: r.node, stat: r.stat });
      else for (let n = r.first; n < r.first + r.count; n++) for (let s = 0; s < plan.stats.length; s++) at.push({ node: n, stat: s });
    }
    return { values: at.map(({ node, stat }) => all[node]![stat]!), at, lastId };
  });
}

// ---------------------------------------------------------------------------------------------------
// Seeded cases (README: Generated cases).

/** mulberry32: a seeded generator, so a case replays from its seed. */
export function rng(seed: number): { next: () => number; int: (lo: number, hi: number) => number; pick: <T>(xs: readonly T[]) => T; chance: (p: number) => boolean } {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number): number => lo + Math.floor(next() * (hi - lo + 1));
  return { next, int, pick: (xs) => xs[Math.floor(next() * xs.length)]!, chance: (p) => next() < p };
}
/** Case i's seed under a recorded seed (seeds.json). */
export const caseSeed = (seed: number, i: number): number => (seed + Math.imul(i + 1, 0x9e3779b1)) >>> 0;

/** The four stats seeded trees total: each a base column of the catalog. */
export const STATS = ['attack', 'defense', 'morale', 'speed'];

/** A case's size: nodes in [minNodes ?? 2, maxNodes], rows in [minRows ?? 0, maxRows], each non-side node attached with chance `attached` (0.85 unless given). */
export interface Size { maxNodes: number; maxRows: number; edits: number; minNodes?: number; minRows?: number; attached?: number }
export interface Case { seed: number; nodes: number; attaches: Edit[]; adds: Edit[]; edits: Edit[] }

function randomRow(r: ReturnType<typeof rng>, nodes: number, noSetTies: boolean, taken: Set<string>): ModRow {
  const source = r.int(0, nodes - 1);
  const stat = r.int(0, STATS.length - 1);
  const u = r.next();
  let op: Op = u < 0.4 ? OP.add : u < 0.7 ? OP.percent : u < 0.8 ? OP.set : OP.cap;
  if (op === OP.set && noSetTies) {
    if (taken.has(`${source}/${stat}`)) op = OP.add;
    else taken.add(`${source}/${stat}`);
  }
  const value = op === OP.add ? r.int(-20, 20) : op === OP.percent ? r.int(-60, 120) : op === OP.set ? r.int(-10, 60) : r.int(-5, 80);
  const v = r.next();
  const reach: Reach = v < 0.6 ? REACH.down : v < 0.85 ? REACH.side : REACH.all;
  const w = r.next();
  const count = w < 0.5 ? 0 : w < 0.75 ? 1 : w < 0.9 ? 2 : w < 0.96 ? 3 : 4;
  const filters: Filter[] = Array.from({ length: count }, () => {
    const c = r.next();
    const cmp = r.pick([CMP.eq, CMP.ge, CMP.le] as const);
    if (c < 0.35) return { column: 'kind', cmp, value: r.int(1, 6) };
    if (c < 0.6) return { column: 'level', cmp, value: r.int(1, 9) };
    if (c < 0.8) return { column: 'player', cmp, value: r.int(0, 2) };
    if (c < 0.97) return { column: 'attack', cmp, value: r.int(0, 50) };
    return { column: ABSENT, cmp, value: r.int(0, 5) };
  });
  return { source, stat, op, value, filters, duration: { kind: DURATION.none, count: 0 }, reach };
}

/**
 * A seeded tree of up to `maxNodes` nodes and `maxRows` modifiers, and `edits` seeded attaches (of nodes outside the
 * tree), moves (attaches of attached nodes), detaches, adds and removes. Nodes 0 to R − 1 are the sides (roots); node
 * i ≥ R is attached under a node before it, or left outside the tree; each node keeps one catalog row (a seeded kind, or
 * none). `noSetTies`: no two sets share a source and a stat, so the tie rule's row order never decides a total.
 */
export function seededCase(seed: number, size: Size, noSetTies = false): Case {
  const r = rng(seed);
  const nodes = r.int(size.minNodes ?? 2, size.maxNodes);
  const sides = r.int(1, Math.min(3, nodes));
  const rowOf = Array.from({ length: nodes }, () => (r.chance(0.92) ? kindRow(r.int(0, KINDS - 1)) : NO_ROW));
  const tree = new Tree(STATS);
  const attaches: Edit[] = [];
  for (let n = 0; n < nodes; n++) {
    if (n < sides) attaches.push({ kind: 'attach', node: n, parent: -1, row: rowOf[n]! });
    else if (r.chance(size.attached ?? 0.85)) attaches.push({ kind: 'attach', node: n, parent: r.int(0, n - 1), row: rowOf[n]! });
  }
  for (const e of attaches) tree.apply(e);
  const taken = new Set<string>();
  const adds: Edit[] = Array.from({ length: r.int(size.minRows ?? 0, size.maxRows) }, () => ({ kind: 'add', row: randomRow(r, nodes, noSetTies, taken) }));
  for (const e of adds) tree.apply(e);
  const edits: Edit[] = [];
  for (let k = 0; k < size.edits; k++) {
    const e = seededEdit(r, tree, nodes, rowOf, noSetTies, taken);
    tree.apply(e);
    edits.push(e);
  }
  return { seed, nodes, attaches, adds, edits };
}

function seededEdit(r: ReturnType<typeof rng>, tree: Tree, nodes: number, rowOf: string[], noSetTies: boolean, taken: Set<string>): Edit {
  const all = Array.from({ length: nodes }, (_, n) => n);
  const attached = all.filter((n) => tree.state[n] === 1);
  const outside = all.filter((n) => tree.state[n] !== 1);
  const alive = tree.rows.flatMap((h, id) => (h.alive ? [id] : []));
  const u = r.next();
  if (u < 0.3 && attached.length) {
    // A move: an attached node to another parent outside its own subtree, or to the top as a side of its own.
    const n = r.pick(attached);
    const parents = attached.filter((p) => p !== n && !tree.under(p, n) && p !== tree.parent[n]);
    if (parents.length && !r.chance(0.08)) return { kind: 'attach', node: n, parent: r.pick(parents), row: rowOf[n]! };
    if (tree.parent[n]! >= 0) return { kind: 'attach', node: n, parent: -1, row: rowOf[n]! };
  } else if (u < 0.4 && outside.length) {
    const n = r.pick(outside);
    const parents = attached.filter((p) => p !== n && !tree.under(p, n));
    return { kind: 'attach', node: n, parent: parents.length && !r.chance(0.1) ? r.pick(parents) : -1, row: rowOf[n]! };
  } else if (u < 0.5 && attached.length) {
    return { kind: 'detach', node: r.pick(attached) };
  } else if (u >= 0.8 && alive.length) {
    return { kind: 'remove', id: r.pick(alive) };
  }
  return { kind: 'add', row: randomRow(r, nodes, noSetTies, taken) };
}

/** Every stat of every node, as one read. */
export const readAll = (nodes: number): Read[] => [{ first: 0, count: nodes }];
/** Criterion 1's per-change plan: the tree and its rows at step 0, then one edit a step, every total read after each. */
export function editPlan(c: Case): Plan {
  return {
    stats: STATS,
    steps: [
      { edits: [...c.attaches, ...c.adds], reads: readAll(c.nodes), note: `the tree's ${c.attaches.length} attaches and ${c.adds.length} adds` },
      ...c.edits.map((e, k) => ({ edits: [e], reads: readAll(c.nodes), note: `edit ${k + 1}: ${describe(e, STATS)}` })),
    ],
  };
}
/** The same tree for a large case: its attaches, its adds 250 a step, its first reads 100 nodes a step, then one edit a step, every total read after each. */
export function largePlan(c: Case): Plan {
  const steps: Step[] = [{ edits: c.attaches, reads: [], note: `the tree's ${c.attaches.length} attaches` }];
  for (let i = 0; i < c.adds.length; i += 250) steps.push({ edits: c.adds.slice(i, i + 250), reads: [], note: `adds ${i} to ${Math.min(i + 250, c.adds.length) - 1}` });
  for (let n = 0; n < c.nodes; n += 100) steps.push({ edits: [], reads: [{ first: n, count: Math.min(100, c.nodes - n) }], note: `the first reads, nodes ${n} on` });
  c.edits.forEach((e, k) => steps.push({ edits: [e], reads: readAll(c.nodes), note: `edit ${k + 1}: ${describe(e, STATS)}` }));
  return { stats: STATS, steps };
}
/** Only the tree and its rows, every total read once: rows added in `order` (indexes into the case's adds). */
export function setupPlan(c: Case, order: number[] = c.adds.map((_, i) => i)): Plan {
  return { stats: STATS, steps: [{ edits: [...c.attaches, ...order.map((i) => c.adds[i]!)], reads: readAll(c.nodes), note: `the tree's ${c.attaches.length} attaches and ${c.adds.length} adds` }] };
}
