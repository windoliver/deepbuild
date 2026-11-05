// AC6: in dark mode the welcome pane's ground is the look's dark ground.
//
// The first launch, in a home with nothing of DeepBuild, no hub and no record: the pane that holds the one Set up button.
// Its ground is read off the window's pixels beside that button. Light is read too, so a pane painted one dark color
// fails as the base's pane painted Paper does; both grounds are the look's (crates/deep-canvas-marks/looks/clean.json).
import { describe, expect, it } from 'vitest';
import { App, appBinary, freshHome, groundAndInk, hex, near, nodes, REFERENCE, role, settled, useCleanup } from './helpers.ts';

useCleanup();
const MINUTES = 60_000;

async function ground(appearance: 'dark' | 'light'): Promise<{ button: boolean; color: string; ok: boolean; want: string }> {
  const want = role('ground', appearance === 'dark');
  const app = await App.launch({ home: freshHome(), binary: await appBinary(), env: { DEEP_APP_APPEARANCE: appearance } });
  try {
    let frame: number[] | undefined;
    await settled(async () => {
      frame = (await app.tree()).windows.flatMap((w) => nodes(w.tree)).find((n) => n.name === 'Set up')?.frame;
      return frame ? [] : ['no Set up button yet'];
    });
    const window = await app.mainWindow();
    const picture = await app.capture(`welcome-${appearance}`);
    // 160 points of the pane beside the button: to its left, on its line, in the picture's device pixels.
    const scale = REFERENCE.scale;
    const box = frame && [(frame[0]! - window.frame[0]! - 180) * scale, (frame[1]! - window.frame[1]!) * scale, 160 * scale, frame[3]! * scale];
    const color = box ? groundAndInk(picture, box).ground : ([0, 0, 0] as const);
    return { button: frame !== undefined, color: hex(color), ok: near(color, want, 4), want: hex(want) };
  } finally {
    await app.stop();
  }
}

describe('#1172 the welcome pane takes its colors from the look and the appearance', () => {
  it('AC6 in dark mode the welcome pane\'s ground is the look\'s dark ground', async () => {
    const { button, color, ok, want } = await ground('dark');
    expect(button, 'a first launch shows the welcome pane, with Set up').toBe(true);
    expect(ok, `the welcome pane's ground in dark mode is ${color}, not the look's dark ground ${want}`).toBe(true);
  }, 8 * MINUTES);

  it('AC6 wrong program: in light mode the same pane\'s ground is the look\'s light ground, so one color for both fails', async () => {
    const { button, color, ok, want } = await ground('light');
    expect(button, 'a first launch shows the welcome pane, with Set up').toBe(true);
    expect(ok, `the welcome pane's ground in light mode is ${color}, not the look's ground ${want}`).toBe(true);
  }, 8 * MINUTES);
});
