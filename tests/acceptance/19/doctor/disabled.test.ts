// AC12 #19.5800e7ab A repo whose `.claude/settings.json` sets `disableAllHooks`, and an agent policy that allows
// only managed hooks, each show in `deep doctor` as hooks that won't run there, naming the setting, and
// `deep doctor` exits non-zero.
//
// The repo is the world's working folder, a git repo where a session already started through DeepBuild's hooks;
// you then set `"disableAllHooks": true` in its `.claude/settings.json`, and run `deep doctor` there (README: AC12,
// Which repos). The policy is Claude Code's managed settings with `"allowManagedHooksOnly": true`, read from the
// managed-settings seam (DEEP_HUB_TEST_MANAGED_SETTINGS) instead of the machine's own file. Each must be a failed
// item naming the setting, and the doctor, otherwise all ok with `--prompt`, exits 1.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, doctor, itemText, itemsShown, shown, world } from './helpers.ts';

afterAll(cleanup, 60_000);

/** The repo's own settings turn every hook off: DeepBuild's don't run there. Throws naming the setting when not shown. */
async function repoDisable(plant?: string): Promise<void> {
  const w = await world(plant ? { plant } : {});
  const file = join(w.h.work, '.claude', 'settings.json');
  mkdirSync(join(w.h.work, '.claude'), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ disableAllHooks: true }, null, 2)}\n`);
  const d = await doctor(w.h, ['--prompt'], { cwd: w.h.work });
  const shownIn = d.items.filter((i) => i.level === 'fail' && itemText(i).includes('disableAllHooks') && itemText(i).includes(w.h.work));
  if (!shownIn.length) expect.fail(`AC12 deep doctor must show that hooks won't run in ${w.h.work}, naming disableAllHooks in ${file}, as a failed item: ${shown(d.ran)}`);
  if (d.ran.code !== 1) expect.fail(`AC12 deep doctor must exit non-zero (1) with hooks that won't run in ${w.h.work}: ${shown(d.ran)}\n${itemsShown(shownIn)}`);
}
/** An agent policy that allows only managed hooks: DeepBuild's user-level hooks don't run anywhere. */
async function policyManagedOnly(plant?: string): Promise<void> {
  const w = await world(plant ? { plant } : {});
  writeFileSync(w.h.managed, `${JSON.stringify({ allowManagedHooksOnly: true }, null, 2)}\n`);
  const d = await doctor(w.h, ['--prompt']);
  const shownIn = d.items.filter((i) => i.level === 'fail' && itemText(i).includes('allowManagedHooksOnly'));
  if (!shownIn.length) expect.fail(`AC12 deep doctor must show that DeepBuild's hooks won't run under Claude Code's policy, naming allowManagedHooksOnly, as a failed item: ${shown(d.ran)}`);
  if (d.ran.code !== 1) expect.fail(`AC12 deep doctor must exit non-zero (1) when a policy allows only managed hooks: ${shown(d.ran)}\n${itemsShown(shownIn)}`);
}

describe('AC12 #19.5800e7ab A repo whose `.claude/settings.json` sets `disableAllHooks`, and an agent policy that allows only managed hooks, each show in `deep doctor` as hooks that won\'t run there, naming the setting, and `deep doctor` exits non-zero', () => {
  it('AC12 #19.5800e7ab a repo whose .claude/settings.json sets disableAllHooks shows as a failed item naming disableAllHooks and the repo, and deep doctor exits 1', async () => {
    await repoDisable();
  }, 600_000);

  it('AC12 #19.5800e7ab a managed policy with allowManagedHooksOnly shows as a failed item naming allowManagedHooksOnly, and deep doctor exits 1', async () => {
    await policyManagedOnly();
  }, 600_000);

  it('AC12 #19.5800e7ab (wrong program) a doctor that reads disableAllHooks only in your user settings (hooks-disable-user-only) fails both, naming the setting', async () => {
    await expect(repoDisable('hooks-disable-user-only')).rejects.toThrow(/AC12 deep doctor must show that hooks won't run in \S+, naming disableAllHooks/);
    await expect(policyManagedOnly('hooks-disable-user-only')).rejects.toThrow(/AC12 deep doctor must show that DeepBuild's hooks won't run under Claude Code's policy, naming allowManagedHooksOnly/);
  }, 900_000);
});
