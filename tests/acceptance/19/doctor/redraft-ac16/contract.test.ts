// AC16 #19.26a372c6, the contract half, redrafted blind for #2200's amended rule: every `deep` command's outcomes map
// through the one exit-code enum (exit.code@1), and a command whose outcome the enum doesn't map fails this test,
// naming the command; `deep lease`, which runs a command of yours, passes on that command's exit status.
//
// "Every command" is every form `deep --help` lists, with the commands the issue names added (../README.md: AC16, The
// contract test). Each runs as a child process in a fresh home of its own with the hub down and no database:
//   - with an unknown flag after it: a usage error, so it must exit 2, call no agent or system tool and write nothing;
//   - in its listed form, placeholders filled with values that name nothing (an ask no one raised, a missing folder):
//     whatever it decides, it must end within 60 s with an exit code exit.code@1 lists, by no signal, and with no
//     uncaught JavaScript error on stderr, since a crash is an outcome no table maps.
// `deep hub run` is a server that runs until it is stopped, so only its usage error is run here.
//
// `deep lease [kind...] -- <command>` keeps the usage error above, and in place of its listed form (README: The lease
// rule): a command it runs comes back with that command's status, whatever the table lists; an unknown flag where a
// kind goes is exit 2 and the command never starts; and what it decides without running a command is a listed code.
//
// `forms`, `crashed`, `NAMED`, `SERVERS` and `FILL` are the first draft's (../contract.test.ts), copied unchanged: a
// test file can't be imported without running its tests.

import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CLI, NODE, calls, childEnv, cleanup, deep, exitEnum, makeHome, run, shown, tempDir, tree, type Home, type Ran } from '../helpers.ts';

afterAll(cleanup, 60_000);

/** The commands the issue names, which every listing must include. */
const NAMED = ['status', 'doctor', 'setup', 'off', 'on', 'debug bundle', 'hub start', 'hub stop', 'hub use', 'hub status', 'inbox'];
/** Commands that serve until stopped: only their usage error runs. */
const SERVERS = new Set(['hub run']);
/** The one command that runs a command of yours and passes on its exit status (#2200, the owner's decision). */
const LEASE = 'lease';
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

type Env = Record<string, string | undefined>;
/** How a `deep` is run: the built CLI, or a wrong program standing in for it. */
type Deep = (h: Home, args: readonly string[], o: { env?: Env; timeoutMs?: number }) => Promise<Ran>;

/** The statuses a leased command ends with here: every code exit.code@1 lists, and two it doesn't. */
const STATUSES = [0, 1, 2, 3, 7, 42];
/** A command that leaves `ran` in the file named after it and exits `status`. */
const leased = (marker: string, status: number) => ['/bin/sh', '-c', `printf ran > "$0"; exit ${status}`, marker];
const ranIn = (marker: string) => existsSync(marker) && readFileSync(marker, 'utf8') === 'ran';

/**
 * `deep lease` held to the contract as its rule allows; one line per break, each naming the command.
 * Every run is in a fresh home with the hub down, as the other commands' are, so the command runs with no hub to lease it.
 */
async function leaseContract(runDeep: Deep, env: Env = {}): Promise<string[]> {
  const table = exitEnum();
  const broken: string[] = [];
  const ended = (r: Ran) => !r.timedOut && !r.signal && r.code !== null;
  // A command it runs: its exit status is the command's, and the command did run.
  for (const status of STATUSES) {
    const h = makeHome();
    const marker = join(h.tmp, 'leased-ran');
    const r = await runDeep(h, ['lease', '--', ...leased(marker, status)], { env, timeoutMs: 60_000 });
    const what = `deep lease -- <a command that exits ${status}>`;
    if (!ranIn(marker)) broken.push(`${what} must run its command, which never ran: ${shown(r)}`);
    else if (!ended(r) || r.code !== status) broken.push(`${what} must exit with its command's status, ${status}, not ${shown(r)}`);
    else if (crashed(r)) broken.push(`${what} crashed, an outcome exit.code@1 doesn't map, and exited ${r.code}: ${shown(r)}`);
  }
  // A flag it can't read where a kind goes: a usage error, and the command after `--` never starts.
  {
    const h = makeHome();
    const marker = join(h.tmp, 'leased-ran');
    const before = tree(h.tmp);
    const r = await runDeep(h, ['lease', '--dh19-no-such-flag', '--', ...leased(marker, 0)], { env, timeoutMs: 60_000 });
    const what = 'deep lease --dh19-no-such-flag -- <a command>';
    if (r.code !== 2) broken.push(`${what} must be a usage error, exit 2, not ${shown(r)}`);
    const wrote = [...tree(h.tmp)].filter(([p, v]) => before.get(p) !== v).map(([p]) => p);
    if (ranIn(marker) || wrote.length || calls(h.bin).length) broken.push(`${what} ran something although it was a usage error: its command ${ranIn(marker) ? 'ran' : 'did not run'}, wrote ${JSON.stringify(wrote)}, called ${JSON.stringify(calls(h.bin))}`);
  }
  // What it decides without running a command is its own outcome, so it maps through the one table.
  for (const args of [['lease'], ['lease', '--'], ['lease', 'browser']]) {
    const r = await runDeep(makeHome(), args, { env, timeoutMs: 60_000 });
    const what = `deep ${args.join(' ')}`;
    if (!ended(r) || !table.includes(r.code!)) broken.push(`${what}, which runs no command, ended with an outcome exit.code@1 doesn't map (${table.join(', ')}): ${shown(r)}`);
    else if (crashed(r)) broken.push(`${what} crashed, an outcome exit.code@1 doesn't map, and exited ${r.code}: ${shown(r)}`);
  }
  // Its listed form with a command that names nothing: no status is the command's to pass on, and neither the issue
  // nor the design says which code that is, so only the end is held: within 60 s, by no signal, with no crash.
  {
    const h = makeHome();
    const r = await runDeep(h, ['lease', '--', `${h.tmp}/missing`], { env, timeoutMs: 60_000 });
    const what = 'deep lease -- <a command that doesn\'t exist>';
    if (!ended(r)) broken.push(`${what} must end within 60 s, by no signal: ${shown(r)}`);
    else if (crashed(r)) broken.push(`${what} crashed, an outcome exit.code@1 doesn't map, and exited ${r.code}: ${shown(r)}`);
  }
  return broken;
}

