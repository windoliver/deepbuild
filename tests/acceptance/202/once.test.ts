// #202.76f0edd8: "A pack kind whose recipe also carries a recipe-level rule raises each failing rule once per instance;
// a planted check that evaluates the recipe's rules a second time for the kind raises the rule twice and fails, naming
// the rule"
//
// asserts: in `r1`, acme/rack@1.0.0 installs: its kind rack.unit@1 holds the kind rule rack.span (width ≤ 0.9 ×
// (dividers + 1)) and its recipe the recipe-level rule rack.levels (levels ≤ 6); a board with one rack u1 {width 2.0,
// levels 8, dividers 1}, which breaks both, raises rack.span once and rack.levels once on u1. Under `planted:
// "recipe_rules_twice"` rack.levels is raised twice on u1, and the check fails naming rack.levels.
// Wrong programs: the planted check (named); the merge base (rack refused for its `kinds` field).

import { expect, it } from 'vitest';
import {
  DOC, PACKS, R1, RACK, board, failsNaming, item, none, onceFailures, packAt, packRow, present, run, scenario, show, useBuilds, useEvidence,
  type JsonObject,
} from './helpers.ts';

const builds = useBuilds([R1]);
const evidence = useEvidence();
const RULES = ['rack.span', 'rack.levels'];

function shown(planted?: string): { packs: JsonObject; reply: JsonObject } {
  const rack = board('A rack that breaks both rules', [packAt(RACK)], [item('u1', 'rack.unit@1', { width: 2.0, levels: 8, dividers: 1 }, 'a0')]);
  const [packs, reply] = run(builds.bin(R1), scenario(evidence(), [PACKS, present(DOC.a, rack)], { packs: [RACK], planted }));
  return { packs: packs!, reply: reply! };
}

it('#202.76f0edd8 a pack kind whose recipe carries a recipe-level rule raises each failing rule once per instance', () => {
  const { packs, reply } = shown();
  expect(packRow(packs, RACK).state, `acme/rack@1.0.0 installs: ${show(packs)}`).toBe('installed');
  none(onceFailures(reply, 'u1', RULES), 'each failing rule of rack.unit@1 and its recipe, on u1');
}, 1_800_000);

it('#202.76f0edd8 a planted check that evaluates the recipe\'s rules a second time for the kind raises the rule twice and fails, naming the rule', () => {
  failsNaming(onceFailures(shown('recipe_rules_twice').reply, 'u1', RULES), ['rack.levels'], 'the check that evaluates the recipe\'s rules twice');
}, 1_800_000);
