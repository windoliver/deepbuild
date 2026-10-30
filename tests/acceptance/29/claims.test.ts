// #29 AC1: each claim source creates exactly one claim per open ask it touched.
import { describe, expect, it } from 'vitest';
import { claimsFor } from '../../../packages/gate/src/index.ts';
import type { ClaimIntake, ClaimSource } from '../../../packages/gate/src/index.ts';
import { mustFail } from './helpers.ts';

const A = 'task:01K74FX2B4D6F8H0K2M4P6R8T0';
const B = 'task:01K74FX2B4D6F8H0K2M4P6R8T1';
const C = 'task:01K74FX2B4D6F8H0K2M4P6R8T2';
const intake = (source: ClaimSource, o: Partial<ClaimIntake> = {}): ClaimIntake => ({
  source, session: 'session:01K74FQ8S1T2V3W4X5Y6Z7A8B9', commit: 'a'.repeat(40),
  asks: [{ task_ref: A, touched: true }, { task_ref: B, touched: true }, { task_ref: C, touched: false }],
  turn: { work: true, answer: false, last_message: 'Done.' }, ...o,
});
type Plant = NonNullable<NonNullable<Parameters<typeof claimsFor>[1]>['plant']>;
const refs = (i: ClaimIntake, plant?: Plant) => claimsFor(i, plant ? { plant } : undefined);

/** The assertion every source must hold: one claim for each touched ask, none for the untouched one. */
function onePerTouched(source: ClaimSource, plant?: Parameters<typeof refs>[1]): void {
  const made = refs(intake(source), plant);
  const got = made.map((c) => c.task_ref).sort();
  expect(got, `${source}: one claim for each of the two touched asks and none for the untouched ${C}`).toEqual([A, B]);
  for (const c of made) {
    expect(c.source).toBe(source);
    expect(c.commit).toBe('a'.repeat(40));
    expect(c.claim).toMatch(/^claim:/);
  }
  expect(new Set(made.map((c) => c.claim)).size, 'each claim has its own ID').toBe(made.length);
}

describe('AC1 each claim source creates exactly one claim per open ask it touched', () => {
  for (const source of ['stop', 'deep_claim', 'gh_pr_create'] as const) {
    it(`AC1 ${source}: one claim per touched ask`, () => onePerTouched(source));
  }
  it('AC1 deep_claim names its tasks: one claim for each task named, even one the turn did not touch', () => {
    const made = claimsFor(intake('deep_claim', { named: [C] }));
    expect(made.map((c) => c.task_ref)).toEqual([C]);
  });
  it('AC1 a stop with no work since the turn began makes no claim, whatever its last message says', () => {
    for (const last_message of ['Done.', 'All finished, the work is complete', 'still working']) {
      expect(claimsFor(intake('stop', { turn: { work: false, answer: false, last_message } })), last_message).toEqual([]);
    }
  });
  it('AC1 an answer makes no claim, even with work in its turn', () => {
    expect(claimsFor(intake('stop', { turn: { work: true, answer: true } }))).toEqual([]);
    expect(claimsFor(intake('stop', { turn: { work: false, answer: true, last_message: 'Done.' } }))).toEqual([]);
  });
  it('AC1 words alone never trigger a claim, and a stop with work claims whatever its words say', () => {
    expect(claimsFor(intake('stop', { turn: { work: false, answer: false, last_message: 'I am done, please merge' } }))).toEqual([]);
    expect(claimsFor(intake('stop', { turn: { work: true, answer: false, last_message: 'still working on it' } })).map((c) => c.task_ref).sort()).toEqual([A, B]);
  });
  it('AC1 no open ask touched: no claim', () => {
    expect(claimsFor(intake('stop', { asks: [{ task_ref: A, touched: false }] }))).toEqual([]);
    expect(claimsFor(intake('stop', { asks: [] }))).toEqual([]);
  });
  it('AC1 planted programs fail: claims every open ask, claims on words, claims on answers, two per ask', async () => {
    await mustFail('claims-every-open-ask', () => onePerTouched('stop', 'claims-every-open-ask'), [C]);
    await mustFail('two-per-ask', () => onePerTouched('deep_claim', 'two-per-ask'));
    await mustFail('claims-on-words', () => expect(refs(intake('stop', { turn: { work: false, answer: false, last_message: 'Done.' } }), 'claims-on-words')).toEqual([]));
    await mustFail('claims-on-answers', () => expect(refs(intake('stop', { turn: { work: true, answer: true } }), 'claims-on-answers')).toEqual([]));
  });
});
