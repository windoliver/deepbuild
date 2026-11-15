// This suite's logic programs (README: Programs), in WebAssembly text, assembled by #544's assembler (../544/wat, read
// only). Each exports `memory` (1 page, its maximum equal to its minimum), `init(seed: i64)`, `step(k: i64)` and the
// immutable globals `reads_at` and `writes_at`, and keeps to the logic subset (no imports). The write region is laid
// out as the logic module lays it: each array in declaration order, an i32 or a bool 4 bytes, each array starting on an
// 8-byte boundary. Every program writes every element it owns at every step.

import { assemble, type Program } from './helpers.ts';

type ArrayType = 'bool' | 'i32';
export type Writes = [string, ArrayType, number][];
/** The byte offset of each array of a write region at `at`, in declaration order. */
function offsets(at: number, writes: Writes): Record<string, number> {
  const out: Record<string, number> = {};
  let o = 0;
  for (const [name, , count] of writes) {
    out[name] = at + o;
    o = Math.ceil((o + 4 * count) / 8) * 8;
  }
  return out;
}
const head = (readsAt: number, writesAt: number): string => `
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const ${readsAt}))
  (global (export "writes_at") i32 (i32.const ${writesAt}))
  (func (export "init") (param $seed i64))`;

// ---------------------------------------------------------------------------------------------------
// `tiles`: the 200-row list's rows (fixtures.ts), `tile: i32 × 200` and `alive: bool × 200`, row i's tile i mod 4 (four
// atlas colors, so the list at positions 0, 1 and 3 shows a different row at its top), every row alive.

export const ROWS = 200;
export const TILES_WRITES: Writes = [['tile', 'i32', ROWS], ['alive', 'bool', ROWS]];
export function tilesProgram(): Program {
  const o = offsets(4096, TILES_WRITES);
  return assemble('tiles', `
(module${head(0, 4096)}
  (func (export "step") (param $k i64) (local $i i32)
    (loop $each
      (i32.store (i32.add (i32.const ${o['tile']}) (i32.shl (local.get $i) (i32.const 2))) (i32.and (local.get $i) (i32.const 3)))
      (i32.store (i32.add (i32.const ${o['alive']}) (i32.shl (local.get $i) (i32.const 2))) (i32.const 1))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $i) (i32.const ${ROWS}))))))`);
}

// ---------------------------------------------------------------------------------------------------
// `echo`: reads one text control (README: the read region). Its read region starts at 1024 with the control's slot: a
// u32 length, the bytes, then zero bytes to the next multiple of 8 from the length's start (Control: text). Each step
// it writes
// - `len` (i32 × 1): the slot's u32 length, as that step read it (0 on a step that read no commit);
// - `head` (i32 × 8): the slot's first 32 bytes as eight little-endian u32 words;
// - `sum` (i32 × 1): a running hash kept in memory at 512, sum × 31 + byte over every byte of every commit read so far;
// - `request` (i32 × 1): 1 at step 299, else 0, which asks a piece with `saves` for slot 1 when step 299 ends.
// It also copies each commit's bytes to memory at 40960, so the state a save holds carries the last text read. The
// write region starts at 32768, past the largest slot (4 + 16,384 rounded up to 16,392 bytes from 1024).

export const ECHO_READS_AT = 1024;
const ECHO_WRITES_AT = 32768;
export const ECHO_WRITES: Writes = [['len', 'i32', 1], ['head', 'i32', 8], ['sum', 'i32', 1], ['request', 'i32', 1]];
/** The step at whose end `echo` asks for slot 1, so the save holds the state before step 300. */
export const SAVE_STEP = 299;
export function echoProgram(): Program {
  const o = offsets(ECHO_WRITES_AT, ECHO_WRITES);
  const bytes = ECHO_READS_AT + 4;
  return assemble('echo', `
(module${head(ECHO_READS_AT, ECHO_WRITES_AT)}
  (func (export "step") (param $k i64) (local $j i32) (local $n i32)
    (loop $copy
      (i32.store (i32.add (i32.const ${o['head']}) (i32.shl (local.get $j) (i32.const 2)))
        (i32.load (i32.add (i32.const ${ECHO_READS_AT}) (i32.shl (local.get $j) (i32.const 2)))))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br_if $copy (i32.lt_u (local.get $j) (i32.const 8))))
    (local.set $n (i32.load (i32.const ${ECHO_READS_AT})))
    (if (i32.gt_u (local.get $n) (i32.const 16384)) (then (local.set $n (i32.const 16384))))
    (i32.store (i32.const ${o['len']}) (local.get $n))
    (local.set $j (i32.const 0))
    (block $done
      (loop $each
        (br_if $done (i32.ge_u (local.get $j) (local.get $n)))
        (i32.store (i32.const 512)
          (i32.add (i32.mul (i32.load (i32.const 512)) (i32.const 31)) (i32.load8_u (i32.add (i32.const ${bytes}) (local.get $j)))))
        (i32.store8 (i32.add (i32.const 40960) (local.get $j)) (i32.load8_u (i32.add (i32.const ${bytes}) (local.get $j))))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $each)))
    (i32.store (i32.const ${o['sum']}) (i32.load (i32.const 512)))
    (i32.store (i32.const ${o['request']}) (i64.eq (local.get $k) (i64.const ${SAVE_STEP})))))`);
}

/** Eight i32 words (as the `logic` reply gives an i32 array) as the 32 little-endian bytes they hold. */
export function wordsToBytes(words: number[]): Buffer {
  const b = Buffer.alloc(4 * words.length);
  words.forEach((w, i) => b.writeUInt32LE(w >>> 0, 4 * i));
  return b;
}
