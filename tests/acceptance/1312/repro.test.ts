// AC3 #1312.1cc5895b: The repro draws. The still puff of the repro, through `deep-gpu run`'s `view3d`, covers at least
// 1,000 px at each of frames 30, 59, 60 and 300 at 60 fps (its footprint: pixels that differ from the frame with no
// emitter), and 0 px at frame 630 (t = 10.5 s). On Linux read the linear target; elsewhere the final. Wrong program:
// main, which covers 0 px at frames 60 and 300.
//
// The repro: one `particles@1` emitter, `count: 1, emit: {rate: 1, span: 0.5}, life: [10, 10]`, `draw: puff`, a
// still ballistic motion (`v0: [0, 0]`, `gravity: [0, 0, 0]`), at the origin, under a camera 5 m away on +Z looking at
// it. Its one particle is born at 0 s with a 10 s life and never moves. Its sprite is 48 px across (`size: 48`, a
// sprite size in px), the size whose disc covers about the issue's 1,800 px; the issue names no size (README). The
// control is the same document with the emitter removed. Each frame n of 30, 59, 60, 300 and 630 is drawn for both
// documents by a `view3d` that opens at it (`from: n`, one frame, 60 fps, so t = n ÷ 60 s), all in one process; the
// footprint is the count of pixels whose R, G or B differs between the two, read from the linear target on Linux and
// the final target elsewhere. Off macOS and Linux, or with no GPU device, INCONCLUSIVE, never a pass.
//
// Wrong programs: the base (the particle's slot is past its first birth after the span from t = 1 s, frame 60, so
// nothing draws at 60 and 300); a fix that keeps the particle past its life (frame 630 isn't 0); a renderer that
// draws nothing (frames 30 and 59 aren't 1,000 px).

import { describe, expect, it } from 'vitest';
import { PLAIN_LOOK, camera, frameAt, framesOf, sessionDoc, useDir, view3dCall, writeJson, type JsonObject } from '../422/helpers.ts';
import { AC, PLATFORM, TARGET, footprint, pixelsOf, requireDrawingPlatform, runGpu, useGpu } from './helpers.ts';

const bin = useGpu();
const dir = useDir();

const SIZE: [number, number] = [160, 120];
const FPS = 60;
/** The criterion's frames and the least footprint at each: at least 1,000 px while the particle lives, 0 after. */
const WANT: [number, 'cover' | 'none'][] = [[30, 'cover'], [59, 'cover'], [60, 'cover'], [300, 'cover'], [630, 'none']];
const COVER = 1000;

const PUFF: JsonObject = {
  kind: 'particles@1',
  params: {
    count: 1,
    emit: { shape: 'point', rate: 1, span: 0.5 },
    life: [10, 10],
    motion: { ballistic: { v0: [0, 0], gravity: [0, 0, 0], drag: 0 } },
    draw: 'puff',
    size: 48,
  },
  at: { pos: [0, 0, 0] },
};

function doc(id: string, withEmitter: boolean): JsonObject {
  const items: Record<string, JsonObject> = { cam: camera([0, 0, 5], [0, 0, 0], 40, { near: 0.1, far: 100 }) };
  if (withEmitter) items['puff'] = PUFF;
  return sessionDoc(id, SIZE, items, { seed: 7, transport: { span: '12s' }, requires: { modules: { scene3d: '^1', effects: '^1' } } });
}

describe(`${AC[3]} the repro's still puff draws until its life ends`, () => {
  it(`${AC[3]} the still puff covers at least 1,000 px at frames 30, 59, 60 and 300 at 60 fps, and 0 px at frame 630, against the frame with no emitter (${TARGET} target on ${PLATFORM})`, () => {
    requireDrawingPlatform();
    const out = dir();
    const withPath = writeJson(out, 'with-emitter', doc('puff-1312', true));
    const withoutPath = writeJson(out, 'no-emitter', doc('puff-1312-bare', false));
    const call = (path: string, n: number) => view3dCall({ doc: path, look: PLAIN_LOOK, size: SIZE, fps: FPS, from: n, frames: 1, capture: [n], targets: [TARGET] });
    const calls = WANT.flatMap(([n]) => [call(withoutPath, n), call(withPath, n)]);
    const replies = runGpu(bin(), out, calls);

    const fails: string[] = [];
    const seen: string[] = [];
    WANT.forEach(([n, want], k) => {
      const bare = frameAt(framesOf(replies[2 * k]!, `frame ${n} with no emitter`), n, `frame ${n} with no emitter`);
      const puff = frameAt(framesOf(replies[2 * k + 1]!, `frame ${n} with the emitter`), n, `frame ${n} with the emitter`);
      const px = footprint(pixelsOf(out, puff, SIZE, `frame ${n} with the emitter`), pixelsOf(out, bare, SIZE, `frame ${n} with no emitter`));
      const t = +(n / FPS).toFixed(3);
      seen.push(`frame ${n} (t = ${t} s): ${px} px`);
      if (want === 'cover' && px < COVER) fails.push(`frame ${n} (t = ${t} s): the puff covers ${px} px, expected at least ${COVER} (its particle, born at 0 s with a 10 s life, is alive)`);
      if (want === 'none' && px !== 0) fails.push(`frame ${n} (t = ${t} s): the puff covers ${px} px, expected 0 (its particle's life ended at 10 s)`);
    });
    console.log(`${AC[3]} footprints, ${TARGET} target, ${SIZE[0]} × ${SIZE[1]}: ${seen.join('; ')}`);
    expect(fails, `${AC[3]} the repro's puff (count 1, rate 1, span 0.5, life 10, still) against the frame with no emitter, ${TARGET} target:\n  ${fails.join('\n  ')}\n(all: ${seen.join('; ')})`).toEqual([]);
  }, 1_800_000);
});
