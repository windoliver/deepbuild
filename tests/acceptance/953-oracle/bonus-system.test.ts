// Oracle lane for #953, criteria 1 and 4 (README): the upstream engine's bonus-system tests at commit
// c53e0e85d4d280107661d65b42d88ea6ab6eb6ee, file test/bonus/BonusSystemTest.cpp, lines 116-140 (criterion 1) and
// 171-206, 208-220 and 222-267 (criterion 4), ported as data (each case's tree, the edits in its order and the values
// it expects) and run against our output: one piece of four driver items (../953/programs.ts) linking modslib@1's
// reference library through mods.lib@1, baked by `deep-logic`, every value the upstream case asserts read from the
// bake. No upstream code is copied. How each case maps onto mods.lib@1 is README: The port.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, arr, logicBin, obj, prebuild, show } from '../190/helpers.ts';
import { AC, bakeCall, linkOf, piece, run } from '../953/helpers.ts';
import { CMP, OP, REACH, expectedOf, row, type Edit, type Plan } from '../953/model.ts';

prebuild(() => { logicBin(); });

const UPSTREAM = 'the upstream engine\'s bonus-system tests at c53e0e85d4, test/bonus/BonusSystemTest.cpp';
const attach = (node: number, parent: number, r: string): Edit => ({ kind: 'attach', node, parent, row: r });
const add = (r: ReturnType<typeof row>): Edit => ({ kind: 'add', row: r });
const reads = (...nodes: number[]) => nodes.map((node) => ({ node, stat: 0 }));

interface Case { id: string; criterion: 1 | 4; lines: string; plan: Plan; nodes: number; asserts: { step: number; what: string; values: number[] }[] }

// Lines 116-140: a parent with morale +1 and its first child; a second child attached later gets morale 1, while the
// parent's and the first child's totals (upstream: their tree versions) stay as they were.
// Nodes: 0 the parent (a side), 1 the first child, 2 the second.
const invalidation: Case = {
  id: 'invalidation', criterion: 1, lines: '116-140', nodes: 3,
  plan: {
    stats: ['morale'],
    steps: [
      { edits: [attach(0, -1, 'player_red'), attach(1, 0, 'hero_red'), add(row(0, 0, OP.add, 1))], reads: reads(1, 0), note: 'the first child under the parent, the parent\'s morale +1' },
      { edits: [attach(2, 0, 'hero_red')], reads: reads(2, 0, 1), note: 'the second child attached' },
    ],
  },
  asserts: [
    { step: 0, what: 'line 130: the first child\'s morale is 1 (with the parent\'s total, 0, read beside it)', values: [1, 0] },
    { step: 1, what: 'lines 137-139: the second child\'s morale is 1; the parent\'s and the first child\'s are as before', values: [1, 0, 1] },
  ],
};

// Lines 171-206: two angels whose morale +1 reaches their own side's hero and stacks, never the enemy's; the same
// bonus from the second angel counts once. Nodes: 0 and 1 the two players' sides, 2 the red hero, 3 the blue hero,
// 4 the red pikeman (under 2), 5 the blue pikeman (under 3), 6 and 7 the angels, each row added before it is attached.
const sideAllies = (): Edit[] => [attach(0, -1, 'player_red'), attach(1, -1, 'player_blue'), attach(2, 0, 'hero_red'), attach(3, 1, 'hero_blue'), attach(4, 2, 'pike_red'), attach(5, 3, 'pike_blue')];
const allies: Case = {
  id: 'allies', criterion: 4, lines: '171-206', nodes: 8,
  plan: {
    stats: ['morale'],
    steps: [
      { edits: [...sideAllies(), add(row(6, 0, OP.set, 1, { reach: REACH.side })), add(row(7, 0, OP.set, 1, { reach: REACH.side }))], reads: reads(2, 3, 4, 5), note: 'the battle starts, no angel on the field' },
      { edits: [attach(6, 2, 'angel')], reads: reads(2, 3, 4, 5), note: 'the first angel joins the red hero' },
      { edits: [attach(7, 2, 'angel')], reads: reads(2, 3, 4, 5), note: 'the second angel joins the red hero' },
    ],
  },
  asserts: [
    { step: 0, what: 'lines 190-193: every morale 0', values: [0, 0, 0, 0] },
    { step: 1, what: 'lines 196-199: the red hero and the red pikeman 1, the blue ones 0', values: [1, 0, 1, 0] },
    { step: 2, what: 'lines 202-205: the same with two angels', values: [1, 0, 1, 0] },
  ],
};

