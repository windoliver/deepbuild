// AC2 #426.f893b6e0: An HDR backdrop on its own ground: with a test HDR whose lower half is a grid of flat 10° cells,
// each a color at least 4 code values from every other cell's, `background_ground: {height: 1.7, radius: 20}` and tone
// map none, the background pixel where the world point (2, 0, 1) projects shows the flat color of the cell holding
// direction (2, −1.7, 1) within 1 code value, from a camera at (0, 1.5, 5) aimed at the origin and after it moves to
// (3, 1, 4), and the frame at t has the same pixel hash seeked or played while it moves; a planted backdrop that
// centers the dome above the camera shows another cell and fails, naming the pixel. A 0.5 m box at the origin under a
// sun at 45°, over a shadow catcher on y = 0, leaves the projected floor in its shadow at the floor's value × (1 − the
// catcher's alpha) within 1 code value, a click on the projected floor picks nothing, and a planted order that draws
// the backdrop after the catcher shows no shadow and fails.
//
// The test HDR (helpers: testHdr) is a 720 × 360 Radiance file: a flat grey upper half and 36 × 9 flat cells below the
// horizon, any two at least 23 codes apart as the final target shows them. The backdrop alone, under a camera that
// moves linearly from (0, 1.5, 5) to (3, 1, 4) over 0.5 s aimed at the origin (60 fps: frame 0 the first pose, frame
// 15 halfway, frame 40 the second pose held), is judged at frames 0 and 40 on the one pixel holding (2, 0, 1)'s
// projection by #378's pinhole: its final code must be the flat color of the cell holding (2, −1.7, 1) within 1 code
// value per channel. Frame 15 drawn by playing from frame 0 and by a fresh process seeking to it must have the same
// pixel hash (SHA-256 of the decoded RGBA). The shadow scene: a 0.5 m white box standing at the origin, a 2 × 2 m
// shadow catcher (`catch: shadow`) whose top is y = 0, a key sun at 45° that casts and a fill sun overhead that doesn't,
// each giving the floor 10,000 lx, so the catcher's alpha in the box's shadow is 0.5. Every core pixel of the shadow
// (helpers: shadowCore) must show the floor's value × 0.5 in linear light, within 1 code value; a click on the projected
// floor beyond the catcher picks nothing, and one on the box picks the box (so clicks answer at all).
// The base has no planted switch for this criterion, so each planted wrong program is a CPU image of what it draws
// (the dome centred above the camera; the backdrop drawn after the catcher), run through the same judge, which must
// fail it, naming the pixel; the right program's CPU image must pass the same judge.
// Wrong programs: no ground (the background shows the direction of the view ray: another cell); the dome centred on
// the camera or above it; a ground at the camera's height instead of the photo's; a backdrop that follows the camera
// between frames, or depends on how the frame was reached; the backdrop drawn after the catcher, or the catcher not
// composited over it (an opaque catcher, or a catcher that writes its own color); a projected floor that takes a pick.
import { describe, expect, it } from 'vitest';
import {
  AC2, CLICK_BOX, CLICK_FLOOR, FIRST_FRAME, FPS, LAST_FRAME, MID_FRAME, MIN_CORE, MOVE_SIZE, POINT, SHADOW_CAM, SHADOW_SIZE,
  backdropProblems, cpuBackdrop, cpuShadow, failsNaming, frameAt, framesOf, movingDoc, none, pixelHash, pixelOf, poseAt,
  poseFixture, project, readFinal, runGpu, shadowCore, shadowDoc, shadowProblems, smallestCellDistance, useDir, useGpu,
  view3dCall, writeHdr, writeJson, requireMetal,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();

describe(`${AC2} an HDR backdrop on its own ground`, () => {
  it(`${AC2} the background pixel where (2, 0, 1) projects shows the flat color of the cell holding (2, −1.7, 1) within 1 code value, from (0, 1.5, 5) and after the camera moves to (3, 1, 4); the planted dome above the camera shows another cell and fails, naming the pixel`, () => {
    // The fixture's own claims, before anything is drawn.
    expect(smallestCellDistance(), 'every cell is at least 4 code values from every other cell').toBeGreaterThanOrEqual(4);
    const poses = [FIRST_FRAME, LAST_FRAME].map((n) => ({ n, cam: poseAt(n), label: `frame ${n}, the camera at (${poseAt(n).position.join(', ')})` }));
    none(poses.flatMap((p) => poseFixture(p.cam, p.label)), 'the fixture');

    // The planted backdrop (a CPU image of the dome centred above the camera) fails the judge, naming the pixel; the
    // right program's CPU image passes it.
    for (const p of poses) {
      none(backdropProblems(cpuBackdrop(p.cam, 'origin'), p.cam, `${p.label} (the right program, on the CPU)`), 'the judge on the right program');
      const [x, y] = pixelOf(p.cam, POINT);
      failsNaming(backdropProblems(cpuBackdrop(p.cam, 'above_camera'), p.cam, `${p.label} (the planted dome above the camera)`), [`(${x}, ${y})`], `${p.label}: the planted dome above the camera`);
    }

    requireMetal();
    const out = dir();
    const hdr = writeHdr(out);
    const doc = writeJson(out, 'moving', movingDoc(hdr.sha));
    const [reply] = runGpu(bin(), out, [view3dCall({ doc, size: MOVE_SIZE, fps: FPS, frames: LAST_FRAME + 1, capture: [FIRST_FRAME, LAST_FRAME], targets: ['final'], assets: hdr.assets })]);
    const frames = framesOf(reply!, 'the backdrop under the moving camera');
    const problems = poses.flatMap((p) => backdropProblems(readFinal(out, frameAt(frames, p.n, p.label), MOVE_SIZE, `${p.label}: final`), p.cam, p.label));
    none(problems, 'the backdrop on its ground');
  }, 3_600_000);

  it(`${AC2} the frame at t has the same pixel hash seeked or played while the camera moves`, () => {
    requireMetal();
    const out = dir();
    const hdr = writeHdr(out);
    const doc = writeJson(out, 'moving', movingDoc(hdr.sha));
    const [played] = runGpu(bin(), out, [view3dCall({ doc, size: MOVE_SIZE, fps: FPS, from: 0, frames: MID_FRAME + 1, capture: [FIRST_FRAME, MID_FRAME], targets: ['final'], assets: hdr.assets })]);
    const play = framesOf(played!, 'played from frame 0');
    const [sought] = runGpu(bin(), out, [view3dCall({ doc, size: MOVE_SIZE, fps: FPS, from: MID_FRAME, frames: 1, capture: [MID_FRAME], targets: ['final'], assets: hdr.assets })]);
    const seek = frameAt(framesOf(sought!, `sought to frame ${MID_FRAME}`), MID_FRAME, `sought to frame ${MID_FRAME}`);
    const start = pixelHash(readFinal(out, frameAt(play, FIRST_FRAME, 'played'), MOVE_SIZE, `played frame ${FIRST_FRAME}: final`));
    const p = pixelHash(readFinal(out, frameAt(play, MID_FRAME, 'played'), MOVE_SIZE, `played frame ${MID_FRAME}: final`));
    const s = pixelHash(readFinal(out, seek, MOVE_SIZE, `sought frame ${MID_FRAME}: final`));
    // Frame 15 lies halfway through the move, so its pixels differ from frame 0's: the camera is moving at t.
    expect(p, `frame ${MID_FRAME} (t = ${MID_FRAME / FPS} s) is drawn while the camera moves, so it differs from frame ${FIRST_FRAME}`).not.toBe(start);
    expect(s, `frame ${MID_FRAME} (t = ${MID_FRAME / FPS} s): seeking draws pixel hash ${s}, playing ${p}`).toBe(p);
  }, 3_600_000);

  it(`${AC2} a 0.5 m box under a sun at 45° over a shadow catcher on y = 0 leaves the projected floor in its shadow at the floor's value × (1 − the catcher's alpha) within 1 code value, a click on the projected floor picks nothing, and the planted order drawing the backdrop after the catcher shows no shadow and fails`, () => {
    const core = shadowCore();
    expect(core.length, `the shadow's judged core holds at least ${MIN_CORE} pixels (the fixture)`).toBeGreaterThanOrEqual(MIN_CORE);
    none(shadowProblems(cpuShadow(core, 'catcher_over'), core, 'the right program, on the CPU'), 'the judge on the right program');
    const first = core[0]!;
    failsNaming(shadowProblems(cpuShadow(core, 'backdrop_over'), core, 'the planted order drawing the backdrop after the catcher'), [`(${first.x}, ${first.y})`], 'the planted order drawing the backdrop after the catcher');

    requireMetal();
    const out = dir();
    const hdr = writeHdr(out);
    const doc = writeJson(out, 'shadow', shadowDoc(hdr.sha));
    const at = (p: [number, number, number]): [number, number] => { const [x, y] = pixelOf(SHADOW_CAM, p); return [x + 0.5, y + 0.5]; };
    const clicks = [{ frame: 0, at: at(CLICK_FLOOR) }, { frame: 0, at: at(CLICK_BOX) }];
    const [reply] = runGpu(bin(), out, [view3dCall({ doc, size: SHADOW_SIZE, targets: ['final'], assets: hdr.assets, clicks })]);
    const f = frameAt(framesOf(reply!, 'the shadow scene'), 0, 'the shadow scene');
    const problems = shadowProblems(readFinal(out, f, SHADOW_SIZE, 'the shadow scene: final'), core, 'the box\'s shadow on the projected floor');
    expect(f.clicks.length, 'each click is answered').toBe(clicks.length);
    const [floorClick, boxClick] = f.clicks;
    const [fx0, fy0] = project(SHADOW_CAM, CLICK_FLOOR);
    if (floorClick!.pick !== null) problems.push(`a click at (${clicks[0]!.at.join(', ')}) on the projected floor at (${CLICK_FLOOR.join(', ')}), beyond the catcher (projected at ${fx0.toFixed(1)}, ${fy0.toFixed(1)}), picks ${floorClick!.pick}, not nothing`);
    if (boxClick!.pick !== 'box') problems.push(`a click at (${clicks[1]!.at.join(', ')}) on the box's top picks ${boxClick!.pick ?? 'nothing'}, not box: clicks don't answer here, so the floor's click proves nothing`);
    none(problems, 'the box\'s shadow and the clicks');
  }, 3_600_000);
});
