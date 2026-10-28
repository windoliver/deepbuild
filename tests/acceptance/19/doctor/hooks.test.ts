// AC3 #19.fd97a642 `deep doctor` names the exact fix for a missing hook installation.
//
// DeepBuild is set up, then two of its entries are gone from Claude Code's user settings (you took them out with
// the hub stopped, so its watch can't put them back): its PreToolUse entry and both of its Stop entries. The doctor
// must show the hook installation as missing (`hooks_missing`, a failed item), say which hooks are missing and
// where, and give as its fix the command that puts them back, `deep setup`. Running the command the fix names then
// makes the item go away (README: AC3). The doctor runs with the hub stopped, since the hub's watch puts a removed
// entry back at once (#18); the fix runs with the hub answering, as setup does for you.

import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, deep, deepEntries, doctor, isDeepBuild, itemText, itemsShown, readSettings, settingsFile, shown, startHub, stopHub, world, writeSettings, type DoctorItem } from './helpers.ts';

afterAll(cleanup, 60_000);

const GONE = ['PreToolUse', 'Stop'];
/** The command a fix names: `deep setup`, as written, up to the end of its clause. */
const fixCommand = (fix: string): string | undefined => /`(deep setup[^`]*)`/.exec(fix)?.[1] ?? /\b(deep setup(?: --?[a-z][\w-]*)*)/.exec(fix)?.[1];

describe('AC3 #19.fd97a642 `deep doctor` names the exact fix for a missing hook installation', () => {
  it('AC3 #19.fd97a642 with DeepBuild\'s PreToolUse and Stop entries gone, deep doctor fails hooks_missing naming both hooks and the settings file, its fix is `deep setup`, and running that command clears the item', async () => {
    const w = await world({
      hubDown: true,
      after: (h) => {
        const settings = readSettings(h);
        for (const event of GONE) {
          settings.hooks[event] = (settings.hooks[event] as { hooks: { command: string }[] }[])
            .map((g) => ({ ...g, hooks: g.hooks.filter((x) => !isDeepBuild(x.command)) }))
            .filter((g) => g.hooks.length > 0);
          if (!settings.hooks[event].length) delete settings.hooks[event];
        }
        writeSettings(h, settings);
      },
    });
    expect(deepEntries(readSettings(w.h)).filter((e) => GONE.includes(e.event)), 'the fixture removed DeepBuild\'s PreToolUse and Stop entries').toEqual([]);

    const d = await doctor(w.h);
    const missing = d.items.filter((i) => i.code === 'hooks_missing');
    expect(missing.length, `AC3 deep doctor must show the missing hook installation as a hooks_missing item: ${shown(d.ran)}`).toBeGreaterThan(0);
    const text = missing.map(itemText).join(' ');
    expect(missing.every((i) => i.level === 'fail'), `AC3 a missing hook installation is a failed item: ${itemsShown(missing)}`).toBe(true);
    for (const event of GONE) expect(text, `AC3 the item must name the missing ${event} hook: ${itemsShown(missing)}`).toContain(event);
    expect(text.includes(settingsFile(w.h)) || text.includes('~/.claude/settings.json'), `AC3 the item must name the file the entries belong in, ${settingsFile(w.h)} (or ~/.claude/settings.json): ${itemsShown(missing)}`).toBe(true);
    expect(d.ran.code, `AC3 deep doctor exits 1 with a failed item: ${shown(d.ran)}`).toBe(1);

    const named = missing.map((i: DoctorItem) => fixCommand(i.fix)).find((c) => c !== undefined);
    expect(named, `AC3 the fix must name the command that puts the entries back, deep setup: ${itemsShown(missing)}`).toBeDefined();
    expect(named, 'AC3 the fix is setup, never its undo').not.toMatch(/--undo/);
    const args = named!.trim().split(/\s+/).slice(1);
    // Setup runs with a hub answering, as it does for you (the hub is a login service).
    const hub = await startHub(w.h);
    const fixed = await deep(w.h, args);
    expect(fixed.code, `AC3 the command the fix names, \`${named}\`, must run: ${shown(fixed)}`).toBe(0);
    for (const event of GONE) expect(deepEntries(readSettings(w.h)).some((e) => e.event === event), `AC3 after \`${named}\`, DeepBuild's ${event} entry is back`).toBe(true);
    const again = await doctor(w.h);
    expect(again.items.filter((i) => i.code === 'hooks_missing'), `AC3 after \`${named}\`, no hooks_missing item: ${shown(again.ran)}`).toEqual([]);
    await stopHub(hub);
  }, 600_000);
});
