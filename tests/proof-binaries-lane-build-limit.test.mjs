// The lanes' builds run as long as cargo needs (owner, 2026-11-19): a cold deep-hook and deep-show build in a bay ran
// past the 20-minute limit at load 110 and every before lane read BLOCKED. A build stopped or failed still reads BLOCKED.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const table = mkdtempSync(join(tmpdir(), 'deep-build-timeout-'));
process.env.DEEP_THROTTLE_TABLE = table;
const { buildBinaries } = await import('../scripts/proof-binaries.mjs');
test.after(() => rmSync(table, { recursive: true, force: true }));

// Stands in for spawnSync at the cargo call only; the build owner's `ps` runs for real.
function cargo(result) {
  const seen = [];
  const run = (command, args, options) => {
    seen.push(options);
    return result;
  };
  return { run, seen };
}
const bin = () => join(mkdtempSync(join(tmpdir(), 'deep-build-timeout-bin-')), 'bin');

test('a build with timeout 0 runs as long as cargo needs; without one it keeps the 20-minute limit', () => {
  const ok = { status: 0, stdout: `${JSON.stringify({ reason: 'compiler-artifact', target: { name: 'deep-hook', kind: ['bin'] }, executable: process.execPath, profile: { test: false } })}\n${JSON.stringify({ reason: 'build-finished', success: true })}\n` };
  const unlimited = cargo(ok);
  buildBinaries(process.cwd(), bin(), ['deep-hook'], unlimited.run, { timeout: 0 });
  assert.equal(unlimited.seen.length, 1);
  assert.equal(unlimited.seen[0].timeout, undefined, 'a lane build is never cut short');
  const limited = cargo(ok);
  buildBinaries(process.cwd(), bin(), ['deep-hook'], limited.run);
  assert.equal(limited.seen[0].timeout, 20 * 60_000);
});

test('a build stopped by a signal, or one that fails, reads BLOCKED with or without a limit', () => {
  for (const options of [{ timeout: 0 }, undefined]) {
    assert.throws(() => buildBinaries(process.cwd(), bin(), ['deep-hook'], cargo({ status: null, signal: 'SIGTERM', stdout: '', stderr: '' }).run, options), /^Error: BLOCKED test binaries: cargo build failed/);
    assert.throws(() => buildBinaries(process.cwd(), bin(), ['deep-hook'], cargo({ status: 101, stdout: '', stderr: 'error: could not compile' }).run, options), /^Error: BLOCKED test binaries: cargo build failed: error: could not compile/);
  }
});
