// #1359 AC3 (README): `deep setup` prints its one summary line, and a timing relation's line only when it doesn't hold.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SECOND, cleanup, needBuild, setUp, shown, world } from './helpers.ts';

afterAll(cleanup, 60 * SECOND);

const ID = '#1359.087f7acb';
/**
 * What setup says of itself: stdout's non-empty lines, less the wiki's page lines (`Wiki: <page>`, one for each page the
 * wiki build changed, #356), which say what the hub wrote, not what setup did.
 */
const lines = (text: string) => text.split('\n').filter((l) => l.trim() && !l.startsWith('Wiki: '));

describe(`${ID} what deep setup prints`, () => {
  it(`${ID} in a home nobody set up, its one summary line and no line for a timing relation that holds`, async () => {
    needBuild();
    const r = await setUp(world());
    expect(r.code, shown(r)).toBe(0);
    expect(lines(r.stdout), `deep setup must print its one summary line, and nothing for relations that hold: ${shown(r)}`).toHaveLength(1);
  }, 300 * SECOND);

  it(`${ID} a line for the timing relation that doesn't hold, beside the summary`, async () => {
    needBuild();
    const w = world();
    // Your own settings: Claude Code's MCP tool timeout at 5 s, shorter than deep_ask's wait, so deep_ask's relation
    // doesn't hold (#25's relations); every other relation setup writes holds.
    mkdirSync(join(w.home, '.claude'));
    writeFileSync(join(w.home, '.claude', 'settings.json'), '{\n  "env": { "MCP_TOOL_TIMEOUT": "5000" }\n}\n');
    const r = await setUp(w);
    expect(r.code, shown(r)).toBe(0);
    const out = lines(r.stdout);
    expect(out, `deep setup must print its summary and one line for deep_ask's relation, which doesn't hold: ${shown(r)}`).toHaveLength(2);
    expect(out.filter((l) => l.includes('deep_ask')), `one line names deep_ask's relation: ${shown(r)}`).toHaveLength(1);
  }, 300 * SECOND);
});