/** Runs the contract; returns one line per command that breaks it, each naming the command. */
async function contract(env: Env = {}): Promise<string[]> {
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
    // The command that runs a command of yours: that command's status is its own to pass on.
    if (form.command === LEASE) { broken.push(...await leaseContract(deep, env)); return; }
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

/**
 * A wrong `deep` for the lease rule, laid over the built CLI: it runs the CLI as given and folds every exit status the
 * table doesn't list into 1, as a `deep lease` that mapped its command's outcome through the table would.
 */
function foldingDeep(): Deep {
  const file = join(tempDir(), 'deep-folds-status');
  writeFileSync(file, `#!/bin/sh\n'${NODE}' '${CLI}' "$@"\ns=$?\n[ "$s" -gt 3 ] && exit 1\nexit "$s"\n`);
  chmodSync(file, 0o755);
  return (h, args, o) => run(file, args, { env: childEnv(h, o.env), cwd: h.work, timeoutMs: o.timeoutMs ?? 180_000 });
}

describe('AC16 #19.26a372c6 a contract test that every `deep` command\'s outcomes map through the one exit-code enum, naming a command that doesn\'t', () => {
  it('AC16 #19.26a372c6 every command deep --help lists, and every command the issue names, exits through exit.code@1: 2 for an unknown flag with nothing run, and a listed code for its outcome; deep lease exits with the status of the command it ran', async () => {
    const help = await deep(makeHome(), ['--help']);
    const listed = forms(help.stdout).map((f) => f.command);
    expect(listed, `deep --help lists the commands: ${shown(help)}`).toEqual(expect.arrayContaining(['doctor', 'setup']));
    // The lease rule is read only for the command the help lists as `deep lease`; were it gone, no command would be let off the table.
    expect(listed, `deep --help lists deep lease, the one command that passes on its command's status: ${shown(help)}`).toContain(LEASE);
    const broken = await contract();
    expect(broken, `AC16 each of these commands has an outcome the one exit-code enum doesn't map:\n${broken.join('\n')}`).toEqual([]);
  }, 900_000);

  it('AC16 #19.26a372c6 (wrong program) a deep status that exits 4 with the hub down (status-exit-unmapped) fails the contract test, naming the command', async () => {
    const broken = await contract({ DEEP_HUB_PLANT: 'status-exit-unmapped' });
    expect(broken.join('\n'), 'the contract test must fail naming deep status').toMatch(/^deep status ended with an outcome exit\.code@1 doesn't map \(0, 1, 2, 3\): exit 4/m);
  }, 900_000);

  it('AC16 #19.26a372c6 (wrong program) a deep lease that folds its command\'s status into the table (7 and 42 become 1) fails the contract test, naming the command, and the built deep lease, run the same way, does not', async () => {
    // The control first: the built CLI through the same runner shape, so a line below is the wrong program's alone.
    const real: Deep = (h, args, o) => run(NODE, [CLI, ...args], { env: childEnv(h, o.env), cwd: h.work, timeoutMs: o.timeoutMs ?? 180_000 });
    const control = await leaseContract(real);
    expect(control, `AC16 deep lease must pass on its command's exit status and keep its own outcomes on the table:\n${control.join('\n')}`).toEqual([]);
    const broken = await leaseContract(foldingDeep());
    const text = broken.join('\n');
    expect(text, 'the contract test must fail naming deep lease for the status 7 it folded').toMatch(/^deep lease -- <a command that exits 7> must exit with its command's status, 7, not exit 1\b/m);
    expect(text, 'the contract test must fail naming deep lease for the status 42 it folded').toMatch(/^deep lease -- <a command that exits 42> must exit with its command's status, 42, not exit 1\b/m);
    expect(broken.length, `only the two statuses the table doesn't list are folded:\n${text}`).toBe(2);
  }, 300_000);
});
