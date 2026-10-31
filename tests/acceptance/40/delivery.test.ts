// #40 AC1, AC2 and AC4: an answer reaches real pi through the package's pi.sendUserMessage, from the real hub, and
// the four lifecycle traps. Each scenario returns what it found wrong, so the same scenario runs against the
// program and against the wrong program a planted DEEP_PI_PLANT names (README, Wrong programs).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  REPO, answer, askCreated, askStep, cleanup, openWorld, outcomesOf, pendingAsk, sleep, waitFor, word, type Line, type World,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const mineOfKind = async (w: World, kind: string): Promise<Line[]> => (await w.client.events()).filter((e) => e.kind === kind && e.session === w.pi.session);

// ---- AC1: idle
async function idleScenario(plant?: string): Promise<string[]> {
  const problems: string[] = [];
  const question = `Which ${word()} board?`;
  const label = `Cedar ${word()}`;
  // deep_ask's own wait runs out (40 s, "still waiting"), the turn ends, and the session is idle.
  const w = await openWorld({ plant, steps: [askStep(question, label), { text: 'Still waiting on you; I stop here.' }, { text: 'Thanks for the answer.' }] });
  await w.pi.call({ type: 'prompt', message: 'Raise the ask and wait.' });
  const created = await askCreated(w, question);
  const handle = `ask:${String(created.id)}`;
  await w.pi.until('agent_settled', 1);
  await sleep(500);
  const starts = w.pi.count('agent_start');
  if (w.pi.userMessagesWith(label).length) problems.push('the answer reached the model before you gave it');
  await answer(w, handle);
  try {
    await waitFor(() => w.pi.userMessagesWith(label).length > 0, 20_000, 'a model request holding the answer');
  } catch {
    problems.push(`no turn started with the answer "${label}" within 20 s of your answering an idle session`);
    return problems;
  }
  await w.pi.until('agent_settled', 2);
  await sleep(2000);
  if (w.pi.count('agent_start') !== starts + 1) problems.push(`one new turn expected, saw ${w.pi.count('agent_start') - starts} agent_start`);
  if (w.pi.count('agent_settled') !== 2) problems.push(`the answer's turn settles once, then the session stays idle: ${w.pi.count('agent_settled')} agent_settled`);
  const asUser = w.pi.userMessagesWith(label);
  if (asUser.length !== 1) problems.push(`the answer is a user message once in the session's history, not ${asUser.length} times`);
  // pi.sendUserMessage is what shows as an input from an extension; a custom message or a typed prompt would not.
  const sent = w.pi.inputs().filter((i) => String(i.text).includes(label));
  if (sent.length !== 1 || sent[0]!.source !== 'extension' || sent[0]!.streaming !== null) problems.push(`pi.sendUserMessage from an idle session shows one input from an extension with no streaming behaviour: ${JSON.stringify(sent)}`);
  const outcomes = await outcomesOf(w, handle);
  if (outcomes.length !== 1 || outcomes[0]!.data.outcome !== 'delivered') problems.push(`one delivery.outcome delivered for ${handle}: ${JSON.stringify(outcomes.map((o) => o.data))}`);
  return problems;
}

// ---- AC2: busy
async function busyScenario(plant?: string): Promise<string[]> {
  const problems: string[] = [];
  const question = `Which ${word()} rail?`;
  const label = `Birch ${word()}`;
  const w = await openWorld({ plant, steps: [askStep(question, label), { tools: [
    { name: 'bash', arguments: { command: 'sleep 5; echo one > one.txt' } },
    { name: 'bash', arguments: { command: 'sleep 6; echo two > two.txt' } },
  ] }, { text: 'Both ran.' }] });
  const handle = await pendingAsk(w, question);
  const settled = w.pi.count('agent_settled');
  await w.pi.call({ type: 'prompt', message: 'Run the two commands.' });
  await waitFor(() => w.pi.events.filter((e) => e.type === 'tool_execution_start' && e.toolName === 'bash').length === 2, 20_000, 'both bash calls to start');
  await answer(w, handle);
  await w.pi.until('agent_settled', settled + 1, 40_000);
  await sleep(1500);
  const ended = w.pi.events.filter((e) => e.type === 'tool_execution_end' && e.toolName === 'bash');
  if (ended.length !== 2 || ended.some((e) => e.isError) || !existsSync(join(w.cwd, 'one.txt')) || !existsSync(join(w.cwd, 'two.txt'))) {
    problems.push(`both tool calls run to their end, uninterrupted: ${JSON.stringify(ended.map((e) => ({ tool: e.toolCallId, error: e.isError })))}`);
  }
  const request = w.pi.requests().find((r) => (r.messages as Line[]).some((m) => m.role === 'user' && String(m.text).includes(label)));
  if (!request) {
    problems.push(`the answer "${label}" never reached the model: ${JSON.stringify(w.pi.requests().map((r) => (r.messages as Line[]).at(-1)))}`);
    return problems;
  }
  const messages = request.messages as Line[];
  const at = messages.findIndex((m) => m.role === 'user' && String(m.text).includes(label));
  const results = messages.map((m, i) => (m.role === 'toolResult' && m.tool === 'bash' ? i : -1)).filter((i) => i >= 0);
  if (results.length !== 2 || results.some((i) => i > at)) problems.push(`the answer comes after both of the current tool calls' results: ${JSON.stringify(messages.map((m) => m.role))}`);
  const sent = w.pi.inputs().filter((i) => String(i.text).includes(label));
  if (sent.length !== 1 || sent[0]!.source !== 'extension' || !['steer', 'followUp'].includes(String(sent[0]!.streaming))) problems.push(`steered in or queued as a follow-up: ${JSON.stringify(sent)}`);
  const outcomes = await outcomesOf(w, handle);
  if (outcomes.length !== 1 || outcomes[0]!.data.outcome !== 'delivered' || !['steer', 'next_prompt'].includes(String(outcomes[0]!.data.via))) problems.push(`one delivery.outcome, delivered via steer or next_prompt: ${JSON.stringify(outcomes.map((o) => o.data))}`);
  if (w.pi.userMessagesWith(label).length !== 1) problems.push(`the answer arrives once: ${w.pi.userMessagesWith(label).length}`);
  return problems;
}

