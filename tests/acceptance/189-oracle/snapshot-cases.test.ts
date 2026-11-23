// Re-expressed from wasmtime's own tests at commit 3c8a3e79aa3188a1a12b3aebbaa097abccceac92 (the Oracle page's pin for
// #189's criterion 5): the upstream snapshot tool's test file, `tests/all/tests.rs` in its crate under `crates/`, lines
// 136-153 (basic_memory), 486-509 (data_segment_at_end_of_memory) and 921-948 (mixture_of_globals), read from its
// vendor copy under `doneright/oracles/vendor/wasmtime-3c8a3e79aa/`; licensed under the Apache License, Version 2.0,
// with the LLVM exception. No code is copied: each case's state and expected value are written here as a logic program
// of our own whose state a save keeps and a fresh process reopens, and every assertion is on what `deep-logic` answers
// (#136), never on an engine called directly. Upstream's numbers are kept (42 at byte 1337; 42 at a page's last
// offset; globals 1, 2, 3, 4 with the first and third set to 42 and 43, read back as their sum, 91).
//
// Upstream's rule: run a module's initializer, snapshot the instance keeping only the nonzero regions of each 64 KiB
// page and its mutable globals, instantiate the snapshot from zeroed memory, and read the values back. Ours, criterion
// 5's: a step that ends at step 0 (the initializer) asks for a save of slot 1, which holds the pages that hold a nonzero
// byte, its globals and the full-state hash it recorded; another process opens it into a fresh instance (zeroed memory
// and its pages, nothing else) at that hash, and the next steps read the values back. The planted save
// (`save_drops_a_page`, README: Planted twins) leaves out the page whose one nonzero byte is at its last offset: the
// open must refuse it by its recorded hash, naming the save and the module, and open the slot's other save.
import { statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AC, PAGE, TIMEOUT, assemble, bakeCall, bakeOf, logicBin, one, openSaveCall, openedOf, piece, prebuild, readSave, regions, saveAt, saveFile, savesDir, show,
  valuesAt, type JsonObject, type Planted, type SaveWritten, type Writes,
} from './helpers.ts';

prebuild(() => { logicBin(); });

const ID = 'snap';
const READS_AT = 16_384;
const WRITES_AT = 24_576;
interface Case { name: string; pages: number; count: number; expected: number[]; globals: string; first: string; read: string }
/** One case as a logic program: its globals, what step 0 (the initializer) writes, and what each step reads back into `v`. */
const CASES: Case[] = [
  {
    name: 'basic_memory', pages: 1, count: 1, expected: [42], globals: '',
    first: '(i32.store offset=1337 (i32.const 0) (i32.const 42))',
    read: '(i32.store (local.get $v) (i32.load offset=1337 (i32.const 0)))',
  },
  {
    name: 'data_segment_at_end_of_memory', pages: 2, count: 1, expected: [42], globals: '',
    first: '(i32.store8 offset=65535 (i32.const 65536) (i32.const 42))',
    read: '(i32.store (local.get $v) (i32.load8_u offset=65535 (i32.const 65536)))',
  },
  {
    name: 'mixture_of_globals', pages: 1, count: 5, expected: [42 + 2 + 43 + 4, 42, 2, 43, 4],
    globals: '(global $g1 (mut i32) (i32.const 1)) (global $g2 i32 (i32.const 2)) (global $g3 (mut i32) (i32.const 3)) (global $g4 i32 (i32.const 4))',
    first: '(global.set $g1 (i32.const 42)) (global.set $g3 (i32.const 43))',
    read: `(i32.store (local.get $v) (i32.add (i32.add (global.get $g1) (global.get $g2)) (i32.add (global.get $g3) (global.get $g4))))
      (i32.store offset=4 (local.get $v) (global.get $g1)) (i32.store offset=8 (local.get $v) (global.get $g2))
      (i32.store offset=12 (local.get $v) (global.get $g3)) (i32.store offset=16 (local.get $v) (global.get $g4))`,
  },
];
const writes = (c: Case): Writes => ({ v: { type: 'i32', count: c.count }, request: { type: 'i32' } });
/** The case's piece: one logic item reading the `save` control, which asks for slot 1 at the end of a step that read an entry of it. */
function casePiece(c: Case): JsonObject {
  const r = regions(['save'], writes(c));
  const w = (n: string): number => WRITES_AT + r.writes[n]!;
  const program = assemble(`oracle_${c.name}_${r.reads['save']}_${w('v')}_${w('request')}`, `
(module
  (memory (export "memory") ${c.pages} ${c.pages})
  (global (export "reads_at") i32 (i32.const ${READS_AT}))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  ${c.globals}
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64) (local $v i32)
    (if (i64.eqz (local.get $k)) (then ${c.first}))
    (local.set $v (i32.const ${w('v')}))
    ${c.read}
    (i32.store (i32.const ${w('request')}) (i32.ne (i32.load (i32.const ${READS_AT + r.reads['save']!})) (i32.const 0)))))`);
  return piece({ seed: 189_50, controls: ['save'], items: { [ID]: { program, reads: ['save'], writes: writes(c), saves: { slots: 1, request: 'request' } } } });
}
/** One process that plays the case to `steps` with a save asked at the end of step `at`, and exits. */
function saved(c: Case, dir: string, at: number, planted: Planted[] = []): SaveWritten {
  const b = bakeOf(one(bakeCall(casePiece(c), { track: [saveAt(at)], steps: at + 1, saves_dir: dir }), planted), `${c.name}: the bake that saves at ${at + 1}`);
  expect(b.saves.map((s) => s.step), `${c.name}: slot 1 is saved at step ${at + 1}`).toEqual([at + 1]);
  expect(valuesAt(b.steps.at(-1), ID, 'v'), `${c.name}: what step ${at} read, before the save`).toEqual(c.expected);
  return b.saves[0]!;
}

