// #1359 AC11 (README): an unknown command names the nearest real one, by the canvas's close names' distance (a swap of
// two neighbours is one edit) and reach (a third of the name's length, at least 1); with none in reach it names only
// `deep --help`. Both exit 2.
import { afterAll, describe, expect, it } from 'vitest';
import { SECOND, cleanup, deep, help, listedCommands, needBuild, shown, world } from './helpers.ts';

afterAll(cleanup, 60 * SECOND);

const ID = '#1359.d65a1a38';
const lines = (text: string) => text.split('\n').filter((l) => l.trim());
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe(`${ID} an unknown command names the nearest real one`, () => {
  it(`${ID} deep stauts exits 2 with one stderr line naming deep status`, async () => {
    needBuild();
    const r = await deep(world(), ['stauts'], { timeoutMs: 60 * SECOND });
    expect(r.code, shown(r)).toBe(2);
    expect(lines(r.stderr), `deep stauts must print one stderr line: ${shown(r)}`).toHaveLength(1);
    expect(r.stderr, `deep stauts must name the nearest real command, deep status; the suggestion is missing: ${shown(r)}`).toMatch(/\bdeep status\b/);
  }, 90 * SECOND);

  it(`${ID} deep xyzzy exits 2, names deep --help and no command`, async () => {
    needBuild();
    const commands = [...new Set(listedCommands(await help()).map((words) => words[0]!))];
    expect(commands, 'deep --help lists its commands').toContain('status');
    const r = await deep(world(), ['xyzzy'], { timeoutMs: 60 * SECOND });
    expect(r.code, shown(r)).toBe(2);
    expect(r.stderr, shown(r)).toContain('deep --help');
    const named = commands.filter((c) => new RegExp(`\\bdeep ${escape(c)}(?![\\w-])`).test(`${r.stderr}\n${r.stdout}`));
    expect(named, `deep xyzzy has no command in reach, so it names none: ${shown(r)}`).toEqual([]);
  }, 90 * SECOND);
});
