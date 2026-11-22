// sense.lib@1's rule, worked here from the issue's text and README: The sight rule, never from a library: the
// brute-force f64 reference every expected grid, seen bit, blip bit and ghost row comes from. Sight is a ray march
// from each eye to each cell centre over the coarse heights; radar is a disc that ignores terrain; a jammer clears the
// other sides' radar; a cloaked unit shows only to a side with a detect sensor inside its decloak radius; a structure
// seen and then lost stays a ghost until its cell is seen again; a rebuild takes `spread` steps. Every number is an
// IEEE 754 binary64 add, subtract, multiply, divide, floor, ceil, abs or comparison, in the order written here, which
// JavaScript and WebAssembly both give bit for bit. No vitest or Node import, so a scratch script runs it alone.

/** A sensor's kind (README: A sensor row). `sonar` is named and not in this task: a library ignores it. */
export const KIND = { none: 0, eye: 1, radar: 2, sonar: 3, jam: 4, detect: 5 } as const;
/** A unit's flags (README: A unit row). */
export const CLOAKED = 1;
export const STRUCTURE = 2;
/** A cell's state for one side (#552's two bits a player). */
export const UNSEEN = 0;
export const RADAR = 1;
export const SEEN = 2;
export const STATE_NAMES = ['unseen', 'radar', 'seen'] as const;

/** A plate's height samples: `cols` along +x by `rows` along +z, `spacing` m apart, sample (0, 0) at (x0, z0). */
export interface Plate { cols: number; rows: number; spacing: number; x0: number; z0: number; heights: Float32Array }
/** What the program writes in the header (README: The state). `players[s]`: side s's player bits, bit p − 1 for player p. */
export interface Params { cell: number; radarCell: number; spread: number; players: number[]; seed: bigint }
export interface SensorRow { x: number; z: number; height: number; range: number; kind: number; side: number }
export interface UnitRow { x: number; z: number; decloak: number; side: number; kind: number; flags: number }
export const NO_SENSOR: SensorRow = { x: 0, z: 0, height: 0, range: 0, kind: KIND.none, side: 0 };
export const NO_UNIT: UnitRow = { x: 0, z: 0, decloak: 0, side: -1, kind: 0, flags: 0 };

/** The wrong references and libraries the criteria name (README: Planted twins): one flag each, nothing else changed. */
export interface Wrong {
  /** Criterion 1: every height reads 0: the eye's ground, the cell's ground point and the heights the line crosses. */
  flat?: boolean;
  /** Criterion 2: a jammer clears the radar of every side in its range, its own included. */
  jamOwn?: boolean;
  /** Criterion 3: a cloaked unit is hidden from every other side, whatever detect sensor is near. */
  cloakAlways?: boolean;
  /** Criterion 3: a ghost clears when its cell reads radar or seen, not only seen. */
  ghostRadar?: boolean;
  /** Criterion 4: every call rebuilds every row, whatever `spread` says. */
  spreadOne?: boolean;
}

/** What one call leaves in the arrays a test reads (README: The arrays). */
export interface Out {
  fog: Int32Array; seen: Int32Array; blip: Int32Array; ghost: Int32Array; ghostPos: Float64Array; ghostKind: Int32Array;
}

export interface Grids { gc: number; gr: number; q: number; fc: number; fr: number }
/** The sight grid (gc × gr cells of `cell` samples), the cells a side (q) and the fog grid (fc × fr radar cells). */
export function gridsOf(plate: Plate, p: Params): Grids {
  const gc = Math.floor((plate.cols - 1) / p.cell);
  const gr = Math.floor((plate.rows - 1) / p.cell);
  const q = Math.floor(p.cell / p.radarCell);
  return { gc, gr, q, fc: gc * q, fr: gr * q };
}

