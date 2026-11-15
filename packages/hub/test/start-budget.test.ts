// #2570, the owner's reading of criterion 2: `deep hub start` spends one 15 s budget in all. A start beside a root
// whose lock stays held (a hung hub, or `deep restore`) and where no hub answers fails within it, with today's
// message and exit 3, not after a 15 s wait for the lock and another 15 s for a new hub.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it } from 'vitest';
import { takeLock } from '../src/lock.js';

const CLI = fileURLToPath(new URL('../../cli/dist/main.js', import.meta.url));
const dir = realpathSync(mkdtempSync('/tmp/d2570b-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

it('#2570 a start beside a root whose lock stays held and where no hub answers fails within its 15 s, exit 3', async () => {
  const root = join(dir, 'root');
  mkdirSync(root, { recursive: true });
  // Another holder of the root's lock for the whole test: the CLI is another process, so its takeLock is refused.
  const lock = takeLock(join(root, 'hub-lock.sqlite'));
  expect(lock, 'the test must hold the lock').toBeDefined();
  try {
    const started = Date.now();
    const child = spawn(process.execPath, ['--no-warnings', CLI, 'hub', 'start', '--root', root], {
      env: { PATH: process.env.PATH, HOME: dir, TMPDIR: dir, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    const code = await new Promise<number | null>((done) => child.on('exit', done));
    const seconds = (Date.now() - started) / 1000;
    expect(code, stderr).toBe(3);
    expect(stderr).toContain(`deep hub start: no hub answered at unix:${join(root, 'hub.sock')} within 15 s; see ${join(root, 'logs', 'hub.log')}`);
    // 15 s and the margin a loaded machine needs to start Node, never a second wait.
    expect(seconds, `deep hub start took ${seconds.toFixed(1)} s`).toBeLessThan(20);
  } finally {
    lock?.release();
  }
}, 90_000);
