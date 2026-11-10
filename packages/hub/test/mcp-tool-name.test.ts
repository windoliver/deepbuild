// An MCP call is recorded and classed under its tool's own name, whichever agent made it. Codex's mapped call keeps
// the payload's `mcp__server__tool` as `tool` and the tool's own name as `name`; Claude Code's has the tool's own
// name as `tool`. The payloads are shaped as the adapters' corpus has them, sent through the hub's own mapping.
import { expect, it } from 'vitest';
import { parseLine } from '../src/hookmap.js';

let seq = 0;
/** What the hub records before an MCP call, from the hook as deep-hook sends it. */
function before(agent: 'claude-code' | 'codex', payload: Record<string, unknown>): Record<string, unknown> {
  const line = JSON.stringify({
    v: 1, agent, event: 'PreToolUse', seq: String(++seq), id: `01K74FKZVK8Q2X5R7M3N9P${String(seq).padStart(4, '0')}`, pid: 1, ppid: 1, matched: [],
    payload: { cwd: '/private/tmp', hook_event_name: 'PreToolUse', tool_name: 'mcp__forge__delete_branch', tool_input: { branch: 'old' }, ...payload },
  });
  const parsed = parseLine(Buffer.from(line), true, []);
  if (parsed.kind !== 'hook') throw Error(`not a hook: ${JSON.stringify(parsed)}`);
  return parsed.drafts.find((d) => d.kind === 'tool.before')!.data;
}

it('a Codex MCP call is recorded under its tool\'s own name, so a delete_ tool counts as destructive', () => {
  const data = before('codex', { session_id: '01a1580d-62c7-7a42-9c6e-69c0961b8533', turn_id: '01a15810-c2d0-7212-9323-8c5a1f1188b3', model: 'gpt-6-astra', permission_mode: 'bypassPermissions', tool_use_id: 'exec-78f5cdca' });
  expect(data).toMatchObject({ kind: 'mcp', server: 'forge', tool: 'delete_branch', counts: 'destructive' });
});

it('a Claude Code MCP call reads the same', () => {
  const data = before('claude-code', { session_id: '1e2053ee-a7c7-46ca-8eeb-8972a74be1ae', permission_mode: 'auto', tool_use_id: 'toolu_01Eco2SaDunqGtHwZFpznoiq', mcp_server: { name: 'forge', source: 'dynamic' } });
  expect(data).toMatchObject({ kind: 'mcp', server: 'forge', tool: 'delete_branch', counts: 'destructive' });
});
