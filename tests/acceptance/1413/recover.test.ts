// #1413.acbc8cc2: when the planted failure clears, the view returns from documents, with step hashes equal to an
// unbroken run. Started with `--fail-reopen 3`, the planted reopen fails three times and then clears. Alpha's view
// draws a moving scene; the device is lost at frame 30, the three reopens fail and the view takes the placeholder
// rung; at frame 600 a GPU-change notification retries, the reopen succeeds and the view returns, rebuilt from its
// document. Each frame it draws after that, settled, must hash as the same frame of an unbroken run in a fresh
// process. At the base there is no `test-faults` feature, so the binary doesn't build.
import { describe, expect, it } from 'vitest';
import { REOPENS, W, liveCall, liveReply, run, sceneDoc, useBuild, useDir, viewOf, writeDoc } from './helpers.ts';

const bin = useBuild();
const dir = useDir();
const LOSS = 30;
const CHANGE = 600;
const FRAMES = 720;
const AT_LEAST = 60;

describe('#1413.acbc8cc2 when the planted failure clears, the view returns from documents, with step hashes equal to an unbroken run', () => {
  it('#1413.acbc8cc2 after three failed reopens and a GPU-change notification, alpha returns and every settled frame after hashes as an unbroken run\'s', () => {
    const d = dir();
    const plain = writeDoc(d, 'plain', sceneDoc('Plain'));
    const session = [{ session: 'alpha', writer: W.alpha, doc: plain }];
    const broken = liveReply(run(bin(), d, [liveCall({
      frames: FRAMES, sessions: session,
      events: [{ frame: LOSS, lose_device: {} }, { frame: CHANGE, gpu_change: {} }],
      report: ['hashes'],
    })], { failReopen: REOPENS }).replies[0]!, 'the live call with the planted failure clearing');
    const unbroken = liveReply(run(bin(), d, [liveCall({ frames: FRAMES, sessions: session, report: ['hashes'] })]).replies[0]!, 'the unbroken run');

    expect(broken.device_losses, 'the device was lost once').toBe(1);
    expect(broken.reopens.map((r) => r.ok), 'three failed reopens, then the one the GPU change asks for succeeds').toEqual([false, false, false, true]);
    expect(broken.reopens[REOPENS]!.frame, 'the successful reopen follows the GPU-change notification').toBeGreaterThanOrEqual(CHANGE);
    expect(viewOf(broken.frames.find((f) => f.frame === CHANGE - 1)!, 'alpha').rung, 'before the notification the view holds the placeholder rung').toBe('placeholder');

    const back = broken.frames.find((f) => f.frame >= CHANGE && viewOf(f, 'alpha').drawn && viewOf(f, 'alpha').rung === 'base');
    expect(back, 'the view returns, drawn at its base rung, once the failure clears').toBeDefined();
    const clean = new Map(unbroken.frames.map((f) => [f.frame, viewOf(f, 'alpha')]));
    const after = broken.frames.filter((f) => f.frame >= back!.frame).map((f) => ({ frame: f.frame, view: viewOf(f, 'alpha') })).filter((x) => x.view.drawn && x.view.settled);
    expect(after.length, `at least ${AT_LEAST} settled frames drawn after the return (${FRAMES - back!.frame + 1} frames remain)`).toBeGreaterThanOrEqual(AT_LEAST);
    const differ = after.filter((x) => {
      const c = clean.get(x.frame);
      return !c || !c.drawn || x.view.pixel_hash === null || x.view.pixel_hash !== c.pixel_hash;
    }).map((x) => x.frame);
    expect(differ, 'every settled frame after the return hashes as the unbroken run\'s same frame').toEqual([]);
    expect(new Set(after.map((x) => x.view.pixel_hash)).size, 'the returned view draws a new picture each frame, from its document\'s time').toBe(after.length);
  }, 3_600_000);
});
