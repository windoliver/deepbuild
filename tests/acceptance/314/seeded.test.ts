// AC6: each hub slot's kit also runs a seeded part, cases generated at install from a seed drawn then and
// recorded, never shipped with the guide or the examples: a planted fill that returns the shipped fixtures'
// expected answers by their inputs passes the fixed part and fails the seeded part, naming the seed, and the
// same seed replays the same cases.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { seededCases } from '../../../packages/conformance/src/index.ts';
import type { SlotCaseResult } from '../../../packages/conformance/src/index.ts';
import { canonical, clean, ENVIRONMENT, memorizingFill, notPassing, part, run, RUNS, slotKit, SLOTS, SOURCE } from './helpers.ts';

/** The slots whose kits observe only the fill's answers, so a fill that memorizes the shipped answers can pass their fixed part. */
const ANSWER_SLOTS = SLOTS.filter((slot) => slot !== ENVIRONMENT);
const shape = (cases: readonly SlotCaseResult[]): string[] => cases.map((c) => `${c.id} ${canonical(c.input)}`);

describe('AC6 each kit runs a seeded part from a seed drawn at install and recorded; the same seed replays the same cases', () => {
  it.each(SLOTS)('%s: a run has a fixed part and a seeded part, records its seed, and the seed given is the seed recorded', async (slot) => {
    const kit = slotKit(slot);
    const report = await run(kit, clean(kit), { seed: 314 });
    expect(report.seed).toBe(314);
    expect(part(report, 'fixed').length, 'fixed cases').toBeGreaterThan(0);
    expect(part(report, 'seeded').length, 'seeded cases').toBeGreaterThan(0);
    for (const c of part(report, 'seeded')) expect(c.input, `${c.id} carries its generated input`).not.toBeNull();
    expect(notPassing(report.cases)).toEqual([]);
  }, 600_000);

  it.each(SLOTS)('%s: the same seed replays the same cases, and another seed draws others; the cases are the generator\'s', async (slot) => {
    const kit = slotKit(slot);
    const first = await run(kit, clean(kit), { seed: 7, parts: ['seeded'] });
    const again = await run(kit, clean(kit), { seed: 7, parts: ['seeded'] });
    expect(shape(part(again, 'seeded'))).toEqual(shape(part(first, 'seeded')));
    expect(part(first, 'fixed'), 'parts: seeded runs the seeded part alone').toEqual([]);
    const other = await run(kit, clean(kit), { seed: 8, parts: ['seeded'] });
    expect(shape(part(other, 'seeded'))).not.toEqual(shape(part(first, 'seeded')));
    const generated = seededCases(kit, 7);
    expect(part(first, 'seeded').map((c) => `${c.id} ${canonical(c.input)}`)).toEqual(generated.map((c) => `${c.id} ${canonical(c.input)}`));
  }, 600_000);

  it.each(SLOTS)('%s: the seeded cases are never the shipped fixtures: no generated input equals a fixture\'s input', (slot) => {
    const kit = slotKit(slot);
    const shipped = new Set(kit.fixtures.map((f) => canonical(f.input)));
    expect(kit.fixtures.length, `${slot} ships fixtures for its fixed part`).toBeGreaterThan(0);
    for (const seed of [1, 7, 314]) {
      const cases = seededCases(kit, seed);
      expect(cases.length, `seed ${seed} generates cases`).toBeGreaterThan(0);
      for (const c of cases) expect(shipped.has(canonical(c.input)), `seed ${seed}: ${c.id} is not a shipped fixture`).toBe(false);
    }
  });

  it('AC6 with no seed given, the runner draws one and records it, and the draws differ', async () => {
    const kit = slotKit(SOURCE);
    const seeds = new Set<number>();
    for (let i = 0; i < 6; i++) {
      const report = await run(kit, clean(kit), { parts: ['seeded'] });
      expect(Number.isInteger(report.seed), 'the seed is a whole number').toBe(true);
      seeds.add(report.seed);
    }
    expect(seeds.size, `six runs drew ${[...seeds].join(', ')}`).toBeGreaterThan(1);
  }, 120_000);

  it('AC6 for any seed, the generator draws the same cases twice, and draws others at the next seed (1,000 cases)', () => {
    const kits = SLOTS.map((slot) => slotKit(slot));
    fc.assert(fc.property(fc.constantFrom(...kits), fc.integer({ min: 0, max: 2 ** 31 - 1 }), (kit, seed) => {
      const a = seededCases(kit, seed).map((c) => `${c.id} ${canonical(c.input)}`);
      const b = seededCases(kit, seed).map((c) => `${c.id} ${canonical(c.input)}`);
      expect(a).toEqual(b);
      expect(a.length).toBeGreaterThan(0);
      const next = seededCases(kit, seed + 1).map((c) => `${c.id} ${canonical(c.input)}`);
      expect(next, `${kit.slot}: seed ${seed} and ${seed + 1} draw the same cases`).not.toEqual(a);
    }), RUNS);
  }, 600_000);
});

