// #2064 regression: post-call PR attribution must not drop tool.after when a forge lookup fails.
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { checkout, completedCall, endAgents, events, hook, newSession, until, withHub } from '../../../tests/acceptance/1881/helpers.ts';
import { afterEach } from 'vitest';

afterEach(() => endAgents());
it('keeps the completed joined call when lookup of the current branch throws', async () => {
  await withHub(() => undefined, async (hub) => {
    const cwd = checkout(hub.home, 'cart-work', 'b', 'https://github.com/acme/cart.git');
    const s = newSession(hub, cwd);
    await hook(hub, s, 'SessionStart', { source: 'startup' });
    const command = 'git push && gh pr create --title t --body "No issue"';
    // Only the branch column is absent; recording a tool event does not write it.
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(hub.root, 'ledger.db'));
    db.exec('PRAGMA busy_timeout=5000');
    db.exec('ALTER TABLE sessions RENAME COLUMN branch TO branch_saved_2064');
    db.close();
    try {
      await completedCall(hub, s, 'Bash', { command }, { stdout: '', stderr: '', interrupted: false, isImage: false });
      const after = await until(() => events(hub, 'tool.after', s.id).find((e) => e.data.command === command), 10_000);
      expect(after, 'tool.after is recorded even when SELECT branch fails').toBeDefined();
    } finally {
      const restore = new DatabaseSync(join(hub.root, 'ledger.db'));
      restore.exec('PRAGMA busy_timeout=5000');
      restore.exec('ALTER TABLE sessions RENAME COLUMN branch_saved_2064 TO branch');
      restore.close();
    }
  });
}, 120_000);
