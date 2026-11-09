// The hub's parser threads: one for small lines from the start, and the one for lines over 1 MB started at the first
// such line, so an idle hub holds one thread fewer (design: Memory, the hub under 150 MB idle). A parser started late
// scrubs by every value the hub holds, as the first does.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { hookLine, recorded, send, session, withHub } from './hub.js';

/** The hub process's threads, as ps counts them: the main thread, libuv's and V8's, and each worker. */
const threads = (pid: number): number => execFileSync('ps', ['-M', '-p', String(pid)], { encoding: 'utf8' }).trim().split('\n').length - 1;
/** The pid of the hub serving `root`, from its lock's record of itself. */
const hubPid = (root: string): number => Number(execFileSync('lsof', ['-t', join(root, 'hub.sock')], { encoding: 'utf8' }).trim().split('\n')[0]);

describe('the parser for large lines', () => {
  it('starts at the first line over 1 MB, and scrubs it by the values the hub held from its start', async () => {
    const secret = `held-${'k'.repeat(24)}-value`;
    const heldFile = join('/tmp', `parsers-held-${process.pid}`);
    writeFileSync(heldFile, `${secret}\n`);
    await withHub(async (root, home) => {
      const id = 'aaaaaaaa-0016-4000-8000-0000000000b1';
      const s = session(home, id);
      await send(join(root, 'hub.sock'), hookLine('01K74FKZVK8Q2X5R7M3N9P4TB0', 'SessionStart', s.payload('SessionStart', { source: 'startup' })));
      const pid = hubPid(root);
      const before = threads(pid);
      // A command over 1 MB that names the held value: the large-line parser reads it.
      const command = `echo ${secret} ${'x'.repeat(1_200_000)}`;
      await send(join(root, 'hub.sock'), hookLine('01K74FKZVK8Q2X5R7M3N9P4TB1', 'PreToolUse', s.payload('PreToolUse', { tool_name: 'Bash', tool_input: { command }, tool_use_id: 'toolu_big' })));
      expect(await recorded(root, id, 'tool.before', 1), 'the large call is recorded').toBe(1);
      expect(threads(pid), 'a thread more once a large line arrives: the large-line parser started then').toBeGreaterThan(before);
      const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      const data = (db.prepare("SELECT data FROM events WHERE kind = 'tool.before' AND session_id = ?").get(id) as { data: string }).data;
      db.close();
      expect(data.includes(secret), 'the held value is scrubbed from the large line').toBe(false);
      expect(data, 'the command is kept, scrubbed').toContain('echo ');
    }, { DEEP_HUB_TEST_HELD: heldFile });
  }, 60_000);
});
