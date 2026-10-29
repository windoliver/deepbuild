// Each criterion's scenario, shared by the criterion tests and plants.test.ts: the same steps must pass on the
// real program and fail on each wrong program, naming what the criterion says it names.

import { expect } from 'vitest';
import type { Resolver } from '../../../../packages/asks/src/index.ts';
import {
  card, choiceAsk, commit, decidedForYou, definitionAsk, FEATURE_30, FIX_30, FIX_30_PLUS_CI, FIX_40, FIX_HUGE, HOUR, mergeAsk, POINT_OFFLINE, POINT_OFFLINE_OTHER,
  reachesYou, REPO_A, REPO_B, REPO_C, repoScope, REQ_FORMAT, REQ_INDENT, REQ_INDENT_OTHER, REQ_LOCKFILE, REQ_SECRETS, REQ_STORE,
  tasteAsk, type Obj, type World,
} from './helpers.ts';

const later = (w: World, ms = HOUR): void => w.clock.set(w.clock.now() + ms);
const STORE = 'Keep the store on SQLite or plain files?';

/** #23.9d16cbb5 and #23.6477f693: a question you answered once is answered for you when it comes again. */
export async function repeated(w: World): Promise<{ asks: string[]; decision: string }> {
  await w.start('S1', 'T1', REPO_A);
  await w.start('S2', 'T2', REPO_A);
  const first = await w.raise('S1', 'deep_ask.choice', choiceAsk(STORE, REQ_STORE, ['sqlite', 'files'], w.clock.now()));
  expect(await w.shown(), `the first time "${STORE}" is asked, ${first} reaches you`).toContain(first);
  await w.answer(first, 'files');
  const saved = await w.decisionOf(first);
  later(w);
  const again = await w.raise('S2', 'deep_ask.choice', choiceAsk(STORE, REQ_STORE, ['sqlite', 'files'], w.clock.now()));
  const cited = await decidedForYou(w, again, 'files', `"${STORE}" asked again in another session of ${REPO_A}`);
  expect(cited, `the repeated question ${again} is answered from ${saved.decision}, saved from your answer`).toBe(saved.decision);
  later(w, 24 * HOUR);
  const third = await w.raise('S1', 'deep_ask.choice', choiceAsk(STORE, REQ_STORE, ['sqlite', 'files'], w.clock.now()));
  expect(await decidedForYou(w, third, 'files', `"${STORE}" asked a third time, a day later, in the first session`)).toBe(saved.decision);
  return { asks: [again, third], decision: saved.decision };
}

/** #23.6b5caf42: another scope, or another kind, reaches you with the nearest decision suggested, never applied. */
export async function nearestSuggested(w: World): Promise<void> {
  await w.start('S1', 'T1', REPO_A);
  await w.start('S3', 'T3', REPO_B);
  // A taste decision too: of another ask kind, it is never the nearest for a merge.
  const taste = await w.raise('S1', 'deep_ask.taste', tasteAsk('Which header colour?', 'screen:checkout', 'header', commit('checkout'), w.clock.now()));
  await w.answer(taste, 'green');
  const m212 = await w.raise('S1', 'effect.merge', mergeAsk(212, 'T1', FIX_40, w.clock.now()));
  await w.answer(m212, 'merge');
  const merge = await w.decisionOf(m212);
  later(w);
  const otherRepo = await w.raise('S3', 'effect.merge', mergeAsk(301, 'T3', FIX_30, w.clock.now()));
  const scoped = await reachesYou(w, otherRepo, `"Merge #301?" for a fix in ${REPO_B}, a scope ${merge.decision} doesn't cover`);
  expect(scoped.suggested, `the card of ${otherRepo} suggests the nearest decision, ${merge.decision}, saved for ${REPO_A}`)
    .toEqual({ decision: merge.decision, answer: 'merge', scope: repoScope(REPO_A) });
  const otherKind = await w.raise('S1', 'effect.merge', mergeAsk(302, 'T1', FEATURE_30, w.clock.now()));
  const kind = await reachesYou(w, otherKind, `"Merge #302?" for a feature, a kind of change ${merge.decision} doesn't cover`);
  expect(kind.suggested?.decision, `the card of ${otherKind} suggests the nearest decision, ${merge.decision}`).toBe(merge.decision);
}

