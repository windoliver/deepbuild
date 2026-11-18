// #1619.244eda5f: "With `convergence: 0`, `tracking: none` and `roll: none`, the finish changes no pixel"
//
// The identity frame: the tape fixture's still figure, 48 frames at 24 fps, drawn by `film2d` with `finish: []` and
// again under a VHS screen with `convergence: 0`, `tracking: "none"` and `roll: "none"`, once with the angle left out
// and once with `convergence_angle: 90` (at 0 px an offset along any angle is no offset): every frame of both has the
// pixel hash of the frame with no finish. Each of the three off its identity changes the film (`convergence: 2` along
// 90°, the tracking band, the roll: some frame of the 48 differs from the frame with no finish), so the equality is
// the identity's and not a screen that reads none of them. Wrong programs: a tracking or a roll that draws when it is
// `none`; a pass that runs at 0 px and moves a pixel; a screen that ignores the fields.
import { describe, expect, it } from 'vitest';
import { AC, FPS, FRAMES, type JsonObject, ROLL, STAIRS, TRACKING, film2d, framesOf, none, pixelHash, requireGpu, runGpu, tapeLook, useGpu, useOut } from './helpers.ts';

const gpu = useGpu();
const out = useOut();
const NONE: JsonObject = { convergence: 0, tracking: 'none', roll: 'none' };
const IDENTITY: [string, JsonObject][] = [
  ['convergence: 0, tracking: none, roll: none', NONE],
  ['convergence: 0, convergence_angle: 90, tracking: none, roll: none', { ...NONE, convergence_angle: 90 }],
];
const OFF: [string, JsonObject][] = [
  ['convergence: 2 along 90°', { ...NONE, convergence: 2, convergence_angle: 90 }],
  ['a tracking band', { ...NONE, tracking: TRACKING }],
  ['a roll', { ...NONE, roll: ROLL }],
];

describe(`${AC[3]} the screen's convergence, tracking and roll at their identity`, () => {
  it(`${AC[3]} with convergence 0, tracking none and roll none, every frame has the pixel hash of the frame with no finish; off its identity each changes the film`, () => {
    requireGpu();
    const looks: [string, JsonObject][] = [['no finish', tapeLook('identity-plain-1619', null)], ...[...IDENTITY, ...OFF].map(([name, screen], i): [string, JsonObject] => [name, tapeLook(`identity-${i}-1619`, screen)])];
    const replies = runGpu(gpu(), out(), looks.map(([, look]) => film2d(STAIRS, look, { fps: FPS, frames: FRAMES, hash: true })));
    const hashes = replies.map((r, i) => framesOf(r, looks[i]![0]).map((f) => pixelHash(f, looks[i]![0])));
    for (const h of hashes) expect(h.length, 'each film answers 48 frames').toBe(FRAMES);
    const plain = hashes[0]!;
    const problems: string[] = [];
    IDENTITY.forEach(([name], i) => {
      const changed = hashes[1 + i]!.flatMap((h, n) => (h === plain[n] ? [] : [n]));
      if (changed.length) problems.push(`with ${name}, the finish changes ${changed.length} of ${FRAMES} frames; first: frame ${changed[0]}`);
    });
    none(problems, `${AC[3]} the identity`);
    const unread = OFF.filter((_, i) => hashes[1 + IDENTITY.length + i]!.every((h, n) => h === plain[n])).map(([name]) => name);
    expect(unread, 'each of convergence, tracking and roll off its identity changes some frame, so the screen reads its fields').toEqual([]);
  });
});
