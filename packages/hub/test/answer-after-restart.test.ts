// A Claude Code session idle across a hub restart sends no hook, so the hub doesn't know it: its waiter asks again,
// and your answer still wakes it through that waiter.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { ulid } from '../src/wire.js';
import { client, hookLine, mcp, recorded, reply, session, waiter, withHub } from './hub.js';

const CLI = fileURLToPath(new URL('../../cli/dist/main.js', import.meta.url));
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

it('wakes an idle session the restarted hub has not heard from', async () => {
  const id = '7c4d5e60-1111-4222-8333-444455558888';
  await withHub(async (root, home, hub) => {
    writeFileSync(join(root, 'config.json'), JSON.stringify({ asks: { deadline: { taste: '3d' }, default: { taste: 'recommended' } } }));
    writeFileSync(join(home, 'confirm'), 'confirmed\n');
    const env = { DEEP_HUB_TEST_CONFIRM: join(home, 'confirm') };
    await hub.restart(env);
    const { work, transcript } = session(home, id);
    await reply(join(root, 'hub.sock'), hookLine(ulid(Date.now()), 'SessionStart', { session_id: id, transcript_path: transcript, cwd: work, hook_event_name: 'SessionStart', source: 'startup' }, { ppid: process.pid }));
    const tools = mcp(home, work, false);
    await tools.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    void tools.call('deep_ask', { kind: 'taste', question: 'Which road?', options: [{ id: 'first', label: 'North' }, { id: 'second', label: 'South' }], recommended: 'second' }).catch(() => undefined);
    let ask: string | undefined;
    for (let tries = 0; tries < 150 && !ask; tries++) {
      await sleep(200);
      const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      try { ask = (db.prepare('SELECT id FROM asks').get() as { id: string } | undefined)?.id; } finally { db.close(); }
    }
    expect(ask, 'the ask').toBeTruthy();
    tools.close();
    await hub.restart(env);
    const handed = waiter(root, id, work);
    await sleep(1000);
    const done = spawnSync(process.execPath, [CLI, 'inbox', 'answer', `ask:${ask}`, 'first'], { env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 60_000 });
    expect(done.status, done.stderr).toBe(0);
    const result = await Promise.race([handed, sleep(10_000).then(() => 'not woken')]);
    expect(JSON.stringify(result)).toContain('North');
  });
}, 120_000);

it('holds the stop of a session resumed after it ended, with the answer it missed (#824)', async () => {
  const id = '7c4d5e60-1111-4222-8333-44445555999a';
  await withHub(async (root, home, hub) => {
    writeFileSync(join(root, 'config.json'), JSON.stringify({ asks: { deadline: { taste: '3d' }, default: { taste: 'recommended' } } }));
    writeFileSync(join(home, 'confirm'), 'confirmed\n');
    await hub.restart({ DEEP_HUB_TEST_CONFIRM: join(home, 'confirm') });
    const { work, transcript } = session(home, id);
    const hook = (event: string, extra: Record<string, unknown> = {}) => reply(join(root, 'hub.sock'), hookLine(ulid(Date.now()), event, { session_id: id, transcript_path: transcript, cwd: work, hook_event_name: event, ...extra }, { ppid: process.pid }));
    await hook('SessionStart', { source: 'startup' });
    const tools = mcp(home, work, false);
    await tools.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    void tools.call('deep_ask', { kind: 'taste', question: 'Which road?', options: [{ id: 'first', label: 'North' }, { id: 'second', label: 'South' }], recommended: 'second' }).catch(() => undefined);
    let ask: string | undefined;
    for (let tries = 0; tries < 150 && !ask; tries++) {
      await sleep(200);
      const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      try { ask = (db.prepare('SELECT id FROM asks').get() as { id: string } | undefined)?.id; } finally { db.close(); }
    }
    expect(ask, 'the ask').toBeTruthy();
    tools.close();
    await hook('SessionEnd', { reason: 'prompt_input_exit' });
    expect(await recorded(root, id, 'session.end', 1)).toBe(1);
    // Answered while the session is gone: only a stop of it, once it comes back, can carry the answer.
    const cli = await client(join(root, 'hub.sock'), readFileSync(join(root, 'control.token'), 'utf8').trim());
    await cli('ask.answer', { ask: `ask:${ask}`, option: 'first' });
    await hook('SessionStart', { source: 'resume' });
    expect(await recorded(root, id, 'session.start', 2)).toBe(2);
    await sleep(500);
    const stop = await hook('Stop', { stop_hook_active: false, last_assistant_message: 'Done.' });
    expect(JSON.stringify(stop)).toContain('North');
  });
}, 120_000);
