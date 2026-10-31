// #45 AC4: a classifying reading shows its agreement with a sample of at least 100 messages you labelled, from both periods
// with their dates hidden, and Decision 1 uses only those that pass. The labels in this file are the test's own, marked
// labelled_by: 'fixture', and never read as yours; the real sample stays with you (README, Outside inputs). The issue
// and the design give no agreement threshold, so it is an argument (README, Open points 2).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkClassifier, decisionOneInputs, isItDone, panelRows, type LabelledMessage } from '../../../packages/readings/src/index.ts';
import { T0 } from './events.ts';

const THRESHOLD = 0.9;
/** `n` fixture messages, half from each period; the stand-in classifier is right on all but those whose text says wrong. */
function sample(n: number, wrong: number, o: Partial<LabelledMessage> = {}): LabelledMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    message: `session:F1#m${i}`, text: `${i < wrong ? 'wrong' : 'right'} ${i}`, label: i % 2 === 0,
    period: i % 2 === 0 ? 'baseline' as const : 'dogfood' as const, dates_hidden: true, labelled_by: 'fixture', ...o,
  }));
}
const standIn = (messages: LabelledMessage[]) => (text: string): boolean => {
  const m = messages.find((x) => x.text === text)!;
  return text.startsWith('wrong') ? !m.label : m.label;
};
const check = (messages: LabelledMessage[]) => checkClassifier({ id: 'is_it_done', classifier: standIn(messages), sample: messages, threshold: THRESHOLD });

describe('AC4 classifying readings are checked against your labels', () => {
  it('#45.7492072d AC4 95 of 100 agree: 0.95 over 100 messages, PASS at 0.9; 60 of 100, the kind of agreement the October replay saw, is FAIL', () => {
    const good = check(sample(100, 5));
    expect(good.n).toBe(100);
    expect(good.agreement).toBeCloseTo(0.95, 10);
    expect(good.status).toBe('PASS');
    const bad = check(sample(100, 40));
    expect(bad.agreement).toBeCloseTo(0.6, 10);
    expect(bad.status).toBe('FAIL');
  });

  it('#45.7492072d AC4 a sample that can\'t decide is BLOCKED even at full agreement: 99 messages, one period only, dates shown, or none', () => {
    expect(check(sample(99, 0)).status, '99 is under the 100 the criterion names').toBe('BLOCKED');
    expect(check(sample(100, 0, { period: 'dogfood' })).status, 'both periods').toBe('BLOCKED');
    expect(check(sample(100, 0, { dates_hidden: false })).status, 'dates hidden').toBe('BLOCKED');
    expect(check([]).status, 'nothing labelled').toBe('BLOCKED');
  });

  it('#45.7492072d AC4 Decision 1 uses only the classifying readings that pass, by labels you made: an unchecked one, a failing one and one on fixture labels are refused, each with why', () => {
    const pass = check(sample(100, 5));
    const fail = check(sample(100, 40));
    const inputs = [{ id: 'is_it_done', check: pass }, { id: 'rework', check: fail }, { id: 'blocked', check: null }];
    const yours = decisionOneInputs(inputs);
    expect(yours.used, 'labels the fixture made are not yours').toEqual([]);
    expect(yours.refused.map((r) => r.id).sort()).toEqual(['blocked', 'is_it_done', 'rework']);
    for (const r of yours.refused) expect(r.why.length, `${r.id} says why`).toBeGreaterThan(0);
    const named = decisionOneInputs(inputs, { labellers: ['fixture'] });
    expect(named.used, 'with the labeller accepted, only the one that passes').toEqual(['is_it_done']);
    expect(named.refused.map((r) => r.id).sort()).toEqual(['blocked', 'rework']);
  });

  it('#45.7492072d AC4 the panel row of a classifying reading shows its agreement and sample size, and one with no check shows none, never a number', () => {
    const base = { unit: 'count', source: 'transcripts', as_of: T0, basis: 'modeled' as const };
    const rows = panelRows([
      { id: 'is_it_done', subject: null, value: 12, ...base, classifier: check(sample(100, 5)) },
      { id: 'rework', subject: null, value: 3, ...base, classifier: null },
    ], { now: T0, fresh_for: {} });
    const shown = rows.find((r) => r.id === 'is_it_done')?.agreement;
    expect(shown?.n).toBe(100);
    expect(shown?.share).toBeCloseTo(0.95, 10);
    expect(shown?.status).toBe('PASS');
    expect(rows.find((r) => r.id === 'rework')?.agreement, 'unchecked').toBeNull();
  });

  it('#45.7492072d AC4 the real classifier against your real labelled sample, named by DEEP_LABELLED_SAMPLE, passes the threshold fixed with the measures', (ctx) => {
    const path = process.env.DEEP_LABELLED_SAMPLE;
    if (!path) { ctx.skip('BLOCKED: only you can label the sample; DEEP_LABELLED_SAMPLE names it (README, Outside inputs)'); return; }
    const { threshold, messages } = JSON.parse(readFileSync(path, 'utf8')) as { threshold: number; messages: LabelledMessage[] };
    const result = checkClassifier({ id: 'is_it_done', classifier: isItDone, sample: messages, threshold });
    console.log(`is_it_done agrees with your labels on ${result.agreement} of ${result.n}`);
    expect(result.status).toBe('PASS');
  });
});
