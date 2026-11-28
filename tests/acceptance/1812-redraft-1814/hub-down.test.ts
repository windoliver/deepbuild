import { afterAll, describe, expect, it } from 'vitest';
import { SECOND, answers, cleanup, deep, hubDownFailures, needBuild, setUp, socketOf, stopHubs, table, world } from './helpers.ts';

afterAll(cleanup, 60 * SECOND);

const ID = '#1812.e264e123';

describe(`${ID} every command that calls the hub, in a home whose hub isn't answering (redraft 1814)`, () => {
  it(`${ID} each prints the one sentence with its fix, deep hub start, exits 3, and prints no errno and no path twice (redraft 1814)`, async () => {
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