/** The decision a fix PR your thread opened is merged under: saved from your yes to "Merge #212?", a 40-line fix. */
async function mergeOwnFixes(w: World): Promise<string> {
  await w.start('S1', 'T1', REPO_A);
  await w.start('S2', 'T2', REPO_A);
  const m212 = await w.raise('S1', 'effect.merge', mergeAsk(212, 'T1', FIX_40, w.clock.now()));
  expect(await w.shown(), `the first merge question, ${m212}, reaches you`).toContain(m212);
  await w.answer(m212, 'merge');
  later(w);
  return (await w.decisionOf(m212)).decision;
}

/** #23.cf7a32f5: "Merge #215?" is answered by the decision that covers your own fix PRs, whatever the number. */
export async function mergeAnyNumber(w: World): Promise<void> {
  const decision = await mergeOwnFixes(w);
  const m215 = await w.raise('S1', 'effect.merge', mergeAsk(215, 'T1', FIX_30, w.clock.now()));
  expect(await decidedForYou(w, m215, 'merge', '"Merge #215?", a 30-line fix your thread opened')).toBe(decision);
  later(w);
  const m9001 = await w.raise('S1', 'effect.merge', mergeAsk(9001, 'T1', { kind: 'fix', lines: 12, paths: ['src/api/retry.ts'] }, w.clock.now()));
  expect(await decidedForYou(w, m9001, 'merge', '"Merge #9001?", a 12-line fix your thread opened')).toBe(decision);
}

/** #23.eba26419: never a PR another thread opened, nor one past the decision's size or kind; each reaches you. */
export async function mergeNotOthers(w: World): Promise<void> {
  const decision = await mergeOwnFixes(w);
  const own = await w.raise('S1', 'effect.merge', mergeAsk(215, 'T1', FIX_30, w.clock.now()));
  expect(await decidedForYou(w, own, 'merge', '"Merge #215?", a 30-line fix your thread opened'), `${decision} covers your own fix PRs`).toBe(decision);
  const theirs = await w.raise('S1', 'effect.merge', mergeAsk(216, 'T2', FIX_30, w.clock.now()));
  await reachesYou(w, theirs, '"Merge #216?", a 30-line fix thread T2 opened, asked in thread T1');
  const huge = await w.raise('S1', 'effect.merge', mergeAsk(217, 'T1', FIX_HUGE, w.clock.now()));
  await reachesYou(w, huge, '"Merge #217?", a 4,000-line fix past the size bound');
  const feature = await w.raise('S1', 'effect.merge', mergeAsk(218, 'T1', FEATURE_30, w.clock.now()));
  await reachesYou(w, feature, '"Merge #218?", a feature, past the kind bound');
}

/** #23.b439b4e7: the 30-line fix merges; the same fix plus one line in a CI workflow reaches you, naming the file. */
export async function mergeCiFile(w: World): Promise<void> {
  const decision = await mergeOwnFixes(w);
  const fix = await w.raise('S1', 'effect.merge', mergeAsk(215, 'T1', FIX_30, w.clock.now()));
  expect(await decidedForYou(w, fix, 'merge', '"Merge #215?" for a 30-line fix')).toBe(decision);
  later(w);
  const withCi = await w.raise('S1', 'effect.merge', mergeAsk(215, 'T1', FIX_30_PLUS_CI, w.clock.now()));
  const shown = await reachesYou(w, withCi, '"Merge #215?" for the same fix plus one changed line in .github/workflows/release.yml');
  expect(shown.needs_person, `the card of ${withCi} names the CI workflow file that needs you`).toEqual(['.github/workflows/release.yml']);
}

