// The index@1 kit (#314): an index takes claims (each on a page, from a source, with its text), answers a query
// with hits that each cite their page, quote and source, answers the same after a rebuild from the pages as after
// the upserts, and forgets a dropped source's claims. The reference fill is a keyword index in memory; the
// planted fills keep a dropped source's hits, return a hit without its source, index an upsert only at the next
// rebuild, and leave the live index as it is on a rebuild.
import type { JsonValue } from '@deepbuild/contracts';
import type { Random } from '../generator.js';
import { fail } from '../slot-types.js';
import type { Fixture, PlantedFill, SlotCase, SlotFill, SlotKitImpl, SlotRule } from '../slot-types.js';
import { canonical, list, object, same, text, word } from './shared.js';

export const INDEX = 'index@1';

export interface Claim { id: string; page: string; source: string; text: string }
export interface Hit { claim: string; page: string; quote: string; source: string }
export interface IndexFill extends SlotFill {
  slot: 'index@1';
  /** Replaces the whole index. */
  rebuild(claims: Claim[]): void;
  upsert(claims: Claim[]): void;
  search(query: string): Hit[];
  dropSource(source: string): void;
}
interface Input { claims: Claim[]; query: string; drop: string }
interface Expected { hits: Hit[]; afterDrop: Hit[] }

const RULES = {
  finds: { id: 'finds-upserted', rule: 'A query finds exactly the upserted claims whose text holds every word of it, as soon as they are upserted.', message: 'answered a query with hits other than the upserted claims that match it' },
  cites: { id: 'cites-page-quote-source', rule: 'Every hit cites its page, the quote it matched and the source the claim came from.', message: 'returned a hit without its page, quote or source' },
  drops: { id: 'drops-source', rule: 'After a source is dropped, no query finds its claims.', message: 'kept hits from a dropped source' },
  rebuilds: { id: 'rebuild-equals-upserts', rule: 'An index rebuilt from the pages\' claims answers a query exactly as the incremental upserts did.', message: 'answered a query differently after a rebuild from the pages than after the upserts' },
};
const rules: SlotRule[] = Object.values(RULES).map(({ id, rule }) => ({ id, rule }));

const words = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const matches = (claim: Claim, query: string): boolean => { const have = new Set(words(claim.text)); return words(query).every((w) => have.has(w)); };
const byClaim = (hits: Hit[]): Hit[] => [...hits].sort((a, b) => (a.claim < b.claim ? -1 : a.claim > b.claim ? 1 : 0));
/** The hits the rules ask for: every matching claim, cited, in claim order. */
export const expectedHits = (claims: Claim[], query: string): Hit[] => byClaim(claims.filter((c) => matches(c, query)).map((c) => ({ claim: c.id, page: c.page, quote: c.text, source: c.source })));

/** The reference index; `plantedWith` plants one fault in it. */
function reference(fault: 'none' | 'keeps-dropped' | 'sourceless' | 'stale-upsert' | 'noop-rebuild' = 'none'): IndexFill {
  const claims = new Map<string, Claim>();
  const pending: Claim[] = [];
  return {
    slot: INDEX, revision: 1,
    // The no-op rebuild leaves the live index as it is, as one that only ever grows by upserts would.
    rebuild(next) { if (fault === 'noop-rebuild') return; claims.clear(); for (const c of [...pending.splice(0), ...next]) claims.set(c.id, c); },
    upsert(next) { if (fault === 'stale-upsert') { pending.push(...next); return; } for (const c of next) claims.set(c.id, c); },
    search(query) { return expectedHits([...claims.values()], query).map((h) => (fault === 'sourceless' ? { ...h, source: '' } : h)); },
    dropSource(source) { if (fault === 'keeps-dropped') return; for (const [id, c] of claims) if (c.source === source) claims.delete(id); },
  };
}

const plant = (name: string, breaks: keyof typeof RULES, codes: string[], fill: IndexFill): PlantedFill<IndexFill> => ({ name, message: RULES[breaks].message, codes, breaks: RULES[breaks].id, fill });
const plantedFills = (): PlantedFill<IndexFill>[] => [
  plant('keeps-dropped-source', 'drops', ['dropped_source_hit'], reference('keeps-dropped')),
  plant('sourceless-hit', 'cites', ['hit_uncited'], reference('sourceless')),
  plant('stale-after-upsert', 'finds', ['hits_mismatch'], reference('stale-upsert')),
  plant('rebuild-is-a-no-op', 'rebuilds', ['rebuild_mismatch'], reference('noop-rebuild')),
];

