// This suite's programs as WebAssembly text (README: Programs) and the bytes they read: the driver, a logic program
// that plays a script of rows and velocities, calls sense.lib@1's `sight` once a step and writes the arrays a piece's
// instancers read; this suite's own sense.lib@1 library, by README's rule, which carries the five planted twins as one
// flag each (README: Planted twins); the script and the heights assets. Nothing here computes an expected value:
// model.ts does. No vitest or Node import beyond Buffer, so a scratch script reads the text alone; helpers.ts
// assembles it.

import { gridsOf, type Params, type Plan, type Plate, type SensorRow, type UnitRow, type Wrong } from './model.ts';

/** sense.lib@1's exports as a pack lists them (README: The surface). */
export const EXPORTS = [{ name: 'sight', params: ['i32', 'i64'], results: [] as string[] }];
export const EXPORT_NAMES = EXPORTS.map((e) => e.name);

/** The state's header (README: The state), offsets from `s`. */
export const HEADER = {
  heights: 0, cols: 4, rows: 8, cell: 12, radarCell: 16, spread: 20, sides: 24, sensors: 28, sensorCount: 32, units: 36, unitCount: 40,
  fog: 44, seen: 48, blip: 52, blipPos: 56, ghost: 60, ghostPos: 64, ghostKind: 68, x0: 72, z0: 80, spacing: 88, seed: 96, players: 104,
} as const;
export const HEADER_BYTES = 256;
export const STATE_BYTES = 2 * 1024 * 1024;
export const ROW_BYTES = 40;

// ---------------------------------------------------------------------------------------------------
// The driver's memory (README: The driver): reads at 0, writes from 64 KiB, the state at 1 MiB, then the rows, the
// velocities, its cursor, and its assets (the script, then the heights).

export const WRITES_AT = 0x10000;
export const STATE_AT = 0x100000;
const SENSORS_AT = 0x300000;
const UNITS_AT = 0x310000;
const SENSOR_VELOCITY_AT = 0x320000;
const UNIT_VELOCITY_AT = 0x328000;
const CURSOR_AT = 0x330000;
export const ASSETS_AT = 0x340000;
const SCRIPT_AT = ASSETS_AT + 4;
export const MAX_ROWS = 1024;
const SCRIPT_HEADER = 128;
const PAGE = 65536;

export interface Counts { fog: number; units: number; ghosts: number }
/** The counts of a piece's arrays: the fog grid's cells, the unit rows, and the ghost rows (a unit a side). */
export function countsOf(plate: Plate, p: Params, plan: Plan): Counts {
  const g = gridsOf(plate, p);
  return { fog: g.fc * g.fr, units: plan.units, ghosts: plan.units * p.players.length };
}
type Type = 'bool' | 'i32' | 'vec2' | 'vec3';
const SIZE: Record<Type, number> = { bool: 4, i32: 4, vec2: 16, vec3: 24 };
/** The driver's writes, in name order (so declaration order and name order lay them out alike). */
export function writesOf(c: Counts): Record<string, { type: Type; count: number }> {
  return {
    blip: { type: 'i32', count: c.units }, blip_at: { type: 'vec3', count: c.units }, blip_pos: { type: 'vec2', count: c.units },
    fog: { type: 'i32', count: c.fog }, gen: { type: 'i32', count: c.units },
    ghost: { type: 'i32', count: c.ghosts }, ghost_at: { type: 'vec3', count: c.ghosts }, ghost_gen: { type: 'i32', count: c.ghosts },
    ghost_kind: { type: 'i32', count: c.ghosts }, ghost_live: { type: 'bool', count: c.ghosts }, ghost_pos: { type: 'vec2', count: c.ghosts },
    live_a: { type: 'bool', count: c.units }, live_b: { type: 'bool', count: c.units }, seen: { type: 'i32', count: c.units },
    unit_live: { type: 'bool', count: c.units }, unit_pos: { type: 'vec3', count: c.units },
  };
}
/** Each write's offset in the write region: in declaration order, each array on an 8-byte boundary (Logic `logic@1`'s region map). */
export function offsetsOf(c: Counts): Record<string, number> {
  const out: Record<string, number> = {};
  let at = 0;
  for (const [name, w] of Object.entries(writesOf(c))) {
    out[name] = at;
    at += Math.ceil((SIZE[w.type] * w.count) / 8) * 8;
  }
  out['(end)'] = at;
  return out;
}
/** The pages a driver's memory holds: its assets end inside it, with room to spare. */
export function pagesOf(script: number, heights: number): number {
  const end = ASSETS_AT + 4 + script + 4 + heights;
  return Math.ceil((end + PAGE) / (16 * PAGE)) * 16;
}

// ---------------------------------------------------------------------------------------------------
// The driver (README: The driver).

const tag = (s: string): string => s.replace(/[^a-z0-9]/gi, '_');
const at = (c: Counts, name: string): number => {
  const o = offsetsOf(c)[name];
  if (o === undefined) throw Error(`the driver writes no array ${name}`);
  return WRITES_AT + o;
};