const TABS_A = 'Use tabs or spaces here?';
const TABS_B = 'Should this file indent with tabs?';
const PAIR = `the pair '${TABS_A}' / '${TABS_B}' pinned to ${REQ_INDENT}`;
/** #23.2395159c: two wordings pinned to one requirement share a key; the same wording on another requirement doesn't. */
export async function tabsPair(w: World): Promise<void> {
  await w.start('S1', 'T1', REPO_A);
  const a = await w.raise('S1', 'deep_ask.choice', choiceAsk(TABS_A, REQ_INDENT, ['tabs', 'spaces'], w.clock.now()));
  await w.answer(a, 'tabs');
  later(w);
  const b = await w.raise('S1', 'deep_ask.choice', choiceAsk(TABS_B, REQ_INDENT, ['tabs', 'spaces'], w.clock.now()));
  expect(await w.keyOf(b), `${PAIR} share one key`).toBe(await w.keyOf(a));
  await decidedForYou(w, b, 'tabs', `${PAIR}: the second`);
  later(w);
  const c = await w.raise('S1', 'deep_ask.choice', choiceAsk(TABS_A, REQ_INDENT_OTHER, ['tabs', 'spaces'], w.clock.now()));
  expect(await w.keyOf(c), `${PAIR}: '${TABS_A}' pinned to another requirement, ${REQ_INDENT_OTHER}, has a key of its own`).not.toBe(await w.keyOf(a));
  await reachesYou(w, c, `${PAIR}: '${TABS_A}' pinned to another requirement, ${REQ_INDENT_OTHER}`);
}

const HEADER = 'Which header colour?';
/** #23.6d3abd93: one card for the same taste question on one screen; two cards for two commits; an open match closes. */
export async function sameScreen(w: World): Promise<void> {
  for (const [s, t] of [['S1', 'T1'], ['S2', 'T2'], ['S3', 'T3'], ['S4', 'T4']] as const) await w.start(s, t, REPO_A);
  const pin = commit('checkout v1');
  const h1 = await w.raise('S1', 'deep_ask.taste', tasteAsk(HEADER, 'screen:checkout', 'header', pin, w.clock.now()));
  const h2 = await w.raise('S2', 'deep_ask.taste', tasteAsk(HEADER, 'screen:checkout', 'header', pin, w.clock.now()));
  const cards = (await w.shown()).filter((h) => h === h1 || h === h2);
  expect(cards, `sessions S1 and S2 raise "${HEADER}" on screen:checkout pinned to one commit: Needs you shows one card (${h1}, ${h2})`).toHaveLength(1);
  await w.answer(cards[0]!, 'green');
  for (const session of ['S1', 'S2']) {
    expect(w.deliveries.filter((d) => d.session === session).map((d) => d.option), `your answer reaches session ${session}, once`).toEqual(['green']);
  }
  later(w);
  const c2 = await w.raise('S3', 'deep_ask.taste', tasteAsk(HEADER, 'screen:cart', 'header', commit('cart v1'), w.clock.now()));
  const c3 = await w.raise('S4', 'deep_ask.taste', tasteAsk(HEADER, 'screen:cart', 'header', commit('cart v2'), w.clock.now()));
  const shown = await w.shown();
  expect([c2 !== c3, shown.includes(c2), shown.includes(c3)], `"${HEADER}" on screen:cart pinned to two commits shows as two cards (${c2}, ${c3})`).toEqual([true, true, true]);
  await w.answer(c2, 'blue');
  const saved = await w.decisionOf(c2);
  expect(await decidedForYou(w, c3, 'blue', `${c3}, open when you saved your answer to ${c2}, which matches it by kind and scope`, 'open before'),
    `${c3} closes citing ${saved.decision}`).toBe(saved.decision);
}

const FORMAT = 'Format with Prettier or dprint?';
const format = (w: World): Obj => choiceAsk(FORMAT, REQ_FORMAT, ['prettier', 'dprint'], w.clock.now());
/**
 * Two active decisions of one kind that disagree on repo A: D1, your prettier saved for repo A, and D2, your dprint
 * saved for all your repos from repo B. Returns both, and the key.
 */
async function disagreeing(w: World): Promise<{ d1: string; d2: string; key: string }> {
  for (const [s, t, r] of [['A1', 'T1', REPO_A], ['B1', 'T2', REPO_B], ['A2', 'T3', REPO_A], ['A3', 'T4', REPO_A], ['C1', 'T5', REPO_C]] as const) await w.start(s, t, r);
  const a1 = await w.raise('A1', 'deep_ask.choice', format(w));
  await w.answer(a1, 'prettier');
  const d1 = await w.decisionOf(a1);
  expect(d1.scope, `your answer to ${a1} is saved for ${REPO_A}`).toBe(repoScope(REPO_A));
  later(w);
  const b1 = await w.raise('B1', 'deep_ask.choice', format(w));
  await w.answer(b1, 'dprint');
  const d2 = await w.asks.saveDecision(card, b1, 'all');
  later(w);
  return { d1: d1.decision, d2, key: d1.key };
}

