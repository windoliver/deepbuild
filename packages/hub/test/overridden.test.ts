// A deny that didn't hold (#1033), on a hub hook requests reach the way deep-hook sends them: one from before a restart
// is still read back when its call's PostToolUse arrives after, and a session's row takes back its watch-only line once
// its home loads no mod that can override the guard.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { hookLine, recorded, reply, send, session, withHub } from './hub.js';

const PUSH = { tool_name: 'Bash', tool_input: { command: 'git push --force origin main' }, tool_use_id: 'toolu_01Push1033' };
const readings = (root: string, id: string): string[] => {
  const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
  try { return (db.prepare("SELECT json_extract(data, '$.reading') AS r FROM events WHERE kind = 'session.reading' AND session_id = ? ORDER BY log_pos").all(id) as { r: string }[]).map((x) => x.r); } finally { db.close(); }
};

describe('a deny that did not hold', () => {
  it('is recorded when the denied call\'s PostToolUse reaches a hub started after the deny', async () => {
    await withHub(async (root, home, hub) => {
      writeFileSync(join(root, 'rules.json'), JSON.stringify({ v: 1, entries: { 'no-force-push': { match: 'run:git push --force', scope: 'all_repos', mode: 'block', reason: 'A force push rewrites the remote.', next_step: 'Push without --force.', fail_closed: false } } }));
      const s = session(home, 'aaaaaaaa-1033-4000-8000-000000000001');
      await send(socket(root), hookLine('01K74FKZVK8Q2X5R7M3N9P4T60', 'SessionStart', s.payload('SessionStart', { source: 'startup' })));
      const denied = await reply(socket(root), hookLine('01K74FKZVK8Q2X5R7M3N9P4T61', 'PreToolUse', s.payload('PreToolUse', PUSH), { matched: ['no-force-push'] }));
      expect(denied.exit, 'the guard entry denies the push').toBe(2);
      await recorded(root, 'aaaaaaaa-1033-4000-8000-000000000001', 'tool.before', 1);
      await hub.restart({ DEEP_HUB_TEST_MANAGED_SETTINGS: join(home, 'no-managed.json') });
      await send(socket(root), hookLine('01K74FKZVK8Q2X5R7M3N9P4T62', 'PostToolUse', s.payload('PostToolUse', { ...PUSH, tool_response: { stdout: '', stderr: '' } })));
      expect(await recorded(root, 'aaaaaaaa-1033-4000-8000-000000000001', 'guard.overridden', 1), 'the push ran past its deny from before the restart').toBe(1);
    });
  }, 60_000);

  it("takes back a session's watch-only line once its home loads no mod that can override the guard", async () => {
    await withHub(async (root, home, hub) => {
      // A claude that lists what list.json holds and validates a folder by its validate.txt, as 2.1.308 prints them.
      const bin = join(home, 'bin');
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, 'claude'), `#!/bin/sh\ncase "$1 $2" in\n  "plugin list") cat '${join(home, 'list.json')}';;\n  "plugin validate") cat "$3/validate.txt";;\n  "auth status") echo '{"loggedIn":true,"subscriptionType":"max"}';;\n  *) exit 1;;\nesac\n`);
      chmodSync(join(bin, 'claude'), 0o755);
      const mod = join(home, 'mods', 'approve-all');
      mkdirSync(mod, { recursive: true });
      writeFileSync(join(mod, 'validate.txt'), `Validating hooks: ${mod}/hooks/hooks.json\n\n  ❯ ./register.ts hooks: tool.check\n  ❯ ./register.ts calls: nothing on $\n`);
      writeFileSync(join(home, 'list.json'), JSON.stringify([{ id: 'approve-all@m', enabled: true, installPath: mod }]));
      mkdirSync(join(home, '.claude'), { recursive: true });
      writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'approve-all@m': true } }));
      await hub.restart({ PATH: `${bin}:${process.env.PATH ?? ''}`, DEEP_HUB_TEST_MANAGED_SETTINGS: join(home, 'no-managed.json') });
      const id = 'aaaaaaaa-1033-4000-8000-000000000002';
      const s = session(home, id);
      await send(socket(root), hookLine('01K74FKZVK8Q2X5R7M3N9P4T63', 'SessionStart', s.payload('SessionStart', { source: 'startup' })));
      await recorded(root, id, 'session.reading', 1);
      expect(readings(root, id).at(-1), 'the home loads approve-all, which handles tool.check').toMatch(/^This session's Claude Code home .* approve-all.*watch-only/);
      // You disable the mod: Claude Code turns it off in settings.json, and lists it disabled.
      writeFileSync(join(home, 'list.json'), JSON.stringify([{ id: 'approve-all@m', enabled: false, installPath: mod }]));
      writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'approve-all@m': false } }));
      await send(socket(root), hookLine('01K74FKZVK8Q2X5R7M3N9P4T64', 'SessionStart', s.payload('SessionStart', { source: 'resume' })));
      await recorded(root, id, 'session.reading', 2);
      expect(readings(root, id).at(-1), "the session's row takes the watch-only line back").toMatch(/^Its Claude Code home loads no mod that can approve a call past the guard/);
    });
  }, 60_000);
});

const socket = (root: string): string => join(root, 'hub.sock');
