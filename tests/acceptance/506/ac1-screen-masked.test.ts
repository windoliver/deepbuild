// AC1: "An inset stays masked to its window through motion and taking apart, and a second-camera inset shows the same
// evaluated frame"
//
// The masked screen (helpers.ts: screenDoc): a display whose `screen` part is the window, turning about +Y from −20°
// to 20° over 4 s while a take-apart lifts it 0.5 m and brings it 0.4 m forward from 1 s to 1.5 s and back from 3 s
// to 3.5 s; its inset's content overflows the window on every side. Played at 10 fps (frames 0 to 39), every frame:
// no pixel showing the content lies more than 1.5 px outside the window's quad, worked out from the document (the
// take-apart's share of the apart vector, the turn, the screen's plane), and at least 98% of the pixels 2 px or more
// inside it show the content. A screen whose content leaks past its window, or stays where the part was, fails,
// naming the frame and the pixel.
//
// The second-camera inset (feedDoc): a display seen straight on whose inset shows a ball rolling 1 m a second from the
// camera `side`. Played at 10 fps, every frame: the ball's centre inside the window (its redness-weighted centroid)
// lies within 2 px of where the side camera sees it at that frame's time, mapped from the inset's texels onto the
// window; a frame earlier it would lie about 6 px away. An inset that shows another frame's evaluation, or nothing,
// fails, naming the frame.
import { describe, expect, it } from 'vitest';
import {
  FEED, FEED_CAM, MASKED, MASKED_CAM, TIMEOUT, ac, apartShare, contentPixel, feedBall, feedDoc, feedWindow, finalOf, fmt, frameSeconds, framesOf,
  look, none, px, quadInside, redCentroid, requireGpu, rgbText, runGpu, screenDoc, useBins, useDir, view3d, windowQuad, writeJson,
} from './helpers.ts';

const bin = useBins(['deep-gpu']);
const dir = useDir();

describe(`${ac(1)} an inset stays in its window, and a second-camera inset shows the same frame`, () => {
  it(`${ac(1)} the screen's content stays inside its window in every frame of the turn and the take-apart`, () => {
    requireGpu();
    const out = dir();
    const [reply] = runGpu(bin('deep-gpu'), out, [view3d({ doc: writeJson(out, 'screen', screenDoc()), look: look(), size: MASKED_CAM.size, fps: MASKED.fps, frames: MASKED.frames, capture: 'every' })]);
    const frames = framesOf(reply!, 'the masked screen');
    expect(frames.length, 'the masked screen: one frame per frame asked').toBe(MASKED.frames);
    const failures: string[] = [];
    let apart = 0;
    for (const f of frames) {
      const t = frameSeconds(f.frame, MASKED.fps);
      if (apartShare(t) > 0) apart++;
      const q = windowQuad(t);
      const im = finalOf(out, f, `frame ${f.frame}`);
      let outside = 0; let first = ''; let deep = 0; let shown = 0;
      for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
        const c = px(im, x, y);
        const { inside, edge } = quadInside(q, x + 0.5, y + 0.5);
        if (contentPixel(c) && !inside && edge > 1.5) { outside++; if (!first) first = `(${x}, ${y}) reads ${rgbText(c)}, ${fmt(edge)} px outside`; }
        if (inside && edge >= 2) { deep++; if (contentPixel(c)) shown++; }
      }
      const when = `frame ${f.frame} (t = ${fmt(t)} s, taken apart by ${fmt(apartShare(t))})`;
      if (outside) failures.push(`${when}: ${outside} pixels of the screen's content draw outside its window; first ${first}`);
      if (deep < 2000) failures.push(`${when}: the window covers only ${deep} pixels (the fixture puts it across thousands)`);
      else if (shown < 0.98 * deep) failures.push(`${when}: ${shown} of the ${deep} pixels inside the window show the content, under 98%`);
    }
    expect(apart, 'the fixture: frames while the display is taken apart').toBeGreaterThanOrEqual(10);
    none(failures, 'the screen stays masked to its window through the turn and the take-apart');
  }, TIMEOUT);

  it(`${ac(1)} the second-camera inset shows the rolling ball where the side camera sees it at each frame's own time`, () => {
    requireGpu();
    const out = dir();
    const [reply] = runGpu(bin('deep-gpu'), out, [view3d({ doc: writeJson(out, 'feed', feedDoc()), look: look(), size: FEED_CAM.size, fps: FEED.fps, frames: FEED.frames, capture: 'every' })]);
    const frames = framesOf(reply!, 'the second-camera inset');
    expect(frames.length, 'the second-camera inset: one frame per frame asked').toBe(FEED.frames);
    const [x0, y0, x1, y1] = feedWindow();
    const failures: string[] = [];
    for (const f of frames) {
      const t = frameSeconds(f.frame, FEED.fps);
      const im = finalOf(out, f, `frame ${f.frame}`);
      const c = redCentroid(im, (x, y) => x + 0.5 >= x0 + 2 && x + 0.5 <= x1 - 2 && y + 0.5 >= y0 + 2 && y + 0.5 <= y1 - 2);
      const [ex, ey] = feedBall(t);
      const when = `frame ${f.frame} (t = ${fmt(t)} s)`;
      if (!(c.weight >= 100)) { failures.push(`${when}: the window shows no ball (red weight ${fmt(c.weight)}); the side camera sees it at (${fmt(ex)}, ${fmt(ey)})`); continue; }
      const off = Math.hypot(c.x - ex, c.y - ey);
      if (off > 2) failures.push(`${when}: the ball's centre shows at (${fmt(c.x)}, ${fmt(c.y)}) px, ${fmt(off)} px from (${fmt(ex)}, ${fmt(ey)}), where the side camera sees it at this frame's time`);
    }
    // The fixture: one frame's roll moves the ball's image by more than the tolerance, so a stale frame can't pass.
    const step = Math.hypot(feedBall(frameSeconds(1, FEED.fps))[0] - feedBall(0)[0], feedBall(frameSeconds(1, FEED.fps))[1] - feedBall(0)[1]);
    expect(step, 'the fixture: one frame moves the ball over 4 px on the screen').toBeGreaterThan(4);
    none(failures, 'the second-camera inset shows the same evaluated frame');
  }, TIMEOUT);
});