/** #23.86908fce, two decisions: the ask reaches you showing both; your answer there overrules the other there only. */
export async function twoDecisions(w: World): Promise<void> {
  const { d1, d2 } = await disagreeing(w);
  const a2 = await w.raise('A2', 'deep_ask.choice', format(w));
  const shown = await reachesYou(w, a2, `${a2} in ${REPO_A}, where ${d1} (prettier) and ${d2} (dprint) both match`);
  expect(shown.conflict.map((c) => [c.decision, c.answer]).sort(), `the card of ${a2} shows both decisions`).toEqual([[d1, 'prettier'], [d2, 'dprint']].sort());
  await w.answer(a2, 'prettier');
  const yours = await w.decisionOf(a2);
  expect(yours.scope, `your answer to ${a2} is saved at that ask's scope, ${REPO_A}`).toBe(repoScope(REPO_A));
  later(w);
  const a3 = await w.raise('A3', 'deep_ask.choice', format(w));
  const cited = await decidedForYou(w, a3, 'prettier', `the next "${FORMAT}" in ${REPO_A}, after your answer to ${a2}`);
  expect([yours.decision, d1], `${a3} is answered by your answer at that scope, not ${d2}`).toContain(cited);
  const c1 = await w.raise('C1', 'deep_ask.choice', format(w));
  expect(await decidedForYou(w, c1, 'dprint', `"${FORMAT}" in ${REPO_C}, outside ${REPO_A}`), `${d2} still answers outside ${REPO_A}`).toBe(d2);
}

/** #23.86908fce, two resolvers: each names a decision that covers the ask, and they disagree: nothing is applied. */
export async function twoResolvers(w: World): Promise<void> {
  const { d1, d2, key } = await disagreeing(w);
  const one: Resolver = (ask) => (ask.key === key ? { answer: 'prettier', because: d1 } : undefined);
  const two: Resolver = (ask) => (ask.key === key ? { answer: 'dprint', because: d2 } : undefined);
  w.asks.registerResolver('resolver-one', one);
  w.asks.registerResolver('resolver-two', two);
  const a2 = await w.raise('A2', 'deep_ask.choice', format(w));
  const shown = await reachesYou(w, a2, `${a2}, which resolver-one answers prettier from ${d1} and resolver-two answers dprint from ${d2}`);
  expect(shown.conflict.map((c) => [c.resolver, c.decision, c.answer]).sort(), `the card of ${a2} shows both resolvers' answers`)
    .toEqual([['resolver-one', d1, 'prettier'], ['resolver-two', d2, 'dprint']].sort());
}

