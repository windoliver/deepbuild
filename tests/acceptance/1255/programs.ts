// This suite's logic programs, as an agent would write them, in WebAssembly text: relocatable objects (#190's README:
// Relocatable objects) that import separation@1's exports through the interface (`lib:separation@1`, #416) or by a
// library's own name (`lib:<name>`, #190), assembled by #416's arrangement of #190's assembler (../416/interfaces/wat.ts).
// Each one starts the state from the built table and adds every mover at init, runs its script's calls at each step,
// and then copies the state's head, the arrays of separation.state@1, over the start of its write region (README:
// The state and its arrays). The control records a script asks for sit after them, in its own arrays.

import type { Program } from '../190/helpers.ts';
import { assemble } from '../416/interfaces/wat.ts';
import { KIND, WHY } from './model.ts';

/**
 * A program's memory (README: Memory): 0 reads, 4096 writes, 49152 its data (the libraries' data follow it), 262144 its
 * assets (the built table first), 1 MiB the state; 2 MiB in all.
 */
export const WRITES_AT = 4096, DATA_AT = 49_152, ASSETS_AT = 262_144, STATE_AT = 1 << 20, PAGES = 32;
/** The built table's bytes, after the u32 of its length. */
const TABLE_AT = ASSETS_AT + 4;
/** separation.state@1's sizes (README: The state and its arrays): fix slots a mover, and windows written. */
export const SLOTS = 8, WINDOWS = 64;

type WriteType = 'i32' | 'f64' | 'vec3';
export type Writes = Record<string, { type: WriteType; count?: number }>;
/** The arrays of separation.state@1 for `m` movers, in the order and types the state's head holds them (README: The state and its arrays). */
export const stateWrites = (m: number): Writes => ({
  fix_count: { type: 'i32', count: m }, fix_ref: { type: 'i32', count: SLOTS * m }, fix_pos: { type: 'vec3', count: SLOTS * m },
  fix_speed: { type: 'f64', count: SLOTS * m }, fix_time: { type: 'f64', count: SLOTS * m },
  delay_s: { type: 'f64', count: m }, delay_fix: { type: 'i32', count: m },
  win_count: { type: 'i32' }, win_a: { type: 'i32', count: WINDOWS }, win_b: { type: 'i32', count: WINDOWS },
  win_from: { type: 'f64', count: WINDOWS }, win_to: { type: 'f64', count: WINDOWS }, win_min: { type: 'f64', count: WINDOWS },
  win_row: { type: 'i32', count: WINDOWS }, win_basis: { type: 'i32', count: WINDOWS },
  closest_a: { type: 'i32' }, closest_b: { type: 'i32' }, closest_dist: { type: 'f64' }, closest_time: { type: 'f64' },
});
const BYTES: Record<WriteType, number> = { i32: 4, f64: 8, vec3: 24 };
/** Where each array of `writes` starts in a write region and where they end: each one 8-aligned, in order (the region map's layout). */
export function offsets(writes: Writes): { at: Record<string, number>; size: number } {
  const at: Record<string, number> = {};
  let size = 0;
  for (const [name, w] of Object.entries(writes)) { at[name] = size; size += Math.ceil((BYTES[w.type] * (w.count ?? 1)) / 8) * 8; }
  return { at, size };
}
/** A control record's fields (README: The control record), then what `delay` and `apply` returned for it: 64 bytes, each field in 8. */
export const RECORD = ['kind', 'mover', 'from', 'to', 'value', 'why', 'ret', 'did'] as const;
export const RECORD_BYTES = 8 * RECORD.length;
/** The arrays a script's item writes: the state's, then one record's fields for each name in `records`. */
export const scriptWrites = (m: number, records: string[] = []): Writes => ({
  ...stateWrites(m),
  ...Object.fromEntries(records.flatMap((r) => RECORD.map((f) => [`${r}_${f}`, { type: f === 'value' ? 'f64' as const : 'i32' as const }]))),
});

/** A call a script makes at a step (README: Exports), in the order written. */
export type Op =
  | { op: 'closest'; a: number; b: number; span: [number, number] }
  | { op: 'conflicts'; span: [number, number] }
  /** delay(mover, seconds) asked at time `t`, its control written as record `rec` and its result as `<rec>_ret`. */
  | { op: 'delay'; mover: number; seconds: number; t: number; rec: string }
  /** apply(record `rec`), its result written as `<rec>_did`. */
  | { op: 'apply'; rec: string }
  /** The piece's own fix: when the state holds a window, apply a hold of `mover` by `seconds`, a control the program carries as data. */
  | { op: 'hold_if_conflict'; mover: number; seconds: number };
export interface Script { name: string; movers: number; records?: string[]; steps?: Op[][]; each?: Op[] }

