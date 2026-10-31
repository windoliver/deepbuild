// AC4: with the app closed, deep_show of the same figure still returns presented with a snapshot from the headless worker, equal by pixel
// hash to the snapshot taken with the app open; a hub that waits for the app instead returns not presented after 2 s and fails, naming
// the call. "Closed" is no app connected to the hub: the app's replica is stopped by its PID. The figure goes on two documents of the
// same session so the second call is not a re-send of the first.
import { afterEach, describe, expect, it } from 'vitest';
import { REPLY_BOUND_MS, cleanup, closedFailures, PLANT_WAITS, requireMacos, sleep, t393, useApp } from './helpers.ts';
import { CLAUDE, expectPresented, openFigures, showFigure } from './figure.ts';

afterEach(cleanup, 60_000);
const appReady = useApp();

async function twice(plant?: string) {
  const f = await openFigures({ app: true, ...(plant ? { plant } : {}) });
  const open = await showFigure(f, CLAUDE, t393.DOC.a);
  await f.app!.sync();
  await f.app!.stop();
  // The hub notices the app's connection end; the app is closed from here on.
  await sleep(500);
  const closed = await showFigure(f, CLAUDE, t393.DOC.b);
  return { f, open: { reply: open.reply, ms: open.ms }, closed: { reply: closed.reply, ms: closed.ms } };
}

describe('AC4 with the app closed, deep_show of the same figure still returns presented with a snapshot from the headless worker, equal by pixel hash to the one taken with the app open', () => {
  it('AC4 with the app open the figure is presented with a snapshot; with it closed deep_show answers presented within 2 s with a snapshot of the same pixel hash', async () => {
    requireMacos();
    appReady();
    const { f, open, closed } = await twice();
    await expectPresented(f, CLAUDE, open.reply);
    expect(closed.reply['outcome'], `with the app closed: presented (${JSON.stringify(closed.reply).slice(0, 400)})`).toBe('presented');
    expect(closed.reply['rev'], 'at revision 1 of its document').toBe(1);
    expect(await closedFailures(f.home, open, closed), 'a snapshot from the headless worker equal by pixel hash to the app-open one, within 2 s').toEqual([]);
    expect(closed.ms, `answered within ${REPLY_BOUND_MS} ms of scheduling slack`).toBeLessThanOrEqual(REPLY_BOUND_MS + 750);
  }, 600_000);

  it('AC4 a hub that waits for the app instead returns not presented after 2 s and fails, naming the call', async () => {
    requireMacos();
    appReady();
    const { f, open, closed } = await twice(PLANT_WAITS);
    expect(closed.reply['outcome'], 'the planted hub does not present with the app closed').toBe('not_presented');
    expect(closed.ms, `and answers only after 2 s (${Math.round(closed.ms)} ms)`).toBeGreaterThanOrEqual(REPLY_BOUND_MS - 100);
    const failures = await closedFailures(f.home, open, closed);
    expect(failures.length, 'the check fails on the planted hub').toBeGreaterThan(0);
    expect(failures.join('\n'), 'naming the call').toContain('deep_show');
    expect(failures.join('\n'), 'and what it answered').toContain('not_presented');
  }, 600_000);
});
