// Live acceptance tests for issue #79: they build the app. The first searches the debug binary for
// the exact bytes of every kit file the app surfaces name. The second, on a reference Mac only,
// builds the release app at HEAD and at the recorded merge base, strips both as
// docs/spikes/337/measure.mjs does, and holds the growth under 200 KB. Cargo needs its registry, so
// a cold machine needs the network once. Run: node --test tests/acceptance/79/mark.live.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { APP_SURFACES, ASSET_LIMIT, BINARY, BUDGET, HASH, appAssets, blocked, bytes, git, loadManifest, root, sha256, thisMachine } from './helpers.mjs';

const BUILD_MS = 30 * 60_000;

function cargo(args, cwd, env = {}) {
  const result = spawnSync('cargo', args, { cwd, encoding: 'utf8', timeout: BUILD_MS, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } });
  if (result.error) throw blocked(`cargo ${args.join(' ')} could not run: ${result.error.message}`);
  if (result.status !== 0) throw blocked(`cargo ${args.join(' ')} in ${cwd} exited ${result.status}:\n${result.stderr.slice(-4000)}`);
  return result;
}

function strippedSize(binary, directory) {
  const copy = join(directory, `deep-app-${sha256(binary).slice(0, 8)}`);
  copyFileSync(binary, copy);
  const strip = spawnSync('strip', [copy], { encoding: 'utf8' });
  if (strip.status !== 0) throw blocked(`strip failed: ${strip.error?.message ?? strip.stderr}`);
  return statSync(copy).size;
}

test(`${HASH} the built app holds every app surface's kit file byte for byte: the .icns, the menu-bar template, the title-bar mark and the welcome screen's artwork`, { timeout: BUILD_MS + 60_000 }, () => {
  const manifest = loadManifest();
  const { files } = appAssets(manifest);
  assert.ok(files.size > 0, `no app surface (${APP_SURFACES.join(', ')}) names a kit file`);
  cargo(['build', '-p', 'deep-app'], root);
  const binary = bytes(root, BINARY);
  const missing = [...files.keys()].filter((path) => binary.indexOf(bytes(root, path)) < 0);
  assert.deepEqual(missing, [], `${BINARY} (${binary.length} bytes) does not contain these kit files' bytes, so the app draws something else: ${missing.join(', ')}`);
});

test(`${BUDGET} on a reference Mac, the stripped release app at HEAD is under 200 KB larger than at the recorded merge base`, { timeout: 2 * BUILD_MS + 60_000 }, (t) => {
  const manifest = loadManifest();
  const machine = thisMachine();
  assert.ok(machine.reference, `INCONCLUSIVE: this is ${machine.model || 'an unknown model'}, neither reference Mac (Mac15,7, Mac15,12); off them a budget is only a reading`);
  const mergeBase = manifest.app?.mergeBase;
  assert.match(mergeBase ?? '', /^[0-9a-f]{40}$/, 'the manifest records the merge base it was measured against');
  assert.equal(git(root, 'merge-base', '--is-ancestor', mergeBase, 'HEAD').status, 0, `${mergeBase.slice(0, 7)} is not an ancestor of HEAD`);
  const directory = mkdtempSync(join(tmpdir(), 'deep-mark-79-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  cargo(['build', '--release', '-p', 'deep-app'], root);
  const head = strippedSize(join(root, 'target/release/deep-app'), directory);

  // The merge base, checked out from git's object store into a scratch tree and built there, with
  // its own target directory under the repo's so Cargo's cache stays warm across runs.
  const base = join(directory, 'base');
  mkdirSync(base);
  const archive = spawnSync('sh', ['-c', `git archive --format=tar ${mergeBase} | tar -x -C "${base}"`], { cwd: root, encoding: 'utf8' });
  if (archive.status !== 0) throw blocked(`could not check out ${mergeBase.slice(0, 7)} for the base build: ${archive.stderr}`);
  const baseTarget = join(root, 'target/acceptance-79-base');
  cargo(['build', '--release', '-p', 'deep-app'], base, { CARGO_TARGET_DIR: baseTarget });
  const baseSize = strippedSize(join(baseTarget, 'release/deep-app'), directory);

  const growth = head - baseSize;
  t.diagnostic(JSON.stringify({ machine, mergeBase, strippedBytes: { base: baseSize, head }, growth, recorded: manifest.app?.strippedBytes }));
  assert.ok(growth < ASSET_LIMIT, `the stripped app grew ${growth} bytes over the merge base (${baseSize} to ${head}), not under ${ASSET_LIMIT}`);
});