const LOCK = 'Pin every dependency to an exact version? Save my answer for all my repos, not only this one.';
/** #23.d5c718b3: saved for its repo; another repo gets it suggested and answered only once you confirm the wider scope. */
export async function savedForRepo(w: World): Promise<void> {
  for (const [s, t, r] of [['A1', 'T1', REPO_A], ['B1', 'T2', REPO_B], ['C1', 'T3', REPO_C]] as const) await w.start(s, t, r);
  const x = await w.raise('A1', 'deep_ask.choice', choiceAsk(STORE, REQ_STORE, ['sqlite', 'files'], w.clock.now()));
  await w.answer(x, 'files');
  const saved = await w.decisionOf(x);
  expect(saved.scope, `${saved.decision}, your answer to ${x}, is saved for its repo`).toBe(repoScope(REPO_A));
  // The agent's own words claim a wider scope, in the question and in each option's label.
  const claim = { ...choiceAsk(LOCK, REQ_LOCKFILE, ['exact', 'ranges'], w.clock.now()), options: [
    { id: 'exact', label: 'Exact versions, in all my repos', decision: 'none' }, { id: 'ranges', label: 'Ranges, in all my repos', decision: 'none' }] };
  const lock = await w.raise('A1', 'deep_ask.choice', claim);
  await w.answer(lock, 'exact');
  const locked = await w.decisionOf(lock);
  expect(locked.scope, `${locked.decision}, your answer to ${lock}, whose agent-written text claims all your repos, is saved for its repo`).toBe(repoScope(REPO_A));
  later(w);
  const y = await w.raise('B1', 'deep_ask.choice', choiceAsk(STORE, REQ_STORE, ['sqlite', 'files'], w.clock.now()));
  const suggested = await reachesYou(w, y, `"${STORE}" in ${REPO_B}, before you confirm the wider scope of ${saved.decision}`);
  expect(suggested.suggested, `the card of ${y} suggests ${saved.decision}`).toEqual({ decision: saved.decision, answer: 'files', scope: repoScope(REPO_A) });
  const lockB = await w.raise('B1', 'deep_ask.choice', { ...claim, deadline: w.clock.now() + 48 * HOUR });
  await reachesYou(w, lockB, `"${LOCK}" in ${REPO_B}: ${locked.decision} was saved for ${REPO_A} whatever its text claimed`);
  await w.asks.widen(card, y, saved.decision);
  expect((await w.row(y)).outcome, `${y} is answered once you confirm the wider scope`).not.toBe('unanswered');
  expect(w.deliveries.filter((d) => d.ask === y).map((d) => d.option), `${y} is answered with ${saved.decision}'s files, once`).toEqual(['files']);
  later(w);
  const z = await w.raise('C1', 'deep_ask.choice', choiceAsk(STORE, REQ_STORE, ['sqlite', 'files'], w.clock.now()));
  const cited = await decidedForYou(w, z, 'files', `"${STORE}" in ${REPO_C}, after you confirmed the wider scope`);
  const widened = (await w.events('decision.created')).find((e) => `decision:${e.id}` === cited);
  expect(cited === saved.decision || (widened !== undefined && (widened.data as Obj).answer === 'files' && (widened.data as Obj).key === saved.key),
    `${z} cites ${saved.decision}, or the decision your confirmation widened it to (${cited})`).toBe(true);
}

const SECRETS = 'Read secrets from a .env file or the keychain?';
const secrets = (w: World): Obj => choiceAsk(SECRETS, REQ_SECRETS, ['dotenv', 'keychain'], w.clock.now());
/** #23.6ab3f608: you overrule an automatic answer in repo A; your answer holds there, the old decision elsewhere. */
export async function overruled(w: World): Promise<{ old: string }> {
  for (const [s, t, r] of [['B1', 'T1', REPO_B], ['A1', 'T2', REPO_A], ['A2', 'T3', REPO_A], ['C1', 'T4', REPO_C]] as const) await w.start(s, t, r);
  const x1 = await w.raise('B1', 'deep_ask.choice', secrets(w));
  await w.answer(x1, 'dotenv');
  const old = await w.asks.saveDecision(card, x1, 'all');
  later(w);
  const x2 = await w.raise('A1', 'deep_ask.choice', secrets(w));
  expect(await decidedForYou(w, x2, 'dotenv', `"${SECRETS}" in ${REPO_A}, covered by ${old}`)).toBe(old);
  const yours = await w.asks.overrule(card, x2, { option: 'keychain' });
  expect(yours, 'your overrule is saved as a decision: its handle').toMatch(/^decision:[0-9A-Za-z]+$/);
  const saved = (await w.events('decision.created')).find((e) => `decision:${e.id}` === yours);
  expect(saved?.data, `${yours} is your keychain, saved at ${x2}'s scope, ${REPO_A}`).toMatchObject({ scope: repoScope(REPO_A), answer: 'keychain' });
  later(w);
  const x3 = await w.raise('A2', 'deep_ask.choice', secrets(w));
  expect(await decidedForYou(w, x3, 'keychain', `the next "${SECRETS}" in ${REPO_A}, after you overruled ${old} on ${x2}`),
    `the next ask in ${REPO_A} is answered by your overrule, ${yours}, not ${old}`).toBe(yours);
  const x4 = await w.raise('C1', 'deep_ask.choice', secrets(w));
  expect(await decidedForYou(w, x4, 'dotenv', `"${SECRETS}" in ${REPO_C}, which ${old} still covers`), `${old} still answers in ${REPO_C}`).toBe(old);
  return { old };
}

