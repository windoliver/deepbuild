// A Claude Code home's login plan (#1033), read with `claude auth status` for whether a PreToolUse deny holds whatever a
// mod answers: read once per home, and again only once a file a sign-in rewrites changes or five minutes pass, since
// each read starts claude on every Claude Code session's start.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hookLine, recorded, send, session, withHub } from './hub.js';

const authCalls = (log: string): number => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter((l) => l === 'auth status').length : 0);
const until = async (f: () => boolean): Promise<void> => { for (const end = Date.now() + 10_000; Date.now() < end && !f(); await new Promise((r) => setTimeout(r, 50))); };

describe("a Claude Code home's login plan", () => {
  it('is read once for many session starts, and again once the sign-in changes', async () => {
    await withHub(async (root, home, hub) => {
      const bin = join(home, 'bin');
      const log = join(home, 'claude.log');
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, 'claude'), `#!/bin/sh\necho "$1 $2" >> '${log}'\ncase "$1 $2" in\n  "plugin list") echo '[]';;\n  "auth status") echo '{"loggedIn":true,"subscriptionType":"max"}';;\n  *) exit 1;;\nesac\n`);
      chmodSync(join(bin, 'claude'), 0o755);
      mkdirSync(join(home, '.claude'), { recursive: true });
      await hub.restart({ PATH: `${bin}:${process.env.PATH ?? ''}`, DEEP_HUB_TEST_MANAGED_SETTINGS: join(home, 'no-managed.json') });
      const start = async (n: number, source: string) => {
        const id = `aaaaaaaa-1033-4000-8000-0000000001${String(n).padStart(2, '0')}`;
        await send(join(root, 'hub.sock'), hookLine(`01K74FKZVK8Q2X5R7M3N9P4V${String(n).padStart(2, '0')}`, 'SessionStart', session(home, id).payload('SessionStart', { source })));
        await recorded(root, id, 'session.start', 1);
      };
      await start(1, 'startup');
      await until(() => authCalls(log) >= 1);
      for (let n = 2; n <= 6; n++) await start(n, 'startup');
      // Time for every start's mods reading to have run.
      await new Promise((r) => setTimeout(r, 1500));
      expect(authCalls(log), 'six session starts in one home read its login once').toBe(1);
      // A sign-in rewrites the home's credentials: the next start reads the plan again.
      writeFileSync(join(home, '.claude', '.credentials.json'), '{}');
      await start(7, 'startup');
      await until(() => authCalls(log) >= 2);
      expect(authCalls(log), 'the start after a sign-in reads the login again').toBe(2);
    });
  }, 60_000);
});
