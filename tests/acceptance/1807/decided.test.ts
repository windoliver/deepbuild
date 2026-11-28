import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, decidedDoorsJudge, ID, MINUTE, PLANT, settledJudge } from './helpers.ts';

afterAll(async () => {
  await cleanup();
}, 5 * MINUTE);

let settled: Promise<string[]> | undefined;
const cleanSettled = (): Promise<string[]> => (settled ??= settledJudge());
let doors: Promise<string[]> | undefined;
const cleanDoors = (): Promise<string[]> => (doors ??= decidedDoorsJudge());

describe(`#1807 AC4 ${ID.settled}`, () => {
  it(`${ID.settled} a defaulted ask, a rule's firing and a decision applied for you each show on Decided and never under Needs you`, async () => {
    const failures = await cleanSettled();
    expect(failures, failures.join('\n')).toEqual([]);
  }, 120 * MINUTE);

  it(`${ID.settled} a planted settled row under Needs you (${PLANT.settledUnderNeedsYou}) fails, naming the count`, async () => {
    const before = await cleanSettled();
    expect(before, `the clean run already fails, so the plant can't be told from it: ${before.join('\n')}`).toEqual([]);
    const planted = await settledJudge(PLANT.settledUnderNeedsYou);
    expect(planted.filter((f) => /count reads/.test(f)), `the settled row under Needs you wasn't caught, naming the count: ${planted.join('\n')}`).not.toEqual([]);
  }, 120 * MINUTE);
});

describe(`#1807 AC5 ${ID.page}`, () => {
  it(`${ID.page} Decided is in the View menu and ⌘K, and no list row opens it`, async () => {
    const failures = await cleanDoors();
    expect(failures, failures.join('\n')).toEqual([]);
  }, 120 * MINUTE);

  it(`${ID.page} a planted Decided row in the list (${PLANT.decidedRowInList}) fails, naming it`, async () => {
    const before = await cleanDoors();
    expect(before, `the clean run already fails, so the plant can't be told from it: ${before.join('\n')}`).toEqual([]);
    const planted = await decidedDoorsJudge(PLANT.decidedRowInList);
    expect(planted.filter((f) => /the list holds a Decided row/.test(f)), `the Decided row in the list wasn't caught, naming it: ${planted.join('\n')}`).not.toEqual([]);
  }, 120 * MINUTE);
});
