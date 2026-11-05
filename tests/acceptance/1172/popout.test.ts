// AC5: after a view pops out to its own window, the main window no longer draws it.
//
// Judged on the main window's pixels and its accessibility tree, after a person's press on the view's Pop out control;
// the design's `panel_visible` flag isn't read. Before the press the same reading finds the view, so a reading that sees
// nothing can't pass, and the new window must draw it, so a view that merely disappears can't either.
import { describe, expect, it } from 'vitest';
import { App, appBinary, captureWindow, makeWorld, nodes, ocr, reads, sees, settled, sleep, tempDir, useCleanup, type Win } from './helpers.ts';

useCleanup();
const MINUTES = 60_000;
export const POP_OUT = 'Pop out Needs you';

describe('#1172 a popped-out view leaves the main window', () => {
  it('AC5 after Needs you pops out to its own window, the main window no longer draws it and the new window does', async () => {
    const world = await makeWorld();
    const app = await App.launch({ home: world.home, binary: await appBinary() });
    const questions = world.asks.map((a) => a.question);
    const dir = tempDir();
    try {
      const drawn = await settled(async () => {
        const picture = await app.capture('before');
        const lines = await ocr(picture);
        return questions.filter((q) => !reads(lines, q)).map((q) => `before the pop-out the main window should draw "${q}": its pixels read ${sees(lines)}`);
      });
      expect(drawn, 'the reading sees the view in the main window before it pops out').toEqual([]);
      const press = await app.press(POP_OUT);
      expect(press, `the window has a "${POP_OUT}" control a person can press`).toMatchObject({ found: true, pressed: true });
      let list: Win[] = [];
      await settled(async () => { list = await app.windows(); return list.length === 2 ? [] : ['one window']; }, 6000);
      expect(list.length, 'the view opens in a window of its own').toBe(2);

      const tree = await app.tree();
      const mainAx = tree.windows.find((w) => nodes(w.tree).some((n) => n.name === 'Sessions'));
      const poppedAx = tree.windows.find((w) => w !== mainAx);
      expect(mainAx, 'the main window is the one that keeps the sidebar').toBeDefined();
      expect(poppedAx, 'the popped window').toBeDefined();
      const of = (frame: number[]): Win => list.find((w) => w.frame.every((v, i) => Math.abs(v - frame[i]!) < 2)) ?? (() => { throw Error(`BLOCKED: no window at ${JSON.stringify(frame)}: ${JSON.stringify(list)}`); })();
      const [main, popped] = [of(mainAx!.frame), of(poppedAx!.frame)];
      const failures = await settled(async () => {
        const out: string[] = [];
        const mainNow = (await app.tree()).windows.find((w) => nodes(w.tree).some((n) => n.name === 'Sessions'));
        const lines = await ocr(await captureWindow(main.id, `${dir}/main.png`));
        for (const q of questions) {
          if (nodes(mainNow!.tree).some((n) => n.name.includes(q))) out.push(`the main window's tree still holds "${q}"`);
          if (reads(lines, q)) out.push(`the main window still draws "${q}" on its pixels`);
        }
        return out;
      }, 4000);
      expect(failures, 'the main window no longer draws the view').toEqual([]);
      await sleep(300);
      const shown = await ocr(await captureWindow(popped.id, `${dir}/popped.png`));
      expect(questions.filter((q) => !reads(shown, q)), `the popped window draws the view: its pixels read ${sees(shown)}`).toEqual([]);
    } finally {
      await app.stop();
    }
  }, 8 * MINUTES);
});
