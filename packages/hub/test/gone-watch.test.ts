// The hub watches a session's agent process for its end (#992) only once two of the session's hooks named it as their
// parent: a wrapper that stays for one hook, a new process each time, is no agent, and its end is no session gone. A hub
// started again keeps watching the agent the last one watched.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { ulid } from '../src/wire.js';
import { hookLine, reply, session, withHub } from './hub.js';

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

it('a session whose hooks each came from a process that then ended is not gone', async () => {
  const id = '7c4d5e60-1111-4222-8333-44445555a992';
  await withHub(async (root, home) => {
    const { payload } = session(home, id);
    const wrappers = [spawn('sleep', ['30']), spawn('sleep', ['30'])];
    try {
      const hook = (event: string, ppid: number, extra: Record<string, unknown> = {}) => reply(join(root, 'hub.sock'), hookLine(ulid(Date.now()), event, payload(event, extra), { ppid }));
      await hook('SessionStart', wrappers[0]!.pid!, { source: 'startup' });
      await hook('UserPromptSubmit', wrappers[1]!.pid!, { prompt: 'go', prompt_id: 'p1' });
      // The first hook's wrapper ends, as every hook's would.
      wrappers[0]!.kill('SIGKILL');
      await sleep(3000);
      const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      try {
        expect(db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'session.gone' AND session_id = ?").get(id)).toMatchObject({ n: 0 });
      } finally { db.close(); }
    } finally {
      for (const w of wrappers) w.kill('SIGKILL');
    }
  });
}, 60_000);

it('a hub started again watches the agent the last hub watched, and records its end', async () => {
  const id = '7c4d5e60-1111-4222-8333-44445555b993';
  await withHub(async (root, home, hub) => {
    const { payload } = session(home, id);
    const agent = spawn('sleep', ['60']);
    try {
      const hook = (event: string, extra: Record<string, unknown> = {}) => reply(join(root, 'hub.sock'), hookLine(ulid(Date.now()), event, payload(event, extra), { ppid: agent.pid! }));
      await hook('SessionStart', { source: 'startup' });
      await hook('UserPromptSubmit', { prompt: 'go', prompt_id: 'p1' });
      await hub.restart();
      // Its terminal closes before any hook reaches the new hub.
      agent.kill('SIGKILL');
      const gone = () => {
        const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
        try { return (db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'session.gone' AND session_id = ?").get(id) as { n: number }).n; } finally { db.close(); }
      };
      for (let i = 0; i < 20 && gone() === 0; i++) await sleep(250);
      expect(gone(), 'the new hub records the agent gone within 5 s').toBe(1);
    } finally {
      agent.kill('SIGKILL');
    }
  });
}, 60_000);
