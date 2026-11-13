// #1906 AC4: sharing the approval waiter must keep an unanswered update's default at no.
import { expect, it, vi } from 'vitest';
import { d1Digest } from '@deepbuild/contracts';
import { admit, makePackage, openHost, openWorld, releaseOf, waitUntil } from '../../../tests/acceptance/139/helpers.ts';

it('an update with no answer defaults to keeping the installed provider and its users', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    const shape = { type: 'object', properties: { value: { type: 'number' } }, required: ['value'], additionalProperties: false };
    const name = 'ext.prices.quote@1';
    const v1 = await makePackage({ id: 'acme/prices', version: '1.0.0', manifest: { requires: { preview: ['deep.provide'] }, provides: [{ interface: name, kind: 'reading', minor: 0 }] }, index: `export default (deep) => { deep.provide('${name}', 'reading', ${JSON.stringify(shape)}, async () => ({ value: 1 })); };` });
    const v2 = await makePackage({ id: 'acme/prices', version: '2.0.0', index: 'export default () => {};' });
    const consumer = await makePackage({ id: 'acme/stocks', manifest: { requires: { preview: ['deep.use'] }, uses: [{ interface: name, minor: 0, digest: d1Digest(shape) }] }, index: `export default (deep) => { deep.use('${name}'); };` });
    const world = await openWorld();
    const host = await openHost(world, { release: await releaseOf(v1, v2, consumer) });
    for (const dir of [v1, consumer]) expect(await admit(host, dir)).toMatchObject({ ok: true });
    const pending = host.install({ from: v2, builtBy: null }).then(() => 'installed', (e: Error) => e.message);
    const ask = await waitUntil(async () => (await world.asks.needsYou()).find((card) => JSON.stringify(card).includes('acme/stocks')), 10_000, 'the update approval');
    expect((await host.installed()).find((p) => p.id === 'acme/prices')?.version).toBe('1.0.0');
    vi.setSystemTime(Date.now() + 86_400_001);
    await world.asks.tick();
    expect((await world.asks.inbox()).find((row) => row.ask === ask.ask)?.outcome).toBe('defaulted');
    expect(await pending).toBe("acme/prices@2.0.0 isn't installed: you kept 1.0.0, so acme/stocks uses ext.prices.quote@1 keeps their provider");
    expect((await host.installed()).find((p) => p.id === 'acme/prices')?.version).toBe('1.0.0');
    expect(await host.edges()).toContainEqual(expect.objectContaining({ user: 'acme/stocks', uses: name, interface: name, provider: 'acme/prices' }));
    await host.close();
  } finally {
    vi.useRealTimers();
  }
}, 30_000);
