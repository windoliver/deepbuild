// AC3, AC4: the app reports views/shown and views/hidden on the app API (#34). The other tests drive the extension
// host's side of these reports on the controlled clock (helpers.ts, App); this one checks the hub's socket serves the
// two methods to the app, so the app's reports reach that side. A real hub, started as #16's and #34's tests start it,
// in a home under /tmp/dh262-*, stopped by its PID.
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, openAs, startHub, stopHub, tokenOf, installedRoot } from '../16/helpers.ts';
import { tempDir } from './helpers.ts';

afterAll(cleanup, 60_000);

const REPORT = { view: 'ext.shop.board', window: 'window:ext.shop.board', visible: true, minimized: false, display_awake: true, session_locked: false, replica: false };

describe('AC3 #262.19fbe9a5 A source with `while_shown: {every: 10 s}` bound by one view makes 6 calls, plus or minus one, in 60 s while the view is shown, still 6 with two views shown that bind it, and none from 10 s after the last is hidden; a host that keeps calling for a hidden view, or runs one cadence per view, fails, naming the source', () => {
  it('AC3 the hub\'s app API serves views/shown and views/hidden to the app (views.shown, views.hidden on its socket)', async () => {
    const home = join(tempDir('hub'), 'h');
    mkdirSync(home);
    const hub = await startHub({ home });
    try {
      const app = await openAs(hub.socket, 'app', tokenOf(installedRoot(home)));
      try {
        for (const [method, params] of [['views.shown', REPORT], ['views.hidden', { view: REPORT.view, window: REPORT.window }]] as const) {
          const reply = await app.call(method, params);
          const code = (reply.error as { code?: string } | undefined)?.code;
          // The view is one no plug-in registered here, so the reply may refuse it; it may not be a method the hub lacks.
          expect(code, `${method}: ${JSON.stringify(reply)}`).not.toBe('unknown_method');
        }
      } finally {
        app.close();
      }
    } finally {
      await stopHub(hub);
    }
  }, 120_000);
});
