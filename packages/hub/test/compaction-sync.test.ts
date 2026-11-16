// #2329: the older/newer-set reader also reuses a compacting process's checked start, not a new ps.
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { apply, propose, server, start, waitFor, world } from '../../../tests/acceptance/2121/helpers.ts';
import { hookLine, recorded, send, session } from './hub.js';

it('a compaction keeps the older-set reading without ps, and a new-process resume reads and clears it', async () => {
  const w = world(), log = join(w.tmp, 'ps.log');
  writeFileSync(log, '');
  writeFileSync(join(w.bin, 'ps'), `#!/bin/sh\necho "$*" >> '${log}'\nexec /bin/ps "$@"\n`);
  writeFileSync(join(w.bin, 'claude'), '#!/bin/sh\necho "[]"\n');
  for (const name of ['ps', 'claude']) chmodSync(join(w.bin, name), 0o755);
  await start(w);
  const agent = () => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { argv0: join(w.tmp, 'versions/claude'), stdio: 'ignore' });
  const stop = async (p: ChildProcess) => {
    if (p.exitCode !== null || p.signalCode !== null) return;
    await new Promise((resolve) => { p.once('exit', resolve); p.kill('SIGTERM'); });
  };
  const a = agent();
  let b: ChildProcess | undefined;
  const id = 'aaaaaaaa-2329-4000-8000-000000000030', s = session(w.home, id);
  const readings = () => {
    const db = new DatabaseSync(join(w.root, 'ledger.db'), { readOnly: true });
    try { return (db.prepare("SELECT json_extract(data, '$.reading') AS r FROM events WHERE session_id = ? AND kind = 'session.reading' ORDER BY log_pos").all(id) as { r: string }[]).map((r) => r.r); }
    finally { db.close(); }
  };
  let n = 0;
  const hook = (pid: number, source: string) => send(w.hub!.socket, hookLine(`01K74FKZVK8Q2X5R7M3N9P4T3${++n}`, 'SessionStart', s.payload('SessionStart', { source }), { ppid: pid }));
  try {
    await hook(a.pid!, 'startup'); await hook(a.pid!, 'compact');
    expect(await recorded(w.root, id, 'session.start', 2)).toBe(2);
    await new Promise((r) => setTimeout(r, 3500));
    await apply(w, await propose(w, { server: server('compact-sync'), agents: ['claude-code'] }));
    await waitFor(() => readings().some((r) => /older set/i.test(r)), 15_000, 'the existing process reads as the older set');
    writeFileSync(log, '');
    await hook(a.pid!, 'compact');
    expect(await recorded(w.root, id, 'session.start', 3)).toBe(3);
    await new Promise((r) => setTimeout(r, 1500));
    expect(readings().at(-1)).toMatch(/older set/i);
    expect(readFileSync(log, 'utf8').trim(), 'a sync does not make the same compacting process newer').toBe('');
    await stop(a);
    b = agent();
    await hook(b.pid!, 'resume');
    expect(await recorded(w.root, id, 'session.start', 4)).toBe(4);
    await waitFor(() => readings().some((r) => /current set/i.test(r)), 15_000, 'the resumed process loads the newer set');
    expect(readFileSync(log, 'utf8')).toContain(`-o args= -p ${b.pid}`);
    expect(readFileSync(log, 'utf8')).toContain(`-o lstart= -p ${b.pid}`);
  } finally { await stop(a); if (b) await stop(b); }
}, 90_000);
