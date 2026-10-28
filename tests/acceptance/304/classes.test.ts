// #304 AC6: a server's hints and a tool's name only raise a tool's class, never lower it. Each MCP call runs through
// deep-hook into a running hub, and the class the adapter counts it as is read back from the record (tool.before's
// data.counts, the field #18 records). The well-known `github` server is GitHub's official remote server in your
// user-scope MCP config, as the facts file (adapters/mcp-servers.facts.json) matches it; `slack` and `forge` are
// servers the facts file doesn't list. What the sessions recorded of each server's tool list (its hints) and the
// decisions you saved about a tool reach the hub through DEEP_HUB_TEST_MCP_TOOLS, a file only tests name, standing
// for those records (README, Tool lists and saved decisions). A classifier that trusts a readOnlyHint or a read-like
// name (DEEP_HUB_PLANT=trusts-hints) fails this test, naming the tool.
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC6, befores, cleanup, failureOf, hook, makeHome, must, newSession, preToolUse, startHub, stopHub, tempDir,
  type Ev,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const OFFICIAL = { type: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer ${GITHUB_PAT}' } };
const STDIO = (name: string) => ({ type: 'stdio', command: 'node', args: [`./${name}-mcp.mjs`] });

/** What sessions recorded of each server's tool list, with the hints the server gives, and your saved decisions. */
const TOOLS = {
  lists: {
    github: [
      { name: 'get_me', annotations: { destructiveHint: true } },
      { name: 'get_pull_request', annotations: {} },
    ],
    slack: [
      { name: 'list_messages' },
      { name: 'list_channels', annotations: { readOnlyHint: true } },
      { name: 'get_channel_info', annotations: { readOnlyHint: true } },
    ],
    forge: [
      { name: 'delete_branch', annotations: { readOnlyHint: true } },
    ],
  },
  decisions: { slack: { get_channel_info: 'read' } },
};

/** Each call, what the criterion says it counts as, and why. */
const CASES: { tool: string; counts: string; why: string }[] = [
  { tool: 'mcp__slack__list_messages', counts: 'change', why: 'no hints and no facts entry: a name that reads like a read never counts it as read' },
  { tool: 'mcp__github__get_me', counts: 'destructive', why: 'the facts file lists it as read, but its server marks it destructiveHint: true, which raises it' },
  { tool: 'mcp__forge__delete_branch', counts: 'destructive', why: 'a name that starts with delete_ counts it as destructive, and its readOnlyHint never lowers it' },
  { tool: 'mcp__slack__list_channels', counts: 'change', why: 'a readOnlyHint and a list_ name, with no facts entry and no decision, never move it to read' },
  { tool: 'mcp__github__get_pull_request', counts: 'read', why: 'a facts entry moves it to read' },
  { tool: 'mcp__slack__get_channel_info', counts: 'read', why: 'your saved decision moves it to read' },
];

async function observe(plant?: string): Promise<Map<string, Ev | undefined>> {
  const home = makeHome();
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { github: OFFICIAL, slack: STDIO('slack'), forge: STDIO('forge') } }, null, 2));
  const tools = join(tempDir(), 'mcp-tools.json');
  writeFileSync(tools, JSON.stringify(TOOLS, null, 2));
  const hub = await startHub(home, { ...(plant ? { plant } : {}), env: { DEEP_HUB_TEST_MCP_TOOLS: tools } });
  try {
    const s = newSession(home);
    const ids = new Map<string, string>();
    for (const c of CASES) {
      const body = preToolUse(s, { tool_name: c.tool, tool_input: { owner: 'acme', repo: 'shop' } });
      ids.set(c.tool, body.tool_use_id as string);
      await hook(home, body);
    }
    const found = await befores(hub, [...ids.values()], (e) => typeof e.data.counts === 'string');
    return new Map(CASES.map((c) => [c.tool, found.get(ids.get(c.tool)!)]));
  } finally {
    await stopHub(hub);
  }
}

function judgeAC6(seen: Map<string, Ev | undefined>): void {
  for (const c of CASES) {
    const e = seen.get(c.tool);
    must(e?.data.kind === 'mcp', `${c.tool}: the call must be recorded as the mcp kind: ${JSON.stringify(e?.data)}`);
    must(e!.data.counts === c.counts, `${c.tool} must count as ${c.counts} (${c.why}), not ${String(e!.data.counts)}: ${JSON.stringify(e!.data)}`);
  }
}

describe(`AC6 ${AC6} hints and names only raise a tool's class; only a facts entry or your saved decision moves a tool to read`, () => {
  it('AC6 list_messages counts as change; a facts-read tool marked destructiveHint and delete_branch marked readOnlyHint count as destructive; only a facts entry or a saved decision counts a tool as read', async () => {
    judgeAC6(await observe());
  }, 900_000);

  it('AC6 (wrong program) a classifier that trusts a readOnlyHint or a read-like name (DEEP_HUB_PLANT=trusts-hints) fails this test, naming the tool', async () => {
    const seen = await observe('trusts-hints');
    const failure = await failureOf(() => judgeAC6(seen));
    expect(failure, 'the classifier that trusts hints must fail the criterion').not.toBeNull();
    expect(failure, 'the failure names the tool').toContain('mcp__slack__list_messages');
    expect(seen.get('mcp__slack__list_messages')?.data.counts, 'the plant counts list_messages as read').toBe('read');
  }, 900_000);
});
