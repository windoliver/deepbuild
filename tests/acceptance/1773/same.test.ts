// #1773 AC3: a Codex `mcp__deep__deep_*` call (Codex and pi register DeepBuild's server as `deep`) and a server named
// `deep` are still skipped as today. Through a real hub with Codex's hook lines, a `mcp__deep__deep_claim` call that
// runs past an MCP call's expected time (1 min with no history) is never recorded as `call.overrun`, never named in a
// reading, and never enters the timing history; its twin, a third-party Codex call run the same way in the same hub,
// is recorded and announced. And `toolLists`, with a `deep` server in ~/.claude.json beside a third-party one,
// neither starts `deep` nor lists it. Both pass at the merge base.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toolLists } from '../../../packages/hub/src/mcp-servers.ts';
import {
  claudeJson, codexSession, eventsOf, everStarted, installServer, MCP_EXPECTED_MS, mcpCall, readingsOf, sleep, startHub, tempDir, until, withHome, type Session,
} from './helpers.ts';

const OURS = 'mcp__deep__deep_claim';
const THEIRS = 'mcp__forge__list_issues';
const CLAIM = { claim: 'The parser handles tabs.', evidence: [] };
async function begin(s: Session, prompt: string): Promise<void> {
  await s.send('SessionStart', { source: 'startup' });
  await s.send('UserPromptSubmit', { prompt });
}

describe('#1773.6bec8743 A Codex or pi `mcp__deep__deep_*` call and a server named `deep` are still skipped as today', () => {
  it('a Codex mcp__deep__deep_claim past its expected time: no call.overrun, no reading, no history; the third-party twin gets them', async () => {
    const hub = await startHub();
    const ours = codexSession(hub, '0199a0b0-1773-7000-8000-0000000000aa');
    const theirs = codexSession(hub, '0199a0b0-1773-7000-8000-0000000000bb');
    await begin(ours, 'Claim the parser work.');
    await begin(theirs, 'List the open issues.');

    const t0 = Date.now();
    await ours.send('PreToolUse', mcpCall(OURS, 'call_ours_1', CLAIM));
    await theirs.send('PreToolUse', mcpCall(THEIRS, 'call_theirs_1', {}));
    const recorded = await until(() => eventsOf(hub, theirs.id, 'call.overrun').length > 0, MCP_EXPECTED_MS + 30_000);
    expect(recorded, `the twin's call is recorded as call.overrun past ${MCP_EXPECTED_MS} ms (the harness reaches an overrun)`).toBe(true);
    await sleep(Math.max(0, t0 + MCP_EXPECTED_MS + 3000 - Date.now()));
    expect(Date.now() - t0, 'both calls ran past the expected time').toBeGreaterThan(MCP_EXPECTED_MS);

    const endedOurs = await ours.send('PostToolUse', mcpCall(OURS, 'call_ours_1', CLAIM, { tool_response: '{"claim":"claim:01"}' }));
    await theirs.send('PostToolUse', mcpCall(THEIRS, 'call_theirs_1', {}, { tool_response: '[]' }));
    const againOurs = await ours.send('PreToolUse', mcpCall(OURS, 'call_ours_2', CLAIM));
    const againTheirs = await theirs.send('PreToolUse', mcpCall(THEIRS, 'call_theirs_2', {}));
    expect(againTheirs.stdout, 'the twin\'s run entered the timing history').toContain(`waiting on \`${THEIRS}\` · about 1 min expected`);
    await sleep(2000);
    expect(readingsOf(hub, theirs.id).some((r) => r.includes('call_theirs_1')), 'the twin\'s overrun is on its row').toBe(true);

    expect(eventsOf(hub, ours.id, 'call.overrun'), 'deep_claim is never recorded as call.overrun').toEqual([]);
    expect(readingsOf(hub, ours.id).filter((r) => r.includes(OURS) || r.includes('call_ours_1')), 'no reading names deep_claim or its call').toEqual([]);
    expect(endedOurs.stdout, 'the call\'s end shows no overrun line').not.toContain(OURS);
    expect(againOurs.stdout, 'deep_claim\'s run never entered the timing history').not.toContain(OURS);
  }, 180_000);

  it('toolLists neither starts nor lists a server named deep, and lists the third-party server beside it', async () => {
    const home = tempDir();
    const work = join(home, 'work');
    mkdirSync(work, { recursive: true });
    const deep = installServer(home, 'deep/packages/cli/dist', 'main.js', 'deep', ['deep_claim', 'deep_ask'], ['mcp']);
    const forge = installServer(home, 'forge', 'server.mjs', 'forge', ['list_issues']);
    claudeJson(home, { deep: deep.config, forge: forge.config });

    const lists = await withHome(home, () => toolLists(work));

    expect(lists.map((l) => l.server), 'toolLists returns a list for forge and none for deep').toEqual(['forge']);
    expect(lists[0]!.tools.map((t) => t.name)).toEqual(['list_issues']);
    expect(everStarted(forge), 'forge was started to read its list').toBe(true);
    expect(everStarted(deep), 'the deep server is never started').toBe(false);
  }, 60_000);
});
