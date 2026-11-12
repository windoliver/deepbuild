// #202.ed799b46: "Budgets, on the reference Mac in the local preflight, compared with the merge base: validating an item
// of a pack kind adds under 1 µs per param; kind_rules over 1,000 instances with 4 rules at 10 times runs in under 20
// ms; the kind kit of a 20-kind pack runs in under 30 s; and a document without pack kinds gains no work per frame"
//
// asserts (structure, everywhere, in `r1`): a board of 1,000 shelf.bookcase@1 instances, each with its 3 params set,
// is presented with 1,000 expansions and `timing.check_ms`; the 20-kind bench pack (written by `writeBench`, each kind
// the shelf recipe with 4 rules at 10 times and a planted twin per rule) installs, and a board of 1,000 bench.k01@1
// instances is presented with `timing.kind_rules_ms`. Timing, on a fit reference Mac only, five fresh processes each
// after a warm-up: each check_ms of the 1,000 pack-kind instances within the merge base's median for the same board
// through acme/shelf@1.0.0's recipe-only twin (the same recipe, shelf.span as a recipe-level rule, no kinds) plus
// 1,000 × 3 params × 1 µs; each kind_rules_ms under 20 ms; each kit time, a process installing the bench pack less the
// median of one installing nothing, under 30 s. Off a reference Mac, or loaded, the timings skip as INCONCLUSIVE after
// the structure passed; none passes by skipping.
// The second test (a structure, everywhere): with shelf installed (its kinds in the store), a board of rects naming no
// pack has the same frame-phase operators in `registry` and the same frame-phase nodes in `eval` as the merge base's r1
// build gives it with the recipe-only twin installed.
// Wrong program: the merge base (shelf refused for its `kinds` field; no timing.kind_rules_ms).

import { expect, it } from 'vitest';
import {
  BOOKCASE, DOC, PACKS, R1, REGISTRY, SHELF, SHELF_RECIPE_ONLY, baseBuild, board, environmentProblem, evalAt, frameNodes, item, judgeRuns, median, num,
  obj, packAt, packRow, present, rect, run, runTimed, scenario, sealedOf, settle, show, tempDir, useBuilds, useEvidence, useTempDirs, writeBench,
  type JsonObject, type PackFixture,
} from './helpers.ts';

const builds = useBuilds([R1]);
const evidence = useEvidence();
useTempDirs();

const ITEMS = 1_000;
const PARAMS = 3;
const NS_PER_PARAM = 1_000;
const RULES_MS = 20;
const KIT_MS = 30_000;
const pad = (i: number): string => String(i).padStart(4, '0');
const spot = (i: number): [number, number] => [(i % 40) * 16, Math.floor(i / 40) * 16];

/** 1,000 bookcases, each setting width, levels and dividers, all within range and holding shelf.span. */
const shelves = board('A thousand bookcases', [packAt(SHELF)], Array.from({ length: ITEMS }, (_, i) =>
  item(`b${pad(i)}`, BOOKCASE, { width: Math.round((0.5 + (i % 100) * 0.012) * 1000) / 1000, levels: 1, dividers: 1 }, `a${pad(i)}`, spot(i))), [700, 460]);
/** 1,000 bench.k01@1 instances, each holding its 4 rules. */
const benches = (bench: PackFixture): JsonObject => board('A thousand benches', [packAt(bench)], Array.from({ length: ITEMS }, (_, i) =>
  item(`k${pad(i)}`, 'bench.k01@1', { width: Math.round((1.0 + (i % 7) * 0.1) * 10) / 10, levels: 1 + (i % 7), dividers: 1 + (i % 2) }, `a${pad(i)}`, spot(i))), [700, 460]);

