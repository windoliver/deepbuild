import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cli = fileURLToPath(new URL('../src/main.ts', import.meta.url));
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

describe('deep checkout command', () => {
  it('shows help without claiming that a hub is running', () => {
    const result = run('--help');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: deep [--help | --version]');
    expect(result.stdout).toContain('Repository skeleton');
  });

  it('opens its help with a one-line banner, plain text with no escape when stdout is not a terminal', () => {
    const result = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8', env: { ...process.env, TERM: 'xterm-kitty', TERM_PROGRAM: 'iTerm.app', LC_TERMINAL: 'iTerm2' } });
    expect(result.status).toBe(0);
    expect(result.stdout.split('\n')[0]).toBe('DeepBuild 0.0.0');
    expect(result.stdout).not.toContain('\x1b');
  });

  it('prints its checkout version', () => {
    const result = run('--version');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('0.0.0\n');
  });

  it('refuses commands that have not been implemented, with the usage exit code', () => {
    const result = run('report');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Unsupported command');
    expect(result.stdout).toBe('');
  });

  it('acts on the dev hub --root names without setting the home up first (#331: deep env up --root in a fresh home)', () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'deep-cli-home-')));
    try {
      const env = { ...process.env, HOME: home };
      for (const key of Object.keys(env)) if (key.startsWith('DEEP_') || key.startsWith('CLAUDE')) delete env[key];
      // The timeout outlives the 15 s a wrong program spends waiting for the home's hub to start.
      const result = spawnSync(process.execPath, [cli, 'env', 'up', '--root', join(home, 'dev-hub'), '--json'], { encoding: 'utf8', env, cwd: home, timeout: 60_000 });
      expect(existsSync(join(home, '.deepbuild')), `deep env up --root set the home up (${result.stderr.trim().slice(0, 300)})`).toBe(false);
      expect(result.status, 'BLOCKED: the dev hub at --root is not running').toBe(3);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 70_000);
});
