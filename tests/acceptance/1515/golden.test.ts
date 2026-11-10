// The oracle of criterion 8 (README: Today's scan): writes fixtures/today.json, the hits the merge base's `deep find`
// (today's scan) returns on the fixture record for the three queries. It runs only when asked
// (`DH1515_GOLDEN=write`) and only on the base commit with no change under packages/, so it can't record an
// implementation's answers; every other run skips it. The implementer never runs it (AGENTS.md: never re-record goldens).

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { afterAll, expect, test } from 'vitest';
import { cleanup, find, makeWorld, QUERIES } from './helpers.ts';
import { REPO } from '../26/helpers.ts';

afterAll(cleanup, 60_000);

const BASE = 'f1e8736e';

test.runIf(process.env.DH1515_GOLDEN === 'write')(`records today's deep find hits on the fixture at ${BASE}`, async () => {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
  expect(git('rev-parse', 'HEAD').startsWith(BASE), `the golden is written only at the base commit ${BASE}`).toBe(true);
  expect(git('status', '--porcelain', '--', 'packages'), 'the golden is written only with packages/ as the base has them').toBe('');
  const w = await makeWorld();
  const queries: Record<string, string[]> = {};
  for (const query of Object.values(QUERIES)) {
    const { hits } = await find(w, [query]);
    queries[query] = hits.map((h) => String(h.handle));
    expect(queries[query], `today's scan finds "${query}" in the fixture`).not.toEqual([]);
  }
  const out = { base: git('rev-parse', 'HEAD'), command: 'deep find <query> --json --root <root>, every page, in repo A\'s folder', queries };
  writeFileSync(new URL('./fixtures/today.json', import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
}, 900_000);
