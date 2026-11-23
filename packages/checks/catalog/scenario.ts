// scenario.reach (Check input: catalog kinds): a fixed point over a scenario's trigger rows from its start, turn 0. A
// row fires once its trigger can and each flag in its `when` is set by a row that fires: a turn trigger at n within
// `turns`; a time trigger always; a flag trigger once a firing row sets its flag; an enter trigger once the check's own
// breadth-first search over `map`, over open cells by their 4 neighbours, from each cell holding a unit of its side,
// reaches one of its cells; a defeated trigger once its side has a unit, on the map or spawned by a firing row; built
// and killed once the side may build the kind or has a unit of it; stored once the side may build a kind whose
// `yields` names the resource. A kind may be built unless a start row (turn 0 or time 0, with no `when`) denies it
// and no firing row allows it. Every goal must fire, or it is a finding naming the first trigger or condition that
// can't hold; every key a firing row shows must have copy in each locale, or it is a finding naming the key.
import type { Column, Table, Ty } from './layout.ts';
import { columnOf, isResult, judged, lacks, Nodes, opened, refused, type Carried, type CatalogResult, type Finding } from './check.ts';
import { hasCopy, type Copy } from './copy.ts';

export interface ScenarioInput { catalog: string; triggers: string; map?: string; goals: string[]; turns: number; copy: Copy; locales: string[]; by?: 'agent' }

