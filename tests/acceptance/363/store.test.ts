// AC4: rolling a plug-in's code back keeps its store readable, and its data migrations only move forward.
//
// The stocks plug-in's store ext.stocks.alert: version 1.0.0 declares generation 1 ({ symbol, above }); 2.0.0 declares
// generation 2, adding `note`, with a forward migration from 1 that sets it to null. Generation 1's schema doesn't
// close its objects, so it reads generation 2's items (README, Readings: rolling back). list-alerts returns each item as
// the store holds it.
import { describe, expect, it } from 'vitest';
import { ALERT, alerts, call, done, installAndLoad, openHost, openWorld, pkg, STOCKS, tryInstall } from './helpers.ts';

describe('AC4 #363.b6b1737b Rolling a plug-in\'s code back keeps its store readable, and its data migrations only move forward', () => {
  it('AC4 1.0.0 → 2.0.0 migrates the alert forward; rolling the code back to 1.0.0 reads it as generation 2 left it, and nothing is written back', async () => {
    const w = await openWorld();
    const h = await openHost(w);
    const v1 = await pkg('stocks');
    await installAndLoad(h, v1);
    await done(call(h, 'ext.stocks.set_alert', { symbol: 'NVDA', above: 200 }), 'set-alert NVDA at 200 at 1.0.0');
    expect(await alerts(h, '1.0.0'), 'generation 1 holds the alert').toEqual({ NVDA: { symbol: 'NVDA', above: 200 } });

    await installAndLoad(h, await pkg('stocks', { manifest: { version: '2.0.0' }, probe: { generation: 2 } }));
    expect(await alerts(h, '2.0.0'), 'loading 2.0.0 migrated the alert forward to generation 2').toEqual({ NVDA: { symbol: 'NVDA', above: 200, note: null } });
    const migrated = (await w.events(ALERT)).length;

    // Roll the code back: 1.0.0's bytes again.
    await installAndLoad(h, v1);
    expect((await h.loaded()).find((l) => l.id === STOCKS)?.version, 'the rolled-back code runs').toBe('1.0.0');
    expect(await alerts(h, '1.0.0'), 'the rolled-back code reads the store, kept at generation 2').toEqual({ NVDA: { symbol: 'NVDA', above: 200, note: null } });
    expect((await w.events(ALERT)).length, 'the rollback migrated nothing back: no store item was written').toBe(migrated);
  }, 120_000);

  it('AC4 a version whose migration runs from generation 2 back to 1 never moves the data back: refused naming the store kind, or the items stay as generation 2 left them', async () => {
    const w = await openWorld();
    const h = await openHost(w);
    await installAndLoad(h, await pkg('stocks'));
    await done(call(h, 'ext.stocks.set_alert', { symbol: 'NVDA', above: 200 }), 'set-alert NVDA at 200 at 1.0.0');
    await installAndLoad(h, await pkg('stocks', { manifest: { version: '2.0.0' }, probe: { generation: 2 } }));
    const migrated = (await w.events(ALERT)).length;

    const back = await tryInstall(h, await pkg('stocks', { manifest: { version: '3.0.0' }, probe: { backward: true } }));
    if (!back.ok) {
      expect(back.reason, 'the refusal of a backward migration names the store kind').toContain(ALERT);
      expect(await alerts(h, '2.0.0'), 'refused, 2.0.0 still runs and reads the store as it was').toEqual({ NVDA: { symbol: 'NVDA', above: 200, note: null } });
    } else {
      expect(await alerts(h, '3.0.0'), 'the backward migration didn\'t run: the items stay at generation 2').toEqual({ NVDA: { symbol: 'NVDA', above: 200, note: null } });
    }
    expect((await w.events(ALERT)).length, 'no store item was written back').toBe(migrated);
  }, 120_000);
});
