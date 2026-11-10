// The app's action table on the hub (#1462): Later on an ask puts it off until an hour before its default applies, and
// Pause on a session's row is recorded as session.paused with the session as subject, in letters and digits as every
// session event names it. Both are the app's alone.
import net from 'node:net';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { ulid } from '../src/wire.js';
import { hookLine, mcp, reply, session, withHub } from './hub.js';

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** A line client of the hub's socket that says hello as `role`. */
async function connect(socket: string, token: string, role: 'app' | 'cli'): Promise<(method: string, params: object) => Promise<Record<string, any>>> {
  const s = net.connect(socket);
  let buf = '';
  const lines: Record<string, any>[] = [];
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
    return answered.result as Record<string, any>;
  };
}

it('records Later an hour before the ask\'s default and Pause on the session, from the app only', async () => {
  const id = '7c4d5e60-1462-4222-8333-444455551462';
  await withHub(async (root, home, hub) => {
    writeFileSync(join(root, 'config.json'), JSON.stringify({ asks: { deadline: { taste: '3d' }, default: { taste: 'recommended' } } }));
    await hub.restart();
    const { work, transcript } = session(home, id);
    await reply(join(root, 'hub.sock'), hookLine(ulid(Date.now()), 'SessionStart', { session_id: id, transcript_path: transcript, cwd: work, hook_event_name: 'SessionStart', source: 'startup' }, { ppid: process.pid }));
    const tools = mcp(home, work, false);
    await tools.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    void tools.call('deep_ask', { kind: 'taste', question: 'Which road?', options: [{ id: 'first', label: 'North' }, { id: 'second', label: 'South' }], recommended: 'second' }).catch(() => undefined);
    const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
    try {
      const created = () => db.prepare("SELECT subject, data FROM events WHERE kind = 'ask.created'").get() as { data: string } | undefined;
      let event: { data: string } | undefined;
      for (let tries = 0; tries < 150 && !(event = created()); tries++) await sleep(200);
      expect(event, 'the ask').toBeTruthy();
      const askId = (db.prepare("SELECT id FROM events WHERE kind = 'ask.created'").get() as { id: string }).id;
      const deadline = (JSON.parse(event!.data) as { deadline: number }).deadline;
      tools.close();
      const token = readFileSync(join(root, 'control.token'), 'utf8').trim();
      const cli = await connect(join(root, 'hub.sock'), token, 'cli');
      await expect(cli('ask.later', { ask: `ask:${askId}` }), 'Later is the app\'s').rejects.toThrow();
      const app = await connect(join(root, 'hub.sock'), token, 'app');
      await app('ask.later', { ask: `ask:${askId}` });
      await app('session.pause', { session: id });
      const later = db.prepare("SELECT subject, data FROM events WHERE kind = 'ask.later'").all() as { subject: string; data: string }[];
      expect(later.map((e) => ({ subject: e.subject, until: (JSON.parse(e.data) as { until: number }).until }))).toEqual([{ subject: `ask:${askId}`, until: deadline - 3_600_000 }]);
      const paused = db.prepare("SELECT subject FROM events WHERE kind = 'session.paused'").all() as { subject: string }[];
      expect(paused).toEqual([{ subject: `session:${id.replace(/[^0-9A-Za-z]/g, '')}` }]);
    } finally {
      db.close();
    }
  });
}, 120_000);