/** The reference: one state, stepped by `sight(k)` on the rows as they stand, as a library's `sight(s, k)` is. */
export class Sense {
  readonly plate: Plate;
  readonly p: Params;
  readonly wrong: Wrong;
  readonly g: Grids;
  readonly sides: number;
  sensors: SensorRow[];
  units: UnitRow[];
  /** Each side's sight bit per sight cell, and its state per fog cell, as the last rebuild of that row left them. */
  private readonly sightBits: Uint8Array[];
  private readonly state: Uint8Array[];
  private readonly fog: Int32Array;
  private readonly known: Uint8Array;
  private readonly lastPos: Float64Array;
  private readonly lastKind: Int32Array;
  /** How many ray samples the last call compared (README: Criterion 4's fixture). */
  samples = 0;
  /** How many (eye sensor, cell) pairs the last call found in range. */
  rays = 0;

  constructor(plate: Plate, p: Params, sensors: number, units: number, wrong: Wrong = {}) {
    this.plate = plate;
    this.p = p;
    this.wrong = wrong;
    this.g = gridsOf(plate, p);
    this.sides = p.players.length;
    this.sensors = Array.from({ length: sensors }, () => ({ ...NO_SENSOR }));
    this.units = Array.from({ length: units }, () => ({ ...NO_UNIT }));
    this.sightBits = p.players.map(() => new Uint8Array(this.g.gc * this.g.gr));
    this.state = p.players.map(() => new Uint8Array(this.g.fc * this.g.fr));
    this.fog = new Int32Array(this.g.fc * this.g.fr);
    this.known = new Uint8Array(units * this.sides);
    this.lastPos = new Float64Array(units * this.sides * 2);
    this.lastKind = new Int32Array(units * this.sides);
  }

  /** The coarse height of sight cell (cx, cz): the sample at its centre. */
  height(cx: number, cz: number): number {
    if (this.wrong.flat) return 0;
    const half = Math.floor(this.p.cell / 2);
    return this.plate.heights[(cz * this.p.cell + half) * this.plate.cols + cx * this.p.cell + half]!;
  }

