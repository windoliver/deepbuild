import { afterAll, describe, expect, it } from 'vitest';
import { FIRST_RUN, SECOND, cleanup, deep, hubDownFailures, hubForms, needBuild, table, world } from './helpers.ts';

afterAll(cleanup, 60 * SECOND);

const ID = '#1812.5a83f2e0';

describe(`${ID} the same table in a home that isn't set up (redraft 1814)`, () => {
  it(`${ID} each command outside the first-run list names deep setup as the fix, never deep hub start (redraft 1814)`, async () => {
    needBuild();
    const rows = (await table(world())).filter(({ name }) => !FIRST_RUN.includes(name.split(' ')[0]!));
    const failures: string[] = [];
    for (const { name } of rows) {
      const w = world();
      const r = await deep(w, hubForms(w).get(name)!, { timeoutMs: 60 * SECOND });
      failures.push(...hubDownFailures(`deep ${name}`, r, 'deep setup'));
    }
    expect(rows.length, 'the table holds the commands outside the first-run list').toBeGreaterThan(10);
    expect(failures, `${failures.length} of the ${rows.length} commands, each in a home nobody set up, don't print the one sentence with deep setup as its fix and exit 3, or print an errno, a path twice or deep hub start:\n${failures.join('\n')}`).toEqual([]);
  }, 1800 * SECOND);
});
