// AC11 #39.d4d2fa79 With ~/.codex/hooks.json a symlink into a dotfiles folder, setup writes its entries into the linked
// file through a temporary file beside it, and the link is still the same symlink afterwards; a setup that renames its
// temporary file over the link replaces the link with a plain file and fails this test, naming the path.
//
// "Through a temporary file beside it" is proven by two filesystem conditions, with no watching and no timing:
// - The dotfiles folder is on a disk image of its own, the only writable folder there. A rename into it from anywhere
//   else fails with EXDEV, so a writer that renames can only succeed with its temporary file in that folder. A writer
//   that copies in place isn't stopped here; the next condition stops it.
// - In a second home, the dotfiles folder is read-only and the linked file writable. A temporary file beside the linked
//   file can't be made, so the linked file must keep its bytes; a writer in place, or one falling back to that, changes
//   them. How setup reports that refusal is not this criterion's, so its exit code isn't read in this run.

import { accessSync, chmodSync, constants, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, deepSetup, makeHome, mountDotfiles, prerequisites, restoreAtCleanup, shown, type Home } from './helpers.ts';

afterAll(cleanup, 120_000);
beforeAll(prerequisites, 1_260_000);

const MY_STOP = '/bin/echo my-stop';
const MINE = `{
  "hooks": {
    "Stop": [ { "hooks": [ { "type": "command", "command": "${MY_STOP}" } ] } ]
  }
}
`;
const MY_CONFIG = 'model = "gpt-5"\n';