// ---- Key pairs: an ask a decision is saved from, and an ask that must, or must not, be decided by it.

export type PairKind = 'authority' | 'taste' | 'choice' | 'definition';
export interface PairAsk { question: string; options: string[]; subject: Obj }
/** One entry of a key fixture: `same` says whether b must share a's key and be decided by a's decision. */
export interface KeyPair { kind: PairKind; same: boolean; why: string; a: PairAsk; b: PairAsk }

const SOURCES: Readonly<Record<string, string>> = { taste: 'deep_ask.taste', choice: 'deep_ask.choice', definition: 'definition.draft' };
/** The ask of a pair, raised the n-th time: each raise shows a commit of its own, so none joins another by what it shows. */
function pairAsk(w: World, kind: PairKind, ask: PairAsk, n: number): { source: string; data: Obj } {
  const now = w.clock.now();
  const pinned_to = { kind: 'commit', ref: commit(`pair ${n}`) };
  if (kind === 'authority') {
    const data = { ...mergeAsk(1, 'T1', FIX_30, now, ask.question),
      options: ask.options.map((id, i) => ({ id, label: id, decision: i === 0 ? 'allow' : 'deny' })), default: ask.options.at(-1), subject: ask.subject, pinned_to };
    return { source: `effect.${String(ask.subject.effect)}`, data };
  }
  const base = kind === 'taste' ? tasteAsk(ask.question, 'screen', 'element', commit(`pair ${n}`), now, ask.options)
    : kind === 'definition' ? definitionAsk(ask.question, 'point', ask.options, now) : choiceAsk(ask.question, 'point', ask.options, now);
  return { source: SOURCES[kind]!, data: { ...base, subject: ask.subject, pinned_to } };
}
/**
 * Runs one pair in thread T1 of repo A (thread T2 is another thread there): a is raised and answered with its
 * first option, then b is raised. b shares a's key, and is decided for you by a's decision, exactly when `same`.
 */
export async function runPair(w: World, pair: KeyPair): Promise<void> {
  await w.start('S1', 'T1', REPO_A);
  await w.start('S2', 'T2', REPO_A);
  const named = `${pair.kind} pair (${pair.why}): '${pair.a.question}' / '${pair.b.question}'`;
  const a = pairAsk(w, pair.kind, pair.a, 1);
  const first = await w.raise('S1', a.source, a.data);
  await w.answer(first, pair.a.options[0]!);
  later(w);
  const b = pairAsk(w, pair.kind, pair.b, 2);
  const second = await w.raise('S1', b.source, b.data);
  const [ka, kb] = [await w.keyOf(first), await w.keyOf(second)];
  if (pair.same) {
    expect(kb, `${named} share one key`).toBe(ka);
    await decidedForYou(w, second, pair.a.options[0]!, `${named}: the second`);
  } else {
    expect(kb, `${named} have different keys`).not.toBe(ka);
    await reachesYou(w, second, `${named}: the second`);
    // The near-miss reached you while a's own question is still answered for you: the resolver is at work here.
    later(w);
    const twin = pairAsk(w, pair.kind, pair.a, 3);
    await decidedForYou(w, await w.raise('S1', twin.source, twin.data), pair.a.options[0]!, `${named}: '${pair.a.question}' asked again`);
  }
}

