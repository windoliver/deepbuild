import { classOf, indexOf, reachedFrom, said, same, type Cell, type Floor } from './floors.ts';

export interface Failed { test: string; message: string }
export interface Judged {
  outcome: string;
  testsRun: number;
  failures: readonly Failed[];
  reach?: { floors?: readonly { run?: string; seed?: number; depth?: number; reached?: boolean; unreached?: readonly unknown[] }[] } | undefined;
}

export const SKIPPED = 'grid.skipped';
export const UNREACHED = 'grid.unreached';
export const INCONCLUSIVE = 'INCONCLUSIVE:';
export const PLANTED = 'closes-first';
export const runName = (i: number, bot = 0): string => `bot ${bot} run ${i}`;

export const told = (r: Judged): string =>
  `${r.outcome}, testsRun ${r.testsRun}; failures: ${r.failures.map((f) => `[${f.test}] ${f.message}`).join(' | ').slice(0, 3000) || '(none)'}`;

export const floorsTold = (r: Judged): string =>
  (r.reach?.floors ?? []).map((f) => `${f.run} (seed ${f.seed}), depth ${f.depth}, ${f.reached ? 'reached' : 'not reached'}`).join('; ') || '(no floor)';

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const holdsWord = (message: string, text: string): boolean => new RegExp(`(^|[^0-9A-Za-z_])${escaped(text)}($|[^0-9A-Za-z_])`).test(message);
export function cellAfter(message: string, label: string): Cell | undefined {
  const found = message.match(new RegExp(`(?:^|[^A-Za-z_])${escaped(label)} \\[\\s*(-?\\d+)\\s*,\\s*(-?\\d+)\\s*\\]`));
  return found ? [Number(found[1]), Number(found[2])] : undefined;
}
export function routeIn(message: string): Cell[] {
  const last = [...message.matchAll(/(?:^|[^A-Za-z_])route(?![A-Za-z_])/g)].at(-1);
  if (!last) return [];
  const rest = message.slice((last.index ?? 0) + last[0].length);
  return [...rest.matchAll(/\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]/g)].map((found): Cell => [Number(found[1]), Number(found[2])]);
}
export const namesRun = (f: Failed, run: string): boolean => f.test === run || holdsWord(f.message, run);
export const namesFloor = (f: Failed, floor: { run: string; seed: number; depth: number }): string[] => [
  ...(namesRun(f, floor.run) ? [] : [`it doesn't name the run ${floor.run}`]),
  ...(holdsWord(f.message, `seed ${floor.seed}`) ? [] : [`it doesn't name the run's seed as seed ${floor.seed}`]),
  ...(holdsWord(f.message, `depth ${floor.depth}`) ? [] : [`it doesn't name the floor's depth as depth ${floor.depth}`]),
];

export interface Crossing { what: string; cells: readonly number[] }
export interface RouteWanted { floor: Floor; starts: readonly Cell[]; goal: Cell; closed: ReadonlySet<number>; cross: readonly Crossing[] }
export function routeWrong(route: readonly Cell[], w: RouteWanted): string[] {
  if (!route.length) return ['it names no route: no cell [x, y] follows its last word route'];
  const faults: string[] = [];
  const first = route[0]!;
  const last = route.at(-1)!;
  if (!w.starts.some((start) => same(start, first))) faults.push(`its route starts at ${said(first)}, which is no start (${w.starts.map(said).join(' ')})`);
  if (!same(last, w.goal)) faults.push(`its route ends at ${said(last)}, not at the goal ${said(w.goal)}`);
  const stood = reachedFrom(w.floor, w.starts.map((start) => indexOf(w.floor, start)), w.closed);
  const inside = ([x, y]: Cell): boolean => x >= 0 && x < w.floor.w && y >= 0 && y < w.floor.h;
  route.forEach((cell, k) => {
    const i = inside(cell) ? indexOf(w.floor, cell) : -1;
    if (i < 0) faults.push(`its route's cell ${said(cell)} is off the ${w.floor.w} × ${w.floor.h} floor`);
    else if (w.closed.has(i)) faults.push(`its route crosses ${said(cell)}, a cell the need closes`);
    else if (!stood.has(i)) faults.push(`its route crosses ${said(cell)}, ${classOf(w.floor.cells[i]!)}, where no search with the need's cells closed can stand`);
    const before = route[k - 1];
    if (before && Math.abs(before[0] - cell[0]) + Math.abs(before[1] - cell[1]) !== 1) faults.push(`its route steps from ${said(before)} to ${said(cell)}, which are no neighbours on a grid of 4 moves`);
  });
  for (const crossing of w.cross) {
    if (!route.some((cell) => inside(cell) && crossing.cells.includes(indexOf(w.floor, cell)))) faults.push(`its route crosses no cell of ${crossing.what}`);
  }
  return faults;
}

