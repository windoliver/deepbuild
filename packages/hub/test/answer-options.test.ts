// #2563: `deep inbox answer` with an option the ask hasn't lists its options as you type them back.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { ulid } from '../src/wire.js';
import { hookLine, mcp, reply, session, withHub } from './hub.js';
import { first } from './stream.js';

const CLI = fileURLToPath(new URL('../../cli/dist/main.js', import.meta.url));

it('names each option of a refused answer as deep inbox answer takes it', async () => {
  const id = '7c4d5e60-2563-4222-8333-444455558888';
  await withHub(async (root, home, hub) => {
    writeFileSync(join(root, 'config.json'), JSON.stringify({ asks: { deadline: { choice: '3d' }, default: { choice: 'recommended' } } }));
    writeFileSync(join(home, 'confirm'), 'confirmed\n');
    await hub.restart({ DEEP_HUB_TEST_CONFIRM: join(home, 'confirm') });
    const { work, transcript } = session(home, id);
    await reply(join(root, 'hub.sock'), hookLine(ulid(Date.now()), 'SessionStart', { session_id: id, transcript_path: transcript, cwd: work, hook_event_name: 'SessionStart', source: 'startup' }, { ppid: process.pid }));
    const tools = mcp(home, work, false);
    await tools.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    const options = [{ id: '-fast', label: 'Fast' }, { id: 'red, green', label: 'Both' }, { id: 'esc\u001bkey', label: 'Escaped' }, { id: 'plain', label: 'Plain' }];
    void tools.call('deep_ask', { kind: 'choice', question: 'Which way?', options, recommended: 'plain' }).catch(() => undefined);
    // The ask's ID is its ask.created event's.
    const ask = (await first(root, 'ask.created')).id as string | undefined;
    expect(ask, 'the ask').toBeTruthy();
    tools.close();
    const done = spawnSync(process.execPath, [CLI, 'inbox', 'answer', `ask:${ask}`, 'nope'], { env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 60_000 });
    expect(done.status, done.stderr).toBe(2);
    expect(done.stderr).toContain(`its options are -- -fast, 'red, green', $'esc\\033key', plain.`);
  });
}, 120_000);
