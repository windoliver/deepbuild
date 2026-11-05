// #65's channel@1 kit in the conformance package (#13), with its two planted fills (the issue's Scope; the design's
// hub-slot row for deep.registerChannel): AC4 (a channel that reports delivered with no acknowledgement from its
// provider is recorded as stalled and fails channel@1 at install, naming the item) and AC5's kit half (a channel that
// returns an answer marked as signed with no valid signature fails the kit). The kit runs through the conformance
// package's own runner, and at install through the real hub and `deep install`.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanFills, runKit, slotKits, type SlotFill, type SlotKit } from '../../../packages/conformance/src/index.ts';
import { deep } from '../16/helpers.ts';
import { AC, cleanup, deliveriesOf, plantedPackage, sleep, world } from './helpers.ts';

afterEach(cleanup, 120_000);

function channelKit(): SlotKit {
  const kit = slotKits().find((k) => k.slot === 'channel@1');
  if (!kit) throw Error(`the conformance package has no channel@1 kit: slotKits() holds ${slotKits().map((k) => k.slot).join(', ')} (README, The surface (my choice))`);
  return kit;
}
/** Every thread_key the kit's fixtures hand a channel: the items its cases deliver. */
const threadKeys = (kit: SlotKit): string[] => [...JSON.stringify(kit.fixtures).matchAll(/"thread_key":"([^"]+)"/g)].map((m) => m[1]!);
async function plantedFails(name: string): Promise<{ messages: string[]; keys: string[] }> {
  const kit = channelKit();
  const planted = kit.planted.find((p) => p.name === name);
  expect(planted, `channel@1's kit plants ${name}; it plants ${kit.planted.map((p) => p.name).join(', ') || 'nothing'}`).toBeDefined();
  const report = await runKit(kit, planted!.fill as SlotFill);
  expect(report.verdict, `${name} fails channel@1: ${JSON.stringify(report.cases.filter((c) => c.outcome !== 'PASS'))}`).toBe('FAIL');
  // The kit is no wall: each of its reference fills passes it.
  for (const fill of cleanFills(kit)) expect((await runKit(kit, fill)).verdict, `channel@1's reference fill ${String(fill.kind ?? '')} passes it`).toBe('PASS');
  return { messages: report.cases.filter((c) => c.outcome === 'FAIL').map((c) => c.message), keys: threadKeys(kit) };
}

describe(`${AC[4]} A planted channel that reports delivered with no acknowledgement from its provider fixture is recorded as stalled and fails \`channel@1\` at install, naming the item`, () => {
  it(`${AC[4]} channel@1's planted delivered-without-ack fails the kit, its delivery recorded stalled, naming the item`, async () => {
    const { messages, keys } = await plantedFails('delivered-without-ack');
    expect(keys.length, 'the kit\'s fixtures deliver items with thread keys').toBeGreaterThan(0);
    expect(messages.some((m) => /stalled/.test(m) && keys.some((k) => m.includes(k))), `a failing case says stalled and names the item's thread key (${keys.join(', ')}): ${messages.join(' | ')}`).toBe(true);
  });

  it(`${AC[4]} a planted channel package that reports delivered with no acknowledgement is refused at install by channel@1, naming the item, and carries nothing`, async () => {
    const w = await world({ channels: [], extra: { planted: { api: 'http://127.0.0.1:9' } }, seed: [{ source: 'deep_ask.choice', question: 'Keep the cache in SQLite or in plain files?' }] });
    const r = await deep(w.home, ['install', plantedPackage('planted-channel')], { timeoutMs: 300_000 });
    const said = `${r.stdout}\n${r.stderr}`;
    expect(r.code, `deep install of the planted channel fails: exit ${r.code}: ${said.slice(-1500)}`).not.toBe(0);
    expect(said, 'the install names the kit').toMatch(/(^|[^\w/-])channel@1\b/m);
    const keys = threadKeys(channelKit());
    expect(/stalled/.test(said) && keys.some((k) => said.includes(k)), `the install says stalled and names the item (${keys.join(', ')}): ${said.slice(-1500)}`).toBe(true);
    await sleep(5000);
    expect(await deliveriesOf(w, 'planted'), 'the refused channel carried nothing').toEqual([]);
  });
});

describe(`${AC[5]} A planted channel that returns an answer marked as signed by the paired device but carrying no valid signature, or naming an account link the hub doesn't hold, is refused, naming the device key or the link, and the answer counts as nothing; a hub that takes the channel's word for its proof accepts it and fails this test`, () => {
  it(`${AC[5]} channel@1's planted signed-without-signature fails the kit`, async () => {
    await plantedFails('signed-without-signature');
  });
});