describe(`${AC[5]} the upstream snapshot tool's cases, as saves our logic module keeps and reopens`, () => {
  it.each(CASES)(`${AC[5]} upstream's $name: the save holds the pages that hold a nonzero byte and its globals, and reopened in a fresh process at the full-state hash it recorded, reads the values back`, (c) => {
    const dir = savesDir();
    const s = saved(c, dir, 0);
    const file = saveFile(dir, s.hash);
    const size = statSync(file).size;
    expect(size >= c.pages * PAGE && size < (c.pages + 1) * PAGE, `${c.name}: the save holds its ${c.pages} page${c.pages > 1 ? 's' : ''} with a nonzero byte, and no other (${size} bytes)`).toBe(true);
    expect(readSave(file).header['deep_hash'], `${c.name}: the save records the full-state hash it was written at`).toEqual(s.deep_hash);
    const o = openedOf(one(openSaveCall(casePiece(c), { saves_dir: dir, track: [saveAt(0)], steps: 3 })), `${c.name}: open_save in a fresh process`);
    expect([o.hash, o.step, o.via], `${c.name}: the save opens straight at step 1`).toEqual([s.hash, 1, 'straight']);
    expect(o.deep_hash, `${c.name}: at the full-state hash it recorded`).toEqual(s.deep_hash);
    expect(o.steps.map((x) => valuesAt(x, ID, 'v')), `${c.name}: steps 1 and 2 read upstream's values back`).toEqual([c.expected, c.expected]);
  }, TIMEOUT);

  it(`${AC[5]} upstream's data_segment_at_end_of_memory under a planted save that leaves out the page whose one nonzero byte is at its last offset (save_drops_a_page): refused, naming the save and the module, and the slot's other save opens instead`, () => {
    const c = CASES[1]!;
    const dir = savesDir();
    const good = saved(c, dir, 0);
    const bad = saved(c, dir, 1, ['save_drops_a_page']);
    const o = openedOf(one(openSaveCall(casePiece(c), { saves_dir: dir, track: [saveAt(0)], steps: 2 })), 'open_save of the slot whose newest save lacks its last page');
    expect(o.refused.map((r) => r.hash), 'the save without its last page is refused, by its hash').toEqual([bad.hash]);
    const d = o.refused[0]!.differs.find((x) => x.module !== null);
    expect(d?.module, `naming the module: ${show(o.refused[0]!.differs.map((x) => x.raw))}`).toMatch(/^logic(@1)?$/);
    expect([o.hash, o.step], 'the slot\'s other save opens instead').toEqual([good.hash, 1]);
    expect(valuesAt(o.steps[0], ID, 'v'), 'and reads 42 back from its page\'s last offset').toEqual(c.expected);
  }, TIMEOUT);
});
