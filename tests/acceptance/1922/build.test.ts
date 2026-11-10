// AC7: "The receipt for "abc" names a build equal to the digest of the tool's files as installed, and the same tool
// installed from two folders records one build. A planted host that hashes paths or modified times records two builds
// and fails, naming the tool"
//
// asserts: with test/upper-kind installed, test/upper-more's upper-b@1.0.0 installed from one folder runs "abc" with a
// receipt whose build is packageDigest of its ./tool (its files and modes, as the install copies them); the same
// plug-in copied to a second, deeper folder with every modified time set to 2001 installs too (the same name@version
// and build, so nothing to refuse), deep_job lists upper-b@1.0.0 with that one build, and the next receipt names it
// (helpers.ts judgeBuild). The same judge fails the planted hosts job-build-hashes-paths and job-build-hashes-mtimes,
// naming the tool.
import { describe, expect, it } from 'vitest';
import { judgeBuild, kindWorld, proof, type HubPlant } from './helpers.ts';

const TOOL = 'upper-b@1.0.0';

describe('#1922.583e414e The receipt for "abc" names a build equal to the digest of the tool\'s files as installed, and the same tool installed from two folders records one build. A planted host that hashes paths or modified times records two builds and fails, naming the tool', () => {
  it('the receipt names the digest of the tool\'s files as installed, and two folders of the same files record one build', async () => {
    const w = await kindWorld();
    const { failures, seen } = await judgeBuild(w);
    proof('ac7-build.json', { failures, seen });
    expect(failures).toEqual([]);
  }, 900_000);

  for (const plant of ['job-build-hashes-paths', 'job-build-hashes-mtimes'] as HubPlant[]) {
    it(`the planted host ${plant} records two builds and fails, naming the tool`, async () => {
      const w = await kindWorld(plant);
      const { failures, seen } = await judgeBuild(w);
      proof(`ac7-planted-${plant}.json`, { failures, seen });
      expect(failures.length, `the judge fails the planted host: ${JSON.stringify(failures)}`).toBeGreaterThan(0);
      expect(failures.every((f) => f.includes(TOOL)), `each failure names the tool ${TOOL}: ${JSON.stringify(failures)}`).toBe(true);
    }, 900_000);
  }
});
