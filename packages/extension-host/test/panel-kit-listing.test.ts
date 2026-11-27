// #3233: where the app lists a view you installed. Beside what panel@1 said of its panel, the listing holds the kit
// revision the panel was held to and, for one held to an earlier revision, what the current one would refuse in it;
// both are kept across a restart of the hub. A real package runs through a real host, record and supervisor.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { openAsks } from '@deepbuild/asks';
import { openRecord } from '@deepbuild/record';
import { openSupervisor } from '@deepbuild/supervisor';
import { openExtensionHost, openTrust, packageDigest, type ExtensionHost } from '../src/index.js';
import { cleanup, closing, pkgOf, temp } from './package.js';

afterAll(cleanup);

const READING = 'held to revision 1; revision 2 would refuse it: no_name: the div refresh-control takes a press and has no name';

/** A package whose one view, ext.board.view, draws the panel in its `panel` folder. */
function board(): string {
  const folder = pkgOf('test/board', "export default async function (deep: any): Promise<void> {\n  await deep.registerView('ext.board.view', 'panel', 'sidebar');\n}\n", { access: { words: ['record'] }, panels: [{ name: 'ext.board.view', area: 'sidebar' }] });
  mkdirSync(join(folder, 'panel'));
  writeFileSync(join(folder, 'panel', 'main.js'), 'export default class Board {}\n');
  const manifest = { ...(JSON.parse(readFileSync(join(folder, 'deepbuild.json'), 'utf8')) as Record<string, unknown>), digest: '' };
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify({ ...manifest, digest: packageDigest(folder) }));
  return folder;
}

test('a view\'s listing holds the kit revision its panel was held to and what the current one would refuse, across a restart', async () => {
  const dir = temp();
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  closing.push(record, supervisor);
  const trust = await openTrust({ record, now: Date.now });
  const home = join(dir, 'home');
  mkdirSync(home);
  const open = async (): Promise<ExtensionHost> => {
    const h = await openExtensionHost({ record, supervisor, trust, home, now: Date.now, release: [] });
    closing.push(h);
    await h.ready();
    return h;
  };
  const listed = (h: ExtensionHost): unknown[] => h.installedViews().map((v) => [v.name, v.kit, v.revision, v.reading]);

  const h = await open();
  const p = await h.install({ from: board(), builtBy: null });
  expect((await h.check(p)).passed).toBe(true);
  expect((await h.load(p)).status).toBe('loaded');
  expect(listed(h), 'before its kit ran, a view lists none').toEqual([['ext.board.view', null, undefined, undefined]]);

  h.keepKit(p.id, { slot: 'panel@1', fill: 'ext.board.view', verdict: 'PASS', revision: 1, reading: READING });
  expect(listed(h)).toEqual([['ext.board.view', 'PASS', 1, READING]]);

  // A panel held to the current revision has nothing the kit would refuse, so its listing has no reading.
  h.keepKit(p.id, { slot: 'panel@1', fill: 'ext.board.view', verdict: 'PASS', revision: 2 });
  expect(listed(h)).toEqual([['ext.board.view', 'PASS', 2, undefined]]);

  h.keepKit(p.id, { slot: 'panel@1', fill: 'ext.board.view', verdict: 'PASS', revision: 1, reading: READING });
  await h.close();
  const again = await open();
  const [kept] = await again.installed();
  expect((await again.load(kept!)).status).toBe('loaded');
  expect(listed(again), 'kept across a restart').toEqual([['ext.board.view', 'PASS', 1, READING]]);
}, 120_000);
