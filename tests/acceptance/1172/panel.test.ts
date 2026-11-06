// AC4, its first half: a plug-in panel's bound value past its freshness draws in the look's muted role with its age.
//
// `deep-app --panel fixtures/panel` over the fixture record: one bound value whose reading is 2 minutes past a 60 s
// freshness, and one still fresh, so a program that grays everything fails as one that grays nothing does. Judged on the
// window's pixels: where the value is read on them, and the color its strokes are drawn in; neither a flag nor a text in
// a reply counts. The same window at the base draws the panel's script and no bound value.
import { describe, expect, it } from 'vitest';
import {
  App, appBinary, distance, FRESH_VALUE, groundAndInk, hex, makeWorld, ocr, panelDir, role, sees, settled, STALE_VALUE, useCleanup, type Line, type Picture, type Rgb, type World,
} from './helpers.ts';

useCleanup();
const MINUTES = 60_000;
const squash = (s: string): string => s.replace(/\s/g, '');
const lineOf = (lines: readonly Line[], value: string): Line | undefined => lines.find((l) => squash(l.text).includes(value));

/** Which of these roles a color is closest to, by name. */
function nearest(color: Rgb, roles: readonly string[]): string {
  return [...roles].sort((a, b) => distance(color, role(a, false)) - distance(color, role(b, false)))[0]!;
}
const INKS = ['muted', 'ink_primary', 'ink_secondary'] as const;

function panelFailures(world: World, picture: Picture, lines: readonly Line[]): string[] {
  const out: string[] = [];
  const stale = lineOf(lines, STALE_VALUE);
  const fresh = lineOf(lines, FRESH_VALUE);
  if (!stale) out.push(`the plug-in panel draws no stale value ${STALE_VALUE}: the window's pixels read ${sees(lines)}`);
  if (!fresh) out.push(`the plug-in panel draws no fresh value ${FRESH_VALUE}: the window's pixels read ${sees(lines)}`);
  if (!stale || !fresh) return out;
  const minutes = (Date.now() - world.staleAsOf) / 60_000;
  const age = /\b(\d+)\s*(?:m|min|mins|minutes?)\b/i.exec(stale.text);
  if (!age || Number(age[1]) < Math.floor(minutes) || Number(age[1]) > Math.ceil(minutes)) out.push(`the stale value must show its age, ${minutes.toFixed(1)} min: it reads "${stale.text}"`);
  if (/\b\d+\s*(?:m|min|mins|minutes?)\b/i.test(fresh.text)) out.push(`a fresh value shows no age: it reads "${fresh.text}"`);
  const staleInk = groundAndInk(picture, stale.box).ink;
  const freshInk = groundAndInk(picture, fresh.box).ink;
  if (nearest(staleInk, INKS) !== 'muted') out.push(`the stale value must draw in the look's muted role ${hex(role('muted', false))}: its strokes are ${hex(staleInk)}, nearest ${nearest(staleInk, INKS)}`);
  if (nearest(freshInk, INKS) === 'muted') out.push(`a fresh value must not draw muted: its strokes are ${hex(freshInk)}`);
  return out;
}

describe('#1172 a plug-in panel draws in the app', () => {
  it('AC4 a bound value past its freshness draws in the look\'s muted role with its age, and a fresh one neither, on the window\'s pixels', async () => {
    const world = await makeWorld();
    const app = await App.launch({ home: world.home, binary: await appBinary(), args: ['--panel', panelDir()] });
    const failures = await settled(async () => {
      const picture = await app.capture('panel');
      return panelFailures(world, picture, await ocr(picture));
    });
    await app.stop();
    expect(failures).toEqual([]);
  }, 8 * MINUTES);
});
