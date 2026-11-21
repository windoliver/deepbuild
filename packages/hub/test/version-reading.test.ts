// A Claude Code session on a version its facts don't list (#1884) gets one health reading in deep doctor's words: it
// names the version and the listed ones, whether the version lies between two listed or above them all.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { hookLine, reply, withHub } from './hub.js';
import { ulid } from '../src/wire.js';

const LISTED = (JSON.parse(readFileSync(fileURLToPath(new URL('../../../adapters/claude-code.facts.json', import.meta.url)), 'utf8')) as { versions: string[] }).versions;
const words = (v: string) => `This session runs claude-code ${v}, not a version its facts cover (${LISTED.join(', ')}): it is recorded unverified, and its holds and every block but the floor are watch-only until the live smoke test adds ${v} to its facts. The floor still holds: its fail_closed guard entries deny as they do with the hub stopped.`;

it('reads a version between two listed, and one above them all, as not a version its facts cover', async () => {
  expect(LISTED.filter((v) => v === '2.1.300' || v === '2.1.400'), 'the shipped facts list neither version tried').toEqual([]);
  await withHub(async (root, home) => {
    const sock = join(root, 'hub.sock');
    const readings = (session: string) => {
      const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      try {
        return (db.prepare("SELECT json_extract(data, '$.reading') AS r FROM events WHERE session_id = ? AND kind = 'session.reading' ORDER BY log_pos").all(session) as { r: string }[]).map((x) => x.r);
      } finally {
        db.close();
      }
    };
    for (const [session, version] of [['s300', '2.1.300'], ['s400', '2.1.400']] as const) {
      const transcript = join(home, '.claude', 'projects', 'w', `${session}.jsonl`);
      mkdirSync(join(transcript, '..'), { recursive: true });
      appendFileSync(transcript, `${JSON.stringify({ type: 'user', version, sessionId: session, message: { role: 'user', content: 'go' } })}\n`);
      const send = (event: string, extra: Record<string, unknown> = {}) => reply(sock, hookLine(ulid(Date.now()), event, { session_id: session, cwd: home, transcript_path: transcript, hook_event_name: event, ...extra }, { ppid: process.pid }));
      await send('SessionStart', { source: 'startup' });
      await send('UserPromptSubmit', { prompt: 'go', prompt_id: `p-${session}` });
      for (const end = Date.now() + 10_000; Date.now() < end && !readings(session).some((r) => r.includes(version)); await new Promise((r) => setTimeout(r, 100)));
      expect(readings(session).filter((r) => r.includes(version)), `${version}: ${JSON.stringify(readings(session))}`).toEqual([words(version)]);
    }
  });
}, 60_000);
