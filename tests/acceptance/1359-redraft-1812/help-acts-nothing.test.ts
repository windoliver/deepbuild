// #1359 AC9 (README), a blind redraft after #1812 (REDRAFT.md): `-h`, `--help` or `help` anywhere in a command's
// arguments prints that command's usage, exits 0 and runs nothing first. In a home nobody set up, `deep status --help`
// and `deep inbox -h` leave the home byte-identical (every path, its mode and its bytes).
//
// #1812 changes three things this file held, and nothing else:
// - `help` asks for help only as the first argument after the command, and `deep find help` searches for the word
//   (#1812's Scope and its fourth criterion), so the word asks for help only in `deep help`. `-h` and `--help` stay as
//   they are: they still ask anywhere. Where #1359 put `help` last, after a value, `--help` asks there now; in `install
//   help` and `memory keep help` the word is now a folder and a lesson, and the table's `--help` holds those commands;
//   the word itself is held in `deep help`.
// - A `help` after `status` is status's argument now, and status's arguments then fit none of its forms: deep prints
//   status's usage and exits 2, not understood, nothing ran (#1812's Scope and its exit table), as `deep status x` does.
//   It runs in a home where setup finished, as #1812's suite reaches that rule: what a first-run command does in a home
//   nobody set up before it reads its arguments is outside #1812.
// - `deep --help` ends on the exit table, which names `deep lease` and `deep mcp-exec` in a sentence, so the commands it
//   lists are read from its usage lines only (helpers.ts: listedCommands, #1812's suite's reading).
// This file replaces tests/acceptance/1359/help-acts-nothing.test.ts whole: the tests #1812 doesn't change are carried
// with their names and assertions unchanged, and the frozen suite's helpers are imported unchanged.
import { afterAll, describe, expect, it } from 'vitest';
import { SECOND, calls, changeLine, changes, cleanup, deep, help, needBuild, shown, snapshot, world, type Ran } from '../1359/helpers.ts';
import { finished, listedCommands } from './helpers.ts';

afterAll(cleanup, 60 * SECOND);

const ID = '#1359.f0bb482f';

/** Runs `deep <args>` in a fresh world; what it printed, and what it wrote in the home and the working folder. */
async function inFreshHome(args: string[]): Promise<{ r: Ran; wrote: string; called: string[] }> {
  const w = world();
  const home = snapshot(w.home);
  const work = snapshot(w.work);
  const r = await deep(w, args, { timeoutMs: 60 * SECOND });
  const wrote = [changeLine('the home', changes(home, snapshot(w.home))), changeLine('the working folder', changes(work, snapshot(w.work)))].filter(Boolean).join('; ');
  return { r, wrote, called: calls(w) };
}
/** `stdout` names the command: `deep`, then each of its words. */
const namesCommand = (stdout: string, words: string[]) => /\bdeep\b/.test(stdout) && words.every((word) => new RegExp(`(^|[^\\w-])${word}(?![\\w-])`).test(stdout));

