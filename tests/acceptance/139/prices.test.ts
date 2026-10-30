// AC10 (#139): a plug-in update that provides `prices@2` and keeps `prices@1` through its adapter installs, and the
// stocks view, which uses `prices@1`, passes its contract tests against the adapter's outputs; the same update without
// the adapter asks you once, naming the stocks view, and installs nothing until you answer; an installer that rewires
// the view to `prices@2` fails, naming the edge.
// The interfaces are `ext.acme.prices@1` and `ext.acme.prices@2` (a name a plug-in adds is ext.<plugin>.<name>); the
// adapter is a `provides` row with `adapter: { from: 'ext.acme.prices@2' }` whose reading the package serves in code.
// The host gains `edges()`: each use of an installed package, what it names and what it is wired to (README).
import { describe, expect, it } from 'vitest';
import { d1Digest, extensionApi } from '../../../packages/contracts/src/index.ts';
import type { ExtensionHost } from '../../../packages/extension-host/src/index.ts';
import { shownPlanHash } from '../plans.ts';
import { admit, approveCard, makePackage, openHost, openWorld, releaseOf, sleep, tempDir, waitUntil, YOU, type Json, type World } from './helpers.ts';

const P1 = 'ext.acme.prices@1';
const P2 = 'ext.acme.prices@2';
const SHAPE1 = { type: 'object', properties: { symbol: { type: 'string' }, cents: { type: 'integer' } }, required: ['symbol', 'cents'], additionalProperties: false };
const SHAPE2 = { type: 'object', properties: { symbol: { type: 'string' }, price: { type: 'object', properties: { amount: { type: 'string' }, currency: { type: 'string' } }, required: ['amount', 'currency'], additionalProperties: false } }, required: ['symbol', 'price'], additionalProperties: false };
const v1Index = `export default function (deep: any): void {
  deep.provide('${P1}', 'reading', ${JSON.stringify(SHAPE1)}, async () => ({ symbol: 'ACME', cents: 12345 }));
}
`;
const v2Index = (adapter: boolean) => `export default function (deep: any): void {
  const v2 = async () => ({ symbol: 'ACME', price: { amount: '123.45', currency: 'USD' } });
  deep.provide('${P2}', 'reading', ${JSON.stringify(SHAPE2)}, v2);
${adapter ? `  deep.provide('${P1}', 'reading', ${JSON.stringify(SHAPE1)}, async () => { const p = await v2(); return { symbol: p.symbol, cents: Math.round(Number(p.price.amount) * 100) }; });\n` : ''}}
`;
const stocksIndex = `export default function (deep: any): void {
  deep.use('${P1}');
  deep.registerCheck('ext.stocks.report', async () => {
    let said: unknown;
    try { said = await deep.read('${P1}'); } catch (e) { said = { error: String((e as Error)?.message ?? e) }; }
    return { outcome: 'failed', testsRun: 1, evidence: [], read: [], mask: null, failures: [{ test: 'report', file: 'index.ts', line: 1, stack: null, assertion: false, message: JSON.stringify(said) }] };
  });
}
`;
// Criterion 13: a package lists the preview methods it calls; none of these declares itself stable (criterion 3).
const PROVIDER_PREVIEW = { preview: ['deep.provide'] };
// The published API the host is given (README: preview methods at install are by the API the host is given): the three
// methods these packages call are preview, so the scenario doesn't depend on what the real contract marks (`deep.read` has no entry at the base).
const previewApi = () => {
  const api = extensionApi().map((e) => (['deep.provide', 'deep.use', 'deep.read'].includes(e.method) ? { ...e, stability: 'preview', tracking: '#139' } : e));
  return api.some((e) => e.method === 'deep.read') ? api : [...api, { ...api.find((e) => e.method === 'deep.use')!, method: 'deep.read', tracking: '#139' }];
};
const provides = (names: string[], adapter: boolean) => names.map((interface_) => ({ interface: interface_, kind: 'reading', minor: 0, ...(adapter && interface_ === P1 ? { adapter: { from: P2 } } : {}) }));

