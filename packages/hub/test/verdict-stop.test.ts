// The verdict in the chat at a judged stop (#83), where PR 792 left two gaps: a Codex session's `gh pr create` is
// recorded from the call's own PostToolUse (its rollout is never read), so its receipt names the PR; and a turn
// interrupted by a hub restart is still judged at its stop, so the stop carries the line.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { ulid } from '../src/wire.js';
import { hookLine, recorded, reply, send, withHub } from './hub.js';

const procs: ChildProcess[] = [];
afterAll(() => { for (const p of procs) p.kill('SIGTERM'); });

describe('a Codex session that opens a pull request', () => {
  it('records the PR from the gh pr create call\'s PostToolUse, so its receipt can name it', async () => {
    const codex = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    procs.push(codex);
    const session = '7c4f5a6b-1111-4222-8333-444455556666';
    const url = 'https://github.com/acme/widgets/pull/7';
    await withHub(async (root, home) => {
      const work = join(home, 'work');
      mkdirSync(work, { recursive: true });
      mkdirSync(join(home, '.codex', 'sessions'), { recursive: true });
      const transcript = join(home, '.codex', 'sessions', `rollout-${session}.jsonl`);
      writeFileSync(transcript, '');
      const turn = 'turn-1';
      const payload = (event: string, extra: Record<string, unknown>) => ({ session_id: session, transcript_path: transcript, cwd: work, hook_event_name: event, model: 'gpt-reserve', permission_mode: 'bypassPermissions', ...extra });
      const hook = (event: string, extra: Record<string, unknown> = {}) => send(join(root, 'hub.sock'), hookLine(ulid(Date.now()), event, payload(event, extra), { agent: 'codex', ppid: codex.pid }));
      const call = { tool_name: 'Bash', tool_input: { command: 'gh pr create --title "Fix the cart total" --body "Closes #41"' }, tool_use_id: 'call_1', turn_id: turn };
      await hook('SessionStart', { source: 'startup' });
      await hook('UserPromptSubmit', { prompt: 'Fix the cart total and open the PR.', turn_id: turn });
      await hook('PreToolUse', call);
      await hook('PostToolUse', { ...call, tool_response: { stdout: `${url}\n`, stderr: '', exit_code: 0 } });
      expect(await recorded(root, session, 'tool.after', 1)).toBe(1);
      expect(await recorded(root, session, 'session.reading', 1), 'the call\'s response names the PR, recorded as the session\'s reading').toBe(1);
      const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      const readings = (db.prepare("SELECT json_extract(data, '$.reading') AS reading FROM events WHERE kind = 'session.reading' AND session_id = ?").all(session) as { reading: string }[]).map((r) => r.reading);
      db.close();
      expect(readings).toContain(`Opened pull request ${url}`);
    });
  }, 60_000);
});

describe('a turn interrupted by a hub restart', () => {
  it('is judged at its stop: the Stop reply carries the line, as the turn\'s edit stands in the record', async () => {
    const claude = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    procs.push(claude);
    const session = '8d5a6b7c-1111-4222-8333-444455556666';
    await withHub(async (root, home, { restart }) => {
      const work = join(home, 'work');
      const projects = join(home, '.claude', 'projects', work.replace(/[^a-zA-Z0-9]/g, '-'));
      mkdirSync(work, { recursive: true });
      mkdirSync(projects, { recursive: true });
      const transcript = join(projects, `${session}.jsonl`);
      writeFileSync(transcript, '');
      const payload = (event: string, extra: Record<string, unknown>) => ({ session_id: session, transcript_path: transcript, cwd: work, hook_event_name: event, ...extra });
      const hook = (event: string, extra: Record<string, unknown> = {}) => send(join(root, 'hub.sock'), hookLine(ulid(Date.now()), event, payload(event, extra), { ppid: claude.pid }));
      await hook('SessionStart', { source: 'startup' });
      expect(await recorded(root, session, 'session.start', 1)).toBe(1);
      writeFileSync(transcript, `${JSON.stringify({ type: 'user', promptId: 'p1', sessionId: session, message: { role: 'user', content: 'Fix the header test.' }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' })}\n`, { flag: 'a' });
      await hook('UserPromptSubmit', { prompt: 'Fix the header test.', prompt_id: 'p1' });
      const edit = { tool_name: 'Edit', tool_input: { file_path: join(work, 'header.test.ts'), old_string: 'a', new_string: 'b' }, tool_use_id: 'toolu_1' };
      await hook('PreToolUse', edit);
      await hook('PostToolUse', { ...edit, tool_response: { filePath: join(work, 'header.test.ts') } });
      expect(await recorded(root, session, 'tool.after', 1)).toBe(1);
      await restart();
      const stopped = await reply(join(root, 'hub.sock'), hookLine(ulid(Date.now()), 'Stop', payload('Stop', { stop_hook_active: false, last_assistant_message: 'Done.' }), { ppid: claude.pid }));
      expect(stopped.stdout, 'the stop after the restart is judged, and its reply carries the line').toMatch(/"systemMessage":"says done · next: DeepBuild · receipt"/);
      expect(await recorded(root, session, 'claim.made', 1), 'the turn\'s claim is made at that stop').toBe(1);
    });
  }, 60_000);
});
