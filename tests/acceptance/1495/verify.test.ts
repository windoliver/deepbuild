// AC5 #1495.c2b38fd8 An app download with one first-party pack's folder removed and its version string unchanged fails
// verification, naming the pack and the artifact, and nothing after it is published. A planted verifier that compares
// version strings passes it and fails this test.
// AC6 #1495.1a706da4 An artifact built at another commit, left in the output folder under the release's file name and
// version, is refused by its sha256, naming the artifact and both digests. A planted verifier that matches by name and
// version publishes it and fails.
//
// Issue, Scope: "Verifying an artifact means its own bytes: the release reads each artifact back, compares its sha256
// with the signed manifest's entry for the release commit (#41) and extracts it into a fresh folder. A matching version
// string or file name never stands in for the digest"; "The manifest lists what each artifact holds: every binary,
// bundled font and first-party pack, by path and sha256. Verification checks each against the extracted copy and stops
// the release at the first artifact with a missing or changed entry, naming the entry and the artifact." The design's
// Cutting a release says the same.
//
// Surfaces (README, The contract 4, 5 and 8): a signed release folder whose manifest lists each artifact's `holds`;
// artifacts verified and published one at a time in the manifest's order; the app download, DeepBuild-<version>.zip,
// whose runtime folder holds the first-party packs (a small one here, README: Fixtures).
// Wrong programs: the base (no scripts/release.mjs); `version-verifier` and `name-version-verifier`
// (DEEP_RELEASE_PLANT); a verifier that refuses every app download (AC5's twin).
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  appDownload, cleanup, commitAll, git, initRepo, named, notes, npmArchive, preflight, published, put, sha256File, shown, tag, tagged, world, writeOut,
  type Artifact, type Ran, type World,
} from './helpers.ts';

afterAll(cleanup);

const DROPPED = 'foley-1.0.0';

interface Release5 { w: World; commit: string; report: string; before: Artifact; app: Artifact; after: Artifact }
/** A release of three artifacts, the app download second: `drop` leaves one first-party pack's folder out of it. */
function withApp(drop?: string): Release5 {
  const w = world();
  const commit = initRepo(w, '1.3.0');
  const before = npmArchive(w, 'deepbuild', '1.3.0', { 'bin/deep.mjs': '#!/usr/bin/env node\nconsole.log("1.3.0")\n' });
  const app = appDownload(w, '1.3.0', drop ? { drop } : {});
  const after = npmArchive(w, '@deepbuild/deep-hook-darwin-arm64', '1.3.0', { 'bin/deep-hook': '#!/bin/sh\necho 1.3.0\n' });
  expect(app.holds.filter((h) => h.path.includes(`/packs/${DROPPED}/`)).length, `the manifest lists ${DROPPED}'s files in the app download`).toBeGreaterThan(0);
  writeOut(w, commit, [before, app, after]);
  const report = preflight(w, commit);
  const n = notes(w, commit, report);
  expect(n.code, `release.mjs notes exits 0:\n${shown(n)}`).toBe(0);
  return { w, commit, report, before, app, after };
}
/** AC5's judgement: refused, naming the pack and the artifact; neither the app download nor anything after it published. */
function judge5(r: Release5, run: Ran): string[] {
  const failures: string[] = [];
  if (run.code === 0) failures.push('the release exited 0; verification was to fail the app download');
  for (const name of [DROPPED, r.app.file]) if (!run.text.includes(name)) failures.push(`the failure doesn't name ${name}`);
  const out = published(r.w);
  for (const a of [r.app, r.after]) if (out.includes(a.file)) failures.push(`${a.file} was published`);
  const at = tagged(r.w, '1.3.0');
  if (at) failures.push(`release/1.3.0 was tagged at ${at}`);
  return failures;
}

