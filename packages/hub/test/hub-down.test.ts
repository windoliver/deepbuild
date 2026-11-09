// `deep hub status` with no hub to read (#16): it says so and exits 3 at once. A connection the hub refused leaves no
// timer of its own behind, so the command doesn't sit out its 2 s answer window before it can exit.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../../cli/dist/main.js', import.meta.url));

it('deep hub status with no hub exits 3 naming the socket, well inside the 2 s it would wait for an answer', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'hub-down-')));
  try {
    const root = join(home, 'root');
    const started = performance.now();
    const r = spawnSync(process.execPath, [CLI, 'hub', 'status', '--root', root], { env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 10_000 });
    const ms = performance.now() - started;
    expect(r.status, r.stderr).toBe(3);
    expect(r.stderr).toContain(join(root, 'hub.sock'));
    expect(ms, `deep hub status took ${Math.round(ms)} ms`).toBeLessThan(1500);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
