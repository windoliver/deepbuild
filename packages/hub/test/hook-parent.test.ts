// The process each Claude Code hook entry's program runs under. Claude Code runs an entry's command with `/bin/sh -c`,
// and the hub checks a hook against its session by deep-hook's parent process (design: Socket roles), so the program
// must be the agent's own child: dash, /bin/sh on Debian and Ubuntu, runs a lone command as a child of a new shell
// for each hook, and every hook past SessionStart then read unverified.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claudeCommand, ourGroups } from '../src/claude-settings.js';
import { withEntries } from '../src/codex-settings.js';
import { programOf } from '../src/hook-programs.js';

const DASH = ['/bin/dash', '/usr/bin/dash'].find((p) => existsSync(p));

describe('Claude Code hook entries', () => {
  it('run their program as a child of the process that runs the command, under dash and /bin/sh', () => {
    if (!DASH) throw Error('BLOCKED: no dash on this machine, the shell that runs a lone command in a child');
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hook-parent-')));
    try {
      // A stand-in for deep-hook that says what its parent is.
      const stub = join(tmp, "it's", 'deep-hook');
      mkdirSync(join(tmp, "it's"));
      writeFileSync(stub, '#!/bin/sh\nps -o ppid= -p $$\n');
      chmodSync(stub, 0o755);
      const groups = ourGroups(stub, claudeCommand(stub, 'waiter'), 600);
      const entries = Object.entries(groups).flatMap(([event, gs]) => gs.flatMap((g) => (g.hooks as { command: string }[]).map((h) => ({ event, command: h.command }))));
      expect(entries.length).toBeGreaterThan(10);
      const wrong: string[] = [];
      for (const shell of [DASH, '/bin/sh']) {
        for (const { event, command } of entries) {
          // This process stands for Claude Code: it starts the shell, the shell runs the entry.
          const r = spawnSync(shell, ['-c', command], { encoding: 'utf8' });
          const parent = Number(r.stdout.trim());
          if (r.status !== 0 || parent !== process.pid) wrong.push(`${shell}: ${event} \`${command}\` ran under ${parent || r.stderr.trim()}, not ${process.pid}`);
        }
      }
      expect(wrong).toEqual([]);
      // deep doctor and the hub still find the program each entry runs.
      expect([...new Set(entries.map((e) => programOf(e.command)))]).toEqual([stub]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// Codex runs an entry's command with `<your login shell> -c`, the shell your passwd names (bash, zsh or sh, else bash),
// so a login shell of /bin/sh is dash on Debian and Ubuntu, and the same holds there.
describe('Codex hook entries', () => {
  it('run their program as a child of the process that runs the command, under dash and /bin/sh', () => {
    if (!DASH) throw Error('BLOCKED: no dash on this machine, the shell that runs a lone command in a child');
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'hook-parent-')));
    try {
      const stub = join(tmp, "it's", 'deep-hook');
      mkdirSync(join(tmp, "it's"));
      writeFileSync(stub, '#!/bin/sh\nps -o ppid= -p $$\n');
      chmodSync(stub, 0o755);
      const hooks = JSON.parse(withEntries('', stub)).hooks as Record<string, { hooks: { command: string }[] }[]>;
      const entries = Object.entries(hooks).flatMap(([event, gs]) => gs.flatMap((g) => g.hooks.map((h) => ({ event, command: h.command }))));
      expect(entries.length).toBeGreaterThan(10);
      const wrong: string[] = [];
      for (const shell of [DASH, '/bin/sh']) {
        for (const { event, command } of entries) {
          // This process stands for Codex: it starts your login shell, the shell runs the entry.
          const r = spawnSync(shell, ['-c', command], { encoding: 'utf8' });
          const parent = Number(r.stdout.trim());
          if (r.status !== 0 || parent !== process.pid) wrong.push(`${shell}: ${event} \`${command}\` ran under ${parent || r.stderr.trim()}, not ${process.pid}`);
        }
      }
      expect(wrong).toEqual([]);
      expect([...new Set(entries.map((e) => programOf(e.command)))]).toEqual([stub]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('Codex hook entries setup wrote before they exec deep-hook', () => {
  it('give way to the exec entries on the next setup, leaving yours, so each hook runs deep-hook once', () => {
    const hook = "/r/it's/bin/deep-hook";
    const old = (event: string) => `'/r/it'\\''s/bin/deep-hook' codex ${event}`;
    const yours = { type: 'command', command: 'my-hook' };
    const before = JSON.stringify({ hooks: { Stop: [{ hooks: [yours] }, { hooks: [{ type: 'command', command: old('Stop'), timeout: 2700 }] }], SessionStart: [{ hooks: [{ type: 'command', command: old('SessionStart') }, yours] }] } });
    const hooks = JSON.parse(withEntries(before, hook)).hooks as Record<string, { hooks: { command: string }[] }[]>;
    const commands = (event: string) => hooks[event]!.flatMap((g) => g.hooks.map((h) => h.command));
    expect(commands('Stop')).toEqual(['my-hook', `exec ${old('Stop')}`]);
    expect(commands('SessionStart')).toEqual(['my-hook', `exec ${old('SessionStart')}`]);
    expect(withEntries(withEntries(before, hook), hook)).toBe(withEntries(before, hook));
  });
});
