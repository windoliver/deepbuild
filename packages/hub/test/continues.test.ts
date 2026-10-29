// A continue the asks core records while the hub opens (#85): a task's check that passed while the hub was down
// closes the task as the core replays, and the hub carries each continue that records then, never skipping it as
// one it already carried. Without a route open, the carry is the reading that says the continue goes with the
// session's next prompt.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { openRecord } from '@deepbuild/record';
import { ulid } from '../src/wire.js';
import { hookLine, send, withHub } from './hub.js';

const SESSION = '3b9f1c2e-1111-4222-8333-444455556666';

/** Rows of the record, read while or after the hub runs. */
function rows<T>(root: string, sql: string, ...params: string[]): T[] {
  const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
  try { return db.prepare(sql).all(...params) as T[]; } finally { db.close(); }
}
async function until<T>(probe: () => T[], ms: number): Promise<T[]> {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) { const got = probe(); if (got.length) return got; }
  return probe();
}

describe('a continue recorded as the hub opens', () => {
  it('is carried into the session, not skipped as already carried', async () => {
    await withHub(async (root, home, { restart }) => {
      // Your settings, as setup drafts them: an unblock task's deadline and default come from here.
      writeFileSync(join(root, 'config.json'), JSON.stringify({ asks: {
        deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
        default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
        fallback: ['change-owner'], fold: 5,
      } }));
      const project = join(home, '.claude', 'projects', 'tmp');
      mkdirSync(project, { recursive: true });
      const transcript = join(project, `${SESSION}.jsonl`);
      writeFileSync(transcript, '');
      appendFileSync(transcript, `${JSON.stringify({ type: 'user', uuid: 'turn-1', promptId: 'p1', message: { role: 'user', content: 'go' }, origin: { kind: 'human' } })}\n`);
      let n = 0;
      const hook = (event: string, extra: Record<string, unknown>) => send(join(root, 'hub.sock'), hookLine(ulid(Date.now() + ++n), event, { session_id: SESSION, cwd: '/tmp', transcript_path: transcript, hook_event_name: event, ...extra }, { ppid: process.pid }));
      expect(await hook('SessionStart', { source: 'startup' })).toContain('"ack"');
      expect(await hook('UserPromptSubmit', { prompt: 'go', prompt_id: 'p1' })).toContain('"ack"');
      // The session stops on a revoked sign-in: the hook records the cause and the core raises the block's task.
      expect(await hook('StopFailure', { error: 'authentication_failed', prompt_id: 'p1' })).toContain('"ack"');
      const [task] = await until(() => rows<{ id: string; proves: string }>(root, "SELECT id, json_extract(data, '$.proves') AS proves FROM events WHERE kind = 'ask.created' AND json_extract(data, '$.kind') = 'unblock' AND session_id = ?", SESSION), 10_000);
      expect(task, 'the stop raised one unblock task').toBeDefined();
      // While the hub is down, the task's check passes: the runner's verdict lands in the record.
      await restart({}, async () => {
        const record = await openRecord({ path: join(root, 'ledger.db'), now: Date.now });
        try {
          const now = Date.now();
          const commit = '0'.repeat(40);
          const claim = `claim:${ulid(now)}`;
          const id = ulid(now + 1);
          await record.append({ writer: 'core', actor: 'you', scope: 'you', session: SESSION }, { v: 1, id, kind: 'verdict.made', subject: claim, ts: now, data: {
            outcome: 'PASS', verdict: `verdict:${id}`, claim, reasons: [], smallest: null, points_to: null, commit,
            requirements: [{ req: 'req:01K74G0A1B2C3D4E5F6G7H8J9K#R1', outcome: 'PASS', check: task!.proves, depth: 'unit', oracle: 'code', runs: { clean: 1, needed: 1, counted: [] }, smallest: null, points_to: null, evidence: [], proof: 'test_run' }],
            key: { commit, doc_revisions: [], check_digests: [], state_digests: [], environment: 'test', tools: [] },
          } });
        } finally {
          await record.close();
        }
      });
      // The hub, back up, settles the task closed and continues the session; with no route open, the record says the
      // continue goes with its next prompt.
      const continued = await until(() => rows<{ because: string }>(root, "SELECT json_extract(data, '$.because') AS because FROM events WHERE kind = 'session.continued' AND session_id = ?", SESSION), 10_000);
      expect(continued.map((c) => c.because), 'the task closed on its check, so the session continues once').toEqual(['task_closed']);
      const carried = await until(() => rows<{ r: string }>(root, "SELECT json_extract(data, '$.reading') AS r FROM events WHERE kind = 'session.reading' AND session_id = ? AND json_extract(data, '$.reading') LIKE 'DeepBuild continues this session%'", SESSION), 5_000);
      expect(carried.map((c) => c.r), 'the hub carried the continue it found on opening').toEqual([`DeepBuild continues this session (task_closed, task ask:${task!.id}), but no route into it is open now: the continue goes with its next prompt.`]);
      expect(rows(root, "SELECT 1 FROM events WHERE kind = 'ask.moot' AND subject = ?", `ask:${task!.id}`), 'the task is moot').toHaveLength(1);
      await new Promise((r) => setTimeout(r, 1500));
      expect(rows(root, "SELECT 1 FROM events WHERE kind = 'session.continued' AND session_id = ?", SESSION), 'continued once, carried once').toHaveLength(1);
      expect(rows(root, "SELECT 1 FROM events WHERE kind = 'session.reading' AND session_id = ? AND json_extract(data, '$.reading') LIKE 'DeepBuild continues this session%'", SESSION)).toHaveLength(1);
    });
  }, 60_000);
});
