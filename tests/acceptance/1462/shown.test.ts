// AC20: the pictures a person judges. The check run takes the View and Session menus and ⌘K with a key shown from the
// real app at the reference window, each state read off the accessibility tree before its picture is taken, and writes
// them with run.json (the app binary's SHA-256) to $DA1462_SCREENS. "Attached to the PR and shown to you in the session"
// no test can see: the implementing agent does it. Whether they look right is one taste call, recorded in TASTE.json;
// without one on exactly these files the run is INCONCLUSIVE, never PASS. No criterion above reads a picture to judge it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { App, appBinary, blocked, ID, inconclusive, label, MIN, realWorld, run, sha256, SUITE, t26, useCleanup } from './helpers.ts';

useCleanup();
interface Taste { verdict?: string | null; who?: string | null; when?: string | null; files?: Record<string, string>; note?: string }
const sorted = (files: Record<string, string>): string => JSON.stringify(Object.fromEntries(Object.entries(files).sort()));

describe(`AC20 ${ID.shown} Shown to you: the View and Session menus and ⌘K with a key shown, from the real app, one taste call`, () => {
  it('AC20 the three pictures are taken from the real app, each state checked first, and judged only by the recorded taste call', async () => {
    const dir = process.env.DA1462_SCREENS ?? t26.tempDir();
    mkdirSync(dir, { recursive: true });
    const real = await realWorld([{ title: 'Cart totals' }, { title: 'Release notes' }]);
    const bin = await appBinary();
    const app = await App.launch(real.world.home, bin);
    const files: Record<string, string> = {};
    const failures: string[] = [];
    try {
      // A row selected, so the Session menu is that row's.
      await app.pressId(`session:${real.sessions[1]!.id}`);
      for (const menu of ['View', 'Session']) {
        const opened = await app.openMenu(menu);
        if (!opened.found || !opened.items?.length || !opened.frame?.length) {
          failures.push(`the menu bar has no ${menu} menu with items to picture: ${JSON.stringify(opened).slice(0, 300)}`);
          await app.cancelMenus();
          continue;
        }
        const [x, y, w, h] = opened.frame;
        const name = `${menu.toLowerCase()}-menu.png`;
        const shot = await run('/usr/sbin/screencapture', ['-x', `-R${x},${y},${w},${h}`, join(dir, name)]);
        await app.cancelMenus();
        if (shot.code !== 0 || !existsSync(join(dir, name))) blocked(`screencapture of the ${menu} menu failed: ${shot.stderr.slice(-300)}`);
        files[name] = sha256(readFileSync(join(dir, name)));
      }
      await app.key('cmd-k');
      await app.type('Next ask');
      const hit = (await app.nodes()).find((n) => label(n) === 'Next ask' && !!n.value);
      if (!hit) failures.push('⌘K shows no "Next ask" with its key beside it to picture');
      else {
        await app.capture(join(dir, 'command-k.png'));
        files['command-k.png'] = sha256(readFileSync(join(dir, 'command-k.png')));
      }
      await app.key('escape');
    } finally {
      await app.stop();
    }
    expect(failures, 'each state is right before its picture is taken').toEqual([]);
    writeFileSync(join(dir, 'run.json'), `${JSON.stringify({ app_sha256: sha256(readFileSync(bin)) }, null, 2)}\n`);
    files['run.json'] = sha256(readFileSync(join(dir, 'run.json')));
    const taste = JSON.parse(readFileSync(join(SUITE, 'TASTE.json'), 'utf8')) as Taste;
    if (!taste.verdict) inconclusive(`no taste call is recorded in TASTE.json for the pictures in ${dir}`);
    if (sorted(taste.files ?? {}) !== sorted(files)) inconclusive(`TASTE.json's call is on other pictures than this run's: it names ${sorted(taste.files ?? {})}, this run wrote ${sorted(files)}`);
    expect(taste.verdict, `the recorded taste call says they look wrong: ${taste.note ?? ''}`).toBe('looks_right');
  }, 30 * MIN);
});