  /** README: The sight rule. Whether eye sensor `sn` sees sight cell (tx, tz). */
  sees(sn: SensorRow, tx: number, tz: number): boolean {
    const { gc, gr } = this.g;
    const m = this.plate.spacing * this.p.cell;
    const ex = (sn.x - this.plate.x0) / m;
    const ez = (sn.z - this.plate.z0) / m;
    if (!(ex >= 0 && ex < gc && ez >= 0 && ez < gr)) return false;
    const rc = sn.range / m;
    const dx = tx + 0.5 - ex;
    const dz = tz + 0.5 - ez;
    if (!(dx * dx + dz * dz <= rc * rc)) return false;
    this.rays += 1;
    const he = this.height(Math.floor(ex), Math.floor(ez)) + sn.height;
    const dh = this.height(tx, tz) - he;
    const n = Math.max(Math.ceil(Math.abs(dx)), Math.ceil(Math.abs(dz)));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const px = ex + dx * t;
      const pz = ez + dz * t;
      const y = he + dh * t;
      this.samples += 1;
      if (!(y > this.height(Math.floor(px), Math.floor(pz)))) return false;
    }
    return true;
  }

  /** Whether a radar or jam sensor's disc holds fog cell (fx, fz): its centre within the range, terrain ignored. */
  private covers(sn: SensorRow, fx: number, fz: number): boolean {
    const mr = this.plate.spacing * this.p.radarCell;
    const dx = fx + 0.5 - (sn.x - this.plate.x0) / mr;
    const dz = fz + 0.5 - (sn.z - this.plate.z0) / mr;
    const rr = sn.range / mr;
    return dx * dx + dz * dz <= rr * rr;
  }

  private live(sn: SensorRow, kind: number): boolean { return sn.kind === kind && sn.side >= 0 && sn.side < this.sides; }

  /** One call: the slice of rows step k rebuilds, then every unit's bits and every ghost row. */
  sight(k: number): Out {
    const { gc, gr, q, fc } = this.g;
    const spread = this.wrong.spreadOne ? 1 : this.p.spread;
    const phase = k % spread;
    const from = Math.floor((gr * phase) / spread);
    const to = Math.floor((gr * (phase + 1)) / spread);
    this.samples = 0;
    this.rays = 0;
    for (let s = 0; s < this.sides; s++) {
      const bits = this.sightBits[s]!;
      for (let cz = from; cz < to; cz++) {
        for (let cx = 0; cx < gc; cx++) {
          let any = 0;
          for (const sn of this.sensors) if (this.live(sn, KIND.eye) && sn.side === s && this.sees(sn, cx, cz)) any = 1;
          bits[cz * gc + cx] = any;
        }
      }
    }
    for (let fz = from * q; fz < to * q; fz++) {
      for (let fx = 0; fx < fc; fx++) {
        let value = 0;
        for (let s = 0; s < this.sides; s++) {
          let st: number = UNSEEN;
          if (this.sightBits[s]![Math.floor(fz / q) * gc + Math.floor(fx / q)]) st = SEEN;
          else {
            let radar = false;
            let jammed = false;
            for (const sn of this.sensors) {
              if (this.live(sn, KIND.radar) && sn.side === s && this.covers(sn, fx, fz)) radar = true;
              if (this.live(sn, KIND.jam) && (sn.side !== s || this.wrong.jamOwn === true) && this.covers(sn, fx, fz)) jammed = true;
            }
            if (radar && !jammed) st = RADAR;
          }
          this.state[s]![fz * fc + fx] = st;
          value |= spreadBits(st, this.p.players[s]!);
        }
        this.fog[fz * fc + fx] = value;
      }
    }
    return this.rows();
  }

  /** The fog cell holding a point, or −1 off the grid. */
  private fogCell(x: number, z: number): number {
    const mr = this.plate.spacing * this.p.radarCell;
    const rx = (x - this.plate.x0) / mr;
    const rz = (z - this.plate.z0) / mr;
    if (!(rx >= 0 && rx < this.g.fc && rz >= 0 && rz < this.g.fr)) return -1;
    return Math.floor(rz) * this.g.fc + Math.floor(rx);
  }

  /** Whether side s has a detect sensor within unit u's decloak radius, in sight cells. */
  private detected(u: UnitRow, s: number): boolean {
    if (this.wrong.cloakAlways) return false;
    const m = this.plate.spacing * this.p.cell;
    for (const sn of this.sensors) {
      if (!this.live(sn, KIND.detect) || sn.side !== s) continue;
      const dx = (sn.x - this.plate.x0) / m - (u.x - this.plate.x0) / m;
      const dz = (sn.z - this.plate.z0) / m - (u.z - this.plate.z0) / m;
      if (dx * dx + dz * dz <= u.decloak * u.decloak) return true;
    }
    return false;
  }

  private rows(): Out {
    const S = this.sides;
    const U = this.units.length;
    const seen = new Int32Array(U);
    const blip = new Int32Array(U);
    const ghost = new Int32Array(U * S);
    const ghostPos = new Float64Array(U * S * 2);
    const ghostKind = new Int32Array(U * S);
    this.units.forEach((u, i) => {
      const there = u.side >= 0 && u.side < S;
      const cell = there ? this.fogCell(u.x, u.z) : -1;
      for (let s = 0; s < S; s++) {
        let sees = false;
        if (there && s === u.side) sees = true;
        else if (there) {
          const st = cell < 0 ? UNSEEN : this.state[s]![cell]!;
          const hidden = (u.flags & CLOAKED) !== 0 && !this.detected(u, s);
          if (st === SEEN && !hidden) sees = true;
          if (st === RADAR && !hidden) blip[i]! |= this.p.players[s]!;
        }
        if (sees) seen[i]! |= this.p.players[s]!;
        // Ghosts: a structure another side sees is known to it, with its place and kind; lost, it stays a ghost row
        // until the fog cell holding that place reads seen for that side.
        const at = i * S + s;
        if (there && s !== u.side && sees && (u.flags & STRUCTURE) !== 0) {
          this.known[at] = 1;
          this.lastPos[2 * at] = u.x;
          this.lastPos[2 * at + 1] = u.z;
          this.lastKind[at] = u.kind;
        } else if (this.known[at]) {
          const c = this.fogCell(this.lastPos[2 * at]!, this.lastPos[2 * at + 1]!);
          const st = c < 0 ? UNSEEN : this.state[s]![c]!;
          if (st === SEEN || (this.wrong.ghostRadar === true && st === RADAR)) this.known[at] = 0;
          else {
            ghost[at] = this.p.players[s]!;
            ghostPos[2 * at] = this.lastPos[2 * at]!;
            ghostPos[2 * at + 1] = this.lastPos[2 * at + 1]!;
            ghostKind[at] = this.lastKind[at]!;
          }
        }
      }
    });
    return { fog: this.fog.slice(), seen, blip, ghost, ghostPos, ghostKind };
  }
}

