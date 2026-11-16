import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('AC4: a dead or asynchronously unstartable canvas refuses calls without crashing its host', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ac2122-canvas-'));
  try {
    for (const mode of ['closed-pipe', 'spawn-failure']) {
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('./canvas-probe.mjs', import.meta.url)), mode, dir], {
        encoding: 'utf8', timeout: 10_000,
      });
      const diagnostic = `${mode}: exit=${result.status}, signal=${result.signal}\n${result.stdout}\n${result.stderr}`;
      console.log(diagnostic);
      if (mode === 'closed-pipe') expect(result.stdout, 'first call must really have been answered').toContain('FIRST {"answered":true}');
      expect.soft(result.status, diagnostic).toBe(0);
      expect.soft(result.stdout, diagnostic).toContain('RESULT unavailable');
      expect.soft(result.stdout, diagnostic).toContain('HOST still running');
      expect.soft(result.stderr, diagnostic).not.toMatch(/Unhandled 'error' event|uncaughtException|unhandledRejection/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30_000);
