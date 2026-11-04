// A Claude Code session idle at its prompt sends a Notification about a minute after its turn ends (#992): it shows
// no turn running, so your answer still wakes the session through its waiter. As in answer-after-restart.test.ts, the
// hub restarts once the ask is open; the Notification then comes from a stand-in agent process, so your answer, from
// this test's own process, is from outside the session.
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { ulid } from '../src/wire.js';
import { hookLine, mcp, reply, session, waiter, withHub } from './hub.js';

const CLI = fileURLToPath(new URL('../../cli/dist/main.js', import.meta.url));
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

it('wakes an idle session through its waiter after its idle prompt\'s Notification', async () => {
  const id = '7c4d5e60-1111-4222-8333-44445555a992';
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
    await hub.restart({ DEEP_HUB_TEST_CONFIRM: join(home, 'confirm') });
    const handed = waiter(root, id, work);
    await sleep(1000);
    const agent = spawn('sleep', ['120'], { stdio: 'ignore' });
    try {
      await sleep(200);
      await reply(join(root, 'hub.sock'), hookLine(ulid(Date.now()), 'Notification', { session_id: id, transcript_path: transcript, cwd: work, hook_event_name: 'Notification', message: 'Claude is waiting for your input', notification_type: 'idle_prompt' }, { ppid: agent.pid }));
    const done = spawnSync(process.execPath, [CLI, 'inbox', 'answer', `ask:${ask}`, 'first'], { env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 60_000 });
    expect(done.status, done.stderr).toBe(0);
    const result = await Promise.race([handed, sleep(10_000).then(() => 'not woken')]);
    expect(JSON.stringify(result), 'the answer wakes the idle session').toContain('North');
    } finally {
      agent.kill();
    }
  });
}, 120_000);