/** A side's state in each of its players' two bits (#552's fog grid: bits 2(p − 1) and 2(p − 1) + 1 for player p). */
export function spreadBits(state: number, players: number): number {
  let v = 0;
  for (let p = 0; p < 16; p++) if ((players >> p) & 1) v |= state << (2 * p);
  return v;
}
/** Player p's state in a fog grid's value (p from 1). */
export const stateOf = (value: number, player: number): number => (value >> (2 * (player - 1))) & 3;

// ---------------------------------------------------------------------------------------------------
// A plan: what a piece's program does each step before it calls `sight` (README: The driver's script). Each step's
// ops set rows or velocities; then `sight(s, k)` runs; then every row with a velocity moves by it (one f64 add a
// coordinate), so a position at step k is its start plus k adds, the same in the model and in the driver.

export type Op =
  | { op: 'sensor'; i: number; row: SensorRow }
  | { op: 'unit'; i: number; row: UnitRow }
  | { op: 'sensor_velocity'; i: number; vx: number; vz: number }
  | { op: 'unit_velocity'; i: number; vx: number; vz: number };
export interface Plan { sensors: number; units: number; steps: Op[][] }

export interface Stepped { out: Out; sensors: SensorRow[]; units: UnitRow[]; samples: number; rays: number }
/** The reference's arrays after each of `steps` steps of `plan`, with the rows each step's call read. */
export function runPlan(plate: Plate, p: Params, plan: Plan, steps: number, wrong: Wrong = {}): Stepped[] {
  const sense = new Sense(plate, p, plan.sensors, plan.units, wrong);
  const sv = new Float64Array(plan.sensors * 2);
  const uv = new Float64Array(plan.units * 2);
  const out: Stepped[] = [];
  for (let k = 0; k < steps; k++) {
    for (const o of plan.steps[k] ?? []) {
      if (o.op === 'sensor') sense.sensors[o.i] = { ...o.row };
      else if (o.op === 'unit') sense.units[o.i] = { ...o.row };
      else if (o.op === 'sensor_velocity') { sv[2 * o.i] = o.vx; sv[2 * o.i + 1] = o.vz; }
      else { uv[2 * o.i] = o.vx; uv[2 * o.i + 1] = o.vz; }
    }
    const made = sense.sight(k);
    out.push({ out: made, sensors: sense.sensors.map((s) => ({ ...s })), units: sense.units.map((u) => ({ ...u })), samples: sense.samples, rays: sense.rays });
    sense.sensors.forEach((s, i) => { s.x += sv[2 * i]!; s.z += sv[2 * i + 1]!; });
    sense.units.forEach((u, i) => { u.x += uv[2 * i]!; u.z += uv[2 * i + 1]!; });
  }
  return out;
}
