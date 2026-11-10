// AC5: "With test.upper's params `{case: upper, trim: false}`, where trim defaults to false, a changed input byte, a
// bump of the tool's version and `trim: true` each miss the cache and start one process (3 of 3), while reordering the
// params' keys, omitting trim, re-saving the input with a new modified time, renaming the input file and moving the
// project folder each hit and start none (5 of 5); a planted key over the params' text as written misses on the
// reordered and omitted cases and fails, naming the part, and a planted key without the tool's version serves the old
// output after the bump and fails, naming the part"
//
// asserts: with test/upper-kind and test/upper-more (upper-b@1.0.0) installed, after the base run of "abc" with
// {"case":"upper","trim":false} (a miss, one process, "ABC"), the five unchanged-key cases each read cache hit, the
// base's key, "ABC" and no process, and the three changed-key cases (input "abd", {"case":"upper","trim":true},
// test/upper-more 1.0.1's upper-b@1.0.1) each read cache miss, another key, the right output and one process
// (helpers.ts judgeKey). The same judge fails the planted hub job-key-params-text on the reordered and omitted cases,
// each failure naming the params, and the planted hub job-key-no-version on the bump, naming the tool's version.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { judgeKey, kindWorld, mustInstall, proof, toolPlugin, type HubPlant } from './helpers.ts';

const REORDERED = 'reordering the params\' keys';
const OMITTED = 'omitting trim';
const BUMP = 'a bump of the tool\'s version';

async function judged(plant?: HubPlant): Promise<string[]> {
  const w = await kindWorld(plant);
  await mustInstall(w, toolPlugin(join(w.tmp, 'more')));
  const { failures, runs } = await judgeKey(w);
  proof(`ac5-key${plant ? `-planted-${plant}` : ''}.json`, { failures, runs });
  return failures;
}
const about = (failures: string[], label: string): string[] => failures.filter((f) => f.startsWith(`${label}:`));

describe('#1922.fd1b18ec With test.upper\'s params `{case: upper, trim: false}`, where trim defaults to false, a changed input byte, a bump of the tool\'s version and `trim: true` each miss the cache and start one process (3 of 3), while reordering the params\' keys, omitting trim, re-saving the input with a new modified time, renaming the input file and moving the project folder each hit and start none (5 of 5); a planted key over the params\' text as written misses on the reordered and omitted cases and fails, naming the part, and a planted key without the tool\'s version serves the old output after the bump and fails, naming the part', () => {
  it('three changed parts each miss and start one process, and five unchanged keys each hit and start none', async () => {
    expect(await judged()).toEqual([]);
  }, 900_000);

  it('the planted key over the params\' text as written misses on the reordered and omitted cases and fails, naming the part', async () => {
    const failures = await judged('job-key-params-text');
    for (const label of [REORDERED, OMITTED]) {
      const found = about(failures, label);
      expect(found.length, `the judge fails the planted key on "${label}": ${JSON.stringify(failures)}`).toBe(1);
      expect(found[0], 'the failure names the part, the params').toMatch(/params/);
    }
  }, 900_000);

  it('the planted key without the tool\'s version serves the old output after the bump and fails, naming the part', async () => {
    const failures = await judged('job-key-no-version');
    const found = about(failures, BUMP);
    expect(found.length, `the judge fails the planted key on the bump: ${JSON.stringify(failures)}`).toBe(1);
    expect(found[0], 'the failure names the part, the tool\'s version').toMatch(/version/);
  }, 900_000);
});
