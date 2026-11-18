// `deep hub status` keeps reading a hub that answered (#2801): once the hub says hello, its health may take longer than
// the 2 s a missing hub gets, as on a busy machine, where the readings' own `ps` and secret-store children are slow.
// The hub here runs with a `ps` on its PATH that takes 3 s, so each health takes over 2 s.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../../cli/dist/main.js', import.meta.url));

it('deep hub status reads a hub whose health takes over 2 s', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'slow-health-')));
  const root = join(home, 'root');
  const shims = join(home, 'shims');
  mkdirSync(shims);
  writeFileSync(join(shims, 'ps'), '#!/bin/sh\nsleep 3\nexec /bin/ps "$@"\n');
  chmodSync(join(shims, 'ps'), 0o755);
  const deep = (args: string[], path = process.env.PATH) =>
    spawnSync(process.execPath, [CLI, 'hub', ...args, '--root', root], { env: { ...process.env, HOME: home, PATH: path }, encoding: 'utf8', timeout: 180_000 });
  let pid: number | undefined;
  try {
    const start = deep(['start'], `${shims}:${process.env.PATH}`);
    expect(start.status, start.stderr).toBe(0);
    const at = performance.now();
    const status = deep(['status']);
    const ms = performance.now() - at;
    expect(status.status, `deep hub status: ${status.stderr}`).toBe(0);
    const health = JSON.parse(status.stdout.trim().split('\n').pop() ?? 'null') as { pid?: number; process?: unknown } | null;
    pid = health?.pid;
    expect(Number.isInteger(pid) && typeof health?.process === 'object', status.stdout).toBe(true);
    // The slow reading ran: the health came after the 2 s a missing hub gets.
    expect(ms, `deep hub status took ${Math.round(ms)} ms`).toBeGreaterThan(2000);
  } finally {
    // The hub this test started, stopped by its PID if the stop didn't.
    if (deep(['stop']).status !== 0 && pid) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    rmSync(home, { recursive: true, force: true });
  }
}, 240_000);
