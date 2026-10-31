// Codex's versions and windows in the runner (#39): a build its facts don't list isn't covered by a listed build's
// numbers, and a window is the one its length says, as the hub's row reads it.
import { describe, expect, it } from 'vitest';
import { codexWindows, shownVersion } from '../src/runner.js';

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