const REFS = ['trigger', 'flag', 'side', 'cells', 'kind', 'when', 'sets', 'shows', 'ends', 'spawn', 'spawn_side', 'spawn_at', 'allow', 'deny'] as const;
const FOUR = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** scenario.reach; `planted` is the kit's planted runner, scenario_ignores_deny, which lets every kind be built. */
export function runScenario(input: ScenarioInput, carried: Carried, planted = false): CatalogResult {
  const kind = 'scenario.reach';
  const t0 = performance.now();
  const cat = opened(kind, input.catalog, carried, t0);
  if (isResult(cat)) return cat;
  const no = (why: string): CatalogResult => refused(kind, input.catalog, t0, why);
  const T = cat.tables.get(input.triggers);
  if (!T) return no(lacks(`the triggers table ${input.triggers}`));
  for (const goal of input.goals) if (!T.index.has(goal)) return no(lacks(`the goal ${input.triggers}.${goal}`));
  // Each column by its name, if the table has it, of the type the scenario reads it as.
  const optional = (t: Table, name: string, types: Ty[]): Column | undefined | string => (t.columns.has(name) ? columnOf(cat, t.name, name, types) : undefined);
  const cols: Partial<Record<(typeof REFS)[number] | 'n', Column>> = {};
  for (const name of [...REFS, 'n' as const]) {
    const c = optional(T, name, name === 'n' ? ['i32'] : ['ref', 'refs']);
    if (typeof c === 'string') return no(c);
    if (c) cols[name] = c;
  }
  const nodes = new Nodes(cat);
  const at = (c: Column | undefined, row: number): number[] => nodes.at(cat, c, row);
  const name = (node: number | undefined): string => (node === undefined ? 'none' : nodes.id(node));
  const nOf = (row: number): number => (cols.n ? cols.n.values[row]! : 0);
  const formOf = (row: number): string | undefined => {
    const f = at(cols.trigger, row)[0];
    return f === undefined ? undefined : nodes.id(f);
  };

  // The map: each cell by its x and y, and the cells each side's units reach, grown as units come.
  const M = input.map === undefined ? undefined : cat.tables.get(input.map);
  if (input.map !== undefined && !M) return no(lacks(`the map table ${input.map}`));
  const grid: Partial<Record<'x' | 'y' | 'open' | 'side' | 'kind', Column>> = {};
  if (M) {
    for (const [c, types] of [['x', ['i32']], ['y', ['i32']], ['open', ['bool']]] as const) {
      const col = columnOf(cat, M.name, c, [...types]);
      if (typeof col === 'string') return no(col);
      grid[c] = col;
    }
    for (const c of ['side', 'kind'] as const) {
      const col = optional(M, c, ['ref', 'refs']);
      if (typeof col === 'string') return no(col);
      if (col) grid[c] = col;
    }
  }
  const mapBase = M ? nodes.base.get(M.name)! : 0;
  const cellAt = new Map<string, number>();
  if (M) for (let row = 0; row < M.ids.length; row++) cellAt.set(`${grid.x!.values[row]},${grid.y!.values[row]}`, row);
  const reached = new Map<number, Uint8Array>();
  const units = new Map<number, Set<number>>();
  const walk = (side: number, cell: number): void => {
    if (!M || cell < mapBase || cell >= mapBase + M.ids.length) return;
    let seen = reached.get(side);
    if (!seen) reached.set(side, (seen = new Uint8Array(M.ids.length)));
    if (seen[cell - mapBase]) return;
    seen[cell - mapBase] = 1;
    const queue = [cell - mapBase];
    for (let head = 0; head < queue.length; head++) {
      const c = queue[head]!;
      for (const [dx, dy] of FOUR) {
        const d = cellAt.get(`${grid.x!.values[c]! + dx},${grid.y!.values[c]! + dy}`);
        if (d === undefined || seen[d] || !grid.open!.values[d]) continue;
        seen[d] = 1;
        queue.push(d);
      }
    }
  };
  // A unit of no kind (-1) still counts as a unit its side can lose.
  const unit = (side: number, of: number | undefined): void => {
    (units.get(side) ?? units.set(side, new Set()).get(side)!).add(of ?? -1);
  };
  if (M) {
    for (let row = 0; row < M.ids.length; row++) {
      const side = at(grid.side, row)[0];
      if (side === undefined) continue;
      unit(side, at(grid.kind, row)[0]);
      walk(side, mapBase + row);
    }
  }
  // The kinds each resource comes from: every row of a table whose `yields` names it.
  const yielders = new Map<number, number[]>();
  for (const t of cat.tables.values()) {
    const y = t.columns.get('yields');
    if (!y || (y.type !== 'ref' && y.type !== 'refs')) continue;
    for (let row = 0; row < t.ids.length; row++) for (const r of at(y, row)) (yielders.get(r) ?? yielders.set(r, []).get(r)!).push(nodes.base.get(t.name)! + row);
  }

  const flags = new Set<number>();
  const allowed = new Set<number>();
  const denied = new Set<number>();
  for (let row = 0; row < T.ids.length; row++) {
    const form = formOf(row);
    if ((form === 'turn' || form === 'time') && nOf(row) === 0 && !at(cols.when, row).length) for (const k of at(cols.deny, row)) denied.add(k);
  }
  const buildable = (k: number): boolean => planted || !denied.has(k) || allowed.has(k);
  // The first trigger or condition of the row that can't hold now, or '' when it fires.
  const blocker = (row: number): string => {
    const form = formOf(row);
    const side = at(cols.side, row)[0];
    const of = at(cols.kind, row)[0];
    let holds: boolean;
    let what: string;
    switch (form) {
      case 'turn':
        holds = nOf(row) <= input.turns;
        what = `turn ${nOf(row)}`;
        break;
      case 'time':
        holds = true;
        what = '';
        break;
      case 'flag': {
        const f = at(cols.flag, row)[0];
        holds = f !== undefined && flags.has(f);
        what = `flag ${name(f)}`;
        break;
      }
      case 'enter': {
        const cells = at(cols.cells, row);
        const seen = side === undefined ? undefined : reached.get(side);
        holds = !!seen && cells.some((c) => c >= mapBase && c < mapBase + seen.length && seen[c - mapBase] === 1);
        what = `enter ${cells.map(name).join(', ')}`;
        break;
      }
      case 'defeated':
        holds = side !== undefined && (units.get(side)?.size ?? 0) > 0;
        what = `defeated ${name(side)}`;
        break;
      case 'built':
      case 'killed':
        holds = of !== undefined && (buildable(of) || (side !== undefined && !!units.get(side)?.has(of)));
        what = `${form} ${name(of)}`;
        break;
      case 'stored':
        holds = of !== undefined && (yielders.get(of) ?? []).some(buildable);
        what = `stored ${name(of)}`;
        break;
      default:
        holds = false;
        what = `trigger ${form ?? 'none'}`;
    }
    if (!holds) return what;
    for (const f of at(cols.when, row)) if (!flags.has(f)) return `when ${name(f)}`;
    return '';
  };
  const fired = new Uint8Array(T.ids.length);
  for (let changed = true; changed;) {
    changed = false;
    for (let row = 0; row < T.ids.length; row++) {
      if (fired[row] || blocker(row)) continue;
      fired[row] = 1;
      changed = true;
      for (const f of at(cols.sets, row)) flags.add(f);
      for (const k of at(cols.allow, row)) allowed.add(k);
      const side = at(cols.spawn_side, row)[0];
      if (side === undefined) continue;
      unit(side, at(cols.spawn, row)[0]);
      for (const c of at(cols.spawn_at, row)) walk(side, c);
    }
  }

  const findings: Finding[] = [];
  for (const goal of input.goals) {
    const row = T.index.get(goal)!;
    if (fired[row]) continue;
    const why = blocker(row);
    findings.push({ found: { code: 'scenario.unreachable', row: goal, why }, test: `${T.name}.${goal}`, message: `scenario.unreachable: ${T.name}.${goal} never fires from the start: ${why} can't hold` });
  }
  for (let row = 0; row < T.ids.length; row++) {
    if (!fired[row]) continue;
    for (const shown of at(cols.shows, row)) {
      const [S, s] = nodes.place(shown);
      for (const c of S.columns.values()) {
        if (c.type !== 'copy') continue;
        const key = c.values[s]!;
        for (const locale of input.locales) {
          if (hasCopy(input.copy, locale, c.copy!, key)) continue;
          findings.push({
            found: { code: 'scenario.unreachable', row: T.ids[row]!, key, locale },
            test: `${T.name}.${T.ids[row]}`,
            message: `scenario.unreachable: ${T.name}.${T.ids[row]} shows key ${key} (${S.name}.${S.ids[s]}'s ${c.name}), which has no entry in ${locale}'s copy table ${c.copy}`,
          });
        }
      }
    }
  }
  return judged(kind, input.catalog, t0, T.ids.length, findings);
}
