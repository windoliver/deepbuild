// AC3 #1495.4e3f9f7e A run stopped after the first artifact, run again, publishes only the rest and reports what it
// skipped.
// AC8 #1495.1fbd7770 With the first of three artifacts verified and published, a rerun hashes the first, finds the
// manifest's digest and neither extracts nor publishes it again, and verifies the other two once each. With one byte of
// the first changed before the rerun, it is refused, naming both digests. A planted rerun that trusts the file name
// skips it and fails.
//
// Issue, Scope: "Running it again does only what's missing, and it verifies each artifact afterwards"; "A rerun skips an
// artifact only when the sha256 of its bytes equals the manifest's entry". Design, Cutting a release: "Run again, it does
// only what's missing and verifies each artifact."
//
// Surfaces (README, The contract 4, 5 and 8): three artifacts in a signed release folder, published one at a time in the
// manifest's order into the publish folder; the run is stopped after the first by a folder squatting on the second's
// name in the publish folder, a write the release can't make; the report lines `verified <file>`, `published <file>` and
// `skipped <file>`. The one byte is changed in both copies of the first, the output folder's and the published one, so
// the rerun meets it whichever it reads.
// Wrong programs: the base (no scripts/release.mjs); a rerun that publishes or verifies everything again (AC3, AC8);
// `trust-file-name` (DEEP_RELEASE_PLANT), which skips an artifact whose file is already published without hashing it.
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  cleanup, initRepo, named, notes, npmArchive, preflight, published, reported, sha256File, shown, tag, tagged, world, writeOut,
  type Artifact, type Ran, type World,
} from './helpers.ts';

afterAll(cleanup);

interface Stopped { w: World; commit: string; report: string; artifacts: [Artifact, Artifact, Artifact]; first: Ran }
/** A release of three artifacts whose first run published the first and stopped at the second, then unblocked. */
function stoppedAfterFirst(): Stopped {
  const w = world();
  const commit = initRepo(w, '1.3.0');
  const artifacts: [Artifact, Artifact, Artifact] = [
    npmArchive(w, 'deepbuild', '1.3.0', { 'bin/deep.mjs': '#!/usr/bin/env node\nconsole.log("1.3.0")\n', 'lib/index.js': 'export {};\n' }),
    npmArchive(w, '@deepbuild/deep-hook-darwin-arm64', '1.3.0', { 'bin/deep-hook': '#!/bin/sh\necho darwin-arm64\n' }),
    npmArchive(w, '@deepbuild/deep-hook-linux-x64', '1.3.0', { 'bin/deep-hook': '#!/bin/sh\necho linux-x64\n' }),
  ];
  writeOut(w, commit, artifacts);
  const report = preflight(w, commit);
  const n = notes(w, commit, report);
  expect(n.code, `release.mjs notes exits 0:\n${shown(n)}`).toBe(0);
  // The publish folder refuses the second artifact: a folder holds its name, so neither a copy nor a rename lands.
  const squatter = join(w.publish, artifacts[1].file);
  mkdirSync(join(squatter, 'in-the-way'), { recursive: true });
  const first = tag(w, commit, report);
  expect(first.code, `the first run stops at the second artifact, which it can't publish:\n${shown(first)}`).not.toBe(0);
  expect(published(w), 'the first run published the first artifact and nothing after it').toEqual([artifacts[0].file]);
  expect(sha256File(join(w.publish, artifacts[0].file)), 'the first artifact\'s published bytes are the manifest\'s').toBe(artifacts[0].sha256);
  expect(statSync(squatter).isDirectory(), 'the second artifact never landed').toBe(true);
  expect(tagged(w, '1.3.0'), 'a stopped run tags nothing').toBeNull();
  rmSync(squatter, { recursive: true });
  return { w, commit, report, artifacts, first };
}
const stamp = (path: string): string => { const s = statSync(path); return `${s.ino}:${s.mtimeMs}:${s.size}`; };

describe(`${named(3)} A run stopped after the first artifact, run again, publishes only the rest and reports what it skipped`, () => {
  it(`${named(3)} the rerun publishes the second and third artifacts, leaves the first as published, reports it skipped the first and tags the release`, () => {
    const { w, commit, report, artifacts: [a, b, c] } = stoppedAfterFirst();
    const before = stamp(join(w.publish, a.file));
    const r = tag(w, commit, report);
    expect(r.code, `the rerun finishes the release:\n${shown(r)}`).toBe(0);
    expect(reported(r.text, 'skipped', a.file), `the rerun reports skipping ${a.file} (a line "skipped ${a.file}")`).toBeGreaterThanOrEqual(1);
    expect([b, c].map((x) => reported(r.text, 'skipped', x.file)), 'it reports skipping nothing it published').toEqual([0, 0]);
    expect(reported(r.text, 'published', a.file), `it doesn't publish ${a.file} again`).toBe(0);
    expect(stamp(join(w.publish, a.file)), 'the first artifact\'s published copy is untouched').toBe(before);
    expect(published(w)).toEqual([a.file, b.file, c.file].sort());
    for (const x of [b, c]) expect(sha256File(join(w.publish, x.file)), `${x.file} published with the manifest's bytes`).toBe(x.sha256);
    expect(tagged(w, '1.3.0')).toBe(commit);
  }, 300_000);
});

