// AC7 #1636.3164f1b8: "A levels chain over the fixture tree has strictly growing errors (#438's rule), and `drop: [twigs]`
// keeps the trunk and first-level radii within 5% while removing only levels 3 and up, by part"
//
// The fixture tree (helpers.ts `FIXTURE`), read by deep-show's `geometry` (its rings, levels and parts) and given to
// deep-gpu's `simplify` job as an item of its document (README: Assumed surfaces 7).
//   - First test, the levels chain: `simplify {doc, item: tree, levels: auto}` answers at least three levels, the first
//     the built tree's own triangles at error 0, each later one with fewer triangles and a strictly larger error.
//   - Second test, the proxy: `simplify {doc, item: tree, proxy: {drop: [twigs]}}` writes a proxy whose parts keep
//     `trunk` and `branches` and lose `twigs`. Each branch is measured by a plane cut, the same on the full build and
//     on the proxy (README: Readings): the trunk and every level-2 branch at their middle, where the proxy's radius is
//     the full build's within 5%; every twig (level 3 and up) at 30% of its rings, where the full build has its tube
//     and the proxy has nothing within twice its radius.
// Wrong programs: the base (no tree@1, no item for the job); a level no coarser or no worse than the one before; a drop
// that removes level 2 too, or only the last level, or thins the kept tubes; a part dropped by name but its triangles
// kept.
import { describe, expect, it } from 'vitest';
import {
  AC, FIXTURE, TIMEOUT, arr, cutOf, cutRadius, docId, geometry, int, isObject, none, num, obj, presented, readGltf, readNamed, runGpu, runShow,
  scenario, sessionDoc, show, str, topologyFailures, treeItem, treeRow, treesDoc, useBins, useFolders, writeJson, type JsonObject,
} from './helpers.ts';

const ID = AC[7];
const NAME = `AC7 ${ID}`;
const bin = useBins(['deep-show', 'deep-gpu']);
const folder = useFolders();
const DOC = docId(8);

/** The fixture as deep-show builds it, and the same document as deep-gpu's job reads it. */
function fixture(): { row: ReturnType<typeof treeRow>; doc: string; out: string } {
  const [shown, read] = runShow(bin('deep-show'), scenario(folder(), [DOC], [show(DOC, treesDoc({ tree: treeItem(FIXTURE) })), geometry(DOC, ['tree'])]));
  presented(shown!, 'the fixture tree');
  const row = treeRow(read!, 'tree', 'the fixture tree');
  none(topologyFailures(row, FIXTURE), 'the fixture has its 40 branches');
  const out = folder();
  return { row, doc: writeJson(out, 'tree', sessionDoc('tree-1636', [640, 480], { tree: treeItem(FIXTURE) })), out };
}
function job(reply: JsonObject, what: string): JsonObject {
  expect(reply['code'], `${what}: simplify answered, not refused (README: Assumed surfaces 7): ${JSON.stringify(reply).slice(0, 1500)}`).toBeUndefined();
  return reply;
}

describe(`${NAME} levels by error over the tree, and a proxy that drops its twigs`, () => {
  it(`${NAME} a levels chain over the fixture tree has strictly growing errors`, () => {
    const { row, doc, out } = fixture();
    const [reply] = runGpu(bin('deep-gpu'), out, [{ call: 'simplify', doc, item: 'tree', levels: 'auto' }]);
    const r = job(reply!, 'the levels chain');
    const tris = arr(r['levels'], 'levels').map((l, k) => int(obj(l, `levels[${k}]`)['triangles'], `levels[${k}].triangles`));
    const errors = arr(r['lod_errors'], 'lod_errors').map((e, k) => num(e, `lod_errors[${k}]`));
    console.log(`${ID} the chain: triangles ${tris.join(', ')}; errors ${errors.map((e) => e.toExponential(3)).join(', ')}`);
    expect(errors.length, 'one error per level').toBe(tris.length);
    expect(tris.length, 'the chain has the tree and at least two coarser levels').toBeGreaterThanOrEqual(3);
    expect(tris[0], 'level 0 is the built tree').toBe(row.indices.length / 3);
    expect(errors[0], 'level 0\'s error is 0').toBe(0);
    none(tris.slice(1).flatMap((t, k) => (t < tris[k]! ? [] : [`level ${k + 1} keeps ${t} triangles, not fewer than level ${k}'s ${tris[k]}`])), 'each level is coarser than the one before');
    none(errors.slice(1).flatMap((e, k) => (e > errors[k]! ? [] : [`level ${k + 1}'s error ${e} is not above level ${k}'s ${errors[k]}`])), 'the errors grow strictly (#438\'s rule)');
  }, 2 * TIMEOUT);

  it(`${NAME} drop: [twigs] keeps the trunk and first-level radii within 5% while removing only levels 3 and up, by part`, () => {
    const { row, doc, out } = fixture();
    const [reply] = runGpu(bin('deep-gpu'), out, [{ call: 'simplify', doc, item: 'tree', proxy: { drop: ['twigs'] } }]);
    const r = job(reply!, 'the proxy');
    const parts = arr(r['parts'], 'the proxy\'s parts').map((p, k) => str(p, `parts[${k}]`));
    expect(parts, 'the proxy keeps the trunk').toContain('trunk');
    expect(parts, 'the proxy keeps the first branch level').toContain('branches');
    expect(parts, 'the proxy drops the twigs, by part').not.toContain('twigs');
    expect(isObject(r) && typeof r['triangles'] === 'number' && r['triangles'] > 0, 'the proxy has triangles').toBe(true);
    const proxy = readGltf(readNamed(out, r['sha256'], 'gltf', 'the proxy'), 'the proxy');
    expect(proxy.indices.length / 3, 'the proxy reports its own triangles').toBe(r['triangles']);
    const failures: string[] = [];
    let twigsCut = 0;
    for (const b of row.branches) {
      const kept = b.level <= 2;
      const cut = cutOf(row, b, kept ? 0.5 : 0.3);
      const full = cutRadius(row.positions, row.indices, cut.p, cut.n, 2 * cut.r);
      if (full === null) { failures.push(`branch ${b.id}: the full build's own cut finds no tube`); continue; }
      const there = cutRadius(proxy.positions, proxy.indices, cut.p, cut.n, 2 * cut.r);
      if (kept && (there === null || Math.abs(there - full) > 0.05 * full)) failures.push(`branch ${b.id} (level ${b.level}): its radius is ${full.toFixed(5)} m in the full build and ${there === null ? 'gone' : `${there.toFixed(5)} m`} in the proxy, not within 5%`);
      if (!kept) { twigsCut++; if (there !== null) failures.push(`twig ${b.id} (level ${b.level}) is still in the proxy, ${there.toFixed(5)} m from its axis`); }
    }
    expect(twigsCut, 'every twig of the fixture was cut').toBe(36);
    none(failures, 'the proxy keeps the trunk and level-2 radii within 5% and has no tube of level 3 or more');
  }, 2 * TIMEOUT);
});
