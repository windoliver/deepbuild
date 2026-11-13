// #1958.26ef0787: "Budgets, on the reference Mac in the local preflight, compared with the merge base: applying a data
// migration to 1,000 items at load takes under 5 ms; resolving a document's pack graph of 10 packs takes under 1 ms;
// keeping the store's counts adds O(1) per save, bake or delete; and nothing runs per frame"
//
// asserts (structure, everywhere, in `r1`): with acme/shelf@1.0.0 and @2.0.0 installed (copied from #1956's suite), a
// board of 1,000 shelf.bookcase@1 items naming acme/shelf@2.0.0 is presented with 1,000 expansions of shelf.bookcase@2
// and `timing.migrate_ms`; with the ten packs acme/g01–g10@1.0.0 installed (written at test time, g01 requiring g02 …
// g09 requiring g10), a board listing only acme/g01@1.0.0 with one tile of each is presented with each tile expanded
// through its own pack and `timing.resolve_ms`; and after three documents naming acme/shelf@1.2.0 are saved, its
// `packs` row counts `named_by` 3. Timing, on a fit reference Mac only, five fresh processes each after a warm-up: each
// migrate_ms under 5 ms; each resolve_ms under 1 ms; each process saving 500 documents that name acme/shelf@1.2.0 (its
// count climbing to 500) within 5% of the merge base's median for the same 500 saves. Off a reference Mac, or loaded,
// the timings skip as INCONCLUSIVE after the structure passed; none passes by skipping. Bakes and deletes aren't timed
// (README: Not tested).
// The second test (a structure, everywhere): with the reading room naming acme/shelf@1.2.0 drawn and the version then
// uninstalled, and the room naming acme/shelf@9.9.9 drawn, the build's frame-phase operators (`registry`) and each
// document's frame-phase `eval` nodes are the merge base's for the room with acme/shelf@1.2.0 installed and for the 12
// other items alone.
// Wrong program: the merge base (no `timing.migrate_ms`, no `uninstall_pack`).

import { expect, it } from 'vitest';
import {
  DOC, GRAPH, PACKS, REGISTRY, SHELF_10, SHELF_12, SHELF_20, arr, baseBuild, board, bookcase, docId, environmentProblem, evalAt, five, frameNodes,
  frameOperators, graphBoard, installed, judgeRuns, median, num, obj, othersOnly, outcome, packAt, packRow, present, room, run, runTimed, scenario, settle, show,
  str, tempDir, uninstall, useBuild, useEvidence, useTempDirs, writeGraph, type JsonObject, type PackFixture,
} from './helpers.ts';

const bin = useBuild();
const evidence = useEvidence();
useTempDirs();

const ITEMS = 1_000;
const MIGRATE_MS = 5;
const RESOLVE_MS = 1;
const SAVES = 500;
const pad = (i: number): string => String(i).padStart(4, '0');

/** 1,000 bookcases saved at shelf.bookcase@1, each setting width and levels, in a board naming acme/shelf@2.0.0. */
const thousand = board('A thousand bookcases', [packAt(SHELF_20)], Array.from({ length: ITEMS }, (_, i) => ({
  id: `k${pad(i)}`, kind: 'shelf.bookcase@1', name: `K${pad(i)}`, order: `a${pad(i)}`,
  params: { width: Math.round((0.5 + (i % 100) * 0.025) * 1000) / 1000, levels: 1 + (i % 8) }, at: { pos: [(i % 40) * 16, Math.floor(i / 40) * 16, 0] },
})), [700, 460]);
/** A small document naming acme/shelf@1.2.0: one bookcase. */
const oneBookcase = board('One bookcase', [packAt(SHELF_12)], [bookcase('b1', { width: 1.2, levels: 3 }, 'a0', [20, 20])], [200, 200]);
/** Saves `n` documents naming acme/shelf@1.2.0, each its own document, then reads the store. */
const saves = (n: number): JsonObject => {
  const docs = Array.from({ length: n }, (_, i) => docId(100 + i));
  return scenario(tempDir('saves'), [...docs.map((d) => present(d, oneBookcase)), PACKS], { packs: [SHELF_12], docs });
};

