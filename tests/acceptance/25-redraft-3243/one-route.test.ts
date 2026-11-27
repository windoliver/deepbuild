import { afterAll, describe, expect, it } from 'vitest';
import { answer, answerIds, assistantSays, carries, carriers, cleanup, firedShown, payload, waitFor } from '../25/routes/helpers.ts';
import { heldAsk, replyText, starvedIf, stopBeside, stopWithAskOpen, untilFed } from './asking.ts';

afterAll(cleanup, 60_000);

describe('AC4 #25.1eae4ef9 An answer that lands while the session\'s stop is held and its waiter is alive goes back through the Stop hold only', () => {
  it('AC4 #25.1eae4ef9 with the stop held and the waiter alive, the answer goes back by the Stop hold only, the waiter exits without waking, and the transcript shows its ID once', async (ctx) => untilFed(ctx, 'AC4', async (t) => {
    const { hub, home, claude } = t;
    const a = await heldAsk(t);
    expect(a.created.data?.provisional, `AC4 a choice with no recommended option waits on you, so it isn't provisional: ask.created ${JSON.stringify(a.created.data).slice(0, 800)}`).not.toBe(true);
    expect(replyText(a), `AC4 deep_ask must not tell the agent to go on with an option nobody chose: ${replyText(a).slice(0, 800)}`).not.toMatch(/provisional/);

    const stop = await stopWithAskOpen(t, a);
    const ended = await starvedIf(t, stop, 'held');
    expect(ended, `AC4 the Stop of a session whose question ${a.handle} is open must be held for your answer; it ended before you answered: ${ended ? firedShown(await stop.stopping) : ''}`).toBe(false);
    const waiting = (await claude.liveWaiters(a.s.id)).some((r) => r.pid === stop.waiter.pid);
    expect(waiting, `AC4 the waiter (pid ${stop.waiter.pid}) must still be waiting while the stop is held, so the answer lands with both routes open`).toBe(true);

    await answer(home, a.handle, a.green.id);
    const fired = await stop.stopping;
    if (!(fired.blocked !== undefined && carries(fired.blocked, a.green))) await starvedIf(t, stop, 'answered');
    const exited = await waitFor(async () => (await claude.background()).find((r) => r.pid === stop.waiter.pid && r.ended !== null), 60_000, 'the waiter\'s exit').catch(() => undefined);

    const routes: string[] = [];
    if (fired.blocked !== undefined && carries(fired.blocked, a.green)) routes.push('the Stop hold (decision: block)');
    if (exited?.code === 2) routes.push(`the waiter (exit 2${carries(exited.stderr, a.green) ? ' with the answer' : ''})`);
    expect(routes, `AC4 ${a.handle} must go back through exactly one route, the Stop hold; it went by ${routes.length ? routes.join(' and ') : 'neither route'}: ${firedShown(fired)}; waiter ${JSON.stringify(exited ?? 'still running').slice(0, 600)}`).toEqual(['the Stop hold (decision: block)']);
    expect(exited, `AC4 once the Stop hold took ${a.handle}, the waiter (pid ${stop.waiter.pid}) must exit without waking; it was still running 60 s after the answer`).toBeDefined();

    assistantSays(a.s, `You chose ${a.green.label}; the header is green now.`);
    const continued = await stopBeside(t, a.s, payload(a.s, 'Stop', { stop_hook_active: true, last_assistant_message: `You chose ${a.green.label}; the header is green now.` }));
    const next = await continued.stopping;
    await starvedIf(t, continued, 'next');
    expect(next.blocked !== undefined && carries(next.blocked, a.green), `AC4 ${a.handle} went back through the Stop hold twice: the continued turn's Stop was sent back with it again: ${firedShown(next)}`).toBe(false);
    const woke = claude.wakes.filter((w) => w.session === a.s.id);
    expect(woke.map((w) => ({ pid: w.pid, code: w.code, stderr: w.stderr.slice(0, 300) })), `AC4 ${a.handle} went back by the Stop hold, so no waiter may wake the session with it`).toEqual([]);

    const ids = await answerIds(hub, a.id);
    const shown = carriers(a.s, ids);
    expect(shown.length, `AC4 the transcript must show the answer's ID (${ids.join(' or ')}) once; it shows it in ${shown.length} entries: ${JSON.stringify(shown).slice(0, 2000)}`).toBe(1);
  }), 900_000);
});
