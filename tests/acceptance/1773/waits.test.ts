// #1773 AC1: a Claude Code session's call to `mcp__deepbuild__deep_claim` (DeepBuild's own server, as `deep setup`
// registers it for Claude Code) that runs past the expected time is never recorded as `call.overrun`, never named in a
// "still waiting" reading, and never added to the timing history. Through a real hub, with Claude Code's hook lines:
// the call starts (PreToolUse) in a turn and runs past an MCP call's expected time (1 min with no history), the
// session's ticker is read as Claude Code's FileChanged hook reads it, the call ends (PostToolUse), and the same tool
// is called again, which a timing history over a minute would announce.
//
// The twin in the same hub and the same minute: a Claude Code session's third-party call, `mcp__forge__list_issues`,
// run the same way, is recorded as an overrun, named in a still-waiting reading and announced next time. It shows the
// run reaches each of the three, so their absence for deep_claim is the program's doing, not the test's.
import { describe, expect, it } from 'vitest';
import { claudeSession, eventsOf, MCP_EXPECTED_MS, mcpCall, out, readingsOf, sleep, tickerOf, until, startHub, type Hub, type Session } from './helpers.ts';

const OURS = 'mcp__deepbuild__deep_claim';
const THEIRS = 'mcp__forge__list_issues';
const CLAIM = { claim: 'The parser handles tabs.', evidence: [] };

/** A session's start and a turn's prompt: calls outside a turn the hub saw begin are no waits. */
async function begin(s: Session, prompt: string): Promise<void> {
  await s.send('SessionStart', { source: 'startup' });
  await s.send('UserPromptSubmit', { prompt, prompt_id: `p-${s.id.slice(0, 4)}` });
}

describe('#1773.3ccc73f7 A Claude Code session\'s call to `mcp__deepbuild__deep_claim` that runs past the expected time is never recorded as `call.overrun`, never named in a "still waiting" reading, and never added to the timing history. The merge base records it as an overrun', () => {
  it('deep_claim past its expected time: no call.overrun, no still-waiting reading, no history; the third-party twin gets all three', async () => {
    const hub: Hub = await startHub();
    const ours = claudeSession(hub, '1773aaaa-1111-4222-8333-444455556666');
    const theirs = claudeSession(hub, '1773bbbb-1111-4222-8333-444455556666');
    await begin(ours, 'Claim the parser work.');
    await begin(theirs, 'List the open issues.');

    const t0 = Date.now();
    expect(out(await ours.send('PreToolUse', mcpCall(OURS, 'toolu_ours_1', CLAIM)))).toEqual({});
    expect(out(await theirs.send('PreToolUse', mcpCall(THEIRS, 'toolu_theirs_1', {})))).toEqual({});

    // Both run past an MCP call's expected time; the twin's overrun is recorded by the hub's timer while it runs.
    const recorded = await until(() => eventsOf(hub, theirs.id, 'call.overrun').length > 0, MCP_EXPECTED_MS + 30_000);
    expect(recorded, `the twin's call is recorded as call.overrun past ${MCP_EXPECTED_MS} ms (the harness reaches an overrun)`).toBe(true);
    await sleep(Math.max(0, t0 + MCP_EXPECTED_MS + 3000 - Date.now()));
    expect(Date.now() - t0, 'both calls ran past the expected time').toBeGreaterThan(MCP_EXPECTED_MS);

    // Claude Code's FileChanged hook on each session's ticker, as the SessionStart reply's watchPaths name it.
    const changedOurs = await ours.send('FileChanged', { file_path: tickerOf(hub, ours.id), event: 'change' });
    const changedTheirs = await theirs.send('FileChanged', { file_path: tickerOf(hub, theirs.id), event: 'change' });
    expect(String(out(changedTheirs).systemMessage), 'the twin is shown as still waiting').toContain(`still waiting on \`${THEIRS}\``);

    // The calls end well, a little over a minute in.
    const endedOurs = await ours.send('PostToolUse', mcpCall(OURS, 'toolu_ours_1', CLAIM, { tool_response: [{ type: 'text', text: '{"claim":"claim:01"}' }] }));
    await theirs.send('PostToolUse', mcpCall(THEIRS, 'toolu_theirs_1', {}, { tool_response: [{ type: 'text', text: '[]' }] }));

    // The same tools again: a history of a run over a minute announces the next run as it starts.
    const againOurs = await ours.send('PreToolUse', mcpCall(OURS, 'toolu_ours_2', CLAIM));
    const againTheirs = await theirs.send('PreToolUse', mcpCall(THEIRS, 'toolu_theirs_2', {}));
    expect(String(out(againTheirs).systemMessage), 'the twin\'s run entered the timing history').toBe(`DeepBuild: waiting on \`${THEIRS}\` · about 1 min expected`);
    await sleep(2000);
    const twinReadings = readingsOf(hub, theirs.id);
    expect(twinReadings.some((r) => r.includes(`still waiting on \`${THEIRS}\``)), `the twin is named in a still-waiting reading: ${JSON.stringify(twinReadings)}`).toBe(true);

    // deep_claim: never recorded as call.overrun.
    const overruns = eventsOf(hub, ours.id, 'call.overrun');
    expect(overruns, `deep_claim is never recorded as call.overrun: ${JSON.stringify(overruns)}`).toEqual([]);
    // Never named in a "still waiting" reading, nor in any line of an overrun the chat or the row shows.
    const readings = readingsOf(hub, ours.id);
    expect(readings.filter((r) => r.includes(OURS) || r.includes('toolu_ours_1')), 'no reading of the session names deep_claim or its call').toEqual([]);
    expect(readings.filter((r) => /still waiting/.test(r)), 'no still-waiting reading in the session').toEqual([]);
    expect(String(out(changedOurs).systemMessage ?? ''), 'the FileChanged reply shows no still-waiting line').not.toContain('still waiting');
    expect(String(out(endedOurs).systemMessage ?? ''), 'the call\'s end shows no overrun line').not.toContain(OURS);
    // Never added to the timing history: its next run is not announced from a minute-long history.
    expect(String(out(againOurs).systemMessage ?? ''), 'deep_claim\'s run never entered the timing history').not.toContain(OURS);
  }, 180_000);
});