const isDeepBuild = (command: string) => /deep-hook/.test(command) || /packages\/cli\/dist\/main\.js/.test(command) || /(^|[\s/'"])deep(['"]?)(\s|$)/.test(command);

/** The Stop commands in the file, in order; a file that no longer parses fails naming its path. */
function stopCommands(path: string): string[] {
  const text = readFileSync(path, 'utf8');
  let parsed: { hooks?: { Stop?: { hooks?: { command?: unknown }[] }[] } };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    expect.fail(`AC11 ${path} is no longer JSON: ${text.slice(0, 600)}`);
  }
  return (parsed.hooks?.Stop ?? []).flatMap((group) => group.hooks ?? []).map((hook) => String(hook.command));
}

/** ~/.codex/hooks.json as a relative link to `target`, and your own config.toml beside it. */
function link(h: Home, relativeTarget: string): { path: string; ino: number } {
  const path = join(h.codex, 'hooks.json');
  writeFileSync(join(h.codex, 'config.toml'), MY_CONFIG);
  symlinkSync(relativeTarget, path);
  return { path, ino: lstatSync(path).ino };
}

function sameLink(path: string, relativeTarget: string, ino: number): void {
  const s = lstatSync(path, { throwIfNoEntry: false });
  if (!s) expect.fail(`AC11 ${path} must still be the symlink to ${relativeTarget} after deep setup: it is gone`);
  if (!s.isSymbolicLink()) expect.fail(`AC11 ${path} must still be the symlink to ${relativeTarget} after deep setup: setup replaced the link with a plain file`);
  if (readlinkSync(path) !== relativeTarget) expect.fail(`AC11 ${path} must still be the symlink to ${relativeTarget} after deep setup: it now points to ${readlinkSync(path)}`);
  expect(s.ino, `AC11 ${path} must be the same symlink after deep setup, not a new link made in its place`).toBe(ino);
}

/** Plain files that weren't there before; a folder of Codex's own that setup adds isn't a temporary file. */
const newFiles = (dir: string, before: string[]) => readdirSync(dir).filter((name) => !before.includes(name) && !lstatSync(join(dir, name)).isDirectory());

async function writableFolder(): Promise<void> {
  const h = makeHome();
  const dotfiles = mountDotfiles(h.tmp);
  const target = join(dotfiles, 'hooks.json');
  writeFileSync(target, MINE);

  // The conditions this run rests on, checked rather than assumed.
  const probe = join(h.tmp, 'probe');
  writeFileSync(probe, '');
  let refused = '';
  try { renameSync(probe, join(dotfiles, 'probe')); } catch (error) { refused = (error as NodeJS.ErrnoException).code ?? ''; }
  if (refused !== 'EXDEV') throw Error(`BLOCKED: a rename into ${dotfiles} from another folder must fail with EXDEV, got ${refused || 'success'}`);
  let root = '';
  try { writeFileSync(join(dotfiles, '..', 'probe'), ''); } catch (error) { root = (error as NodeJS.ErrnoException).code ?? ''; }
  if (root !== 'EACCES') throw Error(`BLOCKED: the disk image's root must refuse new files, got ${root || 'success'}`);
  rmSync(probe);

  const relativeTarget = '../../vol/dotfiles/hooks.json';
  const { path, ino } = link(h, relativeTarget);
  const besideLink = readdirSync(h.codex);

  const ran = await deepSetup(h);

  sameLink(path, relativeTarget, ino);
  expect(ran.code, `AC11 deep setup must exit 0 with ${path} linked from a dotfiles folder: ${shown(ran)}`).toBe(0);
  expect(lstatSync(target).isFile(), `AC11 the linked file ${target} must stay a plain file`).toBe(true);
  const commands = stopCommands(target);
  const ours = commands.findIndex(isDeepBuild);
  expect(ours, `AC11 deep setup must write DeepBuild's Stop entry into the linked file ${target}, through ${path}; its Stop commands are ${JSON.stringify(commands)}; ${shown(ran)}`).toBeGreaterThanOrEqual(0);
  expect(commands[0], `AC11 your entry must stay first in the linked file ${target}, DeepBuild's after it: ${JSON.stringify(commands)}`).toBe(MY_STOP);
  expect(newFiles(h.codex, besideLink), `AC11 deep setup must leave no new file beside the link ${path}`).toEqual([]);
  expect(readdirSync(dotfiles), `AC11 deep setup must leave no temporary file beside the linked file ${target}`).toEqual(['hooks.json']);
}

async function readOnlyFolder(): Promise<void> {
  const h = makeHome();
  const dotfiles = join(h.tmp, 'dotfiles');
  mkdirSync(dotfiles);
  const target = join(dotfiles, 'hooks.json');
  writeFileSync(target, MINE);
  chmodSync(dotfiles, 0o555);
  restoreAtCleanup(dotfiles);

  let refused = '';
  try { writeFileSync(join(dotfiles, 'probe'), ''); } catch (error) { refused = (error as NodeJS.ErrnoException).code ?? ''; }
  if (refused !== 'EACCES') throw Error(`BLOCKED: read-only ${dotfiles} must refuse a new file, got ${refused || 'success'}`);
  try { accessSync(target, constants.W_OK); } catch { throw Error(`BLOCKED: ${target} must stay writable in its read-only folder`); }

  const relativeTarget = '../../dotfiles/hooks.json';
  const { path, ino } = link(h, relativeTarget);

  const ran = await deepSetup(h);

  sameLink(path, relativeTarget, ino);
  expect(readFileSync(target, 'utf8'), `AC11 ${target} sits in a read-only folder, where no temporary file can be beside it, so a setup that writes through one can't change it; this one wrote it in place, or through a temporary file elsewhere: ${shown(ran)}`).toBe(MINE);
  expect(readdirSync(dotfiles), `AC11 nothing can be new in read-only ${dotfiles}`).toEqual(['hooks.json']);
}

describe('AC11 #39.d4d2fa79 With ~/.codex/hooks.json a symlink into a dotfiles folder, setup writes its entries into the linked file through a temporary file beside it, and the link is still the same symlink afterwards', () => {
  it('AC11 #39.d4d2fa79 deep setup writes DeepBuild\'s Stop entry after yours into the linked file through a temporary file beside it, and the link stays the same symlink', async () => {
    await writableFolder();
    await readOnlyFolder();
  }, 600_000);
});