/** One process: the board of 1,000 bookcases through `p`, presented with all 1,000 expansions; the binary's check_ms. */
function checkMs(bin: string, p: PackFixture): number {
  const [reply] = run(bin, scenario(evidence(), [present(DOC.a, shelves, { timing: true })], { packs: [p] }));
  expect(reply!['outcome'], `the 1,000 bookcases are presented through ${p.dir}: ${show(reply!['issues'] ?? null)}`).toBe('presented');
  expect((reply!['expansions'] as unknown[] | undefined)?.length, 'each of the 1,000 instances expands').toBe(ITEMS);
  return num(obj(reply!['timing'], 'timing')['check_ms'], 'timing.check_ms');
}
/** One process: the board of 1,000 benches, presented; the binary's kind_rules_ms. */
function rulesMs(bin: string, bench: PackFixture): number {
  const [reply] = run(bin, scenario(evidence(), [present(DOC.a, benches(bench), { timing: true })], { packs: [bench] }));
  expect(reply!['outcome'], `the 1,000 benches are presented: ${show(reply!['issues'] ?? null)}`).toBe('presented');
  return num(obj(reply!['timing'], 'timing')['kind_rules_ms'], 'timing.kind_rules_ms (the kind_rules check\'s own time)');
}
const five = (f: () => number): number[] => { f(); return [0, 1, 2, 3, 4].map(() => f()); };

it('#202.ed799b46 budgets on the reference Mac against the merge base: validating a pack kind\'s item adds under 1 µs per param, kind_rules over 1,000 instances with 4 rules at 10 times under 20 ms, a 20-kind pack\'s kit under 30 s', (ctx) => {
  const bin = builds.bin(R1);
  const bench = writeBench(tempDir('bench'));
  expect(checkMs(bin, SHELF), 'a check time').toBeGreaterThanOrEqual(0);
  const [packs] = run(bin, scenario(evidence(), [PACKS], { packs: [bench] }));
  expect(packRow(packs!, bench).state, `the 20-kind bench pack passes its kits and installs: ${show(packs!)}`).toBe('installed');
  expect(rulesMs(bin, bench), 'a kind_rules time').toBeGreaterThanOrEqual(0);
  const problem = environmentProblem();
  if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);

  const base = baseBuild();
  const baseMedian = median(five(() => checkMs(base.bin, SHELF_RECIPE_ONLY)));
  const here = five(() => checkMs(bin, SHELF));
  const rules = five(() => rulesMs(bin, bench));
  const empty = median(five(() => runTimed(bin, scenario(evidence(), [PACKS])).ms));
  const kits = five(() => runTimed(bin, scenario(evidence(), [PACKS], { packs: [bench] })).ms - empty);
  settle(ctx, [
    judgeRuns(`validating 1,000 shelf.bookcase@1 items of ${PARAMS} params (check ms) against the merge base ${base.sha.slice(0, 12)}'s median ${baseMedian.toFixed(3)} + ${ITEMS} × ${PARAMS} × 1 µs`, here, baseMedian + (ITEMS * PARAMS * NS_PER_PARAM) / 1e6),
    judgeRuns('kind_rules over 1,000 instances with 4 rules at 10 times (ms)', rules, RULES_MS),
    judgeRuns(`the kind kit of a 20-kind pack (ms, a process installing it less one installing nothing, median ${empty.toFixed(0)})`, kits, KIT_MS),
  ]);
}, 7_200_000);

it('#202.ed799b46 a document without pack kinds gains no work per frame, compared with the merge base', () => {
  const rects = board('Rects only', [], [rect('r1', [10, 10, 80, 40], 'a0'), rect('r2', [10, 60, 80, 40], 'a1'), rect('r3', [10, 110, 80, 40], 'a2')]);
  const calls = [REGISTRY, present(DOC.a, rects), evalAt(DOC.a, 0), PACKS];
  const [registryHere, shownHere, evalHere, packsHere] = run(builds.bin(R1), scenario(evidence(), calls, { packs: [SHELF] }));
  expect(packRow(packsHere!, SHELF).state, 'shelf, a pack with kinds, is installed in the store here').toBe('installed');
  const base = baseBuild();
  const [registryBase, shownBase, evalBase] = run(base.bin, scenario(evidence(), calls, { packs: [SHELF_RECIPE_ONLY] }));
  expect([shownHere!['outcome'], shownBase!['outcome']], 'the board of rects is presented here and on the merge base').toEqual(['presented', 'presented']);
  expect(sealedOf(registryHere!).frameOperators, `the build's frame-phase operators are the merge base ${base.sha.slice(0, 12)}'s`).toEqual(sealedOf(registryBase!).frameOperators);
  expect(frameNodes(evalHere!), 'a frame of the board without pack kinds runs the merge base\'s nodes, no more').toEqual(frameNodes(evalBase!));
}, 7_200_000);