function driverFunctions(c: Counts): string {
  if (at(c, '(end)') > STATE_AT) throw Error(`BLOCKED: the driver's writes (${at(c, '(end)') - WRITES_AT} bytes) pass its state at ${STATE_AT}`);
  if (c.units > MAX_ROWS) throw Error(`BLOCKED: the driver holds ${MAX_ROWS} rows of a kind, not ${c.units}`);
  const S = STATE_AT;
  const store = (field: number, value: string): string => `(i32.store (i32.const ${S + field}) ${value})`;
  const k = (n: number): string => `(i32.const ${n})`;
  const rows = (code: number, base: number, bytes: number): string => `
        (if (i32.eq (local.get $op) (i32.const ${code})) (then
          (call $copy (i32.add (i32.const ${base}) (i32.mul (i32.load offset=4 (local.get $p)) (i32.const ${bytes}))) (i32.add (local.get $p) (i32.const 8)) (i32.const ${bytes}))
          (local.set $p (i32.add (local.get $p) (i32.const ${bytes + 8})))
          (br $known)))`;
  const vec3 = (to: string, x: string, z: string): string => `
        (f64.store ${to} ${x})
        (f64.store offset=8 ${to} (local.get $y))
        (f64.store offset=16 ${to} ${z})`;
  const move = (count: number, base: number, velocity: number): string => `
    (local.set $n (i32.load (i32.const ${S + count})))
    (local.set $i (i32.const 0))
    (block $moved (loop $move
      (br_if $moved (i32.ge_u (local.get $i) (local.get $n)))
      (local.set $a (i32.add (i32.const ${base}) (i32.mul (local.get $i) (i32.const ${ROW_BYTES}))))
      (local.set $b (i32.add (i32.const ${velocity}) (i32.shl (local.get $i) (i32.const 4))))
      (f64.store (local.get $a) (f64.add (f64.load (local.get $a)) (f64.load (local.get $b))))
      (f64.store offset=8 (local.get $a) (f64.add (f64.load offset=8 (local.get $a)) (f64.load offset=8 (local.get $b))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $move)))`;
  return `
  ;; n bytes, a multiple of 8, from one place to another.
  (func $copy (param $to i32) (param $from i32) (param $n i32) (local $i i32)
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
      (i64.store (i32.add (local.get $to) (local.get $i)) (i64.load (i32.add (local.get $from) (local.get $i))))
      (local.set $i (i32.add (local.get $i) (i32.const 8)))
      (br $each))))
  ;; The header of the state, from the script's own header and this program's addresses; every unit row empty.
  (func $init (export "init") (param $seed i64) (local $i i32) (local $n i32)
    ${store(HEADER.heights, `(i32.add (i32.add (i32.const ${SCRIPT_AT}) (i32.load (i32.const ${ASSETS_AT}))) (i32.const 4))`)}
    (call $copy (i32.const ${S + HEADER.cols}) (i32.const ${SCRIPT_AT}) (i32.const 24))
    ${store(HEADER.sensors, k(SENSORS_AT))}
    ${store(HEADER.sensorCount, `(i32.load (i32.const ${SCRIPT_AT + 24}))`)}
    ${store(HEADER.units, k(UNITS_AT))}
    ${store(HEADER.unitCount, `(i32.load (i32.const ${SCRIPT_AT + 28}))`)}
    ${store(HEADER.fog, k(at(c, 'fog')))}
    ${store(HEADER.seen, k(at(c, 'seen')))}
    ${store(HEADER.blip, k(at(c, 'blip')))}
    ${store(HEADER.blipPos, k(at(c, 'blip_pos')))}
    ${store(HEADER.ghost, k(at(c, 'ghost')))}
    ${store(HEADER.ghostPos, k(at(c, 'ghost_pos')))}
    ${store(HEADER.ghostKind, k(at(c, 'ghost_kind')))}
    (call $copy (i32.const ${S + HEADER.x0}) (i32.const ${SCRIPT_AT + 32}) (i32.const 24))
    (call $copy (i32.const ${S + HEADER.seed}) (i32.const ${SCRIPT_AT + 96}) (i32.const 8))
    (call $copy (i32.const ${S + HEADER.players}) (i32.const ${SCRIPT_AT + 64}) (i32.const 32))
    (local.set $n (i32.load (i32.const ${SCRIPT_AT + 28})))
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
      (i32.store offset=24 (i32.add (i32.const ${UNITS_AT}) (i32.mul (local.get $i) (i32.const ${ROW_BYTES}))) (i32.const -1))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $each)))
    (i32.store (i32.const ${CURSOR_AT}) (i32.const ${SCRIPT_HEADER})))
  ;; One step: this step's ops, then sight, then the arrays the instancers read, then every row moves by its velocity.
  (func $step (export "step") (param $k i64)
    (local $p i32) (local $op i32) (local $i i32) (local $n i32) (local $a i32) (local $b i32) (local $side i32) (local $y f64)
    (local.set $p (i32.add (i32.const ${SCRIPT_AT}) (i32.load (i32.const ${CURSOR_AT}))))
    (block $done (loop $next
      (local.set $op (i32.load (local.get $p)))
      (br_if $done (i32.eq (local.get $op) (i32.const 5)))
      (if (i32.eqz (local.get $op)) (then
        (local.set $p (i32.add (local.get $p) (i32.const 8)))
        (br $done)))
      (block $known${rows(1, SENSORS_AT, ROW_BYTES)}${rows(2, UNITS_AT, ROW_BYTES)}${rows(3, SENSOR_VELOCITY_AT, 16)}${rows(4, UNIT_VELOCITY_AT, 16)}
        (unreachable))
      (br $next)))
    (i32.store (i32.const ${CURSOR_AT}) (i32.sub (local.get $p) (i32.const ${SCRIPT_AT})))
    (call $sight (i32.const ${S}) (local.get $k))
    (local.set $y (f64.load (i32.const ${SCRIPT_AT + 56})))
    (local.set $n (i32.load (i32.const ${S + HEADER.unitCount})))
    (local.set $i (i32.const 0))
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
      (local.set $a (i32.add (i32.const ${UNITS_AT}) (i32.mul (local.get $i) (i32.const ${ROW_BYTES}))))
      (local.set $side (i32.load offset=24 (local.get $a)))
      (local.set $b (i32.shl (local.get $i) (i32.const 2)))
      (i32.store (i32.add (i32.const ${at(c, 'unit_live')}) (local.get $b)) (i32.ge_s (local.get $side) (i32.const 0)))
      (i32.store (i32.add (i32.const ${at(c, 'live_a')}) (local.get $b)) (i32.eqz (local.get $side)))
      (i32.store (i32.add (i32.const ${at(c, 'live_b')}) (local.get $b)) (i32.eq (local.get $side) (i32.const 1)))
      (i32.store (i32.add (i32.const ${at(c, 'gen')}) (local.get $b)) (i32.const 1))
      (local.set $b (i32.add (i32.const ${at(c, 'unit_pos')}) (i32.mul (local.get $i) (i32.const 24))))${vec3('(local.get $b)', '(f64.load (local.get $a))', '(f64.load offset=8 (local.get $a))')}
      (local.set $a (i32.add (i32.const ${at(c, 'blip_pos')}) (i32.shl (local.get $i) (i32.const 4))))
      (local.set $b (i32.add (i32.const ${at(c, 'blip_at')}) (i32.mul (local.get $i) (i32.const 24))))${vec3('(local.get $b)', '(f64.load (local.get $a))', '(f64.load offset=8 (local.get $a))')}
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $each)))
    (local.set $n (i32.mul (local.get $n) (i32.load (i32.const ${S + HEADER.sides}))))
    (local.set $i (i32.const 0))
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
      (local.set $b (i32.shl (local.get $i) (i32.const 2)))
      (i32.store (i32.add (i32.const ${at(c, 'ghost_live')}) (local.get $b)) (i32.ne (i32.load (i32.add (i32.const ${at(c, 'ghost')}) (local.get $b))) (i32.const 0)))
      (i32.store (i32.add (i32.const ${at(c, 'ghost_gen')}) (local.get $b)) (i32.const 1))
      (local.set $a (i32.add (i32.const ${at(c, 'ghost_pos')}) (i32.shl (local.get $i) (i32.const 4))))
      (local.set $b (i32.add (i32.const ${at(c, 'ghost_at')}) (i32.mul (local.get $i) (i32.const 24))))${vec3('(local.get $b)', '(f64.load (local.get $a))', '(f64.load offset=8 (local.get $a))')}
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $each)))${move(HEADER.sensorCount, SENSORS_AT, SENSOR_VELOCITY_AT)}${move(HEADER.unitCount, UNITS_AT, UNIT_VELOCITY_AT)})`;
}
const GLOBALS = `
  (global $reads_at (export "reads_at") i32 (i32.const 0))
  (global $writes_at (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (global $assets_at (export "assets_at") i32 (i32.const ${ASSETS_AT}))`;
