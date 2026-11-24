// AC4 #25.1eae4ef9 An answer that lands while the session's stop is held and its waiter is alive goes back through
// the Stop hold only, the waiter exits without waking, and the transcript shows the answer's ID once; a host that
// sends it by both routes fails this test, naming the routes.
//
// A session asks you a question its stop waits on (asking.ts: a choice with no recommended option) and stops with
// the ask open: Claude Code runs DeepBuild's held Stop entry and starts the waiter beside it. You answer with
// `deep inbox answer` while both are there. The routes are read at Claude Code's side: the Stop hold is the Stop's
// `decision: block` carrying the answer; the waiter's route is its exit 2, which wakes the session. The answer's ID
// is its ask's ID or its ask.answered event's; the transcript entries carrying it are counted, the agent's own
// deep_ask call and its result aside.
//
// A try where deep-hook failed open, as on a starved machine, is no verdict: it is made again, and reads INCONCLUSIVE
// after asking.ts's TRIES (README: A starved machine).

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
    await starvedIf(t, stop, 'held');
    expect(stop.settled(), `AC4 the Stop of a session whose question ${a.handle} is open must be held for your answer; it ended before you answered: ${stop.settled() ? firedShown(await stop.stopping) : ''}`).toBe(false);
    const waiting = (await claude.liveWaiters(a.s.id)).some((r) => r.pid === stop.waiter.pid);
    expect(waiting, `AC4 the waiter (pid ${stop.waiter.pid}) must still be waiting while the stop is held, so the answer lands with both routes open`).toBe(true);

    // You answer while the stop is held and the waiter is alive.
    await answer(home, a.handle, a.green.id);
    const fired = await stop.stopping;
    // A Stop the hub had on its record can still have been let through late; that try is no verdict either.
    if (!(fired.blocked !== undefined && carries(fired.blocked, a.green))) await starvedIf(t, stop, 'answered');
    // A bounded wait for the waiter's exit: a waiter that never exits fails below instead of hanging.
    const exited = await waitFor(async () => (await claude.background()).find((r) => r.pid === stop.waiter.pid && r.ended !== null), 60_000, 'the waiter\'s exit').catch(() => undefined);

    const routes: string[] = [];
    if (fired.blocked !== undefined && carries(fired.blocked, a.green)) routes.push('the Stop hold (decision: block)');
    if (exited?.code === 2) routes.push(`the waiter (exit 2${carries(exited.stderr, a.green) ? ' with the answer' : ''})`);
    expect(routes, `AC4 ${a.handle} must go back through exactly one route, the Stop hold; it went by ${routes.length ? routes.join(' and ') : 'neither route'}: ${firedShown(fired)}; waiter ${JSON.stringify(exited ?? 'still running').slice(0, 600)}`).toEqual(['the Stop hold (decision: block)']);
    expect(exited, `AC4 once the Stop hold took ${a.handle}, the waiter (pid ${stop.waiter.pid}) must exit without waking; it was still running 60 s after the answer`).toBeDefined();

    // The turn goes on with the answer and stops; its new waiter starts, and nothing woke the session with the answer.
    assistantSays(a.s, `You chose ${a.green.label}; the header is green now.`);
    const continued = await stopBeside(t, a.s, payload(a.s, 'Stop', { stop_hook_active: true, last_assistant_message: `You chose ${a.green.label}; the header is green now.` }));
    const next = await continued.stopping;
    await starvedIf(t, continued, 'next');
    expect(next.blocked !== undefined && carries(next.blocked, a.green), `AC4 ${a.handle} went back through the Stop hold twice: the continued turn's Stop was sent back with it again: ${firedShown(next)}`).toBe(false);
    const woke = claude.wakes.filter((w) => w.session === a.s.id);
    expect(woke.map((w) => ({ pid: w.pid, code: w.code, stderr: w.stderr.slice(0, 300) })), `AC4 ${a.handle} went back by the Stop hold, so no waiter may wake the session with it`).toEqual([]);

    // The transcript shows the answer's ID once.
    const ids = await answerIds(hub, a.id);
    const shown = carriers(a.s, ids);
    expect(shown.length, `AC4 the transcript must show the answer's ID (${ids.join(' or ')}) once; it shows it in ${shown.length} entries: ${JSON.stringify(shown).slice(0, 2000)}`).toBe(1);
  }), 900_000);
});
