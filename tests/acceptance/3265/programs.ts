// This suite's fixture generators (README: Fixtures): one logic item, `gen`, that publishes an 8 × 8 grid (`gen.cells`)
// and its depth (`gen.depth`), in five twins that differ only in what they read of the seed their `init` gets. Each is
// WebAssembly text assembled by #533's assembler (#555's helper builds it from a copy); its write offsets come from
// `deep-logic check` of a probe with its writes, so it writes where the logic module lays its entries out. Row 0 is open
// from the start (0, 0) to the exit (7, 0), so every floor's exit is reached whatever the rest holds; cell i of the
// other rows (8 ≤ i < 64) is blocked where bit i − 8 of the floor's pattern is 1.
import { expect } from 'vitest';
import { checkCall, onLogic, type Program } from '../533/helpers.ts';
import { assemble, type Obj } from '../556/helpers.ts';

export const GEN = { id: 'gen', size: 8, open: 0, blocked: 1, exitClass: 5, start: [0, 0], exit: [7, 0] } as const;
export const CELLS = `${GEN.id}.cells`;
export const DEPTH = `${GEN.id}.depth`;
/** Steps every run plays: step 0 holds depth 1, step 1 may hold depth 2, step 2 depth 3. */
export const SPAN = 3;

/**
 * What each twin reads of its seed (`$seed`, 64 bits):
 * - `clean`: its pattern is the whole seed, so each run's floor is its own.
 * - `blind`: no seed; every run has one pattern.
 * - `lowbit`: one of two patterns, by the seed's low bit.
 * - `stairs`: as clean; at step 1 a run whose seed's bits 8 to 11 are all 0 goes to depth 2, to a floor of its own.
 * - `mixed`: depth 1 is one of two patterns by bit 0; at step 1 every run goes to depth 2, one of four by bits 1 and 2
 *   (two of them depth 1's own); at step 2 a run whose bit 4 is 0 goes to depth 3, a floor of its own.
 */
export type Twin = 'clean' | 'blind' | 'lowbit' | 'stairs' | 'mixed';

const WRITES: Obj = { cells: { type: 'i32', count: GEN.size * GEN.size }, depth: { type: 'i32' } };
const WRITES_AT = 1024;
/** The program's own state, past the write region: its seed. */
const SEED_AT = 4096;
const HEAD = `(memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))`;

interface Entry { region: string; name: string; offset: number; size: number }
let layout: Entry[] | undefined;
/** Where the logic module lays the write `name` out, from `deep-logic check` of a probe with these writes. */
function writeAt(name: string): number {
  if (!layout) {
    const probe = assemble('probe3265', `(module ${HEAD} (func (export "init") (param $seed i64)) (func (export "step") (param $k i64)))`);
    const [reply] = onLogic([checkCall(piece(probe) as never)]) as Obj[];
    expect(reply?.['ok'], `deep-logic check takes the layout probe: ${JSON.stringify(reply).slice(0, 1500)}`).toBe(true);
    layout = (reply!['items'][GEN.id]['layout']['entries'] as Entry[]).filter((e) => e.region === 'writes');
    for (const e of layout) expect(WRITES_AT + e.offset + e.size, `${e.name} ends before the program's own state`).toBeLessThanOrEqual(SEED_AT);
  }
  const e = layout.find((x) => x.name === name);
  if (!e) throw Error(`the layout has no write ${name}: ${JSON.stringify(layout)}`);
  return WRITES_AT + e.offset;
}

const seedBits = (from: number, mask: number): string => `(i64.and (i64.shr_u (local.get $seed) (i64.const ${from})) (i64.const ${mask}))`;
const pattern = (n: string): string => `(call $pattern ${n})`;
const FIRST: Record<Twin, string> = {
  clean: '(local.get $seed)', blind: pattern('(i64.const 0)'), lowbit: pattern(seedBits(0, 1)), stairs: '(local.get $seed)', mixed: pattern(seedBits(0, 1)),
};
/** What a twin's step does past step 0: each floor it goes down to. */
const LATER: Record<Twin, string> = {
  clean: '', blind: '', lowbit: '',
  stairs: `(if (i32.and (i64.eq (local.get $k) (i64.const 1)) (i64.eqz ${seedBits(8, 15)}))
      (then (call $floor (i32.const 2) (i64.rotl (local.get $seed) (i64.const 17)))))`,
  mixed: `(if (i64.eq (local.get $k) (i64.const 1)) (then (call $floor (i32.const 2) ${pattern(seedBits(1, 3))})))
    (if (i32.and (i64.eq (local.get $k) (i64.const 2)) (i64.eqz ${seedBits(4, 1)}))
      (then (call $floor (i32.const 3) (local.get $seed))))`,
};