describe(`${named(5)} An app download with one first-party pack's folder removed and its version string unchanged fails verification`, () => {
  it(`${named(5)} the twin: the app download with every pack verifies and is published, with the artifacts around it`, () => {
    const r = withApp();
    const t = tag(r.w, r.commit, r.report);
    expect(t.code, `the whole app download verifies (its stand-in runtime passes the app check, README: Fixtures):\n${shown(t)}`).toBe(0);
    expect(published(r.w)).toEqual([r.before.file, r.app.file, r.after.file].sort());
    expect(sha256File(join(r.w.publish, r.app.file))).toBe(r.app.sha256);
  }, 300_000);

  it(`${named(5)} with ${DROPPED}'s folder left out and the versions unchanged, verification fails naming the pack and the artifact, and nothing after it is published`, () => {
    const r = withApp(DROPPED);
    const t = tag(r.w, r.commit, r.report);
    expect(judge5(r, t), shown(t)).toEqual([]);
  }, 300_000);

  it(`${named(5)} (wrong program) version-verifier passes the app download on its version strings, publishes it, and fails this test`, () => {
    const r = withApp(DROPPED);
    const t = tag(r.w, r.commit, r.report, { plant: 'version-verifier' });
    expect(published(r.w), `the planted verifier publishes the app download with a pack missing:\n${shown(t)}`).toContain(r.app.file);
    expect(judge5(r, t).length, 'the planted verifier must fail the judgement, and it passed').toBeGreaterThan(0);
  }, 300_000);
});

interface Release6 { w: World; commit: string; report: string; own: Artifact; stale: Artifact }
/** A release whose output folder holds, under its own file name and version, `deepbuild` built at the commit before. */
function withStale(): Release6 {
  const w = world();
  const older = initRepo(w, '1.3.0', { 'lib/index.js': 'export const built = "at the commit before";\n' });
  put(w.repo, { 'lib/index.js': 'export const built = "at the release commit";\n' });
  const commit = commitAll(w, 'The release commit');
  const at = (sha: string) => ({ 'lib/index.js': git(w, 'show', `${sha}:lib/index.js`) });
  const stale = npmArchive(w, 'deepbuild', '1.3.0', at(older));
  const own = npmArchive(w, 'deepbuild', '1.3.0', at(commit));
  expect(stale.file, 'both builds carry the release\'s file name and version').toBe(own.file);
  expect(stale.sha256).not.toBe(own.sha256);
  const hook = npmArchive(w, '@deepbuild/deep-hook-darwin-arm64', '1.3.0', { 'bin/deep-hook': '#!/bin/sh\necho 1.3.0\n' });
  writeOut(w, commit, [own, hook]);
  copyFileSync(stale.path, join(w.out, own.file));
  const report = preflight(w, commit);
  const n = notes(w, commit, report);
  expect(n.code, `release.mjs notes exits 0:\n${shown(n)}`).toBe(0);
  return { w, commit, report, own, stale };
}
/** AC6's judgement: refused, naming the artifact and both digests; the stale artifact unpublished; nothing tagged. */
function judge6(r: Release6, run: Ran): string[] {
  const failures: string[] = [];
  if (run.code === 0) failures.push('the release exited 0; the artifact built at another commit was to be refused');
  for (const name of [r.own.file, r.own.sha256, r.stale.sha256]) if (!run.text.includes(name)) failures.push(`the refusal doesn't name ${name}`);
  if (published(r.w).includes(r.own.file)) failures.push(`${r.own.file} was published`);
  const at = tagged(r.w, '1.3.0');
  if (at) failures.push(`release/1.3.0 was tagged at ${at}`);
  return failures;
}

describe(`${named(6)} An artifact built at another commit, left in the output folder under the release's file name and version, is refused by its sha256`, () => {
  it(`${named(6)} the release refuses it by its sha256, naming the artifact, the manifest's digest and its own, and publishes nothing of it`, () => {
    const r = withStale();
    const t = tag(r.w, r.commit, r.report);
    expect(judge6(r, t), shown(t)).toEqual([]);
  }, 300_000);

  it(`${named(6)} (wrong program) name-version-verifier publishes it, and fails this test`, () => {
    const r = withStale();
    const t = tag(r.w, r.commit, r.report, { plant: 'name-version-verifier' });
    expect(published(r.w), `the planted verifier publishes the artifact by its name and version:\n${shown(t)}`).toContain(r.own.file);
    expect(sha256File(join(r.w.publish, r.own.file)), 'what it published is the build from the other commit').toBe(r.stale.sha256);
    expect(judge6(r, t).length, 'the planted verifier must fail the judgement, and it passed').toBeGreaterThan(0);
  }, 300_000);
});
