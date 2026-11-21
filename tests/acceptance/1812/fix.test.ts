// #1812 AC7 (README): `deep fix <id>` is a command a person runs, so it prints one sentence naming what started, and
// JSON only with `--json`: then the object the merge base printed, byte for byte. A hub runs in the home with the test
// work source (DEEP_HUB_TEST_WORK, #66's seam) holding two fixture issues, fixtures/work.json; each is fixed once.
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURES, SECOND, cleanup, deep, hubRun, needBuild, shown, world, type World } from './helpers.ts';

afterAll(cleanup, 60 * SECOND);

const ID = '#1812.eabaa642';
/** What the merge base, 16dc5eab, printed for `deep fix ACME-43` against this fixture, byte for byte (BASE-FAILURE.txt). */
const BASE_JSON = '{"task":"task:ACME43","link":"https://tracker.example/acme/issues/43"}\n';
/** What started for ACME-42, as its sentence may name it: the issue, the task the merge base named, or its title. */
const STARTED = ['ACME-42', 'task:ACME42', 'Totals round to cents'];

let w: World;
beforeAll(async () => {
  needBuild();
  w = world();
  await hubRun(w, { DEEP_HUB_TEST_WORK: join(FIXTURES, 'work.json') });
}, 300 * SECOND);

describe(`${ID} deep fix prints a sentence, and JSON only with --json`, () => {
  it(`${ID} deep fix on a fixture issue prints one sentence naming what started`, async () => {
    const r = await deep(w, ['fix', 'ACME-42'], { timeoutMs: 120 * SECOND });
    expect(r.code, `deep fix ACME-42 starts work from the fixture issue: ${shown(r)}`).toBe(0);
    const lines = r.stdout.split('\n').filter((line) => line.trim());
    expect(lines, `deep fix ACME-42 prints one line, a sentence: ${shown(r)}`).toHaveLength(1);
    expect(/^\s*[[{]/.test(lines[0]!), `deep fix ACME-42 prints JSON where its sentence goes: ${shown(r)}`).toBe(false);
    expect(STARTED.some((name) => lines[0]!.includes(name)), `deep fix ACME-42's sentence names nothing of what started (${STARTED.join(', ')}): ${shown(r)}`).toBe(true);
  }, 300 * SECOND);

  it(`${ID} deep fix with --json prints the object the merge base printed, byte for byte`, async () => {
    const r = await deep(w, ['fix', 'ACME-43', '--json'], { timeoutMs: 120 * SECOND });
    expect(r.code, `deep fix ACME-43 --json starts work from the fixture issue: ${shown(r)}`).toBe(0);
    expect(r.stdout, `deep fix ACME-43 --json must print the merge base's object, byte for byte: ${shown(r)}`).toBe(BASE_JSON);
  }, 300 * SECOND);
});
