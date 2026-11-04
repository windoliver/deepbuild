// AC1 #421.e43f3de1: The scene settles and draws no frames when nothing moves.
//
// A still scene3d document (a camera, a lit block on a floor, no channel) runs in #379's `live` for 60 frames at
// 60 fps with #420's `fences` report. Once it settles it draws nothing: within 8 frames of opening, every later frame's
// view row says `drawn: false` and no `submit` fence names the session, until a revision at frame 30 moves the
// block; that revision draws at least once within 8 frames and the scene settles again within 8 frames of it. The same
// document with a channel moving the block draws every frame (the control: a program that never draws fails).
// Wrong programs: the base (live draws every frame of every session, still or not); a renderer that redraws a still
// view every frame or keeps submitting GPU work; one that never draws a moving view or ignores a revision.
import { describe, expect, it } from 'vitest';
import { AC, PLAIN_LOOK, box, camera, liveOf, material, payload, requireMetal, runGpu, sessionDoc, useBins, useDir, writeJson, type JsonObject, type Live } from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const SIZE: [number, number] = [480, 360];
const FRAMES = 60;
const REVISE_AT = 30;
const SETTLE = 8;

function blockDoc(x: number, moving: boolean): JsonObject {
  return payload(sessionDoc('still-421', SIZE, {
    cam: camera([3, 3, 6], [0, 0.5, 0]),
    grey: material({ base_color: [0.5, 0.5, 0.5, 1], roughness: 0.6 }),
    floor: box([8, 0.1, 8], { pos: [0, -0.05, 0] }, { material: 'grey' }),
    block: box([1, 1, 1], { pos: [x, 0.5, 0] }, { material: 'grey' }),
    sun: { kind: 'light.sun@1', params: { illuminance: 1000 }, at: { rot: [-50, 20, 0] } },
  }, moving ? { channels: { slide: { target: 'items/block/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: -1, interp: 'linear' }, k1: { t: '2s', value: 1, interp: 'linear' } } } } } : {}));
}

function drawsOf(live: Live, session: string): { drawn: number[]; still: number[]; submits: number[]; frames: number[] } {
  const rows = live.views.filter((v) => v.session === session);
  return {
    frames: rows.map((v) => v.frame),
    drawn: rows.filter((v) => v.drawn).map((v) => v.frame),
    still: rows.filter((v) => !v.drawn).map((v) => v.frame),
    submits: live.fences.filter((f) => f.event === 'submit' && f.session === session && f.frame !== null).map((f) => f.frame!),
  };
}

describe(`${AC[1]} a still scene settles and draws nothing`, () => {
  it(`${AC[1]} a still block settles within ${SETTLE} frames and then draws no frame and submits no GPU work until a revision moves it; the revision draws, then it settles again`, () => {
    requireMetal();
    const out = dir();
    const still = writeJson(out, 'still', blockDoc(0, false));
    const moved = writeJson(out, 'moved', blockDoc(0.5, false));
    const [reply] = runGpu(bins.bin('deep-gpu'), out, [{
      call: 'live', look: PLAIN_LOOK, frames: FRAMES, fps: 60, report: ['fences'],
      sessions: [{ session: 's-still', writer: 'agent:alpha', doc: still, size: SIZE }],
      events: [{ frame: REVISE_AT, revise: { session: 's-still', doc: moved } }],
    }]);
    const d = drawsOf(liveOf(reply!), 's-still');
    expect(d.frames.length, 'the session has a view row in most frames').toBeGreaterThan(FRAMES - 5);
    const first = Math.min(...d.frames);
    console.log(`${AC[1]}: drawn at frames ${d.drawn.join(', ')}; submits at ${[...new Set(d.submits)].join(', ')}`);
    expect(d.drawn.filter((f) => f < first + SETTLE).length, 'the still scene draws its first frame').toBeGreaterThan(0);
    const quiet = (f: number): boolean => (f >= first + SETTLE && f < REVISE_AT) || f >= REVISE_AT + SETTLE;
    expect(d.drawn.filter(quiet), `no frame drawn while nothing moves (frames ${first + SETTLE}–${REVISE_AT - 1} and from ${REVISE_AT + SETTLE})`).toEqual([]);
    expect([...new Set(d.submits.filter(quiet))], 'no GPU work submitted for the session while nothing moves').toEqual([]);
    expect(d.drawn.filter((f) => f >= REVISE_AT && f < REVISE_AT + SETTLE).length, `the revision at frame ${REVISE_AT} draws within ${SETTLE} frames`).toBeGreaterThan(0);
  }, 1_800_000);

  it(`${AC[1]} the control: the same block moved by a channel draws every frame`, () => {
    requireMetal();
    const out = dir();
    const moving = writeJson(out, 'moving', blockDoc(0, true));
    const [reply] = runGpu(bins.bin('deep-gpu'), out, [{
      call: 'live', look: PLAIN_LOOK, frames: FRAMES, fps: 60, report: ['fences'],
      sessions: [{ session: 's-moving', writer: 'agent:alpha', doc: moving, size: SIZE }],
    }]);
    const d = drawsOf(liveOf(reply!), 's-moving');
    const first = Math.min(...d.frames);
    expect(d.still.filter((f) => f >= first + 2), 'a moving scene draws every frame after its first two').toEqual([]);
  }, 1_800_000);
});
