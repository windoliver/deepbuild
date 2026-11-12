// The undefined-symbol oracle (the oracle map's lld/test/wasm/undefined.s row, criterion 3): a link with a function
// symbol nothing defines is refused, naming that symbol.
//
// Upstream: an object refers to foo, which no input defines; `wasm-ld --undefined=baz` fails with "undefined symbol:
// foo" naming the object (CHECK), and the error doesn't name baz, a symbol --undefined adds that nothing references
// (CHECK-NOT); the same object links once foo is
// accounted for (--allow-undefined, --allow-undefined-file). Here: a program object `both` imports
// lib:turns.next_turn and lib:grid_path.find_route and links only turns@1, which exports next_turn, so find_route is
// the one undefined symbol. `check` must refuse it (`link_refused`, naming the item, as upstream names the object),
// with a refusal naming lib:grid_path.find_route (upstream's CHECK). Beside it, a check of our own, not upstream's: no
// refusal names lib:turns.next_turn, which turns@1 defines. Upstream's passing runs become the twin: the same
// program linking turns@1 and grid_path@1 is admitted, imports nothing, and runs both calls.
//
// Not held: the CHECK-NOT (our linker has no --undefined, so no symbol can arise that only --undefined names and
// nothing references), --allow-undefined and --allow-undefined-file (our linker never leaves an import: the issue's
// "It can never: Leave an import in the running program"), --export of a missing symbol, and foo reached through its
// address in data (our objects take no function's address: no table or element segment, ../README.md: Relocatable
// objects).
//
// Wrong program shown failing: no planted value (../README.md: Planted twins) reaches an import no listed library
// exports; the wrong program is the base, which refuses every item with `links` without naming an import. The twin
// fails a linker that refuses whenever a program imports from two libraries.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, admitted, checkCall, importOf, logicBin, onHost, piece, prebuild, refusedOf, show, type JsonObject, type Lib } from '../helpers.ts';
import { gridPath1, pack, turns1, vLayout } from '../libs.ts';
import { V_WRITES, bfsRoute, nextTurn, type Grid } from '../programs.ts';
import { programObject, stepV } from './objects.ts';
import { parse } from './wasm.ts';

prebuild(() => { logicBin(); });

/** The twin's search: an open 5 × 5 grid of the program's own data at 8192, (0, 0) to (4, 0); scratch and route after it. */
const OPEN: Grid = { w: 5, h: 5, walls: [], from: [0, 0], to: [4, 0] };
const GRID_AT = 8192;
const OUT_AT = 8448;
const SCRATCH_AT = 12288;
/** v = next_turn(0, 3) + find_route(the open grid). */
const bothProgram = () => programObject('both_imports', vLayout(), {
  imports: '(import "lib:turns" "next_turn" (func $next_turn (param i32 i32) (result i32)))\n  (import "lib:grid_path" "find_route" (func $find_route (param i32 i32 i32 i32 i32 i32 i32 i32 i32) (result i32)))',
  step: `(i32.store (i32.const $V) (i32.add (call $next_turn (i32.const 0) (i32.const 3))
      (call $find_route ${[GRID_AT, OPEN.w, OPEN.h, OPEN.from[0], OPEN.from[1], OPEN.to[0], OPEN.to[1], SCRATCH_AT, OUT_AT].map((v) => `(i32.const ${v})`).join(' ')})))`,
  data: Buffer.alloc(SCRATCH_AT + 8 * OPEN.w * OPEN.h),
});
const bothPiece = (links: Lib[]): JsonObject =>
  piece({ seed: 190_203, packs: [pack('kit', links)], items: { both: { program: bothProgram(), writes: V_WRITES, links } } });

describe(`${AC[3]} undefined.s: an import no listed library exports is refused, naming it and nothing defined`, () => {
  it(`${AC[3]} a program importing lib:grid_path.find_route and lib:turns.next_turn, linking only turns@1, is refused naming find_route and not next_turn`, () => {
    const [reply] = onHost([checkCall(bothPiece([turns1()]))]);
    const r = refusedOf(reply!, 'check of both, linking only turns@1');
    expect([r.code, r.item], 'refused at check (link_refused), naming the item').toEqual(['link_refused', 'both']);
    const named = r.refusals.map(importOf);
    expect(named, `a refusal names the undefined import: ${show(r.refusals as never)}`).toContain('lib:grid_path.find_route');
    expect(named, `no refusal names lib:turns.next_turn, which turns@1 exports: ${show(r.refusals as never)}`).not.toContain('lib:turns.next_turn');
  }, TIMEOUT);

  it(`${AC[3]} the same program linking turns@1 and grid_path@1 is admitted, imports nothing and runs both calls`, () => {
    const [reply] = onHost([checkCall(bothPiece([turns1(), gridPath1()]))]);
    const receipt = admitted(reply!, 'check of both, linking turns@1 and grid_path@1')['both']!;
    expect(receipt.linked, 'the receipt carries the merged program').not.toBeNull();
    expect(parse(receipt.linked!.bytes).imports, 'the merged program imports nothing').toEqual([]);
    const moves = bfsRoute(OPEN)!.length - 1;
    expect(stepV(receipt.linked!.bytes, vLayout(), 'the merged program'), 'run in node: next_turn(0, 3) plus the open grid\'s move count').toBe(nextTurn(0, 3) + moves);
  }, TIMEOUT);
});
