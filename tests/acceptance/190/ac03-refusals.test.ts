// Criterion 3 (no upstream test): "A link whose bytes differ from its hash is refused at check, naming both hashes; a
// link whose name@version an installed pack maps to another hash is refused, naming the pack; a program that imports
// lib:grid_path.find_route when no listed library exports it is refused, naming the import; a library that imports
// from one listed after it is refused, naming that import; and a merged program 1 byte over 4 MiB is refused, naming
// the limit"
//
// Through `deep-logic check` (README: deep-logic, Refusals). Each refusal is `link_refused` naming the item, with the
// naming field these tests read: `asset` and `actual` (the link's hash and its bytes'), `pack`, `import`, `limit`.
// The 4 MiB case links bulk@1, a library of n data bytes, into a program whose item has 8 MiB of memory: n is moved
// until the merged program the receipt carries is exactly 4,194,304 bytes (admitted), then one byte more is refused.
import { describe, expect, it } from 'vitest';
import { AC, MAX_PROGRAM, TIMEOUT, admitted, checkCall, importOf, logicBin, onHost, piece, prebuild, refusedOf, sha256, show, type JsonObject, type Refused } from './helpers.ts';
import { bulk1, gridPath1, mazePiece, pack, pathing1, turns1, vLayout } from './libs.ts';
import { FIXTURE_GRID, V_WRITES, bulkProgram, gridPath, tacticsProgram } from './programs.ts';

prebuild(() => { logicBin(); });

const refusal = (reply: JsonObject, what: string, item: string): Refused => {
  const r = refusedOf(reply, what);
  expect([r.code, r.item], `${what} is refused at check (link_refused), naming the item`).toEqual(['link_refused', item]);
  return r;
};

describe(`${AC[3]} a link that doesn't resolve is refused at check, naming what doesn't`, () => {
  it(`${AC[3]} bytes off their hash, a pack's other hash, an import no listed library exports, an import of a later library and a merged program 1 byte over 4 MiB are each refused, naming it`, () => {
    const lib = gridPath1();
    const other = gridPath({ cut: true });
    // The link's asset holds other bytes than its hash names.
    const offHash = mazePiece(lib, [pack('gridcore', [lib])]);
    (offHash['assets'] as JsonObject)[lib.program.sha] = other.bytes.toString('base64');
    // The installed pack maps grid_path@1 to another (sound) library's hash.
    const elsewhere = gridPath1({ pad: 7 });
    const mapped = mazePiece(lib, [pack('gridcore', [elsewhere])]);
    // The program imports lib:grid_path.find_route; the one listed library is turns@1.
    const turns = turns1();
    const unexported = mazePiece(turns, [pack('kit', [turns])]);
    // pathing@1 (declaring no needs) imports lib:grid_path.find_route, and grid_path@1 is listed after it.
    const path = pathing1([]);
    const later = piece({ seed: 190_03, packs: [pack('kit', [path, lib])], items: { tactics: { program: tacticsProgram(vLayout(), FIXTURE_GRID), writes: V_WRITES, links: [path, lib] } } });
    const [a, b, c, d] = onHost([checkCall(offHash), checkCall(mapped), checkCall(unexported), checkCall(later)]);

    const ra = refusal(a!, 'a link whose bytes differ from its hash', 'maze');
    expect(ra.refusals.some((r) => r['asset'] === lib.program.sha && r['actual'] === sha256(other.bytes)), `a refusal names both hashes: ${show(ra.refusals as never)}`).toBe(true);
    const rb = refusal(b!, 'a link an installed pack maps to another hash', 'maze');
    expect(rb.refusals.some((r) => r['pack'] === 'gridcore@1.0.0'), `a refusal names the pack: ${show(rb.refusals as never)}`).toBe(true);
    const rc = refusal(c!, 'an import no listed library exports', 'maze');
    expect(rc.refusals.map(importOf), `a refusal names the import: ${show(rc.refusals as never)}`).toContain('lib:grid_path.find_route');
    const rd = refusal(d!, 'a library that imports from one listed after it', 'tactics');
    expect(rd.refusals.map(importOf), `a refusal names that import: ${show(rd.refusals as never)}`).toContain('lib:grid_path.find_route');

    // The merged program at exactly 4 MiB, then 1 byte over.
    const sized = (n: number): JsonObject => {
      const bulk = bulk1(n);
      return piece({ seed: 190_031, packs: [pack('bulkpack', [bulk])], items: { big: { program: bulkProgram(vLayout()), writes: V_WRITES, links: [bulk], budget: { memory: 8 } } } });
    };
    const mergedSize = (n: number): number => {
      const [reply] = onHost([checkCall(sized(n))]);
      return admitted(reply!, `check of a merged program with ${n} library data bytes`)['big']!.linked!.size;
    };
    let n = MAX_PROGRAM - 70_000;
    for (let tries = 0; tries < 3; tries++) {
      const size = mergedSize(n);
      if (size === MAX_PROGRAM) break;
      n += MAX_PROGRAM - size;
    }
    expect(mergedSize(n), `a library of ${n} data bytes merges to exactly 4 MiB, which is admitted`).toBe(MAX_PROGRAM);
    const [over] = onHost([checkCall(sized(n + 1))]);
    const re = refusal(over!, 'a merged program 1 byte over 4 MiB', 'big');
    const limit = re.refusals.map((r) => r['limit']).find((l) => l && typeof l === 'object' && !Array.isArray(l) && l['max'] === MAX_PROGRAM) as JsonObject | undefined;
    expect(limit, `a refusal names the 4 MiB limit: ${show(re.refusals as never)}`).toBeDefined();
    expect(limit!['actual'], 'and the merged program\'s size, 1 byte over').toBe(MAX_PROGRAM + 1);
  }, TIMEOUT);
});
