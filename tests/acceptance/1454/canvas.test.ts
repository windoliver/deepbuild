// AC4 #1454.913e347e: A session's canvas drawn by `deep_show` appears in the real app's window.
//
// A live session (#806's stand-in, with its own `deep mcp`) files its claim and calls `deep_show` with #806's six-item figure
// while the real app runs. The reply must say presented, with the record holding the revision, and the window's pixels must
// then hold the figure: its two labels as words and its three bars, in the color the hub's own snapshot gives them, in their
// 4:3:2 (helpers.ts, figureFailures). The same window, the same run: no replica, and no other window of the app counts.
import { describe, expect, it } from 'vitest';
import { CLAUDE, expectPresented, expectRecorded, sessionId, showFigure } from '../806/figure.ts';
import { App, appBinary, canvasFailures, figureWorld, MINUTES, t806, useCleanup } from './helpers.ts';

useCleanup();

describe('#1454 the canvas panel in the real app', () => {
  it('AC4 #1454.913e347e a session\'s canvas drawn by `deep_show` appears in the real app\'s window', async () => {
    const f = await figureWorld();
    const app = await App.launch({ home: f.home, binary: await appBinary() });
    try {
      const windows = (await app.windows()).length;
      const shown = await showFigure(f, CLAUDE, t806.t393.DOC.a);
      const sha = await expectPresented(f, CLAUDE, shown.reply);
      await expectRecorded(f, CLAUDE, t806.t393.DOC.a);
      const failures = await canvasFailures(app, f.home, sha, sessionId(CLAUDE));
      expect(failures).toEqual([]);
      expect((await app.windows()).length, 'the figure is in the window you have, not one of its own').toBe(windows);
    } finally {
      await app.stop();
    }
  }, 10 * MINUTES);
});
