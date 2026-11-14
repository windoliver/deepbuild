// #1980.e7991d8c: "The snapshot is kept as evidence by its hash and names no person: every maintainer handle in the
// fetched history is a stable placeholder. A planted snapshot that keeps one handle fails, naming the job it came with"
//
// The replay runs once into a fresh record and evidence store (helpers.ts, useReplay), and keeps its snapshot there.
// asserts:
// 1. SNAPSHOT is a SHA-256 in lower-case hex; the report names its snapshot by SNAPSHOT; the evidence store keeps a
//    file by that hash, read back by it, whose bytes hash to it and parse as the snapshot.
// 2. personCheck: every maintainer handle of every failure, and the owner of every merge, matches the placeholder form
//    maintainer-<n>; no string in the snapshot holds an email address.
// 3. Under `snapshot-keeps-handle`, the snapshot the replay keeps (by the hash its report names) fails personCheck, a
//    failure naming the job a handle that is no placeholder came with.
// Wrong program: the merge base, where packages/routing-replay doesn't exist; and the planted snapshot.

import { describe, expect, it } from 'vitest';
import { PLACEHOLDER, SNAPSHOT, kept, none, personCheck, reportedSnapshot, sha256, useReplay } from './helpers.ts';

describe('the replay', () => {
  const world = useReplay();

  it('#1980.e7991d8c the snapshot is kept as evidence by its hash', async () => {
    const w = world();
    expect(SNAPSHOT, 'SNAPSHOT is a SHA-256 in lower-case hex').toMatch(/^[0-9a-f]{64}$/);
    expect(reportedSnapshot(w.report), 'the report names the snapshot it replayed by its hash').toBe(SNAPSHOT);
    const evidence = await w.evidence.get(SNAPSHOT);
    expect(evidence?.sha256, 'the evidence store keeps the snapshot by its hash').toBe(SNAPSHOT);
    const { bytes, snapshot } = await kept(w, SNAPSHOT);
    expect(sha256(bytes), 'the kept bytes hash to SNAPSHOT').toBe(SNAPSHOT);
    expect(snapshot.evaluations.length, 'the kept snapshot holds evaluations').toBeGreaterThan(0);
  });

  it('#1980.e7991d8c it names no person: every maintainer handle in the fetched history is a stable placeholder', async () => {
    const w = world();
    const { snapshot } = await kept(w, SNAPSHOT);
    expect(snapshot.evaluations.some((ev) => ev.failures.some((f) => f.maintainers.length > 0)), 'the snapshot holds maintainer handles').toBe(true);
    none(personCheck(snapshot), 'the snapshot names no person');
  });
});

describe('the replay of a planted snapshot that keeps one handle', () => {
  const world = useReplay('snapshot-keeps-handle');

  it('#1980.e7991d8c a planted snapshot that keeps one handle (snapshot-keeps-handle) fails, naming the job it came with', async () => {
    const w = world();
    const { snapshot } = await kept(w, reportedSnapshot(w.report));
    const keeps = (handle: string): boolean => !PLACEHOLDER.test(handle);
    const jobs = snapshot.evaluations.flatMap((ev) => ev.failures.filter((f) => f.maintainers.some(keeps) || (f.merge !== null && keeps(f.merge.owner))).map((f) => f.job));
    expect(jobs.length, 'the planted snapshot keeps a maintainer handle with a job').toBeGreaterThan(0);
    const failures = personCheck(snapshot);
    expect(failures.length, 'the planted snapshot fails the check that it names no person').toBeGreaterThan(0);
    expect(jobs.some((job) => failures.some((f) => f.includes(`job ${job}:`))), `a failure names the job the handle came with (${[...new Set(jobs)].join(', ')}); the failures were:\n  ${failures.join('\n  ')}`).toBe(true);
  });
});
