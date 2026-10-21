// The wrong programs the issue names, planted around the real asks core and record (plants.ts): each
// criterion's scenario must fail on its plant, naming what the criterion says it names.

import { expect, test } from 'vitest';
import { askSources } from '../../../packages/asks/src/index.ts';
import { openWorld, type Planting, type World } from './helpers.ts';
import { copiesDecision, fallbackInLiveTable, infersYes, keyedOnSession, lateAllowAnswered, paidGenerationAsChoice } from './plants.ts';
import { foldAcrossClear, lateAllow, pushAnsweredInWords, rebuildFromLog, sourcesTable, supersedeAcrossCompact } from './scenarios.ts';

async function onPlant(plant: Planting, scenario: (w: World) => Promise<void>, named: RegExp): Promise<void> {
  const w = await openWorld(plant);
  try {
    await expect(scenario(w)).rejects.toThrow(named);
  } finally {
    await w.close();
  }
}

test('#318.d249acdc fails on an answer path that infers allow from "yes" in your words', async () => {
  await onPlant(infersYes, pushAnsweredInWords, /answered in words records decision none/);
});

test('#318.d249acdc fails on an answer path that copies decision from the request', async () => {
  await onPlant(copiesDecision, pushAnsweredInWords, /refusal naming .*decision/);
});

test('#318.e4675a8d fails on a catalogue whose ask.created leaves fallback to the live table, naming the ask', async () => {
  await onPlant(fallbackInLiveTable, rebuildFromLog, /rebuilt ask ask:[0-9A-Za-z]+ keeps its fallback/);
});

test('#318.b4c25197 fails on a hub that keys supersede on the session ID, naming the thread', async () => {
  await onPlant(keyedOnSession, supersedeAcrossCompact, /thread T1/);
});

test('#318.b4c25197 fails on a hub that keys the fold on the session ID, naming the thread', async () => {
  await onPlant(keyedOnSession, foldAcrossClear, /thread T2/);
});

test('#318.898ac861 fails on a hub that records the late allow as answered and delivers it, naming the ask', async () => {
  await onPlant(lateAllowAnswered, lateAllow, /ask ask:[0-9A-Za-z]+: the late allow reached the agent/);
});

test('#318.af2a2599 fails on a table that files the paid generation as a choice with an approving default, naming the row', async () => {
  await expect(sourcesTable(paidGenerationAsChoice(askSources()), () => openWorld())).rejects.toThrow(/row generation\.paid/);
});
