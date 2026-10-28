// AC6 and AC12: MCP calls in the record, counted from the facts file of well-known servers, matched by the server's
// name and the source Claude Code loads it from. The well-known `github` server is GitHub's official remote server
// (https://api.githubcopilot.com/mcp/) in your user-scope MCP config (~/.claude.json's mcpServers); a repo's
// `.mcp.json` server that only borrows the name is unknown. Calls run through deep-hook into `deep hub run`; each
// tool.before is read through `events.read`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AC12, AC6, cleanup, failureOf, forCall, makeHome, ofSession, Session, settle, shown, startHub, tempDir, type Ev, type Hub } from './helpers.ts';

afterAll(cleanup, 60_000);

const COUNTS = ['read', 'change', 'send', 'destructive'];
const OFFICIAL = { type: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer ${GITHUB_PAT}' } };
const MERGE = 'mcp__github__merge_pull_request';
const READ = 'mcp__github__get_pull_request';
const UNKNOWN = 'mcp__github__frobnicate_widgets';

/** A home whose user-scope MCP config holds GitHub's official server as `github`. */
function homeWithOfficialGithub(): string {
  const home = makeHome();
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { github: OFFICIAL } }, null, 2));
  return home;
}
/** A home with no user-scope servers, and a repo whose `.mcp.json` names its own stdio server `github`, approved for the repo. */
function homeWithRepoGithub(): { home: string; work: string } {
  const home = makeHome();
  const work = join(tempDir(), 'work');
  mkdirSync(work);
  writeFileSync(join(work, '.mcp.json'), JSON.stringify({ mcpServers: { github: { type: 'stdio', command: 'node', args: ['./tools/github-mcp.mjs'] } } }, null, 2));
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ projects: { [work]: { enabledMcpjsonServers: ['github'], hasTrustDialogAccepted: true } } }, null, 2));
  return { home, work };
}

/** One session making each MCP call in `tools` (PreToolUse and PostToolUse), then stopping; returns each call's ID by tool. */
async function mcpSession(hub: Hub, tools: string[], cwd?: string): Promise<{ s: Session; calls: Map<string, string> }> {
  const s = new Session(hub.home, cwd ? { cwd } : {});
  await s.start();
  await s.prompt('Merge pull request 7 once it is green.');
  const calls = new Map<string, string>();
  for (const tool of tools) {
    const call = await s.call(tool, { owner: 'acme', repo: 'shop', pullNumber: 7 }, { response: [{ type: 'text', text: '{}' }] });
    calls.set(tool, call.id);
  }
  await s.stop('Done.');
  return { s, calls };
}
/** The tool.before the record holds for each call, by tool, once each names a count class. */
async function befores(hub: Hub, s: Session, calls: Map<string, string>): Promise<Map<string, Ev | undefined>> {
  const events = await settle(hub, (all) => [...calls.values()].every((call) => forCall(ofSession(all, s.id), 'tool.before', call).some((e) => typeof e.data.counts === 'string')));
  return new Map([...calls].map(([tool, call]) => [tool, forCall(ofSession(events, s.id), 'tool.before', call)[0]]));
}
const named = (e: Ev | undefined, server: string, tool: string) => e?.data.kind === 'mcp' && e.data.server === server && [tool, `mcp__${server}__${tool}`].includes(e.data.tool);

/** AC6's assertions on the unknown tool: the test and the wrong program's test share them, so the twin fails exactly here. */
function unknownCountsAsChange(before: Ev | undefined): void {
  expect(named(before, 'github', 'frobnicate_widgets'), `${UNKNOWN} is recorded as the mcp kind naming its server and tool: ${shown(before)}`).toBe(true);
  expect(before!.data.counts, `${UNKNOWN} is missing from the facts file, so it counts as change, never read: ${shown(before)}`).toBe('change');
}

describe(`${AC6} mcp__github__merge_pull_request counts as merge; a tool missing from the facts file counts as change`, () => {
  it(`${AC6} the merge call is the mcp kind naming github and merge_pull_request, in effect class merge from the facts file; an unknown github tool counts as change`, async () => {
    const hub = await startHub(homeWithOfficialGithub());
    const { s, calls } = await mcpSession(hub, [MERGE, UNKNOWN]);
    const seen = await befores(hub, s, calls);
    const merge = seen.get(MERGE);
    expect(named(merge, 'github', 'merge_pull_request'), `${MERGE} is recorded as the mcp kind naming its server and tool: ${shown(merge)}`).toBe(true);
    expect(COUNTS, `the merge call names its count class: ${shown(merge)}`).toContain(merge!.data.counts);
    expect(merge!.data.effect, `the facts file counts ${MERGE} as merge: ${shown(merge)}`).toBe('merge');
    unknownCountsAsChange(seen.get(UNKNOWN));
  }, 180_000);

  it(`${AC6} (wrong program) an adapter that counts an unknown tool as read (DEEP_HUB_PLANT=unknown-tool-read) fails this test, naming the tool`, async () => {
    const hub = await startHub(homeWithOfficialGithub(), 'unknown-tool-read');
    const { s, calls } = await mcpSession(hub, [UNKNOWN]);
    const seen = await befores(hub, s, calls);
    const failure = await failureOf(() => unknownCountsAsChange(seen.get(UNKNOWN)));
    expect(failure, 'the planted adapter must fail the unknown-tool assertion').not.toBeNull();
    expect(failure, 'the failure names the tool').toContain(UNKNOWN);
    expect(seen.get(UNKNOWN)?.data.counts, `the plant counts the unknown tool as read: ${shown(seen.get(UNKNOWN))}`).toBe('read');
  }, 180_000);
});

describe(`${AC12} a repo's .mcp.json server named github is unknown`, () => {
  it(`${AC12} the official github server's get_pull_request counts as read from the facts file, while the same tools of a repo .mcp.json server named github count as change`, async () => {
    // The facts file lists the official server's get_pull_request as read: the control that makes the case below bite.
    const official = await startHub(homeWithOfficialGithub());
    const control = await mcpSession(official, [READ]);
    const read = (await befores(official, control.s, control.calls)).get(READ);
    expect(named(read, 'github', 'get_pull_request'), shown(read)).toBe(true);
    expect(read!.data.counts, `the facts file lists the official github server's get_pull_request as read: ${shown(read)}`).toBe('read');

    const { home, work } = homeWithRepoGithub();
    const hub = await startHub(home);
    const { s, calls } = await mcpSession(hub, [READ, MERGE], work);
    const seen = await befores(hub, s, calls);
    for (const tool of [READ, MERGE]) {
      const before = seen.get(tool);
      expect(before?.data.kind, `${tool} from the repo's server is still an mcp call: ${shown(before)}`).toBe('mcp');
      expect(before!.data.counts, `${tool} comes from a server the repo's .mcp.json names github, which is no well-known server, so it counts as change: ${shown(before)}`).toBe('change');
    }
  }, 240_000);
});
