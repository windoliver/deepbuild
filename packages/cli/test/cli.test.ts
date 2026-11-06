import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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

  it.each(['help', '-h'])('shows the same help for deep %s as for --help', (word) => {
    const result = run(word);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(run('--help').stdout);
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
    ['up --root --json, a flag where the folder goes', () => ['up', '--root', '--json'], 2, 'a usage error'],
  ] as const)('deep env %s in a fresh home sets nothing up there', (_, args, status, why) => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'deep-cli-home-')));
    try {
      const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
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

describe('deep on a Node older than its engines field', () => {
  // A real older Node, as Homebrew installs one; none on this machine leaves the check unrun, never passed.
  const older = ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'].find((node) => {
    const v = spawnSync(node, ['-p', 'process.versions.node'], { encoding: 'utf8' }).stdout?.trim();
    return v && v.localeCompare('24.22.0', undefined, { numeric: true }) < 0;
  });
  it('names the Node it needs and the one it found, and exits 2 before anything runs', () => {
    if (!older) throw Error('BLOCKED: no Node older than 24.22.0 on this machine to run the CLI with');
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'deep-cli-node-')));
    try {
      const found = spawnSync(older, ['-p', 'process.versions.node'], { encoding: 'utf8' }).stdout.trim();
      // A wrong program that sets up anyway must never reach the real service manager: launchctl here only fails.
      mkdirSync(join(home, 'bin'));
      for (const name of ['launchctl', 'systemctl']) { writeFileSync(join(home, 'bin', name), '#!/bin/sh\nexit 1\n'); chmodSync(join(home, 'bin', name), 0o755); }
      const result = spawnSync(older, [fileURLToPath(new URL('../dist/main.js', import.meta.url)), 'status'], { encoding: 'utf8', env: { HOME: home, PATH: `${join(home, 'bin')}:/usr/bin:/bin`, DEEP_HUB_LAUNCHER: join(home, 'bin', 'launchctl') }, timeout: 60_000 });
      expect(result.stderr).toContain('Node 24.22.0 or newer');
      expect(result.stderr).toContain(found);
      expect(result.status).toBe(2);
      expect(existsSync(join(home, '.deepbuild')), 'nothing was set up').toBe(false);
      expect(existsSync(join(home, '.claude')), 'no agent settings were written').toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 70_000);
});
