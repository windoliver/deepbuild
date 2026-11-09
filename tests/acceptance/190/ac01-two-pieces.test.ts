// Criterion 1 (no upstream test): "Two pieces whose logic links one grid search library, grid_path@1, by hash each
// merge to a program that imports nothing and passes the subset check; their receipts and deep_query name grid_path@1
// with its hash; and changing one byte of the library changes both programs' rewritten hashes and bake keys, while a
// third piece that doesn't link it keeps its own"
//
// Through `deep-logic check`, `query` and `bake` (README: deep-logic). `maze` (the fixture's 5 × 5 grid) and `chase`
// (a 6 × 4 grid) each link grid_path@1 from the installed pack gridcore@1.0.0. The merged program a receipt carries
// is read by node's own WebAssembly (it compiles, imports nothing, exports logic@1's exports); admission is the subset
// check passing (a refused program is `subset_refused`). Each bake's route equals this suite's own search (bfsRoute).
// The one-byte twin differs from grid_path@1 in one padding byte of its data and ships under gridcore@1.0.1.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, admitted, arraysAt, bakeCall, bakeOf, checkCall, logicBin, onHost, prebuild, queriedOf, queryCall, sha256, type JsonObject } from './helpers.ts';
import { CHASE_GRID, chasePiece, gridPath1, mazePiece, pack, plainPiece, routeExpect } from './libs.ts';
import { FIXTURE_GRID, bfsRoute } from './programs.ts';

prebuild(() => { logicBin(); });

const LOGIC_EXPORTS = ['init', 'memory', 'reads_at', 'step', 'writes_at'];

describe(`${AC[1]} two pieces link grid_path@1 by hash into programs that import nothing`, () => {
  it(`${AC[1]} each piece merges to a program that imports nothing and passes the subset check, and its receipt and deep_query name grid_path@1 with its hash`, () => {
    const lib = gridPath1();
    const packs = [pack('gridcore', [lib])];
    const pieces: [string, JsonObject, typeof FIXTURE_GRID][] = [['maze', mazePiece(lib, packs), FIXTURE_GRID], ['chase', chasePiece(lib, packs), CHASE_GRID]];
    const replies = onHost(pieces.flatMap(([, p]) => [checkCall(p), queryCall(p), bakeCall(p, 2)]));
    pieces.forEach(([id, , grid], i) => {
      const receipt = admitted(replies[3 * i]!, `check of ${id}`)[id]!;
      expect(receipt.linked, `${id}'s receipt carries its merged program`).not.toBeNull();
      const merged = receipt.linked!;
      expect([merged.sha256, merged.size], `${id}: the merged program's sha256 and size are its bytes'`).toEqual([sha256(merged.bytes), merged.bytes.length]);
      expect(WebAssembly.validate(new Uint8Array(merged.bytes)), `${id}: the merged program is a valid WebAssembly module`).toBe(true);
      const module = new WebAssembly.Module(new Uint8Array(merged.bytes));
      expect(WebAssembly.Module.imports(module), `${id}: the merged program imports nothing`).toEqual([]);
      expect(WebAssembly.Module.exports(module).map((e) => e.name).filter((n) => LOGIC_EXPORTS.includes(n)).sort(), `${id}: it exports logic@1's exports`).toEqual(LOGIC_EXPORTS);
      expect(receipt.libraries.map((l) => [l.name, l.hash]), `${id}'s receipt names grid_path@1 with its hash`).toEqual([['grid_path@1', lib.program.sha]]);
      const row = queriedOf(replies[3 * i + 1]!, `deep_query of ${id}`)[id];
      expect(row?.libraries, `deep_query names ${id}'s library with its name@version and hash`).toEqual([{ name: 'grid_path@1', hash: lib.program.sha }]);
      expect(row?.hash, `deep_query's row is ${id}'s rewritten program`).toBe(receipt.hash);
      expect(bfsRoute(grid), `${id}'s grid has a route`).not.toBeNull();
      const b = bakeOf(replies[3 * i + 2]!, `bake of ${id}`);
      expect(b.traps, `${id} never traps`).toEqual([]);
      expect(arraysAt(b, id, 0), `${id}'s linked search gives this suite's own route and move count`).toEqual(routeExpect(grid));
    });
  }, TIMEOUT);

  it(`${AC[1]} changing one byte of the library changes both programs' rewritten hashes and bake keys, while a third piece that doesn't link it keeps its own`, () => {
    const a = gridPath1();
    const b = gridPath1({ pad: 1 });
    expect(b.program.bytes.length, 'the twin is the same length').toBe(a.program.bytes.length);
    expect(Array.from(a.program.bytes).filter((x, i) => x !== b.program.bytes[i]).length, 'and differs from grid_path@1 in exactly one byte').toBe(1);
    const run = (lib: typeof a, version: string): JsonObject[] => {
      const packs = [pack('gridcore', [lib], version)];
      return onHost([bakeCall(mazePiece(lib, packs), 1), bakeCall(chasePiece(lib, packs), 1), bakeCall(plainPiece(packs), 1)]);
    };
    const before = run(a, '1.0.0');
    const after = run(b, '1.0.1');
    for (const [i, id] of ['maze', 'chase'].entries()) {
      const x = bakeOf(before[i]!, `${id} with grid_path@1`);
      const y = bakeOf(after[i]!, `${id} with the one-byte twin`);
      expect(y.items?.[id]?.libraries.map((l) => l.hash), `${id} links the twin`).toEqual([b.program.sha]);
      expect(y.items?.[id]?.hash, `${id}'s rewritten program hash changes with one byte of its library`).not.toBe(x.items?.[id]?.hash);
      expect(y.keys[id], `${id}'s bake key changes too`).not.toBe(x.keys[id]);
    }
    const x = bakeOf(before[2]!, 'the third piece beside gridcore@1.0.0');
    const y = bakeOf(after[2]!, 'the third piece beside gridcore@1.0.1');
    expect(y.items?.['plain']?.hash, 'the third piece, which links nothing, keeps its rewritten program hash').toBe(x.items?.['plain']?.hash);
    expect(y.keys['plain'], 'and its bake key').toBe(x.keys['plain']);
  }, TIMEOUT);
});
