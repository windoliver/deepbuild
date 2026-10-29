// Each criterion's scenario, shared by the criterion tests and plants.test.ts: the same steps must pass on the real
// program and fail on each wrong program, naming the rule. Each opens its own world and closes it.

import { expect } from 'vitest';
import { judge } from '../../../../packages/resolver-decisions/src/index.ts';
import { commit } from '../match/data.ts';
import { pct } from './bounds.ts';
import {
  card, decideAnother, judgedIn, judgeRound, lastPos, reachesYou, recordedAs, ruleWorld, stateOf, storeAsk,
  type Judge, type Planting, type RuleSpec, type RuleWorld,
} from './helpers.ts';

export const NO_BREAKAGE_40: RuleSpec = { cases: 40, broke: 0 };
export const NO_BREAKAGE_39: RuleSpec = { cases: 39, broke: 0 };
export const ONE_IN_40: RuleSpec = { cases: 40, broke: 1 };
export const SEVEN_IN_40: RuleSpec = { cases: 40, broke: 7 };

/** Runs a scenario in a rule's world and closes it. */
export async function inRuleWorld(spec: RuleSpec, scenario: (rw: RuleWorld) => Promise<void>, plant: Planting = {}): Promise<void> {
  const rw = await ruleWorld(spec, plant);
  try {
    await scenario(rw);
  } finally {
    await rw.w.close();
  }
}

/**
 * The ask in repo B, where the rule saved for repo A doesn't reach: it reaches you. It shows a commit of its own, so
 * it never shows through an open ask in repo A.
 */
async function inRepoB(rw: RuleWorld, what: string): Promise<string> {
  const b = await rw.w.raise('B1', 'deep_ask.choice', { ...storeAsk(rw.w), pinned_to: { kind: 'commit', ref: commit('repoB') } });
  await reachesYou(rw.w, b, `"${'Keep the store on SQLite or plain files?'}" in repoB, ${what}`);
  return b;
}

/** You confirm the wider match on the ask in repo B, and the rule can't widen: refused, naming it and its state; the ask still reaches you. */
async function cannotWiden(rw: RuleWorld, b: string, state: 'frozen' | 'revoked', what: string): Promise<void> {
  const refused = await rw.w.asks.widen(card, b, rw.rule).then(() => null, (e: unknown) => e);
  expect(refused, `${rw.named} ${what}: your confirmation to widen it to ${b} in repoB is refused`).toBeInstanceOf(Error);
  expect((refused as Error).message, `${rw.named} ${what}: the refusal names the rule and its state`).toMatch(new RegExp(`(${rw.rule}.*\\b${state}\\b)|(\\b${state}\\b.*${rw.rule})`));
  await reachesYou(rw.w, b, `${rw.named} ${what}: ${b} in repoB, after the refused widening`);
}

/** You confirm the wider match on the ask in repo B, and the rule widens: the ask is answered with its option, once. */
async function widens(rw: RuleWorld, b: string, what: string): Promise<void> {
  await rw.w.asks.widen(card, b, rw.rule);
  expect((await rw.w.row(b)).outcome, `${rw.named} ${what}: ${b} in repoB is answered once you confirm the wider match`).not.toBe('unanswered');
  expect(rw.w.deliveries.filter((d) => d.ask === b).map((d) => d.option), `${rw.named} ${what}: ${b} gets the rule's files, once`).toEqual(['files']);
}

// ---- #23.65434b19: the four rules, with a margin of 1.5 and your 60 cases with no breakage.

/** Your bound 4.87% and the limit 7.31%, in every judgment. */
function yoursAndLimit(rw: RuleWorld, j: { yours: number; limit: number }): void {
  expect([pct(j.yours), pct(j.limit)], `${rw.named}: your bound, from 60 cases with no breakage, and the limit at a margin of 1.5`).toEqual(['4.87%', '7.31%']);
}

/** A rule with 40 cases and no breakage can widen: its upper bound 7.22%. */
export const canWiden40 = (judgeWith: Judge = judge) => async (rw: RuleWorld): Promise<void> => {
  const j = judgedIn(rw, await judgeRound(rw.w, judgeWith), NO_BREAKAGE_40);
  expect([j.judgment.verdict, j.state], `${rw.named} can widen: its verdict, and it stays active`).toEqual(['widen', 'active']);
  expect(await stateOf(rw.w, rw.rule), `${rw.named} can widen: its state in the decisions table`).toBe('active');
  yoursAndLimit(rw, j.judgment);
  expect([pct(j.judgment.rule.lower), pct(j.judgment.rule.upper), j.judgment.more], `${rw.named} can widen: its bounds, and nothing more needed`).toEqual(['0.00%', '7.22%', null]);
  await widens(rw, await inRepoB(rw, `before you confirm the wider match of ${rw.rule}`), 'can widen');
};

