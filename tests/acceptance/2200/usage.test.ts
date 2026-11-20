// #2200, criteria 1 and 2: a `deep` command with arguments it can't read sets nothing up.
//
// Each command runs once, as a child process of the built CLI, in a home of its own with no `.deepbuild`, stand-ins
// for the service manager and a launcher stand-in that refuses (README: The home). One assertion holds the issue's
// three values together: exit 2, no new file, no stand-in call. On the base the nine commands run setup's steps
// first, so each test fails there at that assertion with the files written and the launcher's call in the message.

import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, freshHome, outcome, shown } from './helpers.ts';

afterAll(cleanup, 60_000);

/** What a usage error leaves: the issue's values. */
const NOTHING = { exit: 2, written: [] as string[], called: [] as string[] };

async function setsNothingUp(args: readonly string[]): Promise<void> {
  const { ran, exit, written, called } = await outcome(freshHome(), args);
  expect({ exit, written, called }, `deep ${args.join(' ')} can't read its arguments, so it must exit 2, leave no new file and call no stand-in: ${shown(ran)}`).toEqual(NOTHING);
}

describe('#2200.3594285f a usage error sets nothing up', () => {
  it('#2200.3594285f deep status --typo in a home with no .deepbuild exits 2, leaves no new file and the stand-ins log no call', async () => {
    await setsNothingUp(['status', '--typo']);
  }, 300_000);
});

describe('#2200.3e626bd2 the same for the other eight', () => {
  const OTHERS: string[][] = [
    ['inbox', '--typo'], ['secret', '--typo'], ['off', '--typo'], ['on', '--typo'], ['env', '--typo'],
    ['install', '--typo'], ['guard', '--typo'], ['memory', '--typo'], ['env'],
  ];
  it.each(OTHERS.map((args) => [args.join(' '), args] as const))('#2200.3e626bd2 deep %s in a home with no .deepbuild exits 2, leaves no new file and the stand-ins log no call', async (_shown, args) => {
    await setsNothingUp(args);
  }, 300_000);
});