const SIG = {
  minima: '(param i32 i32) (result i32)', mover: '(param i32 i32) (result i32)', closest: '(param i32 i32 i32 f64 f64) (result f64)',
  conflicts: '(param i32 f64 f64) (result i32)', next_conflict: '(param i32 f64) (result i32)', delay: '(param i32 i32 f64 f64 i32) (result i32)', apply: '(param i32 i32) (result i32)',
} as const;
type Export = keyof typeof SIG;
/** separation@1's exports with their signatures, as its pack declares them (README: Exports). */
export const EXPORTS = Object.entries(SIG).map(([name, sig]) => {
  const [, params, results] = /^\(param ([^)]*)\)(?: \(result ([^)]*)\))?$/.exec(sig)!;
  return { name, params: params!.split(' '), results: results ? results.split(' ') : [] };
});
/** A name the assembler's file name can hold. */
const tag = (s: string): string => s.replace(/[^a-z0-9]/gi, '_');
const dataText = (b: Buffer): string => Array.from(b, (x) => `\\${x.toString(16).padStart(2, '0')}`).join('');
const S = `(i32.const ${STATE_AT})`;

/**
 * A script as a program importing separation@1's exports from `module`. `init` starts the state from the built table
 * and adds movers 0 to m − 1; `step(k)` runs `steps[k]`, then `each`, then publishes the state's arrays.
 */
export function script(sc: Script, module: string): Program {
  const records = sc.records ?? [], steps = sc.steps ?? [], each = sc.each ?? [];
  const { at, size } = offsets(scriptWrites(sc.movers, records));
  const state = offsets(stateWrites(sc.movers));
  const rec = (name: string): number => {
    if (!records.includes(name)) throw Error(`script ${sc.name} has no record ${name}`);
    return WRITES_AT + at[`${name}_kind`]!;
  };
  if (WRITES_AT + size > DATA_AT) throw Error(`script ${sc.name}'s arrays pass its data at ${DATA_AT}`);
  // The holds the piece carries as data, one control record each (README: The control record).
  const holds = [...steps.flat(), ...each].filter((o) => o.op === 'hold_if_conflict');
  const data = Buffer.alloc(Math.max(8, 48 * holds.length));
  holds.forEach((h, i) => {
    if (h.op !== 'hold_if_conflict') return;
    [KIND.hold, h.mover, -1, -1].forEach((x, f) => data.writeInt32LE(x, 48 * i + 8 * f));
    data.writeDoubleLE(h.seconds, 48 * i + 32);
    data.writeInt32LE(WHY.none, 48 * i + 40);
  });
  const text = (o: Op): string => {
    switch (o.op) {
      case 'closest': return `(drop (call $closest ${S} (i32.const ${o.a}) (i32.const ${o.b}) (f64.const ${o.span[0]}) (f64.const ${o.span[1]})))`;
      case 'conflicts': return `(drop (call $conflicts ${S} (f64.const ${o.span[0]}) (f64.const ${o.span[1]})))`;
      case 'delay': return `(i32.store (i32.const ${rec(o.rec) + 48}) (call $delay ${S} (i32.const ${o.mover}) (f64.const ${o.seconds}) (f64.const ${o.t}) (i32.const ${rec(o.rec)})))`;
      case 'apply': return `(i32.store (i32.const ${rec(o.rec) + 56}) (call $apply ${S} (i32.const ${rec(o.rec)})))`;
      case 'hold_if_conflict': return `(if (i32.gt_s (i32.load (i32.const ${STATE_AT + state.at['win_count']!})) (i32.const 0)) (then (drop (call $apply ${S} (i32.const ${DATA_AT + 48 * holds.indexOf(o)})))))`;
    }
  };
  const used = new Set<Export>(['minima', 'mover']);
  for (const o of [...steps.flat(), ...each]) used.add(o.op === 'hold_if_conflict' ? 'apply' : o.op);
  const uses = (Object.keys(SIG) as Export[]).filter((n) => used.has(n));
  return assemble(`${tag(sc.name)}_${tag(module)}`, `
(module
  (import "env" "__linear_memory" (memory ${PAGES} ${PAGES}))
${uses.map((n) => `  (import "${module}" "${n}" (func $${n} ${SIG[n]}))`).join('\n')}
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (global (export "assets_at") i32 (i32.const ${ASSETS_AT}))
  (func (export "init") (param $seed i64) (local $i i32)
    (drop (call $minima ${S} (i32.const ${TABLE_AT})))
    (loop $add
      (drop (call $mover ${S} (local.get $i)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $add (i32.lt_u (local.get $i) (i32.const ${sc.movers})))))
  (func (export "step") (param $k i64)${steps.map((ops, k) => (ops.length ? `
    (if (i64.eq (local.get $k) (i64.const ${k})) (then
      ${ops.map(text).join('\n      ')}))` : '')).join('')}${each.map((o) => `
    ${text(o)}`).join('')}
    (memory.copy (i32.const ${WRITES_AT}) ${S} (i32.const ${state.size})))
  (data (i32.const ${DATA_AT}) "${dataText(data)}"))`, 'program');
}
