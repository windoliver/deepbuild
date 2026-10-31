// AC9: with the market key used by the price source, the five-minute schedule and a check the plug-in registers,
// removing it on the trusted path first lists exactly those three as going BLOCKED and changes nothing until you
// confirm, and cancelling leaves the key in the OS secret store; a remove that deletes at once, or a list that leaves
// one out, fails, naming what's missing.
//
// The market plug-in declares the three: ext.market.price names the key, ext.market.watch declares the price among
// its readings, and ext.market.above_target is registered with the price as a reading it needs. The OS secret store is
// the in-memory one the host is given. Cancelling is closing the list without a yes: nothing else is called.
import { describe, expect, it } from 'vitest';
import type { ExtensionHost } from '../../../packages/extension-host/src/index.ts';
import { ABOVE, at, KEY, marketWorld, MARKET_ID, MINUTE, PRICE, priceProvider, runsOf, step, WATCH, YOU } from './helpers.ts';
import { judgeRemoval } from './judges.ts';
import { deletesAtOnce, leavesOneOut } from './twins.ts';

const THREE = [PRICE, WATCH, ABOVE];
const T = (hm: string) => at(`2026-11-03T${hm}`);

async function listed(remove?: (h: ExtensionHost, store: Parameters<typeof deletesAtOnce>[1]) => ExtensionHost['removeSecret']) {
  const { c, h, store } = await marketWorld(T('09:55'), { cadence: { every: 5 * MINUTE } }, (c) => priceProvider(c));
  await step(h, c, T('09:55'), T('10:01'));
  const removeSecret = remove ? remove(h, store) : h.removeSecret.bind(h);
  const list = await removeSecret(YOU, MARKET_ID, 'market_key');
  return { c, h, store, list, held: store.holds(KEY), removeSecret };
}

describe('AC9 #365.faeb616a With the market key used by the price source, the five-minute schedule and a check the plug-in registers, removing it on the trusted path first lists exactly those three as going BLOCKED and changes nothing until you confirm, and cancelling leaves the key in the OS secret store; a remove that deletes at once, or a list that leaves one out, fails, naming what\'s missing', () => {
  it('AC9 the remove lists exactly the source, the schedule and the check; until your yes nothing changes, and cancelling leaves the key; your yes to that list removes it', async () => {
    const { c, h, store, list, held } = await listed();
    expect(list.removed, 'the first answer only lists').toBe(false);
    expect(judgeRemoval(list.blocked, THREE, held)).toEqual([]);

    // Cancelled: nothing changed. The source still reads, and the schedule's next run passes.
    expect(store.holds(KEY), 'the key, after cancelling').toBe(true);
    expect((await h.readSource(PRICE)).status, 'the price source after cancelling').toBe('reading');
    await step(h, c, T('10:02'), T('10:06'));
    const next = (await runsOf(h, WATCH)).find((r) => r.dispatched === T('10:05'));
    expect(next?.verdict, `the 10:05 run after cancelling: ${JSON.stringify(next)}`).toBe('PASS');

    // A yes naming another list removes nothing; a yes naming exactly what was listed removes the key.
    const partial = await h.removeSecret(YOU, MARKET_ID, 'market_key', { yes: [PRICE, WATCH] });
    expect(partial.removed, 'a yes that leaves the check out').toBe(false);
    expect(store.holds(KEY), 'the key, after a yes naming another list').toBe(true);
    const done = await h.removeSecret(YOU, MARKET_ID, 'market_key', { yes: list.blocked });
    expect(done.removed, 'your yes to the list').toBe(true);
    expect(store.holds(KEY), 'the key, after your yes').toBe(false);
  }, 120_000);

  it('AC9 (wrong program) a remove that deletes the key at once fails, naming the key leaving the store before your yes', async () => {
    const { list, held } = await listed(deletesAtOnce);
    expect(judgeRemoval(list.blocked, THREE, held).join('\n')).toMatch(/the key left the OS secret store before your yes/);
  }, 120_000);

  it('AC9 (wrong program) a list that leaves the check out fails, naming the check', async () => {
    const { list, held } = await listed((h) => leavesOneOut(h, ABOVE));
    expect(judgeRemoval(list.blocked, THREE, held).join('\n')).toMatch(new RegExp(`the list of what goes BLOCKED leaves out ${ABOVE.replaceAll('.', '\\.')}`));
  }, 120_000);
});
