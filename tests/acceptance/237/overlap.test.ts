// #237 AC11: lease overlap is one kernel function over the two match forms, glob and prefix, and it is symmetric.
// A rule stated with "never" is tested as a property (design: Universal rules are tested as properties). It is
// compared, on 1,000 seeded random pairs of each form, in both orders, with a brute-force reference that tries
// every path of up to four segments, or every ID of up to four parts, built from the fixtures' names.
//
// Generators (README, How each criterion is read):
// - ID prefixes: one to four parts from NAMES, joined by "."; a prefix matches an ID whose parts start with its parts.
// - Path globs: one to four segments, each a name from NAMES, `*` (exactly one segment) or `**` (zero or more
//   segments, wherever it stands), at most two of them not `**`, joined by "/" and relative to the repo root. With
//   at most two fixed segments a side, two globs that share any path share one of at most four segments, so the
//   reference's four segments decide every generated pair.
// - Pairs: half independent, half the second drawn from the first (a shorter prefix; a glob with a segment
//   widened), so both answers are common; the test checks that before it trusts the property.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { overlap, plantedOverlap, type Overlap } from '../../../packages/leases/src/index.ts';

const NAMES = ['fig', 'axis', 'label', 'title'] as const;
const SEED = 0x237_11;
const RUNS = 1000;
type Form = 'glob' | 'prefix';

// ---- The brute-force reference.
const universe: string[][] = [];
for (let n = 1; n <= 4; n++) {
  const grow = (prefix: string[]): void => {
    if (prefix.length === n) { universe.push(prefix); return; }
    for (const name of NAMES) grow([...prefix, name]);
  };
  grow([]);
}
function globMatches(glob: readonly string[], path: readonly string[], i = 0, j = 0): boolean {
  if (i === glob.length) return j === path.length;
  if (glob[i] === '**') return globMatches(glob, path, i + 1, j) || (j < path.length && globMatches(glob, path, i, j + 1));
  if (j === path.length) return false;
  return (glob[i] === '*' || glob[i] === path[j]) && globMatches(glob, path, i + 1, j + 1);
}
const prefixMatches = (prefix: readonly string[], id: readonly string[]): boolean => prefix.length <= id.length && prefix.every((p, k) => p === id[k]);
function reference(form: Form, a: string, b: string): boolean {
  const [sa, sb] = form === 'glob' ? [a.split('/'), b.split('/')] : [a.split('.'), b.split('.')];
  const matches = form === 'glob' ? globMatches : prefixMatches;
  return universe.some((x) => matches(sa, x) && matches(sb, x));
}

// ---- The generators.
const name = fc.constantFrom(...NAMES);
const prefix = fc.array(name, { minLength: 1, maxLength: 4 });
const prefixPair = fc.oneof(
  fc.tuple(prefix, prefix),
  prefix.chain((a) => fc.integer({ min: 1, max: a.length }).map((k) => [a, a.slice(0, k)] as [string[], string[]])),
).map(([a, b]) => [a.join('.'), b.join('.')] as [string, string]);
const glob = fc.array(fc.constantFrom<string>(...NAMES, '*', '**'), { minLength: 1, maxLength: 4 }).filter((s) => s.filter((x) => x !== '**').length <= 2);
const globPair = fc.oneof(
  fc.tuple(glob, glob),
  glob.chain((a) => fc.tuple(fc.integer({ min: 0, max: a.length - 1 }), fc.constantFrom('*', '**')).map(([k, w]) => [a, a.map((s, i) => (i === k ? w : s))] as [string[], string[]])),
).map(([a, b]) => [a.join('/'), b.join('/')] as [string, string]);
const pairs: Record<Form, fc.Arbitrary<[string, string]>> = { glob: globPair, prefix: prefixPair };
const EXAMPLES: Record<Form, [string, string][]> = {
  prefix: [['fig.axis', 'fig'], ['fig.axis', 'fig.label']],
  glob: [['fig/**', '**/axis'], ['fig/*', 'fig'], ['fig/axis', 'fig/label']],
};

/** The property: in both orders, the function agrees with the reference; a disagreement names the pair and the order. */
function agreesWithReference(fn: Overlap, form: Form): void {
  const out = fc.check(fc.property(pairs[form], ([a, b]) => {
    const want = reference(form, a, b);
    for (const [x, y] of [[a, b], [b, a]] as const) {
      const got = fn(form, x, y);
      if (got !== want) throw Error(`overlap('${form}', "${x}", "${y}") is ${String(got)} but the reference says ${String(want)}: the pair ("${a}", "${b}") in the order "${x}" against "${y}"`);
    }
  }), { seed: SEED, numRuns: RUNS, examples: EXAMPLES[form].map((p) => [p]) });
  if (out.failed) {
    const why = out.errorInstance instanceof Error ? out.errorInstance.message : String(out.errorInstance);
    throw Error(`${why} (seed ${out.seed}, path ${out.counterexamplePath ?? ''}, after ${out.numRuns} pairs)`);
  }
  expect(out.numRuns, `pairs checked for ${form}`).toBeGreaterThanOrEqual(RUNS);
}

describe('AC11 #237.a10e760d one symmetric overlap function, checked against a brute-force reference', () => {
  for (const form of ['prefix', 'glob'] as const) {
    it(`AC11 the ${form} generator draws both overlapping and disjoint pairs (seed ${SEED})`, () => {
      const drawn = fc.sample(pairs[form], { seed: SEED, numRuns: RUNS });
      const overlapping = drawn.filter(([a, b]) => reference(form, a, b)).length;
      expect(overlapping, `${form} pairs that overlap, of ${RUNS}`).toBeGreaterThanOrEqual(RUNS / 10);
      expect(RUNS - overlapping, `${form} pairs that don't, of ${RUNS}`).toBeGreaterThanOrEqual(RUNS / 10);
    });
    it(`AC11 on ${RUNS} seeded random pairs of ${form === 'glob' ? 'path globs' : 'ID prefixes'}, in both orders, overlap agrees with the reference`, () => {
      agreesWithReference(overlap, form);
    }, 60_000);
  }
  it('AC11 the pair (fig.axis, fig) overlaps in both orders, and (fig.axis, fig.label) in neither', () => {
    expect(overlap('prefix', 'fig.axis', 'fig')).toBe(true);
    expect(overlap('prefix', 'fig', 'fig.axis')).toBe(true);
    expect(overlap('prefix', 'fig.axis', 'fig.label')).toBe(false);
    expect(overlap('prefix', 'fig.label', 'fig.axis')).toBe(false);
  });
  it('AC11 (wrong program) a planted overlap that tests A against B but not B against A disagrees with the reference on (fig.axis, fig) in one order and fails, naming the pair and the order', () => {
    let failure: Error | undefined;
    try { agreesWithReference(plantedOverlap['one-way'], 'prefix'); } catch (e) { failure = e as Error; }
    expect(failure, 'the planted one-way overlap fails the property').toBeInstanceOf(Error);
    expect(failure!.message).toContain('the pair ("fig.axis", "fig")');
    expect(failure!.message).toMatch(/in the order "fig\.axis" against "fig"|in the order "fig" against "fig\.axis"/);
  });
});
