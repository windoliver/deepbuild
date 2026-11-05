// Who is calling (#993): a hook whose payload's own fields name another tool than deep-hook did is recorded under the
// tool that isn't Claude Code, with one reading per session naming both.
import { appendFileSync, mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hookLine, recorded, reply, withHub } from './hub.js';
import { ulid } from '../src/wire.js';

describe('a caller name the payload contradicts', () => {
  it('is recorded under the tool that isn\'t Claude Code, with one reading per session naming both', async () => {
    await withHub(async (root, home) => {
      const sock = join(root, 'hub.sock');
      const send = (agent: string, session: string, transcript: string, event: string, extra: Record<string, unknown> = {}) => {
        mkdirSync(join(transcript, '..'), { recursive: true });
        appendFileSync(transcript, '');
        return reply(sock, hookLine(ulid(Date.now()), event, { session_id: session, cwd: home, transcript_path: transcript, hook_event_name: event, ...extra }, { agent, ppid: process.pid }));
      };
      // deep-hook said claude-code, as before #993 with CLAUDECODE inherited; the transcript is Grok's own.
      const grok = join(home, '.grok', 'sessions', 'g1.jsonl');
      await send('claude-code', 'g1', grok, 'SessionStart', { source: 'startup' });
      await send('claude-code', 'g1', grok, 'UserPromptSubmit', { prompt: 'go', prompt_id: 'p1' });
      // deep-hook said grok, but the transcript is Claude Code's: kept as grok, never taken for Claude Code.
      const claude = join(home, '.claude', 'projects', 'w', 'c1.jsonl');
      await send('grok', 'c1', claude, 'SessionStart', { source: 'startup' });
      await send('grok', 'c1', claude, 'UserPromptSubmit', { prompt: 'go', prompt_id: 'p1' });
      // Names that agree say nothing.
      const own = join(home, '.claude', 'projects', 'w', 'o1.jsonl');
      await send('claude-code', 'o1', own, 'SessionStart', { source: 'startup' });
      await recorded(root, 'o1', 'session.start', 1);
      await recorded(root, 'g1', 'session.reading', 1);
      await recorded(root, 'c1', 'session.reading', 1);

      const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      try {
        const agents = (session: string) => (db.prepare("SELECT DISTINCT agent AS a FROM events WHERE session_id = ? AND kind IN ('session.start', 'user.ask')").all(session) as { a: string }[]).map((r) => r.a);
        const readings = (session: string) => (db.prepare("SELECT json_extract(data, '$.reading') AS r FROM events WHERE session_id = ? AND kind = 'session.reading'").all(session) as { r: string }[]).map((r) => r.r);
        expect(agents('g1')).toEqual(['grok']);
        expect(agents('c1')).toEqual(['grok']);
        expect(agents('o1')).toEqual(['claude-code']);
        expect(readings('g1')).toEqual([expect.stringMatching(/named this hook's caller claude-code, but its payload's own fields say grok.*recorded under grok/)]);
        expect(readings('c1')).toEqual([expect.stringMatching(/named this hook's caller grok, but its payload's own fields say claude-code.*recorded under grok/)]);
        expect(readings('o1')).toEqual([]);
      } finally {
        db.close();
      }
    });
  }, 60_000);
});
