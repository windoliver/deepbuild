// #1359 AC9 (README): `-h`, `--help` or `help` anywhere in a command's arguments prints that command's usage, exits 0
// and runs nothing first. In a home nobody set up, `deep status --help` and `deep inbox -h` leave the home
// byte-identical (every path, its mode and its bytes); on the merge base setup runs, and the test fails naming the
// first file written.
import { afterAll, describe, expect, it } from 'vitest';
import { SECOND, calls, changeLine, changes, cleanup, deep, help, listedCommands, needBuild, shown, snapshot, world, type Ran } from './helpers.ts';

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
  it.each([['status', '--help'], ['inbox', '-h']].map((args) => ({ name: args.join(' '), args })))(`${ID} deep $name leaves the home byte-identical, prints its usage and exits 0`, async ({ args }) => {
    needBuild();
    const { r, wrote, called } = await inFreshHome(args);
    expect(wrote, `deep ${args.join(' ')} wrote in a home nobody set up (${shown(r)})`).toBe('');
    expect(called, `deep ${args.join(' ')} called the login service or a service manager`).toEqual([]);
    expect(r.code, shown(r)).toBe(0);
    expect(namesCommand(r.stdout, [args[0]!]), `deep ${args.join(' ')} must print deep ${args[0]}'s usage: ${shown(r)}`).toBe(true);
  }, 90 * SECOND);

  // Anywhere in the arguments, each of the three words, for the commands item 10 names, which set the home up first.
  it.each([
    ['status', 'help'], ['inbox', '-h', 'answer'], ['inbox', 'answer', 'a1', 'help'], ['off', '--help'], ['on', '-h'],
    ['env', 'up', '--help'], ['install', 'help'], ['guard', 'add', '-h'], ['memory', '--help', '--json'], ['memory', 'keep', 'help'],
  ].map((args) => ({ name: args.join(' '), args })))(`${ID} deep $name runs nothing first, prints its usage and exits 0`, async ({ args }) => {
    needBuild();
    const { r, wrote, called } = await inFreshHome(args);
    expect(wrote, `deep ${args.join(' ')} wrote in a home nobody set up (${shown(r)})`).toBe('');
    expect(called, `deep ${args.join(' ')} called the login service or a service manager`).toEqual([]);
    expect(r.code, shown(r)).toBe(0);
    expect(namesCommand(r.stdout, [args[0]!]), `deep ${args.join(' ')} must print deep ${args[0]}'s usage: ${shown(r)}`).toBe(true);
  }, 90 * SECOND);

  it(`${ID} every command deep --help lists, with --help after it, runs nothing, prints its usage and exits 0`, async () => {
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
