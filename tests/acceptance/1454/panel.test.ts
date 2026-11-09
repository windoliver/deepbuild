// AC3 #1454.a94aca43: A panel installed by `deep install` draws in the real app with no flag, and a panel that fails its kit
// doesn't load, naming the kit.
//
// Two packages go in through `deep install` on a real hub, before the app starts: one that passes `panel@1`, and one the
// host's own registerView check takes but `panel@1` refuses (it imports Dialog, which draws outside its parent). The app runs
// with no argument. The first panel's words must be on the window's pixels, which proves the second one's absence means
// something: the window draws installed panels, and that one isn't there. The refusal must name the kit where a person
// reads it, `deep install`'s own output (README, Pinned 5). Gpui-shell's nodes aren't on the accessibility tree, so the window
// is read by its pixels, as words, which no criterion reads for taste.
import { describe, expect, it } from 'vitest';
import { App, appBinary, install, MINUTES, ocr, panelFailures, REFUSED_TEXT, sees, sessionWorld, settled, t26, useCleanup, type Feature } from './helpers.ts';

useCleanup();

interface Run { installed: t26.Ran; refused: t26.Ran; failures: string[] }
async function bothPanels(plant?: Feature): Promise<Run> {
  const world = await sessionWorld();
  const installed = await install(world.home, 'board');
  const refused = await install(world.home, 'fails-panel-kit');
  const app = await App.launch({ home: world.home, binary: await appBinary(...(plant ? [plant] : [])) });
  try {
    const failures = await settled(async () => panelFailures(await ocr(await app.capture('panels')), { refused: true }), 20_000);
    return { installed, refused, failures };
  } finally {
    await app.stop();
  }
}

describe('#1454 panels you installed, in the real app', () => {
  it('AC3 #1454.a94aca43 a panel installed by `deep install` draws in the real app with no flag, and a panel that fails its kit doesn\'t load, naming the kit', async () => {
    const { installed, refused, failures } = await bothPanels();
    expect(installed.code, `deep install of the panel that passes its kit: ${installed.stdout}${installed.stderr}`).toBe(0);
    const said = `${refused.stdout}${refused.stderr}`;
    expect(failures).toEqual([]);
    expect(refused.code, `deep install says the refused panel isn't loaded, by its exit code: ${said}`).not.toBe(0);
    expect(said, 'deep install names the kit the panel failed').toContain('panel@1');
  }, 10 * MINUTES);

  it('AC3 #1454.a94aca43 wrong program: an app that mounts every installed panel, kit or no kit, fails, naming the panel', async () => {
    const { failures } = await bothPanels('plant-panel-skips-kit');
    expect(failures.join('\n')).toContain(`the panel that failed panel@1 was loaded anyway: the window draws "${REFUSED_TEXT}"`);
  }, 10 * MINUTES);

  it('AC3 #1454.a94aca43 wrong program: the panel at the base\'s `--panel` flag alone proves nothing: with no flag and no package the judge fails', async () => {
    const world = await sessionWorld();
    const app = await App.launch({ home: world.home, binary: await appBinary() });
    try {
      const lines = await ocr(await app.capture('none'));
      expect(panelFailures(lines, { refused: false }).join('\n'), `no package, no panel: ${sees(lines)}`).toContain('isn\'t in the window with no flag');
    } finally {
      await app.stop();
    }
  }, 10 * MINUTES);
});
