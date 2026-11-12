// `deep pack rule`: the command that sends pack.rule, your standing rule for a pack's licenses, which the hub takes only
// from your own terminal (#1820). #1820's world is reused by path: two packs installed, their assets on a local server.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { asks, fetchA, readyWorld, until } from '../../../tests/acceptance/1820/helpers.ts';
import { A, PACK_A } from '../../../tests/acceptance/1820/pack.ts';
import { deep } from './hub.js';

it("deep pack rule lets a pack's asset fetch under the rule's license with no ask", async () => {
  const w = await readyWorld();
  const before = (await asks(w)).length;
  const ruled = await deep(w.home, w.work, ['pack', 'rule', PACK_A, 'CC0-1.0']);
  expect(ruled.code, ruled.stderr).toBe(0);
  expect(ruled.stdout).toContain(PACK_A);
  expect((await until(w, fetchA(A.kick))).value.status, 'the rule fetches the CC0 asset').toBe('fetched');
  expect((await asks(w)).length, 'and asks nothing').toBe(before);
}, 900_000);

it('deep pack with arguments it cannot read prints its usage, exits 2 and reaches no hub', async () => {
  const home = mkdtempSync(join(tmpdir(), 'deep-pack-'));
  try {
    for (const args of [[], ['rule'], ['rule', '--all'], ['allow', PACK_A]]) {
      const ran = await deep(home, home, ['pack', ...args]);
      expect(ran.code, `deep pack ${args.join(' ')}: ${ran.stderr}`).toBe(2);
      expect(ran.stderr).toContain('Usage: deep pack rule <owner/name>');
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 120_000);
