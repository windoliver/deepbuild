// The fixture game's logic program for criterion 11, as WebAssembly bytes written here by hand (no assembler, no
// cargo), and the piece that holds it in #531's piece form (deep-logic's `bake`, and the `piece` this suite adds to
// deep-show's `open`). No vitest import, so the bytes can be checked with Node's own WebAssembly on their own.
//
// The program, as text:
//
//   (module
//     (memory (export "memory") 1 1)
//     (global (export "reads_at") i32 (i32.const 0))
//     (global (export "writes_at") i32 (i32.const 4096))
//     (func $init (export "init") (param $seed i64))
//     (func $step (export "step") (param $k i64)
//       ;; runs: how many times step has been called (the write region's one i32, array `game.runs`)
//       (i32.store (i32.const 4096) (i32.add (i32.load (i32.const 4096)) (i32.const 1)))
//       ;; mix = mix × 31 + k, in memory outside the write region: a step run twice, skipped or out of order changes it,
//       ;; and the full-state hash covers memory
//       (i32.store (i32.const 8192) (i32.add (i32.mul (i32.load (i32.const 8192)) (i32.const 31)) (i32.wrap_i64 (local.get $k))))))

import { createHash } from 'node:crypto';

/** Where the write region starts; its one entry is `runs`, an i32 at offset 0. */
export const RUNS_AT = 4096;
/** Where the order-sensitive mix lives, outside the write region. */
export const MIX_AT = 8192;

function uleb(n: number): number[] {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n !== 0) b |= 0x80;
    out.push(b);
  } while (n !== 0);
  return out;
}
function sleb(n: number): number[] {
  const out: number[] = [];
  for (;;) {
    const b = n & 0x7f;
    n >>= 7;
    if ((n === 0 && (b & 0x40) === 0) || (n === -1 && (b & 0x40) !== 0)) {
      out.push(b);
      return out;
    }
    out.push(b | 0x80);
  }
}
const vec = (items: number[][]): number[] => [...uleb(items.length), ...items.flat()];
const name = (s: string): number[] => [...uleb(s.length), ...Buffer.from(s, 'utf8')];
const section = (id: number, body: number[]): number[] => [id, ...uleb(body.length), ...body];
const body = (code: number[]): number[] => [...uleb(code.length + 2), 0x00, ...code, 0x0b]; // no locals; end

const I32_CONST = 0x41;
const I32_LOAD = [0x28, 0x02, 0x00]; // align 4, offset 0
const I32_STORE = [0x36, 0x02, 0x00];
const I32_ADD = 0x6a;
const I32_MUL = 0x6c;
const LOCAL_GET = 0x20;
const I32_WRAP_I64 = 0xa7;
const I32 = 0x7f;
const I64 = 0x7e;

/** The game's program: exports memory, init(seed), step(k), reads_at and writes_at (Logic `logic@1`: Exports). */
export function gameProgram(): Uint8Array {
  const step = [
    I32_CONST, ...sleb(RUNS_AT),
    I32_CONST, ...sleb(RUNS_AT), ...I32_LOAD,
    I32_CONST, ...sleb(1), I32_ADD,
    ...I32_STORE,
    I32_CONST, ...sleb(MIX_AT),
    I32_CONST, ...sleb(MIX_AT), ...I32_LOAD,
    I32_CONST, ...sleb(31), I32_MUL,
    LOCAL_GET, 0x00, I32_WRAP_I64, I32_ADD,
    ...I32_STORE,
  ];
  const bytes = [
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([[0x60, 1, I64, 0]])), // one type: (i64) -> ()
    ...section(3, vec([[0], [0]])), // init, step
    ...section(5, vec([[0x01, 1, 1]])), // one memory of one page, its maximum its minimum
    ...section(6, vec([[I32, 0x00, I32_CONST, ...sleb(0), 0x0b], [I32, 0x00, I32_CONST, ...sleb(RUNS_AT), 0x0b]])),
    ...section(7, vec([
      [...name('memory'), 0x02, 0],
      [...name('reads_at'), 0x03, 0],
      [...name('writes_at'), 0x03, 1],
      [...name('init'), 0x00, 0],
      [...name('step'), 0x00, 1],
    ])),
    ...section(10, vec([body([]), body(step)])),
  ];
  return new Uint8Array(bytes);
}

export type Piece = {
  seed: number;
  items: { [id: string]: { kind: 'logic@1'; params: { program: string; step_rate: number; writes: { runs: { type: 'i32' } } } } };
  assets: { [sha: string]: string };
};

/** The logic item's ID in the fixture game. */
export const GAME = 'game';
/** The game's step rate, Hz. */
export const STEP_RATE = 60;

/** The 60 Hz fixture game as a piece: one logic item `game` stepping at 60 Hz, writing `runs`; its program inline by
 * its bytes' SHA-256, base64 (#531's Piece). */
export function gamePiece(): Piece {
  const program = gameProgram();
  const sha = createHash('sha256').update(program).digest('hex');
  return {
    seed: 499,
    items: { [GAME]: { kind: 'logic@1', params: { program: sha, step_rate: STEP_RATE, writes: { runs: { type: 'i32' } } } } },
    assets: { [sha]: Buffer.from(program).toString('base64') },
  };
}
