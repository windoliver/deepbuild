// AC3 #993.b40b1853: replaying a Grok hook run from a shell where Claude Code's variable is set records the events
// under grok; the merge base records them under claude-code and fails, naming the event.
//
// The run is `fixtures/grok-in-claude-shell.jsonl` (README: The nested Grok run): one Grok session's hooks, each as
// Grok runs DeepBuild's entry in Claude Code's settings, `deep-hook claude-code <Event>`, with Grok's own hook
// variables (GROK_HOOK_EVENT, GROK_HOOK_NAME, GROK_SESSION_ID, GROK_WORKSPACE_ROOT) and, because Grok was started from
// a shell inside a Claude Code session, Claude Code's CLAUDECODE=1 and CLAUDE_CODE_ENTRYPOINT inherited beside them.
// Each line is played through the real deep-hook binary into a real hub, and the record is read back on its socket.
// The twin: a Claude Code session of its own, run with Claude Code's variables alone, stays claude-code's.

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { AC3, allEvents, childEnv, claudeTranscript, cleanup, eventually, HookSession, makeHome, run, sessionsRead, shown, startHub, type Ev, type Line } from './helpers.ts';

afterAll(cleanup, 60_000);

const RUN = fileURLToPath(new URL('./fixtures/grok-in-claude-shell.jsonl', import.meta.url));
/** The recorded run with its placeholders filled: $HOME, $CWD and $SESSION. */
function recorded(vars: Record<string, string>): { event: string; env: Record<string, string>; payload: Line }[] {
  const fill = (text: string) => text.replace(/\$(HOME|CWD|SESSION)\b/g, (_, k: string) => vars[k]!);
  return readFileSync(RUN, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(fill(l)) as { event: string; env: Record<string, string>; payload: Line });
}
const agentOf = (e: Ev) => String(e.agent ?? e.data?.agent ?? '');
/** The kinds a hook itself maps to (the design's event table). */
const HOOK_KINDS = new Set(['session.start', 'session.end', 'user.ask', 'tool.before', 'tool.after', 'permission.request', 'agent.stop']);

describe(`${AC3} a tool started inside a Claude Code session keeps its own name`, () => {
  it(`${AC3} a Grok hook run replayed from a shell where CLAUDECODE is set records its events under grok, never claude-code`, async () => {
    const h = await makeHome();
    const hub = await startHub(h);
    const session = randomUUID();
    const cwd = join(h.tmp, 'grok-work');
    mkdirSync(cwd);
    const lines = recorded({ HOME: h.home, CWD: cwd, SESSION: session });
    const transcript = join(h.home, '.grok/sessions', `${session}.jsonl`);
    mkdirSync(dirname(transcript), { recursive: true });
    writeFileSync(transcript, '');
    for (const line of lines) {
      const ran = await run(h.copy.deepHook, ['claude-code', line.event], { cwd, env: childEnv(h, line.env), input: JSON.stringify(line.payload), timeoutMs: 60_000 });
      expect(ran.code, `the replayed ${line.event} ran through deep-hook: ${shown(ran)}`).toBe(0);
    }

    // The twin: a Claude Code session of its own, in the same hub, with Claude Code's variables alone.
    const claudeId = randomUUID();
    const claude = new HookSession(h.copy.deepHook, h.work, claudeTranscript(h.home, h.work, claudeId), childEnv(h, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: h.work }), undefined, claudeId);
    await claude.start();
    await claude.prompt('List the files here.');

    let events: Ev[] = [];
    await eventually(async () => {
      events = await allEvents(hub);
      const kinds = new Set(events.filter((e) => e.session === session).map((e) => e.kind));
      return ['session.start', 'user.ask', 'tool.before', 'tool.after'].every((k) => kinds.has(k)) && events.some((e) => e.session === claudeId && e.kind === 'user.ask');
    }, 30_000);

    const grok = events.filter((e) => e.session === session);
    expect(grok.length, `${AC3} the replayed Grok run is recorded: ${JSON.stringify(events.map((e) => [e.kind, e.session, agentOf(e)]))}`).toBeGreaterThan(0);
    // Every event that names an agent names grok, and each hook's own event names one.
    const wrong = grok.filter((e) => (HOOK_KINDS.has(e.kind) || agentOf(e) !== '') && agentOf(e) !== 'grok');
    const named = wrong.map((e) => `${e.kind} (agent ${agentOf(e) || 'none'})`);
    expect(named, `${AC3} every event of the Grok run started from a Claude Code shell is recorded under grok; these were not (hooks replayed: ${lines.map((l) => l.event).join(', ')})`).toEqual([]);
    const row = (await sessionsRead(hub)).find((r) => r.id === session);
    expect(row?.agent, `${AC3} the Grok session's row is grok's: ${JSON.stringify(row)}`).toBe('grok');

    const mine = events.filter((e) => e.session === claudeId);
    expect(mine.length, 'the twin Claude Code session is recorded').toBeGreaterThan(0);
    expect(mine.filter((e) => (HOOK_KINDS.has(e.kind) || agentOf(e) !== '') && agentOf(e) !== 'claude-code').map((e) => `${e.kind} (agent ${agentOf(e) || 'none'})`), `${AC3} a Claude Code session with Claude Code's variables alone stays claude-code's`).toEqual([]);
  }, 300_000);
});
