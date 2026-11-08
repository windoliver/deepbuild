// AC2 #1454.ecdbb26a: ⌘K opens in the real app and lists a page and a command. Opening one fills the page.
//
// The page and the command are the ones an installed plug-in registers, with `deep.registerView`'s pages and commands, as
// #366 has them (README, The fixtures). ⌘K is posted to the app's process from outside; its two entries must be on the
// window's tree and on its pixels; a press on the page's entry must draw that page's text, with its parameter, in the page,
// right of the list, on the same window. So a palette that lists and opens nothing, one that opens the view's main page, or
// one that fills the sidebar's slot all fail.
import { describe, expect, it } from 'vitest';
import {
  App, appBinary, commandFailures, install, MINUTES, openCommands, PAGE_ENTRY, PAGE_TEXT, pageFailures, sessionWorld, settled, useCleanup, type Feature,
} from './helpers.ts';

useCleanup();

async function openPage(plant?: Feature): Promise<{ failures: string[]; page: string[] }> {
  const world = await sessionWorld();
  const installed = await install(world.home, 'board');
  if (installed.code !== 0) return { failures: [`deep install exited ${installed.code}: ${installed.stdout}${installed.stderr}`], page: [] };
  const app = await App.launch({ home: world.home, binary: await appBinary(...(plant ? [plant] : [])) });
  try {
    const failures = await openCommands(app);
    if (failures.length) return { failures, page: [] };
    const windows = (await app.windows()).length;
    const press = await app.press(PAGE_ENTRY);
    if (!press.pressed) return { failures: [`⌘K's entry "${PAGE_ENTRY}" took no press: ${JSON.stringify(press)}`], page: [] };
    const page = await settled(() => pageFailures(app));
    if ((await app.windows()).length !== windows) page.push(`"${PAGE_ENTRY}" opened a window of its own, not the page`);
    return { failures: [], page };
  } finally {
    await app.stop();
  }
}

describe('#1454 ⌘K in the real app', () => {
  it('AC2 #1454.ecdbb26a ⌘K opens in the real app and lists a page and a command, and opening the page fills the page', async () => {
    const { failures, page } = await openPage();
    expect([...failures, ...page]).toEqual([]);
  }, 10 * MINUTES);

  it('AC2 #1454.ecdbb26a wrong program: a page opened without its parameter fails, naming the entry', async () => {
    const { failures, page } = await openPage('plant-page-drops-param');
    expect(failures, 'the planted build lists both entries').toEqual([]);
    expect(page.join('\n')).toContain(`opening "${PAGE_ENTRY}" didn't fill the page: the window's pixels lack "${PAGE_TEXT}"`);
  }, 10 * MINUTES);

  it('AC2 #1454.ecdbb26a ⌘K with nothing installed still opens, and the same judge says what it lacks', async () => {
    const world = await sessionWorld();
    const app = await App.launch({ home: world.home, binary: await appBinary() });
    try {
      await app.commandK();
      const failures = await commandFailures(app);
      expect(failures.join('\n'), 'no plug-in, no entry: the judge can\'t pass on an empty list').toContain(`⌘K lists no entry named "${PAGE_ENTRY}"`);
    } finally {
      await app.stop();
    }
  }, 10 * MINUTES);
});
