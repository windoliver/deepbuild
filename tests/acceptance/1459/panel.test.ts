// AC5: a panel that calls `deepbuild.needs_you()` in the real app gets the open asks from the hub, with no fixture. The
// real `deep-app --panel fixtures/panels/asks` (#1172's flag) on #1172's world: a real hub on a temp home whose record holds
// two sessions and three open asks, and no fixture record anywhere. The panel draws what the call gave it; the window's
// pixels are read as text from outside the app. At the base the call fails with `no fixture record is loaded`.
import { describe, expect, it } from 'vitest';
import { appBinary, makeWorld, useCleanup } from '../1172/helpers.ts';
import { fixtureCopy, ID, RealApp, reads, settled, type Line } from './helpers.ts';

useCleanup();
const MIN = 60_000;
const sees = (lines: readonly Line[]): string => JSON.stringify(lines.map((l) => l.text)).slice(0, 1200);

describe(`AC5 ${ID.panel} A panel that calls \`deepbuild.needs_you()\` in the real app gets the open asks from the hub, with no fixture`, () => {
  it('AC5 in the real app, the panel reads the hub\'s three open asks, each by its question, and no fixture', async () => {
    const world = await makeWorld();
    const app = await RealApp.launch(world.home, await appBinary(), ['--panel', fixtureCopy('panels', 'asks')]);
    try {
      const failures = await settled(async () => {
        const lines = await app.lines();
        const out: string[] = [];
        if (lines.some((l) => /fixture record/i.test(l.text))) out.push(`the panel's call read no record: the window reads ${sees(lines)}`);
        if (!reads(lines, `Panel reads ${world.asks.length} open asks`)) out.push(`the panel didn't get the hub's ${world.asks.length} open asks: the window reads ${sees(lines)}`);
        for (const ask of world.asks) if (!reads(lines, ask.question)) out.push(`the panel didn't get ${ask.handle}, "${ask.question}", from the hub`);
        return out;
      }, 60_000);
      expect(failures).toEqual([]);
    } finally {
      await app.stop();
    }
  }, 15 * MIN);
});
