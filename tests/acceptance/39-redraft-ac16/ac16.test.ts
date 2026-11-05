// Blind redraft of #39 AC16's SubagentStop half (README). Through the real hub and deep-hook, a Codex subagent's
// SubagentStop, which carries the root session's ID with an agent_id, is the child's stop: never held, never judged,
// recorded under the root session as an agent.stop naming the child, and never read as the session's own turn end.
import { afterAll, describe, expect, it } from 'vitest';
import { AC, allEvents, begin, cleanup, codexHook, hookShown, hubWithSetup, makeHome, newThread, ofSession, tag } from '../39/helpers.ts';

const A = AC[16];

describe('#39 AC16 (redraft): a subagent\'s SubagentStop never holds or judges the parent\'s stop', () => {
  afterAll(cleanup);

  it(`${A} a Codex subagent's SubagentStop is recorded as the child's stop, never held or judged as the session's`, async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const t = newThread(h);
    await begin(h, t);
    const child = `agent-${tag()}`;
    const agent_type = 'worker';

    const start = await codexHook(h, t, 'SubagentStart', { agent_id: child, agent_type });
    expect(start.ran.code, `${A} SubagentStart's hook must exit 0: ${hookShown(start)}`).toBe(0);
    const tool = await codexHook(h, t, 'PreToolUse', { agent_id: child, agent_type, tool_name: 'Bash', tool_use_id: `call_${tag()}`, tool_input: { command: 'ls' } });
    expect(tool.ran.code, `${A} the child's PreToolUse hook must exit 0: ${hookShown(tool)}`).toBe(0);

    const stop = await codexHook(h, t, 'SubagentStop', { agent_id: child, agent_type, stop_hook_active: false, last_assistant_message: null, agent_transcript_path: null });
    expect(stop.ran.code, `${A} SubagentStop's hook must exit 0: ${hookShown(stop)}`).toBe(0);
    expect(stop.ran.ms, `${A} a child's stop is never held: SubagentStop must reply in under 10 s: ${hookShown(stop)}`).toBeLessThan(10_000);
    expect(stop.reply?.decision, `${A} a child's stop is never sent back: no decision in the SubagentStop reply: ${hookShown(stop)}`).toBeUndefined();

    const events = await allEvents(hub);
    const stops = ofSession(events, t.id, 'agent.stop');
    expect(stops.length, `${A} exactly one agent.stop under the root session: ${JSON.stringify(stops)}`).toBe(1);
    expect(stops[0]!.data.child, `${A} the agent.stop names the child by its agent_id, so it reads as no turn end of the session: ${JSON.stringify(stops[0])}`).toBe(child);
    expect(ofSession(events, t.id, 'claim.made'), `${A} a child's stop is never judged: no claim.made for the session`).toEqual([]);
    expect(ofSession(events, t.id, 'session.start').length, `${A} the subagent is no new session: still one session.start`).toBe(1);
  }, 300_000);
});
