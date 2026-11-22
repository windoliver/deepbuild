// The criteria's process models as data (README: Scenes): each one the builder calls a program makes at init, in order,
// with its tick, rows, kinds, ring, window and warm-up (README: The header), its step rate and the ticks each step runs.
// Station IDs count every builder but `resource` in call order from 0; resource IDs count `resource` calls from 0
// (README: Exports). Nothing here runs a model: programs.ts turns a scene into WebAssembly text, fixtures.ts works its
// expected values out in closed form.

export type Build =
  | { op: 'source'; kind: number; every?: number; mean_gap?: number; at?: number[]; until?: number; to: number }
  | { op: 'queue'; order?: 0 | 1; capacity?: number; to: number }
  | { op: 'resource'; capacity: number }
  | { op: 'request'; r: number; n: number; hold?: number; mean_hold?: number; to: number }
  | { op: 'conveyor'; length: number; speed: number; spacing: number; to: number }
  | { op: 'pack'; n: number; into: number; to: number }
  | { op: 'unpack'; members: number; carrier: number }
  | { op: 'sink' };

export interface Scene {
  name: string;
  /** The model's tick, s (README: Time). */
  tick: number;
  rows: number;
  kinds: string[];
  /** Sink records and departures kept per station (README: The header). */
  ring: number;
  window?: number;
  warmup?: number;
  build: Build[];
  /** The logic item's step rate, Hz, and the ticks each step runs (stats' n). */
  rate: number;
  ticksPerStep: number;
  /** release(e) calls, made at step `at` before stats. */
  releases?: { at: number; e: number }[];
}

/** A scene's stations, by ID, and its resource count (README: Exports: IDs). */
export function shape(s: Scene): { stations: Build[]; resources: number } {
  const stations = s.build.filter((b) => b.op !== 'resource');
  return { stations, resources: s.build.length - stations.length };
}
export const stationCount = (s: Scene): number => shape(s).stations.length;

// ---------------------------------------------------------------------------------------------------
// Criterion 1: one source every 60 s into one resource of capacity 1 that holds 45 s, at a 1/60 s tick.

/** Stations: 0 sink, 1 the request (resource 0), 2 its queue, 3 the source. */
export const STEADY: Scene = {
  name: 'steady', tick: 1 / 60, rows: 8, kinds: ['order'], ring: 64, rate: 1, ticksPerStep: 3600,
  build: [
    { op: 'sink' }, { op: 'resource', capacity: 1 }, { op: 'request', r: 0, n: 1, hold: 45, to: 0 }, { op: 'queue', to: 1 },
    { op: 'source', kind: 0, every: 60, to: 2 },
  ],
};
export const STEADY_ST = { sink: 0, request: 1, queue: 2, source: 3 } as const;
/** Ten simulated hours: 600 steps of 3,600 ticks (one minute each). */
export const STEADY_STEPS = 600;

// ---------------------------------------------------------------------------------------------------
// Criterion 2: M/M/1, exponential gaps at a mean of 120 s and exponential holds at a mean of 60 s, at a 1 s tick, an
// hour a step, statistics over the whole run (a window longer than any run).

export const MM1: Scene = {
  name: 'mm1', tick: 1, rows: 64, kinds: ['job'], ring: 64, window: 1e9, rate: 1, ticksPerStep: 3600,
  build: [
    { op: 'sink' }, { op: 'resource', capacity: 1 }, { op: 'request', r: 0, n: 1, mean_hold: 60, to: 0 }, { op: 'queue', to: 1 },
    { op: 'source', kind: 0, mean_gap: 120, to: 2 },
  ],
};
/** 100,000 arrivals at 120 s apart take 12.0 million s (σ ≈ 38,000 s): 3,400 hour-long steps reach them past 5σ. */
export const MM1_STEPS = 3400;
export const MM1_ARRIVALS = 100_000;

