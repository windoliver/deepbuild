// AC4 #535.b9829532: A door whose tile changes from 7 to 8 at cell (5, 3) at step 100 (t = 1.6667 s at 60 Hz) shows 8 in
// every frame from then on and 7 before it, by pixel hash, whether played from 0 or seeked to 3 s and back to 1 s; and a
// planted data module that keeps its mapped rows across a seek, instead of remapping them all, shows 8 after the seek
// back to 1 s and fails, naming cell (5, 3) and the frame
//
// The door (fixtures.ts `doorDoc`): an 8 × 6 atlas layer reading `keeper.tiles`, whose program (programs.ts
// `doorProgram`) writes 7 at index 29, cell (5, 3), before step 100 and 8 from it. "Shows 7" and "shows 8" are the pixel
// hashes of the same layer drawn with no logic, its tile column a data column holding the door's values before and
// after step 100 (`doorRefDoc`). Played from 0: `frames` from 0 to 3 s with each frame's pixel hash. Seeked: `eval` at
// 3 s, then at 1 s, on one live session, then `frames` from 1 s to 3 s. Every picture is a canonical render, a PNG in
// the evidence store; a frame whose hash isn't the expected one is read at each cell to name the cells that differ.
import { describe, expect, it } from 'vitest';
import { DOOR_CELL, DOOR_COLS, DOOR_ROWS, DOOR_STEP, doorProgram } from './programs.ts';
import { doorAtlas, doorDoc, doorPixel, doorRefDoc } from './fixtures.ts';
import {
  AC, DOC, at, binOf, evalCall, failsNaming, framesCall, framesOf, near, none, once, pixel, pngOf, prebuild, presented, putEvidence, runShow,
  sOf, scenario, snapshotOf, showCall, str, useTemp, type JsonObject, type Planted,
} from './helpers.ts';

prebuild(['full']);
const temp = useTemp();
const D = { play: DOC(1), seek: DOC(2), ref7: DOC(3), ref8: DOC(4) };
const T3 = at(180);
const T1 = at(60);
const PLAY_FRAMES = 181;
const SEEK_FRAMES = 121;

interface Run { ev: string; ref7: string; ref8: string; played: { t: number; hash: string }[] | null; seeked: { t: number; hash: string }[] }
function doorRun(planted?: Planted): Run {
  const ev = temp();
  const program = doorProgram();
  putEvidence(ev, program.bytes);
  const atlas = putEvidence(ev, doorAtlas());
  const door = doorDoc(program, atlas);
  const play = !planted;
  const calls: JsonObject[] = [
    showCall(D.ref7, doorRefDoc(atlas, DOOR_STEP - 1)), showCall(D.ref8, doorRefDoc(atlas, DOOR_STEP)), showCall(D.seek, door),
    evalCall(D.ref7, 0), evalCall(D.ref8, 0),
    evalCall(D.seek, T3), evalCall(D.seek, T1), framesCall(D.seek, SEEK_FRAMES, { from: '60f', pixels: true }),
    ...(play ? [showCall(D.play, door), framesCall(D.play, PLAY_FRAMES, { pixels: true })] : []),
  ];
  const r = runShow(binOf(), scenario(ev, Object.values(D), calls, planted ? { planted } : {}), 'AC4 the door');
  presented(r[0]!, 'the door showing 7, with no logic');
  presented(r[1]!, 'the door showing 8, with no logic');
  presented(r[2]!, 'the door');
  const ref7 = snapshotOf(r[3]!, 'the door showing 7');
  const ref8 = snapshotOf(r[4]!, 'the door showing 8');
  expect(ref7, 'the references differ: the door at 7 and at 8 draw differently').not.toBe(ref8);
  const hashes = (reply: JsonObject, count: number, what: string): { t: number; hash: string }[] =>
    framesOf(reply, count, what).map((f, n) => ({ t: Number(f['t']), hash: str(f['pixel_hash'], `${what}: frames[${n}].pixel_hash`) }));
  const seeked = [{ t: T3, hash: snapshotOf(r[5]!, 'the door at 3 s') }, { t: T1, hash: snapshotOf(r[6]!, 'the door at 1 s, seeked back from 3 s') }, ...hashes(r[7]!, SEEK_FRAMES, 'the door from 1 s to 3 s after the seek')];
  let played = null;
  if (play) {
    presented(r[8]!, 'the door, played from 0');
    played = hashes(r[9]!, PLAY_FRAMES, 'the door from 0 to 3 s');
  }
  return { ev, ref7, ref8, played, seeked };
}