// ---- AC4: a prompt handled without a run
async function handledScenario(plant?: string): Promise<string[]> {
  const problems: string[] = [];
  const question = `Which ${word()} latch?`;
  const label = `Handled ${word()}`;
  // An extension loaded ahead of the package consumes the answer's text: no run, no agent_start.
  const w = await openWorld({ plant, handle: label, handlerAhead: true, steps: [askStep(question, label)] });
  const handle = await pendingAsk(w, question);
  const starts = w.pi.count('agent_start');
  await answer(w, handle);
  await waitFor(() => w.pi.inputs().some((i) => i.handled === true), 15_000, 'pi.sendUserMessage to reach the handling extension').catch(() => problems.push('the answer never reached pi as a message an extension could handle'));
  // A generous window: the outcome can't wait on an agent_start that never comes, and a second one mustn't follow.
  await sleep(5000);
  const outcomes = await outcomesOf(w, handle);
  if (outcomes.length !== 1) problems.push(`one delivery outcome for a prompt handled without a run, not waiting on agent_start: ${JSON.stringify(outcomes.map((o) => o.data))}`);
  if (w.pi.count('agent_start') !== starts) problems.push(`no run starts: ${w.pi.count('agent_start') - starts} agent_start after the answer`);
  const offered = w.pi.inputs().filter((i) => String(i.text).includes(label));
  if (offered.length !== 1) problems.push(`the answer is offered once, never again because no run showed: ${offered.length} inputs`);
  return problems;
}

// ---- AC4: a recoverable end before final settlement
async function recoverableScenario(plant?: string): Promise<string[]> {
  const problems: string[] = [];
  const question = `Which ${word()} hinge?`;
  const label = `Oak ${word()}`;
  // The run's first request fails with an error pi retries itself after 2 s; the answer arrives while it is pending.
  const w = await openWorld({ plant, steps: [askStep(question, label), { holdMs: 3000, error: '503 overloaded' }, { text: 'Recovered.' }, { text: 'Thanks.' }] });
  const handle = await pendingAsk(w, question);
  const settled = w.pi.count('agent_settled');
  const startsBefore = w.pi.count('agent_start');
  const requestsBefore = w.pi.requests().length;
  await w.pi.call({ type: 'prompt', message: 'Do the work.' });
  await waitFor(() => w.pi.requests().length > requestsBefore, 15_000, 'the run\'s first request');
  await answer(w, handle);
  await w.pi.until('auto_retry_start', 1, 20_000);
  await w.pi.until('agent_settled', settled + 1, 40_000);
  await sleep(3000);
  const requests = w.pi.requests().slice(requestsBefore);
  const failed = requests[0]!;
  const retried = requests[1];
  if (failed.stop !== 'error') problems.push(`the scripted first request fails: ${String(failed.stop)}`);
  // The retry waits out pi's own delay (2 s). A request sooner than that is someone else's continuation.
  if (!retried || Number(retried.ms) - Number(failed.endMs) < 1500) problems.push(`a competing continuation: a request started ${retried ? Number(retried.ms) - Number(failed.endMs) : '?'} ms after the recoverable end, before pi's own 2 s retry`);
  if (requests.length > 3) problems.push(`the retry and at most one run for the answer, not ${requests.length} requests`);
  for (let i = 1; i < requests.length; i++) if (Number(requests[i]!.ms) < Number(requests[i - 1]!.endMs)) problems.push(`requests ${i - 1} and ${i} overlap`);
  if (w.pi.count('agent_settled') !== settled + 1) problems.push(`one settlement after the retry: ${w.pi.count('agent_settled') - settled}`);
  if (w.pi.count('agent_start') - startsBefore < 2) problems.push(`two starts before the one settle: ${w.pi.count('agent_start') - startsBefore}`);
  if (w.pi.userMessagesWith(label).length !== 1) problems.push(`the answer arrives once, once the retry is through: ${w.pi.userMessagesWith(label).length}`);
  const outcomes = await outcomesOf(w, handle);
  if (outcomes.filter((o) => o.data.outcome === 'delivered').length !== 1) problems.push(`one delivered outcome: ${JSON.stringify(outcomes.map((o) => o.data))}`);
  // The recoverable agent_end is no stop: the run's one agent.stop comes only after the retry.
  const stops = (await mineOfKind(w, 'agent.stop')).filter((s) => Number(s.ts) >= Number(failed.ms));
  if (stops.some((s) => Number(s.ts) < Number(retried?.ms ?? Infinity))) problems.push('an agent.stop was recorded at the recoverable agent_end, before the retry');
  if (!stops.length) problems.push('the run that settled recorded no agent.stop');
  return problems;
}

