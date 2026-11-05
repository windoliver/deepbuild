// #27.e6116d56 (AC4), blind redraft of the issue's "Added Oct 9" cases: "the four delivery outcomes in scripted
// sessions, a waiter that outlives its session, and a stop held while a Claude subagent is still running. Done when:
// each case reports the right outcome and none reads as finished."
//
// Delivered by a wake is AC1's (../wake.test.ts) and stalled AC3's (../desktop-redraft-2/); this file holds the two
// outcomes no other file reaches, timed out and replaced, each followed to its delivery, and the waiter and subagent
// cases. This folder's Claude Code stand-in writes a hook reply's added context and a held stop's feedback into the
// transcript as Claude Code does, and the turns it runs end with their Stop; a delivery is read with a bounded wait
// (30 s) once a turn has shown it, never at once after a hook returns (design: "delivered and acknowledged, when the
// agent's next prompt or turn shows it"; README: The dispute).
import { randomUUID } from 'node:crypto';
import { chmodSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  answer, assistantSays, callId, firedShown, groupOf, makeHome, makeRepo, outcomeList, outcomes, payload, replied, setup, sleep, startHub,
  stateOf, typedPrompt, waitFor, within, type Ev, type Fired, type Hub, type Session,
} from '../helpers.ts';
import { Claude, beginAsk, cleanup, contextEntries, stopAfterAsking, type Asking } from './standin.ts';

afterAll(cleanup, 60_000);

const ID = '#27.e6116d56';
const carriesAnswer = (text: string, a: Asking) => text.includes(a.green.label) || new RegExp(`${a.handle}[^\\n]*\\b${a.green.id}\\b`).test(text);
const names = (text: string, a: Asking) => text.includes(a.handle) || text.includes(a.green.label);
const is = (outcome: string) => (e: Ev) => e.data?.outcome === outcome;
const settled = async (hub: Hub, a: Asking) => outcomeList(await outcomes(hub, a.id));

/** An idle session: it asked, its stop went through with nothing answered, and its waiter is live (else BLOCKED). */
async function idle(hub: Hub, home: string, cwd: string, o: { wake: boolean }): Promise<Asking> {
  const app = Claude.start(home);
  await app.configure(o);
  const a = await (await beginAsk(hub, home, { cwd, claude: app })).finish();
  const fired = await stopAfterAsking(a);
  if (fired.blocked) throw Error(`${ID} BLOCKED: nothing is answered yet, so ${a.s.id}'s stop goes through: ${firedShown(fired)}`);
  await waitFor(async () => (await app.liveWaiters(a.s.id)).length > 0 || undefined, 30_000, `the waiter of ${a.s.id}`).catch((e: Error) => { throw Error(`${ID} BLOCKED: ${e.message}`); });
  return a;
}
/** You type a prompt in a session; Claude Code writes what DeepBuild's reply adds into the transcript. */
function prompt(app: Claude, s: Session, text: string): Promise<Fired> {
  typedPrompt(s, text);
  return app.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: text }));
}
/** The turn ends: the agent's words, then its Stop. */
function endTurn(app: Claude, s: Session, words: string, extra: Record<string, unknown> = {}): Promise<Fired> {
  assistantSays(s, words);
  return app.hook('Stop', payload(s, 'Stop', { last_assistant_message: words, ...extra }));
}
/** The ask's delivered outcomes, read within 30 s of the turn that showed it and again 3 s later, so "once" is seen settled. */
async function deliveredOnce(hub: Hub, a: Asking): Promise<Ev[]> {
  await within(30_000, async () => (await outcomes(hub, a.id)).find(is('delivered')));
  await sleep(3000);
  return (await outcomes(hub, a.id)).filter(is('delivered'));
}

