// #1173.5b817fce: Seeking equals playing by pixel hash on the same machine with MSAA on.
//
// C1's turning box (`boxDoc`) played by #378's `view3d` for frames 0 … 29 in one process, and sought in fresh
// processes on this machine to frames 11 and 29 (`from`, #380's seek), each view reporting 4× MSAA: each sought
// frame's pixel hash equals the played frame's (and 11 differs from 29, so a seek is a seek). Wrong programs: the base
// (no sample count reported: MSAA isn't on); `--planted resolve_accumulates_frames` (a mutant: the MSAA resolve blends
// in the view's previous resolved frame, so a frame depends on how it was reached), which must fail naming the frame.
import { describe, expect, it } from 'vitest';
import {
  BOX_FPS, BOX_FRAMES, BOX_LOOK, BOX_VIEW, MSAA, boxDoc, frameAt, requireMetal, run, useBuild, useOut, view3dCall, viewOf, writeJson, type Planted,
} from './helpers.ts';

const ID = '#1173.5b817fce';
const SOUGHT = [11, 29];

const bin = useBuild();
const out = useOut();

/** Seeks against play, by pixel hash, with MSAA on: failures as sentences naming the frame. */
function seekProblems(planted?: Planted): string[] {
  const doc = writeJson(out(), 'box', boxDoc());
  const call = (from: number, frames: number) => view3dCall({ doc, look: BOX_LOOK, size: BOX_VIEW, from, frames, fps: BOX_FPS });
  const problems: string[] = [];
  const msaa = (m: number, what: string): void => { if (m !== MSAA) problems.push(`${what}: the surface reports msaa ${m}, not ${MSAA}`); };
  const played = viewOf(run(bin(), out(), [call(0, BOX_FRAMES)], planted)[0]!, 'the played run');
  msaa(played.msaa, 'the played run');
  expect(played.frames.map((f) => f.frame), 'the played run drew frames 0 … 29').toEqual(Array.from({ length: BOX_FRAMES }, (_, i) => i));
  expect(frameAt(played.frames, SOUGHT[0]!, 'played').pixel_hash, 'the box turns between the sought frames').not.toBe(frameAt(played.frames, SOUGHT[1]!, 'played').pixel_hash);
  for (const n of SOUGHT) {
    const sought = viewOf(run(bin(), out(), [call(n, 1)], planted)[0]!, `the seek to frame ${n}`);
    msaa(sought.msaa, `the seek to frame ${n}`);
    const s = frameAt(sought.frames, n, `the seek to frame ${n}`).pixel_hash;
    const p = frameAt(played.frames, n, 'the played run').pixel_hash;
    expect(p, `frame ${n} played has a pixel hash`).toMatch(/^[0-9a-f]{64}$/);
    if (s !== p) problems.push(`frame ${n}: seeking draws ${s}, playing drew ${p}`);
  }
  console.log(`${ID}${planted ? ` (--planted ${planted})` : ''}: ${problems.length} problems${problems.length ? `: ${problems.join('; ')}` : ''}`);
  return problems;
}

describe(`${ID} seeking equals playing by pixel hash on the same machine with MSAA on`, () => {
  it(`${ID} frames 11 and 29 of the turning box sought in fresh processes equal them played, by pixel hash, at 4× MSAA`, () => {
    requireMetal();
    expect(seekProblems(), 'seeking equals playing with MSAA on').toEqual([]);
  }, 3_600_000);

  it(`${ID} a planted resolve that blends in the previous frame fails, naming the frame`, () => {
    requireMetal();
    expect(seekProblems('resolve_accumulates_frames').join('\n'), '--planted resolve_accumulates_frames makes a seek differ from play, named by frame').toMatch(/^frame (11|29): seeking draws/m);
  }, 3_600_000);
});
