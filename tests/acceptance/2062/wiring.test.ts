// AC1, AC2 and AC3: which provider a use of `x@1` is wired to (README, Criteria). Package `u` uses `x@1` at minor 0 and
// names no provider; package `p`, and AC3's providers, provide `x@1` at minor 0 with the schema `u` was built against.
import { describe, expect, it } from 'vitest';
import type { ExtensionHost } from '../../../packages/extension-host/src/index.ts';
import { AC, admit, clock, edgesOfU, openHost, openWorld, P, provider, said, setUp, t, tie, U, underLocale, user, X, type Edge, type World } from './helpers.ts';

const EDGE = `the edge from ${U} to ${P} over ${X}`;
const WIRED: Edge = { user: U, uses: X, interface: X, provider: P };

async function scene(): Promise<{ w: World; h: ExtensionHost }> {
  const w = await openWorld(clock(t('10:00:00')));
  return { w, h: await openHost(w) };
}
/** A refusal names an edge when it names its user, its interface and its provider. */
function namesTheEdge(reason: string): void {
  expect(reason, `the refusal names ${EDGE}: its user`).toContain(U);
  expect(reason, `the refusal names ${EDGE}: its interface`).toContain(X);
  expect(reason, `the refusal names ${EDGE}: its provider`).toContain(P);
}

describe(`${AC[1]} a use that states a digest isn't wired to a provider whose row keeps no digests: the install is refused, naming the edge`, () => {
  it('AC1 u, whose use states a digest, is refused at its install beside p, whose row keeps none, and nothing is wired', async () => {
    const { h } = await scene();
    await setUp(h, provider(P, 'no digests'), `${P}, which provides ${X} with a row that keeps no digests`);
    const got = await admit(h, user('its digest'));
    expect(await edgesOfU(h), `${EDGE} isn't wired: ${U}'s use states a digest and ${P}'s row keeps none`).toEqual([]);
    if (got.ok) expect.unreachable(`${U} is refused: ${EDGE} doesn't match`);
    expect(got.step, `${U} is refused at its install, not later: ${got.reason}`).toBe('install');
    namesTheEdge(got.reason);
    expect((await h.installed()).map((p) => p.id), `${U} isn't installed`).toEqual([P]);
  }, 300_000);

  it('AC1 p, whose row keeps none, is refused at its install beside u, installed first, and nothing is wired', async () => {
    const { h } = await scene();
    await setUp(h, user('its digest'), `${U}, whose use of ${X} has no provider yet`);
    const got = await admit(h, provider(P, 'no digests'));
    expect(await edgesOfU(h), `${EDGE} isn't wired: ${U}'s use states a digest and ${P}'s row keeps none`).toEqual([]);
    if (got.ok) expect.unreachable(`${P} is refused: ${EDGE} doesn't match`);
    expect(got.step, `${P} is refused at its install, not later: ${got.reason}`).toBe('install');
    namesTheEdge(got.reason);
    expect((await h.installed()).map((p) => p.id), `${P} isn't installed`).toEqual([U]);
  }, 300_000);
});

describe(`${AC[2]} a use that states no digest is wired to a row that keeps none, and a use that states one to a row that keeps it for minor 0`, () => {
  it('AC2 the same pair with no digest on u\'s use is wired: the install isn\'t refused, and p\'s next version reaches u along the edge', async () => {
    const { w, h } = await scene();
    const installs = (from: string): Promise<string | null> => h.install({ from, builtBy: null }).then(() => null, (e: unknown) => said(e));
    const first = await installs(provider(P, 'no digests'));
    if (first !== null) throw Error(`set-up: ${P}, which provides ${X} with a row that keeps no digests, installs: ${first}`);
    expect(await installs(user('no digest')), `${EDGE}, with no digest stated and none kept, is wired: ${U}'s install isn't refused`).toBeNull();
    // A `uses` row with no digest isn't extension.manifest@1's, so `u` never loads and edges() never lists it: what
    // the composition graph holds shows in the record when the provider's next version travels along its edges.
    expect(await installs(provider(P, 'no digests', '1.1.0')), `${P} 1.1.0 installs`).toBeNull();
    expect((await w.events('composition.tested')).map((e) => e.data), `${EDGE} is wired: ${P} 1.1.0 is tested against ${U}, its user`)
      .toEqual([{ user: U, interface: X, provider: P, version: '1.1.0', passed: true }]);
    expect((await w.events('composition.reopened')).map((e) => e.data), `${EDGE} is wired: ${P} 1.1.0 reopens ${U}'s claims`)
      .toEqual([{ piece: U, provider: P, version: '1.1.0' }]);
  }, 300_000);

  it('AC2 a provider whose row keeps the use\'s digest for minor 0 is wired', async () => {
    const { h } = await scene();
    await setUp(h, provider(P, 'its digest'), `${P}, whose row keeps minor 0's digest`);
    const got = await admit(h, user('its digest'));
    expect(got.ok ? null : `${got.step}: ${got.reason}`, `${EDGE}, whose digest ${P} keeps for minor 0, is wired: ${U} isn't refused`).toBeNull();
    expect(await edgesOfU(h), `${EDGE} is wired`).toEqual([WIRED]);
  }, 300_000);
});

// The providers install in the order that wires the wrong one first, so a tie kept in install order fails too.
describe(`${AC[3]} of two providers that both match a use that names none, the one whose ID is first by UTF-16 code units is wired, under every locale`, () => {
  it('AC3 under the cs locale, whose ch sorts after cz, the use that chart and czar both match resolves to chart', async () => {
    const [chart, czar] = ['test/chart', 'test/czar'] as const;
    const got = await underLocale('cs_CZ.UTF-8', [czar, chart]);
    expect(got.locale, 'the process ran under the cs locale').toMatch(/^cs\b/);
    expect(got.order, `the cs locale sorts ${czar} before ${chart}, so a tie left to it picks ${czar}`).toBeLessThan(0);
    expect(got.edges.map((e) => [e.user, e.uses]), `${U}'s use of ${X} is wired to one provider`).toEqual([[U, X]]);
    expect(got.edges[0]!.provider, `${U}'s use of ${X}, which ${chart} and ${czar} both match, resolves to ${chart}`).toBe(chart);
  }, 300_000);

  it('AC3 in this process\'s own locale, the use that a-b and a_b both match resolves to a-b, whose hyphen is the smaller code unit', async () => {
    const [hyphen, underscore] = ['test/a-b', 'test/a_b'] as const;
    const edges = await tie([underscore, hyphen]);
    expect(edges.map((e) => [e.user, e.uses]), `${U}'s use of ${X} is wired to one provider`).toEqual([[U, X]]);
    expect(edges[0]!.provider, `${U}'s use of ${X}, which ${hyphen} and ${underscore} both match, resolves to ${hyphen}`).toBe(hyphen);
  }, 300_000);
});
