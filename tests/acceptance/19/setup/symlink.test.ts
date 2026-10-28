// AC20 #19.b955aed6 With `~/.claude/settings.json` a symlink into a dotfiles folder, setup writes its entries into the
// linked file through a temporary file beside it, and the link is still the same symlink afterwards; a setup that
// renames its temporary file over the link replaces the link with a plain file and fails this test, naming the path.
//
// The link is relative, `../../dotfiles/claude/settings.json`, as a dotfiles manager makes it. "Through a temporary
// file" reads as the linked file replaced whole: its inode changes, where a write in place keeps it. "Beside it" reads
// as: no temporary file for the settings appears in ~/.claude (a file named like the settings that exists during
// setup and is gone after it, seen through fs.watch), and none is left in the dotfiles folder.

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, deepEntries, inode, makeHome, onMac, parseObject, runSetup, settingsFile, shown, sleep } from './helpers.ts';

afterAll(cleanup, 60_000);

const PLANT = 'setup-renames-over-link';
const LINK_TARGET = '../../dotfiles/claude/settings.json';
const MINE = `{
  "model": "opus",
  "hooks": {
    "Stop": [ { "hooks": [ { "type": "command", "command": "/bin/echo my-stop" } ] } ]
  }
}
`;

async function linked(env: Record<string, string | undefined> = {}): Promise<void> {
  onMac();
  const { tmp, home } = makeHome();
  const dotfiles = join(tmp, 'dotfiles', 'claude');
  const target = join(dotfiles, 'settings.json');
  const link = settingsFile(home);
  const claudeDir = join(home, '.claude');
  mkdirSync(dotfiles, { recursive: true });
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(target, MINE);
  symlinkSync(LINK_TARGET, link);
  const inodeBefore = inode(target);
  const dotfilesBefore = readdirSync(dotfiles).sort();

  // Every name that comes and goes in ~/.claude while setup runs.
  const seen = new Set<string>();
  const watcher = watch(claudeDir, (_event, name) => { if (name) seen.add(String(name)); });
  const ran = await runSetup(home, { env });
  await sleep(500);
  watcher.close();

  const s = lstatSync(link, { throwIfNoEntry: false });
  if (!s?.isSymbolicLink() || readlinkSync(link) !== LINK_TARGET) {
    expect.fail(`AC20 ${link} must still be the symlink to ${LINK_TARGET} after deep setup: ${s ? (s.isSymbolicLink() ? `it now points to ${readlinkSync(link)}` : 'setup replaced the link with a plain file') : 'it is gone'}`);
  }
  expect(ran.code, `deep setup must exit 0 with your settings linked from a dotfiles folder: ${shown(ran)}`).toBe(0);
  const written = parseObject(readFileSync(target, 'utf8'));
  expect(written && deepEntries(written).length, `AC20 deep setup must write its entries into the linked file, ${target}: ${readFileSync(target, 'utf8').slice(0, 800)}`).toBeGreaterThan(0);
  expect(written!.model, `AC20 deep setup must keep your settings in the linked file`).toBe('opus');
  expect(JSON.stringify(written!.hooks?.Stop), 'AC20 deep setup must keep your Stop hook in the linked file').toContain('/bin/echo my-stop');
  expect(lstatSync(target).isFile(), `AC20 the linked file ${target} must stay a plain file`).toBe(true);
  expect(inode(target), `AC20 deep setup must write ${target} through a temporary file beside it and move that over it, not in place`).not.toBe(inodeBefore);
  const temporary = [...seen].filter((name) => /settings/i.test(name) && name !== 'settings.json' && !existsSync(join(claudeDir, name)));
  expect(temporary, `AC20 deep setup's temporary file must be beside the linked file, in ${dotfiles}, never in ${claudeDir}`).toEqual([]);
  expect(readdirSync(dotfiles).sort(), `AC20 deep setup must leave nothing of its own beside your linked file in ${dotfiles}`).toEqual(dotfilesBefore);
}

describe('AC20 #19.b955aed6 With `~/.claude/settings.json` a symlink into a dotfiles folder, setup writes its entries into the linked file through a temporary file beside it, and the link is still the same symlink afterwards; a setup that renames its temporary file over the link replaces the link with a plain file and fails this test, naming the path', () => {
  it('AC20 #19.b955aed6 deep setup writes its entries into the dotfiles file through a temporary file beside it, and ~/.claude/settings.json is still the same relative symlink', async () => {
    await linked();
  }, 600_000);

  it(`AC20 #19.b955aed6 (wrong program) a setup that renames its temporary file over the link (${PLANT}) fails this test, naming the path`, async () => {
    let failure = '';
    try { await linked({ DEEP_HUB_PLANT: PLANT }); } catch (error) { failure = (error as Error).message; }
    expect(failure, `the symlink check must fail on ${PLANT}`).toMatch(/^AC20 \S*\/\.claude\/settings\.json must still be the symlink to \.\.\/\.\.\/dotfiles\/claude\/settings\.json after deep setup: setup replaced the link with a plain file$/);
  }, 600_000);
});