/** The twin's program, assembled. */
export function generator(v: Twin): Program {
  const cells = writeAt('cells');
  const last = GEN.size * GEN.size;
  return assemble(`gen3265_${v}`, `
(module
  ${HEAD}
  ;; The n-th fixed pattern: multiples of one odd number, so no two share their low 56 bits.
  (func $pattern (param $n i64) (result i64)
    (i64.mul (i64.const 0x1e3779b97f4a7c15) (i64.add (local.get $n) (i64.const 1))))
  ;; A floor at $depth: the pattern's bits over rows 1 to 7, the exit at the end of the open row 0.
  (func $floor (param $depth i32) (param $p i64) (local $i i32)
    (local.set $i (i32.const ${GEN.size}))
    (loop $each
      (i32.store (i32.add (i32.const ${cells}) (i32.shl (local.get $i) (i32.const 2)))
        (i32.wrap_i64 (i64.and (i64.shr_u (local.get $p) (i64.extend_i32_u (i32.sub (local.get $i) (i32.const ${GEN.size})))) (i64.const 1))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $i) (i32.const ${last}))))
    (i32.store (i32.const ${cells + 4 * GEN.exit[0]}) (i32.const ${GEN.exitClass}))
    (i32.store (i32.const ${writeAt('depth')}) (local.get $depth)))
  (func (export "init") (param $seed i64)
    (i64.store (i32.const ${SEED_AT}) (local.get $seed))
    (call $floor (i32.const 1) ${FIRST[v]}))
  (func (export "step") (param $k i64) (local $seed i64)
    (local.set $seed (i64.load (i32.const ${SEED_AT})))
    ${LATER[v]}))`);
}
/** A generator as the replica takes it; its document's own seed is 3265, which `piece_seed: own` plays every run on. */
export function piece(program: Program): Obj {
  return {
    seed: 3265, class: 'figure', controls: {},
    items: { [GEN.id]: { kind: 'logic@1', params: { program: program.sha, step_rate: 60, reads: [], writes: WRITES } } },
    assets: { [program.sha]: program.b64 },
  };
}
/** The generators' `game.play@1`: the grid, with the depth it publishes as its floor. */
export function genPlay(): Obj {
  return {
    grid: {
      cells: CELLS, size: [GEN.size, GEN.size], shape: 'square', moves: 4, floor: DEPTH,
      classes: { open: [GEN.open], blocked: [GEN.blocked], exit: [GEN.exitClass] },
    },
  };
}
/** A policy that puts nothing: what a run generates comes from its seed alone. */
const IDLE: Obj = { policy: {} };
export const RUNS = 20;
/**
 * The check's seeds. PLAIN: over its 20 runs the lowbit generator's two floors come in no order, exactly one run of the
 * stairs generator goes to depth 2, and 11 runs of the mixed generator go to depth 3. ALTERNATING: the lowbit
 * generator's two floors alternate, run by run. (A run's seed is hash(the check's seed, i), so the order is the seed's;
 * each test reads it back from this suite's own plays.)
 */
export const SEED = { plain: 3265, alternating: 348812 } as const;
/** The playtest grid.reach names: 20 runs of one idle bot, each from its own seed (`pieceSeed` null leaves it out). */
export function playtest(at: string, play: Obj, seed: number, pieceSeed: 'run' | 'own' | null = 'run'): Obj {
  return { piece: at, play, bots: [IDLE], runs: RUNS, seed, span: { steps: SPAN }, goals: [], frames: { every: 0 }, ...(pieceSeed ? { piece_seed: pieceSeed } : {}) };
}
/** grid.reach's own input: the exit reached from the start; `differ` when given, and the depths that must be generated when given. */
export function reach(differ?: number, depths?: number[]): Obj {
  return { playtest: 'R-floors', starts: [[...GEN.start]], goals: ['exit'], every: [], ...(depths ? { depths } : {}), ...(differ === undefined ? {} : { differ }) };
}
