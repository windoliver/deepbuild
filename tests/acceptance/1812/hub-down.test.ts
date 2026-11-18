// #1812 AC1 (README): the table of every command `deep --help` lists that calls the hub (the owner's reading), each run
// in one home that `deep setup` set up and whose hub was then stopped by PID. Each must print the one sentence, that the
// hub isn't answering, with its fix, `deep hub start`; exit 3; and print no errno and no path twice. The test fails
// naming every command that doesn't.
import { afterAll, describe, expect, it } from 'vitest';
import { SECOND, answers, cleanup, deep, hubDownFailures, needBuild, setUp, socketOf, stopHubs, table, world } from './helpers.ts';

afterAll(cleanup, 60 * SECOND);

const ID = '#1812.e264e123';

describe(`${ID} every command that calls the hub, in a home whose hub isn't answering`, () => {
  it(`${ID} each prints the one sentence with its fix, deep hub start, exits 3, and prints no errno and no path twice`, async () => {
    needBuild();
    const w = world();
    await setUp(w);
    await stopHubs(w);
    if (await answers(socketOf(w))) throw Error('BLOCKED: a hub still answers in the home after its hub was stopped by PID');
    const rows = await table(w);
    const failures: string[] = [];
    for (const { name, args } of rows) {
      const r = await deep(w, args, { timeoutMs: 60 * SECOND });
      failures.push(...hubDownFailures(`deep ${name}`, r, 'deep hub start'));
    }
    expect(failures, `${failures.length} of the ${rows.length} commands that call the hub don't print the one sentence with its fix and exit 3, or print an errno or a path twice:\n${failures.join('\n')}`).toEqual([]);
  }, 1800 * SECOND);
});