export interface SkipWanted extends RouteWanted { run: string; seed: number; depth: number }
export function skippedWrong(r: Judged, w: SkipWanted): string[] {
  if (r.outcome !== 'failed') return [`the outcome is ${r.outcome}, not failed: ${told(r)}`];
  const found = r.failures.filter((f) => f.message.startsWith(SKIPPED) && namesRun(f, w.run));
  if (found.length !== 1) return [`${found.length} failures start ${SKIPPED} and name ${w.run}, not 1: ${told(r)}`];
  const f = found[0]!;
  const goal = cellAfter(f.message, 'goal');
  return [
    ...namesFloor(f, w),
    ...(goal && same(goal, w.goal) ? [] : [`it doesn't name the goal as goal ${said(w.goal)}`]),
    ...routeWrong(routeIn(f.message), w),
  ].map((fault) => `${fault}: ${f.message}`);
}

export function passedWrong(r: Judged, runs: number): string[] {
  const floors = r.reach?.floors;
  return [
    ...(r.outcome === 'passed' ? [] : [`the outcome is ${r.outcome}, not passed: ${told(r)}`]),
    ...(r.failures.length ? [`it reports ${r.failures.length} failures: ${told(r)}`] : []),
    ...(r.testsRun === runs ? [] : [`it counts ${r.testsRun} runs, not ${runs}`]),
    ...(Array.isArray(floors) && floors.length === runs && floors.every((floor) => floor.reached === true) ? [] : [`its result doesn't list ${runs} floors, each reached: ${JSON.stringify(floors)?.slice(0, 600)}`]),
  ];
}

export function onlySkippedWrong(r: Judged, runs: number): string[] {
  const other = r.failures.filter((f) => !f.message.startsWith(SKIPPED));
  const floors = r.reach?.floors;
  return [
    ...(other.length ? [`${other.length} failures don't start ${SKIPPED}: ${told(r)}`] : []),
    ...(r.testsRun === runs ? [] : [`it counts ${r.testsRun} runs, not ${runs}`]),
    ...(Array.isArray(floors) && floors.length === runs && floors.every((floor) => floor.reached === true && Array.isArray(floor.unreached) && floor.unreached.length === 0)
      ? [] : [`its result doesn't list ${runs} floors, each with every goal and every cell of an every class reached: ${JSON.stringify(floors)?.slice(0, 600)}`]),
  ];
}

export interface FloorWanted { run: string; seed: number; depth: number }
export function inconclusiveWrong(r: Judged, w: FloorWanted & { through: string }): string[] {
  if (r.outcome !== 'uncounted') return [`the outcome is ${r.outcome}, not uncounted, which reads INCONCLUSIVE: ${told(r)}`];
  const found = r.failures.filter((f) => f.message.startsWith(INCONCLUSIVE) && namesRun(f, w.run));
  if (!found.length) return [`no failure starts ${INCONCLUSIVE} and names ${w.run}: ${told(r)}`];
  const faults = found.map((f) => [...namesFloor(f, w), ...(holdsWord(f.message, w.through) ? [] : [`it doesn't name the class ${w.through}`])].map((fault) => `${fault}: ${f.message}`));
  return faults.some((list) => !list.length) ? [] : faults[0]!;
}
export function onlyInconclusiveWrong(r: Judged, runs: number): string[] {
  const other = r.failures.filter((f) => !f.message.startsWith(INCONCLUSIVE));
  return [
    ...(other.length ? [`${other.length} failures don't start ${INCONCLUSIVE}: ${told(r)}`] : []),
    ...(r.testsRun === runs ? [] : [`it counts ${r.testsRun} runs, not ${runs}`]),
  ];
}

