// The data-layout oracle (the oracle map's lld/test/wasm/data-layout.s row, criterion 1): the data of several objects
// in one memory, each segment at its alignment after the one before; and, checks of our own, that link order is
// dependency order with ties broken by name, and that an address in one object's code resolves to where its data
// landed.
//
// Upstream links data-layout.s's object and hello.s's and checks obj2yaml of the output: one memory of the size the
// stack and data need (Minimum 0x2; with --initial-memory = --max-memory, Maximum = Minimum), every segment at its
// alignment after the one before (its five globals' values, both segments' offsets, 65536 and 65552, and the first
// segment's content are checked, which puts the objects' data in the order the linker was given them, whatever that
// order is; foo at 65552 and .p2align 4's aligned_bar at 65568, a multiple of 16, follow from them). Its live CHECKs
// never read the second segment's content, so `external_ref`'s value (an address of hello.s's data) isn't checked
// upstream; its relocation appears only in the disabled XUN/RELOC block, as a record. wasm-ld's own layout rules (a 64
// KiB stack first, segments merged by section name, __data_end and __heap_base) aren't ours; ours is ../README.md's
// "The linker's layout": the program's data keeps its object's offsets from address 0, and each library's segments
// follow, in link order (dependency order, ties broken by name), each at its alignment (8, the objects' segment info)
// after the one before; one memory, the program's, defined with its limits (maximum = minimum) and exported as
// `memory`. Which object comes first is our rule, not upstream's: the check that alpha@1 precedes beta@1 is our own.
//
// Here a program object with 8,195 bytes of data (8,192 zeros, then "PRG") links alpha@1 (data "ALPHA") and beta@1
// (data "BETA!!!"), listed beta first; neither needs the other, so link order is by name: alpha, then beta. The merged
// program our receipt carries is instantiated in node with no imports, and its memory before init is the layout: the
// program's bytes at 0, "ALPHA" at 8,200 (8,195 rounded up to 8), "BETA!!!" at 8,208 (8,205 rounded up to 8), every
// other byte zero; its one memory is defined, 1 page minimum and maximum, exported as `memory`. Each library's code
// reads its own data through a relocated address (the parent suite's ADDR, an R_WASM_MEMORY_ADDR_SLEB relocation),
// so v = first() × 1000 + last() is 65 × 1000 + 33 only when those addresses were resolved to where the data landed:
// a check of our own, standing in for upstream's external_ref (our objects' relocations are in code, not data).
//
// Not held: wasm64, --no-growable-memory and shared memory (our programs are wasm32 with a fixed memory), the
// linker-made globals (__data_end, __heap_base, __rodata_start/end: our merged program has no globals of the linker's)
// and relocations inside data (our objects' are in code only, ../README.md: Relocatable objects).
//
// Wrong program shown failing: `linker_links_in_listing_order` (../README.md: Planted twins) lays out beta before
// alpha, as the item lists them, and fails the layout naming alpha's address. It fails only our own order check: it
// lays its data out consistently in its own order (beta@1 at 8,200, alpha@1 at 8,208, each aligned, one memory, v =
// 65,033), as wasm-ld does given beta first, so every check held from upstream passes on it. No planted value shows
// an upstream-held check of this file failing.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, admitted, assemble, checkCall, logicBin, none, onHost, piece, prebuild, type JsonObject, type Lib, type Planted, type Program } from '../helpers.ts';
import { pack, vLayout } from '../libs.ts';
import { ADDR, V_WRITES } from '../programs.ts';
import { dataText, instantiate, programObject, stepV } from './objects.ts';
import { parse } from './wasm.ts';

prebuild(() => { logicBin(); });

const PAGE = 65_536;
/** The objects' segment alignment (their segment info's 2^3). */
const ALIGN = 8;
const alignUp = (n: number): number => Math.ceil(n / ALIGN) * ALIGN;
const PROGRAM_DATA = Buffer.concat([Buffer.alloc(8192), Buffer.from('PRG')]);
const ALPHA = Buffer.from('ALPHA');
const BETA = Buffer.from('BETA!!!');