// ---------------------------------------------------------------------------------------------------
// Criterion 3 (and 6's dropping library): a lone case on belt A, eighteen at once onto belt B whose end leads nowhere.

/** Stations: 0 sink, 1 belt A (to the sink), 2 its infeed queue, 3 belt B (to nowhere), 4 its infeed queue, 5 and 6 the sources. */
export const BELT: Scene = {
  name: 'belt', tick: 1 / 60, rows: 20, kinds: ['case'], ring: 8, rate: 60, ticksPerStep: 1,
  build: [
    { op: 'sink' }, { op: 'conveyor', length: 10, speed: 0.5, spacing: 0.6, to: 0 }, { op: 'queue', to: 1 },
    { op: 'conveyor', length: 10, speed: 0.5, spacing: 0.6, to: -1 }, { op: 'queue', to: 3 },
    { op: 'source', kind: 0, at: [0], to: 2 }, { op: 'source', kind: 0, at: Array(18).fill(0), to: 4 },
  ],
};
export const BELT_ST = { sink: 0, a: 1, qa: 2, b: 3, qb: 4 } as const;
export const BELT_STEPS = 1500;

// ---------------------------------------------------------------------------------------------------
// Criterion 4 (and 6's over-granting library): three sources, one order each at t = 0, into three queues built in the
// reverse order (so station order and ID order disagree), all feeding one request for either of two resources.

function grants(capacities: number[]): Scene {
  return {
    name: capacities.length === 2 ? 'grant' : 'grant2', tick: 1 / 60, rows: 4, kinds: ['order'], ring: 8, rate: 60, ticksPerStep: 1,
    build: [
      { op: 'sink' }, ...capacities.map((capacity) => ({ op: 'resource' as const, capacity })),
      { op: 'request', r: 0, n: capacities.length, hold: -1, to: 0 },
      { op: 'queue', to: 1 }, { op: 'queue', to: 1 }, { op: 'queue', to: 1 },
      { op: 'source', kind: 0, at: [0], to: 4 }, { op: 'source', kind: 0, at: [0], to: 3 }, { op: 'source', kind: 0, at: [0], to: 2 },
    ],
    releases: [{ at: 30, e: 1 }, { at: 50, e: 0 }, { at: 70, e: 2 }],
  };
}
/** Two resources of capacity 1. Stations: 0 sink, 1 the request, 2 entity 2's queue, 3 entity 1's, 4 entity 0's. */
export const GRANT = grants([1, 1]);
/** One resource of capacity 2, the same requests (criterion 6). */
export const GRANT2 = grants([2]);
export const GRANT_ST = { sink: 0, request: 1, q2: 2, q1: 3, q0: 4 } as const;
export const GRANT_STEPS = 100;

// ---------------------------------------------------------------------------------------------------
// Criterion 5: three cases through and out at t = 0 (rows 0 to 2 free, at generation 1), a blocker that holds the
// forklift 40 s, then six cases and a pallet at t = 1 s: packed, the pallet waits in a queue for the forklift, is held
// 30 s, and unpacked into a queue that leads nowhere.

/** Stations: 0 sink, 1 Qout (nowhere), 2 unpack, 3 forklift request (hold 30 s), 4 Qmid, 5 pack, 6 cases' queue, 7 pallets' queue, 8 blocker's request (hold 40 s), 9 its queue, 10 Qpre, 11 to 14 sources. */
export const PALLET: Scene = {
  name: 'pallet', tick: 1 / 60, rows: 10, kinds: ['case', 'pallet'], ring: 8, rate: 60, ticksPerStep: 1,
  build: [
    { op: 'sink' }, { op: 'queue', to: -1 }, { op: 'unpack', members: 1, carrier: 0 }, { op: 'resource', capacity: 1 },
    { op: 'request', r: 0, n: 1, hold: 30, to: 2 }, { op: 'queue', to: 3 }, { op: 'pack', n: 6, into: 1, to: 4 },
    { op: 'queue', to: 5 }, { op: 'queue', to: 5 }, { op: 'request', r: 0, n: 1, hold: 40, to: 0 }, { op: 'queue', to: 8 },
    { op: 'queue', to: 0 },
    { op: 'source', kind: 0, at: [0, 0, 0], to: 10 }, { op: 'source', kind: 0, at: [0], to: 9 },
    { op: 'source', kind: 0, at: Array(6).fill(1), to: 6 }, { op: 'source', kind: 1, at: [1], to: 7 },
  ],
};
export const PALLET_ST = { sink: 0, qout: 1, unpack: 2, fork: 3, qmid: 4, pack: 5, qc: 6, qp: 7, block: 8, qb: 9, qpre: 10 } as const;
export const PALLET_STEPS = 4300;

