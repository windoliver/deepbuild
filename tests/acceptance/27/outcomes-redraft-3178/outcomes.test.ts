// #27.e6116d56 (AC4), blind redraft (#3178) of the issue's "Added Oct 9" cases: "the four delivery outcomes in scripted
// sessions, a waiter that outlives its session, and a stop held while a Claude subagent is still running. Done when:
// each case reports the right outcome and none reads as finished."
//
// Every case asks a choice with no recommended option, so nothing goes on provisionally and the session waits on you
// (design: Work goes on while you decide; A question holds the send-back). The four outcomes are the design's
// (An ask, and your answer getting back): "delivered and acknowledged, when the agent's next prompt or turn shows it;
// stalled; timed out; or the session was replaced". Each is read from the record (`delivery.outcome` through
// `events.read`) within a bound of the test's own, and each session's state from its newest `session.attention`.
import { randomUUID } from 'node:crypto';
import { chmodSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  allEvents, answer, assistantSays, callId, firedShown, groupOf, makeHome, makeRepo, outcomeList, outcomes, payload, replied, sleep,
  startHub, stateOf, typedPrompt, waitFor, within, type Ev, type Fired, type Hub, type Session, type Wake,
} from '../helpers.ts';
import { Claude, asks, cleanup, contextEntries, setupHere, stopAfterAsking, type Asking } from './standin.ts';

afterAll(cleanup, 60_000);

const ID = '#27.e6116d56';
const carriesAnswer = (text: string, a: Asking) => text.includes(a.green.label) || new RegExp(`${a.handle}[^\\n]*\\b${a.green.id}\\b`).test(text);
const names = (text: string, a: Asking) => text.includes(a.handle) || text.includes(a.green.label);
const is = (outcome: string) => (e: Ev) => e.data?.outcome === outcome;
const settled = async (hub: Hub, a: Asking) => outcomeList(await outcomes(hub, a.id));
const others = (evs: Ev[], ...keep: string[]) => evs.filter((e) => !keep.includes(String(e.data?.outcome)));

