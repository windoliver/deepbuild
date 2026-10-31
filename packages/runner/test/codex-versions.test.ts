import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { programRoot } from '../src/runner.js';
// Codex's versions and windows in the runner (#39): a build its facts don't list isn't covered by a listed build's
// numbers, and a window is the one its length says, as the hub's row reads it.
import { describe, expect, it } from 'vitest';
import { codexRefused, codexWindows, shownVersion } from '../src/runner.js';

describe('the version Codex shows', () => {
  it('keeps its suffix where versions are exact, so a stable build is not its alpha', () => {
    expect(shownVersion('codex-cli 0.163.0-alpha.10.2\n', true)).toBe('0.163.0-alpha.10.2');
    expect(shownVersion('codex-cli 0.163.0\n', true)).toBe('0.163.0');
  });
  it('stays the three numbers for an agent whose facts are a range', () => {
    expect(shownVersion('2.1.142-beta (Claude Code)\n', false)).toBe('2.1.142');
  });
});

describe('Codex\'s windows', () => {
  it('are named by length, with the slot only where a snapshot gives none', () => {
    const weekFirst = codexWindows({ limit_id: 'codex', primary: { used_percent: 40, window_minutes: 10080 } });
    expect([...weekFirst.keys()]).toEqual(['seven_day']);
    const named = codexWindows({ primary: { used_percent: 1, window_minutes: 300 }, secondary: { used_percent: 2, window_minutes: 10080 } });
    expect(named.get('five_hour')?.used).toBe(1);
    expect(named.get('seven_day')?.used).toBe(2);
    expect([...codexWindows({ primary: { used_percent: 1 }, secondary: { used_percent: 2 } }).keys()]).toEqual(['five_hour', 'seven_day']);
  });
});

describe('what counts as a refusal', () => {
  const ran = (command: string, status = 'failed') => ({ type: 'command_execution', command, status, aggregated_output: 'Operation not permitted' });
  it('is a write the sandbox stopped, or a patch declined', () => {
    expect(codexRefused(ran("/bin/sh -c 'printf x > out.txt'"))).toBe(true);
    expect(codexRefused(ran('touch out.txt'))).toBe(true);
    expect(codexRefused({ type: 'file_change', status: 'declined' })).toBe(true);
  });
  it('is not a read that failed the same way, nor a command that ran', () => {
    expect(codexRefused(ran('cat /private/secret'))).toBe(false);
    expect(codexRefused(ran('cat /private/secret 2>/dev/null'))).toBe(false);
    expect(codexRefused(ran('touch out.txt', 'completed'))).toBe(false);
  });
});

describe('an agent installed as a package', () => {
  it('has its whole package readable, since its launcher in bin loads the rest from there', () => {
    const pkg = realpathSync(mkdtempSync(join(tmpdir(), 'deep-pkg-')));
    mkdirSync(join(pkg, 'bin'));
    writeFileSync(join(pkg, 'package.json'), '{}');
    writeFileSync(join(pkg, 'bin', 'codex.js'), '');
    expect(programRoot(join(pkg, 'bin', 'codex.js'))).toBe(pkg);
    rmSync(pkg, { recursive: true });
  });
  it('is only its own folder when no package holds it', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-bare-')));
    writeFileSync(join(dir, 'codex'), '');
    expect(programRoot(join(dir, 'codex'))).toBe(dir);
    rmSync(dir, { recursive: true });
  });
});
