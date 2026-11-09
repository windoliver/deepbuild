// A Claude Code session's start reads its agent's command line (`ps -o args=`) for two things: whether the process is
// the agent's own binary (#148's newer set) and the plugin folders it loads (#1033's mods). The two share one read, so
// a start runs that `ps` once, not once per reader. And with no other session's process to be its parent, the start
// reads no process table to find one (design: Numbers version 0 has to hold, Hot path).
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { hookLine, recorded, send, session, withHub } from './hub.js';

it("a Claude Code session's start reads its agent's command line once, and no process table when no session could be its parent", async () => {
  await withHub(async (root, home, hub) => {
    // A ps on PATH that notes each call and runs the real one, and a claude that lists no mods.
    const bin = join(home, 'bin');
    const log = join(home, 'ps.log');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'ps'), `#!/bin/sh\necho "$*" >> '${log}'\nexec /bin/ps "$@"\n`);
    writeFileSync(join(bin, 'claude'), `#!/bin/sh\ncase "$1 $2" in\n  "plugin list") echo '[]';;\n  *) exit 1;;\nesac\n`);
    chmodSync(join(bin, 'ps'), 0o755);
    chmodSync(join(bin, 'claude'), 0o755);
    await hub.restart({ PATH: `${bin}:${process.env.PATH ?? ''}`, DEEP_HUB_TEST_MANAGED_SETTINGS: join(home, 'no-managed.json') });
    const id = 'aaaaaaaa-0016-4000-8000-0000000000d1';
    const s = session(home, id);
    await send(join(root, 'hub.sock'), hookLine('01K74FKZVK8Q2X5R7M3N9P4TD0', 'SessionStart', s.payload('SessionStart', { source: 'startup' })));
    expect(await recorded(root, id, 'session.start', 1), 'the start is recorded').toBe(1);
    // Both readers run after the start's append settles; give them time to finish.
    await new Promise((r) => setTimeout(r, 1500));
    const calls = existsSync(log) ? readFileSync(log, 'utf8').split('\n') : [];
    expect(calls.filter((l) => l === `-o args= -p ${process.ppid}`).length, "the agent's command line is read once for its start").toBe(1);
    expect(calls.filter((l) => l.startsWith('-A ')), 'no process table is read: no other session could be its parent').toEqual([]);
  });
}, 60_000);
