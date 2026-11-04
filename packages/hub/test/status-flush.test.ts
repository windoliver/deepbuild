// A status question you type into a real Claude Code session is answered from the record (#1263), though Claude Code
// writes a prompt's transcript entry only once its hooks have returned, and never for a prompt the hook blocked: the
// question is still yours at its prompt hook, and is recorded as yours.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { ulid } from '../src/wire.js';
import { hookLine, send, withHub } from './hub.js';

const procs: ChildProcess[] = [];
afterAll(() => { for (const p of procs) p.kill('SIGTERM'); });
const SESSION = '7c4f5a6b-1111-4222-8333-444455556666';

/** Sends one hook the way deep-hook does and reads the hub's reply to it, the line after the acknowledgement. */
function reply(socket: string, line: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    let got = '';
    sock.on('data', (d) => { got += d; if (got.split('\n').length === 2) sock.write(line); });
    sock.on('end', () => resolve(got.split('\n')[2] ?? ''));
    sock.on('error', reject);
  });
}
function rows<T>(root: string, sql: string, ...params: string[]): T[] {
  const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
  try { return db.prepare(sql).all(...params) as T[]; } finally { db.close(); }
}
async function until<T>(probe: () => T[], ms: number): Promise<T[]> {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) { const got = probe(); if (got.length) return got; }
  return probe();
}

describe('a status question whose transcript entry Claude Code never writes, since its hook blocked it', () => {
  it('is answered in the model\'s place, and recorded as yours', async () => {
    const claude = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    procs.push(claude);
    await withHub(async (root, home) => {
      const work = join(home, 'work');
      const projects = join(home, '.claude', 'projects', work.replace(/[^a-zA-Z0-9]/g, '-'));
      mkdirSync(work, { recursive: true });
      mkdirSync(projects, { recursive: true });
      const transcript = join(projects, `${SESSION}.jsonl`);
      writeFileSync(transcript, '');
      const payload = (event: string, extra: Record<string, unknown>) => ({ session_id: SESSION, transcript_path: transcript, cwd: work, hook_event_name: event, ...extra });
      await send(join(root, 'hub.sock'), hookLine(ulid(Date.now()), 'SessionStart', payload('SessionStart', { source: 'startup' }), { ppid: claude.pid }));
      const answer = await reply(join(root, 'hub.sock'), hookLine(ulid(Date.now()), 'UserPromptSubmit', payload('UserPromptSubmit', { prompt: 'all done?', prompt_id: 'p1' }), { ppid: claude.pid }));
      const shown = String((JSON.parse(answer) as { stdout: string }).stdout);
      expect(shown, "the question you typed is answered in the model's place").toContain('"decision":"block"');
      const [ask] = await until(() => rows<{ f: string }>(root, "SELECT json_extract(data, '$.from') AS f FROM events WHERE kind = 'user.ask' AND session_id = ?", SESSION), 10_000);
      expect(ask?.f, 'the question it blocked is recorded as yours').toBe('person');
    });
  }, 60_000);
});