const CURSOR_DATA = `
  (data (i32.const ${CURSOR_AT}) "\\80\\00\\00\\00")`;

export interface Text { name: string; text: string }
/** The driver as a relocatable program importing `sight` from `module` (`lib:sense.lib@1`, or `lib:<name>` for a library by its own name). */
export function driverText(module: string, c: Counts, pages: number): Text {
  return {
    name: `sense_driver_${tag(module)}_${c.fog}_${c.units}_${c.ghosts}_${pages}`,
    text: `
(module
  (import "env" "__linear_memory" (memory ${pages} ${pages}))
  (import "${module}" "sight" (func $sight (param i32 i64)))${GLOBALS}${driverFunctions(c)}${CURSOR_DATA})`,
  };
}
// ---------------------------------------------------------------------------------------------------
// The assets: the script (README: The driver's script) and the heights.

const OPS = { end: 0, sensor: 1, unit: 2, sensorVelocity: 3, unitVelocity: 4, halt: 5 } as const;
export function sensorBytes(r: SensorRow): Buffer {
  const b = Buffer.alloc(ROW_BYTES);
  b.writeDoubleLE(r.x, 0); b.writeDoubleLE(r.z, 8); b.writeDoubleLE(r.height, 16); b.writeDoubleLE(r.range, 24);
  b.writeInt32LE(r.kind, 32); b.writeInt32LE(r.side, 36);
  return b;
}
export function unitBytes(r: UnitRow): Buffer {
  const b = Buffer.alloc(ROW_BYTES);
  b.writeDoubleLE(r.x, 0); b.writeDoubleLE(r.z, 8); b.writeDoubleLE(r.decloak, 16);
  b.writeInt32LE(r.side, 24); b.writeInt32LE(r.kind, 28); b.writeInt32LE(r.flags, 32);
  return b;
}
const word = (code: number, i = 0): Buffer => { const b = Buffer.alloc(8); b.writeUInt32LE(code, 0); b.writeUInt32LE(i, 4); return b; };
const pair = (x: number, z: number): Buffer => { const b = Buffer.alloc(16); b.writeDoubleLE(x, 0); b.writeDoubleLE(z, 8); return b; };
/** A plan's script: its header, then each step's ops and an END, then HALT. `drawY`: the height the instancers' arrays draw rows at. */
export function scriptBytes(plate: Plate, p: Params, plan: Plan, drawY = 1): Buffer {
  if (p.players.length < 1 || p.players.length > 8) throw Error(`a state holds 1 to 8 sides, not ${p.players.length}`);
  const h = Buffer.alloc(SCRIPT_HEADER);
  h.writeUInt32LE(plate.cols, 0); h.writeUInt32LE(plate.rows, 4); h.writeUInt32LE(p.cell, 8); h.writeUInt32LE(p.radarCell, 12);
  h.writeUInt32LE(p.spread, 16); h.writeUInt32LE(p.players.length, 20); h.writeUInt32LE(plan.sensors, 24); h.writeUInt32LE(plan.units, 28);
  h.writeDoubleLE(plate.x0, 32); h.writeDoubleLE(plate.z0, 40); h.writeDoubleLE(plate.spacing, 48); h.writeDoubleLE(drawY, 56);
  p.players.forEach((mask, s) => h.writeUInt32LE(mask, 64 + 4 * s));
  h.writeBigInt64LE(p.seed, 96);
  const parts: Buffer[] = [h];
  for (const step of plan.steps) {
    for (const o of step) {
      if (o.op === 'sensor') parts.push(word(OPS.sensor, o.i), sensorBytes(o.row));
      else if (o.op === 'unit') parts.push(word(OPS.unit, o.i), unitBytes(o.row));
      else parts.push(word(o.op === 'sensor_velocity' ? OPS.sensorVelocity : OPS.unitVelocity, o.i), pair(o.vx, o.vz));
    }
    parts.push(word(OPS.end));
  }
  parts.push(word(OPS.halt));
  return Buffer.concat(parts);
}
/** A plate's height samples as the library reads them: binary32, little-endian, row by row along +z, each row along +x. */
export function heightsBytes(plate: Plate): Buffer {
  const b = Buffer.alloc(plate.heights.length * 4);
  plate.heights.forEach((v, i) => b.writeFloatLE(v, 4 * i));
  return b;
}

// ---------------------------------------------------------------------------------------------------
// This suite's own sense.lib@1 library (README: Planted twins), from one text: by README's rule, unless a twin flag
// changes the one thing its criterion names. It keeps no data of its own: every byte is in the state at `s`. Its own
// part of the state: a flag that the coarse heights are copied at +0x7F0, each side's multiplier (its players' bits
// spread two apart) at +0x800, a sight byte per side and sight cell at +0x1000, a state byte per side and fog cell at
// +0x40000, a known byte per ghost row at +0xC0000, each row's last-seen place at +0xD0000 and kind at +0xF0000, and
// the coarse heights (an f64 a sight cell, copied at the first call) at +0x100000. It marches every eye's ray to every
// cell in its range, and skips none another eye already sees.

