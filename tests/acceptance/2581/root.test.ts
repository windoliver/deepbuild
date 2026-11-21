// #2581, criterion 1: a flag isn't a root. `deep hub start|status|stop|use|run --root <folder>` takes a folder; a flag
// where it goes is a usage error, exit 2. Each command runs once, as a child process of the built CLI, in an empty
// working folder of its own with a fresh home (README: The place). On the base `--typo` is read as the folder: start
// writes a dev hub's files into `--typo/` and exits 3 (or 0 if that hub comes up), status, stop and use exit 3, and run
// starts a hub there.

import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, freshPlace, outcome, served, shown, TEST_MS } from './helpers.ts';

afterAll(cleanup, 60_000);

describe('#2581.df46b19b a flag isn\'t a root', () => {
  it('#2581.df46b19b deep hub start --root --typo in an empty working folder exits 2 and writes nothing', async () => {
    const { ran, exit, written } = await outcome(freshPlace(), ['hub', 'start', '--root', '--typo']);
    expect({ exit, written }, `deep hub start --root --typo has a flag where the folder goes, so it must exit 2 and write nothing: ${shown(ran)}`).toEqual({ exit: 2, written: [] });
  }, TEST_MS);

  it.each(['status', 'stop', 'use'])('#2581.df46b19b deep hub %s --root --typo exits 2', async (command) => {
    const { ran, exit } = await outcome(freshPlace(), ['hub', command, '--root', '--typo']);
    expect(exit, `deep hub ${command} --root --typo has a flag where the folder goes, so it must exit 2: ${shown(ran)}`).toBe(2);
  }, TEST_MS);

  it('#2581.df46b19b deep hub run --root --typo exits 2 and starts no server', async () => {
    const { ran, exit, server } = await served(freshPlace(), ['--root', '--typo']);
    expect({ exit, server }, `deep hub run --root --typo has a flag where the folder goes, so it must exit 2 and start no server: ${server ? 'it started one, stopped by this test; ' : ''}${shown(ran)}`).toEqual({ exit: 2, server: false });
  }, TEST_MS);
});
