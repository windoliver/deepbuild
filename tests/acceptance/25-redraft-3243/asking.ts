// A session that asks you a question its stop waits on, and stops (README: The ask). The agent calls `deep_ask` with
// a choice between two options and no recommended option: the design gives only "a taste call or a choice with a
// recommendation" work that goes on at once, and "a taste call or choice that isn't provisional leaves the agent
// waiting on you", so this question holds the session's stop until you answer. Everything is reached through the
// infrastructure of tests/acceptance/25/routes/helpers.ts: the Claude Code stand-in running deep-hook and `deep mcp`
// from the settings `deep setup` wrote, and the hub's record over its socket.

import {
  Claude, allEvents, appendTranscript, assistantSays, callId, payload, tag, typedPrompt, waitFor, newSession,
  type Fired, type HookRun, type Hub, type Line, type Option, type Session,
} from '../25/routes/helpers.ts';

export interface HeldAsk { s: Session; claude: Claude; handle: string; id: string; question: string; blue: Option; green: Option; reply: Line; created: Line }

/** Up to the agent's last words after its deep_ask call: the ask is open and the session is about to stop. */
export async function heldAsk(hub: Hub, home: string): Promise<HeldAsk> {
  const s = newSession(home);
  const claude = Claude.start(home);
  await claude.hook('SessionStart', payload(s, 'SessionStart'));
  typedPrompt(s, 'Ask me which header colour to use, then stop.');
  await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'Ask me which header colour to use, then stop.' }));
  await claude.initialize();
  const t = tag(4);
  const blue = { id: `blue${t}`, label: `Blue header ${t}` };
  const green = { id: `green${t}`, label: `Green header ${t}` };
  const question = `Which header colour do you want for ${t}?`;
  // Every field of the tool's strict schema, the ones a choice doesn't use null; no recommended option.
  const args = { kind: 'choice', question, options: [blue, green], recommended: null, steps: null, where: null, why: null, check: null, thread: null, subject: null };
  const call = callId();
  appendTranscript(s, { type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(12)}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: call, name: 'mcp__deep__deep_ask', input: args }], stop_reason: 'tool_use', usage: { input_tokens: 2, output_tokens: 10 } } });
  await claude.hook('PreToolUse', payload(s, 'PreToolUse', { tool_name: 'mcp__deep__deep_ask', tool_input: args, tool_use_id: call }));
  const reply = await claude.request('tools/call', { name: 'deep_ask', arguments: args }, 120_000);
  const created = await waitFor(async () => (await allEvents(hub)).find((e) => e.kind === 'ask.created' && e.session === s.id && e.data?.question === question), 60_000, `the deep_ask "${question}" filed under ${s.id}`)
    .catch((error: Error) => { throw Error(`BLOCKED: ${error.message}; deep_ask replied ${JSON.stringify(reply).slice(0, 1500)}`); });
  const content = JSON.stringify(reply.result?.content ?? reply.error ?? reply);
  appendTranscript(s, { type: 'user', promptId: s.prompt, message: { role: 'user', content: [{ tool_use_id: call, type: 'tool_result', content }] } });
  await claude.hook('PostToolUse', payload(s, 'PostToolUse', { tool_name: 'mcp__deep__deep_ask', tool_input: args, tool_use_id: call, tool_response: reply.result ?? {} }));
  assistantSays(s, 'I asked which header colour you want; I will wait for your answer.');
  return { s, claude, handle: `ask:${created.id}`, id: created.id, question, blue, green, reply, created: created as unknown as Line };
}

/** What deep_ask told the agent: its reply's text, where it gave one. */
export const replyText = (a: HeldAsk): string => JSON.stringify(a.reply.result?.content ?? a.reply.error ?? a.reply);

export interface Stopping { stopping: Promise<Fired>; settled: () => boolean; waiter: HookRun & { event: string } }
/**
 * The session stops with its ask open. Returns once the hub has the Stop on its record and the waiter Claude Code
 * started at that Stop is running: the two events that show the Stop hook is out and the hub is holding it.
 */
export async function stopWithAskOpen(hub: Hub, a: HeldAsk): Promise<Stopping> {
  let done = false;
  const stopping = a.claude.hook('Stop', payload(a.s, 'Stop', { last_assistant_message: 'I asked which header colour you want; I will wait for your answer.' }));
  void stopping.then(() => { done = true; }, () => { done = true; });
  await waitFor(async () => (await allEvents(hub)).some((e) => e.kind === 'agent.stop' && e.session === a.s.id) || undefined, 60_000, `the hub's record of ${a.s.id}'s Stop`)
    .catch((error: Error) => { throw Error(`BLOCKED: ${error.message}`); });
  const [waiter] = await waitFor(async () => { const live = await a.claude.liveWaiters(a.s.id); return live.length ? live : undefined; }, 60_000, `the waiter Claude Code started at ${a.s.id}'s Stop`)
    .catch((error: Error) => { throw Error(`BLOCKED: ${error.message}`); });
  return { stopping, settled: () => done, waiter: waiter! };
}