/** One process: the 1,000 bookcases migrated from @1 to @2 at load; the binary's migrate_ms. */
function migrateMs(b: string): number {
  const [reply] = run(b, scenario(evidence(), [present(DOC.a, thousand, { timing: true })], { packs: [SHELF_10, SHELF_20] }));
  expect(outcome(reply!), `the 1,000 bookcases are presented under acme/shelf@2.0.0: ${show(reply!['issues'] ?? null)}`).toBe('presented');
  const kinds = arr(reply!['expansions'], 'expansions').map((e, i) => str(obj(e, `expansions[${i}]`)['kind'], `expansions[${i}].kind`));
  expect([kinds.length, kinds.every((k) => k === 'shelf.bookcase@2')], 'each of the 1,000 opens migrated to shelf.bookcase@2').toEqual([ITEMS, true]);
  return num(obj(reply!['timing'], 'timing')['migrate_ms'], 'timing.migrate_ms (applying the data migration at load)');
}
/** One process: the board whose pack graph is the ten packs; the binary's resolve_ms. */
function resolveMs(b: string, graph: readonly PackFixture[]): number {
  const [reply] = run(b, scenario(evidence(), [present(DOC.a, graphBoard(), { timing: true })], { packs: graph }));
  expect(outcome(reply!), `the board listing acme/g01@1.0.0 is presented: ${show(reply!['issues'] ?? null)}`).toBe('presented');
  const through = Object.fromEntries(arr(reply!['expansions'], 'expansions').map((e, i) => { const o = obj(e, `expansions[${i}]`); return [str(o['instance'], 'instance'), str(o['pack'], 'pack')]; }));
  const expected = Object.fromEntries(Array.from({ length: GRAPH }, (_, i) => [`t${i + 1}`, `acme/g${String(i + 1).padStart(2, '0')}@1.0.0`]));
  expect(through, 'each tile expands through its own pack of the ten-pack graph').toEqual(expected);
  return num(obj(reply!['timing'], 'timing')['resolve_ms'], 'timing.resolve_ms (resolving the document\'s pack graph)');
}

it('#1958.26ef0787 budgets on the reference Mac against the merge base: a data migration of 1,000 items at load under 5 ms, a pack graph of 10 packs resolved under 1 ms, and the store\'s counts adding O(1) per save', (ctx) => {
  const b = bin();
  const graph = writeGraph(tempDir('graph'));
  expect(migrateMs(b), 'a migrate time').toBeGreaterThanOrEqual(0);
  expect(resolveMs(b, graph), 'a resolve time').toBeGreaterThanOrEqual(0);
  const counted = run(b, saves(3)).at(-1)!;
  expect(packRow(counted, SHELF_12)?.['named_by'], `three saved documents name ${packAt(SHELF_12)}, and the store counts them: ${show(counted)}`).toBe(3);
  const problem = environmentProblem();
  if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);

  const migrations = five(() => migrateMs(b));
  const resolves = five(() => resolveMs(b, graph));
  const here = five(() => runTimed(b, saves(SAVES)).ms);
  const base = baseBuild();
  const baseMedian = median(five(() => runTimed(base.bin, saves(SAVES)).ms));
  settle(ctx, [
    judgeRuns(`applying the data migration to ${ITEMS} items at load (migrate_ms)`, migrations, MIGRATE_MS),
    judgeRuns(`resolving a document's pack graph of ${GRAPH} packs (resolve_ms)`, resolves, RESOLVE_MS),
    judgeRuns(`${SAVES} saves naming ${packAt(SHELF_12)} (process ms) against the merge base ${base.sha.slice(0, 12)}'s median ${baseMedian.toFixed(1)} + 5%`, here, baseMedian * 1.05),
  ]);
}, 7_200_000);

it('#1958.26ef0787 nothing runs per frame: a retired pack\'s document and a missing pack\'s document evaluate the merge base\'s frame-phase nodes, no more', () => {
  const [registryHere, shownA, , shownC, evalA, evalC] = run(bin(), scenario(evidence(), [
    REGISTRY,
    present(DOC.a, room(packAt(SHELF_12))),
    uninstall(SHELF_12),
    present(DOC.c, room('acme/shelf@9.9.9')),
    evalAt(DOC.a),
    evalAt(DOC.c),
  ], { packs: [SHELF_12] }));
  expect([outcome(shownA!), outcome(shownC!)], 'both rooms are presented here').toEqual(['presented', 'presented']);
  const base = baseBuild();
  const [registryBase, packsBase, baseA, baseC, baseEvalA, baseEvalC] = run(base.bin, scenario(evidence(), [
    REGISTRY,
    PACKS,
    present(DOC.a, room(packAt(SHELF_12))),
    present(DOC.c, othersOnly()),
    evalAt(DOC.a),
    evalAt(DOC.c),
  ], { packs: [SHELF_12] }));
  installed(packsBase!, [SHELF_12]);
  expect([outcome(baseA!), outcome(baseC!)], 'the merge base presents the room and the 12 other items alone').toEqual(['presented', 'presented']);
  expect(frameOperators(registryHere!), `the build's frame-phase operators are the merge base ${base.sha.slice(0, 12)}'s`).toEqual(frameOperators(registryBase!));
  expect(frameNodes(evalA!), 'a frame of the room whose pack is retired runs the merge base\'s nodes for the room with the pack installed, no more').toEqual(frameNodes(baseEvalA!));
  expect(frameNodes(evalC!), 'a frame of the room whose pack is missing runs the merge base\'s nodes for its 12 other items alone, no more').toEqual(frameNodes(baseEvalC!));
}, 7_200_000);
