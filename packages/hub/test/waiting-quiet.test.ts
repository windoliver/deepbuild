// A session waiting at its agent's permission prompt (#992): one still showing keeps needing you past the working
// quiet period, and one closed with no hook, as Esc does, goes quiet once its transcript shows the tool's result.
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { ulid } from '../src/wire.js';
import { client, hookLine, reply, session, withHub } from './hub.js';

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

it('a prompt still showing needs you past the quiet period; one denied with no hook goes quiet', async () => {
  const id = '7c4d5e60-1111-4222-8333-44445555c992';
  await withHub(async (root, home) => {
    const { work, transcript, payload } = session(home, id);
    const hook = (event: string, extra: Record<string, unknown> = {}) => reply(join(root, 'hub.sock'), hookLine(ulid(Date.now()), event, payload(event, extra), { ppid: process.pid }));
    const call = await client(join(root, 'hub.sock'), readFileSync(join(root, 'control.token'), 'utf8').trim());
    const state = () => {
      const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      try { return (db.prepare("SELECT json_extract(data, '$.state') AS state FROM events WHERE kind = 'session.state' AND session_id = ? ORDER BY log_pos DESC LIMIT 1").get(id) as { state: string } | undefined)?.state; } finally { db.close(); }
    };
    const within = async (want: string) => { for (let i = 0; i < 40 && state() !== want; i++) await sleep(250); return state(); };
    await hook('SessionStart', { source: 'startup' });
    await hook('UserPromptSubmit', { prompt: 'write it', prompt_id: 'p1' });
    await hook('PreToolUse', { prompt_id: 'p1', tool_name: 'Write', tool_input: { file_path: join(work, 'a.md'), content: 'one' }, tool_use_id: 'toolu_1' });
    await hook('PermissionRequest', { prompt_id: 'p1', tool_name: 'Write', tool_input: { file_path: join(work, 'a.md'), content: 'one' } });
    expect(await within('needs you'), 'the prompt waits on you').toBe('needs you');
    // Two minutes with the prompt showing: the transcript gains nothing, and the session still needs you.
    await call('test.clock', { advance_ms: 120_000 });
    await sleep(1500);
    expect(state(), 'a prompt still showing needs you').toBe('needs you');
    // Denied with Esc: no hook, only the tool's result in the transcript; the next quiet period reads it.
    appendFileSync(transcript, `${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'The user doesn\'t want to proceed with this tool use.', is_error: true }] } })}\n`);
    await call('test.clock', { advance_ms: 30_000 });
    expect(await within('quiet'), 'a prompt closed with no hook goes quiet').toBe('quiet');
  }, { DEEP_HUB_TEST_CLOCK_STEPS: '1' });
}, 60_000);
