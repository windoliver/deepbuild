// AC1 #953.ab5c01d3: "On 1,000 seeded trees of up to 64 nodes and 128 modifiers, each edited by 50 seeded attaches,
// detaches, moves, adds and removes, every node's total for every stat, read after each edit, equals a brute-force
// recompute from the whole tree; the release preflight's generated tests (technical-design.md:885) run 100,000 such
// cases from recorded seeds, each a seeded tree of up to 64 nodes and 128 modifiers edited by 50 such edits, every total
// read after each edit equal to the brute-force recompute, plus 100 seeded trees of up to 500 nodes and 2,000 modifiers
// each edited by 1,000 such edits, checked the same way; a planted library that caches totals without marking a moved
// node's descendants returns a stale total and fails, naming the edit, the node and the stat"
//
// Through `deep-logic first_party`, `check` and `bake` (README: The surface). Each seeded case (model.ts: seededCase,
// from seeds.json's recorded seed and the case's index) is one driver item: step 0 builds the tree and its rows, then
// one edit a step, and after every step the driver reads total(node, stat) for every node and every one of the four
// stats through mods.lib@1, linked to modslib@1's reference library mods.tree. 25 cases make one piece, ten pieces a
// process. Every value read is judged against model.ts's recompute from the whole tree. With DEEP_PREFLIGHT=release
// (the release preflight) the same seed runs 100,000 cases, then 100 large ones (model.ts: largePlan).
// The wrong program: mods_stale@1 (programs.ts: library({stale: true})), which leaves a moved node's descendants'
// cached totals unmarked; on the same cases its first wrong read comes after an attach or a detach, at a descendant of
// the node that moved, equal to that node's total before the edit, and the judgement names the edit, node and stat.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TIMEOUT, logicBin, prebuild } from '../190/helpers.ts';
import { interfaceRuns } from '../416/interfaces/helpers.ts';
import { AC, IFACE, RELEASE, bakeAndJudge, checkCall, linkOf, modsPack, piece, run, type DriverItem, type Judged, type TwinName } from './helpers.ts';
import { STATS, Tree, caseSeed, describe as describeEdit, editPlan, largePlan, seededCase, type Case, type Plan, type Size } from './model.ts';

prebuild(() => { logicBin(); });

const SEEDS = JSON.parse(readFileSync(new URL('./seeds.json', import.meta.url), 'utf8')) as {
  edits: { seed: number; cases: number; releaseCases: number; maxNodes: number; maxRows: number; edits: number };
  large: { seed: number; releaseCases: number; maxNodes: number; maxRows: number; edits: number };
};
const GROUP = 25;
const PER_PROCESS = 10;

/** Pieces of `GROUP` seeded cases each, cases `from` to `to` − 1 of `seed`, every item linking `which`. */
function* groups(seed: number, from: number, to: number, size: Size, which: 'ref' | TwinName, plan: (c: Case) => Plan, group = GROUP) {
  const { module, link, packs } = linkOf(which);
  const reads = size.maxNodes * STATS.length;
  for (let g = from; g < to; g += group) {
    const items: Record<string, DriverItem> = {};
    const judged: Judged[] = [];
    let steps = 0;
    for (let i = g; i < Math.min(g + group, to); i++) {
      const c = seededCase(caseSeed(seed, i), size);
      const p = plan(c);
      items[`t${i - g}`] = { plan: p, nodes: c.nodes, reads, module, link };
      judged.push({ item: `t${i - g}`, label: `tree ${c.seed} (case ${i} of seed ${seed}, ${c.nodes} nodes, ${c.adds.length} rows)`, plan: p, nodes: c.nodes });
      steps = Math.max(steps, p.steps.length);
    }
    yield { piece: piece(items, packs), steps, items: judged };
  }
}
const SIZE: Size = { maxNodes: SEEDS.edits.maxNodes, maxRows: SEEDS.edits.maxRows, edits: SEEDS.edits.edits };