// ---------------------------------------------------------------------------------------------------
// Criterion 9: ten lines of source → queue → conveyor → queue → request → queue → request → queue → request → sink,
// two hundred items each made at t = 0: 2,000 live entities, 40 queues, 30 resources, 10 conveyors.

export const BUDGET_LINES = 10, BUDGET_EACH = 200;
function budget(): Scene {
  const build: Build[] = [{ op: 'sink' }];
  let station = 1;
  for (let line = 0; line < BUDGET_LINES; line++) {
    const r = 3 * line;
    build.push({ op: 'resource', capacity: 20 }, { op: 'resource', capacity: 20 }, { op: 'resource', capacity: 20 });
    const rq2 = station++; build.push({ op: 'request', r: r + 2, n: 1, hold: 3, to: 0 });
    const q3 = station++; build.push({ op: 'queue', to: rq2 });
    const rq1 = station++; build.push({ op: 'request', r: r + 1, n: 1, hold: 3, to: q3 });
    const q2 = station++; build.push({ op: 'queue', to: rq1 });
    const rq0 = station++; build.push({ op: 'request', r, n: 1, hold: 3, to: q2 });
    const q1 = station++; build.push({ op: 'queue', to: rq0 });
    const c = station++; build.push({ op: 'conveyor', length: 3, speed: 0.6, spacing: 0.12, to: q1 });
    const q0 = station++; build.push({ op: 'queue', to: c });
    station++; build.push({ op: 'source', kind: 0, at: Array(BUDGET_EACH).fill(0), to: q0 });
  }
  return { name: 'budget', tick: 1 / 60, rows: 2048, kinds: ['item'], ring: 64, rate: 60, ticksPerStep: 1, build };
}
export const BUDGET = budget();

// ---------------------------------------------------------------------------------------------------
// Criteria 7 and 10: the warehouse. Cases arrive at exponential gaps (mean 6 s, 600 an hour) into an inbound queue, ride
// a 10 m belt into a dock queue of six, and two forklifts each take one for an exponential time (mean 10.8 s, so ρ = 0.9)
// to shipping; the dock fills often and the belt backs up behind it. A 0.2 s tick a step at 60 Hz: the model runs twelve
// times faster than the piece's clock. 1,024 records hold any hour's (about 600).

/** Stations: 0 shipped (sink), 1 forklifts (request, resource 0), 2 dock queue, 3 belt, 4 inbound queue, 5 arrivals. */
export const WAREHOUSE: Scene = {
  name: 'warehouse', tick: 0.2, rows: 128, kinds: ['case'], ring: 1024, rate: 60, ticksPerStep: 1,
  build: [
    { op: 'sink' }, { op: 'resource', capacity: 2 }, { op: 'request', r: 0, n: 1, mean_hold: 10.8, to: 0 },
    { op: 'queue', capacity: 6, to: 1 }, { op: 'conveyor', length: 10, speed: 0.5, spacing: 0.6, to: 2 }, { op: 'queue', to: 3 },
    { op: 'source', kind: 0, mean_gap: 6, to: 4 },
  ],
};
export const WAREHOUSE_ST = { shipped: 0, forks: 1, dock: 2, belt: 3, inbound: 4, arrivals: 5 } as const;