describe('AC6 a planted fill that returns the shipped fixtures\' expected answers by their inputs passes the fixed part and fails the seeded part, naming the seed', () => {
  it.each(ANSWER_SLOTS)('%s: the memorizing fill passes the fixed part and fails the seeded part, naming the seed', async (slot) => {
    const kit = slotKit(slot);
    const memo = await memorizingFill(kit, clean(kit));
    const report = await run(kit, memo, { seed: 2718 });
    expect(notPassing(part(report, 'fixed')), 'the fixed part is the shipped fixtures, which it memorized').toEqual([]);
    const seeded = part(report, 'seeded');
    expect(seeded.some((c) => c.outcome === 'FAIL'), `the seeded part fails it (${seeded.map((c) => `${c.id}: ${c.outcome}`).join(', ')})`).toBe(true);
    expect(seeded.filter((c) => c.outcome === 'FAIL').some((c) => c.message.includes('seed 2718')), `a seeded FAIL names seed 2718 (${seeded.map((c) => c.message).join(' | ')})`).toBe(true);
    expect(report.verdict).not.toBe('PASS');
  }, 600_000);

  it(`${ENVIRONMENT}: the memorizing fill fails the seeded part, naming the seed (its kit watches ports and processes, so its fixed part is not held to the memorizer)`, async () => {
    const kit = slotKit(ENVIRONMENT);
    const memo = await memorizingFill(kit, clean(kit));
    const report = await run(kit, memo, { seed: 2718 });
    const seeded = part(report, 'seeded');
    expect(seeded.some((c) => c.outcome === 'FAIL'), `the seeded part fails it (${seeded.map((c) => `${c.id}: ${c.outcome}`).join(', ')})`).toBe(true);
    expect(seeded.filter((c) => c.outcome === 'FAIL').some((c) => c.message.includes('seed 2718'))).toBe(true);
    expect(report.verdict).not.toBe('PASS');
  }, 600_000);

  it.each(ANSWER_SLOTS)('%s (wrong program): fed to the reference fill\'s assertion, the memorizing fill is caught by the seeded part, and the failure names the seed', async (slot) => {
    const kit = slotKit(slot);
    const memo = await memorizingFill(kit, clean(kit));
    const report = await run(kit, memo, { seed: 2718 });
    // The assertion every reference fill passes (kits.test.ts) fails on the memorizer, and only through the seeded part;
    // what it was fed names the seed. Chai prints a non-empty array as `[ Array(n) ]`, so the content is checked directly.
    const caught = notPassing(report.cases);
    expect(() => expect(caught, 'the reference fill passes').toEqual([])).toThrow();
    expect(caught.join('\n'), 'the failure names the seed').toMatch(/seed 2718/);
    expect(() => expect(notPassing(part(report, 'fixed')), 'the fixed part').toEqual([])).not.toThrow();
  }, 600_000);
});
