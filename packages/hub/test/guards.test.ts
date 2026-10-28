// The hub decides what each guard entry deep-hook matched does (#316): a block entry denies the call with its
// reason, its next step and deep-hook's note on the call; an entry in another mode leaves the call allowed.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hookLine, reply, withHub } from './hub.js';

const entry = (mode: string) => ({ match: 'kill:by-name', scope: 'all_repos', mode, reason: 'REASON-316.', next_step: 'NEXT-316.', fail_closed: false });
const call = { session_id: 's', cwd: '/tmp', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'pkill -f node' }, tool_use_id: 't' };

describe("the hub's answer to a matched guard entry", () => {
  it('denies for a block entry, with its reason, next step and the note deep-hook sent, and allows for a watch entry', async () => {
    await withHub(async (root) => {
      writeFileSync(join(root, 'rules.json'), JSON.stringify({ v: 1, entries: { blocked: entry('block'), watched: entry('watch') } }));
      const socket = join(root, 'hub.sock');
      const denied = await reply(socket, hookLine('01K74FKZVK8Q2X5R7M3N9P4T6W', 'PreToolUse', call, { matched: ['blocked'], notes: { blocked: 'NOTE-316' } }));
      expect(denied.exit).toBe(2);
      for (const said of ['REASON-316.', 'NEXT-316.', 'NOTE-316', 'blocked']) expect(denied.stderr).toContain(said);
      const watched = await reply(socket, hookLine('01K74FKZVK8Q2X5R7M3N9P4T6X', 'PreToolUse', call, { matched: ['watched'] }));
      expect(watched.exit).toBe(0);
    });
  }, 60_000);
});
