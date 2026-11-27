// AC1: a planted term listed twice fails, naming it; a planted term with no sentence fails, naming it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TERM, plantedRun, summary } from './helpers.mjs';

const ID = '#3412.5946d19d';

test(`${ID} AC1: a planted term listed twice fails, naming it`, { timeout: 1_200_000 }, async (t) => {
  const once = `**${TERM}**:\nA fixture term the acceptance tests of this task plant.`;
  const { lane, named } = await plantedRun(t, [once, `**${TERM}**:\nThe same fixture term, listed a second time.`], 'change: a term listed twice');
  assert.ok(!lane.missing, lane.missing);
  assert.ok(named.length, `no failing lint lane command names "${TERM}", listed twice\n${summary(lane)}`);
});

test(`${ID} AC1: a planted term with no sentence fails, naming it`, { timeout: 1_200_000 }, async (t) => {
  const { lane, named } = await plantedRun(t, [`**${TERM}**:\n_Avoid_: tallybook`], 'change: a term with no sentence');
  assert.ok(!lane.missing, lane.missing);
  assert.ok(named.length, `no failing lint lane command names "${TERM}", which has no sentence\n${summary(lane)}`);
});
