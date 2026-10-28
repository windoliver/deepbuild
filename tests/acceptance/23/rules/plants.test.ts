// The wrong programs the criteria name (plants.ts): each criterion's scenario must fail on its plant, naming the rule.

import { expect, test } from 'vitest';
import { judge } from '../../../../packages/resolver-decisions/src/index.ts';
import type { Judge, Planting, RuleSpec, RuleWorld } from './helpers.ts';
import { frozenStopsDeciding, pointRates, twoSided, zeroRate } from './plants.ts';
import { frozen39, frozenKeepsDeciding, frozenOneIn40, inRuleWorld, NO_BREAKAGE_39, ONE_IN_40, revoked7In40, SEVEN_IN_40 } from './scenarios.ts';

const LONG = 300_000;

/** Runs the scenario on the plant; it must fail, and the failure must match `named`, with the rule's handle in it. */
async function onPlant(spec: RuleSpec, scenario: (judgeWith: Judge) => (rw: RuleWorld) => Promise<void>, wrong: { judge?: Judge; plant?: Planting }, named: RegExp): Promise<void> {
  let error: unknown;
  let rule = '';
  await inRuleWorld(spec, async (rw) => {
    rule = rw.rule;
    try {
      await scenario(wrong.judge ?? judge)(rw);
    } catch (e) {
      error = e;
    }
  }, wrong.plant);
  expect(error, 'the scenario fails on the wrong program').toBeInstanceOf(Error);
  const message = (error as Error).message;
  expect(message).toMatch(named);
  expect(message, 'the failure names the rule').toContain(rule);
}

const RULE = 'decision:[0-9A-Za-z]+';

test('#23.65434b19 fails on a judge that takes your rate as the 0 it observed, which revokes the rule with 1 breakage, naming it', async () => {
  await onPlant(ONE_IN_40, frozenOneIn40, { judge: zeroRate }, new RegExp(`${RULE} \\(the rule with 1 breakage in 40 cases\\) stays frozen: its state in the decisions table: expected 'revoked' to be 'frozen'`));
}, LONG);

test('#23.65434b19 fails on a judge that compares point rates, which widens the rule with 39 cases, naming it', async () => {
  await onPlant(NO_BREAKAGE_39, frozen39, { judge: pointRates }, new RegExp(`${RULE} \\(the rule with no breakage in 39 cases\\) can't decide and stays frozen: its state in the decisions table: expected 'active' to be 'frozen'`));
}, LONG);

test('#23.65434b19 fails on a judge with two-sided bounds, which keeps the rule with 7 breakages, naming it', async () => {
  await onPlant(SEVEN_IN_40, revoked7In40, { judge: twoSided }, new RegExp(`${RULE} \\(the rule with 7 breakages in 40 cases\\) FAILs and is revoked: its state in the decisions table: expected 'frozen' to be 'revoked'`));
}, LONG);

test('#23.b2a26445 fails on a resolver that stops deciding from a frozen rule, naming the rule', async () => {
  await onPlant(NO_BREAKAGE_39, frozenKeepsDeciding, { plant: frozenStopsDeciding }, new RegExp(`where ${RULE} \\(the rule with no breakage in 39 cases\\) is frozen and keeps deciding: ask:[0-9A-Z]+ is decided for you, without reaching you`));
}, LONG);
