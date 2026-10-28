// AC16 #19.26a372c6, the contract half: every `deep` command's outcomes map through the one exit-code enum
// (exit.code@1), and a command whose outcome the enum doesn't map fails this test, naming the command.
//
// "Every command" is every form `deep --help` lists, with the commands the issue names added (README: AC16, The
// contract test). Each runs as a child process in a fresh home of its own with the hub down and no database:
//   - with an unknown flag after it: a usage error, so it must exit 2, call no agent or system tool and write nothing;
//   - in its listed form, placeholders filled with values that name nothing (an ask no one raised, a missing folder):
//     whatever it decides, it must end within 60 s with an exit code exit.code@1 lists, by no signal, and with no
//     uncaught JavaScript error on stderr, since a crash is an outcome no table maps.
// `deep hub run` is a server that runs until it is stopped, so only its usage error is run here.

import { afterAll, describe, expect, it } from 'vitest';
import { calls, cleanup, deep, exitEnum, makeHome, shown, tree, type Ran } from './helpers.ts';

afterAll(cleanup, 60_000);

/** The commands the issue names, which every listing must include. */
const NAMED = ['status', 'doctor', 'setup', 'off', 'on', 'debug bundle', 'hub start', 'hub stop', 'hub use', 'hub status', 'inbox'];
/** Commands that serve until stopped: only their usage error runs. */
const SERVERS = new Set(['hub run']);
const FILL: [RegExp, (tmp: string) => string][] = [
  [/^<ask>$/, () => 'ask:01JZZZZZZZZZZZZZZZZZZZZZZZ'],
  [/^<option>$/, () => 'decline'],
  [/file>$/, (tmp) => `${tmp}/missing.json`],
  [/^<.*>$/, (tmp) => `${tmp}/missing`],
];

interface Form { command: string; args: (tmp: string) => string[] }
/** The forms `deep --help` lists: each `deep <words>` line, alternatives `a | b` expanded, `[...]` dropped, `<...>` filled. */
function forms(help: string): Form[] {
  const out: Form[] = [];
  for (const raw of help.split('\n')) {
    const usage = raw.replace(/^\s*Usage:\s*/, '').trim().split(/\s{2,}/)[0]!;
    if (!usage.startsWith('deep ')) continue;
    const tokens = usage.slice(5).replace(/\[[^\]]*\]/g, ' ').replace(/<[^>]*>/g, (m) => m.replace(/\s+/g, '_')).trim().split(/\s+/).filter(Boolean);
    const words: string[] = [];
    let i = 0;
    while (i < tokens.length && /^[a-z][a-z-]*$/.test(tokens[i]!)) words.push(tokens[i++]!);
    if (!words.length) continue;
    // A command is one word or two; more lowercase words, or a word that isn't one, start its description.
    const next = tokens[i];
    if (words.length > 2 || (next !== undefined && !/^(\||<|-)/.test(next))) { words.splice(1); i = tokens.length; }
    const alternatives = [words[words.length - 1]!];
    while (tokens[i] === '|' && /^[a-z][a-z-]*$/.test(tokens[i + 1] ?? '')) { alternatives.push(tokens[i + 1]!); i += 2; }
    const rest = tokens.slice(i);
    for (const last of alternatives) {
      const command = [...words.slice(0, -1), last].join(' ');
      out.push({ command, args: (tmp) => [...command.split(' '), ...rest.map((t) => FILL.find(([re]) => re.test(t))?.[1](tmp) ?? t)] });
    }
  }
  return out;
}
const crashed = (r: Ran) => /^\s+at .+:\d+:\d+\)?$/m.test(r.stderr) || /node:internal|Uncaught|UnhandledPromiseRejection/.test(r.stderr);

/** Runs the contract; returns one line per command that breaks it, each naming the command. */
async function contract(env: Record<string, string | undefined> = {}): Promise<string[]> {
  const table = exitEnum();
  const help = await deep(makeHome(), ['--help'], { env });
  const listed = forms(help.stdout);
  const all = new Map<string, Form>(listed.map((f) => [f.command, f]));
  for (const command of NAMED) if (!all.has(command)) all.set(command, { command, args: () => command.split(' ') });
  const broken: string[] = [];
  const check = async (form: Form) => {
    // The usage error: nothing runs.
    const h = makeHome();
    const before = tree(h.tmp);
    const usage = await deep(h, [...form.command.split(' '), '--dh19-no-such-flag'], { env, timeoutMs: 60_000 });
    if (usage.code !== 2) broken.push(`deep ${form.command} --dh19-no-such-flag must be a usage error, exit 2, not ${shown(usage)}`);
    const wrote = [...tree(h.tmp)].filter(([p, v]) => before.get(p) !== v).map(([p]) => p);
    if (wrote.length || calls(h.bin).length) broken.push(`deep ${form.command} --dh19-no-such-flag ran something although it was a usage error: wrote ${JSON.stringify(wrote)}, called ${JSON.stringify(calls(h.bin))}`);
    if (SERVERS.has(form.command)) return;
    // Its outcome, whatever it is, through the one table.
    const g = makeHome();
    const r = await deep(g, form.args(g.tmp), { env, timeoutMs: 60_000 });
    if (r.timedOut || r.signal || r.code === null || !table.includes(r.code)) broken.push(`deep ${form.command} ended with an outcome exit.code@1 doesn't map (${table.join(', ')}): ${shown(r)}`);
    else if (crashed(r)) broken.push(`deep ${form.command} crashed, an outcome exit.code@1 doesn't map, and exited ${r.code}: ${shown(r)}`);
  };
  const queue = [...all.values()];
  await Promise.all(Array.from({ length: 4 }, async () => { for (let f = queue.shift(); f; f = queue.shift()) await check(f); }));
  return broken;
}

describe('AC16 #19.26a372c6 a contract test that every `deep` command\'s outcomes map through the one exit-code enum, naming a command that doesn\'t', () => {
  it('AC16 #19.26a372c6 every command deep --help lists, and every command the issue names, exits through exit.code@1: 2 for an unknown flag with nothing run, and a listed code for its outcome', async () => {
    const help = await deep(makeHome(), ['--help']);
    expect(forms(help.stdout).map((f) => f.command), `deep --help lists the commands: ${shown(help)}`).toEqual(expect.arrayContaining(['doctor', 'setup']));
    const broken = await contract();
    expect(broken, `AC16 each of these commands has an outcome the one exit-code enum doesn't map:\n${broken.join('\n')}`).toEqual([]);
  }, 900_000);

  it('AC16 #19.26a372c6 (wrong program) a deep status that exits 4 with the hub down (status-exit-unmapped) fails the contract test, naming the command', async () => {
    const broken = await contract({ DEEP_HUB_PLANT: 'status-exit-unmapped' });
    expect(broken.join('\n'), 'the contract test must fail naming deep status').toMatch(/^deep status ended with an outcome exit\.code@1 doesn't map \(0, 1, 2, 3\): exit 4/m);
  }, 900_000);
});
