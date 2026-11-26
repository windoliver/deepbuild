// #3178: a recommended choice that a saved decision already answers comes back with that answer, not provisional.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { ulid } from '../src/wire.js';
import { deep, hookLine, mcp, reply, session, withHub } from './hub.js';

it('answers a repeated recommended choice from your saved decision, and the first one goes on provisional', async () => {
  const id = '7c4d5e60-3178-4222-8333-444455559999';
  await withHub(async (root, home, hub) => {
    writeFileSync(join(root, 'config.json'), JSON.stringify({ asks: { deadline: { choice: '3d' }, default: { choice: 'recommended' } } }));
    writeFileSync(join(home, 'confirm'), 'confirmed\n');
    const env = { DEEP_HUB_TEST_CONFIRM: join(home, 'confirm') };
    await hub.restart(env);
    const { work, transcript } = session(home, id);
    await reply(join(root, 'hub.sock'), hookLine(ulid(Date.now()), 'SessionStart', { session_id: id, transcript_path: transcript, cwd: work, hook_event_name: 'SessionStart', source: 'startup' }, { ppid: process.pid }));
    const ask = { kind: 'choice', question: 'Which header colour for checkout?', options: [{ id: 'blue', label: 'Blue' }, { id: 'green', label: 'Green' }], recommended: 'blue', subject: { point: 'req:header3178' } };
    const asking = async () => {
      const tools = mcp(home, work, false);
      await tools.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
      const got = await tools.call('deep_ask', ask);
      tools.close();
      return got;
    };

    const first = await asking();
    expect([first.isError, first.value.status, first.value.answer], JSON.stringify(first.value)).toEqual([false, 'provisional', 'blue']);
    // As answer-after-restart.test.ts does: the restarted hub has no live connection from the session's tree, so your
    // `deep inbox answer` is yours.
    await hub.restart(env);
    const answered = await deep(home, work, ['inbox', 'answer', String(first.value.ask), 'green']);
    expect(answered.code, answered.stderr).toBe(0);

    await reply(join(root, 'hub.sock'), hookLine(ulid(Date.now()), 'SessionStart', { session_id: id, transcript_path: transcript, cwd: work, hook_event_name: 'SessionStart', source: 'resume' }, { ppid: process.pid }));
    const again = await asking();
    const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
    const applied = db.prepare(`SELECT count(*) AS n FROM events WHERE kind = 'decision.applied' AND subject = ?`).get(String(again.value.ask)) as { n: number };
    db.close();
    expect(applied.n, `your saved decision answered the repeat: ${JSON.stringify(again.value)}`).toBe(1);
    expect([again.isError, again.value.status, again.value.answer], `the repeat is told your answer, not the recommendation: ${JSON.stringify(again.value)}`).toEqual([false, 'decided', 'green']);
  });
}, 120_000);