/** Each frame against the door showing 7 before step 100 and 8 from it, by pixel hash; a frame whose hash is the other
 * reference's, or neither, is read cell by cell against the one expected, naming the cells that differ and the frame. */
function doorFailures(run: Run, frames: { t: number; hash: string }[], how: string): string[] {
  const out: string[] = [];
  for (const f of frames) {
    const want = f.t >= at(DOOR_STEP) ? run.ref8 : run.ref7;
    if (f.hash === want) continue;
    const shown = pngOf(run.ev, f.hash, `the frame at ${sOf(f.t)}`);
    const ref = pngOf(run.ev, want, 'the reference');
    const cells: string[] = [];
    for (let cy = 0; cy < DOOR_ROWS; cy++) for (let cx = 0; cx < DOOR_COLS; cx++) {
      const [x, y] = doorPixel(cx, cy);
      if (!near(pixel(shown, x, y), pixel(ref, x, y), 0)) cells.push(`cell (${cx}, ${cy})`);
    }
    out.push(`the frame at ${sOf(f.t)} ${how}: its pixel hash is ${f.hash === run.ref8 ? 'the door showing 8' : f.hash === run.ref7 ? 'the door showing 7' : 'neither reference'}, not the door showing ${f.t >= at(DOOR_STEP) ? 8 : 7}; it differs at ${cells.join(', ') || 'no cell\'s sample pixel'}`);
  }
  return out;
}

const honest = once(() => doorRun());

describe(`${AC[4]} a door whose tile changes from 7 to 8 at cell (5, 3) at step 100, by pixel hash, played and seeked`, () => {
  it(`${AC[4]} played from 0: every frame before step 100 (1.6667 s) shows 7 and every frame from it shows 8`, () => {
    const run = honest();
    expect(run.played!.map((f) => f.t), 'the play: every 60 fps frame from 0 to 3 s').toEqual(Array.from({ length: PLAY_FRAMES }, (_, k) => at(k)));
    none(doorFailures(run, run.played!, 'played from 0'), 'the door played from 0');
  }, 1_800_000);

  it(`${AC[4]} seeked to 3 s and back to 1 s: 8 at 3 s, 7 at 1 s, and from 1 s on 7 before step 100 and 8 from it`, () => {
    const run = honest();
    expect(run.seeked.map((f) => f.t), 'the seek: 3 s, 1 s, then every 60 fps frame from 1 s to 3 s').toEqual([T3, T1, ...Array.from({ length: SEEK_FRAMES }, (_, k) => at(60 + k))]);
    none(doorFailures(run, run.seeked, 'after the seek to 3 s and back to 1 s'), 'the door seeked');
  }, 1_800_000);

  it(`${AC[4]} planted keeps_rows_across_seek shows 8 after the seek back to 1 s and fails, naming cell (5, 3) and the frame`, () => {
    const run = doorRun('keeps_rows_across_seek');
    expect(run.seeked[1]!.hash, 'under the planted data module the frame at 1 s after the seek back shows 8').toBe(run.ref8);
    failsNaming(doorFailures(run, run.seeked.slice(0, 2), 'after the seek to 3 s and back to 1 s'), [new RegExp(`cell \\(${DOOR_CELL[0]}, ${DOOR_CELL[1]}\\)`), /1\.000 s/], 'the door seeked under keeps_rows_across_seek');
  }, 1_800_000);
});
