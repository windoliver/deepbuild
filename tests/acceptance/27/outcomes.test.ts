// AC4 #27.e6116d56, the issue's "Added Oct 9" cases: the four delivery outcomes in scripted sessions, a waiter that
// outlives its session, and a stop held while a Claude subagent is still running. "Done when: each case reports the
// right outcome and none reads as finished." (README: Readings, 5.)
//
// Delivered is wake.test.ts's (AC1) and stalled desktop.test.ts's (AC3); the two outcomes no other file reaches are here:
//   - timed out: the waiter took your answer and exited 2, and the session couldn't be read to tell whether a turn
//     carried it (its transcript unreadable), so nothing proves it arrived or didn't: `timed_out`, never `stalled` or
//     `delivered`; once the session can be read again, your next prompt carries it, once;
//   - replaced: the waiter took your answer and exited 2, and before any turn showed it the session's ID was replaced
//     (`/clear`): `replaced` for the old ID, never `stalled`, and the new ID of the same thread gets it at its
//     SessionStart, once.
import { randomUUID } from 'node:crypto';
import { chmodSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC4, Claude, answer, beginAsk, callId, carries, cleanup, firedShown, groupOf, idleSessions, makeHome, makeRepo, outcomeList,
  outcomes, payload, replied, setup, sleep, startHub, stateOf, typedPrompt, waitFor, within, type Asking, type Fired, type Hub, type Session,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const settled = async (hub: Hub, a: Asking) => outcomeList(await outcomes(hub, a.id));

/** An idle session in the repo whose app doesn't start a turn when the waiter exits 2 (README: Stand-ins). */
async function idleInApp(hub: Hub, home: string, cwd: string): Promise<Asking> {
  const app = Claude.start(home);
  await app.configure({ wake: false });
  const a = await (await beginAsk(hub, home, { cwd, claude: app })).finish();
  const fired = await a.claude.hook('Stop', payload(a.s, 'Stop', { last_assistant_message: 'I asked which header colour you want; I will wait for your answer.' }));
  if (fired.blocked) throw Error(`BLOCKED: nothing is answered yet, so ${a.s.id}'s stop goes through: ${firedShown(fired)}`);
  await waitFor(async () => (await a.claude.liveWaiters(a.s.id)).length > 0 || undefined, 30_000, `the waiter of ${a.s.id}`).catch((e: Error) => { throw Error(`BLOCKED: ${e.message}`); });
  return a;
}

describe(`${AC4} the issue's Oct 9 cases: the four delivery outcomes, a waiter that outlives its session, a stop held while a subagent runs`, () => {
  it(`${AC4} (delivery outcome: timed out) an answer the waiter took, in a session that couldn't be read, reads timed_out, never stalled or delivered, and comes with the next prompt once the session can be read`, async () => {
    const { home } = makeHome();
    const repo = makeRepo(home);
    const hub = await startHub(home);
    await setup(home);
    const a = await idleInApp(hub, home, repo.dir);
    chmodSync(a.s.transcript, 0o000);
    try {
      await answer(home, a.handle, a.green.id);
      const exited = await within(30_000, () => a.claude.wakes.find((w) => w.session === a.s.id && carries(w.stderr, a.green)));
      expect(exited, `precondition: DeepBuild's waiter takes the answer to the idle session and exits 2 with it`).toBeDefined();
      const timedOut = await within(60_000, async () => (await outcomes(hub, a.id)).find((e) => e.data?.outcome === 'timed_out'));
      expect(timedOut, `${AC4} the waiter took ${a.handle} and ${a.s.id}'s transcript couldn't be read, so nothing proves whether a turn carried it: its delivery must read timed_out within 60 s; outcomes: ${await settled(hub, a)}`).toBeDefined();
      const others = (await outcomes(hub, a.id)).filter((e) => e.data?.outcome !== 'timed_out');
      expect(outcomeList(others), `${AC4} a delivery that timed out was neither shown stalled (nobody read the session) nor delivered`).toBe('none');
    } finally {
      chmodSync(a.s.transcript, 0o644);
    }
    typedPrompt(a.s, 'Did my answer reach you?');
    const next = await a.claude.hook('UserPromptSubmit', payload(a.s, 'UserPromptSubmit', { prompt: 'Did my answer reach you?' }));
    expect(carries(replied(next), a.green), `${AC4} once ${a.s.id} can be read and shows no turn with ${a.handle}, your next prompt carries it (${a.green.label}): ${firedShown(next)}`).toBe(true);
    const delivered = (await outcomes(hub, a.id)).filter((e) => e.data?.outcome === 'delivered');
    expect(delivered.length, `${AC4} ${a.handle} reads delivered once it came with the prompt, once: ${await settled(hub, a)}`).toBe(1);
  }, 300_000);

  it(`${AC4} (delivery outcome: replaced) an answer the waiter took, its session cleared before any turn showed it, reads replaced, never stalled, and reaches the cleared thread's new session at its start, once`, async () => {
    const { home } = makeHome();
    const repo = makeRepo(home);
    const hub = await startHub(home);
    await setup(home);
    const a = await idleInApp(hub, home, repo.dir);
    await answer(home, a.handle, a.green.id);
    const exited = await within(30_000, () => a.claude.wakes.find((w) => w.session === a.s.id && carries(w.stderr, a.green)));
    expect(exited, `precondition: DeepBuild's waiter takes the answer to the idle session and exits 2 with it`).toBeDefined();
    // /clear at once: the same Claude Code ends the old ID and starts a new one in the same folder (design: Threads, not IDs).
    await a.claude.hook('SessionEnd', payload(a.s, 'SessionEnd', { reason: 'clear' }));
    const id = randomUUID();
    const s2: Session = { id, cwd: a.s.cwd, transcript: join(dirname(a.s.transcript), `${id}.jsonl`) };
    writeFileSync(s2.transcript, '');
    const start: Fired = await a.claude.hook('SessionStart', payload(s2, 'SessionStart', { source: 'clear' }));
    const replaced = await within(30_000, async () => (await outcomes(hub, a.id)).find((e) => e.data?.outcome === 'replaced'));
    expect(replaced, `${AC4} ${a.s.id} was cleared before any turn showed ${a.handle}: its delivery must read replaced; outcomes: ${await settled(hub, a)}`).toBeDefined();
    expect((await outcomes(hub, a.id)).filter((e) => e.data?.outcome === 'stalled'), `${AC4} a replaced session's delivery isn't stalled`).toEqual([]);
    const carried = carries(replied(start), a.green);
    expect(carried, `${AC4} the cleared thread's new session ${s2.id} gets your answer to ${a.handle} (${a.green.label}) at its SessionStart: ${firedShown(start)}`).toBe(true);
    expect((await outcomes(hub, a.id)).filter((e) => e.data?.outcome === 'delivered').length, `${AC4} ${a.handle} is delivered once: ${await settled(hub, a)}`).toBe(1);
  }, 300_000);

  it(`${AC4} (a waiter that outlives its session) a headless session's Claude Code killed with its waiter waiting: the waiter is gone within 10 s, a later answer isn't counted delivered, and the session never reads as finished`, async () => {
    const { home } = makeHome();
    const repo = makeRepo(home);
    const hub = await startHub(home);
    await setup(home);
    const [a] = await idleSessions(hub, home, 1, { cwd: repo.dir });
    const [waiter] = await a!.claude.liveWaiters(a!.s.id);
    await a!.claude.kill();
    const gone = await within(10_000, () => groupOf(waiter!.pid).length === 0 || undefined);
    expect(gone, `${AC4} ${a!.s.id}'s Claude Code was killed; its waiter (pid ${waiter!.pid}) must not outlive it: still running 10 s on: ${JSON.stringify(groupOf(waiter!.pid))}`).toBe(true);
    await answer(home, a!.handle, a!.green.id);
    await sleep(10_000);
    expect((await outcomes(hub, a!.id)).filter((e) => e.data?.outcome === 'delivered'), `${AC4} nothing of ${a!.s.id} runs to take your answer to ${a!.handle}: it can't read as delivered`).toEqual([]);
    expect(await stateOf(hub, a!.s.id), `${AC4} a session whose process vanished with no SessionEnd, its ask open, is unknown or waiting, never finished`).not.toBe('finished');
  }, 300_000);

  it(`${AC4} (a stop held while a Claude subagent still runs) your answer during the hold continues the parent's held stop, once; the subagent's hooks neither end the hold nor take the answer, and the session doesn't read as finished`, async () => {
    const { home } = makeHome();
    const repo = makeRepo(home);
    const hub = await startHub(home);
    await setup(home);
    const a = await (await beginAsk(hub, home, { cwd: repo.dir })).finish();
    // The agent started a background subagent before it asked; the subagent's hooks carry its agent_id on the parent's session.
    const agent = { agent_id: `agent-${randomUUID().slice(0, 8)}`, agent_type: 'general-purpose' };
    const sub = async (command: string): Promise<Fired[]> => {
      const call = callId();
      const pre = await a.claude.hook('PreToolUse', payload(a.s, 'PreToolUse', { ...agent, tool_name: 'Bash', tool_input: { command }, tool_use_id: call }));
      const post = await a.claude.hook('PostToolUse', payload(a.s, 'PostToolUse', { ...agent, tool_name: 'Bash', tool_input: { command }, tool_use_id: call, tool_response: { stdout: '', stderr: '', interrupted: false } }));
      return [pre, post];
    };
    const subFired: Fired[] = [...await sub('ls')];
    let stopped: Fired | undefined;
    const stopping = a.claude.hook('Stop', payload(a.s, 'Stop', { last_assistant_message: 'I asked which header colour you want; the subagent is still checking the styles.' })).then((f) => (stopped = f));
    // The hold: nothing answered, so the stop is still held a few seconds on (the hold runs up to 60 s).
    await sleep(3000);
    if (stopped) throw Error(`BLOCKED: ${a.s.id}'s stop went through before the subagent ran on, so no stop was held (a hub that missed the hook on a loaded machine): ${firedShown(stopped)}`);
    for (const command of ['git status', 'cat README.md']) subFired.push(...await sub(command));
    expect(stopped, `${AC4} the subagent's hooks must not end the parent's held stop while ${a.handle} is open: ${stopped ? firedShown(stopped) : ''}`).toBeUndefined();
    expect(await stateOf(hub, a.s.id), `${AC4} a session whose stop is held while its subagent runs never reads as finished`).not.toBe('finished');
    await answer(home, a.handle, a.green.id);
    subFired.push(...await sub('git log -1'));
    await stopping;
    expect(carries(stopped!.blocked ?? '', a.green), `${AC4} your answer to ${a.handle} (${a.green.label}) must continue the parent's held stop: ${firedShown(stopped!)}`).toBe(true);
    for (const f of subFired) expect(carries(replied(f), a.green), `${AC4} a subagent's hook isn't its parent's: it must not take the answer to ${a.handle}: ${firedShown(f)}`).toBe(false);
    const woke = await within(5000, () => a.claude.wakes.find((w) => w.session === a.s.id && carries(w.stderr, a.green)));
    expect(woke, `${AC4} one answer goes by one route: the held stop took ${a.handle}, so no waiter wakes the session with it`).toBeUndefined();
    const all = await outcomes(hub, a.id);
    expect(all.map((e) => `${e.data?.outcome} via ${e.data?.via}`), `${AC4} ${a.handle} reads delivered by the stop hold, once: ${outcomeList(all)}`).toEqual(['delivered via stop_hold']);
  }, 300_000);
});
