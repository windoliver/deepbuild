// AC1 #493.0b1b1a95: A 4 s log zoom at 60 fps with the linear ease, from a view 1.3e7 m wide on a planet to one
// 1.3e13 m wide on its star, keeps the ratio of view widths of each two consecutive frames at 10^(6 ÷ 240) within
// 1e-9 relative and ends on each end width within 1e-9 relative; a planted zoom that eases the view width instead of
// its logarithm makes the first step's ratio over 4,000 and fails, naming the frame.
//
// Through `deep-motion eval`: shot `zoom` [0, 4 s), `move: log_zoom`, `ease: linear`, its framed pose an explicit one
// (`target`, `view_width: 1.3e13`) and `by: 1e-6`, so it starts from 1.3e7 m (Shot: "log_zoom moves in log space ...
// from by times the framed view width, to the framed pose"). Frames 0 to 240 at 60 fps; frame 240 is the shot's end,
// which holds the shot's last pose (README: Choices). The plant is `log_zoom_eases_width`.
import { describe, expect, it } from 'vitest';
import { AC, F60, TIMEOUT, box3d, camera3d, evalOk, evalPlanted, failsNaming, film, none, poseOf, rel, shot, useMotion, type Accepted } from './helpers.ts';

const motion = useMotion();
const FROM = 1.3e7;
const TO = 1.3e13;
const RATIO = 10 ** (6 / 240);
const TIMES = Array.from({ length: 241 }, (_, k) => k * F60);
const DOC = film('log-zoom', [
  camera3d({ fov: 40 }),
  box3d('planet', [0, 0, 0], 1.27e7),
  box3d('star', [0, 0, -1.5e11], 1.39e9, 'ink'),
], { shots: { zoom: shot(0, 4, { move: 'log_zoom', ease: 'linear', target: [0, 0, 0], view_width: TO, by: 1e-6 }) } }, { span: '5s' });

/** The criterion's check: each consecutive ratio and both ends; a failure names the frame. */
function zoomFailures(a: Accepted): string[] {
  const widths = a.frames.map((f) => poseOf(f, 'cam', 'the log zoom').view_width);
  const failures: string[] = [];
  if (!(rel(widths[0]!, FROM) <= 1e-9)) failures.push(`frame 0: the view is ${widths[0]} m wide, not ${FROM} m`);
  if (!(rel(widths[240]!, TO) <= 1e-9)) failures.push(`frame 240: the view is ${widths[240]} m wide, not ${TO} m`);
  for (let k = 1; k <= 240; k++) {
    const r = widths[k]! / widths[k - 1]!;
    if (!(rel(r, RATIO) <= 1e-9)) failures.push(`frame ${k}: the ratio of view widths to frame ${k - 1} is ${r}, not 10^(6/240) = ${RATIO}`);
  }
  return failures;
}

describe(`${AC[1]} a log zoom's view width moves by a constant ratio per frame`, () => {
  it(`${AC[1]} each two consecutive 60 fps frames of a 4 s linear log zoom from 1.3e7 m to 1.3e13 m keep the ratio 10^(6/240) within 1e-9, and it ends on both widths`, () => {
    none(zoomFailures(evalOk(motion.bin(), { doc: DOC, times: TIMES }, 'the log zoom')), 'the log zoom');
  }, TIMEOUT);

  it(`${AC[1]} a planted zoom that eases the view width instead of its logarithm makes the first step's ratio over 4,000 and fails, naming the frame`, () => {
    const a = evalPlanted(motion.bin(), { doc: DOC, times: TIMES, planted: 'log_zoom_eases_width' }, 'the planted log zoom');
    const first = poseOf(a.frames[1]!, 'cam', 'plant').view_width / poseOf(a.frames[0]!, 'cam', 'plant').view_width;
    expect(first, 'the plant\'s first step ratio').toBeGreaterThan(4000);
    failsNaming(zoomFailures(a), ['frame 1'], 'the log zoom check on the plant');
  }, TIMEOUT);
});
