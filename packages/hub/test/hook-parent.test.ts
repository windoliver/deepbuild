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