describe(`${AC[1]} every total, read after each seeded edit, equals a brute-force recompute from the whole tree`, () => {
  it(`${AC[1]} on ${RELEASE ? '100,000' : '1,000'} seeded trees of up to 64 nodes and 128 modifiers, each edited by 50 seeded attaches, detaches, moves, adds and removes, every node's total for every stat read after each edit equals the brute-force recompute${RELEASE ? ', and on 100 trees of up to 500 nodes and 2,000 modifiers edited by 1,000' : ''}`, () => {
    const m = modsPack();
    // The library under test is the pack's reference library, linked through mods.lib@1 once its fixtures pass.
    const [first] = groups(SEEDS.edits.seed, 0, 1, SIZE, 'ref', editPlan);
    const [checked] = run([checkCall(first!.piece)]);
    const runs = interfaceRuns(checked!, 't0', m.ref.name)[IFACE];
    expect(runs?.map((r) => [r.fixture, r.verdict]).sort(), `${m.ref.name} links through ${IFACE}, every fixture of ${IFACE} run on it and passed`).toEqual(m.iface.fixtures.map((f) => [f, 'PASS']).sort());

    const cases = RELEASE ? SEEDS.edits.releaseCases : SEEDS.edits.cases;
    const wrong = bakeAndJudge(groups(SEEDS.edits.seed, 0, cases, SIZE, 'ref', editPlan), PER_PROCESS);
    expect(wrong.map((w) => w.message), `${wrong.length} of ${cases} seeded trees read a total the brute-force recompute doesn't give (each tree's first)`).toEqual([]);

    if (RELEASE) {
      const large: Size = { maxNodes: SEEDS.large.maxNodes, maxRows: SEEDS.large.maxRows, edits: SEEDS.large.edits };
      const big = bakeAndJudge(groups(SEEDS.large.seed, 0, SEEDS.large.releaseCases, large, 'ref', largePlan, 1), 5);
      expect(big.map((w) => w.message), `${big.length} of ${SEEDS.large.releaseCases} large seeded trees read a total the brute-force recompute doesn't give`).toEqual([]);
    }
  }, RELEASE ? 72 * 3_600_000 : TIMEOUT);

  it(`${AC[1]} a planted library that caches totals without marking a moved node's descendants returns a stale total and fails, naming the edit, the node and the stat`, () => {
    const m = modsPack();
    const wrong = bakeAndJudge(groups(SEEDS.edits.seed, 0, SEEDS.edits.cases, SIZE, 'stale', editPlan), 2, true);
    expect(wrong.length, 'mods_stale@1 reads a total the brute-force recompute doesn\'t give on some seeded tree').toBeGreaterThan(0);
    const w = wrong[0]!;
    const e = w.edit;
    expect(e?.kind === 'attach' || e?.kind === 'detach', `its first wrong read follows a node's attach or detach: ${w.message}`).toBe(true);
    // The tree as that edit left it: the node read wrong sits under the node that moved.
    const tree = new Tree(STATS);
    for (const s of w.plan.steps.slice(0, w.step + 1)) for (const x of s.edits) tree.apply(x);
    const moved = e!.kind === 'attach' || e!.kind === 'detach' ? e!.node : -1;
    expect(tree.under(w.node, moved), `node ${w.node} is a descendant of node ${moved}, which ${describeEdit(e!, STATS)} moved`).toBe(true);
    expect(w.actual, `the total it read is stale: node ${w.node}'s ${STATS[w.stat]} before the edit, ${w.previous}`).toBe(w.previous);
    expect(w.actual, 'and not the recompute\'s').not.toBe(w.expected);
    for (const named of [describeEdit(e!, STATS), `node ${w.node}`, `stat ${STATS[w.stat]}`]) expect(w.message, `the failure names ${named}`).toContain(named);
    // The same tree on the reference library reads every total right.
    const { module, link } = linkOf('ref');
    const again = bakeAndJudge([{ piece: piece({ t: { plan: w.plan, nodes: w.nodes, reads: SIZE.maxNodes * STATS.length, module, link } }), steps: w.plan.steps.length, items: [{ item: 't', label: w.label, plan: w.plan, nodes: w.nodes }] }], 1);
    expect(again.map((x) => x.message), `${m.ref.name} reads ${w.label} as the recompute does`).toEqual([]);
  }, TIMEOUT);
});
