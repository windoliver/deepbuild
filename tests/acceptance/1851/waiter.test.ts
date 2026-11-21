// #1851: deep-hook's waiter waits for its session's answers on a credential bound to its own session, never with the
// control token (README). Each test starts its own hub in a temporary home, runs `deep setup`, and drives the real
// `deep-hook claude-code waiter` that setup's Stop entry names.

import { availableParallelism, loadavg } from 'node:os';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  beginAsk, carries, cleanup, firedShown, idleSessions, loadReading, makeHome, payload, setup, sleep, startHub, waitFor, type Asking, type Wake,
} from '../25/routes/helpers.ts';
import { answerAsYou, eventsWith, headWith, heldToken, outsiderWaiter, refusalNaming, runOf, stopGroups, waiterUnder } from './helpers.ts';

afterEach(async () => { stopGroups(); await cleanup(); }, 60_000);

/** Up to this long, after an answer, for a waiter that should not get it to show that it did (and for the right one to wake). */
const NEVER_MS = 15_000;

async function world(): Promise<{ home: string; hub: Awaited<ReturnType<typeof startHub>>; token: string }> {
  const { home } = makeHome();
  // shortHold: a stop held with nothing answered goes through after 5 s, so a session is idle soon (#25's suite).
  const hub = await startHub(home, { noAskWait: true, shortHold: true });
  await setup(home);
  return { home, hub, token: heldToken(hub) };
}