// Lines 208-220: an orb on the red hero blocks magic for everyone in the battle. Nodes: 0 and 1 the sides, 2 the red
// hero, 3 the blue hero, 4 the orb (attached to the red hero), its row reaching all.
const all: Case = {
  id: 'everyone', criterion: 4, lines: '208-220', nodes: 5,
  plan: {
    stats: ['block_magic'],
    steps: [
      { edits: [attach(0, -1, 'player_red'), attach(1, -1, 'player_blue'), attach(2, 0, 'hero_red'), attach(3, 1, 'hero_blue')], reads: [], note: 'the sides and heroes' },
      { edits: [add(row(4, 0, OP.add, 1, { reach: REACH.all })), attach(4, 2, 'orb')], reads: reads(2, 3), note: 'the orb on the red hero, the battle started' },
    ],
  },
  asserts: [{ step: 1, what: 'lines 216-217: both heroes have the bonus (1, where none is 0)', values: [1, 1] }],
};

// Lines 222-267: two devils on the red side lower the luck of the enemy's (player 1) hero and stacks only, once.
// Nodes as `allies`, 6 and 7 the devils; each row reaches all, its filter player = 1, the side opposite the devils'.
const devilRow = (source: number) => row(source, 0, OP.set, -1, { reach: REACH.all, filters: [{ column: 'player', cmp: CMP.eq, value: 1 }] });
const enemies: Case = {
  id: 'enemies', criterion: 4, lines: '222-267', nodes: 8,
  plan: {
    stats: ['luck'],
    steps: [
      { edits: [...sideAllies(), add(devilRow(6)), add(devilRow(7))], reads: reads(2, 3, 4, 5), note: 'the battle starts, no devil on the field' },
      { edits: [attach(6, 2, 'devil')], reads: reads(2, 3, 4, 5), note: 'the first devil joins the red hero' },
      { edits: [attach(7, 2, 'devil')], reads: reads(2, 3, 4, 5), note: 'the second devil joins the red hero' },
      { edits: [], reads: reads(2, 3, 4, 5), note: 'read again' },
    ],
  },
  asserts: [
    { step: 0, what: 'lines 246-249: every luck 0', values: [0, 0, 0, 0] },
    { step: 1, what: 'lines 252-255: the blue hero and the blue pikeman -1, the red ones 0', values: [0, -1, 0, -1] },
    { step: 2, what: 'lines 258-261: the same with two devils', values: [0, -1, 0, -1] },
    { step: 3, what: 'lines 263-266: the same read again', values: [0, -1, 0, -1] },
  ],
};

const CASES = [invalidation, allies, all, enemies];

describe(`${AC[1]} ${AC[4]} the upstream engine's bonus-system cases run on mods.lib@1`, () => {
  it(`${AC[1]} ${AC[4]} ${UPSTREAM} lines 116-140, 171-206, 208-220 and 222-267: every value they assert, read from mods.lib@1's reference library`, () => {
    // The port's own check: by our rule (../953/model.ts) each case gives upstream's values.
    for (const c of CASES) {
      const got = expectedOf(c.plan, c.nodes);
      for (const a of c.asserts) expect(got[a.step]!.values, `the port of lines ${c.lines}, by mods.lib@1's rule: ${a.what}`).toEqual(a.values);
    }
    const { module, link } = linkOf('ref');
    const p = piece(Object.fromEntries(CASES.map((c) => [c.id, { plan: c.plan, nodes: c.nodes, reads: 8, module, link }])));
    const steps = Math.max(...CASES.map((c) => c.plan.steps.length));
    const [bake] = run([bakeCall(p, steps)]);
    expect(bake!['ok'], `the ported cases bake: ${show(bake)}`).toBe(true);
    expect(arr(bake!['traps'] ?? [], 'traps'), 'no case traps').toEqual([]);
    const stepsOf = arr(bake!['steps'], 'the bake\'s steps').map((s, i) => obj(s, `steps[${i}]`));
    for (const c of CASES) {
      for (const a of c.asserts) {
        const arrays = obj(stepsOf.find((s) => s['step'] === a.step)?.['arrays'], `step ${a.step}'s arrays`);
        const read = arr(arrays[`${c.id}.totals`], `${c.id}.totals`).slice(0, a.values.length);
        expect(read, `${UPSTREAM} ${a.what} (criterion ${c.criterion}), read from mods.lib@1's reference library`).toEqual(a.values);
      }
    }
  }, TIMEOUT);
});
