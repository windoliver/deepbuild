// `deep library on | off | rule`: the commands that send library.on, library.off and library.rule, which the hub takes
// only from your own terminal (#1731). Before them a library could be installed and never turned on, so deep_kinds'
// asset search had no library to search. #1731's world is reused by path: its fill is installed, and off.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { asks, fetchArgs, fetchUntilDone, kinds, LIB, libraryRows, openWorld, refusal, search } from '../../../tests/acceptance/1731/helpers.ts';
import { deep } from './hub.js';

it('deep library on puts an installed library in the search, rule fetches its license with no ask, and off takes it out, naming the command that turns it on', async () => {
  const w = await openWorld();
  expect(w.install.code, `deep install of the fill: ${w.install.stderr}`).toBe(0);
  expect(libraryRows((await search(w)).rows), 'a library ships off').toEqual([]);

  const unknown = await deep(w.home, w.work, ['library', 'on', 'ext.none.library']);
  expect(unknown.code, unknown.stderr).toBe(2);
  expect(unknown.stderr).toContain('ext.none.library');

  const on = await deep(w.home, w.work, ['library', 'on', LIB]);
  expect(on.code, on.stderr).toBe(0);
  expect(on.stdout).toContain(LIB);
  expect(libraryRows((await search(w)).rows).map((r) => r.id), 'turned on, the library is searched').toContain('oak-chair');

  const ruled = await deep(w.home, w.work, ['library', 'rule', LIB, 'CC0-1.0']);
  expect(ruled.code, ruled.stderr).toBe(0);
  const before = (await asks(w)).length;
  expect((await fetchUntilDone(w, 'pine-chair')).value.status, 'the rule fetches a CC0 chair').toBe('fetched');
  expect((await asks(w)).length, 'and asks nothing').toBe(before);

  const off = await deep(w.home, w.work, ['library', 'off', LIB]);
  expect(off.code, off.stderr).toBe(0);
  expect(libraryRows((await search(w)).rows), 'turned off, the library leaves the search').toEqual([]);
  expect(refusal(await kinds(w, fetchArgs('oak-chair'))), 'the refused fetch names the command that turns it on').toContain(`deep library on ${LIB}`);
}, 900_000);

it('deep library with arguments it cannot read prints its usage, exits 2 and reaches no hub', async () => {
  const home = mkdtempSync(join(tmpdir(), 'deep-library-'));
  try {
    for (const args of [[], ['on'], ['on', LIB, 'more'], ['on', '--force'], ['rule'], ['sideways', LIB]]) {
      const ran = await deep(home, home, ['library', ...args]);
      expect(ran.code, `deep library ${args.join(' ')}: ${ran.stderr}`).toBe(2);
      expect(ran.stderr).toContain('Usage: deep library on <library>');
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 120_000);
