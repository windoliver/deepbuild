// AC5 #19.ff6a4c13 Setup followed by `deep setup --undo` leaves the user's settings byte-for-byte as they were.
//
// Your settings are Claude Code's user files setup writes to: `~/.claude/settings.json` (its hooks and status line)
// and `~/.claude.json` (its user-scope MCP servers), with your own skill folder and launch agent beside them. Each is
// written by hand, so a setup that takes its entries back out by parsing and writing the JSON again changes bytes
// even where it keeps every value. A person who had none of these files gets none back.
// The undo runs with the OS confirmation stubbed `confirmed` (README: The OS confirmation).

import { existsSync, readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, deepEntries, installedHub, makeHome, onMac, readSettings, settingsFile, setup, shown, undo, userConfig } from './helpers.ts';
import { setupThenUndo } from './scenarios.ts';

afterAll(cleanup, 60_000);

const PLANT = 'undo-reserializes';

describe('AC5 #19.ff6a4c13 Setup followed by `deep setup --undo` leaves the user\'s settings byte-for-byte as they were', () => {
  it('AC5 #19.ff6a4c13 your hand-written ~/.claude/settings.json and ~/.claude.json, your skill and your launch agent are byte-for-byte as they were after deep setup and a confirmed deep setup --undo', async () => {
    await setupThenUndo();
  }, 600_000);

  it('AC5 #19.ff6a4c13 a person with no Claude Code settings files before setup has none after the undo', async () => {
    onMac();
    const { home } = makeHome();
    await setup(home);
    await installedHub(home);
    expect(deepEntries(readSettings(home)).length, `deep setup must write DeepBuild's entries into ${settingsFile(home)} (the control)`).toBeGreaterThan(0);
    const undone = await undo(home);
    expect(undone.code, `AC5 deep setup --undo, confirmed, must exit 0: ${shown(undone)}`).toBe(0);
    for (const path of [settingsFile(home), userConfig(home)]) {
      expect(existsSync(path), `AC5 ${path} didn't exist before setup, so after deep setup --undo it must not exist either: ${existsSync(path) ? readFileSync(path, 'utf8').slice(0, 600) : ''}`).toBe(false);
    }
  }, 600_000);

  it(`AC5 #19.ff6a4c13 (wrong program) an undo that takes DeepBuild's entries out and writes the JSON again (${PLANT}) fails this test, naming the file`, async () => {
    let failure = '';
    try { await setupThenUndo({ DEEP_HUB_PLANT: PLANT }); } catch (error) { failure = (error as Error).message; }
    expect(failure, `the byte-for-byte check must fail on ${PLANT}`).toMatch(/^AC5 deep setup --undo must leave \S*\/\.claude\/settings\.json byte-for-byte as it was before setup: /);
  }, 600_000);
});
