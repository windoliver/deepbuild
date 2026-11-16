// #2329: the process, not a session ID or a failed parent-table read, bounds launch-fact reuse.
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { hookLine, recorded, send, session, withHub } from './hub.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

it('a rotated session ID in the held process reuses the process reads', async () => {
  await withHub(async (root, home, hub) => {
    const bin = join(home, 'bin'), log = join(home, 'ps.log');
    mkdirSync(bin);
    writeFileSync(join(bin, 'ps'), `#!/bin/sh\necho "$*" >> '${log}'\nexec /bin/ps "$@"\n`);
    writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho "[]"\n');
    for (const name of ['ps', 'claude']) chmodSync(join(bin, name), 0o755);
    await hub.restart({ PATH: `${bin}:${process.env.PATH ?? ''}` });
    const first = 'aaaaaaaa-2329-4000-8000-000000000010';
    const rotated = 'aaaaaaaa-2329-4000-8000-000000000011';
    const a = session(home, first), b = session(home, rotated);
    await send(join(root, 'hub.sock'), hookLine('01K74FKZVK8Q2X5R7M3N9P4T10', 'SessionStart', a.payload('SessionStart', { source: 'startup' })));
    await send(join(root, 'hub.sock'), hookLine('01K74FKZVK8Q2X5R7M3N9P4T11', 'SessionStart', a.payload('SessionStart', { source: 'compact' })));
    expect(await recorded(root, first, 'session.start', 2)).toBe(2);
    await sleep(3500); // Let the independent process watch's first check finish.
    expect(readFileSync(log, 'utf8')).toContain('-o args=');
    writeFileSync(log, '');
    await send(join(root, 'hub.sock'), hookLine('01K74FKZVK8Q2X5R7M3N9P4T12', 'SessionStart', b.payload('SessionStart', { source: 'clear' })));
    expect(await recorded(root, rotated, 'session.start', 1)).toBe(1);
    await sleep(1500);
    const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
    try {
      expect(db.prepare('SELECT thread_id FROM sessions WHERE id = ?').get(rotated)?.thread_id).toBe(first);
      expect(readFileSync(log, 'utf8').trim(), 'a new ID in the same held process needs no ps').toBe('');
    } finally { db.close(); }
  });
}, 60_000);

it('a failed parent-table read is retried, and a parent rotating its ID invalidates the child link', async () => {
  // The parent process really owns the child process; only the OS read's first failure is planted.
  const parent = spawn(process.execPath, ['-e', "const c = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); console.log(process.pid, c.pid); setInterval(() => {}, 1000); process.on('SIGTERM', () => { c.kill(); process.exit(); });"], { stdio: ['ignore', 'pipe', 'ignore'] });
  const [pid, child] = await new Promise<number[]>((resolve) => parent.stdout!.once('data', (data) => resolve(String(data).trim().split(/\s+/).map(Number))));
  try {
    await withHub(async (root, home, hub) => {
      const bin = join(home, 'bin'), failed = join(home, 'failed-table');
      mkdirSync(bin);
      writeFileSync(join(bin, 'ps'), `#!/bin/sh\nif [ "$1" = '-A' ] && [ ! -f '${failed}' ]; then touch '${failed}'; exit 1; fi\nexec /bin/ps "$@"\n`);
      writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho "[]"\n');
      for (const name of ['ps', 'claude']) chmodSync(join(bin, name), 0o755);
      await hub.restart({ PATH: `${bin}:${process.env.PATH ?? ''}` });
      const a = 'aaaaaaaa-2329-4000-8000-000000000020';
      const b = 'aaaaaaaa-2329-4000-8000-000000000021';
      const c = 'aaaaaaaa-2329-4000-8000-000000000022';
      let n = 0;
      const start = async (id: string, ppid: number, source: string) => {
        await send(join(root, 'hub.sock'), hookLine(`01K74FKZVK8Q2X5R7M3N9P4T2${++n}`, 'SessionStart', session(home, id).payload('SessionStart', { source }), { ppid }));
      };
      await start(a, pid!, 'startup');
      expect(await recorded(root, a, 'session.start', 1)).toBe(1);
      await sleep(500); // The parent's initial, asynchronous ancestry read precedes the child.
      await start(b, child!, 'startup');
      expect(await recorded(root, b, 'session.start', 1)).toBe(1);
      for (const end = Date.now() + 5000; !existsSync(failed) && Date.now() < end; await sleep(25));
      expect(existsSync(failed), 'the first parent-table read failed at the OS boundary').toBe(true);
      await sleep(100);
      await start(b, child!, 'compact');
      expect(await recorded(root, b, 'session.child_started', 1), 'a failed lookup is retried at the next start').toBe(1);
      await start(c, pid!, 'clear');
      expect(await recorded(root, c, 'session.start', 1)).toBe(1);
      await start(b, child!, 'compact');
      expect(await recorded(root, b, 'session.child_started', 2), 'a changed parent session is read again').toBe(2);
      const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      try { expect(db.prepare('SELECT parent_id FROM sessions WHERE id = ?').get(b)?.parent_id).toBe(c); }
      finally { db.close(); }
    });
  } finally { parent.kill('SIGTERM'); }
}, 60_000);
