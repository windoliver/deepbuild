// AC21: who is calling, and a quiet turn read as unknown.
// Cursor's CLI and Grok run the hooks in Claude Code's user settings file, so their hooks reach deep-hook as
// `deep-hook claude-code <event>`, the command DeepBuild installed there. Each session below is shaped as its tool
// documents it: Cursor's hook input carries its own base fields (conversation_id, generation_id, cursor_version,
// workspace_roots) beside the Claude Code ones, and its hooks see CURSOR_VERSION and CURSOR_PROJECT_DIR and no
// CLAUDECODE; Grok's hooks see GROK_HOOK_EVENT, GROK_SESSION_ID and GROK_WORKSPACE_ROOT, with a Claude-shaped input
// whose transcript is Grok's own. Neither is Claude Code's, whatever the command says.
// The quiet turns: one whose prompt went in and then no hook came (waiting on a model picker), and one stopped
// between a call's PreToolUse and anything after it (waiting on a trust prompt). The session's attention is read
// from the session registry (`sessions.read`: its row's `attention`, or its `status`) and from its session.attention
// events; it must reach `unknown` and never read `finished`.
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AC21, cleanEnv, cleanup, inboxRead, kindOf, makeHome, ofSession, Session, sessionsRead, settle, shown, sleep, startHub, tempDir, type Ev, type Line } from './helpers.ts';

afterAll(cleanup, 60_000);

const CLAUDE = ['claude-code', 'claude'];

function cursorSession(home: string): Session {
  const cwd = join(tempDir(), 'work');
  mkdirSync(cwd);
  const conversation = randomUUID();
  const transcript = join(home, '.cursor/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), 'agent-transcripts', `${conversation}.txt`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  const env = cleanEnv(home, { CURSOR_VERSION: '2.0.77', CURSOR_PROJECT_DIR: cwd, CLAUDE_PROJECT_DIR: cwd, CURSOR_TRANSCRIPT_PATH: transcript, CURSOR_USER_EMAIL: 'user@example.com' });
  const payload: Line = { conversation_id: conversation, generation_id: randomUUID(), model: 'gpt-5', cursor_version: '2.0.77', workspace_roots: [cwd], user_email: 'user@example.com' };
  return new Session(home, { cwd, transcript, env, payload });
}
function grokSession(home: string): Session {
  const cwd = join(tempDir(), 'work');
  mkdirSync(cwd);
  const id = randomUUID();
  const transcript = join(home, '.grok/sessions', `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  const env = cleanEnv(home, { GROK_HOOK_NAME: 'deepbuild', GROK_SESSION_ID: id, GROK_WORKSPACE_ROOT: cwd });
  return new Session(home, { cwd, transcript, env, envFor: (event) => ({ GROK_HOOK_EVENT: event }) });
}
/** A short session of another tool: start, a prompt, a shell call, a stop. */
async function otherTool(s: Session): Promise<void> {
  await s.start();
  await s.prompt('List the files here.', null);
  await s.call('Bash', { command: 'ls', description: 'List files' }, { response: { stdout: 'README.md\n', stderr: '', interrupted: false, isImage: false } });
  await s.stop('There is one file, README.md.');
}

describe(`${AC21} Cursor and Grok are never Claude Code; a turn left waiting reads attention unknown`, () => {
  it(`${AC21} a Cursor CLI session and a Grok session running Claude Code's hooks are recorded under their own agent or as unknown, never as Claude Code sessions, claims or asks`, async () => {
    const hub = await startHub(makeHome());
    const cursor = cursorSession(hub.home);
    const grok = grokSession(hub.home);
    await otherTool(cursor);
    await otherTool(grok);
    const events = await settle(hub, (all) => [cursor, grok].every((s) => ofSession(all, s.id).length >= 4), { minMs: 3000 });
    const sessions = await sessionsRead(hub);
    const inbox = await inboxRead(hub);
    for (const [name, s] of [['Cursor', cursor], ['Grok', grok]] as const) {
      const mine = ofSession(events, s.id);
      expect(mine.length, `the ${name} session's hooks are recorded: ${events.map(shown).join('; ')}`).toBeGreaterThan(0);
      const claude = mine.filter((e) => CLAUDE.includes(String(e.agent)) || (e.kind === 'session.start' && CLAUDE.includes(String(e.data.agent))));
      expect(claude.map(shown), `no event of the ${name} session is recorded as Claude Code's`).toEqual([]);
      const row = sessions.find((r) => r.id === s.id);
      expect(CLAUDE.includes(String(row?.agent)), `the ${name} session is not a Claude Code session in the registry: ${JSON.stringify(row)}`).toBe(false);
      const claims = mine.filter((e) => e.kind.startsWith('claim.'));
      expect(claims.map(shown), `the ${name} session's stop is no claim`).toEqual([]);
      const asks = kindOf(events, s.id, 'user.ask').filter((e) => Array.isArray(e.data.tasks) && e.data.tasks.length > 0);
      expect(asks.map(shown), `the ${name} session's prompt opens no ask`).toEqual([]);
      expect(inbox.filter((a) => a.session_id === s.id || JSON.stringify(a).includes(s.id)), `no ask in your inbox comes from the ${name} session`).toEqual([]);
    }
  }, 180_000);

  it(`${AC21} a turn left waiting on a model picker, and one left waiting on a trust prompt, read attention unknown, never finished`, async () => {
    const hub = await startHub(makeHome());
    const picker = new Session(hub.home);
    await picker.start();
    await picker.prompt('Switch to a faster model and carry on with the refactor.');
    const trust = new Session(hub.home);
    await trust.start();
    await trust.prompt('Run the setup script in the vendored folder.');
    // The PreToolUse went out; then Claude Code asked whether to trust the folder, and nothing came after.
    trust.entry({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_trust_1', name: 'Bash', input: { command: './vendor/setup.sh' } }], usage: { input_tokens: 3, output_tokens: 9 } } });
    await trust.hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: './vendor/setup.sh', description: 'Run setup' }, tool_use_id: 'toolu_trust_1' });

    // Read as you would see it, every 2 s, until both read unknown or 120 s have passed since the last hook.
    const seen = new Map<string, string[]>([[picker.id, []], [trust.id, []]]);
    const deadline = Date.now() + 120_000;
    for (;;) {
      const [rows, events] = await Promise.all([sessionsRead(hub), settle(hub, () => true)]);
      for (const s of [picker, trust]) seen.get(s.id)!.push(...attentionOf(rows, events, s.id));
      const unknown = [picker, trust].every((s) => seen.get(s.id)!.includes('unknown'));
      if (unknown || Date.now() > deadline) break;
      await sleep(2000);
    }
    for (const [name, s] of [['model picker', picker], ['trust prompt', trust]] as const) {
      const readings = seen.get(s.id)!;
      expect(readings, `the turn left waiting on a ${name} never reads finished`).not.toContain('finished');
      expect(readings, `the turn left waiting on a ${name} reads attention unknown (readings: ${JSON.stringify([...new Set(readings)])})`).toContain('unknown');
    }
  }, 240_000);
});

/** Every attention reading the hub gives a session now: its registry row's attention or status, and its session.attention events' states. */
function attentionOf(rows: Line[], events: Ev[], session: string): string[] {
  const row = rows.find((r) => r.id === session);
  const fromRow = [row?.attention, row?.status].filter((v): v is string => typeof v === 'string');
  const fromEvents = ofSession(events, session).filter((e) => e.kind === 'session.attention').map((e) => String(e.data.state));
  return [...fromRow, ...fromEvents];
}
