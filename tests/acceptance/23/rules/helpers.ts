// Test-side tools for the #23 standing-rule tests: a world from match/ (a real record on SQLite in a temporary
// folder, the real asks core on it with a virtual clock, resolver-decisions registered as the hub registers it),
// the evidence a rule is judged on, made through the real path, and one round of judging wired as the hub runs it
// on its timer. Nothing here stands in for the code under test; the wrong programs are in plants.ts.

import { expect } from 'vitest';
import type { Connection, Event } from '../../../../packages/record/src/index.ts';
import type { Judgment, RuleState, Tally } from '../../../../packages/asks/src/index.ts';
import { evidence, judge, type Evidence } from '../../../../packages/resolver-decisions/src/index.ts';
import { choiceAsk, core, DAY, decidedForYou, openWorld, REPO_A, REPO_B, REQ_STORE, ulid, type Obj, type Planting, type World } from '../match/helpers.ts';

export { card, decidedForYou, inWorld, reachesYou, REPO_A, REPO_B, type Planting, type World } from '../match/helpers.ts';

export type Judge = (rule: Tally, yours: Tally, margin: number) => Judgment;

/** Your settings' rules block, as setup drafts it: `rules: { window: 30d, margin: 1.5 }`. */
export const MARGIN = 1.5;
export const WINDOW = 30 * DAY;
/** resolver-decisions' connection, as the extension host proves it. */
export const EXT: Connection = { writer: 'ext:resolver-decisions', actor: 'you', scope: 'you' };

const MINUTE = 60_000;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const dataOf = (e: Event): Obj => (isObj(e.data) ? e.data : {});
const bare = (handle: string): string => handle.replace(/^[a-z_]+:/, '');

export const STORE = 'Keep the store on SQLite or plain files?';
/** The one kind of work in every world: a choice pinned to one requirement, so every ask of it shares one key. */
export const storeAsk = (w: World): Obj => choiceAsk(STORE, REQ_STORE, ['sqlite', 'files'], w.clock.now());
export const later = (w: World, ms = 10 * MINUTE): void => w.clock.set(w.clock.now() + ms);

/** A standing rule as the criterion names it: how many cases it decided, and how many of them later broke. */
export interface RuleSpec { cases: number; broke: number }
export const ruleName = (s: RuleSpec): string => `the rule with ${s.broke === 0 ? 'no breakage' : `${s.broke} breakage${s.broke === 1 ? '' : 's'}`} in ${s.cases} cases`;

export interface RuleWorld {
  w: World;
  /** The rule: the decision saved from your answer in repo A, `decision:<ULID>`. */
  rule: string;
  /** The rule's handle and description, as every failure message names it. */
  named: string;
  /** The asks it decided for you, in order. */
  decided: string[];
}

/**
 * Builds a world for one rule. You decide 60 cases of the work yourself, with no breakage: the first in repo A,
 * which saves the rule for repo A, and one in each of 59 repos of their own. Then the rule decides `cases` asks in
 * repo A, and the first `broke` of them later break, each recorded as the hub's watcher records a revert.
 */
export async function ruleWorld(spec: RuleSpec, plant: Planting = {}): Promise<RuleWorld> {
  const w = await openWorld(plant);
  await w.start('A1', 'TA', REPO_A);
  await w.start('B1', 'TB', REPO_B);
  const first = await w.raise('A1', 'deep_ask.choice', storeAsk(w));
  await w.answer(first, 'files');
  const rule = (await w.decisionOf(first)).decision;
  const named = `${rule} (${ruleName(spec)})`;
  for (let i = 1; i < 60; i++) {
    later(w);
    await w.start(`Y${i}`, `TY${i}`, `repoY${i}`);
    const yours = await w.raise(`Y${i}`, 'deep_ask.choice', storeAsk(w));
    await w.answer(yours, 'files');
  }
  const rw: RuleWorld = { w, rule, named, decided: [] };
  for (let i = 0; i < spec.cases; i++) await decideAnother(rw, `case ${i + 1} of ${named}`);
  for (const ask of rw.decided.slice(0, spec.broke)) await broke(w, ask);
  return rw;
}

/** One more ask in repo A, which the rule decides for you. Returns it. */
export async function decideAnother(rw: RuleWorld, what: string): Promise<string> {
  later(rw.w);
  const ask = await rw.w.raise('A1', 'deep_ask.choice', storeAsk(rw.w));
  expect(await decidedForYou(rw.w, ask, 'files', what), `${what}: decided by ${rw.named}`).toBe(rw.rule);
  rw.decided.push(ask);
  return ask;
}

