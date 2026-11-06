// AC1: a past task whose session posted a release note through a chat MCP tool replays with no message sent. The task
// comes from its archived transcript (#20) through `archivedTasks`, so its recording is the transcript's own call and
// result; the replay runs on the real default launcher against a stand-in Claude Code that loads whatever MCP servers
// and settings it is handed.
import { afterEach, describe, expect, it } from 'vitest';
import { AC1, CHAT_TOKEN, archivedTasksOf, at, cleanup, runsOf, shown, world } from './helpers.ts';

afterEach(cleanup);

const PROMPT = 'Post the v1.4.0 release note to #releases.';
const NOTE = { channel: '#releases', text: "v1.4.0 is out: cart totals now count each item's quantity." };
/** What the chat server answered the original session: the recorded result. */
const RECORDED = '{"ok":true,"channel":"C0FAKE01","ts":"1759655643.000100"}';

describe(`AC1 ${AC1} a past task that posted a release note through a chat MCP tool replays with no message sent`, () => {
  it('each replayed post gets the recorded result from the transcript, and the chat fixture server records zero requests', async () => {
    const w = await world({ [PROMPT]: { steps: [{ tool: 'mcp__chat__post_message', input: NOTE }] } });
    const tasks = await archivedTasksOf(w, [
      { type: 'user', uuid: 'u1', sessionId: 's1', timestamp: at(1), cwd: w.repo, gitBranch: 'main', message: { role: 'user', content: PROMPT } },
      { type: 'assistant', uuid: 'a1', sessionId: 's1', timestamp: at(1.01), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_01Read', name: 'Read', input: { file_path: `${w.repo}/CLAUDE.md` } }] } },
      { type: 'user', uuid: 'u2', sessionId: 's1', timestamp: at(1.02), cwd: w.repo, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01Read', content: '# Shop\n' }] } },
      { type: 'assistant', uuid: 'a2', sessionId: 's1', timestamp: at(1.03), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_02Post', name: 'mcp__chat__post_message', input: NOTE }] } },
      { type: 'user', uuid: 'u3', sessionId: 's1', timestamp: at(1.04), cwd: w.repo, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_02Post', content: [{ type: 'text', text: RECORDED }] }] }, toolUseResult: [{ type: 'text', text: RECORDED }] },
      { type: 'assistant', uuid: 'a3', sessionId: 's1', timestamp: at(1.05), message: { role: 'assistant', content: [{ type: 'text', text: 'Posted the release note.' }] } },
    ]);
    expect(tasks.map((t) => t.prompt), 'archivedTasks reads the archived session as one task').toEqual([PROMPT]);

    const report = await w.run(w.plan([tasks[0]!.id]), tasks);

    // The message is never sent: the user's chat server is never reached.
    expect.soft(w.chat.hits.length,
      `the chat fixture server (your MCP server "chat" at ${w.chat.url}/mcp) got ${w.chat.hits.length} requests (${w.chat.hits.map((h) => (JSON.parse(h.body || '{}') as { method?: string }).method).join(', ')}): `
      + 'a launcher that loads your MCP servers sent the message').toBe(0);
    // Each side's replayed post got the recorded result, as a result, not an error.
    const seen = runsOf(w, PROMPT);
    expect.soft(seen.length, 'both sides ran and reached their model endpoint').toBe(2);
    for (const { obs } of seen) {
      const post = obs.calls.find((c) => c.tool === 'mcp__chat__post_message');
      expect.soft(post && !post.is_error && post.content.trim() === RECORDED, `the replayed post gets the recorded result ${RECORDED}; it got: ${shown(post)}`).toBe(true);
      // None of your MCP servers is loaded: not your chat server with its token, and not your other server.
      for (const [name, cfg] of Object.entries(obs.servers)) {
        const text = JSON.stringify(cfg);
        expect.soft(text.includes(CHAT_TOKEN) || text.includes(w.chat.url), `the replayed agent loaded your MCP server "chat" (${w.chat.url}/mcp, with its token) as "${name}"`).toBe(false);
      }
      expect.soft(Object.keys(obs.servers), 'the replayed agent loaded your MCP server "tracker"').not.toContain('tracker');
    }
    // The replay's record holds both posts, each answered from the recording, and the pair didn't diverge.
    const calls = (report.calls ?? []).filter((c) => c.tool === 'mcp__chat__post_message');
    expect.soft(calls.map((c) => [c.side, c.answered]).sort(), `the replay's record (report.calls) holds each side's post, answered: ${JSON.stringify(report.calls)}`)
      .toEqual([['base', true], ['change', true]]);
    expect.soft(report.diverged, 'a replay whose calls the recording answered reads not diverged').toEqual([]);
    expect.soft(report.runs.map((r) => r.ok), 'both runs finished').toEqual([true, true]);
  }, 120_000);
});
