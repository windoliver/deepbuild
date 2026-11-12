// The function-imports oracle (the oracle map's lld/test/wasm/function-imports.s row, criterion 1): a call into
// another object becomes a call to an internal function, and no import is left.
//
// Upstream links ret32.o (ret32: (f32) -> (i32)) and an object whose _start: () -> () does `f32.const 0`, `call
// ret32`, `drop`, then checks obj2yaml of the output: the type section holds (f32) -> (i32) and () -> (), the two
// functions are defined (FUNCTION, CODE), and the name section names ret32 and _start. Here the same pair goes
// through our linker: ret32@1, a library exporting ret32 (f32) -> (i32) (returning 32), and a program object whose
// internal $start: () -> () has exactly _start's body, called from its step, which also writes v = ret32(0). The
// merged program our receipt carries (`linked.bytes`, the module before the rewrite, ../README.md: Checked) is read
// by this lane's reader (wasm.ts) as upstream reads its output with obj2yaml. Held from upstream's CHECK lines:
//
// - no import is left (upstream's CHECK-NEXT puts FUNCTION directly after TYPE, so there is no IMPORT section);
// - its types hold (f32) -> (i32) and () -> ();
// - exactly one defined function has type (f32) -> (i32) (upstream's FunctionTypes [0, 1]: ret32 defined, of type 0).
//
// Our own, not upstream's (its CHECKs read no custom section's name but `name`, and no instruction):
//
// - it is a final module, not an object: no `linking` or `reloc.*` section is left;
// - exactly one defined function has _start's body, `f32.const 0; call X; drop; end`, with type () -> (), and X is
//   that (f32) -> (i32) function (ret32);
// - and, run in node, v is 32: the call reaches ret32's code.
//
// Not held: upstream's function order ([0, 1]: ret32 before _start, the input order) and its exactly two types (wasm-ld
// merges equal signatures and our program has init and step besides), which ../README.md doesn't fix for our linker;
// and the name section, which ../README.md doesn't give a merged program (its objects have none).
//
// Wrong programs shown failing: `linker_adds_linking_section` (../README.md: Planted twins), whose merged program
// keeps an object's `linking` section, fails our own no-`linking` check, the only assertion made of it. Upstream's
// CHECK lines would catch such a section between TYPE and FUNCTION or after `name` (its CHECK-NEXT `...`, which we
// can't hold: no name section); whether LLVM's reader under obj2yaml would reject the planted output outright is
// unrun here (this folder's README.md: What could not be held). The twin of a linker that resolves
// nothing, the program object as it is, fails upstream-held checks (imports are left; no defined (f32) -> (i32)) and
// our own (`linking` and `reloc.CODE` left; _start calls an import); the test asserts one of each (its import named,
// and _start's call to an import).
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, admitted, assemble, checkCall, logicBin, none, onHost, piece, prebuild, type JsonObject, type Lib, type Planted, type Program } from '../helpers.ts';
import { pack, vLayout } from '../libs.ts';
import { V_WRITES } from '../programs.ts';
import { programObject, stepV } from './objects.ts';
import { Reader, definedSig, importedFuncs, parse, sigText } from './wasm.ts';

prebuild(() => { logicBin(); });

const RET32 = 32;
const F32_I32 = '(f32) -> (i32)';
const VOID = '() -> ()';

/** The program object: $start, _start's body, called from step, which also writes v = ret32(0). */
const startObject = (): Program => programObject('ret32_start', vLayout(), {
  imports: '(import "lib:ret32" "ret32" (func $ret32 (param f32) (result i32)))',
  funcs: '\n  (func $start f32.const 0 call $ret32 drop)',
  step: '(call $start) (i32.store (i32.const $V) (call $ret32 (f32.const 0)))',
  data: Buffer.alloc(8192),
});
/** ret32@1: ret32.s's signature, (f32) -> (i32), returning 32; its fixture is the program object, v 32 at step 0. */
const ret32Lib = (): Lib => ({
  name: 'ret32@1',
  program: assemble('ret32', `
(module
  (import "env" "__linear_memory" (memory 0))
  (func $ret32 (export "ret32") (param $x f32) (result i32) (i32.const ${RET32})))`, 'library'),
  exports: ['ret32'],
  fixtures: [{ program: startObject(), writes: V_WRITES, steps: 1, expect: { '0': { v: [RET32] } } }],
});

const startPiece = (lib: Lib): JsonObject =>
  piece({ seed: 190_201, packs: [pack('ret32pack', [lib])], items: { start: { program: startObject(), writes: V_WRITES, links: [lib] } } });