/** A hub whose deep_ask answers "still waiting" at once and whose unanswered stop hold ends in 5 s (../helpers.ts: HubOptions). */
async function hubFor(o: { shortHold: boolean }): Promise<{ home: string; hub: Hub; cwd: string }> {
  const { home } = makeHome();
  const repo = makeRepo(home);
  const hub = await startHub(home, { noAskWait: true, shortHold: o.shortHold });
  await setupHere(home);
  return { home, hub, cwd: repo.dir };
}
/** An idle session: it asked, its stop went through with nothing answered, and its waiter waits (else BLOCKED). */
async function idle(hub: Hub, home: string, cwd: string, o: { wake: boolean }): Promise<Asking> {
  const app = Claude.start(home);
  await app.configure(o);
  const a = await asks(hub, home, { claude: app, cwd });
  const fired = await stopAfterAsking(a);
  if (fired.blocked) throw Error(`${ID} BLOCKED: nothing is answered yet, so ${a.s.id}'s stop goes through once its hold ends: ${firedShown(fired)}`);
  await waitFor(async () => (await app.liveWaiters(a.s.id)).length > 0 || undefined, 30_000, `the waiter of ${a.s.id}`).catch((e: Error) => { throw Error(`${ID} BLOCKED: ${e.message}`); });
  expect(await stateOf(hub, a.s.id), `${ID} an idle session with ${a.handle} open waits on you; it never reads finished`).not.toBe('finished');
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
/** The ask's delivered outcomes, read within 30 s and again 3 s later, so "once" is seen settled. */
async function deliveredOnce(hub: Hub, a: Asking): Promise<Ev[]> {
  await within(30_000, async () => (await outcomes(hub, a.id)).find(is('delivered')));
  await sleep(3000);
  return (await outcomes(hub, a.id)).filter(is('delivered'));
}
/** The waiter's exit 2 carrying your answer, since `t`; with `turn`, only once Claude Code started the wake's turn. */
const wakeOf = (a: Asking, t: number, turn: boolean) => (): Wake | undefined =>
  a.claude.wakes.find((w) => w.session === a.s.id && w.at >= t && names(w.stderr, a) && (!turn || w.fired !== undefined));

describe(`${ID} the issue's Oct 9 cases: the four delivery outcomes, a waiter that outlives its session, a stop held while a subagent runs`, () => {
  it(`${ID} (delivery outcome: delivered) an answer the waiter takes to an idle headless session reads delivered once, and only once the wake's turn shows it, never stalled, timed out or replaced`, async () => {
    const { home, hub, cwd } = await hubFor({ shortHold: true });
    const a = await idle(hub, home, cwd, { wake: true });
    const t = Date.now();
    await answer(home, a.handle, a.green.id);
    const woke = await within(30_000, wakeOf(a, t, true));
    expect(woke, `${ID} precondition: the waiter takes your answer to ${a.handle} to the idle session, exits 2, and Claude Code starts a turn with it`).toBeDefined();
    expect(carriesAnswer(woke!.prompt ?? '', a), `${ID} the wake's prompt carries your answer (${a.green.label}): ${woke!.prompt}`).toBe(true);
    await endTurn(a.claude, a.s, `Going with ${a.green.label}.`);
    const delivered = await deliveredOnce(hub, a);
    const all = await outcomes(hub, a.id);
    expect(delivered.length, `${ID} ${a.handle} reads delivered within 30 s of the turn that showed it, once: ${outcomeList(all)}`).toBe(1);
    // Acknowledged means a turn showed it: the record has the wake turn's prompt before it has delivered.
    const turn = (await allEvents(hub)).find((e) => e.kind === 'user.ask' && e.session === a.s.id && names(String(e.data?.text ?? ''), a));
    expect(turn, `${ID} precondition: the hub recorded the wake turn's prompt, naming ${a.handle}`).toBeDefined();
    expect(delivered[0]!.log_pos > turn!.log_pos, `${ID} delivered is acknowledged by the turn that showed it: it must come after that turn's prompt in the record (prompt at log_pos ${turn!.log_pos}, delivered at ${delivered[0]!.log_pos})`).toBe(true);
    expect(outcomeList(others(all, 'delivered')), `${ID} a delivery the wake's turn showed is neither stalled, timed out nor replaced`).toBe('none');
  }, 300_000);

  it(`${ID} (delivery outcome: stalled) an answer the waiter took that no turn showed, the session readable, reads stalled, never delivered and never finished; your next prompt carries it, and once that turn shows it, it reads delivered once`, async () => {
    const { home, hub, cwd } = await hubFor({ shortHold: true });
    const a = await idle(hub, home, cwd, { wake: false });
    const t = Date.now();
    await answer(home, a.handle, a.green.id);
    const exited = await within(30_000, wakeOf(a, t, false));
    expect(exited, `${ID} precondition: the waiter takes your answer to ${a.handle} to the idle session and exits 2 with it`).toBeDefined();
    const stalled = await within(60_000, async () => (await outcomes(hub, a.id)).find(is('stalled')));
    expect(stalled, `${ID} the waiter took ${a.handle}, Claude Code started no turn, and the transcript shows none: its delivery must read stalled within 60 s; outcomes: ${await settled(hub, a)}`).toBeDefined();
    expect(outcomeList(others(await outcomes(hub, a.id), 'stalled')), `${ID} a stalled delivery reads neither delivered, timed out nor replaced`).toBe('none');
    expect(await stateOf(hub, a.s.id), `${ID} a session your answer stalled on never reads finished`).not.toBe('finished');
    const next = await prompt(a.claude, a.s, 'Did my answer reach you?');
    expect(carriesAnswer(replied(next), a), `${ID} a stalled answer goes by the next route: your next prompt carries ${a.handle} (${a.green.label}): ${firedShown(next)}`).toBe(true);
    expect(contextEntries(a.s).some((c) => carriesAnswer(c, a)), `${ID} precondition: Claude Code wrote the prompt's added context, carrying ${a.handle}, into the transcript`).toBe(true);
    await endTurn(a.claude, a.s, `Going with ${a.green.label}.`);
    const delivered = await deliveredOnce(hub, a);
    expect(delivered.length, `${ID} ${a.handle} reads delivered once the next prompt's turn showed it (within 30 s), once: ${await settled(hub, a)}`).toBe(1);
    expect(delivered[0]!.log_pos > stalled!.log_pos, `${ID} it stalled first and was delivered after`).toBe(true);
  }, 300_000);

  it(`${ID} (delivery outcome: timed out) an answer the waiter took, in a session that couldn't be read, reads timed_out, never stalled or delivered, never finished; once the session can be read, the next prompt carries it and, once the turn shows it, it reads delivered once`, async () => {
    const { home, hub, cwd } = await hubFor({ shortHold: true });
    const a = await idle(hub, home, cwd, { wake: false });
    chmodSync(a.s.transcript, 0o000);
    try {
      const t = Date.now();
      await answer(home, a.handle, a.green.id);
      const exited = await within(30_000, wakeOf(a, t, false));
      expect(exited, `${ID} precondition: the waiter takes your answer to ${a.handle} to the idle session and exits 2 with it`).toBeDefined();
      const timedOut = await within(60_000, async () => (await outcomes(hub, a.id)).find(is('timed_out')));
      expect(timedOut, `${ID} the waiter took ${a.handle} and ${a.s.id}'s transcript couldn't be read, so nothing proves whether a turn carried it: its delivery must read timed_out within 60 s; outcomes: ${await settled(hub, a)}`).toBeDefined();
      expect(outcomeList(others(await outcomes(hub, a.id), 'timed_out')), `${ID} a delivery that timed out was neither shown stalled (nobody could read the session), delivered nor replaced`).toBe('none');
      expect(await stateOf(hub, a.s.id), `${ID} a session your answer timed out on never reads finished`).not.toBe('finished');
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

  it(`${ID} (delivery outcome: replaced) an answer the waiter took, its session cleared before any turn showed it, reads replaced, never stalled or delivered for the old ID, never finished; the cleared thread's new session gets it at its start, and once its turn shows it, it reads delivered once`, async () => {
    const { home, hub, cwd } = await hubFor({ shortHold: true });
    const a = await idle(hub, home, cwd, { wake: false });
    const t = Date.now();
    await answer(home, a.handle, a.green.id);
    const exited = await within(30_000, wakeOf(a, t, false));
    expect(exited, `${ID} precondition: the waiter takes your answer to ${a.handle} to the idle session and exits 2 with it`).toBeDefined();
    // /clear at once: the same Claude Code ends the old ID and starts a new one in the same folder (design: Threads, not IDs).
    await a.claude.hook('SessionEnd', payload(a.s, 'SessionEnd', { reason: 'clear' }));
    const id = randomUUID();
    const s2: Session = { id, cwd: a.s.cwd, transcript: join(dirname(a.s.transcript), `${id}.jsonl`) };
    writeFileSync(s2.transcript, '');
    const start = await a.claude.hook('SessionStart', payload(s2, 'SessionStart', { source: 'clear' }));
    const replaced = await within(30_000, async () => (await outcomes(hub, a.id)).find(is('replaced')));
    expect(replaced, `${ID} ${a.s.id} was cleared before any turn showed ${a.handle}: its delivery must read replaced within 30 s; outcomes: ${await settled(hub, a)}`).toBeDefined();
    expect(outcomeList(others(await outcomes(hub, a.id), 'replaced')), `${ID} a replaced session's delivery is neither stalled, timed out nor delivered before the new session shows it`).toBe('none');
    expect(await stateOf(hub, a.s.id), `${ID} a session cleared before your answer reached it never reads finished`).not.toBe('finished');
    expect(carriesAnswer(replied(start), a), `${ID} the cleared thread's new session ${s2.id} gets your answer to ${a.handle} (${a.green.label}) at its SessionStart: ${firedShown(start)}`).toBe(true);
    expect(contextEntries(s2).some((c) => carriesAnswer(c, a)), `${ID} precondition: Claude Code wrote the SessionStart's added context, carrying ${a.handle}, into ${s2.id}'s transcript`).toBe(true);
    const next = await prompt(a.claude, s2, 'Carry on with the page.');
    expect(carriesAnswer(replied(next), a), `${ID} ${a.handle} came with ${s2.id}'s start; it must not come again with its next prompt: ${firedShown(next)}`).toBe(false);
    await endTurn(a.claude, s2, `Going with ${a.green.label}.`);
    const delivered = await deliveredOnce(hub, a);
    expect(delivered.length, `${ID} ${a.handle} reads delivered once the new session's start and turn showed it (within 30 s), once: ${await settled(hub, a)}`).toBe(1);
    expect(delivered[0]!.log_pos > replaced!.log_pos, `${ID} it was replaced first and delivered to the new session after`).toBe(true);
  }, 300_000);

  it(`${ID} (a waiter that outlives its session) a headless session's Claude Code killed while its waiter waits: the waiter is gone within 10 s, a later answer isn't counted delivered, and the session never reads as finished`, async () => {
    const { home, hub, cwd } = await hubFor({ shortHold: true });
    const a = await idle(hub, home, cwd, { wake: true });
    const [waiter] = await a.claude.liveWaiters(a.s.id);
    await a.claude.kill();
    const gone = await within(10_000, () => groupOf(waiter!.pid).length === 0 || undefined);
    expect(gone, `${ID} ${a.s.id}'s Claude Code was killed; its waiter (pid ${waiter!.pid}) must not outlive it: still running 10 s on: ${JSON.stringify(groupOf(waiter!.pid))}`).toBe(true);
    await answer(home, a.handle, a.green.id);
    await sleep(30_000);
    expect((await outcomes(hub, a.id)).filter(is('delivered')), `${ID} nothing of ${a.s.id} runs to take your answer to ${a.handle} and no turn shows it, so it can't read as delivered within 30 s: ${await settled(hub, a)}`).toEqual([]);
    expect(await stateOf(hub, a.s.id), `${ID} a session whose process vanished with no SessionEnd, its answer undelivered, never reads finished`).not.toBe('finished');
  }, 300_000);

  it(`${ID} (a stop held while a Claude subagent still runs) the lead's stop is held while its background subagent works and your choice is open; the subagent's hooks neither end the hold nor take your answer; the session never reads finished; your answer continues the held stop, once, and reads delivered by the stop hold, once`, async () => {
    const { home, hub, cwd } = await hubFor({ shortHold: false });
    const app = Claude.start(home);
    // The lead starts a background subagent in its turn (Claude Code's Agent tool, run_in_background), then asks.
    const agent = { agent_id: `agent-${randomUUID().slice(0, 8)}`, agent_type: 'general-purpose' };
    const start = async (s: Session) => {
      const call = callId();
      const input = { description: 'Check the page styles', prompt: 'List the header styles in this repo.', subagent_type: 'general-purpose', run_in_background: true };
      await app.hook('PreToolUse', payload(s, 'PreToolUse', { tool_name: 'Agent', tool_input: input, tool_use_id: call }));
      await app.hook('PostToolUse', payload(s, 'PostToolUse', { tool_name: 'Agent', tool_input: input, tool_use_id: call, tool_response: { status: 'async_launched', agentId: agent.agent_id } }));
    };
    const a = await asks(hub, home, { claude: app, cwd, before: start });
    // The subagent's hooks carry its agent_id on the lead's session.
    const sub = async (command: string): Promise<Fired[]> => {
      const call = callId();
      const pre = await app.hook('PreToolUse', payload(a.s, 'PreToolUse', { ...agent, tool_name: 'Bash', tool_input: { command }, tool_use_id: call }));
      const post = await app.hook('PostToolUse', payload(a.s, 'PostToolUse', { ...agent, tool_name: 'Bash', tool_input: { command }, tool_use_id: call, tool_response: { stdout: '', stderr: '', interrupted: false } }));
      return [pre, post];
    };
    const subFired: Fired[] = [...await sub('ls')];
    let stopped: Fired | undefined;
    const stopping = stopAfterAsking(a).then((f) => (stopped = f));
    await sleep(3000);
    if (stopped && /spool|hub isn't|could not reach/i.test(firedShown(stopped))) throw Error(`${ID} BLOCKED: ${a.s.id}'s stop never reached the hub (a loaded machine): ${firedShown(stopped)}`);
    expect(stopped, `${ID} with ${a.handle} open and nothing answered, the lead's stop is held: it went through within 3 s: ${stopped ? firedShown(stopped) : ''}`).toBeUndefined();
    for (const command of ['git status', 'cat README.md']) subFired.push(...await sub(command));
    expect(stopped, `${ID} the subagent's hooks must not end the lead's held stop while ${a.handle} is open: ${stopped ? firedShown(stopped) : ''}`).toBeUndefined();
    expect(await stateOf(hub, a.s.id), `${ID} a session whose stop is held while its subagent runs never reads finished`).not.toBe('finished');
    await answer(home, a.handle, a.green.id);
    subFired.push(...await sub('git log -1'));
    await stopping;
    expect(carriesAnswer(stopped!.blocked ?? '', a), `${ID} your answer to ${a.handle} (${a.green.label}) must continue the lead's held stop: ${firedShown(stopped!)}`).toBe(true);
    for (const f of subFired) expect(carriesAnswer(replied(f), a), `${ID} a subagent's hook isn't its lead's: it must not take the answer to ${a.handle}: ${firedShown(f)}`).toBe(false);
    // The turn the held stop continued uses the answer and ends.
    const last = await endTurn(app, a.s, `Going with ${a.green.label}.`, { stop_hook_active: true });
    expect(carriesAnswer(last.blocked ?? '', a), `${ID} the held stop carried ${a.handle}; the continued turn's stop isn't sent back with it again: ${firedShown(last)}`).toBe(false);
    const delivered = await deliveredOnce(hub, a);
    expect(app.wakes.find((w) => w.session === a.s.id && names(w.stderr, a)), `${ID} one answer goes by one route: the held stop took ${a.handle}, so no waiter wakes the session with it`).toBeUndefined();
    const all = await outcomes(hub, a.id);
    expect(delivered.length, `${ID} ${a.handle} reads delivered within 30 s of the turn that showed it, once: ${outcomeList(all)}`).toBe(1);
    expect(all.map((e) => `${e.data?.outcome} via ${e.data?.via}`), `${ID} ${a.handle} reads delivered by the stop hold, and nothing else: ${outcomeList(all)}`).toEqual(['delivered via stop_hold']);
  }, 300_000);
});
