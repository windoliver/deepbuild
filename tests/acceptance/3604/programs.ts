// This suite's logic programs, as an agent would write them, in WebAssembly text: relocatable objects (#190's README:
// Relocatable objects) that import circuit@2's exports through the interface (`lib:circuit@2`, #416) or by a library's
// own name (`lib:<name>`, #190), assembled by #416's arrangement of #190's assembler (../416/interfaces/wat.ts), as
// #1181's programs are. Each one, at init, adds every node and then every part of the built table, in order, with the
// part's own builder; each circuit step it writes its own arrays, solves the step (README: Exports) and tallies what it
// watches; each logic step it copies the state's head, circuit.state@2's arrays, over the start of its write region.

import type { Program } from '../190/helpers.ts';
import { assemble } from '../416/interfaces/wat.ts';
import { index, type Circuit, type Fix } from './circuits.ts';

/** A program's memory (README: Memory), #1181's: reads at 0, writes at 4096, data at 49152, assets at 262144, the state at 1 MiB; 2 MiB. */
export const READS_AT = 0, WRITES_AT = 4096, DATA_AT = 49_152, ASSETS_AT = 262_144, STATE_AT = 1 << 20, PAGES = 32;
const TABLE_AT = ASSETS_AT + 4;

export type WriteType = 'i32' | 'f64';
export type Writes = Record<string, { type: WriteType; count?: number }>;
/** circuit.state@2's arrays for n nodes and p parts, in the order and types the state's head holds them (README: The state). */
export const stateWrites = (n: number, p: number): Writes => ({
  v: { type: 'f64', count: n },
  i_rms: { type: 'f64', count: p }, i: { type: 'f64', count: p }, p: { type: 'f64', count: p }, r: { type: 'f64', count: p },
  on: { type: 'i32', count: p },
  energy: { type: 'f64', count: p }, kwh: { type: 'f64', count: p },
  drift: { type: 'f64', count: p }, drift_x: { type: 'f64', count: p },
  heat: { type: 'f64', count: p }, residual: { type: 'f64', count: p }, i2_rms: { type: 'f64', count: p }, i2: { type: 'f64', count: p },
});
export const STATE = Object.keys(stateWrites(1, 1));
/** The tallies a program keeps of the parts it watches and the elements it follows (README: Programs: tallies). */
export const TALLIES = ['first_off', 'last_off', 'off_steps', 'was_on'] as const;
/** An item's writes: the state's head, then its own arrays, then its tallies. */
export function writesOf(f: Pick<Fix, 'circuit' | 'own' | 'watch' | 'peaks'>): Writes {
  const w = stateWrites(f.circuit.nodes.length, f.circuit.parts.length);
  for (const o of f.own ?? []) w[o.name] = { type: 'i32', count: 1 };
  if (f.watch?.length) for (const t of TALLIES) w[t] = { type: 'i32', count: f.watch.length };
  if (f.peaks?.length) w['peak'] = { type: 'f64', count: f.peaks.length };
  return w;
}
const BYTES: Record<WriteType, number> = { i32: 4, f64: 8 };
/** Where each array of `writes` starts in a write region, and the size of them all: each 8-aligned, in order (the region map's layout). */
export function offsets(writes: Writes): { at: Record<string, number>; size: number } {
  const at: Record<string, number> = {};
  let size = 0;
  for (const [name, w] of Object.entries(writes)) { at[name] = size; size += Math.ceil((BYTES[w.type] * (w.count ?? 1)) / 8) * 8; }
  return { at, size };
}

/** The builders, one for nodes and one for each kind of part: circuit@1's eleven and circuit@2's four. */
export const BUILDERS = ['node', 'source_dc', 'source_ac', 'resistor', 'load', 'switch', 'connector', 'fuse', 'meter', 'wire', 'fault', 'breaker', 'rcd', 'changeover', 'transformer'] as const;
type Export = typeof BUILDERS[number] | 'solve';
const SIG: Record<Export, string> = {
  ...Object.fromEntries(BUILDERS.map((b) => [b, '(param i32 i32 i32) (result i32)'])) as Record<typeof BUILDERS[number], string>,
  solve: '(param i32 i32 i64 i64) (result i32)',
};
/** circuit@2's exports with their signatures, as its pack declares them (README: Exports). */
export const EXPORTS = (Object.entries(SIG) as [Export, string][]).map(([name, sig]) => {
  const [, params, results] = /^\(param ([^)]*)\)(?: \(result ([^)]*)\))?$/.exec(sig)!;
  return { name, params: params!.split(' '), results: results ? results.split(' ') : [] };
});

const tag = (s: string): string => s.replace(/[^a-z0-9]/gi, '_');
const S = `(i32.const ${STATE_AT})`, G = `(i32.const ${TABLE_AT})`;
const i32 = (x: number): string => `(i32.const ${x})`;

/**
 * `f`'s program, importing circuit@2's exports from `module`. With `solves` n, logic step 0 solves circuit step 0 and
 * logic step k ≥ 1 solves circuit steps n(k − 1) + 1 … nk; with n = 1 that is `solve(s, reads_at, k, per)`; with 0 it
 * solves nothing (an idle twin). Before each solve of circuit step j it writes each own array (1 while j is in its
 * span, else 0); after it, it tallies each watched part's `on` and each followed element (README: Programs).
 */