/** The design's examples of pairs that share a key and near-misses that don't, written from the design alone. */
export const BLIND_PAIRS: KeyPair[] = [
  { kind: 'authority', same: true, why: 'another PR number',
    a: { question: 'Merge #212?', options: ['merge', 'hold'], subject: { effect: 'merge', target: { kind: 'pr', ref: 'pr:212', owner: 'thread:T1' }, change: FIX_40 } },
    b: { question: 'Merge #215?', options: ['merge', 'hold'], subject: { effect: 'merge', target: { kind: 'pr', ref: 'pr:215', owner: 'thread:T1' }, change: FIX_30 } } },
  { kind: 'authority', same: true, why: 'a paraphrase',
    a: { question: 'Merge #212?', options: ['merge', 'hold'], subject: { effect: 'merge', target: { kind: 'pr', ref: 'pr:212', owner: 'thread:T1' }, change: FIX_40 } },
    b: { question: 'OK to land PR 212 on main now?', options: ['merge', 'hold'], subject: { effect: 'merge', target: { kind: 'pr', ref: 'pr:212', owner: 'thread:T1' }, change: FIX_40 } } },
  { kind: 'authority', same: false, why: 'another owner',
    a: { question: 'Merge #212?', options: ['merge', 'hold'], subject: { effect: 'merge', target: { kind: 'pr', ref: 'pr:212', owner: 'thread:T1' }, change: FIX_40 } },
    b: { question: 'Merge #213?', options: ['merge', 'hold'], subject: { effect: 'merge', target: { kind: 'pr', ref: 'pr:213', owner: 'thread:T2' }, change: FIX_30 } } },
  { kind: 'authority', same: false, why: 'another effect class',
    a: { question: 'Merge #212?', options: ['merge', 'hold'], subject: { effect: 'merge', target: { kind: 'pr', ref: 'pr:212', owner: 'thread:T1' }, change: FIX_40 } },
    b: { question: 'Push fix/cart-sum to origin?', options: ['merge', 'hold'], subject: { effect: 'push', target: { kind: 'branch', ref: 'branch:fix/cart-sum', owner: 'thread:T1' }, change: FIX_30 } } },
  { kind: 'taste', same: true, why: 'a paraphrase',
    a: { question: 'Which header colour?', options: ['blue', 'green'], subject: { screen: 'screen:checkout', element: 'header' } },
    b: { question: 'What colour should the checkout header be?', options: ['blue', 'green'], subject: { screen: 'screen:checkout', element: 'header' } } },
  { kind: 'taste', same: false, why: 'another screen',
    a: { question: 'Which header colour?', options: ['blue', 'green'], subject: { screen: 'screen:checkout', element: 'header' } },
    b: { question: 'Which header colour?', options: ['blue', 'green'], subject: { screen: 'screen:settings', element: 'header' } } },
  { kind: 'taste', same: false, why: 'another element',
    a: { question: 'Which header colour?', options: ['blue', 'green'], subject: { screen: 'screen:checkout', element: 'header' } },
    b: { question: 'Which footer colour?', options: ['blue', 'green'], subject: { screen: 'screen:checkout', element: 'footer' } } },
  { kind: 'choice', same: true, why: 'a paraphrase',
    a: { question: 'Keep the store on SQLite or plain files?', options: ['sqlite', 'files'], subject: { point: REQ_STORE } },
    b: { question: 'Should the store be plain files rather than SQLite?', options: ['sqlite', 'files'], subject: { point: REQ_STORE } } },
  { kind: 'choice', same: false, why: 'one option changed',
    a: { question: 'Keep the store on SQLite or plain files?', options: ['sqlite', 'files'], subject: { point: REQ_STORE } },
    b: { question: 'Keep the store on SQLite or plain files?', options: ['sqlite', 'postgres'], subject: { point: REQ_STORE } } },
  { kind: 'choice', same: false, why: 'another requirement',
    a: { question: 'Keep the store on SQLite or plain files?', options: ['sqlite', 'files'], subject: { point: REQ_STORE } },
    b: { question: 'Keep the store on SQLite or plain files?', options: ['sqlite', 'files'], subject: { point: REQ_LOCKFILE } } },
  { kind: 'definition', same: true, why: 'a paraphrase',
    a: { question: 'Should done include the offline mode?', options: ['keep', 'drop'], subject: { point: POINT_OFFLINE } },
    b: { question: 'Is offline mode part of done for this task?', options: ['keep', 'drop'], subject: { point: POINT_OFFLINE } } },
  { kind: 'definition', same: false, why: 'another decision point',
    a: { question: 'Should done include the offline mode?', options: ['keep', 'drop'], subject: { point: POINT_OFFLINE } },
    b: { question: 'Should done include the offline mode?', options: ['keep', 'drop'], subject: { point: POINT_OFFLINE_OTHER } } },
];
