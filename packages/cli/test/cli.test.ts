import { spawnSync } from 'node:child_process';
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

  it('prints its checkout version', () => {
    const result = run('--version');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('0.0.0\n');
  });

  it('refuses commands that have not been implemented, with the usage exit code', () => {
    const result = run('status');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Unsupported command');
    expect(result.stdout).toBe('');
  });
});