/** What later broke in the work an ask decided: a revert of its change, as the hub's watcher records it. */
export async function broke(w: World, ask: string): Promise<void> {
  later(w);
  await w.record.append(core('A1'), { v: 1, id: ulid(w.clock.now()), kind: 'work.broke', subject: ask, ts: w.clock.now(), data: { ask, cause: 'revert' } });
}

export interface Judged { evidence: Evidence; judgment: Judgment; state: RuleState }

/**
 * One round of judging, as the hub runs it on its timer: resolver-decisions counts each standing rule's evidence
 * from the record over the window, judges it at the margin in your settings, and the core records the judgment.
 */
export async function judgeRound(w: World, judgeWith: Judge = judge): Promise<Map<string, Judged>> {
  const round = new Map<string, Judged>();
  for (const e of await evidence({ record: w.record, now: w.clock.now(), window: WINDOW })) {
    const judgment = judgeWith(e.rule, e.yours, MARGIN);
    const state = await w.asks.judged(EXT, e.decision, { rule: e.rule, yours: e.yours, margin: MARGIN, judgment });
    round.set(e.decision, { evidence: e, judgment, state });
  }
  return round;
}

/** The rule's state as the decisions table shows it. */
export async function stateOf(w: World, rule: string): Promise<unknown> {
  const row = (await w.record.table('decisions')).rows.find((r) => r.id === bare(rule));
  return row?.state;
}

/** The decision.judged events the core appended for the rule, in log order. */
export async function judgedEvents(w: World, rule: string): Promise<Event[]> {
  return (await w.events('decision.judged')).filter((e) => dataOf(e).decision === rule);
}

/** The rule's entry in a round, which must exist and carry the counts the record holds. */
export function judgedIn(rw: RuleWorld, round: Map<string, Judged>, spec: RuleSpec): Judged {
  const j = round.get(rw.rule);
  expect(j, `${rw.named} is judged: resolver-decisions finds it among the standing rules`).toBeDefined();
  expect(j!.evidence.rule, `${rw.named}: the work it decided, and what later broke, counted from the record`).toEqual({ cases: spec.cases, broke: spec.broke });
  expect(j!.evidence.yours, `${rw.named}: the same kind of work you decided yourself, 60 cases with no breakage`).toEqual({ cases: 60, broke: 0 });
  return j!;
}

/**
 * The rule is in `state`, shown in the decisions table and rebuilt the same from the log, and the change of state
 * this round made (if any) is one decision.judged from the core naming the rule, its new state, its verdict and its
 * counts; `more` is what it says would let it widen.
 */
export async function recordedAs(rw: RuleWorld, since: number, expected: { state: RuleState; verdict: Judgment['verdict']; more: number | null; cases: number; broke: number }, what: string): Promise<void> {
  const { w, rule, named } = rw;
  expect(await stateOf(w, rule), `${named} ${what}: its state in the decisions table`).toBe(expected.state);
  const all = await judgedEvents(w, rule);
  const latest = all.at(-1);
  expect(latest?.writer, `${named} ${what}: its change of state is recorded, by the core, as decision.judged`).toBe('core');
  const d = dataOf(latest!);
  expect({ state: d.state, verdict: d.verdict, more: d.more, rule: isObj(d.rule) ? { cases: d.rule.cases, broke: d.rule.broke } : d.rule, yours: isObj(d.yours) ? { cases: d.yours.cases, broke: d.yours.broke } : d.yours },
    `${named} ${what}: the recorded judgment says its state, its verdict, what would let it widen and the counts behind it`)
    .toEqual({ state: expected.state, verdict: expected.verdict, more: expected.more, rule: { cases: expected.cases, broke: expected.broke }, yours: { cases: 60, broke: 0 } });
  expect(all.filter((e) => e.log_pos > since).length, `${named} ${what}: this round's change of state is recorded`).toBeGreaterThanOrEqual(1);
  await w.record.rebuild();
  expect(await stateOf(w, rule), `${named} ${what}: the decisions table rebuilt from the log shows the same state`).toBe(expected.state);
}

/** The log position of the last event so far: what a round's new events are counted after. */
export async function lastPos(w: World): Promise<number> {
  return (await w.events()).at(-1)?.log_pos ?? 0;
}
