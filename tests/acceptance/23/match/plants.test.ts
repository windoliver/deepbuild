// The wrong programs the criteria name, planted around the real program (plants.ts): each criterion's scenario
// must fail on its plant, naming what the criterion says it names.

import { expect, test } from 'vitest';
import { openWorld, type Planting, type World } from './helpers.ts';
import { answersElsewhere, boundsOnly, firstAnswerWins, keyedOnKind, keyedOnNumber, keyedOnText, oldDecisionKept, ownerIgnored, savedForAll, sizeIgnored } from './plants.ts';
import { mergeAnyNumber, mergeCiFile, mergeNotOthers, overruled, savedForRepo, tabsPair, twoResolvers } from './scenarios.ts';

/** Runs the scenario on the plant and returns how it failed; it must fail. */
async function failure(plant: Planting, scenario: (w: World) => Promise<unknown>, options: { resolver?: boolean } = {}): Promise<{ message: string; w: World }> {
  const w = await openWorld(plant, options);
  let error: unknown;
  try {
    await scenario(w);
  } catch (e) {
    error = e;
  }
  expect(error, 'the scenario fails on the wrong program').toBeInstanceOf(Error);
  return { message: (error as Error).message, w };
}
async function onPlant(plant: Planting, scenario: (w: World) => Promise<unknown>, named: RegExp, options: { resolver?: boolean } = {}): Promise<void> {
  const { message, w } = await failure(plant, scenario, options);
  try {
    expect(message).toMatch(named);
  } finally {
    await w.close();
  }
}

const PAIR = /the pair 'Use tabs or spaces here\?' \/ 'Should this file indent with tabs\?' pinned to req:[0-9A-Za-z]+/;

test('#23.2395159c fails on a resolver keyed on the question\'s text, at the first pair, naming the pair', async () => {
  await onPlant(keyedOnText, tabsPair, new RegExp(`${PAIR.source} share one key`));
});

test('#23.2395159c fails on a resolver keyed on kind alone, which answers the second, naming the pair', async () => {
  await onPlant(keyedOnKind, tabsPair, new RegExp(`${PAIR.source}: 'Use tabs or spaces here\\?' pinned to another requirement`));
});

test('#23.cf7a32f5 fails on a resolver keyed on the PR number, naming "Merge #215?"', async () => {
  await onPlant(keyedOnNumber, mergeAnyNumber, /"Merge #215\?", a 30-line fix your thread opened: ask:[0-9A-Z]+ is decided for you/);
});

test('#23.eba26419 fails on a resolver that never reads who opened the PR, which merges the PR thread T2 opened', async () => {
  await onPlant(ownerIgnored, mergeNotOthers, /"Merge #216\?", a 30-line fix thread T2 opened, asked in thread T1: ask:[0-9A-Z]+ reaches you, not decided for you by \[decision:/);
});

test('#23.eba26419 fails on a resolver that never reads a change\'s size, which merges the 4,000-line fix', async () => {
  await onPlant(sizeIgnored, mergeNotOthers, /"Merge #217\?", a 4,000-line fix past the size bound: ask:[0-9A-Z]+ reaches you, not decided for you by \[decision:/);
});

test('#23.b439b4e7 fails on a resolver that applies the decision\'s size and kind bounds alone, which merges the PR that changes .github/workflows/release.yml', async () => {
  await onPlant(boundsOnly, mergeCiFile, /plus one changed line in \.github\/workflows\/release\.yml: ask:[0-9A-Z]+ reaches you, not decided for you by \[decision:/);
});

test('#23.6ab3f608 fails on a resolver that keeps answering from the old decision in repo A, naming that decision', async () => {
  const { message, w } = await failure(oldDecisionKept, overruled);
  try {
    const old = (await w.events('decision.created')).find((e) => (e.data as { scope?: string }).scope === 'all');
    expect(old, 'the old decision, saved for all your repos, is in the record').toBeDefined();
    expect(message).toMatch(/the next "Read secrets from a \.env file or the keychain\?" in repoA/);
    expect(message, 'the failure names the old decision').toContain(`decision:${old!.id}`);
  } finally {
    await w.close();
  }
});

test('#23.d5c718b3 fails on a program that answers in another repo without your confirmation, naming the decision', async () => {
  await onPlant(savedForAll, savedForRepo, /decision:[0-9A-Z]+, your answer to ask:[0-9A-Z]+, is saved for its repo/);
});

test('#23.d5c718b3 fails on a resolver that answers the same question in another repo without your confirmation, naming the decision', async () => {
  await onPlant(answersElsewhere, savedForRepo, /in repoB, before you confirm the wider scope of (decision:[0-9A-Z]+): ask:[0-9A-Z]+ reaches you, not decided for you by \[\1\]/);
});

test('#23.86908fce fails on a core that takes the first resolver\'s answer, which applies it', async () => {
  await onPlant(firstAnswerWins, twoResolvers, /resolver-one answers prettier from decision:[0-9A-Z]+ and resolver-two answers dprint from decision:[0-9A-Z]+: ask:[0-9A-Z]+ reaches you, not decided for you by \[decision:/, { resolver: false });
});
