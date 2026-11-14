// The OS confirms you only for what can happen (AGENTS.md, invariant 4: a person sees only what needs a person, and
// never the same question twice). `deep library on | off | rule` and `deep pack rule` naming a library or a pack the
// hub doesn't hold are refused before the prompt, as an answer to an ask nobody raised is. Before, each asked you
// first; `off` then said it turned the library off, and the unknown pack's refusal read as not decided and
// retryable, so a retry asked you again.
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { deep, withHub } from './hub.js';

it('a library or a pack the hub does not hold is refused, naming it, before the OS is asked to confirm you, and a library left on is still turned off', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'deep-confirm-'));
  const asked = join(dir, 'asked');
  // The prompt's stand-in (confirm.ts): it notes what it was asked to confirm, and confirms.
  writeFileSync(join(dir, 'prompt'), `#!/bin/sh\nprintf '%s\\n' "$1" >> '${asked}'\n`);
  chmodSync(join(dir, 'prompt'), 0o755);
  try {
    await withHub(async (root, home, hub) => {
      const wrong: string[] = [];
      for (const [args, named] of [
        [['library', 'on', 'ext.none.library'], 'ext.none.library'],
        [['library', 'rule', 'ext.none.library', 'CC0-1.0'], 'ext.none.library'],
        [['library', 'off', 'ext.none.library'], 'ext.none.library'],
        [['pack', 'rule', 'none/pack', 'CC0-1.0'], 'none/pack'],
      ] as const) {
        const ran = await deep(home, home, args);
        const prompts = existsSync(asked) ? readFileSync(asked, 'utf8').trim() : '';
        rmSync(asked, { force: true });
        if (ran.code !== 2 || ran.stdout || !ran.stderr.includes(named) || prompts) wrong.push(`deep ${args.join(' ')}: exit ${ran.code}, stdout ${JSON.stringify(ran.stdout)}, stderr ${JSON.stringify(ran.stderr)}, the OS was asked to confirm ${JSON.stringify(prompts)}`);
      }
      expect(wrong).toEqual([]);
      // A library a package that no longer loads left on, as the hub's own saved state holds it, is still yours to turn off.
      await hub.restart({ DEEP_HUB_TEST_CONFIRM: join(dir, 'prompt') }, () => writeFileSync(join(root, 'libraries.json'), JSON.stringify({ on: ['ext.gone.library'], rules: {}, assets: {} })));
      const off = await deep(home, home, ['library', 'off', 'ext.gone.library']);
      expect({ code: off.code, stdout: off.stdout, asked: existsSync(asked) ? readFileSync(asked, 'utf8') : '' }, off.stderr).toEqual({ code: 0, stdout: 'Turned ext.gone.library off.\n', asked: 'turn ext.gone.library off\n' });
    }, { DEEP_HUB_TEST_CONFIRM: join(dir, 'prompt') });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 120_000);