export function unreachedOnceWrong(r: Judged, w: FloorWanted & { goal: Cell }): string[] {
  if (r.outcome !== 'failed') return [`the outcome is ${r.outcome}, not failed: ${told(r)}`];
  const mine = r.failures.filter((f) => namesRun(f, w.run));
  if (mine.length !== 1) return [`${mine.length} failures name ${w.run}, not 1: ${told(r)}`];
  const f = mine[0]!;
  const cell = cellAfter(f.message, 'cell');
  return [
    ...(f.message.startsWith(UNREACHED) ? [] : [`its one failure doesn't start ${UNREACHED}`]),
    ...namesFloor(f, w),
    ...(cell && same(cell, w.goal) ? [] : [`it doesn't name the exit as cell ${said(w.goal)}`]),
  ].map((fault) => `${fault}: ${f.message}`);
}
export function noSkippedWrong(r: Judged, floors: number): string[] {
  const skipped = r.failures.filter((f) => f.message.startsWith(SKIPPED));
  return [
    ...(skipped.length ? [`the result holds ${skipped.length} ${SKIPPED} failures for floors whose goal the plain search doesn't reach: ${told(r)}`] : []),
    ...(r.failures.length === floors ? [] : [`the result holds ${r.failures.length} failures for ${floors} floors, not one a floor: ${told(r)}`]),
  ];
}

export function refusedWrong(r: Judged, need: { goal: string; through: readonly string[] }): string[] {
  if (r.outcome === 'passed') return [`the run passed, so the edited need counted as the brief's: ${told(r)}`];
  const named = [need.goal, ...need.through];
  const refusals = r.failures.filter((f) => /(^|[^A-Za-z_])refused($|[^A-Za-z_])/.test(f.message));
  if (!refusals.length) return [`no failure says the run is refused: ${told(r)}`];
  const naming = refusals.filter((f) => named.every((name) => holdsWord(f.message, name)));
  return naming.length ? [] : [`no refusal names the edited need by its goal and the classes of its through (${named.join(', ')}): ${told(r)}`];
}

export const BUDGET = { task: 'playtest-crawler', target: 'reach_200_floors_s', seconds: 1 } as const;
export function recordWrong(budgets: unknown, criterion: string): string[] {
  const tasks = (budgets as { tasks?: unknown } | null)?.tasks;
  const task = Array.isArray(tasks) ? (tasks as { id?: unknown; targets?: Record<string, unknown>; criteria?: unknown }[]).find((t) => t?.id === BUDGET.task) : undefined;
  if (!task) return [`benchmarks/budgets.json holds no task ${BUDGET.task}`];
  return [
    ...(task.targets?.[BUDGET.target] === BUDGET.seconds ? [] : [`${BUDGET.task}.targets.${BUDGET.target} is ${JSON.stringify(task.targets?.[BUDGET.target])}, not ${BUDGET.seconds}`]),
    ...(Array.isArray(task.criteria) && task.criteria.includes(criterion) ? [] : [`${BUDGET.task}.criteria is ${JSON.stringify(task.criteria)}, which doesn't name ${criterion}, so no budget window judges it`]),
  ];
}

export function searchedWrong(r: Judged & { reach?: { search_ms?: unknown } | undefined }, floors: number): string[] {
  const ms = r.reach?.search_ms;
  return [
    ...passedWrong(r, floors),
    ...(typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? [] : [`reach.search_ms, the time in ms of the check's own searches, is ${JSON.stringify(ms)}`]),
  ];
}
