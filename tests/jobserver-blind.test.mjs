// #2848: a run whose fuser can't see its jobserver pipe never refills it, so tokens a SIGKILLed build held stay lost,
// and the run must say so: its summary reads INCONCLUSIVE with a jobserver line, never PASS. Reached by running #2848's
// blind acceptance scenario with a fuser that sees nothing first on PATH. The wrong program is a run that only prints the
// JOBSERVER line (c9dad6f75): the later build finds 16 of 19 tokens and the run reads PASS, so the scenario fails.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const CHECKOUT = fileURLToPath(new URL('../', import.meta.url));

test('#2848 a run whose fuser cannot see the jobserver pipe reads INCONCLUSIVE once a killed build lost tokens', () => {
  const bin = mkdtempSync(join(tmpdir(), 'deep-blind-fuser-'));
  try {
    writeFileSync(join(bin, 'fuser'), '#!/bin/sh\nexit 1\n');
    chmodSync(join(bin, 'fuser'), 0o755);
    // A nested node --test that inherits this run's NODE_TEST_CONTEXT skips its files.
    const { NODE_TEST_CONTEXT, ...env } = process.env;
    const run = spawnSync(process.execPath, ['--test', 'tests/acceptance/2848/refill.test.mjs'], { cwd: CHECKOUT, encoding: 'utf8', env: { ...env, PATH: `${bin}${delimiter}${env.PATH}` } });
    const out = `${run.stdout}\n${run.stderr}`;
    assert.equal(run.status, 0, `the #2848 scenario failed with a blind fuser\n${out}`);
    // The scenario's planted tests all pass, so its one inconclusive result is the jobserver's: a run INCONCLUSIVE only
    // for files it left unrun counts none.
    assert.match(out, /the run's summary: INCONCLUSIVE affected: 0 new, 0 already failing on main, 1 inconclusive or blocked,/, `the run didn't read INCONCLUSIVE for its jobserver\n${out}`);
    const [, found, share] = out.match(/the later job found (\d+); the share is (\d+)/) ?? [];
    assert.ok(Number(found) < Number(share), `the killed build's tokens weren't lost, so the INCONCLUSIVE proves nothing (found ${found} of ${share})\n${out}`);
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
});
