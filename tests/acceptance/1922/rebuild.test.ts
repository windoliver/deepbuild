// AC6: "A test.upper tool of two files is installed again under the same version with one byte changed in its second
// file: the install is refused, naming the tool and both builds, and the run on "abc" is still a cache hit that starts
// no process. Under the next version the changed tool qualifies and joins, and "abc" misses once. A planted host that
// hashes only the tool's entry file accepts the changed tool under the same version and fails, naming the file"
//
// asserts: with test/upper-kind installed, test/upper-more's upper-b@1.0.0 (./tool/upper.mjs, its entry, and
// ./tool/case.mjs) is installed and runs "abc"; the same plug-in with one byte of tool/case.mjs changed (a comment's
// mark, a to b) under the same version is refused, its words naming upper-b and both builds (the packageDigest of each
// ./tool, by at least its first 12 hex digits); upper-b@1.0.0 on "abc" is then a hit that starts no process; under
// 1.0.1 the changed files install, deep_job lists upper-b@1.0.1 with the changed build, and "abc" misses once (one
// process, that build in its receipt) and then hits (helpers.ts judgeRebuild). The same judge fails the planted host
// job-build-entry-only, naming tool/case.mjs.
import { describe, expect, it } from 'vitest';
import { judgeRebuild, kindWorld, proof } from './helpers.ts';

describe('#1922.985dc2cb A test.upper tool of two files is installed again under the same version with one byte changed in its second file: the install is refused, naming the tool and both builds, and the run on "abc" is still a cache hit that starts no process. Under the next version the changed tool qualifies and joins, and "abc" misses once. A planted host that hashes only the tool\'s entry file accepts the changed tool under the same version and fails, naming the file', () => {
  it('the same version with one byte changed in the second file is refused naming the tool and both builds; the next version joins and misses once', async () => {
    const w = await kindWorld();
    const { failures, seen } = await judgeRebuild(w);
    proof('ac6-rebuild.json', { failures, seen });
    expect(failures).toEqual([]);
  }, 900_000);

  it('the planted host that hashes only the entry file accepts the changed tool and fails, naming the file', async () => {
    const w = await kindWorld('job-build-entry-only');
    const { failures, seen } = await judgeRebuild(w);
    proof('ac6-planted-job-build-entry-only.json', { failures, seen });
    expect(failures.filter((f) => f.includes('was accepted') && f.includes('tool/case.mjs')), `the judge fails the planted host, naming tool/case.mjs: ${JSON.stringify(failures)}`).toHaveLength(1);
  }, 900_000);
});
