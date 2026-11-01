// AC1 #27.778c531d The idle session wakes and uses the answer (fast; session.live.test.ts runs it on a real session).
//
// A session in the repo asks you through deep_ask and stops; the hold ends with nothing answered, so it is idle, its
// waiter waiting. You answer from the CLI with `deep inbox answer`. Claude Code (the stand-in) starts a turn for the
// waiter's exit 2, and that turn's prompt carries your answer; the agent uses it (its reply names the chosen colour),
// and the stop that ends the turn isn't held or sent back with the same answer again. The record says delivered and
// acknowledged, once, and nothing else about it (README: Readings, 1).
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC1, answer, assistantSays, carries, cleanup, firedShown, idleSessions, makeHome, makeRepo, outcomeList, outcomes, payload, setup,
  startHub, waitFor, within,
} from './helpers.ts';

afterAll(cleanup, 60_000);

describe(`${AC1} The idle session wakes and uses the answer`, () => {
  it(`${AC1} an answer typed in the CLI wakes the idle session with a turn that carries it; the agent's reply uses it, it is delivered once and the next stop isn't sent back with it again`, async () => {
    const { home } = makeHome();
    const repo = makeRepo(home);
    const hub = await startHub(home, { noAskWait: true, shortHold: true });
    await setup(home);
    const [a] = await idleSessions(hub, home, 1, { cwd: repo.dir });
    const { claude, s } = a!;

    const typed = await answer(home, a!.handle, a!.green.id);
    expect(typed.stdout, `${AC1} deep inbox answer says what it recorded`).toContain(a!.handle);
    const wake = await within(30_000, () => claude.wakes.find((w) => w.session === s.id && !w.dropped));
    expect(wake, `${AC1} idle session ${s.id} never woke within 30 s of your answer to ${a!.handle} (${a!.green.label}); waiter runs: ${JSON.stringify((await claude.background()).map((r) => ({ code: r.code, stderr: r.stderr.slice(0, 300) })))}`).toBeDefined();
    expect(carries(wake!.prompt ?? '', a!.green), `${AC1} the woken turn's prompt must carry your answer to ${a!.handle}, ${a!.green.label}; it was ${JSON.stringify(wake!.prompt ?? '').slice(0, 600)}`).toBe(true);
    expect(carries(wake!.prompt ?? '', a!.blue) && !carries(wake!.prompt ?? '', a!.green), `${AC1} the woken turn carries the option you chose, not the other`).toBe(false);

    // The agent uses it: its reply is the colour you chose, and its stop ends the turn with nothing sent back again.
    assistantSays(s, `Going with ${a!.green.label}.`);
    const stop = await claude.hook('Stop', payload(s, 'Stop', { stop_hook_active: true, prompt_id: wake!.promptId, last_assistant_message: `Going with ${a!.green.label}.` }));
    expect(stop.blocked ?? '', `${AC1} the stop after the woken turn must not be held or sent back with ${a!.handle}'s answer again: ${firedShown(stop)}`).not.toContain(a!.green.label);

    const delivered = await waitFor(async () => (await outcomes(hub, a!.id)).find((e) => e.data?.outcome === 'delivered'), 20_000, `${a!.handle}'s delivery`).catch(() => undefined);
    const all = await outcomes(hub, a!.id);
    expect(delivered, `${AC1} the record must say your answer to ${a!.handle} was delivered and acknowledged once the woken turn showed it; outcomes: ${outcomeList(all)}`).toBeDefined();
    expect(all.filter((e) => e.data?.outcome === 'delivered'), `${AC1} ${a!.handle} is delivered once: ${outcomeList(all)}`).toHaveLength(1);
    expect(all.filter((e) => e.data?.outcome !== 'delivered'), `${AC1} a delivery the turn showed reads delivered, never stalled, timed out or replaced: ${outcomeList(all)}`).toEqual([]);
  }, 300_000);
});
