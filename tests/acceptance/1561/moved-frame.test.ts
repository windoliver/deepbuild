// AC2 #1561.4606f756: A frame that only moved, which reuses last frame's marks in `flat.rs`, keeps its fills and paper:
// it equals a full redraw at the same t by pixel hash; a planted reuse that drops the page fails, naming the frame.
//
// The fixture is a leaf blown over a pond (fixtures/blown-leaf.json) under the look's paper, its wash on the pond and
// its line on the bank, without the light and with no camera (README: The fixtures). A channel moves the leaf's
// `at.pos` alone, all through its 4 s; the leaf is a plain rect outside every scope, the kind `flat.rs` moves with its
// marks. A second channel steps the buoy's radius at 0.5 s, 1.5 s, 2.5 s and 3.5 s, a change that isn't an `at.pos`, so
// the frame that crosses a step is laid out in full.
//
// One document and one look are played twice in the live window, and compared at t = 1 s and t = 2 s:
// - at 4 frames a second, frames 5 and 9 follow frames at 0.75 s and 1.75 s, with no step between: only the leaf
//   moved, and the frame reuses the last frame's marks;
// - at 1 frame a second, frames 2 and 3 follow frames at 0 and 1 s, with a step between: a full redraw.
// Each view row says which it was, in `reused` (README: The surface under test), so a program that redraws every frame
// fails here and doesn't pass by drawing well. The reused frame's pixel hash is the full redraw's.
//
// Guards: the full redraw differs from the same frame under the look with its fills and paper removed, so equal frames
// are frames that have them; and the reused frame differs from the frame before it, so it did move.
//
// The planted `reuse_drops_page` draws a reused frame with no page: its frames 5 and 9 aren't the full redraws, and the
// judge names them.
import { describe, it } from 'vitest';
import {
  AC, LEAF, failsNaming, liveCall, liveRows, none, plainLook, requireMetal, rowShot, runGpu, shown, useBins, useDir, without, writePayload, type Planted,
} from './helpers.ts';

const ID = AC[2];
const bin = useBins(['deep-gpu']);
const dir = useDir();
/** The look's paper, wash and line profile, without its light. */
const DRAWN = without('the light').look;
/** The same seconds in both runs: frame `moved` at 4 frames a second, frame `redrawn` at 1. */
const PAIRS = [{ t: 1, moved: 5, redrawn: 2 }, { t: 2, moved: 9, redrawn: 3 }] as const;

/** Each way the frames that only moved fail to be reused frames equal to the full redraws at the same t. */
function judge(out: string, planted?: Planted): string[] {
  const path = writePayload(out, 'leaf.json', LEAF);
  const replies = runGpu(bin('deep-gpu'), out, [liveCall(path, DRAWN, 4, 9), liveCall(path, DRAWN, 1, 3), liveCall(path, plainLook(), 1, 3)], planted);
  const moved = liveRows(replies[0]!, 9, 'the live window at 4 frames a second');
  const redrawn = liveRows(replies[1]!, 3, 'the live window at 1 frame a second');
  const plain = liveRows(replies[2]!, 3, 'the live window at 1 frame a second, under the look with its drawn fields removed');
  const failures: string[] = [];
  for (const p of PAIRS) {
    const at = `t = ${p.t} s`;
    const reused = moved.get(p.moved)!; const full = redrawn.get(p.redrawn)!;
    if (reused['reused'] !== true) failures.push(`frame ${p.moved} (${at}) at 4 frames a second only moved, but its view row's reused is ${shown(reused['reused'])}, not true: it didn't reuse the last frame's marks`);
    if (full['reused'] !== false) failures.push(`frame ${p.redrawn} (${at}) at 1 frame a second follows a change that isn't a move, but its view row's reused is ${shown(full['reused'])}, not false: it isn't a full redraw`);
    const a = rowShot(out, reused, `frame ${p.moved} at 4 frames a second`);
    const b = rowShot(out, full, `frame ${p.redrawn} at 1 frame a second`);
    if (a.hash !== b.hash) failures.push(`frame ${p.moved} (${at}), which only moved, isn't the full redraw at the same t: pixel hash ${a.hash} against ${b.hash}`);
    if (b.blank) failures.push(`BLOCKED: the full redraw at ${at} is blank`);
    if (b.hash === rowShot(out, plain.get(p.redrawn)!, `frame ${p.redrawn} under the look with its drawn fields removed`).hash) {
      failures.push(`the full redraw at ${at} has no fills and paper to keep: it's the frame the look draws with its drawn fields removed`);
    }
    if (a.hash === rowShot(out, moved.get(p.moved - 1)!, `frame ${p.moved - 1} at 4 frames a second`).hash) failures.push(`frame ${p.moved} (${at}) didn't move: it's frame ${p.moved - 1}'s picture`);
  }
  return failures;
}

describe(`${ID} a frame that only moved keeps its fills and paper`, () => {
  it(`${ID} frames 5 and 9 at 4 frames a second reuse the last frame's marks and equal by pixel hash the full redraws at t = 1 s and t = 2 s`, () => {
    requireMetal();
    none(judge(dir()), 'the frames that only moved are reused frames, each equal to a full redraw at the same t');
  });

  it(`${ID} planted reuse_drops_page, a reuse that drops the page, fails, naming frame 5`, () => {
    requireMetal();
    failsNaming(judge(dir(), 'reuse_drops_page'), 'frame 5 (t = 1 s), which only moved, isn\'t the full redraw at the same t', 'planted reuse_drops_page');
  });
});
