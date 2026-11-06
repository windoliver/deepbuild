// #67 AC9: a trusted project's packs load with their views and commands while you're in it; an untrusted project's never
// load. A project names its packs in `.deepbuild/packs.json` (README), here the test pack fixtures/runbook. Trust is
// project trust as #348 landed it: your answer on the trusted path. A pack's code that ran in the sandbox leaves no file
// it could write, so "never load" is read from what the host and the record say: nothing loaded, no action, no process.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC9 } from './hub.ts';
import { openWorld, pkg, tempDir, type World } from './host.ts';

const YOU = { writer: 'app', actor: 'you', scope: 'you' } as const;
/** A project folder naming the pack it comes with. */
function project(): { folder: string; pack: string } {
  const folder = tempDir();
  mkdirSync(join(folder, '.deepbuild'));
  writeFileSync(join(folder, '.deepbuild/packs.json'), JSON.stringify({ packs: ['packs/runbook'] }));
  return { folder, pack: pkg('runbook', join(folder, 'packs/runbook'), {}, {}) };
}
/** That none of the pack's code ran or runs: it isn't loaded, offers no action, and no process started for it. */
async function neverRan(w: World): Promise<void> {
  expect((await w.host.loaded()).map((p) => p.id), 'its pack isn\'t loaded').not.toContain('deepbuild/runbook');
  expect((await w.host.actions()).map((a) => a.action), 'its command isn\'t offered').not.toContain('ext.runbook.restart');
  expect((await w.record.read({ after: 0, limit: 1000 })).filter((e) => e.kind === 'process.tracked'), 'no process started for it').toEqual([]);
}
const BOARD = { name: 'ext.runbook.board', extension: 'deepbuild/runbook', commands: [{ name: 'Restart', action: 'ext.runbook.restart' }] };

describe(`${AC9} a trusted project's packs load with their views and commands while you're in it; an untrusted project's never load`, () => {
  it(`${AC9} an untrusted project's pack runs no code in it and shows nothing; once you trust the project it loads, and shows while you're in it and only then`, async () => {
    const a = project();
    const plain = tempDir();
    const w = await openWorld([a.pack]);

    const refused = await w.host.enterProject(a.folder);
    expect(refused, 'an untrusted project').toEqual({ trusted: false, views: [] });
    await neverRan(w);

    await w.trust.answer(YOU, a.folder, true);
    const shown = await w.host.enterProject(a.folder);
    expect(shown.trusted).toBe(true);
    expect(shown.views, 'its view and its command').toEqual([BOARD]);
    expect(w.host.projectViews(), 'and what the app shows now').toEqual([BOARD]);
    expect((await w.host.loaded()).map((p) => p.id)).toContain('deepbuild/runbook');

    await w.host.leaveProject(a.folder);
    expect(w.host.projectViews(), 'you left: its views go').toEqual([]);
    await w.trust.answer(YOU, plain, true);
    expect((await w.host.enterProject(plain)).views, 'another project shows none of them').toEqual([]);
    await w.host.leaveProject(plain);

    await w.trust.answer(YOU, a.folder, false);
    expect(await w.host.enterProject(a.folder), 'trust taken back: it shows nothing again').toEqual({ trusted: false, views: [] });
    expect((await w.host.loaded()).map((p) => p.id), 'and it no longer runs').not.toContain('deepbuild/runbook');
  }, 120_000);

  it(`${AC9} a pack of a project you never trusted stays out whatever else you trust`, async () => {
    const b = project();
    const trusted = tempDir();
    const w = await openWorld([b.pack]);
    await w.trust.answer(YOU, trusted, true);
    await w.host.enterProject(trusted);
    await expect(w.host.enterProject(b.folder)).resolves.toEqual({ trusted: false, views: [] });
    await neverRan(w);
    expect((await w.host.installed()).map((p) => p.id), 'an untrusted project\'s pack isn\'t even installed').not.toContain('deepbuild/runbook');
  }, 120_000);
});
