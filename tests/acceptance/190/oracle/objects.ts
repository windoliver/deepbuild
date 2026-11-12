// The programs and libraries this lane translates upstream's objects into, in WebAssembly text assembled by the
// parent suite's assembler (../helpers.ts: assemble; ../README.md: Relocatable objects), and the merged program
// read back. A program object writes one i32, `v` (the parent suite's V_WRITES), at its layout's entry, as the
// parent suite's value programs do (../programs.ts), with the same head; its expected values are worked here.

import { expect } from 'vitest';
import { assemble, entryAt, type Layout, type Program } from '../helpers.ts';

/** The address `v` is written at in an item of V_WRITES with layout `l` (the writes region starts at 4096). */
export const vAt = (l: Layout): number => 4096 + entryAt(l, 'writes', 'v');
/** WebAssembly text's string of these bytes. */
export const dataText = (b: Buffer): string =>
  Array.from(b, (x) => (x >= 0x20 && x < 0x7f && x !== 0x22 && x !== 0x5c ? String.fromCharCode(x) : `\\${x.toString(16).padStart(2, '0')}`)).join('');

/**
 * A program object: its memory imported as env.__linear_memory (`pages`, maximum = minimum), `imports` (its lib:
 * functions), logic@1's reads_at 0 and writes_at 4096, an empty init, `funcs` (other functions), a step whose body
 * is `step` with `$V` the address of `v`, and `data` at 0.
 */
export function programObject(name: string, l: Layout, o: { imports: string; funcs?: string; step: string; data: Buffer; pages?: number }): Program {
  const pages = o.pages ?? 1;
  return assemble(`${name}_${vAt(l)}`, `
(module
  (import "env" "__linear_memory" (memory ${pages} ${pages}))
  ${o.imports}
  (global $reads_at (export "reads_at") i32 (i32.const 0))
  (global $writes_at (export "writes_at") i32 (i32.const 4096))
  (func $init (export "init") (param $seed i64))${o.funcs ?? ''}
  (func $step (export "step") (param $k i64)
    ${o.step.replaceAll('$V', String(vAt(l)))})
  (data (i32.const 0) "${dataText(o.data)}"))`, 'program');
}

/** A merged program instantiated by node's own WebAssembly with no imports (a module that imports nothing needs none). */
export function instantiate(bytes: Buffer, what: string): WebAssembly.Instance {
  let instance: WebAssembly.Instance | undefined;
  let error = '';
  try { instance = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(bytes)), {}); } catch (e) { error = String(e); }
  expect(error, `${what} instantiates in node with no imports`).toBe('');
  return instance!;
}
/** Runs init(0) and step(0) of a merged program and reads `v` from its memory. */
export function stepV(bytes: Buffer, l: Layout, what: string): number {
  const x = instantiate(bytes, what).exports as { init: (s: bigint) => void; step: (k: bigint) => void; memory: WebAssembly.Memory };
  x.init(0n);
  x.step(0n);
  return new DataView(x.memory.buffer).getInt32(vAt(l), true);
}