/** AC8's refusal, as one list of failures: refused, both digests named, nothing tagged. */
function refusedByDigest(w: World, r: Ran, digests: readonly string[]): string[] {
  const failures: string[] = [];
  if (r.code === 0) failures.push('the rerun exited 0; it was to refuse the changed artifact');
  for (const d of digests) if (!r.text.includes(d)) failures.push(`the refusal doesn't name the digest ${d}`);
  const at = tagged(w, '1.3.0');
  if (at) failures.push(`release/1.3.0 was tagged at ${at}`);
  return failures;
}
/** One byte of the first artifact changed in both of its copies, the output folder's and the published one. */
function changeOneByte(s: Stopped): string {
  const a = s.artifacts[0];
  for (const path of [join(s.w.out, a.file), join(s.w.publish, a.file)]) {
    const bytes = readFileSync(path);
    const at = Math.floor(bytes.length / 2);
    bytes[at] = bytes[at]! ^ 0x01;
    writeFileSync(path, bytes);
  }
  const changed = sha256File(join(s.w.publish, a.file));
  expect(changed).not.toBe(a.sha256);
  expect(sha256File(join(s.w.out, a.file))).toBe(changed);
  return changed;
}

describe(`${named(8)} A rerun hashes the first artifact, skips it on the manifest's digest, verifies the other two once each, and refuses it when one byte changed`, () => {
  it(`${named(8)} with the first of three verified and published, the rerun neither verifies nor publishes it again, and verifies the other two once each`, () => {
    const s = stoppedAfterFirst();
    const [a, b, c] = s.artifacts;
    expect(reported(s.first.text, 'verified', a.file), `the first run reported verifying ${a.file} ("verified ${a.file}")`).toBe(1);
    const before = stamp(join(s.w.publish, a.file));
    const r = tag(s.w, s.commit, s.report);
    expect(r.code, shown(r)).toBe(0);
    expect(reported(r.text, 'skipped', a.file), `the rerun hashed ${a.file}, found the manifest's digest and skipped it`).toBeGreaterThanOrEqual(1);
    expect(reported(r.text, 'verified', a.file), `the rerun doesn't verify (extract) ${a.file} again`).toBe(0);
    expect(reported(r.text, 'published', a.file), `the rerun doesn't publish ${a.file} again`).toBe(0);
    expect(stamp(join(s.w.publish, a.file)), 'its published copy is untouched').toBe(before);
    expect([b, c].map((x) => reported(r.text, 'verified', x.file)), 'the other two are verified once each').toEqual([1, 1]);
  }, 300_000);

  it(`${named(8)} with one byte of the first artifact changed before the rerun, the rerun refuses it, naming the manifest's digest and the changed one`, () => {
    const s = stoppedAfterFirst();
    const changed = changeOneByte(s);
    const r = tag(s.w, s.commit, s.report);
    expect(refusedByDigest(s.w, r, [s.artifacts[0].sha256, changed]), shown(r)).toEqual([]);
  }, 300_000);

  it(`${named(8)} (wrong program) trust-file-name skips the changed artifact because its file is published, and fails this test`, () => {
    const s = stoppedAfterFirst();
    const changed = changeOneByte(s);
    const r = tag(s.w, s.commit, s.report, { plant: 'trust-file-name' });
    // It is the wrong program it says: it skipped the changed artifact by its name and cut the release over it.
    expect(reported(r.text, 'skipped', s.artifacts[0].file), `the planted rerun skips ${s.artifacts[0].file} by its published name:\n${shown(r)}`).toBeGreaterThanOrEqual(1);
    expect(tagged(s.w, '1.3.0'), 'the planted rerun tagged the release with the changed artifact still published').toBe(s.commit);
    expect(sha256File(join(s.w.publish, s.artifacts[0].file))).toBe(changed);
    const failures = refusedByDigest(s.w, r, [s.artifacts[0].sha256, changed]);
    expect(failures.length, `the planted rerun must fail the judgement, and it passed:\n${shown(r)}`).toBeGreaterThan(0);
  }, 300_000);
});
