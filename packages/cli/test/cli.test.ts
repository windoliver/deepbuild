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

  // #331: deep env with --root acts on that dev hub alone, and a malformed one is only a usage error: neither sets the home up.
  it.each([
    ['up --root <dev hub> --json', (home: string) => ['up', '--root', join(home, 'dev-hub'), '--json'], 3, 'BLOCKED: the dev hub at --root is not running'],
    ['up --root, with no folder', () => ['up', '--root'], 2, 'a usage error'],
  ] as const)('deep env %s in a fresh home sets nothing up there', (_, args, status, why) => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'deep-cli-home-')));
    try {
      const env = { ...process.env, HOME: home };
      for (const key of Object.keys(env)) if (key.startsWith('DEEP_') || key.startsWith('CLAUDE')) delete env[key];
      // The timeout outlives the 15 s a wrong program spends waiting for the home's hub to start.
      const result = spawnSync(process.execPath, [cli, 'env', ...args(home)], { encoding: 'utf8', env, cwd: home, timeout: 60_000 });
      expect(existsSync(join(home, '.deepbuild')), `deep env set the home up (${result.stderr.trim().slice(0, 300)})`).toBe(false);
      expect(result.status, why).toBe(status);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 70_000);
});
