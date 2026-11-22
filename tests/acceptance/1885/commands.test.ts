// #1885's first two criteria: `deep inbox`, `deep undo` and `deep memory` (the built CLI, packages/cli/dist/main.js)
// against real hubs (`deep hub run`), each in a temp HOME of its own.
//
// AC1: the config's `hub.address` names the socket of a hub run with `--root` in another folder (the dev hub). The
// installed hub at ~/.deepbuild ran once, so its control.token is there, and was stopped, so nothing answers at its
// socket: an answer can only come from the dev hub. Before any command, a precondition checks the situation the issue
// names: the dev hub refuses a cli hello that presents the installed root's token with the `credential` refusal, and
// takes one that presents its own (else BLOCKED). Each command then has to be answered by the dev hub: what that
// command prints for an answer from a hub's method, never the door's refusal nor the "isn't answering" sentence.
// AC2: no config file at all, the installed hub running: each command is answered by it as before.
// README, Readings, says why each command's subcommand and check were chosen. No token value is printed or kept.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  cleanup, Conn, deep, installedRoot, makeHome, setAddress, startHub, stopHub, tempDir, tokenOf, ulid, type Hub, type Ran,
} from '../16/helpers.ts';

afterAll(cleanup, 60_000);

const AC1 = '#1885.a4029057';
const AC2 = '#1885.44a33ba0';
const TIMEOUT = 180_000;

/** What a run printed, for a failure message (no token is ever in it: the CLI never prints one). */
const shown = (r: Ran): string => `exit ${r.code}${r.signal ? ` (signal ${r.signal})` : ''}\nstdout: ${JSON.stringify(r.stdout)}\nstderr: ${JSON.stringify(r.stderr)}`;
const lastLine = (text: string): string => text.trim().split('\n').at(-1) ?? '';

/** The code a hub's socket answers a cli hello presenting `token` with: its refusal's code, or `role:<role>` once taken. */
async function helloWith(socket: string, token: string): Promise<string> {
  const conn = await Conn.open(socket);
  try {
    conn.send({ v: 1, hello: 'cli', token });
    const reply = await conn.next();
    if (!reply) return 'no reply';
    if (reply.error && typeof reply.error.code === 'string') return reply.error.code as string;
    if (typeof reply.role === 'string') return `role:${reply.role}`;
    return `unexpected: ${Object.keys(reply).join(',')}`;
  } finally {
    conn.close();
  }
}

/** Sets up once per file; a test that needs it fails with whatever failed here. */
function once<T>(make: () => Promise<T>): () => Promise<T> {
  let made: Promise<T> | undefined;
  return () => (made ??= make());
}

interface DevWorld { home: string; dev: Hub; refused: string }
/** AC1's world: the installed hub ran and stopped (its token left), a dev hub running in another root, hub.address at it. */
const devWorld = once(async (): Promise<DevWorld> => {
  const home = makeHome();
  const installed = await startHub({ home });
  await stopHub(installed);
  const installedToken = join(installedRoot(home), 'control.token');
  if (!existsSync(installedToken)) throw Error(`BLOCKED: the installed hub left no control.token in ${installedRoot(home)} once stopped`);
  const folder = join(tempDir(), 'dev');
  mkdirSync(folder);
  const dev = await startHub({ home, root: folder });
  if (dev.socket !== join(folder, 'hub.sock')) throw Error(`BLOCKED: the dev hub's socket is ${dev.socket}, not in its root ${folder}`);
  setAddress(home, `unix:${dev.socket}`);
  // The issue's situation, checked on the hubs alone: the installed root's token is refused by the dev hub, its own taken.
  const refused = await helloWith(dev.socket, tokenOf(installedRoot(home)));
  const own = await helloWith(dev.socket, tokenOf(folder));
  if (refused !== 'credential' || own !== 'role:cli') {
    throw Error(`BLOCKED: the dev hub doesn't refuse the installed root's token with the credential refusal and take its own (installed root's token: ${refused}; its own: ${own})`);
  }
  return { home, dev, refused };
});