export const circuitProgram = (f: Fix, module: string, name = f.item): Program => {
  const t = programText(f, module, name);
  return assemble(t.name, t.text, 'program');
};
/** The program's name and WebAssembly text (circuitProgram assembles it). */
export function programText(f: Fix, module: string, name = f.item): { name: string; text: string } {
  const n = f.solves ?? 1, per = f.per ?? f.rate;
  const c: Circuit = f.circuit;
  const writes = writesOf(f);
  const { at, size } = offsets(writes);
  const head = offsets(stateWrites(c.nodes.length, c.parts.length)).size;
  if (WRITES_AT + size > DATA_AT) throw Error(`program ${name}'s arrays pass its data at ${DATA_AT}`);
  const kinds = c.parts.map((p) => p.kind).filter((k): k is Export => (BUILDERS as readonly string[]).includes(k) && k !== 'node');
  const imports = [...BUILDERS.filter((b) => b === 'node' || kinds.includes(b)), ...(n > 0 ? ['solve' as const] : [])];
  const adds = [
    ...c.nodes.map((_, i) => `(drop (call $node ${S} ${G} ${i32(i)}))`),
    ...c.parts.flatMap((p, i) => ((BUILDERS as readonly string[]).includes(p.kind) && p.kind !== 'node' ? [`(drop (call $${p.kind} ${S} ${G} ${i32(i)}))`] : [])),
  ];
  const watch = (f.watch ?? []).map((id) => index(c, id));
  const w = (t: string, j: number): number => WRITES_AT + at[t]! + 4 * j;
  const init = watch.flatMap((_, j) => [`(i32.store ${i32(w('first_off', j))} (i32.const -1))`, `(i32.store ${i32(w('last_off', j))} (i32.const -1))`, `(i32.store ${i32(w('was_on', j))} (i32.const 1))`]);
  const own = (f.own ?? []).map((o) => {
    const span = o.on === undefined ? '(i32.const 0)'
      : o.on[1] === undefined ? `(i64.ge_s (local.get $j) (i64.const ${o.on[0]}))`
        : `(i32.and (i64.ge_s (local.get $j) (i64.const ${o.on[0]})) (i64.le_s (local.get $j) (i64.const ${o.on[1]})))`;
    return `(i32.store ${i32(WRITES_AT + at[o.name]!)} ${span})`;
  });
  const onAt = (part: number): number => STATE_AT + at['on']! + 4 * part;
  const tallies = [
    ...watch.map((part, j) => `
      (local.set $on (i32.load ${i32(onAt(part))}))
      (if (i32.ne (local.get $on) (i32.const 1)) (then (i32.store ${i32(w('off_steps', j))} (i32.add (i32.load ${i32(w('off_steps', j))}) (i32.const 1)))))
      (if (i32.eqz (local.get $on)) (then
        (if (i32.lt_s (i32.load ${i32(w('first_off', j))}) (i32.const 0)) (then (i32.store ${i32(w('first_off', j))} (i32.wrap_i64 (local.get $j)))))
        (if (i32.ne (i32.load ${i32(w('was_on', j))}) (i32.const 0)) (then (i32.store ${i32(w('last_off', j))} (i32.wrap_i64 (local.get $j)))))))
      (i32.store ${i32(w('was_on', j))} (local.get $on))`),
    ...(f.peaks ?? []).map((pk, j) => {
      const peak = i32(WRITES_AT + at['peak']! + 8 * j);
      return `(f64.store ${peak} (f64.max (f64.load ${peak}) (f64.abs (f64.load ${i32(STATE_AT + at[pk.array]! + 8 * index(c, pk.part))}))))`;
    }),
  ];
  const one = n === 0 ? [] : [...own, `(drop (call $solve ${S} ${i32(READS_AT)} (local.get $j) (i64.const ${per})))`, ...tallies];
  const body = n === 0 ? '' : n === 1 ? `(local.set $j (local.get $k))\n    ${one.join('\n    ')}` : `
    (if (i64.eqz (local.get $k))
      (then (local.set $j (i64.const 0)) ${one.join(' ')})
      (else
        (local.set $j (i64.add (i64.mul (i64.sub (local.get $k) (i64.const 1)) (i64.const ${n})) (i64.const 1)))
        (local.set $end (i64.mul (local.get $k) (i64.const ${n})))
        (loop $each
          ${one.join('\n          ')}
          (local.set $j (i64.add (local.get $j) (i64.const 1)))
          (br_if $each (i64.le_s (local.get $j) (local.get $end))))))`;
  return { name: `${tag(name)}_${tag(module)}_${n}`, text: `
(module
  (import "env" "__linear_memory" (memory ${PAGES} ${PAGES}))
${imports.map((e) => `  (import "${module}" "${e}" (func $${e} ${SIG[e]}))`).join('\n')}
  (global (export "reads_at") i32 (i32.const ${READS_AT}))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (global (export "assets_at") i32 (i32.const ${ASSETS_AT}))
  (func (export "init") (param $seed i64)
    ${[...adds, ...init].join('\n    ')})
  (func (export "step") (param $k i64) (local $j i64) (local $end i64) (local $on i32)
    ${body}
    (memory.copy (i32.const ${WRITES_AT}) ${S} (i32.const ${head})))
  (data (i32.const ${DATA_AT}) "\\00\\00\\00\\00\\00\\00\\00\\00"))` };
}