// ---- AC4: a replaced session's pending answer
async function replacedScenario(plant?: string): Promise<string[]> {
  const problems: string[] = [];
  const question = `Which ${word()} frame?`;
  const label = `Replaced ${word()}`;
  const w = await openWorld({ plant, steps: [askStep(question, label), { text: 'The new session runs.' }, { text: 'Spare.' }] });
  const handle = await pendingAsk(w, question);
  const old = w.pi.session;
  const replaced = await w.pi.call({ type: 'new_session' });
  if (!replaced.success || replaced.data?.cancelled) throw Error(`BLOCKED: pi refused new_session: ${JSON.stringify(replaced)}`);
  const state = await w.pi.call({ type: 'get_state' });
  w.pi.session = String(state.data.sessionId);
  if (w.pi.session === old) throw Error('BLOCKED: new_session kept the session ID');
  await waitFor(async () => (await mineOfKind(w, 'session.start')).length > 0, 15_000, 'the replacement session\'s session.start');
  const starts = w.pi.count('agent_start');
  const requests = w.pi.requests().length;
  await answer(w, handle);
  await sleep(5000);
  if (w.pi.count('agent_start') !== starts || w.pi.requests().length !== requests) problems.push(`the answer bound to the old generation started a run in the replacement session (${w.pi.count('agent_start') - starts} agent_start)`);
  if (w.pi.inputs().some((i) => String(i.text).includes(label))) problems.push('the answer bound to the old generation was sent into the replacement session');
  const outcomes = await outcomesOf(w, handle);
  if (outcomes.length !== 1 || outcomes[0]!.data.outcome !== 'replaced') problems.push(`one delivery.outcome replaced for ${handle}: ${JSON.stringify(outcomes.map((o) => o.data))}`);
  // Nor does it ride along on the replacement session's next prompt.
  const settled = w.pi.count('agent_settled');
  await w.pi.call({ type: 'prompt', message: 'Next prompt in the new session.' });
  await w.pi.until('agent_settled', settled + 1, 30_000);
  await sleep(1000);
  const seen = w.pi.requests().flatMap((r) => r.messages as Line[]).filter((m) => String(m.text).includes(label));
  if (seen.length) problems.push(`the refused answer reached the replacement session's model: ${JSON.stringify(seen)}`);
  return problems;
}

// ---- AC4: a nested tool record marked incomplete
async function nestedScenario(count: number, padding: number, plant?: string): Promise<{ problems: string[]; data: Line | undefined; truth: unknown }> {
  const problems: string[] = [];
  const w = await openWorld({ plant, steps: [{ tools: [{ name: 'nest', arguments: { count, padding } }] }, { text: 'Nested calls done.' }] });
  await w.pi.call({ type: 'prompt', message: 'Make the nested calls.' });
  await w.pi.until('agent_settled', 1, 60_000);
  await sleep(1500);
  // What pi itself wrote: the world this test relies on, read from its own session file.
  const entry = w.pi.sessionEntries().find((e) => e.message?.role === 'toolResult' && e.message?.toolName === 'nest');
  const truth = entry?.message?.nestedCalls?.complete;
  const after = (await mineOfKind(w, 'tool.after')).find((e) => e.data?.call === 'call_1_0');
  if (!after) problems.push('the hub recorded no tool.after for the calling tool, call_1_0');
  const nested = after?.data?.nested as Line | undefined;
  if (nested?.complete !== truth) problems.push(`tool.after.nested.complete must stay what pi wrote, ${String(truth)}; the record has ${JSON.stringify(nested?.complete)} on call call_1_0`);
  if (truth === false) {
    const stop = (await mineOfKind(w, 'agent.stop')).at(-1);
    if (stop?.data?.did_work !== true) problems.push(`a turn with an incomplete nested record can't read as nothing having happened: agent.stop did_work ${JSON.stringify(stop?.data?.did_work)}`);
  }
  return { problems, data: after?.data as Line | undefined, truth };
}