describe(`${ID} help in a home nobody set up`, () => {
  // Carried unchanged: #1812 keeps -h and --help as they are.
  it.each([['status', '--help'], ['inbox', '-h']].map((args) => ({ name: args.join(' '), args })))(`${ID} deep $name leaves the home byte-identical, prints its usage and exits 0`, async ({ args }) => {
    needBuild();
    const { r, wrote, called } = await inFreshHome(args);
    expect(wrote, `deep ${args.join(' ')} wrote in a home nobody set up (${shown(r)})`).toBe('');
    expect(called, `deep ${args.join(' ')} called the login service or a service manager`).toEqual([]);
    expect(r.code, shown(r)).toBe(0);
    expect(namesCommand(r.stdout, [args[0]!]), `deep ${args.join(' ')} must print deep ${args[0]}'s usage: ${shown(r)}`).toBe(true);
  }, 90 * SECOND);

  // Carried unchanged: the cases of #1359's ten that ask with -h or --help, which #1812 keeps as they are, in first,
  // middle and last place, for the commands item 10 names, which set the home up first.
  it.each([
    ['inbox', '-h', 'answer'], ['off', '--help'], ['on', '-h'], ['env', 'up', '--help'], ['guard', 'add', '-h'], ['memory', '--help', '--json'],
  ].map((args) => ({ name: args.join(' '), args })))(`${ID} deep $name runs nothing first, prints its usage and exits 0`, async ({ args }) => {
    needBuild();
    const { r, wrote, called } = await inFreshHome(args);
    expect(wrote, `deep ${args.join(' ')} wrote in a home nobody set up (${shown(r)})`).toBe('');
    expect(called, `deep ${args.join(' ')} called the login service or a service manager`).toEqual([]);
    expect(r.code, shown(r)).toBe(0);
    expect(namesCommand(r.stdout, [args[0]!]), `deep ${args.join(' ')} must print deep ${args[0]}'s usage: ${shown(r)}`).toBe(true);
  }, 90 * SECOND);

  // Redrafted: #1359's `inbox answer a1 help` asks with --help in the same place, last, after a value, since `help` there
  // is now the answer's option; and the word `help` asks in `deep help`, its one place, where the command is deep itself.
  it.each([
    { name: 'inbox answer a1 --help', args: ['inbox', 'answer', 'a1', '--help'], words: ['inbox'] },
    { name: 'help', args: ['help'], words: [] },
  ])(`${ID} deep $name runs nothing first, prints its usage and exits 0 (redraft 1812)`, async ({ args, words }) => {
    needBuild();
    const { r, wrote, called } = await inFreshHome(args);
    expect(wrote, `deep ${args.join(' ')} wrote in a home nobody set up (${shown(r)})`).toBe('');
    expect(called, `deep ${args.join(' ')} called the login service or a service manager`).toEqual([]);
    expect(r.code, shown(r)).toBe(0);
    expect(namesCommand(r.stdout, words), `deep ${args.join(' ')} must print ${['deep', ...words].join(' ')}'s usage: ${shown(r)}`).toBe(true);
  }, 90 * SECOND);

  // Redrafted: the same table, its commands read from the usage lines of deep --help, past the exit table at its foot.
  it(`${ID} every command deep --help lists, with --help after it, runs nothing, prints its usage and exits 0 (redraft 1812)`, async () => {
    needBuild();
    const commands = listedCommands(await help());
    expect(commands.length, 'deep --help lists its commands').toBeGreaterThan(10);
    const wrong: string[] = [];
    for (const words of commands) {
      const args = [...words, '--help'];
      const { r, wrote, called } = await inFreshHome(args);
      const why = [
        wrote,
        called.length ? `called ${called.join('; ')}` : '',
        r.code !== 0 ? `exited ${r.code}${r.timedOut ? ' (killed at the timeout)' : ''}` : '',
        r.code === 0 && !namesCommand(r.stdout, words) ? `printed no usage naming deep ${words.join(' ')}` : '',
      ].filter(Boolean);
      if (why.length) wrong.push(`deep ${args.join(' ')}: ${why.join('; ')}; stderr ${JSON.stringify(r.stderr.slice(0, 300))}`);
    }
    expect(wrong, `${wrong.length} of ${commands.length} commands acted on --help:\n${wrong.join('\n')}`).toEqual([]);
  }, 1800 * SECOND);
});

describe(`${ID} help after a command's name, in a home where setup finished`, () => {
  // Redrafted: #1359's `status help`. The word is status's argument now, which fits none of its forms.
  it(`${ID} deep status help prints status's usage, exits 2 and runs nothing, help being status's argument (redraft 1812)`, async () => {
    needBuild();
    const w = world();
    finished(w);
    const home = snapshot(w.home);
    const work = snapshot(w.work);
    const r = await deep(w, ['status', 'help'], { timeoutMs: 60 * SECOND });
    const wrote = [changeLine('the home', changes(home, snapshot(w.home))), changeLine('the working folder', changes(work, snapshot(w.work)))].filter(Boolean).join('; ');
    expect(wrote, `deep status help wrote in the home or the working folder (${shown(r)})`).toBe('');
    expect(calls(w), 'deep status help called the login service or a service manager').toEqual([]);
    expect(r.code, `deep status help: help is status's argument, which fits none of its forms, so it is not understood and nothing runs, exit 2: ${shown(r)}`).toBe(2);
    const text = `${r.stdout}\n${r.stderr}`;
    expect(text.split('\n').some((line) => /^\s*Usage:.*\bdeep status\b/.test(line)), `deep status help must print status's usage, a line that starts Usage: and names deep status: ${shown(r)}`).toBe(true);
    expect(text, `deep status help is a listed command, and "Unsupported command" is for a word that isn't one: ${shown(r)}`).not.toMatch(/Unsupported command/i);
  }, 90 * SECOND);
});
