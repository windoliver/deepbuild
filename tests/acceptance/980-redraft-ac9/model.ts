// The model this redraft of criterion 9 times (README: The model), as the builder calls its program makes at init
// (../980/scenes.ts: Scene; ../980/README.md: Exports), and what the criterion says the model's arrays hold at a step
// that is timed. Nothing here runs a model or stands in for process@1: the numbers below come from the criterion (2,000
// live entities, 40 queues, 30 resources, 10 conveyors), from the issue's own examples (criterion 3's conveyor; the
// Scope's twelve pickers, six forklifts and four dock doors) and from this file's own arithmetic.

import { stationCount, type Build, type Scene } from '../980/scenes.ts';

/** The criterion's counts. */
export const WANT = { entities: 2000, queues: 40, resources: 30, conveyors: 10 } as const;

/** The model's tick, s: a tick a step at the logic item's 60 Hz. */
export const TICK = 1 / 60;
/** Ten lines of 200 cases each. */
export const LINES = 10;
export const EACH = 200;
/** A line's three stages, in the order a case meets them: units, each held 2 s (120 ticks). */
export const CAPACITIES = [12, 6, 4] as const;
export const HOLD = 2;
/** The issue's own conveyor (criterion 3): 10 m at 0.5 m/s with 0.6 m spacing, 1,200 ticks end to end, 72 ticks apart. */
export const BELT = { length: 10, speed: 0.5, spacing: 0.6 } as const;
export const BELT_TICKS = Math.round(BELT.length / (BELT.speed * TICK));
/** Line l's cases arrive one a tick from tick 12·l, so its stages' releases fall on ticks of their own (README: The model). */
export const STAGGER = 12;
/** Entity rows: one for each of the 2,000. */
export const ROWS = WANT.entities;
/**
 * The departures kept a station (the header's ring): the most any queue, request station or conveyor has let go by
 * the last timed step, eight rounds of a first stage's 12 units, so every statistic of a timed step is over all of
 * its window's departures (../980/README.md: Arrays: The window).
 */
export const RING = 8 * CAPACITIES[0];

/** One line's elements by ID: stations in the order a case meets them, resources as its stages hold them. */
export interface Line { source: number; queues: number[]; requests: number[]; resources: number[]; belt: number }
/** The sink every line ends at: station 0. */
export const SINK = 0;

function model(): { scene: Scene; lines: Line[] } {
  const build: Build[] = [{ op: 'sink' }];
  let stations = 1, resources = 0;
  /** A station's ID is its place among the builders that aren't `resource`; a resource's among those that are. */
  const station = (b: Build): number => { build.push(b); return stations++; };
  const lines: Line[] = [];
  for (let l = 0; l < LINES; l++) {
    const r = CAPACITIES.map((capacity) => { build.push({ op: 'resource', capacity }); return resources++; });
    // A `to` names a station already built, so a line is built from its end: belt, then each queue and the stage it feeds.
    const belt = station({ op: 'conveyor', ...BELT, to: SINK });
    const q3 = station({ op: 'queue', to: belt });
    const s2 = station({ op: 'request', r: r[2]!, n: 1, hold: HOLD, to: q3 });
    const q2 = station({ op: 'queue', to: s2 });
    const s1 = station({ op: 'request', r: r[1]!, n: 1, hold: HOLD, to: q2 });
    const q1 = station({ op: 'queue', to: s1 });
    const s0 = station({ op: 'request', r: r[0]!, n: 1, hold: HOLD, to: q1 });
    const q0 = station({ op: 'queue', to: s0 });
    const source = station({ op: 'source', kind: 0, at: Array.from({ length: EACH }, (_, i) => (STAGGER * l + i) * TICK), to: q0 });
    lines.push({ source, queues: [q0, q1, q2, q3], requests: [s0, s1, s2], resources: r, belt });
  }
  // The window and the warm-up are the issue's defaults (3,600 s, 0).
  return { scene: { name: 'ac9_redraft', tick: TICK, rows: ROWS, kinds: ['case'], ring: RING, rate: 60, ticksPerStep: 1, build }, lines };
}
const built = model();
/** The model: 91 stations (a sink, and per line a source, four queues, three request stations and a conveyor) and 30 resources. */
export const MODEL: Scene = built.scene;
export const LINE: readonly Line[] = built.lines;
/** N: index N of a per-station array is the system (../980/README.md: Arrays). */
export const STATIONS = stationCount(MODEL);
export const QUEUES: readonly number[] = LINE.flatMap((l) => l.queues);
export const REQUESTS: readonly number[] = LINE.flatMap((l) => l.requests);
export const BELTS: readonly number[] = LINE.map((l) => l.belt);
/** Each resource's capacity, by resource ID. */
export const CAPS: readonly number[] = LINE.flatMap(() => [...CAPACITIES]);

