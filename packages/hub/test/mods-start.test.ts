// A Claude Code session's start reads its home's mods (#1033) with `claude plugin list`, a whole Claude Code process:
// starts that arrive while that read is running share it, so one unchanged home starts claude for it once.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { hookLine, recorded, send, session, withHub } from './hub.js';

/** Polls until `ok` holds, up to `ms`; whether it did. */
async function until(ok: () => boolean, ms: number): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 25))) if (ok()) return true;
  return ok();
}

it('starts that arrive while a home\'s mods are being read share that one read: claude plugin list runs once', async () => {
  await withHub(async (root, home, hub) => {
    // A claude whose plugin list takes half a second, as a real one does, noting each call.
    const bin = join(home, 'bin');
    const log = join(home, 'claude-calls.log');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'claude'), `#!/bin/sh\necho "$1 $2" >> '${log}'\ncase "$1 $2" in\n  "plugin list") sleep 0.5; echo '[]';;\n  *) exit 1;;\nesac\n`);
    chmodSync(join(bin, 'claude'), 0o755);
    await hub.restart({ PATH: `${bin}:${process.env.PATH ?? ''}`, DEEP_HUB_TEST_MANAGED_SETTINGS: join(home, 'no-managed.json') });
    const id = 'aaaaaaaa-1033-4000-8000-000000000012';
    const s = session(home, id);
    await send(join(root, 'hub.sock'), hookLine('01K74FKZVK8Q2X5R7M3N9P4T71', 'SessionStart', s.payload('SessionStart', { source: 'startup' })));
    // Five compactions inside the first read's half second.
    for (let i = 0; i < 5; i++) await send(join(root, 'hub.sock'), hookLine(`01K74FKZVK8Q2X5R7M3N9P4T8${i}`, 'SessionStart', s.payload('SessionStart', { source: 'compact' })));
    await recorded(root, id, 'session.start', 6);
    const lists = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter((l) => l === 'plugin list') : []);
    await until(() => lists().length > 0, 10_000);
    await new Promise((r) => setTimeout(r, 1500));
    expect(lists().length, 'claude plugin list ran once for the one home').toBe(1);
  });
}, 60_000);
