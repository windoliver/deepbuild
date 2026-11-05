// The programs DeepBuild's hook entries run (#993), in every agent's settings setup wrote: Claude Code's and Codex's.
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describe as said, programOf, unrunnable } from '../src/hook-programs.js';

describe('the hook programs', () => {
  it('names each agent\'s entries whose program is gone or not executable, and nothing while they run', () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hook-programs-')));
    try {
      const root = join(tmp, 'root');
      const built = join(tmp, "it's", 'deep-hook');
      mkdirSync(join(tmp, "it's"), { recursive: true });
      writeFileSync(built, '#!/bin/sh\n');
      chmodSync(built, 0o755);
      // Codex's entries name the link setup keeps in the root; Claude Code's name the build itself.
      const link = join(root, 'bin', 'deep-hook');
      mkdirSync(join(root, 'bin'), { recursive: true });
      symlinkSync(built, link);
      const q = (p: string) => `'${p.replaceAll("'", `'\\''`)}'`;
      writeFileSync(join(root, 'claude-hooks.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `${q(built)} claude-code SessionStart` }] }], Stop: [{ hooks: [{ type: 'command', command: `${q(built)} claude-code Stop` }] }] } }));
      writeFileSync(join(root, 'codex-hooks.json'), JSON.stringify({ hooks: { Stop: { hooks: [{ type: 'command', command: `${q(link)} codex Stop` }] } }, home: join(tmp, '.codex') }));
      process.env.CLAUDE_CONFIG_DIR = join(tmp, '.claude');

      expect(programOf(`${q(built)} claude-code Stop`)).toBe(built);
      expect(unrunnable(root)).toEqual([]);

      chmodSync(built, 0o644);
      expect(unrunnable(root).map((u) => [u.agent, u.why, u.path, u.events])).toEqual([
        ['claude-code', 'not executable', built, ['SessionStart', 'Stop']],
        ['codex', 'not executable', link, ['Stop']],
      ]);

      rmSync(built);
      const found = unrunnable(root);
      expect(found.map((u) => [u.agent, u.why])).toEqual([['claude-code', 'gone'], ['codex', 'gone']]);
      expect(said(found[0]!)).toBe(`DeepBuild's SessionStart, Stop hook entries in ${join(tmp, '.claude', 'settings.json')} run ${built}, which is gone`);
      expect(said(found[1]!)).toBe(`DeepBuild's Stop hook entry in ${join(tmp, '.codex', 'hooks.json')} runs ${link}, which is gone`);
    } finally {
      delete process.env.CLAUDE_CONFIG_DIR;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
