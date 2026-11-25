// This suite's logic programs, as an agent would write them, in WebAssembly text: relocatable objects (#190's README:
// Relocatable objects) that import circuit@1's exports through the interface (`lib:circuit@1`, #416) or by a library's
// own name (`lib:<name>`, #190), assembled by #416's arrangement of #190's assembler (../416/interfaces/wat.ts). Each
// one, at init, adds every node and then every part of the built table, in order, with the part's own builder; each
// step solves the circuit (README: Exports) and copies the state's head, the arrays of circuit.state@1, over the start
// of its write region (README: The state and its arrays).

import type { Program } from '../190/helpers.ts';
import { assemble } from '../416/interfaces/wat.ts';
import type { Circuit } from './circuits.ts';

/**
 * A program's memory (README: Memory): its read region at 0 (the address `solve` reads inputs from), writes at 4096,
 * 8 bytes of data at 49152 (the libraries' data follow it), its assets at 262144 (the built table first, after its u32
 * length), the state at 1 MiB; 2 MiB in all.
 */
export const READS_AT = 0, WRITES_AT = 4096, DATA_AT = 49_152, ASSETS_AT = 262_144, STATE_AT = 1 << 20, PAGES = 32;
const TABLE_AT = ASSETS_AT + 4;

export type WriteType = 'i32' | 'f64';
export type Writes = Record<string, { type: WriteType; count?: number }>;
/** circuit.state@1's arrays for n nodes and p parts, in the order and types the state's head holds them (README: The state and its arrays). */
export const stateWrites = (n: number, p: number): Writes => ({
  v: { type: 'f64', count: n },
  i_rms: { type: 'f64', count: p }, i: { type: 'f64', count: p }, p: { type: 'f64', count: p }, r: { type: 'f64', count: p },
  on: { type: 'i32', count: p },
  energy: { type: 'f64', count: p }, kwh: { type: 'f64', count: p },
  drift: { type: 'f64', count: p }, drift_x: { type: 'f64', count: p },
});
export const writesOf = (c: Circuit): Writes => stateWrites(c.nodes.length, c.parts.length);
const BYTES: Record<WriteType, number> = { i32: 4, f64: 8 };
/** Where each array of `writes` starts in a write region, and the size of them all: each 8-aligned, in order (the region map's layout). */
export function offsets(writes: Writes): { at: Record<string, number>; size: number } {
  const at: Record<string, number> = {};
  let size = 0;
  for (const [name, w] of Object.entries(writes)) { at[name] = size; size += Math.ceil((BYTES[w.type] * (w.count ?? 1)) / 8) * 8; }
  return { at, size };
}

/** The builders, one for nodes and one for each kind of part (the issue's Fields), and `solve`. */
export const BUILDERS = ['node', 'source_dc', 'source_ac', 'resistor', 'load', 'switch', 'connector', 'fuse', 'meter', 'wire', 'fault'] as const;
type Export = typeof BUILDERS[number] | 'solve';
const SIG: Record<Export, string> = {
  ...Object.fromEntries(BUILDERS.map((b) => [b, '(param i32 i32 i32) (result i32)'])) as Record<typeof BUILDERS[number], string>,
  solve: '(param i32 i32 i64 i64) (result i32)',
};
/** circuit@1's exports with their signatures, as its pack declares them (README: Exports). */
export const EXPORTS = (Object.entries(SIG) as [Export, string][]).map(([name, sig]) => {
  const [, params, results] = /^\(param ([^)]*)\)(?: \(result ([^)]*)\))?$/.exec(sig)!;
  return { name, params: params!.split(' '), results: results ? results.split(' ') : [] };
});

export interface Script {
  name: string;
  circuit: Circuit;
  /** `per` of every solve: the circuit's steps a second. */
  per: number;
  /** Circuit steps solved in one logic step (README: Pieces: more than one solve a step); 1 unless given. 0: none (an idle twin). */
  solves?: number;
}
const tag = (s: string): string => s.replace(/[^a-z0-9]/gi, '_');
const S = `(i32.const ${STATE_AT})`, G = `(i32.const ${TABLE_AT})`;

/**
 * A script as a program importing circuit@1's exports from `module`. `init` adds nodes 0 … N − 1, then each part with
 * its kind's builder (a part of a kind circuit@1 has no builder for, such as a diode, gets no call: the check refuses
 * it first). With `solves` n, logic step 0 solves circuit step 0 and logic step k ≥ 1 solves circuit steps
 * n(k − 1) + 1 … nk, so step k leaves circuit step nk; with n = 1 that is `solve(s, reads_at, k, per)`.
 */
export function circuitProgram(sc: Script, module: string): Program {
  const n = sc.solves ?? 1;
  const head = offsets(writesOf(sc.circuit)).size;
  if (WRITES_AT + head > DATA_AT) throw Error(`script ${sc.name}'s arrays pass its data at ${DATA_AT}`);
  const kinds = sc.circuit.parts.map((p) => p.kind).filter((k): k is Export => (BUILDERS as readonly string[]).includes(k) && k !== 'node');
  const uses = BUILDERS.filter((b) => b === 'node' || kinds.includes(b));
  const imports = [...uses, ...(n > 0 ? ['solve' as const] : [])];
  const adds = [
    ...sc.circuit.nodes.map((_, i) => `(drop (call $node ${S} ${G} (i32.const ${i})))`),
    ...sc.circuit.parts.flatMap((p, i) => ((BUILDERS as readonly string[]).includes(p.kind) && p.kind !== 'node' ? [`(drop (call $${p.kind} ${S} ${G} (i32.const ${i})))`] : [])),
  ];
  const solve = (k: string): string => `(drop (call $solve ${S} (i32.const ${READS_AT}) ${k} (i64.const ${sc.per})))`;
  const step = n === 0 ? '' : n === 1 ? solve('(local.get $k)') : `
    (if (i64.eqz (local.get $k))
      (then ${solve('(i64.const 0)')})
      (else
        (local.set $j (i64.add (i64.mul (i64.sub (local.get $k) (i64.const 1)) (i64.const ${n})) (i64.const 1)))
        (local.set $end (i64.mul (local.get $k) (i64.const ${n})))
        (loop $each
          ${solve('(local.get $j)')}
          (local.set $j (i64.add (local.get $j) (i64.const 1)))
          (br_if $each (i64.le_s (local.get $j) (local.get $end))))))`;
  return assemble(`${tag(sc.name)}_${tag(module)}_${n}`, `
(module
  (import "env" "__linear_memory" (memory ${PAGES} ${PAGES}))
${imports.map((e) => `  (import "${module}" "${e}" (func $${e} ${SIG[e]}))`).join('\n')}
  (global (export "reads_at") i32 (i32.const ${READS_AT}))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (global (export "assets_at") i32 (i32.const ${ASSETS_AT}))
  (func (export "init") (param $seed i64)
    ${adds.join('\n    ')})
  (func (export "step") (param $k i64) (local $j i64) (local $end i64)
    ${step}
    (memory.copy (i32.const ${WRITES_AT}) ${S} (i32.const ${head})))
  (data (i32.const ${DATA_AT}) "\\00\\00\\00\\00\\00\\00\\00\\00"))`, 'program');
}
