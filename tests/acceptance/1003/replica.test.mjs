// #1003 AC5: "screenshots of a selected row beside a focused row with its ring, in light and dark, and a look's 16
// terminal colours, taken by the check run from the app at the reference window ... Whether they look right is one taste
// call, recorded; without it the run stays INCONCLUSIVE, never PASS". The replica takes the four screens (README: The
// screenshots and the taste call); this test checks they are the replica's at the reference window, never reads their
// pixels, and passes only with a recorded call of "right" on exactly these pictures. Needs macOS (the replica renders
// with Metal); elsewhere it fails INCONCLUSIVE.
// Run: node --test tests/acceptance/1003/replica.test.mjs
// Set DA1003_SCREENS=<dir> to keep the screens (for the PR and the session); otherwise they go to /tmp/da1003-screens-*
// and are removed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { AC, buildBin, ensureDir, remove, repoRoot, tempRoot } from './common.mjs';
import { RECORD, SHOTS, judgeShot, judgeTaste, pngSize, readRecord, sha256, shotKey } from './taste-judge.mjs';

const keep = process.env.DA1003_SCREENS;

test(`${AC[5]} the replica's screens of a selected row beside a focused row, light and dark, and the 16 terminal colours, at the reference window, with one recorded taste call`, () => {
  if (process.platform !== 'darwin') assert.fail(`INCONCLUSIVE: the replica renders with Metal on macOS only; this is ${process.platform}, so no screens were taken and no taste call can stand`);
  const bin = buildBin('deep-replica', 'deep-replica');
  assert.equal(bin.error, undefined, bin.error);
  const out = keep ?? tempRoot('screens');
  try {
    const failures = [];
    const hashes = {};
    for (const [appearance, view, extra] of SHOTS) {
      const dir = join(out, appearance);
      ensureDir(dir);
      const args = ['--view', view, '--out', dir, '--appearance', appearance, ...extra];
      const run = spawnSync(bin.path, args, { cwd: repoRoot, encoding: 'utf8', timeout: 300_000 });
      const png = join(dir, 'screens', `${view}.png`);
      const snap = join(dir, 'snapshots', `${view}.json`);
      const key = shotKey(appearance, view);
      if (run.status !== 0 || !existsSync(png) || !existsSync(snap)) {
        failures.push(`${key}: deep-replica ${args.join(' ')} exited ${run.status}: ${`${run.stderr}${run.stdout}`.trim().slice(0, 400)}`);
        continue;
      }
      failures.push(...judgeShot(key, { size: pngSize(png), snapshot: JSON.parse(readFileSync(snap, 'utf8')) }));
      hashes[key] = sha256(png);
    }
    assert.deepEqual(failures, []);
    const { verdict, why } = judgeTaste(readRecord(join(repoRoot, RECORD)), hashes);
    if (verdict === 'INCONCLUSIVE') assert.fail(`INCONCLUSIVE: ${why}; the screens are in ${keep ?? '(set DA1003_SCREENS to keep them)'}, SHA-256 ${JSON.stringify(hashes)}`);
    assert.equal(verdict, 'PASS', why);
  } finally {
    if (!keep) remove(out);
  }
});