/** How many of each element the model's builder calls make, and the entities its sources make. */
export function builtCounts(s: Scene): { entities: number; queues: number; resources: number; conveyors: number } {
  const of = (op: Build['op']): number => s.build.filter((b) => b.op === op).length;
  const entities = s.build.reduce((n, b) => n + (b.op === 'source' ? b.at?.length ?? 0 : 0), 0);
  return { entities, queues: of('queue'), resources: of('resource'), conveyors: of('conveyor') };
}

/** When the model's last case is made (tick 12·9 + 199), and the tick before which no case can be out: one belt's ride. */
export const ALL_MADE_BY = STAGGER * (LINES - 1) + EACH - 1;
export const NONE_OUT_BEFORE = BELT_TICKS;

/** process@1's arrays a timed step is read by (../980/README.md: Arrays). */
export const READ = ['clock', 'made_n', 'out_n', 'kind', 'count', 'busy', 'cap', 'left', 'at', 'd'] as const;
export type Step = Record<(typeof READ)[number], number[]>;

const list = (xs: readonly number[]): string => (xs.length > 8 ? `${xs.slice(0, 8).join(', ')}, … (${xs.length})` : xs.join(', '));

/**
 * What the arrays step k left say against the criterion's model, each as a line; none when it is the model, all of
 * it live and every element holding work: the model's time is tick k's end; 2,000 made, none out, 2,000 live, in
 * 2,000 rows; all 2,000 at a queue, a request station or a conveyor; the 30 capacities as built; and every queue,
 * every resource and every conveyor holding at least one entity.
 */
export function stateProblems(a: Step, k: number): string[] {
  const out: string[] = [];
  const now = (k + 1) * TICK;
  if (!(Math.abs(a.clock[0]! - now) <= 1e-9)) out.push(`the model's time (clock[0]) is ${a.clock[0]} s, not ${now} s, the end of tick ${k}: the step didn't run one tick`);
  const rows = a.kind.filter((x) => x >= 0).length;
  if (a.made_n[0] !== WANT.entities || a.out_n[0] !== 0 || a.count[STATIONS] !== WANT.entities || rows !== WANT.entities)
    out.push(`${a.made_n[0]} made, ${a.out_n[0]} out, ${a.count[STATIONS]} live (count[${STATIONS}]) in ${rows} rows: not 2,000 made, none out and 2,000 live in 2,000 rows`);
  const held = [...QUEUES, ...REQUESTS, ...BELTS].reduce((n, s) => n + a.count[s]!, 0);
  if (held !== WANT.entities) out.push(`${held} entities are in the 40 queues, at the 30 resources' request stations and on the 10 conveyors, not all 2,000`);
  if (a.cap.join() !== CAPS.join()) out.push(`the resources' capacities (cap) are ${list(a.cap)}, not the 30 built: ${list(CAPS)}`);
  const idle = { queues: QUEUES.filter((s) => !(a.count[s]! >= 1)), resources: CAPS.map((_, j) => j).filter((j) => !(a.busy[j]! >= 1)), conveyors: BELTS.filter((s) => !(a.count[s]! >= 1)) };
  if (idle.queues.length) out.push(`${idle.queues.length} of the 40 queues hold no entity: stations ${list(idle.queues)}`);
  if (idle.resources.length) out.push(`${idle.resources.length} of the 30 resources hold no entity: resources ${list(idle.resources)}`);
  if (idle.conveyors.length) out.push(`${idle.conveyors.length} of the 10 conveyors carry no entity: stations ${list(idle.conveyors)}`);
  return out;
}

/** Each line's furthest case along its conveyor, m (0 when it carries none). */
export const leads = (a: Step): number[] => LINE.map((l) => a.at.reduce((far, s, row) => (s === l.belt ? Math.max(far, a.d[row]!) : far), 0));

/**
 * What the first and the last timed step say against a model that ran between them, each as a line; none when every
 * queue let entities go (its departures, `left`, grew) and every conveyor's furthest case rode on (its `d` grew).
 */
export function progressProblems(first: Step, last: Step): string[] {
  const out: string[] = [];
  const stuck = QUEUES.filter((s) => !(last.left[s]! > first.left[s]!));
  if (stuck.length) out.push(`${stuck.length} of the 40 queues let no entity go over the timed steps (left didn't grow): stations ${list(stuck)}`);
  const [was, is] = [leads(first), leads(last)];
  const still = BELTS.filter((_, l) => !(is[l]! > was[l]!));
  if (still.length) out.push(`${still.length} of the 10 conveyors' furthest cases rode no further over the timed steps (d didn't grow): stations ${list(still)}`);
  return out;
}