interface InstalledWorld { home: string; hub: Hub }
/** AC2's world: the installed hub running at ~/.deepbuild, no config file. */
const installedWorld = once(async (): Promise<InstalledWorld> => {
  const home = makeHome();
  const hub = await startHub({ home });
  if (existsSync(join(installedRoot(home), 'config.json'))) throw Error('BLOCKED: the installed hub wrote a config.json; AC2 wants none');
  if (hub.socket !== join(installedRoot(home), 'hub.sock')) throw Error(`BLOCKED: the installed hub's socket is ${hub.socket}, not ${installedRoot(home)}/hub.sock`);
  return { home, hub };
});

const inDev = (w: DevWorld) => `with hub.address at the dev hub (unix:${w.dev.socket}), whose hello refuses the installed root's token with: ${w.refused}`;

describe('AC1: with the config pointing at a hub run with --root in another folder, each command is answered by that hub', () => {
  it(`${AC1} deep inbox is answered by the dev hub`, async () => {
    const w = await devWorld();
    const r = await deep(w.home, ['inbox']);
    const why = `deep inbox ${inDev(w)}:\n${shown(r)}`;
    // An answer from inbox.read: the count line, no "isn't answering" read from a database, exit 0.
    expect(`${r.stdout}${r.stderr}`, why).not.toMatch(/isn't answering/);
    expect(lastLine(r.stdout), why).toBe('Nothing needs you');
    expect(r.code, why).toBe(0);
  }, TIMEOUT);

  it(`${AC1} deep undo is answered by the dev hub`, async () => {
    const w = await devWorld();
    const handle = `staged:${ulid()}`;
    const r = await deep(w.home, ['undo', handle]);
    const why = `deep undo ${handle} ${inDev(w)}:\n${shown(r)}`;
    // An answer from staged.undo: the dev hub's record holds no such staging, which it says naming the handle.
    expect(r.stderr, why).toContain(`No staging ${handle} in the record.`);
    expect(r.code, why).toBe(1);
  }, TIMEOUT);

  it(`${AC1} deep memory is answered by the dev hub`, async () => {
    const w = await devWorld();
    const r = await deep(w.home, ['memory']);
    const why = `deep memory ${inDev(w)}:\n${shown(r)}`;
    // An answer from memory.list: the dev hub's record holds no lesson.
    expect(r.stdout, why).toContain('No lessons to keep or remove.');
    expect(r.code, why).toBe(0);
  }, TIMEOUT);
});

describe('AC2: with no such config, each command reaches the installed hub as before', () => {
  it(`${AC2} deep inbox reaches the installed hub`, async () => {
    const w = await installedWorld();
    const r = await deep(w.home, ['inbox']);
    const why = `deep inbox with no config, the installed hub running:\n${shown(r)}`;
    expect(`${r.stdout}${r.stderr}`, why).not.toMatch(/isn't answering/);
    expect(lastLine(r.stdout), why).toBe('Nothing needs you');
    expect(r.code, why).toBe(0);
  }, TIMEOUT);

  it(`${AC2} deep undo reaches the installed hub`, async () => {
    const w = await installedWorld();
    const handle = `staged:${ulid()}`;
    const r = await deep(w.home, ['undo', handle]);
    const why = `deep undo ${handle} with no config, the installed hub running:\n${shown(r)}`;
    expect(r.stderr, why).toContain(`No staging ${handle} in the record.`);
    expect(r.code, why).toBe(1);
  }, TIMEOUT);

  it(`${AC2} deep memory reaches the installed hub`, async () => {
    const w = await installedWorld();
    const r = await deep(w.home, ['memory']);
    const why = `deep memory with no config, the installed hub running:\n${shown(r)}`;
    expect(r.stdout, why).toContain('No lessons to keep or remove.');
    expect(r.code, why).toBe(0);
  }, TIMEOUT);
});
