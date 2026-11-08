// Wrong programs on the real window, through the same judges as first-screen.test.ts. They carry no criterion tag: each
// passes when the judge rejects the wrong program, so they pass at the base and after a right fix alike.
//   plant-spike-window  an app whose window isn't the shell a replica proves: no Set up, a made-up count
//   record-first        a setup that writes its record first and keeps it: the app opens on "0 asks need you", as the
//                       issue says the merge base does, and a hub that never started goes unoffered
//   no-record           a setup that finishes without its record
import { afterAll, describe, expect, it } from 'vitest';
import { breakSettings, cleanup, deep, finishedRecord, fixSettings, makeHome, settingsFile } from '../helpers.ts';
import { onPixels } from './window.ts';
import { namesTheFile, namesTheHub, offeredFailures, open, plantDeep, pressSetUp, SETUP_MS, startHub } from './helpers.ts';

afterAll(cleanup, 60_000);

const MINUTES = 60_000;

describe('#1002 (wrong program) the real window', () => {
  it('a planted spike window, no shell, fails naming the count', async () => {
    const h = makeHome();
    breakSettings(h.home);
    expect((await deep(h.home, ['setup'])).code, 'setup stops on the unparseable file').not.toBe(0);
    const app = await open(h, { plant: 'plant-spike-window' });
    const { failures } = await app.settled((s) => offeredFailures(s, { file: settingsFile(h.home) }), 20_000);
    await app.stop();
    expect(failures.join('\n')).toMatch(/the count must read setup didn't finish/);
  }, 30 * MINUTES);

  it('a setup that writes its record first opens on "0 asks need you" and fails, naming the count', async () => {
    const h = makeHome();
    plantDeep(h, 'record-first');
    breakSettings(h.home);
    const first = await open(h);
    await pressSetUp(first);
    await first.settled(namesTheFile, SETUP_MS);
    await first.stop();
    await startHub(h);
    const app = await open(h);
    const { seen } = await app.settled((s) => (onPixels(s, '0 asks need you') ? [] : ['not yet']));
    await app.stop();
    const failures = offeredFailures(seen, { file: settingsFile(h.home) });
    expect(failures[0], 'the count is judged first').toMatch(/the count must read setup didn't finish, never 0: the window reads "0 asks need you"/);
    expect(failures.join('\n')).toMatch(/must offer Set up again/);
  }, 15 * MINUTES);

  it('a setup that writes its record first, whose hub doesn\'t start, is never offered again and fails', async () => {
    const h = makeHome();
    plantDeep(h, 'record-first');
    fixSettings(h.home);
    const first = await open(h, { hub: 'dead' });
    await pressSetUp(first);
    await first.settled(namesTheHub, SETUP_MS);
    await first.stop();
    const app = await open(h, { hub: 'dead' });
    const { failures } = await app.settled((s) => offeredFailures(s, 'hub'), 20_000);
    await app.stop();
    expect(failures.join('\n')).toMatch(/must offer Set up again: no button named "Set up"/);
  }, 15 * MINUTES);

  it('a Set up that finishes without its record fails, naming the record', async () => {
    const h = makeHome();
    plantDeep(h, 'no-record');
    fixSettings(h.home);
    const app = await open(h);
    await pressSetUp(app);
    await app.settled((s) => (onPixels(s, 'watch-only') ? [] : ['not yet']), SETUP_MS);
    await app.stop();
    await expect(finishedRecord(h.home, 'the app\'s Set up')).rejects.toThrow(/must write its record/);
  }, 15 * MINUTES);
});