describe('AC1 #40.bb9b6512 An idle pi session starts a turn with the answer', () => {
  it('AC1 your answer to a native deep_ask starts one new turn in the idle session through pi.sendUserMessage, delivered once', async () => {
    expect(await idleScenario()).toEqual([]);
  }, 180_000);

  it('AC1 the package registers native tools matching the MCP tools: the same names and descriptions as packages/hub/tools.json', async () => {
    const w = await openWorld({ steps: [{ text: 'hello' }] });
    await w.pi.call({ type: 'prompt', message: 'hi' });
    await w.pi.until('agent_settled', 1, 30_000);
    const tools = (w.pi.requests()[0]!.tools as Line[]).filter((t) => String(t.name).startsWith('deep_'));
    const described = JSON.parse(readFileSync(join(REPO, 'packages/hub/tools.json'), 'utf8')) as Record<string, string>;
    expect(Object.fromEntries(tools.map((t) => [t.name, t.description]).sort()), 'the model is offered every deep_* tool natively, as deep mcp lists them').toEqual(Object.fromEntries(Object.entries(described).sort()));
  }, 120_000);
});

describe('AC2 #40.d992de05 A busy session gets it after its current tool calls', () => {
  it('AC2 an answer given while two tool calls run reaches the model after both results, with neither interrupted', async () => {
    expect(await busyScenario()).toEqual([]);
  }, 180_000);
});

describe('AC4 #40.5fd13825 A handled prompt, a recoverable end, a replaced session and an incomplete nested record', () => {
  it('AC4 a prompt an extension handles without a run gets one delivery outcome without waiting for agent_start', async () => {
    expect(await handledScenario()).toEqual([]);
  }, 120_000);
  it('AC4 (wrong program) waits-for-agent-start: a delivery that waits on agent_start fails it', async () => {
    expect(await handledScenario('waits-for-agent-start'), 'the plant must leave the handled answer with no outcome').not.toEqual([]);
  }, 120_000);

  it('AC4 a run that ends recoverably before final settlement starts no competing continuation', async () => {
    expect(await recoverableScenario()).toEqual([]);
  }, 180_000);
  it('AC4 (wrong program) continues-on-end: an answer sent at the recoverable agent_end fails it', async () => {
    expect(await recoverableScenario('continues-on-end'), 'the plant must show as a competing continuation').not.toEqual([]);
  }, 180_000);

  it('AC4 a replaced session refuses a pending answer bound to the old generation', async () => {
    expect(await replacedScenario()).toEqual([]);
  }, 120_000);
  it('AC4 (wrong program) accepts-replaced: an answer accepted for a replaced generation fails it', async () => {
    expect(await replacedScenario('accepts-replaced'), 'the plant must deliver into the replacement session').not.toEqual([]);
  }, 120_000);

  it('AC4 a nested record pi marks incomplete past its 256 calls stays incomplete in the record, and its turn did work', async () => {
    const { problems, truth } = await nestedScenario(300, 0);
    expect(truth, 'pi 1.4.0 marks a record of 300 nested calls complete: false').toBe(false);
    expect(problems).toEqual([]);
  }, 180_000);
  it('AC4 a nested record cut by over-long arguments stays incomplete too', async () => {
    const { problems, truth } = await nestedScenario(1, 9000);
    expect(truth, 'pi 1.4.0 marks a record whose arguments it omitted complete: false').toBe(false);
    expect(problems).toEqual([]);
  }, 120_000);
  it('AC4 the twin: a nested record pi marks complete reads complete, so the check tells them apart', async () => {
    const { problems, truth, data } = await nestedScenario(2, 0);
    expect(truth).toBe(true);
    expect(problems).toEqual([]);
    expect((data?.nested as Line | undefined)?.complete).toBe(true);
  }, 120_000);
  it('AC4 (wrong program) drops-incomplete: normalizing an incomplete record away fails it', async () => {
    const { problems, truth } = await nestedScenario(300, 0, 'drops-incomplete');
    expect(truth).toBe(false);
    expect(problems, 'the plant must lose the incomplete mark').not.toEqual([]);
  }, 180_000);
});
