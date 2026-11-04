// A hook that arrives while the last check found its agent's hook program can't run (#993): it is answered watch-only,
// but its session is no session past its facts' versions, and it has the programs checked again at once.
import { appendFileSync, chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hookLine, reply, withHub } from './hub.js';
import { ulid } from '../src/wire.js';

describe('a hook while its hook program can\'t run', () => {
  it('reads no version past the facts, and has the programs checked again at once', async () => {
    await withHub(async (root, home, hub) => {
      const program = join(home, 'build', 'deep-hook');
      const command = `'${program}' claude-code Stop`;
      writeFileSync(join(root, 'claude-hooks.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command }] }] } }));
      await hub.restart();
      const sock = join(root, 'hub.sock');
      const transcript = join(home, '.claude', 'projects', 'w', 's1.jsonl');
      mkdirSync(join(transcript, '..'), { recursive: true });
      appendFileSync(transcript, '');
      const send = (event: string, extra: Record<string, unknown> = {}) => reply(sock, hookLine(ulid(Date.now()), event, { session_id: 's1', cwd: home, transcript_path: transcript, hook_event_name: event, ...extra }, { ppid: process.pid }));
      const readings = () => {
        const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
        try {
          return (db.prepare("SELECT json_extract(data, '$.reading') AS r FROM events WHERE session_id = 's1' AND kind = 'session.reading' ORDER BY log_pos").all() as { r: string }[]).map((x) => x.r);
        } finally {
          db.close();
        }
      };
      const until = async (probe: () => boolean) => { for (const end = Date.now() + 10_000; Date.now() < end && !probe(); await new Promise((r) => setTimeout(r, 100))); return probe(); };

      await send('SessionStart', { source: 'startup' });
      await send('UserPromptSubmit', { prompt: 'go', prompt_id: 'p1' });
      // Checked again within seconds, with no 10 minutes passed: the session opened after the last check reads BLOCKED.
      expect(await until(() => readings().some((r) => r.startsWith("BLOCKED: hooks can't run"))), `readings: ${JSON.stringify(readings())}`).toBe(true);
      expect(readings().filter((r) => /past the versions its facts cover/.test(r))).toEqual([]);

      mkdirSync(join(program, '..'), { recursive: true });
      writeFileSync(program, '#!/bin/sh\n');
      chmodSync(program, 0o755);
      await send('UserPromptSubmit', { prompt: 'again', prompt_id: 'p2' });
      expect(await until(() => readings().at(-1)?.startsWith('Hooks can run again') ?? false), `readings: ${JSON.stringify(readings())}`).toBe(true);
    });
  }, 60_000);
});