const OWN = { built: 0x7f0, multiplier: 0x800, sight: 0x1000, state: 0x40000, known: 0xc0000, lastPos: 0xd0000, lastKind: 0xf0000, coarse: 0x100000 } as const;
const twinName = (twin: Wrong): string => Object.entries(twin).filter(([, v]) => v).map(([k]) => k).join('_') || 'rule';

function libraryFunctions(twin: Wrong): string {
  const h = HEADER;
  const ld = (field: number, type = 'i32'): string => `(${type}.load offset=${field} (local.get $s))`;
  /** A point's coordinate in cells of `m` metres: (v − origin) ÷ m. */
  const cells = (v: string, origin: number, m: string): string => `(f64.div (f64.sub ${v} ${ld(origin, 'f64')}) ${m})`;
  const gc = `(i32.div_u (i32.sub ${ld(h.cols)} (i32.const 1)) (local.get $cell))`;
  const gr = `(i32.div_u (i32.sub ${ld(h.rows)} (i32.const 1)) (local.get $cell))`;
  const sightAt = (side: string, z: string, x: string): string =>
    `(i32.add (i32.add (local.get $s) (i32.const ${OWN.sight})) (i32.add (i32.mul (i32.add (i32.mul ${side} (local.get $gr)) ${z}) (local.get $gc)) ${x}))`;
  const stateAt = (side: string, z: string, x: string): string =>
    `(i32.add (i32.add (local.get $s) (i32.const ${OWN.state})) (i32.add (i32.mul (i32.add (i32.mul ${side} (local.get $fr)) ${z}) (local.get $fc)) ${x}))`;
  const multiplierAt = (side: string): string => `(i32.add (i32.add (local.get $s) (i32.const ${OWN.multiplier})) (i32.shl ${side} (i32.const 2)))`;
  const playersAt = (side: string): string => `(i32.add (i32.add (local.get $s) (i32.const ${h.players})) (i32.shl ${side} (i32.const 2)))`;
  const sq = (a: string, b: string): string => `(f64.add (f64.mul ${a} ${a}) (f64.mul ${b} ${b}))`;
  /** Rows z0 to z1 and columns x0 to x1, inclusive, `body` at each (x, z). */
  const box = (body: string): string => `
          (local.set $z (local.get $z0))
          (block $rows (loop $row
            (br_if $rows (i32.gt_s (local.get $z) (local.get $z1)))
            (local.set $x (local.get $x0))
            (block $cols (loop $col
              (br_if $cols (i32.gt_s (local.get $x) (local.get $x1)))${body}
              (local.set $x (i32.add (local.get $x) (i32.const 1)))
              (br $col)))
            (local.set $z (i32.add (local.get $z) (i32.const 1)))
            (br $row)))`;
  const spread = twin.spreadOne ? '(i32.const 1)' : ld(h.spread);
  const jams = twin.jamOwn ? '(i32.const 1)' : '(i32.ne (local.get $t) (local.get $side))';
  const clears = twin.ghostRadar ? '(i32.ne (local.get $st) (i32.const 0))' : '(i32.eq (local.get $st) (i32.const 2))';
  const detected = twin.cloakAlways ? '\n    (return (i32.const 0))' : '';
  const flat = twin.flat ? '\n    (return)' : '';
  /** The coarse height at sight cell (x, z), from the library's own copy. */
  const coarseAt = (z: string, x: string): string => `(f64.load (i32.add (local.get $H) (i32.shl (i32.add (i32.mul ${z} (local.get $gc)) ${x}) (i32.const 3))))`;
  const cellOf = (v: string): string => `(i32.trunc_f64_s (f64.floor ${v}))`;
  /** A cell's centre less a point's coordinate: (i + 0.5) − c. */
  const centreLess = (i: string, c: string): string => `(f64.sub (f64.add (f64.convert_i32_s ${i}) (f64.const 0.5)) ${c})`;
  return `
  ;; The coarse heights, copied once: each sight cell's centre sample as an f64, row by row, at +${OWN.coarse}.
  (func $coarse (param $s i32)
    (local $cell i32) (local $half i32) (local $cols i32) (local $gc i32) (local $gr i32) (local $cx i32) (local $cz i32) (local $o i32) (local $row i32)
    (if (i32.load offset=${OWN.built} (local.get $s)) (then (return)))
    (i32.store offset=${OWN.built} (local.get $s) (i32.const 1))${flat}
    (local.set $cell ${ld(h.cell)})
    (local.set $half (i32.shr_u (local.get $cell) (i32.const 1)))
    (local.set $cols ${ld(h.cols)})
    (local.set $gc ${gc})
    (local.set $gr ${gr})
    (local.set $o (i32.add (local.get $s) (i32.const ${OWN.coarse})))
    (block $done (loop $rows
      (br_if $done (i32.ge_u (local.get $cz) (local.get $gr)))
      (local.set $row (i32.add ${ld(h.heights)} (i32.shl (i32.add (i32.mul (i32.add (i32.mul (local.get $cz) (local.get $cell)) (local.get $half)) (local.get $cols)) (local.get $half)) (i32.const 2))))
      (local.set $cx (i32.const 0))
      (block $ended (loop $cols
        (br_if $ended (i32.ge_u (local.get $cx) (local.get $gc)))
        (f64.store (local.get $o) (f64.promote_f32 (f32.load (i32.add (local.get $row) (i32.shl (i32.mul (local.get $cx) (local.get $cell)) (i32.const 2))))))
        (local.set $o (i32.add (local.get $o) (i32.const 8)))
        (local.set $cx (i32.add (local.get $cx) (i32.const 1)))
        (br $cols)))
      (local.set $cz (i32.add (local.get $cz) (i32.const 1)))
      (br $rows))))
  ;; The first and the last cell a disc of radius r about c can hold, kept to lo..hi (first > last when it holds none).
  (func $first (param $c f64) (param $r f64) (param $lo i32) (param $hi i32) (result i32)
    (i32.trunc_f64_s (f64.min (f64.convert_i32_s (i32.add (local.get $hi) (i32.const 1)))
      (f64.max (f64.convert_i32_s (local.get $lo)) (f64.sub (f64.floor (f64.sub (local.get $c) (local.get $r))) (f64.const 1))))))
  (func $last (param $c f64) (param $r f64) (param $lo i32) (param $hi i32) (result i32)
    (i32.trunc_f64_s (f64.max (f64.convert_i32_s (i32.sub (local.get $lo) (i32.const 1)))
      (f64.min (f64.convert_i32_s (local.get $hi)) (f64.add (f64.floor (f64.add (local.get $c) (local.get $r))) (f64.const 1))))))
  ;; The fog cell holding the point (x, z), row by row, or -1 off the grid.
  (func $fogcell (param $s i32) (param $x f64) (param $z f64) (result i32)
    (local $cell i32) (local $q i32) (local $fc i32) (local $fr i32) (local $mr f64) (local $rx f64) (local $rz f64)
    (local.set $cell ${ld(h.cell)})
    (local.set $q (i32.div_u (local.get $cell) ${ld(h.radarCell)}))
    (local.set $fc (i32.mul ${gc} (local.get $q)))
    (local.set $fr (i32.mul ${gr} (local.get $q)))
    (local.set $mr (f64.mul ${ld(h.spacing, 'f64')} (f64.convert_i32_u ${ld(h.radarCell)})))
    (local.set $rx ${cells('(local.get $x)', h.x0, '(local.get $mr)')})
    (local.set $rz ${cells('(local.get $z)', h.z0, '(local.get $mr)')})
    (if (i32.eqz (i32.and
          (i32.and (f64.ge (local.get $rx) (f64.const 0)) (f64.lt (local.get $rx) (f64.convert_i32_u (local.get $fc))))
          (i32.and (f64.ge (local.get $rz) (f64.const 0)) (f64.lt (local.get $rz) (f64.convert_i32_u (local.get $fr))))))
      (then (return (i32.const -1))))
    (i32.add (i32.mul (i32.trunc_f64_s (f64.floor (local.get $rz))) (local.get $fc)) (i32.trunc_f64_s (f64.floor (local.get $rx)))))
  ;; Whether the side has a detect sensor within the unit row's decloak radius, in sight cells.
  (func $detected (param $s i32) (param $u i32) (param $side i32) (result i32)
    (local $j i32) (local $n i32) (local $sn i32) (local $m f64) (local $dx f64) (local $dz f64) (local $d f64)${detected}
    (local.set $m (f64.mul ${ld(h.spacing, 'f64')} (f64.convert_i32_u ${ld(h.cell)})))
    (local.set $d (f64.load offset=16 (local.get $u)))
    (local.set $n ${ld(h.sensorCount)})
    (local.set $sn ${ld(h.sensors)})
    (block $none (loop $each
      (br_if $none (i32.ge_u (local.get $j) (local.get $n)))
      (if (i32.and (i32.eq (i32.load offset=32 (local.get $sn)) (i32.const 5)) (i32.eq (i32.load offset=36 (local.get $sn)) (local.get $side))) (then
        (local.set $dx (f64.sub ${cells('(f64.load (local.get $sn))', h.x0, '(local.get $m)')} ${cells('(f64.load (local.get $u))', h.x0, '(local.get $m)')}))
        (local.set $dz (f64.sub ${cells('(f64.load offset=8 (local.get $sn))', h.z0, '(local.get $m)')} ${cells('(f64.load offset=8 (local.get $u))', h.z0, '(local.get $m)')}))
        (if (f64.le ${sq('(local.get $dx)', '(local.get $dz)')} (f64.mul (local.get $d) (local.get $d))) (then (return (i32.const 1))))))
      (local.set $sn (i32.add (local.get $sn) (i32.const ${ROW_BYTES})))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br $each)))
    (i32.const 0))
  ;; Every unit's seen and blip bits and blip place, and every ghost row, from the grids as they stand.
  (func $rows (param $s i32) (param $k i64)
    (local $cell i32) (local $q i32) (local $gc i32) (local $gr i32) (local $fc i32) (local $fr i32) (local $S i32) (local $U i32)
    (local $i i32) (local $u i32) (local $uside i32) (local $flags i32) (local $there i32) (local $c i32) (local $side i32) (local $sees i32) (local $st i32)
    (local $seen i32) (local $blip i32) (local $P i32) (local $at i32) (local $g i32) (local $o i32)
    (local $h i64) (local $mr f64)
    (local.set $cell ${ld(h.cell)})
    (local.set $q (i32.div_u (local.get $cell) ${ld(h.radarCell)}))
    (local.set $gc ${gc})
    (local.set $gr ${gr})
    (local.set $fc (i32.mul (local.get $gc) (local.get $q)))
    (local.set $fr (i32.mul (local.get $gr) (local.get $q)))
    (local.set $S ${ld(h.sides)})
    (local.set $U ${ld(h.unitCount)})
    (local.set $mr (f64.mul ${ld(h.spacing, 'f64')} (f64.convert_i32_u ${ld(h.radarCell)})))
    (local.set $u ${ld(h.units)})
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $i) (local.get $U)))
      (local.set $uside (i32.load offset=24 (local.get $u)))
      (local.set $flags (i32.load offset=32 (local.get $u)))
      (local.set $there (i32.lt_u (local.get $uside) (local.get $S)))
      (local.set $c (i32.const -1))
      (if (local.get $there) (then (local.set $c (call $fogcell (local.get $s) (f64.load (local.get $u)) (f64.load offset=8 (local.get $u))))))
      (local.set $seen (i32.const 0))
      (local.set $blip (i32.const 0))
      (local.set $side (i32.const 0))
      (block $sides (loop $one
        (br_if $sides (i32.ge_u (local.get $side) (local.get $S)))
        (local.set $P (i32.load ${playersAt('(local.get $side)')}))
        (local.set $sees (i32.const 0))
        (if (local.get $there) (then
          (if (i32.eq (local.get $side) (local.get $uside))
            (then (local.set $sees (i32.const 1)))
            (else
              (local.set $st (i32.const 0))
              (if (i32.ge_s (local.get $c) (i32.const 0)) (then
                (local.set $st (i32.load8_u (i32.add ${stateAt('(local.get $side)', '(i32.const 0)', '(i32.const 0)')} (local.get $c))))))
              (if (local.get $st) (then
                (local.set $g (i32.const 0))
                (if (i32.and (local.get $flags) (i32.const 1)) (then
                  (local.set $g (i32.eqz (call $detected (local.get $s) (local.get $u) (local.get $side))))))
                (if (i32.eqz (local.get $g)) (then
                  (if (i32.eq (local.get $st) (i32.const 2))
                    (then (local.set $sees (i32.const 1)))
                    (else (local.set $blip (i32.or (local.get $blip) (local.get $P)))))))))))))
        (if (local.get $sees) (then (local.set $seen (i32.or (local.get $seen) (local.get $P)))))
        ;; The ghost row of this unit for this side.
        (local.set $at (i32.add (i32.mul (local.get $i) (local.get $S)) (local.get $side)))
        (local.set $g (i32.const 0))
        (if (i32.and (i32.and (local.get $there) (i32.ne (local.get $side) (local.get $uside))) (i32.and (local.get $sees) (i32.ne (i32.and (local.get $flags) (i32.const 2)) (i32.const 0))))
          (then
            (i32.store8 (i32.add (i32.add (local.get $s) (i32.const ${OWN.known})) (local.get $at)) (i32.const 1))
            (local.set $o (i32.add (i32.add (local.get $s) (i32.const ${OWN.lastPos})) (i32.shl (local.get $at) (i32.const 4))))
            (f64.store (local.get $o) (f64.load (local.get $u)))
            (f64.store offset=8 (local.get $o) (f64.load offset=8 (local.get $u)))
            (i32.store (i32.add (i32.add (local.get $s) (i32.const ${OWN.lastKind})) (i32.shl (local.get $at) (i32.const 2))) (i32.load offset=28 (local.get $u))))
          (else
            (if (i32.load8_u (i32.add (i32.add (local.get $s) (i32.const ${OWN.known})) (local.get $at))) (then
              (local.set $o (i32.add (i32.add (local.get $s) (i32.const ${OWN.lastPos})) (i32.shl (local.get $at) (i32.const 4))))
              (local.set $o (call $fogcell (local.get $s) (f64.load (local.get $o)) (f64.load offset=8 (local.get $o))))
              (local.set $st (i32.const 0))
              (if (i32.ge_s (local.get $o) (i32.const 0)) (then
                (local.set $st (i32.load8_u (i32.add ${stateAt('(local.get $side)', '(i32.const 0)', '(i32.const 0)')} (local.get $o))))))
              (if ${clears}
                (then (i32.store8 (i32.add (i32.add (local.get $s) (i32.const ${OWN.known})) (local.get $at)) (i32.const 0)))
                (else (local.set $g (local.get $P))))))))
        (i32.store (i32.add ${ld(h.ghost)} (i32.shl (local.get $at) (i32.const 2))) (local.get $g))
        (local.set $o (i32.add ${ld(h.ghostPos)} (i32.shl (local.get $at) (i32.const 4))))
        (if (local.get $g)
          (then
            (f64.store (local.get $o) (f64.load (i32.add (i32.add (local.get $s) (i32.const ${OWN.lastPos})) (i32.shl (local.get $at) (i32.const 4)))))
            (f64.store offset=8 (local.get $o) (f64.load offset=8 (i32.add (i32.add (local.get $s) (i32.const ${OWN.lastPos})) (i32.shl (local.get $at) (i32.const 4)))))
            (i32.store (i32.add ${ld(h.ghostKind)} (i32.shl (local.get $at) (i32.const 2)))
              (i32.load (i32.add (i32.add (local.get $s) (i32.const ${OWN.lastKind})) (i32.shl (local.get $at) (i32.const 2))))))
          (else
            (f64.store (local.get $o) (f64.const 0))
            (f64.store offset=8 (local.get $o) (f64.const 0))
            (i32.store (i32.add ${ld(h.ghostKind)} (i32.shl (local.get $at) (i32.const 2))) (i32.const 0))))
        (local.set $side (i32.add (local.get $side) (i32.const 1)))
        (br $one)))
      (i32.store (i32.add ${ld(h.seen)} (i32.shl (local.get $i) (i32.const 2))) (local.get $seen))
      (i32.store (i32.add ${ld(h.blip)} (i32.shl (local.get $i) (i32.const 2))) (local.get $blip))
      ;; The blip's place: somewhere in the unit's radar cell, by a hash of the seed, the unit's row and the step.
      (local.set $o (i32.add ${ld(h.blipPos)} (i32.shl (local.get $i) (i32.const 4))))
      (if (local.get $there)
        (then
          (local.set $h (i64.xor (i64.xor ${ld(h.seed, 'i64')} (i64.mul (i64.extend_i32_u (local.get $i)) (i64.const 0x9e3779b97f4a7c15))) (i64.mul (local.get $k) (i64.const 0xc2b2ae3d27d4eb4f))))
          (local.set $h (i64.mul (i64.xor (local.get $h) (i64.shr_u (local.get $h) (i64.const 29))) (i64.const 0xbf58476d1ce4e5b9)))
          (local.set $h (i64.xor (local.get $h) (i64.shr_u (local.get $h) (i64.const 32))))
          (f64.store (local.get $o) (f64.add ${ld(h.x0, 'f64')} (f64.mul (local.get $mr) (f64.add
            (f64.floor ${cells('(f64.load (local.get $u))', h.x0, '(local.get $mr)')})
            (f64.div (f64.convert_i64_u (i64.shr_u (local.get $h) (i64.const 40))) (f64.const 16777216))))))
          (f64.store offset=8 (local.get $o) (f64.add ${ld(h.z0, 'f64')} (f64.mul (local.get $mr) (f64.add
            (f64.floor ${cells('(f64.load offset=8 (local.get $u))', h.z0, '(local.get $mr)')})
            (f64.div (f64.convert_i64_u (i64.and (i64.shr_u (local.get $h) (i64.const 16)) (i64.const 0xffffff))) (f64.const 16777216)))))))
        (else
          (f64.store (local.get $o) (f64.const 0))
          (f64.store offset=8 (local.get $o) (f64.const 0))))
      (local.set $u (i32.add (local.get $u) (i32.const ${ROW_BYTES})))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $each))))
  ;; One call (README: One call): the rows of the grids this step rebuilds, then the units and the ghosts.
  (func $sight (export "sight") (param $s i32) (param $k i64)
    (local $cell i32) (local $q i32) (local $gc i32) (local $gr i32) (local $fc i32) (local $fr i32) (local $S i32) (local $N i32)
    (local $spread i32) (local $phase i32) (local $from i32) (local $to i32) (local $side i32) (local $j i32) (local $sn i32) (local $kind i32)
    (local $x i32) (local $z i32) (local $x0 i32) (local $x1 i32) (local $z0 i32) (local $z1 i32) (local $p i32) (local $b i32) (local $st i32) (local $v i32) (local $t i32)
    (local $H i32) (local $n i32) (local $i i32) (local $g i32) (local $f i32)
    (local $m f64) (local $mr f64) (local $c f64) (local $d f64) (local $r f64) (local $rr f64) (local $he f64) (local $dx f64) (local $dz f64) (local $dh f64) (local $nf f64) (local $tt f64)
    (call $coarse (local.get $s))
    (local.set $H (i32.add (local.get $s) (i32.const ${OWN.coarse})))
    (local.set $cell ${ld(h.cell)})
    (local.set $q (i32.div_u (local.get $cell) ${ld(h.radarCell)}))
    (local.set $gc ${gc})
    (local.set $gr ${gr})
    (local.set $fc (i32.mul (local.get $gc) (local.get $q)))
    (local.set $fr (i32.mul (local.get $gr) (local.get $q)))
    (local.set $S ${ld(h.sides)})
    (local.set $N ${ld(h.sensorCount)})
    (local.set $spread ${spread})
    (local.set $phase (i32.wrap_i64 (i64.rem_u (local.get $k) (i64.extend_i32_u (local.get $spread)))))
    (local.set $from (i32.div_u (i32.mul (local.get $gr) (local.get $phase)) (local.get $spread)))
    (local.set $to (i32.div_u (i32.mul (local.get $gr) (i32.add (local.get $phase) (i32.const 1))) (local.get $spread)))
    (local.set $m (f64.mul ${ld(h.spacing, 'f64')} (f64.convert_i32_u (local.get $cell))))
    (local.set $mr (f64.mul ${ld(h.spacing, 'f64')} (f64.convert_i32_u ${ld(h.radarCell)})))
    ;; Each side's multiplier: a state times it is the state in each of the side's players' two bits.
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $side) (local.get $S)))
      (local.set $b (i32.load ${playersAt('(local.get $side)')}))
      (local.set $v (i32.const 0))
      (local.set $t (i32.const 0))
      (block $bits (loop $bit
        (br_if $bits (i32.ge_u (local.get $t) (i32.const 16)))
        (if (i32.and (i32.shr_u (local.get $b) (local.get $t)) (i32.const 1))
          (then (local.set $v (i32.or (local.get $v) (i32.shl (i32.const 1) (i32.shl (local.get $t) (i32.const 1)))))))
        (local.set $t (i32.add (local.get $t) (i32.const 1)))
        (br $bit)))
      (i32.store ${multiplierAt('(local.get $side)')} (local.get $v))
      ;; This step's rows of the side's sight bytes start clear.
      (local.set $p ${sightAt('(local.get $side)', '(local.get $from)', '(i32.const 0)')})
      (local.set $x1 (i32.add (local.get $p) (i32.mul (i32.sub (local.get $to) (local.get $from)) (local.get $gc))))
      (block $zeroed (loop $zero
        (br_if $zeroed (i32.ge_u (local.get $p) (local.get $x1)))
        (i32.store8 (local.get $p) (i32.const 0))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $zero)))
      (local.set $side (i32.add (local.get $side) (i32.const 1)))
      (br $each)))
    ;; Each sensor row marks the cells of this step's rows it holds.
    (local.set $sn ${ld(h.sensors)})
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $j) (local.get $N)))
      (local.set $kind (i32.load offset=32 (local.get $sn)))
      (local.set $side (i32.load offset=36 (local.get $sn)))
      (if (i32.lt_u (local.get $side) (local.get $S)) (then
        (if (i32.eq (local.get $kind) (i32.const 1)) (then
          ;; An eye (README: The sight rule): c and d are its place in sight cells.
          (local.set $c ${cells('(f64.load (local.get $sn))', h.x0, '(local.get $m)')})
          (local.set $d ${cells('(f64.load offset=8 (local.get $sn))', h.z0, '(local.get $m)')})
          (if (i32.and
                (i32.and (f64.ge (local.get $c) (f64.const 0)) (f64.lt (local.get $c) (f64.convert_i32_u (local.get $gc))))
                (i32.and (f64.ge (local.get $d) (f64.const 0)) (f64.lt (local.get $d) (f64.convert_i32_u (local.get $gr))))) (then
            (local.set $r (f64.div (f64.load offset=24 (local.get $sn)) (local.get $m)))
            (local.set $rr (f64.mul (local.get $r) (local.get $r)))
            (local.set $he (f64.add ${coarseAt(cellOf('(local.get $d)'), cellOf('(local.get $c)'))} (f64.load offset=16 (local.get $sn))))
            (local.set $g ${sightAt('(local.get $side)', '(i32.const 0)', '(i32.const 0)')})
            (local.set $x0 (call $first (local.get $c) (local.get $r) (i32.const 0) (i32.sub (local.get $gc) (i32.const 1))))
            (local.set $x1 (call $last (local.get $c) (local.get $r) (i32.const 0) (i32.sub (local.get $gc) (i32.const 1))))
            (local.set $z0 (call $first (local.get $d) (local.get $r) (local.get $from) (i32.sub (local.get $to) (i32.const 1))))
            (local.set $z1 (call $last (local.get $d) (local.get $r) (local.get $from) (i32.sub (local.get $to) (i32.const 1))))${box(`
              (local.set $dx ${centreLess('(local.get $x)', '(local.get $c)')})
              (local.set $dz ${centreLess('(local.get $z)', '(local.get $d)')})
              (if (f64.le ${sq('(local.get $dx)', '(local.get $dz)')} (local.get $rr)) (then
                (local.set $dh (f64.sub ${coarseAt('(local.get $z)', '(local.get $x)')} (local.get $he)))
                (local.set $n (i32.trunc_f64_s (f64.max (f64.ceil (f64.abs (local.get $dx))) (f64.ceil (f64.abs (local.get $dz))))))
                (local.set $nf (f64.convert_i32_s (local.get $n)))
                (local.set $i (i32.const 1))
                (block $blocked
                  (block $clear (loop $march
                    (br_if $clear (i32.ge_s (local.get $i) (local.get $n)))
                    (local.set $tt (f64.div (f64.convert_i32_s (local.get $i)) (local.get $nf)))
                    (br_if $blocked (i32.eqz (f64.gt
                      (f64.add (local.get $he) (f64.mul (local.get $dh) (local.get $tt)))
                      ${coarseAt(cellOf('(f64.add (local.get $d) (f64.mul (local.get $dz) (local.get $tt)))'), cellOf('(f64.add (local.get $c) (f64.mul (local.get $dx) (local.get $tt)))'))})))
                    (local.set $i (i32.add (local.get $i) (i32.const 1)))
                    (br $march)))
                  (i32.store8 (i32.add (local.get $g) (i32.add (i32.mul (local.get $z) (local.get $gc)) (local.get $x))) (i32.const 1)))))`)}))))
        (if (i32.or (i32.eq (local.get $kind) (i32.const 2)) (i32.eq (local.get $kind) (i32.const 4))) (then
          ;; A radar or a jammer: c and d are its place in radar cells; its disc ignores the heights.
          (local.set $c ${cells('(f64.load (local.get $sn))', h.x0, '(local.get $mr)')})
          (local.set $d ${cells('(f64.load offset=8 (local.get $sn))', h.z0, '(local.get $mr)')})
          (local.set $r (f64.div (f64.load offset=24 (local.get $sn)) (local.get $mr)))
          (local.set $rr (f64.mul (local.get $r) (local.get $r)))
          (local.set $x0 (call $first (local.get $c) (local.get $r) (i32.const 0) (i32.sub (local.get $fc) (i32.const 1))))
          (local.set $x1 (call $last (local.get $c) (local.get $r) (i32.const 0) (i32.sub (local.get $fc) (i32.const 1))))
          (local.set $z0 (call $first (local.get $d) (local.get $r) (i32.mul (local.get $from) (local.get $q)) (i32.sub (i32.mul (local.get $to) (local.get $q)) (i32.const 1))))
          (local.set $z1 (call $last (local.get $d) (local.get $r) (i32.mul (local.get $from) (local.get $q)) (i32.sub (i32.mul (local.get $to) (local.get $q)) (i32.const 1))))${box(`
              (local.set $dx ${centreLess('(local.get $x)', '(local.get $c)')})
              (local.set $dz ${centreLess('(local.get $z)', '(local.get $d)')})
              (if (f64.le ${sq('(local.get $dx)', '(local.get $dz)')} (local.get $rr)) (then
                (if (i32.eq (local.get $kind) (i32.const 2))
                  (then
                    (local.set $p ${stateAt('(local.get $side)', '(local.get $z)', '(local.get $x)')})
                    (i32.store8 (local.get $p) (i32.or (i32.load8_u (local.get $p)) (i32.const 0x10))))
                  (else
                    (local.set $t (i32.const 0))
                    (block $jammed (loop $jam
                      (br_if $jammed (i32.ge_u (local.get $t) (local.get $S)))
                      (if ${jams} (then
                        (local.set $p ${stateAt('(local.get $t)', '(local.get $z)', '(local.get $x)')})
                        (i32.store8 (local.get $p) (i32.or (i32.load8_u (local.get $p)) (i32.const 0x20)))))
                      (local.set $t (i32.add (local.get $t) (i32.const 1)))
                      (br $jam)))))))`)}))))
      (local.set $sn (i32.add (local.get $sn) (i32.const ${ROW_BYTES})))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br $each)))
    ;; Each fog cell of this step's rows: each side's state, into its players' bits of the grid's value.
    (local.set $z1 (i32.mul (local.get $to) (local.get $q)))
    (local.set $side (i32.const 0))
    (block $sides (loop $one
      (br_if $sides (i32.ge_u (local.get $side) (local.get $S)))
      (local.set $v (i32.load ${multiplierAt('(local.get $side)')}))
      (local.set $z (i32.mul (local.get $from) (local.get $q)))
      (block $rows (loop $row
        (br_if $rows (i32.ge_u (local.get $z) (local.get $z1)))
        (local.set $p ${stateAt('(local.get $side)', '(local.get $z)', '(i32.const 0)')})
        (local.set $g ${sightAt('(local.get $side)', '(i32.div_u (local.get $z) (local.get $q))', '(i32.const 0)')})
        (local.set $f (i32.add ${ld(h.fog)} (i32.shl (i32.mul (local.get $z) (local.get $fc)) (i32.const 2))))
        (local.set $x (i32.const 0))
        (block $cols (loop $col
          (br_if $cols (i32.ge_u (local.get $x) (local.get $fc)))
          (local.set $st (i32.eq (i32.and (i32.load8_u (local.get $p)) (i32.const 0x30)) (i32.const 0x10)))
          (if (i32.load8_u (i32.add (local.get $g) (i32.div_u (local.get $x) (local.get $q)))) (then (local.set $st (i32.const 2))))
          (i32.store8 (local.get $p) (local.get $st))
          (if (local.get $side)
            (then (i32.store (local.get $f) (i32.or (i32.load (local.get $f)) (i32.mul (local.get $st) (local.get $v)))))
            (else (i32.store (local.get $f) (i32.mul (local.get $st) (local.get $v)))))
          (local.set $p (i32.add (local.get $p) (i32.const 1)))
          (local.set $f (i32.add (local.get $f) (i32.const 4)))
          (local.set $x (i32.add (local.get $x) (i32.const 1)))
          (br $col)))
        (local.set $z (i32.add (local.get $z) (i32.const 1)))
        (br $row)))
      (local.set $side (i32.add (local.get $side) (i32.const 1)))
      (br $one)))
    (call $rows (local.get $s) (local.get $k)))`;
}
/** This suite's library as a relocatable object's text: it imports the caller's memory and nothing else. */
export function libraryText(twin: Wrong = {}): Text {
  return { name: `sense_lib_${twinName(twin)}`, text: `
(module
  (import "env" "__linear_memory" (memory 0))${libraryFunctions(twin)})` };
}
