// AC2 #431.a160b5c5: A pass that reads the core's velocity target sees motion over the shutter, never from an earlier
// frame: a box crossing a 1920 × 1080 orthographic view at 600 px/s, at 30 fps with a 180° shutter (s = 1/60 s), reads
// (10, 0) ± 0.1 px at its center at t = 1 s, both played there and after a seek from 5 s; a planted target built from
// the previous frame's transforms reads about (−2,400, 0) after the seek and fails, naming the pixel.
//
// The fixture: a 1 m unlit box under an orthographic camera at 100 px/m, its x keyed linearly from −8 m at 0 s to 52 m
// at 10 s (6 m/s, 600 px/s), so at t = 1 s (frame 30 at 30 fps) its centre is at pixel (760, 540) and at 5 s (frame
// 150) at x = 3,160 px, off the view. The look sets no motion blur, so the shutter is the design's 180°. The pass `vel`
// (a composed `gpu.pass@1`) reads `{op: core, output: velocity}` at its own pixel and writes it as its color; `view3d`'s
// `read: ["vel.color"]` (#483) returns that output as f32. Played: frames 0 to 30. Seeked: frame 150, then a seek to 30
// in the same session (#484's `seeks`). Both read (10, 0) ± 0.1 px at (760, 540).
// Wrong program (planted `velocity_from_previous_frame`): the target is the screen motion from the previous frame
// drawn to this one, so after the seek it reads 760 − 3,160 = −2,400 px; the check fails naming the pixel.
import { describe, expect, it } from 'vitest';
import {
  AC, DARK_SKY, PLAIN_LOOK, asItem, box, coreTarget, frameAt, ortho, passOp, readTexture, requireGpu, run, sceneDoc, unlit, useBin, useOut, view3dCall,
  writeJson, type JsonObject, type Planted, type Size,
} from './helpers.ts';

const bin = useBin();
const out = useOut();
const SIZE: Size = [1920, 1080];
const FPS = 30;
const AT = 30; // t = 1 s
const FROM = 150; // t = 5 s
const CENTER: [number, number] = [760, 540];

function velocityDoc(): JsonObject {
  const vel = passOp('vel', { v: coreTarget('velocity') }, {
    px: { op: 'pixel@1', args: {} },
    out: { op: 'load@1', args: { tex: 'v', ixy: 'px' } },
  }, 'out');
  return sceneDoc('velocity-431', SIZE, {
    cam: ortho(SIZE[0], 100), sky: DARK_SKY, white: unlit([1, 1, 1]),
    slider: box([1, 1, 0.2], [-8, 0, 0], { material: 'white' }),
    vel: asItem(vel),
  }, 'showpiece', {
    transport: { span: '10s', frame_rate: FPS },
    channels: { slide: { target: 'items/slider/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: -8, interp: 'linear' }, k1: { t: '10s', value: 52, interp: 'linear' } } } },
  });
}

interface Reading { what: string; v: [number, number] }
function velocityProblems(planted?: Planted): { problems: string[]; readings: Reading[] } {
  const dir = out();
  const doc = writeJson(dir, 'velocity.json', velocityDoc());
  const common = { doc, size: SIZE, look: PLAIN_LOOK, fps: FPS, capture: [AT], read: ['vel.color'] };
  const replies = run(bin(), dir, [
    view3dCall({ ...common, frames: AT + 1 }),
    view3dCall({ ...common, from: FROM, frames: 2, seeks: [{ after: FROM, to: AT }] }),
  ], planted);
  const problems: string[] = [];
  const readings = (['played to t = 1 s', 'after a seek from 5 s'] as const).map((what, i): Reading => {
    const f = frameAt(replies[i]!, AT, what);
    const img = readTexture(dir, f.read['vel.color'], `${what}: vel.color`);
    expect([img.width, img.height], `${what}: the pass's output is the view's size`).toEqual(SIZE);
    const [vx, vy] = img.at(CENTER[0], CENTER[1]);
    if (!(Math.abs(vx - 10) <= 0.1 && Math.abs(vy) <= 0.1)) problems.push(`${what}: pixel (${CENTER[0]}, ${CENTER[1]}) reads (${vx.toFixed(2)}, ${vy.toFixed(2)}) px, not (10, 0) ± 0.1`);
    return { what, v: [vx, vy] };
  });
  console.log(`${AC[2]}${planted ? ` (${planted})` : ''}: ${readings.map((r) => `${r.what} (${r.v[0].toFixed(3)}, ${r.v[1].toFixed(3)})`).join('; ')}`);
  return { problems, readings };
}

describe(`${AC[2]} the velocity target is motion over the shutter, from the pure evaluation`, () => {
  it(`${AC[2]} the box's centre reads (10, 0) ± 0.1 px at t = 1 s, played there and after a seek from 5 s`, () => {
    requireGpu();
    expect(velocityProblems().problems).toEqual([]);
  }, 1_800_000);
  it(`${AC[2]} a planted target from the previous frame's transforms (--planted velocity_from_previous_frame) reads about (−2,400, 0) after the seek and fails, naming the pixel`, () => {
    requireGpu();
    const { problems, readings } = velocityProblems('velocity_from_previous_frame');
    expect(problems.join('\n'), 'the check fails naming the pixel after the seek').toMatch(/after a seek from 5 s: pixel \(760, 540\)/);
    const seek = readings[1]!.v;
    expect(seek[0], 'after the seek the planted target reads about −2,400 px in x').toBeGreaterThan(-2640);
    expect(seek[0], 'after the seek the planted target reads about −2,400 px in x').toBeLessThan(-2160);
  }, 1_800_000);
});