const toCase = (id: string, part: 'fixed' | 'seeded', input: Input): SlotCase => {
  const expected: Expected = { hits: expectedHits(input.claims, input.query), afterDrop: expectedHits(input.claims.filter((c) => c.source !== input.drop), input.query) };
  return { id, part, input: input as unknown as JsonValue, expected: expected as unknown as JsonValue };
};
const fixtures: Fixture[] = [
  toCase('cart-totals', 'fixed', {
    claims: [
      { id: 'c1', page: 'notes/cart', source: 'src/cart.ts', text: 'The cart total adds every price once.' },
      { id: 'c2', page: 'notes/cart', source: 'docs/cart.md', text: 'A cart total never counts a removed line.' },
      { id: 'c3', page: 'notes/checkout', source: 'src/checkout.ts', text: 'Checkout reads the cart total from the record.' },
      { id: 'c4', page: 'notes/tax', source: 'src/tax.ts', text: 'Tax applies after discounts.' },
    ],
    query: 'cart total', drop: 'src/cart.ts',
  }),
  toCase('release-notes', 'fixed', {
    claims: [
      { id: 'r1', page: 'releases/0.4', source: 'CHANGELOG.md', text: 'Release 0.4 ships the manifest check.' },
      { id: 'r2', page: 'releases/0.4', source: 'issues/314', text: 'The manifest check refuses a name without its prefix.' },
      { id: 'r3', page: 'releases/0.3', source: 'CHANGELOG.md', text: 'Release 0.3 ships the conformance runner.' },
    ],
    query: 'manifest check', drop: 'issues/314',
  }),
].map(({ id, input, expected }) => ({ id, input, expected }));

/** Three claim sets from the draw, each with a key word on two claims from different sources, one of which is dropped. */
function generate(random: Random): SlotCase[] {
  return [0, 1, 2].map((i) => {
    const key = word(random, 7);
    const count = random.int(3, 5);
    const claims: Claim[] = Array.from({ length: count }, (_, k) => {
      const page = `pages/${word(random, 5)}`;
      const source = `src/${word(random, 6)}.ts`;
      const text = `${word(random, 5)} ${k < 2 ? key : word(random, 7)} ${word(random, 6)}.`;
      return { id: `g${k}`, page, source, text };
    });
    return toCase(`seeded-${i + 1}`, 'seeded', { claims, query: key, drop: claims[0]!.source });
  });
}

function holdHits(answer: unknown): Hit[] {
  return list('the hits', answer).map((h, i) => {
    const o = object(`hits/${i}`, h);
    for (const member of ['claim', 'page', 'quote', 'source'] as const) {
      if (typeof o[member] !== 'string' || !o[member]) throw fail(RULES.cites.message, ['hit_uncited'], `hits/${i}/${member} is ${JSON.stringify(o[member])}`);
    }
    return { claim: text('claim', o.claim), page: text('page', o.page), quote: text('quote', o.quote), source: text('source', o.source) };
  });
}

function* judge(fill: IndexFill, c: SlotCase): Generator<() => unknown, void, unknown> {
  const { claims, query, drop } = c.input as unknown as Input;
  const expected = c.expected as unknown as Expected;
  yield () => fill.rebuild([]);
  yield () => fill.upsert(claims);
  const hits = holdHits(yield () => fill.search(query));
  if (!same(byClaim(hits), expected.hits)) throw fail(RULES.finds.message, ['hits_mismatch'], `"${query}" found ${canonical(byClaim(hits))}; the upserted claims give ${canonical(expected.hits)}`);
  // The same claims rebuilt from the pages answer the same, and only those: a decoy upserted first, matching the
  // query but on no page, must be gone, so a rebuild that leaves the live index as it is can't pass.
  yield () => fill.upsert([{ id: 'decoy', page: 'decoy', source: 'decoy', text: query }]);
  yield () => fill.rebuild(claims);
  const rebuilt = holdHits(yield () => fill.search(query));
  if (!same(byClaim(rebuilt), expected.hits)) throw fail(RULES.rebuilds.message, ['rebuild_mismatch'], `"${query}" after a rebuild from the pages found ${canonical(byClaim(rebuilt))}; the pages' claims give ${canonical(expected.hits)}`);
  yield () => fill.dropSource(drop);
  const after = holdHits(yield () => fill.search(query));
  const kept = after.filter((h) => h.source === drop);
  if (kept.length) throw fail(RULES.drops.message, ['dropped_source_hit'], `${kept.map((h) => h.claim).join(', ')} from ${drop} after it was dropped`);
  if (!same(byClaim(after), expected.afterDrop)) throw fail(RULES.finds.message, ['hits_mismatch'], `"${query}" after dropping ${drop} found ${canonical(byClaim(after))}; the remaining claims give ${canonical(expected.afterDrop)}`);
}

export const indexKit = (): SlotKitImpl<IndexFill> => ({
  slot: INDEX, fills: 'one', revision: 1, rules, fixtures, planted: plantedFills(),
  clean: () => [reference()], generate, judge,
});
