import { afterAll, describe, expect, it } from 'vitest';
import { answer, assistantSays, carries, cleanup, firedShown, ours, payload } from '../25/routes/helpers.ts';
import { heldAsk, replyText, starvedIf, stopBeside, stopWithAskOpen, untilFed } from './asking.ts';

afterAll(cleanup, 60_000);

describe('AC1 #25.0215da31 A held stop continues with the answer', () => {
  it('AC1 #25.0215da31 an answer given while the stop is held comes back as that Stop\'s decision: block, and the turn goes on with it', async (ctx) => untilFed(ctx, 'AC1', async (t) => {
    const { home } = t;
    const a = await heldAsk(t);
    expect(a.created.data?.provisional, `AC1 a choice with no recommended option waits on you, so it isn't provisional: ask.created ${JSON.stringify(a.created.data).slice(0, 800)}`).not.toBe(true);
    expect(replyText(a), `AC1 deep_ask must not tell the agent to go on with an option nobody chose: ${replyText(a).slice(0, 800)}`).not.toMatch(/provisional/);

    const stop = await stopWithAskOpen(t, a);
    const ended = await starvedIf(t, stop, 'held');
    expect(ended, `AC1 the Stop of a session whose question ${a.handle} is open must be held for your answer; it ended before you answered: ${ended ? firedShown(await stop.stopping) : ''}`).toBe(false);

    await answer(home, a.handle, a.green.id);
    const fired = await stop.stopping;
    if (!(fired.blocked !== undefined && carries(fired.blocked, a.green))) await starvedIf(t, stop, 'answered');
    for (const r of ours(fired).filter((x) => !x.async)) {
      expect({ timedOut: r.timedOut, code: r.code }, `AC1 DeepBuild's Stop entry answers before Claude Code's timeout, exit 0: ${firedShown(fired)}`).toEqual({ timedOut: false, code: 0 });
    }
    expect(fired.blocked !== undefined && carries(fired.blocked, a.green), `AC1 the held stop must continue with the answer: Claude Code's Stop must get decision: block whose reason carries ${a.green.label} (${a.green.id}) for ${a.handle}; it got ${fired.blocked === undefined ? 'no decision: block' : 'a block without it'}: ${firedShown(fired)}`).toBe(true);

    assistantSays(a.s, `You chose ${a.green.label}; the header is green now.`);
    const continued = await stopBeside(t, a.s, payload(a.s, 'Stop', { stop_hook_active: true, last_assistant_message: `You chose ${a.green.label}; the header is green now.` }));
    const next = await continued.stopping;
    await starvedIf(t, continued, 'next');
    expect(next.blocked !== undefined && carries(next.blocked, a.green), `AC1 the answer continues the held stop once: the continued turn's Stop must not be sent back with it again: ${firedShown(next)}`).toBe(false);
  }), 900_000);
});