interface Scene { w: World; h: ExtensionHost; v2: string }
/** The stocks view and prices 1.0.0 installed and loaded; `v2` is the update's folder, with or without the adapter. */
async function scene(adapter: boolean, plant?: string): Promise<Scene> {
  const stocks = await makePackage({ id: 'acme/stocks', manifest: { requires: { preview: ['deep.use', 'deep.read'] }, checks: ['ext.stocks.report'], uses: [{ interface: P1, minor: 0, digest: d1Digest(SHAPE1) }] }, index: stocksIndex });
  const v1 = await makePackage({ id: 'acme/acme', version: '1.0.0', manifest: { requires: PROVIDER_PREVIEW, provides: provides([P1], false) }, index: v1Index });
  const v2 = await makePackage({ id: 'acme/acme', version: '2.0.0', manifest: { requires: PROVIDER_PREVIEW, provides: provides(adapter ? [P2, P1] : [P2], adapter) }, index: v2Index(adapter) });
  const w = await openWorld();
  const h = await openHost(w, { release: await releaseOf(stocks, v1, v2), api: previewApi(), ...(plant ? { plant } : {}) });
  for (const dir of [v1, stocks]) {
    const got = await admit(h, dir);
    expect(got.ok, `the starting world: ${dir} admitted: ${got.ok ? '' : got.reason}`).toBe(true);
  }
  return { w, h, v2 };
}
/** What the stocks view's report reads through its use of prices@1. */
async function report(h: ExtensionHost): Promise<Json> {
  const result = await h.runCheck('ext.stocks.report', { kind: 'ext.stocks.report', runner: 'report', inputs: [], depth: 'unit', oracle: 'code', contract: null } as never, { checkout: tempDir('co'), deadline: 30_000 });
  return JSON.parse(result.failures[0]!.message as string) as Json;
}
const EDGE = `acme/stocks uses ${P1}`;
/** The stocks view's contract test: what it read is a prices@1 reading, exactly its two fields. */
function contractTest(read: Json): void {
  const value = read?.value;
  expect(value && Object.keys(value).sort().join(), `the stocks view's read through ${P1}: ${JSON.stringify(read)}`).toBe('cents,symbol');
  expect(value.symbol).toBe('ACME');
  expect(value.cents, 'prices@1 reads cents, converted by the adapter from prices@2\'s 123.45').toBe(12345);
}
/** The edge as the host wires it: the stocks view's use of prices@1, wired to prices@1, from acme/acme. Throws naming the edge when it isn't. */
async function expectEdge(h: ExtensionHost): Promise<void> {
  const edges = await (h as unknown as { edges(): Promise<{ user: string; uses: string; interface: string; provider: string }[]> }).edges();
  const edge = edges.find((e) => e.user === 'acme/stocks' && e.uses === P1);
  if (!edge) throw Error(`the edge ${EDGE} is gone: ${JSON.stringify(edges)}`);
  if (edge.interface !== P1 || edge.provider !== 'acme/acme') throw Error(`the edge ${EDGE} is wired to ${edge.interface} from ${edge.provider}, not ${P1} from acme/acme`);
}
const versions = async (h: ExtensionHost): Promise<string[]> => (await h.installed()).filter((p) => p.id === 'acme/acme').map((p) => p.version);

/** The update with its adapter: installs, keeps the edge on prices@1, and the view's contract test passes on the adapter's output. */
async function updateWithAdapter(plant?: string): Promise<void> {
  const { h, v2 } = await scene(true, plant);
  contractTest(await report(h));
  const got = await admit(h, v2);
  expect(got.ok, `the update that keeps prices@1 through its adapter installs: ${got.ok ? '' : got.reason}`).toBe(true);
  expect(await versions(h), 'prices 2.0.0 is the installed version').toEqual(['2.0.0']);
  await expectEdge(h);
  contractTest(await report(h));
}

describe('#139.06ef013d a plug-in update that provides prices@2 and keeps prices@1 through its adapter installs; without the adapter it asks once, naming the stocks view', () => {
  it('AC10 the update with its adapter installs; the stocks view, which uses prices@1, passes its contract tests against the adapter\'s output', async () => {
    await updateWithAdapter();
  }, 180_000);

  it('AC10 (wrong program) an installer that rewires the view to prices@2 fails, naming the edge', async () => {
    await expect(updateWithAdapter('rewires-to-newest')).rejects.toThrow(new RegExp(`the edge ${EDGE} is wired to ${P2}`));
  }, 180_000);

  it('AC10 the same update without the adapter asks you once, naming the stocks view, and installs nothing until you answer; your yes installs it', async () => {
    const { w, h, v2 } = await scene(false);
    const pending = h.install({ from: v2, builtBy: null });
    const settled = pending.then(() => 'done', (e: unknown) => `refused: ${String(e)}`);
    const named = async () => (await w.asks.needsYou()).filter((c) => JSON.stringify(c).includes('acme/stocks'));
    const cards = await waitUntil(async () => { const c = await named(); return c.length ? c : undefined; }, 30_000, 'an ask naming acme/stocks');
    await sleep(1_000);
    expect(await named(), 'asked once, never twice').toHaveLength(cards.length);
    expect(cards, 'one card').toHaveLength(1);
    expect(JSON.stringify(cards[0]), 'it names the stocks view and the interface it loses').toContain(P1);
    expect(await versions(h), 'nothing is installed until you answer: prices stays at 1.0.0').toEqual(['1.0.0']);
    expect(await Promise.race([settled, sleep(200).then(() => 'waiting')]), 'the install waits for your answer').toBe('waiting');
    await approveCard(w, (cards[0] as { ask: string }).ask);
    expect(await settled, 'your yes lets the install finish').toBe('done');
    expect(await versions(h), 'prices 2.0.0 is installed after the yes').toEqual(['2.0.0']);
  }, 180_000);

  it('AC10 your no leaves prices 1.0.0 installed and the stocks view\'s edge as it was', async () => {
    const { w, h, v2 } = await scene(false);
    const settled = h.install({ from: v2, builtBy: null }).then(() => 'done', (e: unknown) => `refused: ${String(e)}`);
    const cards = await waitUntil(async () => { const c = (await w.asks.needsYou()).filter((x) => JSON.stringify(x).includes('acme/stocks')); return c.length ? c : undefined; }, 30_000, 'an ask naming acme/stocks');
    const card = await w.asks.card((cards[0] as { ask: string }).ask);
    const no = card.options.find((o: { decision?: string }) => o.decision === 'deny') ?? card.options[card.options.length - 1]!;
    await w.asks.answer(YOU, (cards[0] as { ask: string }).ask, { option: no.id, plan_hash: await shownPlanHash(w.asks, (cards[0] as { ask: string }).ask), token: `click-${Date.now()}` });
    expect(await settled, 'your no refuses the update').toMatch(/^refused/);
    expect(await versions(h), 'prices stays at 1.0.0').toEqual(['1.0.0']);
    await expectEdge(h);
    contractTest(await report(h));
  }, 180_000);
});
