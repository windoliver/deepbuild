// The criteria's own trees (README: Scenes), each a plan for one driver item, and what the rule (model.ts) gives on
// them, checked against the issue's numbers before anything runs.

import { KIND } from './catalog.ts';
import { BOUNDARY, CMP, DURATION, OP, REACH, row, type Edit, type Plan } from './model.ts';

const attach = (node: number, parent: number, r: string): Edit => ({ kind: 'attach', node, parent, row: r });
const add = (r: ReturnType<typeof row>): Edit => ({ kind: 'add', row: r });
const tick = (boundary: 0 | 1): Edit => ({ kind: 'tick', boundary });

/**
 * Criterion 2. Side 0; holder A (1, a hero) carries archers 2 and 3, swordsman 4, and archer 5 under archer 2; the item
 * 6 sits on A. Holder B (7) carries archer 8 and pikeman 9. Side 10 holds hero 11 and its archer 12. The item's row,
 * attack +2 to kind = archer, names its holder as source (README: Readings). Step 1 moves the item to B: the item node
 * moves, and its row is removed and added again with B as source.
 */
export const ARCHERS = { holderA: 1, holderB: 7, item: 6, archersA: [2, 3, 5], swordsman: 4, archerB: 8, pikemanB: 9, nodes: 13 };
const itemRow = (holder: number) => row(holder, 0, OP.add, 2, { filters: [{ column: 'kind', cmp: CMP.eq, value: KIND.archer }] });
export const archersPlan: Plan = {
  stats: ['attack'],
  steps: [
    {
      edits: [attach(0, -1, 'side_red'), attach(1, 0, 'hero'), attach(2, 1, 'archer'), attach(3, 1, 'archer'), attach(4, 1, 'swordsman'),
        attach(5, 2, 'archer'), attach(6, 1, 'item'), attach(7, 0, 'hero'), attach(8, 7, 'archer'), attach(9, 7, 'pikeman'),
        attach(10, -1, 'side_blue'), attach(11, 10, 'hero'), attach(12, 11, 'archer'), add(itemRow(1))],
      reads: [{ first: 0, count: 13 }], note: 'the item on holder A',
    },
    { edits: [{ kind: 'detach', node: 6 }, attach(6, 7, 'item'), { kind: 'remove', id: 0 }, add(itemRow(7))], reads: [{ first: 0, count: 13 }], note: 'the item moved to holder B' },
  ],
};

/** Criterion 3. Side 0, hero 1, archer 2 (attack 10); the hero's rows reach the archer: add 5, percent 20, and cap 16 or none. */
export const stackPlan = (capped: boolean): Plan => ({
  stats: ['attack'],
  steps: [{
    edits: [attach(0, -1, 'side_red'), attach(1, 0, 'hero'), attach(2, 1, 'archer'),
      add(row(1, 0, OP.add, 5)), add(row(1, 0, OP.percent, 20)), ...(capped ? [add(row(1, 0, OP.cap, 16))] : [])],
    reads: [{ node: 2, stat: 0 }], note: capped ? 'base 10, add 5, percent 20, cap 16' : 'base 10, add 5, percent 20',
  }],
});

/**
 * Criterion 4, side reach. Side red (0): hero 1 with archer 2, swordsman 3 and the item 4; hero 5 with pikeman 6. Side
 * blue (7): hero 8 with archer 9 and pikeman 10. Archer 2's row, morale +3 with reach side.
 */
export const SIDES = { red: [1, 2, 3, 4, 5, 6], redSide: 0, blue: [7, 8, 9, 10], nodes: 11 };
export const sidePlan: Plan = {
  stats: ['morale'],
  steps: [{
    edits: [attach(0, -1, 'side_red'), attach(1, 0, 'hero'), attach(2, 1, 'archer'), attach(3, 1, 'swordsman'), attach(4, 1, 'item'),
      attach(5, 0, 'hero'), attach(6, 5, 'pikeman'), attach(7, -1, 'side_blue'), attach(8, 7, 'hero'), attach(9, 8, 'archer'), attach(10, 8, 'pikeman'),
      add(row(2, 0, OP.add, 3, { reach: REACH.side }))],
    reads: [{ first: 0, count: 11 }], note: 'an aura from archer 2, reach side',
  }],
};

/**
 * Criterion 4, a duration of 3 rounds: hero 1's row, attack +5 to archer 2 (base 10), for 3 rounds. Each round is two
 * turn boundaries, then the round's; the archer is read after every step. Step 3 holds the read before the 3rd round's
 * boundary, step 4 the read after it.
 */
export const roundsPlan: Plan = {
  stats: ['attack'],
  steps: [
    { edits: [attach(0, -1, 'side_red'), attach(1, 0, 'hero'), attach(2, 1, 'archer'), add(row(1, 0, OP.add, 5, { duration: { kind: DURATION.rounds, count: 3 } }))], reads: [{ node: 2, stat: 0 }], note: 'a 3-round add of 5' },
    { edits: [tick(BOUNDARY.turn), tick(BOUNDARY.turn), tick(BOUNDARY.round)], reads: [{ node: 2, stat: 0 }], note: 'round 1 ends' },
    { edits: [tick(BOUNDARY.turn), tick(BOUNDARY.turn), tick(BOUNDARY.round)], reads: [{ node: 2, stat: 0 }], note: 'round 2 ends' },
    { edits: [tick(BOUNDARY.turn), tick(BOUNDARY.turn)], reads: [{ node: 2, stat: 0 }], note: 'round 3, before its boundary' },
    { edits: [tick(BOUNDARY.round)], reads: [{ node: 2, stat: 0 }], note: 'round 3 ends' },
  ],
};