/** A library `name` whose data is `data` and whose one export `fn` returns its byte at `at`, read through a relocated address. */
function dataLib(name: 'alpha' | 'beta', fn: string, data: Buffer, at: number): Lib {
  const program = assemble(`${name}_data`, `
(module
  (import "env" "__linear_memory" (memory 0))
  (func $${fn} (export "${fn}") (result i32) (i32.load8_u (i32.const ${ADDR(at)})))
  (data (i32.const 0) "${dataText(data)}"))`, 'library');
  const fixture = programObject(`${name}_user`, vLayout(), {
    imports: `(import "lib:${name}" "${fn}" (func $f (result i32)))`,
    step: '(i32.store (i32.const $V) (call $f))',
    data: Buffer.alloc(8192),
  });
  return { name: `${name}@1`, program, exports: [fn], fixtures: [{ program: fixture, writes: V_WRITES, steps: 1, expect: { '0': { v: [data[at]!] } } }] };
}
const alpha = (): Lib => dataLib('alpha', 'first', ALPHA, 0);
const beta = (): Lib => dataLib('beta', 'last', BETA, BETA.length - 1);
/** v = alpha.first() × 1000 + beta.last(). */
const EXPECTED_V = ALPHA[0]! * 1000 + BETA[BETA.length - 1]!;
const layoutProgram = (): Program => programObject('data_layout', vLayout(), {
  imports: '(import "lib:alpha" "first" (func $first (result i32)))\n  (import "lib:beta" "last" (func $last (result i32)))',
  step: '(i32.store (i32.const $V) (i32.add (i32.mul (call $first) (i32.const 1000)) (call $last)))',
  data: PROGRAM_DATA,
});
const layoutPiece = (a: Lib, b: Lib): JsonObject =>
  piece({ seed: 190_202, packs: [pack('datakit', [a, b])], items: { layout: { program: layoutProgram(), writes: V_WRITES, links: [b, a] } } });

/** Where each object's data must be (README above): the program at 0, then alpha, then beta, each aligned. */
const ALPHA_AT = alignUp(PROGRAM_DATA.length);
const BETA_AT = alignUp(ALPHA_AT + ALPHA.length);

/** What upstream's CHECK lines hold, in our layout, of a merged program, plus our own export and zero-fill checks:
 * each failure, or none. */
function judge(bytes: Buffer): string[] {
  const failures: string[] = [];
  const m = parse(bytes);
  const memImports = m.imports.filter((i) => i.kind === 'memory');
  if (memImports.length || m.memories.length !== 1) failures.push(`one memory, defined: ${m.memories.length} defined, ${memImports.length} imported`);
  const limits = m.memories[0];
  if (limits && (limits.min !== 1 || limits.max !== 1)) failures.push(`the program's memory limits, 1 page minimum and maximum: ${JSON.stringify(limits)}`);
  if (!m.exports.some((e) => e.kind === 'memory' && e.name === 'memory')) failures.push('the memory is exported as `memory`');
  if (failures.length) return failures;
  const memory = (instantiate(bytes, 'the merged program').exports as { memory: WebAssembly.Memory }).memory;
  const image = Buffer.from(memory.buffer);
  if (image.length !== PAGE) failures.push(`the memory is ${image.length} bytes, not 1 page`);
  const placed: [string, number, Buffer][] = [['the program\'s data', 0, PROGRAM_DATA], ['alpha@1\'s data', ALPHA_AT, ALPHA], ['beta@1\'s data', BETA_AT, BETA]];
  for (const [what, at, data] of placed) {
    const got = image.subarray(at, at + data.length);
    if (!got.equals(data)) failures.push(`${what} at ${at}: expected ${data.toString('hex')}, got ${got.toString('hex')}`);
  }
  const ours = (i: number): boolean => placed.some(([, at, data]) => i >= at && i < at + data.length);
  const stray = image.findIndex((x, i) => x !== 0 && !ours(i));
  if (stray >= 0) failures.push(`byte ${stray} is ${image[stray]}, outside every object's data (expected 0)`);
  return failures;
}

const mergedOf = (planted: Planted[] = []): { bytes: Buffer; order: string[] } => {
  const a = alpha(); const b = beta();
  const [reply] = onHost([checkCall(layoutPiece(a, b))], planted);
  const receipt = admitted(reply!, `check of layout${planted.length ? ` under ${planted.join(', ')}` : ''}`)['layout']!;
  expect(receipt.linked, 'the receipt carries the merged program').not.toBeNull();
  return { bytes: receipt.linked!.bytes, order: receipt.libraries.map((l) => l.name) };
};

describe(`${AC[1]} data-layout.s: the data of the program and its libraries in one memory, in link order, aligned`, () => {
  it(`${AC[1]} the program's data at 0, alpha@1's at ${ALPHA_AT} and beta@1's at ${BETA_AT} in one defined memory, and each library's address resolved to its data`, () => {
    const { bytes, order } = mergedOf();
    expect(order, 'the receipt names the libraries in link order: alpha@1, then beta@1 (by name, neither needing the other)').toEqual(['alpha@1', 'beta@1']);
    none(judge(bytes), 'data-layout.s\'s checks of our merged program');
    expect(stepV(bytes, vLayout(), 'the merged program'), `run in node, each library reads its own data where it landed: v = ${EXPECTED_V}`).toBe(EXPECTED_V);
  }, TIMEOUT);

  it(`${AC[1]} the layout check fails on a linker that lays libraries out in listing order (linker_links_in_listing_order)`, () => {
    const failures = judge(mergedOf(['linker_links_in_listing_order']).bytes);
    expect(failures.some((f) => f.startsWith(`alpha@1's data at ${ALPHA_AT}`)), `the planted linker's merged program fails, naming alpha@1's address: ${failures.join(' | ')}`).toBe(true);
  }, TIMEOUT);
});
