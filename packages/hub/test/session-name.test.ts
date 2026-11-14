// A session's one name and its why, through the hub (#2018): an untitled session's row is named by its first prompt,
// the agent's own title replaces that, Rename from the app replaces both and moves neither its time in its state nor
// when it was last seen, and row.why gives the one reading with facts the record holds at their log_pos.
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { ulid } from '../src/wire.js';
import { hookLine, reply, session, withHub } from './hub.js';

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
type Answer = Record<string, any>;

/** A line client of the hub's socket that says hello as `role`. */
async function connect(socket: string, token: string, role: 'app' | 'cli'): Promise<(method: string, params: object) => Promise<Answer>> {
  const s = net.connect(socket);
  let buf = '';
  const lines: Answer[] = [];
  s.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const until = async <T>(f: () => T | undefined): Promise<T> => { for (let i = 0; i < 600; i++) { const v = f(); if (v) return v; await sleep(50); } throw Error('no answer from the hub'); };
  await until(() => lines[0]);
  s.write(`${JSON.stringify({ v: 1, hello: role, token })}\n`);
  await until(() => lines.find((l) => l.role));
  let n = 0;
  return async (method, params) => {
    const id = `t${++n}`;
    s.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const answered = await until(() => lines.find((l) => l.id === id));
    if (answered.error) throw Error(JSON.stringify(answered.error));
    return answered.result as Answer;
  };
}

it('names a session by its first prompt, then its agent\'s title, then your Rename, and says why it reads as it does', async () => {
  const id = '7c4d5e60-2018-4222-8333-444455552018';
  await withHub(async (root, home) => {
    const { work, transcript } = session(home, id);
    const hook = (event: string, payload: object) => reply(join(root, 'hub.sock'), hookLine(ulid(Date.now()), event, { session_id: id, transcript_path: transcript, cwd: work, hook_event_name: event, ...payload }, { ppid: process.pid }));
    await hook('SessionStart', { source: 'startup' });
    await hook('UserPromptSubmit', { prompt: 'fix the flaky checkout test\nit fails one run in five' });
    const token = readFileSync(join(root, 'control.token'), 'utf8').trim();
    const cli = await connect(join(root, 'hub.sock'), token, 'cli');
    const app = await connect(join(root, 'hub.sock'), token, 'app');
    const row = async (): Promise<Answer> => ((await cli('rows.read', {})).rows as Answer[]).find((r) => r.id === `session:${id}`)!;
    const titled = async (title: string): Promise<Answer> => { for (let i = 0; i < 100; i++) { const r = await row(); if (r?.title === title) return r; await sleep(100); } return row(); };
    const first = await titled('fix the flaky checkout test');
    expect(first.title, 'its first prompt\'s first line').toBe('fix the flaky checkout test');
    // The agent's own title for the session, from its hook, names it next.
    await hook('PreToolUse', { tool_name: 'Read', tool_input: { file_path: join(work, 'a.ts') }, tool_use_id: 'toolu_2018a', session_title: 'Checkout flake' });
    expect((await titled('Checkout flake')).title).toBe('Checkout flake');
    // Rename is the app's alone, and your name is first.
    await expect(cli('session.rename', { session: id, name: 'Flaky checkout' }), 'Rename is the app\'s').rejects.toThrow();
    await expect(app('session.rename', { session: id, name: '  ' }), 'a name holds something').rejects.toThrow();
    const before = await row();
    await app('session.rename', { session: id, name: 'Flaky checkout' });
    const renamed = await titled('Flaky checkout');
    expect([renamed.title, renamed.word, renamed.since, renamed.unread]).toEqual(['Flaky checkout', before.word, before.since, before.unread]);
    const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
    try {
      const named = db.prepare("SELECT subject, writer, json_extract(data, '$.by') AS by, json_extract(data, '$.name') AS name FROM events WHERE kind = 'session.named' ORDER BY log_pos").all();
      const subject = `session:${id.replace(/[^0-9A-Za-z]/g, '')}`;
      expect(named).toEqual([{ subject, writer: 'core', by: 'agent', name: 'Checkout flake' }, { subject, writer: 'core', by: 'you', name: 'Flaky checkout' }]);
      // Naming it was no sign of the session: it was last seen at its tool call.
      const seen = db.prepare('SELECT s.last_seen, e.kind FROM sessions s JOIN events e ON e.log_pos = s.seen_at WHERE s.id = ?').get(id) as { last_seen: number; kind: string };
      expect(seen.kind).toBe('tool.before');
      // Why it reads as it does: the row's word, from the same reading, with each fact in the record at its log_pos.
      const why = await cli('row.why', { session: id.slice(0, 8) });
      expect([why.id, why.word, why.why, why.rule]).toEqual([`session:${id}`, renamed.word, renamed.why, 'working']);
      expect(typeof why.log_pos).toBe('number');
      expect((why.facts as Answer[]).length).toBeGreaterThan(0);
      for (const f of why.facts as Answer[]) expect(db.prepare('SELECT kind, ts FROM events WHERE log_pos = ?').get(f.log_pos), `the fact ${f.kind}`).toEqual({ kind: f.kind, ts: f.ts });
      expect((why.lacked as Answer[])[0]).toEqual({ row: 'needs you', fact: 'no open ask; no permission prompt showing; no words of yours whose delivery stalled or timed out' });
      await expect(cli('row.why', { session: 'no-such-session' })).rejects.toThrow(/not_found/);
    } finally {
      db.close();
    }
  });
}, 120_000);
