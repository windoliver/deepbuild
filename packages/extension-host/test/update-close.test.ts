// #1906: a recorded decline still says which version was kept when the host closes before its next poll.
import { expect, it } from 'vitest';
import { d1Digest } from '@deepbuild/contracts';
import { shownPlanHash } from '../../../tests/acceptance/plans.ts';
import { admit, makePackage, openHost, openWorld, releaseOf, waitUntil, YOU } from '../../../tests/acceptance/139/helpers.ts';

it('a declined update reports the kept provider even if the host closes before the waiter resumes', async () => {
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
  const card = await world.asks.card(ask.ask);
  const no = card.options.find((option) => option.decision === 'deny')!;
  await world.asks.answer(YOU, ask.ask, { option: no.id, plan_hash: await shownPlanHash(world.asks, ask.ask), token: 'decline-update' });
  const closing = host.close();
  expect(await pending).toBe("acme/prices@2.0.0 isn't installed: you kept 1.0.0, so acme/stocks uses ext.prices.quote@1 keeps their provider");
  await closing;
});
