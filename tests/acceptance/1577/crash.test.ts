// #1577 AC7: a crash between a write and its commit leaves nothing held. The hub starts with the crash seam
// DEEP_HUB_TEST_CRASH=before:ask.answered (README, Test-only settings), so it kills itself after reading an answer
// with its request ID and before the answer and its receipt commit; it starts again without the seam, and the
// device sends the same frame again. The planted pending-across-restart hub fails this test (README, Wrong programs).
import { afterEach, describe, expect, it } from 'vitest';
import { AC, cleanup, eventsOf, inboxRow, requestId, restart, said, sendOnce, signedBy, sleep, tag, world } from './helpers.ts';

afterEach(cleanup, 60_000);

describe(`${AC[7]} The hub killed after reading an answer with its request ID and before its commit: the same ID sent again after the restart applies once, and the record holds one ask.answered`, () => {
  it(`${AC[7]} an answer cut by the hub's own SIGKILL before its commit, sent again with its request ID after the restart, applies once`, async () => {
    const w = await world({
      asks: [{ source: 'deep_ask.choice', question: `Keep the cache on SQLite or plain files? (${tag()})` }],
      once: { DEEP_HUB_TEST_CRASH: 'before:ask.answered' },
    });
    const ask = w.asks[0]!.handle;
    const request = requestId();
    const frame = await signedBy(w, w.a, 'ask.answer', { ask, option: 'sqlite', request });
    const exited = w.hub.proc.exit;
    const cut = await sendOnce(w, 'ask.answer', frame).catch((error: unknown) => ({ lost: error instanceof Error ? error.message : String(error) }));
    const exit = await Promise.race([exited, sleep(30_000).then(() => undefined)]);
    expect(exit?.signal, `the hub must kill itself at DEEP_HUB_TEST_CRASH=before:ask.answered, after reading ${ask}'s answer with the request ID ${request} and before its commit; it ${exit ? `exited ${JSON.stringify(exit)}` : 'kept running'} and answered ${JSON.stringify(cut)}`).toBe('SIGKILL');
    await restart(w);
    const before = await eventsOf(w, 'ask.answered', ask);
    expect(before, `the crash came before the answer's commit, so the record holds no answer for ${ask} yet: ${said(before)}`).toEqual([]);
    // The device never got a reply, so it sends the very same frame again once the hub is back.
    const retry = await sendOnce(w, 'ask.answer', frame);
    expect(retry.error, `the same frame with the request ID ${request}, sent after the restart, must apply: nothing of the write the crash cut outlives the hub, so it is never answered as still in progress; the hub refused it: ${JSON.stringify(retry.error)}`).toBeUndefined();
    const answered = await eventsOf(w, 'ask.answered', ask);
    expect(answered.map((e) => e.data.answer), `the record must hold one ask.answered for ${ask}: ${said(answered)}`).toEqual(['sqlite']);
    expect((await inboxRow(w, ask))?.outcome, `${ask} must read answered in the inbox`).toBe('answered');
  });
});
