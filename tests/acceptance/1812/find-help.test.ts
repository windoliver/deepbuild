// #1812 AC4 (README): `help` asks for help only as the first argument after the command, and `deep find help` searches
// for the word. The home holds a record (a hub ran there, then stopped by PID) and a wiki page whose one claim line
// holds the word "help", so a search for it prints that line's handle. The planted parser, fixtures/help-anywhere.mjs,
// reads `help` anywhere as asking for help, as the merge base does: the same check must fail on it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURES, SECOND, cleanup, deep, hubRun, needBuild, rootOf, shown, stop, world, type Ran, type World } from './helpers.ts';

afterAll(cleanup, 60 * SECOND);

const ID = '#1812.f6999471';
/** The planted line's handle, as `deep find` names a wiki claim line: `wiki:<page>#<id>`. */
const HIT = 'wiki:dh1812#dh1812-help';
/** The planted wrong program (README, The plants). */
const PLANTED = join(FIXTURES, 'help-anywhere.mjs');

/** What keeps a run of `deep find help` from being a search for the word; empty when it is one. */
function searchFailures(r: Ran): string[] {
  return [
    r.code === 0 ? '' : `exits ${r.code}, not 0`,
    r.stdout.includes(HIT) ? '' : `prints no hit: the planted claim line holding "help" is ${HIT}`,
    /^\s*Usage:/m.test(`${r.stdout}\n${r.stderr}`) ? 'prints a usage' : '',
  ].filter(Boolean);
}

let w: World;
beforeAll(async () => {
  needBuild();
  w = world();
  const hub = await hubRun(w);
  await stop([hub.pid]);
  mkdirSync(join(rootOf(w), 'wiki'), { recursive: true });
  writeFileSync(join(rootOf(w), 'wiki', 'dh1812.md'), '# Notes\n\n- Ask for help before you change the schema <!-- deep:claim {"id":"dh1812-help"} -->\n');
  // The planted line is findable by another of its words, so a search that finds it for "help" searched for the word.
  const control = await deep(w, ['find', 'schema'], { timeoutMs: 60 * SECOND });
  if (!control.stdout.includes(HIT)) throw Error(`BLOCKED: deep find schema doesn't find the planted wiki line ${HIT}: ${shown(control)}`);
}, 300 * SECOND);

describe(`${ID} deep find help searches for the word`, () => {
  it(`${ID} deep find help prints the hit for the word, not a usage`, async () => {
    const r = await deep(w, ['find', 'help'], { timeoutMs: 60 * SECOND });
    expect(searchFailures(r), `deep find help must search for the word help: ${shown(r)}`).toEqual([]);
  }, 120 * SECOND);

  it(`${ID} the planted parser that reads help anywhere as asking for help prints usage, and the same check fails on it`, async () => {
    const r = await deep(w, ['find', 'help'], { cli: PLANTED, timeoutMs: 60 * SECOND });
    if (!/^\s*Usage:.*\bdeep find\b/m.test(`${r.stdout}\n${r.stderr}`)) throw Error(`BLOCKED: the planted parser printed no usage of deep find, so it isn't the wrong program it stands for: ${shown(r)}`);
    expect(searchFailures(r), `the planted parser prints find's usage for deep find help, so the check must fail on it: ${shown(r)}`).not.toEqual([]);
  }, 120 * SECOND);
});
