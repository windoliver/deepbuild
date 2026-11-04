// A Claude Code home's mods (#1033), read the way Claude Code 2.1.308 prints them: `claude plugin list --json`, then
// `claude plugin validate` on each plugin's folder, whose hooks module lines read `❯ ./register.ts hooks: tool.check`.
// The claude here is a stand-in that prints what 2.1.308 printed for the e2e's fixture mods.
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { homeMods } from '../src/mods.js';

let tmp = '';
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

/** A claude whose `plugin list --json` prints `list`, and whose validate prints the folder's validate.txt. */
function claude(list: unknown): string {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'mods-')));
  const bin = join(tmp, 'claude');
  writeFileSync(join(tmp, 'list.json'), JSON.stringify(list));
  writeFileSync(bin, `#!/bin/sh\nif [ "$1 $2" = "plugin list" ]; then cat '${join(tmp, 'list.json')}'; exit 0; fi\nif [ "$1 $2" = "plugin validate" ]; then cat "$3/validate.txt"; exit 0; fi\nexit 1\n`);
  chmodSync(bin, 0o755);
  return bin;
}
/** A plugin folder whose validate prints `notes` under its hooks file, as 2.1.308 lays them out. */
function plugin(name: string, notes: string[]): string {
  const dir = join(tmp, 'plugins', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'validate.txt'), [
    `Validating plugin manifest: ${dir}/.claude-plugin/plugin.json`, '', '✔ Validation passed', '',
    ...(notes.length ? [`Validating hooks: ${dir}/hooks/hooks.json`, '', ...notes.map((n) => `  ❯ ${n}`), ''] : []),
    '✔ Validation passed with warnings',
  ].join('\n'));
  return dir;
}

describe("a home's mods", () => {
  it('reads each hooks module line as Claude Code prints it: tool.check overrides, $.prompt.submit submits, no module handles nothing', async () => {
    const bin = claude([]);
    const approve = plugin('approve-all', ['./register.ts hooks: tool.check', './register.ts gating hook without .catch: tool.check', './register.ts calls: nothing on $']);
    const prompter = plugin('prompter', ['./a.ts hooks: session.start', './a.ts calls: $.ui.status', './b.ts hooks: command.run', './b.ts calls: $.prompt.submit']);
    const skills = plugin('skills-only', []);
    writeFileSync(join(tmp, 'list.json'), JSON.stringify([approve, prompter, skills].map((folder, i) => ({ id: `${['approve-all', 'prompter', 'skills-only'][i]}@m`, enabled: true, installPath: folder }))));
    const read = await homeMods(join(tmp, 'home'), bin, process.env);
    expect(read).toEqual({ home: join(tmp, 'home'), mods: [
      { plugin: 'approve-all@m', name: 'approve-all', hooks: ['tool.check'], calls: [], overrides: true, prompts: false },
      { plugin: 'prompter@m', name: 'prompter', hooks: ['session.start', 'command.run'], calls: ['$.ui.status', '$.prompt.submit'], overrides: false, prompts: true },
      { plugin: 'skills-only@m', name: 'skills-only', hooks: [], calls: [], overrides: false, prompts: false },
    ] });
  });

  it('reads a registry that is not JSON as unread, though claude plugin list prints [] for it', async () => {
    const bin = claude([]);
    const home = join(tmp, 'home');
    mkdirSync(join(home, 'plugins'), { recursive: true });
    writeFileSync(join(home, 'plugins', 'installed_plugins.json'), '{"version": 2, "plugins": {"approve-all@m": [');
    const read = await homeMods(home, bin, process.env);
    expect('unread' in read && read.unread).toMatch(/installed_plugins\.json couldn't be read/);
  });
});
