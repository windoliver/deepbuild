// AC4: a tampered target/ is detected at claim and built cold, and the record says so. The tampering is done to the
// built outputs themselves, never to a fingerprint, and keeps each replaced file's size and mtime, so only a seal that
// is checked against the bay's stat listing (path, size, mtime, inode) sees it; a trusted seal does not.
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { bays, expectedGreeting, finished, inBay, machineRepo, sandbox, show, stampLike, step } from './helpers.mjs';

/** A sealed bay: one run that built the fixture and released. */
async function sealedBay(box) {
  const repo = machineRepo(box);
  const first = bays(box, { script: repo.bays, cwd: repo.worktree, steps: [{ do: 'build' }] });
  const one = inBay(box, await finished(first), first);
  assert.equal(step(one.probe, 'build').build.status, 0, 'the first build failed in the bay');
  return { ...repo, bay: one.bay, index: one.claim.index };
}

/** Replaces `path` by a new file (a new inode) holding `bytes`, with the old file's size kept by the caller and its atime and mtime put back. */
function replace(box, path, bytes) {
  const ref = join(box.dir, 'refs', 'replaced');
  writeFileSync(ref, '');
  stampLike(path, ref);
  const mode = statSync(path).mode;
  writeFileSync(`${path}.new`, bytes);
  chmodSync(`${path}.new`, mode);
  renameSync(`${path}.new`, path);
  stampLike(ref, path);
}

/** The next claim of the same tree: the record says the seal broke and the bay was built cold, and cargo compiled every crate. */
async function assertCold(box, repo, planted) {
  const next = bays(box, { script: repo.bays, cwd: repo.worktree, steps: [{ do: 'snapshot' }, { do: 'build' }] });
  const result = await finished(next);
  const two = inBay(box, result, next);
  assert.equal(two.claim.index, repo.index, `the next claim got pair ${two.claim.index}, not the tampered pair ${repo.index}; the test can't see the claim's check\n${show(result)}`);
  assert.equal(two.claim.seal, 'broken', `the claim record's seal is ${JSON.stringify(two.claim.seal)}, not "broken", after target/ was tampered with\n${show(result)}`);
  assert.equal(two.claim.cold, true, `the claim record's cold is ${JSON.stringify(two.claim.cold)}, not true, after target/ was tampered with\n${show(result)}`);
  for (const path of planted) assert.ok(!existsSync(join(two.bay, path)), `${path}, planted in target/, is still there after the claim`);
  const built = step(two.probe, 'build');
  assert.equal(built.build.status, 0, `the cold build failed\n${built.build.stderr}`);
  const warm = built.artifacts.filter((artifact) => artifact.fresh);
  assert.deepEqual(warm.map(({ name, kind }) => `${name} (${kind})`), [], 'cargo reused artifacts from the tampered target: the claim did not build cold');
  assert.ok(built.artifacts.length >= 3, `cargo reported ${built.artifacts.length} artifacts`);
  assert.equal(built.greet, expectedGreeting(repo.worktree), 'the binary after the claim is not the tree\'s');
  assert.equal(built.test.status, 0, `cargo test failed after the claim\n${built.test.output}`);
}

test('#1117.4ebbfb21 a planted binary in a sealed bay\'s target/ is detected at claim and built cold, and the record says so', { timeout: 600_000 }, async (t) => {
  const box = sandbox(t);
  const repo = await sealedBay(box);
  const greet = join(repo.bay, 'target/debug/greet');
  const size = statSync(greet).size;
  // The binary the tests run, swapped for a planted program of the same size and mtime, and a new binary beside it.
  const script = '#!/bin/sh\necho planted\n#';
  replace(box, greet, Buffer.concat([Buffer.from(script), Buffer.alloc(size - script.length, 0x23)]));
  copyFileSync('/bin/sh', join(repo.bay, 'target/debug/planted-tool'));
  await assertCold(box, repo, ['target/debug/planted-tool']);
});

test('#1117.4ebbfb21 a replaced rlib in a sealed bay\'s target/ (same size, same mtime, other bytes) is detected at claim and built cold, and the record says so', { timeout: 600_000 }, async (t) => {
  const box = sandbox(t);
  const repo = await sealedBay(box);
  const deps = join(repo.bay, 'target/debug/deps');
  const rlibs = readdirSync(deps).filter((name) => /^libword-.*\.rlib$/.test(name));
  assert.ok(rlibs.length, `no libword rlib in ${deps}`);
  for (const name of rlibs) {
    const bytes = readFileSync(join(deps, name));
    // Other bytes in the middle of the archive, the size unchanged.
    for (let at = Math.floor(bytes.length / 2); at < Math.min(bytes.length, Math.floor(bytes.length / 2) + 64); at++) bytes[at] ^= 0xff;
    replace(box, join(deps, name), bytes);
  }
  await assertCold(box, repo, []);
});
