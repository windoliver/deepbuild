// A Claude Code session on a version its facts don't list (#1884) gets one health reading in deep doctor's words: it
// names the version and the listed ones, whether the version lies between two listed or above them all.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { hookLine, reply, withHub } from './hub.js';
import { ulid } from '../src/wire.js';

const LISTED = (JSON.parse(readFileSync(fileURLToPath(new URL('../../../adapters/claude-code.facts.json', import.meta.url)), 'utf8')) as { versions: string[] }).versions;

/**
 * The hub's whole stream as the app reads it, from the log's start: `event(f)` resolves with the first event `f`
 * picks, one already streamed or one still to come, and fails when the hub hangs up first; `close` drops what still waits.
 */
async function stream(root: string): Promise<{ event: (f: (e: Record<string, any>) => boolean) => Promise<Record<string, any>>; close: () => void }> {
  const sock = net.connect(join(root, 'hub.sock'));
  const lines: Record<string, any>[] = [];
  type Waiter = { look: () => void; fail: (e: Error) => void };
  const waiting = new Set<Waiter>();
  const next = (f: (l: Record<string, any>) => boolean) => new Promise<Record<string, any>>((resolve, reject) => {
    const w: Waiter = { look: () => { const l = lines.find(f); if (l) { waiting.delete(w); resolve(l); } }, fail: reject };
    waiting.add(w);
    w.look();
  });
  createInterface({ input: sock }).on('line', (raw) => { lines.push(JSON.parse(raw)); for (const w of [...waiting]) w.look(); });
  sock.on('close', () => { for (const w of waiting) w.fail(Error('the hub hung up before the event came')); });
  await next(() => true);
  sock.write(`${JSON.stringify({ v: 1, hello: 'app', token: readFileSync(join(root, 'control.token'), 'utf8').trim() })}\n`);
  await next((l) => 'role' in l);
  sock.write(`${JSON.stringify({ v: 1, id: 'all', method: 'stream.subscribe', params: { after: 0 } })}\n`);
  await next((l) => l.id === 'all' && 'result' in l);
  return { event: async (f) => (await next((l) => l.id === 'all' && l.event && f(l.event))).event, close: () => { waiting.clear(); sock.destroy(); } };
}

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
    const events = await stream(root);
    for (const [session, version] of [['s300', '2.1.300'], ['s400', '2.1.400']] as const) {
      const transcript = join(home, '.claude', 'projects', 'w', `${session}.jsonl`);
      mkdirSync(join(transcript, '..'), { recursive: true });
      appendFileSync(transcript, `${JSON.stringify({ type: 'user', version, sessionId: session, message: { role: 'user', content: 'go' } })}\n`);
      const send = (event: string, extra: Record<string, unknown> = {}) => reply(sock, hookLine(ulid(Date.now()), event, { session_id: session, cwd: home, transcript_path: transcript, hook_event_name: event, ...extra }, { ppid: process.pid }));
      await send('SessionStart', { source: 'startup' });
      await send('UserPromptSubmit', { prompt: 'go', prompt_id: `p-${session}` });
      const read = events.event((e) => e.kind === 'session.reading' && e.session === session && String(e.data?.reading).includes(version));
      let timer: NodeJS.Timeout | undefined;
      // deadline: only bounds the wait for the reading, so one that never comes fails at the expect below, naming what was read
      await Promise.race([read, new Promise((done) => { timer = setTimeout(done, 10_000); })]).finally(() => clearTimeout(timer));
      expect(readings(session).filter((r) => r.includes(version)), `${version}: ${JSON.stringify(readings(session))}`).toEqual([words(version)]);
    }
    events.close();
  });
}, 60_000);