/** _start's body: no locals, f32.const 0, call X, drop, end. X, or null when the body is another. */
function startCallee(body: Buffer): number | null {
  const r = new Reader(body);
  try {
    if (r.u32() !== 0) return null;
    if (r.byte() !== 0x43 || !r.bytes(4).equals(Buffer.alloc(4))) return null;
    if (r.byte() !== 0x10) return null;
    const x = r.u32();
    return r.byte() === 0x1a && r.byte() === 0x0b && r.done ? x : null;
  } catch { return null; }
}

/** What upstream's CHECK lines hold of a module (no imports, both types, one defined ret32), plus our own checks (no
 * `linking` or `reloc.*` section; _start's body and callee): each failure, or none. */
function judge(bytes: Buffer): string[] {
  const failures: string[] = [];
  const m = parse(bytes);
  if (m.imports.length) failures.push(`imports are left: ${m.imports.map((i) => `${i.module}.${i.name} (${i.kind})`).join(', ')}`);
  const objectSections = m.sections.filter((s) => s.id === 0 && s.name !== null && (s.name === 'linking' || s.name.startsWith('reloc.'))).map((s) => s.name);
  if (objectSections.length) failures.push(`an object's sections are left: ${objectSections.join(', ')}`);
  const types = m.types.map(sigText);
  for (const t of [F32_I32, VOID]) if (!types.includes(t)) failures.push(`the type section lacks ${t}: ${types.join('; ')}`);
  const base = importedFuncs(m);
  const ret32s = m.funcs.map((_, i) => base + i).filter((i) => definedSig(m, i) && sigText(definedSig(m, i)!) === F32_I32);
  if (ret32s.length !== 1) failures.push(`${ret32s.length} defined functions have type ${F32_I32}, not 1 (ret32)`);
  const starts = m.bodies.map((b, i) => ({ index: base + i, callee: startCallee(b) })).filter((s) => s.callee !== null && definedSig(m, s.index) && sigText(definedSig(m, s.index)!) === VOID);
  if (starts.length !== 1) failures.push(`${starts.length} defined functions of type ${VOID} have _start's body (f32.const 0; call; drop), not 1`);
  for (const s of starts) {
    const sig = definedSig(m, s.callee!);
    if (!sig) failures.push(`_start calls function ${s.callee}, an import (${base} imported functions), not an internal function`);
    else if (sigText(sig) !== F32_I32 || !ret32s.includes(s.callee!)) failures.push(`_start calls function ${s.callee} of type ${sigText(sig)}, not ret32 ${F32_I32}`);
  }
  return failures;
}

const merged = (planted: Planted[] = []): Buffer => {
  const lib = ret32Lib();
  const [reply] = onHost([checkCall(startPiece(lib))], planted);
  const receipt = admitted(reply!, `check of start${planted.length ? ` under ${planted.join(', ')}` : ''}`)['start']!;
  expect(receipt.libraries.map((l) => [l.name, l.hash]), 'the receipt names ret32@1 with its hash').toEqual([['ret32@1', lib.program.sha]]);
  expect(receipt.linked, 'the receipt carries the merged program').not.toBeNull();
  return receipt.linked!.bytes;
};

describe(`${AC[1]} function-imports.s: a call into a library becomes a call to an internal function, with no import left`, () => {
  it(`${AC[1]} the merged program of _start and ret32@1 imports nothing, holds (f32) -> (i32) and () -> (), and _start calls the internal ret32`, () => {
    const bytes = merged();
    none(judge(bytes), 'function-imports.s\'s checks of our merged program');
    expect(stepV(bytes, vLayout(), 'the merged program'), 'run in node, the call reaches ret32\'s code: v is 32').toBe(RET32);
  }, TIMEOUT);

  it(`${AC[1]} the checks fail on a merged program that keeps an object's linking section (linker_adds_linking_section) and on the program object unlinked`, () => {
    const planted = judge(merged(['linker_adds_linking_section']));
    expect(planted.some((f) => f.includes('linking')), `the planted linker's merged program fails, naming its linking section: ${planted.join(' | ')}`).toBe(true);
    const unlinked = judge(startObject().bytes);
    expect(unlinked.some((f) => f.includes('lib:ret32.ret32')), `the program object, unlinked, fails naming its import: ${unlinked.join(' | ')}`).toBe(true);
    expect(unlinked.some((f) => f.includes('an import')), `and _start's call to an import: ${unlinked.join(' | ')}`).toBe(true);
  }, TIMEOUT);
});