/** A rule with 39 cases and no breakage can't decide (7.39%), stays frozen and says 1 more case with no breakage would let it widen. */
export const frozen39 = (judgeWith: Judge = judge) => async (rw: RuleWorld): Promise<void> => {
  const since = await lastPos(rw.w);
  const j = judgedIn(rw, await judgeRound(rw.w, judgeWith), NO_BREAKAGE_39);
  await recordedAs(rw, since, { state: 'frozen', verdict: 'undecided', more: 1, cases: 39, broke: 0 }, "can't decide and stays frozen");
  yoursAndLimit(rw, j.judgment);
  expect([j.judgment.verdict, pct(j.judgment.rule.lower), pct(j.judgment.rule.upper), j.judgment.more], `${rw.named} can't decide: its bounds, and 1 more case with no breakage would let it widen`)
    .toEqual(['undecided', '0.00%', '7.39%', 1]);
};

/** A rule with 1 breakage in 40 cases (0.13% to 11.32%) stays frozen and says 24 more cases with no breakage would let it widen. */
export const frozenOneIn40 = (judgeWith: Judge = judge) => async (rw: RuleWorld): Promise<void> => {
  const since = await lastPos(rw.w);
  const j = judgedIn(rw, await judgeRound(rw.w, judgeWith), ONE_IN_40);
  await recordedAs(rw, since, { state: 'frozen', verdict: 'undecided', more: 24, cases: 40, broke: 1 }, 'stays frozen');
  yoursAndLimit(rw, j.judgment);
  expect([j.judgment.verdict, pct(j.judgment.rule.lower), pct(j.judgment.rule.upper), j.judgment.more], `${rw.named} stays frozen: its bounds, and 24 more cases with no breakage would let it widen`)
    .toEqual(['undecided', '0.13%', '11.32%', 24]);
};

/** A rule with 7 breakages in 40 cases (lower bound 8.51%) FAILs and is revoked. */
export const revoked7In40 = (judgeWith: Judge = judge) => async (rw: RuleWorld): Promise<void> => {
  const since = await lastPos(rw.w);
  const j = judgedIn(rw, await judgeRound(rw.w, judgeWith), SEVEN_IN_40);
  await recordedAs(rw, since, { state: 'revoked', verdict: 'FAIL', more: null, cases: 40, broke: 7 }, 'FAILs and is revoked');
  yoursAndLimit(rw, j.judgment);
  expect([j.judgment.verdict, pct(j.judgment.rule.lower), j.judgment.more], `${rw.named} FAILs: its lower bound is above the limit`).toEqual(['FAIL', '8.51%', null]);
};

// ---- #23.b2a26445: frozen keeps deciding at its scope and can't widen; FAIL revokes; each change recorded and shown.

/**
 * The rule with 39 cases and no breakage, frozen: it keeps deciding in repo A, and that answer is the one more case
 * it said it needed; it can't widen to repo B. Judged again, it can widen: the change back to active is recorded,
 * and your confirmation now widens it.
 */
export const frozenKeepsDeciding = (judgeWith: Judge = judge) => async (rw: RuleWorld): Promise<void> => {
  let since = await lastPos(rw.w);
  judgedIn(rw, await judgeRound(rw.w, judgeWith), NO_BREAKAGE_39);
  await recordedAs(rw, since, { state: 'frozen', verdict: 'undecided', more: 1, cases: 39, broke: 0 }, "can't decide and stays frozen");
  await decideAnother(rw, `"${'Keep the store on SQLite or plain files?'}" in repoA, where ${rw.named} is frozen and keeps deciding`);
  const b = await inRepoB(rw, `where ${rw.rule}, frozen, doesn't reach`);
  await cannotWiden(rw, b, 'frozen', 'is frozen and');
  since = await lastPos(rw.w);
  judgedIn(rw, await judgeRound(rw.w, judgeWith), NO_BREAKAGE_40);
  await recordedAs(rw, since, { state: 'active', verdict: 'widen', more: null, cases: 40, broke: 0 }, 'decided one more case with no breakage and can widen');
  await widens(rw, b, 'can widen again');
};

/** The rule with 7 breakages in 40 cases FAILs: revoked, it answers nothing in repo A and can't widen; it stays revoked. */
export const failRevokes = (judgeWith: Judge = judge) => async (rw: RuleWorld): Promise<void> => {
  const since = await lastPos(rw.w);
  judgedIn(rw, await judgeRound(rw.w, judgeWith), SEVEN_IN_40);
  await recordedAs(rw, since, { state: 'revoked', verdict: 'FAIL', more: null, cases: 40, broke: 7 }, 'FAILs and is revoked');
  const a = await rw.w.raise('A1', 'deep_ask.choice', storeAsk(rw.w));
  await reachesYou(rw.w, a, `"${'Keep the store on SQLite or plain files?'}" in repoA, where ${rw.named} is revoked`);
  await cannotWiden(rw, await inRepoB(rw, `where ${rw.rule}, revoked, doesn't reach`), 'revoked', 'is revoked and');
  await judgeRound(rw.w, judgeWith);
  expect(await stateOf(rw.w, rw.rule), `${rw.named}, revoked, stays revoked when it is judged again`).toBe('revoked');
};
