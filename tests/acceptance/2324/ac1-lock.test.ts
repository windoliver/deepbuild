// #2324 AC1: Cargo.lock holds the engine once, at the new exact version, and that version is at or past the first
// fixed version of each of the 17 advisories. A planted lock at 49.0.4 fails this check, naming the three advisories
// it is still inside.
//
// The 17 are fixtures/advisories.json, read from the engine's project on 2026-11-12; `lockFailures` is the one check
// both tests run, on the checkout's Cargo.lock and on fixtures/planted-49.0.4.lock.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AC, ADVISORIES, OLD, inside, lockFailures, lockVersions, none, readLock } from './helpers.ts';

const PLANTED = fileURLToPath(new URL('./fixtures/planted-49.0.4.lock', import.meta.url));

describe(`${AC[1]} Cargo.lock holds the engine once, at a release past every advisory published against 49.0.2`, () => {
  it(`${AC[1]} Cargo.lock holds wasmtime once, at an exact release outside each of the 17 advisories and at or past each one's first fixed version`, () => {
    expect(ADVISORIES.advisories, 'the suite reads 17 advisories against 49.0.2').toHaveLength(17);
    const lock = readLock();
    const [version] = lockVersions(lock);
    for (const a of ADVISORIES.advisories) console.log(`${a.id} ${a.published} ${a.severity.padEnd(8)} first fixed ${a.first_fixed_49}  lock ${version ?? '(none)'}`);
    none(lockFailures(lock), 'Cargo.lock\'s engine is past every advisory published against 49.0.2');
  });

  it(`${AC[1]} a planted lock at 49.0.4 fails the same check, naming the three advisories it is still inside`, () => {
    expect(inside(OLD).map((a) => a.id), 'the check reads 49.0.2 inside all 17 (its ranges are read as the project writes them)').toHaveLength(17);
    const failures = lockFailures(readFileSync(PLANTED, 'utf8'));
    const named = ADVISORIES.advisories.filter((a) => failures.some((f) => f.includes(a.id))).map((a) => a.id).sort();
    expect(named, `the planted lock fails, naming the three advisories fixed in 49.0.5: ${failures.join('; ')}`)
      .toEqual(['GHSA-3982-jqvv-277m', 'GHSA-6fr9-xmw9-5352', 'GHSA-qw58-7h65-crq2']);
  });
});
