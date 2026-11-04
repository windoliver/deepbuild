// #1033 AC3: `deep doctor` lists the mods a Claude Code home loads, read from each installed plugin's `claude plugin
// validate` output (the stand-in in fixtures/bin prints it), never by loading the mod: three homes, three readings.
// The doctor runs as `deep doctor --json`, HOME the home, the stand-in first on PATH (README, The doctor's readings).
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { tempDir } from '../29/h-d.ts';
import { AC3, APPROVER, BAND, cleanup, doctor, installMods, listed, modItems } from './helpers.ts';

afterAll(cleanup, 60_000);

/** A home under a fresh temp folder with `names` installed in its Claude Code, and the sentinel their code writes. */
function home(names: readonly string[], unreadable?: 'registry' | 'validate'): { home: string; tmp: string; sentinel: string } {
  const tmp = tempDir();
  const h = join(tmp, 'h');
  mkdirSync(join(h, '.claude'), { recursive: true });
  const sentinel = join(tmp, 'mod-was-loaded');
  installMods(h, names, sentinel, unreadable);
  return { home: h, tmp, sentinel };
}
const loaded = (sentinel: string): string => (existsSync(sentinel) ? readFileSync(sentinel, 'utf8').trim() : '');
const validated = (calls: string[][]): boolean => calls.some((c) => c[0] === 'plugin' && c[1] === 'validate');

describe(`${AC3} deep doctor reads each home's mods from claude plugin validate: a warn for a tool.check mod, OK for a band, not checked when unreadable`, () => {
  it(`${AC3} a home with ${APPROVER} installed: a warn naming the mod and tool.check, and the mod's code never loaded`, async () => {
    const h = home([APPROVER]);
    const { items, calls } = await doctor(h.home, h.tmp);
    const mods = modItems(items);
    const warns = mods.filter((i) => i.level === 'warn' && i.evidence.includes(APPROVER) && i.evidence.includes('tool.check'));
    expect(warns.length, `deep doctor must warn about ${APPROVER}, naming it and tool.check, which can approve a call past a PreToolUse deny; its claude.mods items: ${listed(mods)}`).toBeGreaterThan(0);
    expect(mods.filter((i) => i.level === 'ok' && i.evidence.includes(APPROVER)), `no claude.mods item reads ${APPROVER} as OK: ${listed(mods)}`).toEqual([]);
    expect(validated(calls), `the doctor read the mods from claude plugin validate; the stand-in was called with ${JSON.stringify(calls)}`).toBe(true);
    expect(loaded(h.sentinel), "the doctor must never load the mod's code: its sentinel was written").toBe('');
  });

  it(`${AC3} a home with only ${BAND}, a mod that draws a band and handles no tool or prompt event: OK`, async () => {
    const h = home([BAND]);
    const { items, calls } = await doctor(h.home, h.tmp);
    const mods = modItems(items);
    expect(mods.length, `deep doctor must report the home's mods as a claude.mods item; it printed ${items.map((i) => i.item).join(', ')}`).toBeGreaterThan(0);
    expect(mods.map((i) => i.level), `a home whose only mod handles no tool or prompt event reports OK: ${listed(mods)}`).toEqual(mods.map(() => 'ok'));
    expect(validated(calls), `the doctor read the mods from claude plugin validate; the stand-in was called with ${JSON.stringify(calls)}`).toBe(true);
    expect(loaded(h.sentinel), "the doctor must never load the mod's code: its sentinel was written").toBe('');
  });

  it(`${AC3} a home whose plugins it can't read: not checked, never OK, whether the plugin registry or claude plugin validate fails`, async () => {
    for (const how of ['registry', 'validate'] as const) {
      const h = home([APPROVER], how);
      const { items } = await doctor(h.home, h.tmp);
      const mods = modItems(items);
      const what = how === 'registry' ? 'plugins/installed_plugins.json is not JSON' : 'claude plugin validate fails on the installed plugin';
      expect(mods.some((i) => i.code === 'not_checked'), `${what}: deep doctor must report the home's mods as not checked (code not_checked); its claude.mods items: ${listed(mods)}`).toBe(true);
      expect(mods.filter((i) => i.level === 'ok'), `${what}: never OK: ${listed(mods)}`).toEqual([]);
      expect(loaded(h.sentinel), `${what}: the doctor must never load the mod's code`).toBe('');
    }
  });
});
