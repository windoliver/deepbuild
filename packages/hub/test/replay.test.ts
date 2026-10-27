// A running hub replays what deep-hook spooled while it was late (#315): the next hook that reaches it starts the
// replay, so a late event is in the record without waiting for the hub's next start.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ulid } from '../src/wire.js';
import { hookLine, send, withHub } from './hub.js';

const SESSION = '6f1c2b9e-1111-4222-8333-444455556666';

/** A hook request as deep-hook writes it, for a Bash call. */
function request(id: string, command: string, extra: Record<string, unknown> = {}): string {
  const payload = { session_id: SESSION, cwd: '/tmp', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, tool_use_id: `toolu_${id}` };
  return hookLine(id, 'PreToolUse', payload, extra);
}

describe('a running hub', () => {
  it('says so when deep-hook spooled as late a call the hub had answered and recorded', async () => {
    await withHub(async (root) => {
      const id = '01K74FKZVKZGATTBZAEGPRET70';
      const live = request(id, 'pkill -f node');
      // The hub answers and records the call, but deep-hook gave up on the acknowledgement and spooled it late.
      expect(await send(join(root, 'hub.sock'), live)).toContain('"ack"');
      // The hub acknowledges before it records: the spooled copy comes once the live one is in the record.
      const recorded = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      try {
        for (const until = Date.now() + 3000; Date.now() < until && !recorded.prepare('SELECT 1 FROM events WHERE id = ?').get(id); await new Promise((r) => setTimeout(r, 10)));
      } finally {
        recorded.close();
      }
      mkdirSync(join(root, 'spool'), { recursive: true, mode: 0o700 });
      writeFileSync(join(root, 'spool', 'spool.jsonl'), `${live.slice(0, -2)},"late":true}\n`.replace('"matched":[]', '"matched":["no-kill-by-name"]'), { mode: 0o600 });
      expect(await send(join(root, 'hub.sock'), request('01K74FKZVKZGATTBZAEGPRET71', 'ls'))).toContain('"ack"');
      const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      let readings: string[] = [];
      let copies = 0;
      try {
        for (const until = Date.now() + 5000; Date.now() < until; await new Promise((r) => setTimeout(r, 50))) {
          readings = (db.prepare("SELECT json_extract(data, '$.reading') AS r FROM events WHERE kind = 'session.reading'").all() as { r: string }[]).map((x) => x.r);
          copies = (db.prepare('SELECT count(*) AS n FROM events WHERE id = ?').get(id) as { n: number }).n;
          if (readings.length && !readdirSync(join(root, 'spool')).length) break;
        }
      } finally {
        db.close();
      }
      expect(copies, 'the call is in the record once').toBe(1);
      expect(readings.filter((r) => r.includes(id) && r.includes('no-kill-by-name')), 'a session reading names the late call and its guard entry').toHaveLength(1);
    });
  }, 30_000);

  it('says so when the spooled copy comes while the live one is still being recorded', async () => {
    await withHub(async (root) => {
      const id = '01K74FKZVKZGATTBZAEGPRET80';
      const live = request(id, 'pkill -f node');
      // The hub answers the call; its event takes 300 ms to append, and deep-hook spools it late meanwhile.
      expect(await send(join(root, 'hub.sock'), live)).toContain('"ack"');
      await new Promise((r) => setTimeout(r, 100));
      mkdirSync(join(root, 'spool'), { recursive: true, mode: 0o700 });
      writeFileSync(join(root, 'spool', 'spool.jsonl'), `${live.slice(0, -2)},"late":true}\n`.replace('"matched":[]', '"matched":["no-kill-by-name"]'), { mode: 0o600 });
      expect(await send(join(root, 'hub.sock'), request('01K74FKZVKZGATTBZAEGPRET81', 'ls'))).toContain('"ack"');
      const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      let readings: string[] = [];
      try {
        for (const until = Date.now() + 5000; Date.now() < until; await new Promise((r) => setTimeout(r, 50))) {
          readings = (db.prepare("SELECT json_extract(data, '$.reading') AS r FROM events WHERE kind = 'session.reading'").all() as { r: string }[]).map((x) => x.r);
          if (readings.length && !readdirSync(join(root, 'spool')).length) break;
        }
      } finally {
        db.close();
      }
      expect(readings.filter((r) => r.includes(id)), 'a session reading names the late call').toHaveLength(1);
    }, { DEEP_HUB_TEST_CRASH: 'slow:tool.before' });
  }, 30_000);

  it('replays the spool once a hook reaches it, with no restart', async () => {
    await withHub(async (root) => {
      // A call deep-hook let through while the hub was late, spooled after the hub started.
      mkdirSync(join(root, 'spool'), { recursive: true, mode: 0o700 });
      writeFileSync(join(root, 'spool', 'spool.jsonl'), request('01K74FKZVKZGATTBZAEGPRET62', 'ls late', { late: true, matched: ['listing-noted'] }), { mode: 0o600 });
      expect(await send(join(root, 'hub.sock'), request('01K74FKZVKZGATTBZAEGPRET63', 'ls now'))).toContain('"ack"');
      const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      let row: Record<string, unknown> | undefined;
      let left: string[] = [];
      let order: string[] = [];
      try {
        // The file goes only after its events are committed FULL: done once both hold.
        for (const until = Date.now() + 5000; Date.now() < until; await new Promise((r) => setTimeout(r, 50))) {
          row = db.prepare("SELECT v, json_extract(data, '$.late') AS late, json_extract(data, '$.matched') AS matched FROM events WHERE id = ?").get('01K74FKZVKZGATTBZAEGPRET62');
          left = readdirSync(join(root, 'spool'));
          order = (db.prepare("SELECT id FROM events WHERE kind = 'tool.before' ORDER BY log_pos").all() as { id: string }[]).map((r) => r.id);
          if (row && !left.length && order.length === 2) break;
        }
      } finally {
        db.close();
      }
      expect(row, 'the spooled late call is in the record while the hub runs').toEqual({ v: 3, late: 1, matched: '["listing-noted"]' });
      expect(order, 'the spooled call ran first, so it is recorded before the hook that started the replay').toEqual(['01K74FKZVKZGATTBZAEGPRET62', '01K74FKZVKZGATTBZAEGPRET63']);
      expect(left, 'the replayed spool is removed').toEqual([]);
    });
  }, 30_000);

  it('replays a kept file before the spool after it, whatever the clock says', async () => {
    await withHub(async (root) => {
      // A replay kept a file named in 2100, then the clock stepped back; a call spooled since comes after it.
      mkdirSync(join(root, 'spool'), { recursive: true, mode: 0o700 });
      writeFileSync(join(root, 'spool', `replay-${ulid(Date.UTC(2100, 0, 1))}.jsonl`), request('01K74FKZVKZGATTBZAEGPRET90', 'ls kept'), { mode: 0o600 });
      writeFileSync(join(root, 'spool', 'spool.jsonl'), request('01K74FKZVKZGATTBZAEGPRET91', 'ls spooled'), { mode: 0o600 });
      expect(await send(join(root, 'hub.sock'), request('01K74FKZVKZGATTBZAEGPRET92', 'ls now'))).toContain('"ack"');
      const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      let order: string[] = [];
      try {
        for (const until = Date.now() + 5000; Date.now() < until && order.length < 3; await new Promise((r) => setTimeout(r, 50))) {
          order = (db.prepare("SELECT id FROM events WHERE kind = 'tool.before' ORDER BY log_pos").all() as { id: string }[]).map((r) => r.id);
        }
      } finally {
        db.close();
      }
      expect(order, 'the kept call, then the one spooled after it, then the live one').toEqual(['01K74FKZVKZGATTBZAEGPRET90', '01K74FKZVKZGATTBZAEGPRET91', '01K74FKZVKZGATTBZAEGPRET92']);
    });
  }, 30_000);
});