describe(`${ID} the issue's Oct 9 cases: the four delivery outcomes, a waiter that outlives its session, a stop held while a subagent runs`, () => {
  it(`${ID} (delivery outcome: timed out) an answer the waiter took, in a session that couldn't be read, reads timed_out, never stalled or delivered; once the session can be read, the next prompt carries it and, once the turn shows it, it reads delivered once`, async () => {
    const { home } = makeHome();
    const repo = makeRepo(home);
    const hub = await startHub(home);
    await setup(home);
    const a = await idle(hub, home, repo.dir, { wake: false });
    chmodSync(a.s.transcript, 0o000);
    try {
      const t = Date.now();
      await answer(home, a.handle, a.green.id);
      const exited = await within(30_000, () => a.claude.wakes.find((w) => w.session === a.s.id && w.at >= t && names(w.stderr, a)));
      expect(exited, `${ID} precondition: the waiter takes your answer to ${a.handle} to the idle session and exits 2 with it`).toBeDefined();
      const timedOut = await within(60_000, async () => (await outcomes(hub, a.id)).find(is('timed_out')));
      expect(timedOut, `${ID} the waiter took ${a.handle} and ${a.s.id}'s transcript couldn't be read, so nothing proves whether a turn carried it: its delivery must read timed_out within 60 s; outcomes: ${await settled(hub, a)}`).toBeDefined();
      expect(outcomeList((await outcomes(hub, a.id)).filter((e) => !is('timed_out')(e))), `${ID} a delivery that timed out was neither shown stalled (nobody read the session) nor delivered`).toBe('none');
    } finally {
      chmodSync(a.s.transcript, 0o644);
    }
    const next = await prompt(a.claude, a.s, 'Did my answer reach you?');
    expect(carriesAnswer(replied(next), a), `${ID} once ${a.s.id} can be read and shows no turn with ${a.handle}, your next prompt carries it (${a.green.label}): ${firedShown(next)}`).toBe(true);
    expect(contextEntries(a.s).some((c) => carriesAnswer(c, a)), `${ID} precondition: Claude Code wrote the prompt's added context, carrying ${a.handle}, into the transcript`).toBe(true);
    await endTurn(a.claude, a.s, `Going with ${a.green.label}.`);
    const delivered = await deliveredOnce(hub, a);
    expect(delivered.length, `${ID} ${a.handle} reads delivered once the turn showed it (within 30 s), once: ${await settled(hub, a)}`).toBe(1);
    expect((await outcomes(hub, a.id)).filter(is('stalled')), `${ID} a delivery that timed out and then went by the next prompt never reads stalled`).toEqual([]);
  }, 300_000);

  it(`${ID} (delivery outcome: replaced) an answer the waiter took, its session cleared before any turn showed it, reads replaced, never stalled, and reaches the cleared thread's new session at its start; once that session's turn shows it, it reads delivered once`, async () => {
    const { home } = makeHome();
    const repo = makeRepo(home);
    const hub = await startHub(home);
    await setup(home);
    const a = await idle(hub, home, repo.dir, { wake: false });
    const t = Date.now();
    await answer(home, a.handle, a.green.id);
    const exited = await within(30_000, () => a.claude.wakes.find((w) => w.session === a.s.id && w.at >= t && names(w.stderr, a)));
    expect(exited, `${ID} precondition: the waiter takes your answer to ${a.handle} to the idle session and exits 2 with it`).toBeDefined();
    // /clear at once: the same Claude Code ends the old ID and starts a new one in the same folder (design: Threads, not IDs).
    await a.claude.hook('SessionEnd', payload(a.s, 'SessionEnd', { reason: 'clear' }));
    const id = randomUUID();
    const s2: Session = { id, cwd: a.s.cwd, transcript: join(dirname(a.s.transcript), `${id}.jsonl`) };
    writeFileSync(s2.transcript, '');
    const start = await a.claude.hook('SessionStart', payload(s2, 'SessionStart', { source: 'clear' }));
    const replaced = await within(30_000, async () => (await outcomes(hub, a.id)).find(is('replaced')));
    expect(replaced, `${ID} ${a.s.id} was cleared before any turn showed ${a.handle}: its delivery must read replaced; outcomes: ${await settled(hub, a)}`).toBeDefined();
    expect((await outcomes(hub, a.id)).filter(is('stalled')), `${ID} a replaced session's delivery isn't stalled`).toEqual([]);
    expect(carriesAnswer(replied(start), a), `${ID} the cleared thread's new session ${s2.id} gets your answer to ${a.handle} (${a.green.label}) at its SessionStart: ${firedShown(start)}`).toBe(true);
    expect(contextEntries(s2).some((c) => carriesAnswer(c, a)), `${ID} precondition: Claude Code wrote the SessionStart's added context, carrying ${a.handle}, into ${s2.id}'s transcript`).toBe(true);
    // The new session's first turn: you type, the agent replies, the turn ends.
    const next = await prompt(a.claude, s2, 'Carry on with the page.');
    expect(carriesAnswer(replied(next), a), `${ID} ${a.handle} came with ${s2.id}'s start; it must not come again with its next prompt: ${firedShown(next)}`).toBe(false);
    await endTurn(a.claude, s2, `Going with ${a.green.label}.`);
    const delivered = await deliveredOnce(hub, a);
    expect(delivered.length, `${ID} ${a.handle} reads delivered once the new session's start and turn showed it (within 30 s), once: ${await settled(hub, a)}`).toBe(1);
  }, 300_000);

  it(`${ID} (a waiter that outlives its session) a headless session's Claude Code killed with its waiter waiting: the waiter is gone within 10 s, a later answer isn't counted delivered, and the session never reads as finished`, async () => {
    const { home } = makeHome();
    const repo = makeRepo(home);
    const hub = await startHub(home);
    await setup(home);
    const a = await idle(hub, home, repo.dir, { wake: true });
    const [waiter] = await a.claude.liveWaiters(a.s.id);
    await a.claude.kill();
    const gone = await within(10_000, () => groupOf(waiter!.pid).length === 0 || undefined);
    expect(gone, `${ID} ${a.s.id}'s Claude Code was killed; its waiter (pid ${waiter!.pid}) must not outlive it: still running 10 s on: ${JSON.stringify(groupOf(waiter!.pid))}`).toBe(true);
    await answer(home, a.handle, a.green.id);
    await sleep(30_000);
    expect((await outcomes(hub, a.id)).filter(is('delivered')), `${ID} nothing of ${a.s.id} runs to take your answer to ${a.handle} and no turn shows it, so it can't read as delivered within 30 s: ${await settled(hub, a)}`).toEqual([]);
    expect(await stateOf(hub, a.s.id), `${ID} a session whose process vanished with no SessionEnd, its answer undelivered, is unknown or waiting, never finished`).not.toBe('finished');
  }, 300_000);

  it(`${ID} (a stop held while a Claude subagent still runs) your answer during the hold continues the parent's held stop, once; the subagent's hooks neither end the hold nor take the answer; the session doesn't read as finished; once the turn shows it, it reads delivered by the stop hold, once`, async () => {
    const { home } = makeHome();
    const repo = makeRepo(home);
    const hub = await startHub(home);
    await setup(home);
    const app = Claude.start(home);
    const a = await (await beginAsk(hub, home, { cwd: repo.dir, claude: app })).finish();
    // The agent started a background subagent before it asked; the subagent's hooks carry its agent_id on the parent's session.
    const agent = { agent_id: `agent-${randomUUID().slice(0, 8)}`, agent_type: 'general-purpose' };
    const sub = async (command: string): Promise<Fired[]> => {
      const call = callId();
      const pre = await app.hook('PreToolUse', payload(a.s, 'PreToolUse', { ...agent, tool_name: 'Bash', tool_input: { command }, tool_use_id: call }));
      const post = await app.hook('PostToolUse', payload(a.s, 'PostToolUse', { ...agent, tool_name: 'Bash', tool_input: { command }, tool_use_id: call, tool_response: { stdout: '', stderr: '', interrupted: false } }));
      return [pre, post];
    };
    const subFired: Fired[] = [...await sub('ls')];
    let stopped: Fired | undefined;
    const stopping = app.hook('Stop', payload(a.s, 'Stop', { last_assistant_message: 'I asked which header colour you want; the subagent is still checking the styles.' })).then((f) => (stopped = f));
    await sleep(3000);
    if (stopped) throw Error(`${ID} BLOCKED: ${a.s.id}'s stop went through before the subagent ran on, so no stop was held (a hub that missed the hook on a loaded machine): ${firedShown(stopped)}`);
    for (const command of ['git status', 'cat README.md']) subFired.push(...await sub(command));
    expect(stopped, `${ID} the subagent's hooks must not end the parent's held stop while ${a.handle} is open: ${stopped ? firedShown(stopped) : ''}`).toBeUndefined();
    expect(await stateOf(hub, a.s.id), `${ID} a session whose stop is held while its subagent runs never reads as finished`).not.toBe('finished');
    await answer(home, a.handle, a.green.id);
    subFired.push(...await sub('git log -1'));
    await stopping;
    expect(carriesAnswer(stopped!.blocked ?? '', a), `${ID} your answer to ${a.handle} (${a.green.label}) must continue the parent's held stop: ${firedShown(stopped!)}`).toBe(true);
    for (const f of subFired) expect(carriesAnswer(replied(f), a), `${ID} a subagent's hook isn't its parent's: it must not take the answer to ${a.handle}: ${firedShown(f)}`).toBe(false);
    // The turn the held stop continued uses the answer and ends.
    const last = await endTurn(app, a.s, `Going with ${a.green.label}.`, { stop_hook_active: true });
    expect(carriesAnswer(last.blocked ?? '', a), `${ID} the held stop carried ${a.handle}; the continued turn's stop isn't sent back with it again: ${firedShown(last)}`).toBe(false);
    const delivered = await deliveredOnce(hub, a);
    const woke = app.wakes.find((w) => w.session === a.s.id && names(w.stderr, a));
    expect(woke, `${ID} one answer goes by one route: the held stop took ${a.handle}, so no waiter wakes the session with it`).toBeUndefined();
    const all = await outcomes(hub, a.id);
    expect(delivered.length, `${ID} ${a.handle} reads delivered within 30 s of the turn that showed it, once: ${outcomeList(all)}`).toBe(1);
    expect(all.map((e) => `${e.data?.outcome} via ${e.data?.via}`), `${ID} ${a.handle} reads delivered by the stop hold, and nothing else: ${outcomeList(all)}`).toEqual(['delivered via stop_hold']);
  }, 300_000);
});
