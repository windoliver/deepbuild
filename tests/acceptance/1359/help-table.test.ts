// #1359 AC10 (README): with a hub in the home, `deep backup --help` writes no folder and makes no socket call. A table
// test appends `--help` to every command `deep --help` lists and finds none that writes a file (in the home or the
// working folder) or opens a socket; the plant `dispatches-before-help`, a `deep backup` that hands its arguments on
// before it checks for help, makes that table fail naming it.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SECOND, changeLine, changes, cleanup, deep, fixtureHub, help, listedCommands, needBuild, rootOf, setUp, shown, snapshot, spied, spyEnv,
  stopHubs, tempDir, world, type World,
} from './helpers.ts';

afterAll(cleanup, 60 * SECOND);

const ID = '#1359.2d0aa21a';
/** The planted wrong program (README, The plant): `deep backup` dispatches before it checks for help. */
const PLANT = 'dispatches-before-help';

/** A home set up through `deep setup`, its hub running (started by the login service stand-in). */
let home: World | undefined;
beforeAll(async () => {
  needBuild();
  const w = world();
  const r = await setUp(w);
  if (r.code !== 0) throw Error(`BLOCKED: deep setup didn't set the home up with a hub: ${shown(r)}`);
  home = w;
}, 240 * SECOND);

/**
 * Runs every command `deep --help` lists with `--help` after it, in `w` with the fixture hub at the hub's socket, the
 * socket spy in every Node process, and `extra` in the environment: each command that wrote a file in the home or the
 * working folder, opened a socket or reached the fixture hub, with what it did.
 */
async function table(w: World, extra: Record<string, string> = {}): Promise<{ commands: string[][]; offenders: Map<string, string> }> {
  const commands = listedCommands(await help());
  const offenders = new Map<string, string>();
  const logs = tempDir();
  // A working folder of the table's own, empty, so nothing an earlier test left there changes what a command does.
  const work = join(tempDir(), 'w');
  mkdirSync(work);
  for (const words of commands) {
    const args = [...words, '--help'];
    const name = `deep ${args.join(' ')}`;
    // A fresh fixture hub each time: a command the base runs may take the socket's path for itself.
    const hub = await fixtureHub(join(rootOf(w), 'hub.sock'));
    const log = join(logs, `${args.join('_').replace(/[^\w-]/g, '_')}.log`);
    const beforeHome = snapshot(w.home);
    const beforeWork = snapshot(work);
    const r = await deep(w, args, { cwd: work, extra: { ...spyEnv(log), ...extra }, timeoutMs: 20 * SECOND });
    const [afterHome, afterWork] = [snapshot(w.home), snapshot(work)];
    // Closed only once read: closing the fixture hub removes its socket.
    await hub.close();
    const why = [
      changeLine('wrote in the home', changes(beforeHome, afterHome)),
      changeLine('wrote in the working folder', changes(beforeWork, afterWork)),
      ...spied(log).map((line) => `opened a socket: ${line}`).slice(0, 5),
      hub.connections ? `reached the hub ${hub.connections} time${hub.connections === 1 ? '' : 's'}` : '',
      r.timedOut ? 'was still running after 20 s' : '',
    ].filter(Boolean);
    if (why.length) offenders.set(name, `${name}: ${why.join('; ')}; ${shown(r).slice(0, 400)}`);
  }
  return { commands, offenders };
}

describe(`${ID} help with a hub in the home`, () => {
  it(`${ID} deep backup --help and deep backup -h write no folder and make no socket call`, async () => {
    const w = home!;
    for (const flag of ['--help', '-h']) {
      const log = join(tempDir(), 'spy.log');
      const before = snapshot(w.work);
      const r = await deep(w, ['backup', flag], { extra: spyEnv(log), timeoutMs: 60 * SECOND });
      expect(changeLine(`deep backup ${flag} wrote in the working folder`, changes(before, snapshot(w.work))), shown(r)).toBe('');
      expect(spied(log), `deep backup ${flag} opened a socket: ${shown(r)}`).toEqual([]);
    }
  }, 180 * SECOND);

  it(`${ID} a table of every command deep --help lists, with --help after it, finds none that writes a file or opens a socket`, async () => {
    const w = home!;
    await stopHubs(w);
    const { commands, offenders } = await table(w);
    expect(commands.length, 'deep --help lists its commands').toBeGreaterThan(10);
    expect([...offenders.values()], `${offenders.size} of ${commands.length} commands acted on --help:\n${[...offenders.values()].join('\n')}`).toEqual([]);
  }, 1800 * SECOND);

  it(`${ID} the table fails on the planted ${PLANT}, naming deep backup`, async () => {
    const w = home!;
    await stopHubs(w);
    const { offenders } = await table(w, { DEEP_HUB_PLANT: PLANT });
    expect([...offenders.keys()], `with DEEP_HUB_PLANT=${PLANT}, deep backup checks for help after it dispatches, so the table must name it`).toContain('deep backup --help');
  }, 1800 * SECOND);
});
