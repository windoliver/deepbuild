// #1296 AC1: a repo whose `.claude/settings.json` (or `.claude/settings.local.json`) sets `statusLine.command` shadows
// DeepBuild's user-level status line forwarder, and `deep doctor` run there warns `claude.statusline_shadowed`, naming
// the file and the key, and exits non-zero. In a repo without one the doctor reports OK. A doctor that reads only your
// user settings (DEEP_HUB_PLANT=statusline-user-settings-only) reports OK in the first repo and fails this test.
//
// The world is #19's all-ok world (../19/doctor/helpers.ts, `world`): setup run, a hub, a session, so `deep doctor
// --prompt` in a clean repo shows every item ok and exits 0. Each fixture repo is a git repo of its own beside it.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, doctor, itemText, itemsShown, notOk, shown, world, type DoctorItem, type World } from '../19/doctor/helpers.ts';
import { AC1 } from './helpers.ts';

afterAll(cleanup, 60_000);

/** The repo's own status line: a command of its own, as a repo that draws its status line sets it. */
const REPO_LINE = { type: 'command', command: 'node .claude/statusline.mjs' };

/** The doctor's item for a shadowed status line: `claude.statusline_shadowed` as its item, or as its code. */
const isShadow = (i: DoctorItem): boolean => i.item === 'claude.statusline_shadowed' || i.code === 'statusline_shadowed' || i.code === 'claude.statusline_shadowed';

let made: Promise<World> | undefined;
/** One all-ok world for this file. */
const theWorld = (): Promise<World> => (made ??= world());

/** A git repo under the world's temp folder whose `.claude/<file>` sets `statusLine`, or no `.claude` at all. */
function fixtureRepo(w: World, name: string, file?: 'settings.json' | 'settings.local.json'): string {
  const repo = join(w.h.tmp, name);
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  if (file) {
    mkdirSync(join(repo, '.claude'), { recursive: true });
    writeFileSync(join(repo, '.claude', file), `${JSON.stringify({ statusLine: REPO_LINE }, null, 2)}\n`);
    writeFileSync(join(repo, '.claude', 'statusline.mjs'), "process.stdout.write('repo line\\n');\n");
  }
  return repo;
}

/** `deep doctor --json --prompt` in `repo` must warn claude.statusline_shadowed naming `.claude/<file>` and statusLine, and exit non-zero. */
async function shadowed(w: World, repo: string, file: 'settings.json' | 'settings.local.json', plant?: string): Promise<void> {
  const path = join(repo, '.claude', file);
  const d = await doctor(w.h, ['--prompt'], { cwd: repo, env: plant ? { DEEP_HUB_PLANT: plant } : undefined });
  const shadows = d.items.filter(isShadow);
  if (!shadows.length) expect.fail(`AC1 deep doctor must warn claude.statusline_shadowed in ${repo}, whose ${path} sets statusLine.command; its items: ${itemsShown(d.items)}\n${shown(d.ran)}`);
  const warned = shadows.filter((i) => i.level === 'warn');
  if (!warned.length) expect.fail(`AC1 claude.statusline_shadowed must be a warning (level warn) in ${repo}: ${itemsShown(shadows)}`);
  const names = warned.filter((i) => (itemText(i).includes(path) || (itemText(i).includes(`.claude/${file}`) && itemText(i).includes(repo))) && itemText(i).includes('statusLine'));
  if (!names.length) expect.fail(`AC1 claude.statusline_shadowed must name the file ${path} and the key statusLine: ${itemsShown(warned)}`);
  if (d.ran.code === 0) expect.fail(`AC1 deep doctor must exit non-zero when ${path} shadows the forwarder: ${shown(d.ran)}`);
}

describe(`${AC1} a repo's statusLine in .claude/settings.json or .claude/settings.local.json: deep doctor warns claude.statusline_shadowed, naming the file and key, and exits non-zero; OK in a repo without one`, () => {
  it(`${AC1} a repo without a status line of its own: no claude.statusline_shadowed above ok, and the status line items read ok`, async () => {
    const w = await theWorld();
    const clean = fixtureRepo(w, 'clean');
    const d = await doctor(w.h, ['--prompt'], { cwd: clean });
    expect(d.items.length, `deep doctor --json lists its items: ${shown(d.ran)}`).toBeGreaterThan(0);
    expect(itemsShown(notOk(d.items.filter(isShadow))), `AC1 no shadowed status line in ${clean}`).toBe('');
    const lines = d.items.filter((i) => /^claude\.statusline/.test(i.item ?? ''));
    expect(lines.length, `deep doctor reports the status line forwarder (claude.statusline): ${itemsShown(d.items)}`).toBeGreaterThan(0);
    expect(itemsShown(notOk(lines)), `AC1 in a repo without a status line of its own the doctor reports the status line OK`).toBe('');
  }, 600_000);

  it(`${AC1} a repo whose .claude/settings.json sets statusLine.command: a warning claude.statusline_shadowed naming the file and statusLine, exit non-zero`, async () => {
    const w = await theWorld();
    await shadowed(w, fixtureRepo(w, 'shared'), 'settings.json');
  }, 600_000);

  it(`${AC1} a repo whose .claude/settings.local.json sets statusLine.command is reported the same way`, async () => {
    const w = await theWorld();
    await shadowed(w, fixtureRepo(w, 'local'), 'settings.local.json');
  }, 600_000);

  it(`${AC1} (wrong program) a doctor that reads only your user settings (statusline-user-settings-only) reports OK in the first repo and fails this test`, async () => {
    const w = await theWorld();
    await expect(shadowed(w, fixtureRepo(w, 'planted'), 'settings.json', 'statusline-user-settings-only')).rejects.toThrow(/AC1 deep doctor must warn claude\.statusline_shadowed in /);
  }, 600_000);
});