describe('#1851 the waiter waits on its own session without the control token', () => {
  it('AC1 #1851.94c55f89 with control.token removed after the hub starts, an answer to an idle Claude Code session is still delivered by the waiter within 2 s', async (ctx) => {
    const { home, hub, token } = await world();
    const a = await (await beginAsk(hub, home)).finish();

    // The token is removed after the hub started, before the Stop that starts the session's waiter.
    rmSync(join(hub.root, 'control.token'));
    const stop = await a.claude.hook('Stop', payload(a.s, 'Stop', { last_assistant_message: 'I asked which header colour you want; I will wait for your answer.' }));
    expect(stop.blocked, `nothing is answered yet, so ${a.s.id}'s stop goes through: ${firedShown(stop)}`).toBeUndefined();
    await waitFor(async () => (await a.claude.liveWaiters(a.s.id)).length > 0 || undefined, 30_000, `the waiter Claude Code started at ${a.s.id}'s Stop`);
    // Give the waiter time to connect and wait: it starts with no token to read.
    await sleep(3000);
    expect(existsSync(join(hub.root, 'control.token')), 'control.token stays removed while the waiter waits').toBe(false);

    const r = await answerAsYou(hub, token, a.handle, a.green.id);
    const wake = await waitFor(() => a.claude.wakes.find((w: Wake) => w.session === a.s.id && !w.dropped), 30_000, `${a.s.id} waking`).catch(() => undefined);
    const waiters = await a.claude.liveWaiters(a.s.id);
    expect(wake, `AC1 with control.token removed after the hub started, your answer to ${a.handle} (session ${a.s.id}, idle) must be delivered by its waiter (exit 2); no waiter exited 2 within 30 s of the answer. Live waiters: ${JSON.stringify(waiters.map((w) => ({ pid: w.pid, stderr: w.stderr.slice(0, 400) })))}`).toBeDefined();
    expect(carries(`${wake!.stderr}\n${wake!.prompt ?? ''}`, a.green), `AC1 the waiter's exit 2 for ${a.handle} carries its answer: stderr ${JSON.stringify(wake!.stderr.slice(0, 400))}`).toBe(true);
    const ms = Math.max(0, wake!.at - r.ended);
    const text = `AC1 ${a.handle}: the waiter exited 2 ${ms} ms after your answer was accepted, against 2000 ms`;
    console.log(text);
    if (ms > 2000 && loadavg()[0]! > availableParallelism()) ctx.skip(`INCONCLUSIVE ${text}, read at ${loadReading()}`);
    expect(ms, `${text}, at ${loadReading()}`).toBeLessThanOrEqual(2000);
  });

  it('AC2 #1851.57086353 a waiter started for session A that asks to wait on session B is refused, naming the binding, and B answer never reaches A', async () => {
    const { home, hub, token } = await world();
    const [A, B] = (await idleSessions(hub, home, 2)) as [Asking, Asking];

    // Under A's agent, the real waiter is handed a Stop payload naming B: a waiter of A's asking to wait on B.
    const head = await headWith(hub, token);
    const outputFrom = hub.output().length;
    const forged = await waiterUnder(A.claude, home, B.s);
    await sleep(3000);

    await answerAsYou(hub, token, B.handle, B.green.id);
    const deadline = Date.now() + NEVER_MS;
    let reached: string | undefined;
    let bWoke: Wake | undefined;
    for (; Date.now() < deadline && !reached; await sleep(200)) {
      const run = await runOf(A.claude, forged.pid);
      const aWake = A.claude.wakes.find((w: Wake) => w.pid === forged.pid || w.session === B.s.id);
      if (run && (run.code === 2 || carries(run.stderr, B.green))) reached = `the waiter (pid ${forged.pid}) under A's agent exited ${run.code} with stderr ${JSON.stringify(run.stderr.slice(0, 400))}`;
      else if (aWake) reached = `A's Claude Code (pid ${A.claude.pid}) was woken for ${aWake.session} with ${JSON.stringify(aWake.stderr.slice(0, 400))}`;
      bWoke ??= B.claude.wakes.find((w: Wake) => w.session === B.s.id && !w.dropped);
      if (bWoke && Date.now() > deadline - NEVER_MS + 5000) break;
    }
    expect(reached, `AC2 session B ${B.s.id}'s answer to ${B.handle} must never reach the waiter started under session A ${A.s.id}'s agent (pid ${A.claude.pid}) that asked to wait on B; it did: ${reached}`).toBeUndefined();
    expect(bWoke, `AC2 B's answer to ${B.handle} goes to B's own waiter, which wakes B ${B.s.id}, within ${NEVER_MS / 1000} s`).toBeDefined();

    const run = await runOf(A.claude, forged.pid);
    const where = refusalNaming({
      waiterStderr: run?.stderr ?? '', hubOutput: hub.output().slice(outputFrom),
      events: (await eventsWith(hub, token)).filter((e) => e.log_pos > head),
      needles: [A.s.id, String(A.claude.pid)], alsoInEvent: [B.s.id],
    });
    expect(where, `AC2 the waiter under A's agent asking to wait on B is refused, naming the binding (session A ${A.s.id} or its agent process ${A.claude.pid}), in the waiter's stderr, the hub's output or the record; none did. The waiter: ${JSON.stringify({ code: run?.code, ended: run?.ended, stderr: run?.stderr.slice(0, 400) })}`).toBeDefined();
  });

  it('AC3 #1851.c180d03e a process that is not a child of the session agent, saying hello as that session waiter, is refused, naming the process', async () => {
    const { home, hub, token } = await world();
    const [A] = (await idleSessions(hub, home, 1)) as [Asking];
    // A waiter whose parent is a print run (`-p`) is done at once (#668): this test process isn't one, so the outsider waits.
    expect([...process.execArgv, ...process.argv].some((x) => x === '-p' || x === '--print'), 'BLOCKED: this test process runs as a print run').toBe(false);

    const head = await headWith(hub, token);
    const outputFrom = hub.output().length;
    const outsider = outsiderWaiter(home, A.s);
    await sleep(3000);
    const early = outsider.exited();
    if (early && (early.code === 126 || early.code === 127)) throw Error(`BLOCKED: the outsider waiter didn't start (exit ${early.code}): ${outsider.stderr().slice(0, 400)}`);

    await answerAsYou(hub, token, A.handle, A.green.id);
    const deadline = Date.now() + NEVER_MS;
    let reached: string | undefined;
    let aWoke: Wake | undefined;
    for (; Date.now() < deadline && !reached; await sleep(200)) {
      const exit = outsider.exited();
      if ((exit && exit.code === 2) || carries(outsider.stderr(), A.green)) reached = `the outsider waiter (pid ${outsider.pid}) exited ${exit?.code} with stderr ${JSON.stringify(outsider.stderr().slice(0, 400))}`;
      aWoke ??= A.claude.wakes.find((w: Wake) => w.session === A.s.id && !w.dropped);
      if (aWoke && Date.now() > deadline - NEVER_MS + 5000) break;
    }
    expect(reached, `AC3 session ${A.s.id}'s answer to ${A.handle} must never reach a waiter outside its agent's process tree (pid ${outsider.pid}, parent this test process ${process.pid}, not a child of agent ${A.claude.pid}); it did: ${reached}`).toBeUndefined();
    expect(aWoke, `AC3 the answer to ${A.handle} goes to the session's own waiter, which wakes ${A.s.id}, within ${NEVER_MS / 1000} s`).toBeDefined();

    const where = refusalNaming({
      waiterStderr: outsider.stderr(), hubOutput: hub.output().slice(outputFrom),
      events: (await eventsWith(hub, token)).filter((e) => e.log_pos > head),
      needles: [String(outsider.pid)],
    });
    expect(where, `AC3 the outsider (pid ${outsider.pid}) saying hello as ${A.s.id}'s waiter is refused, naming the process (its pid ${outsider.pid}), in its stderr, the hub's output or the record; none did. The outsider: ${JSON.stringify({ exited: outsider.exited(), stderr: outsider.stderr().slice(0, 400) })}`).toBeDefined();
  });
});
