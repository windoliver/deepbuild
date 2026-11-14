// Criterion 6: "A fixture piece with a linear write, world pages with a move queued, a mirror with pending ranges, a
// service answer not yet read and a search split across steps, saved at 20 seeded steps (one with a move queued, one
// mid-search), quit and reopened, gives at each the never-quit run's full-state hashes at every checkpoint and its
// frames for the next 600 steps; a planted save that drops the linear write's previous values blends from zero on
// the first frame and fails, naming the array and the frame"
//
// Through `deep-logic` (README: deep-logic, Frames). The piece (programs.ts: fixture, crowd) is `fixture` at 20 Hz
// (a linear write, world pages, a between-step service against the world `ground`, a mirror of `crowd.cells` and a
// search split across steps), `crowd` at 20 Hz and an empty physics world `ground`. The fixture saves slot 1 at the
// end of each step that reads an entry of the `save` control; the track holds 20 such entries at seeded steps, one
// at a step that queues a page move and one in the middle of a search. For each, a process bakes up to the end of
// that step and exits (so the slot's newest save is that one), and another opens it and plays 600 steps, reading
// the 60 Hz frames from the time of the saved step on (1,800 frames: three a step). A never-quit bake of the same
// track gives the expected checkpoints, steps and frames. `save_drops_linear_previous` writes no previous values of
// a linear write into a save, so an open blends `fixture.pos` from zero.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, bakeCall, bakeOf, firstCheckpointDiff, firstDiff, firstFrameDiff, layoutFor, logicBin, openSaveCall, openedOf, piece, prebuild, rows, run, savesDir, seeded, stepOf, yours, type Bake, type Entry, type FrameSpan, type JsonObject, type Opened, type Planted } from './helpers.ts';
import { CROWD_WRITES, FIXTURE_HZ, FIXTURE_MORE, FIXTURE_WRITES, crowd, fixture, layoutProbe, midSearch, queuesMove } from './programs.ts';

prebuild(() => { logicBin(); });

const NEXT = 600;
const FRAMES_A_STEP = 60 / FIXTURE_HZ;
const ARRAYS = ['pos', 'found', 'seen', 'paged', 'mirrored'].map((n) => `fixture.${n}`);
function fixturePiece(): JsonObject {
  const lf = layoutFor(layoutProbe(), ['save'], FIXTURE_WRITES, FIXTURE_HZ);
  const lc = layoutFor(layoutProbe(), [], CROWD_WRITES, FIXTURE_HZ);
  return piece({
    seed: 534_06, controls: ['save'],
    items: {
      crowd: { program: crowd(lc), step_rate: FIXTURE_HZ, writes: CROWD_WRITES },
      fixture: { program: fixture(lf), step_rate: FIXTURE_HZ, reads: ['save'], writes: FIXTURE_WRITES, saves: { slots: 1, request: 'request' }, more: FIXTURE_MORE },
    },
    others: { ground: { kind: 'physics.world@1', params: { dimensions: 3, capacity: { bodies: 1, shapes: 1, joints: 0, contacts: 8, particles: 0 } } } },
  });
}
/** 20 seeded steps in [100, 700): one that queues a page move, one mid-search, the rest seeded. */
function saveSteps(): number[] {
  const r = seeded(534_61);
  const out = new Set<number>([titled(queuesMove, r), titled(midSearch, r)]);
  while (out.size < 20) out.add(100 + Math.floor(r() * 600));
  return [...out].sort((a, b) => a - b);
}
function titled(want: (k: number) => boolean, r: () => number): number {
  for (;;) { const k = 100 + Math.floor(r() * 600); if (want(k)) return k; }
}
const SAVES = saveSteps();
const TRACK: Entry[] = SAVES.map((k) => yours('save', k, 1, 0, FIXTURE_HZ));
const END = Math.max(...SAVES) + 1 + NEXT;
/** The frames from the time of the saved step `k` (the save's last step) through the next 600 steps. */
const framesFrom = (k: number): FrameSpan => ({ from: k * stepOf(FIXTURE_HZ), count: NEXT * FRAMES_A_STEP, arrays: ARRAYS });

let nqRun: Bake | undefined;
const neverQuit = (): Bake => (nqRun ??= bakeOf(run([bakeCall(fixturePiece(), { track: TRACK, steps: END, frames: SAVES.map(framesFrom) })])[0]!, 'the never-quit run'));
/** Bakes to the end of saved step k in one process, which exits, and opens slot 1 in another. */
function saveAndOpen(k: number, planted: Planted[] = []): Opened {
  const dir = savesDir();
  const b = bakeOf(run([bakeCall(fixturePiece(), { track: TRACK, steps: k + 1, saves_dir: dir })], planted)[0]!, `the bake that saves at the end of step ${k}`);
  expect(b.saves.at(-1)?.step, `the newest save is the one asked at the end of step ${k}`).toBe(k + 1);
  return openedOf(run([openSaveCall(fixturePiece(), { saves_dir: dir, slot: 1, track: TRACK, steps: k + 1 + NEXT, frames: [framesFrom(k)] })], planted)[0]!, `open_save of the save at ${k + 1}`);
}

describe(`${AC[6]} a fixture whose state spans a linear write, world pages, a mirror, a service and a search reopens as it played`, () => {
  it(`${AC[6]} saved at 20 seeded steps (one with a move queued, one mid-search), quit and reopened, each gives the never-quit run's full-state hashes at every checkpoint and its frames for the next 600 steps`, () => {
    expect(SAVES.some(queuesMove) && SAVES.some(midSearch), `the seeded steps hold one that queues a move and one mid-search: ${SAVES.join(', ')}`).toBe(true);
    const nq = neverQuit();
    SAVES.forEach((k, i) => {
      const o = saveAndOpen(k);
      expect([o.step, o.via], `the save at ${k + 1} opens straight`).toEqual([k + 1, 'straight']);
      expect(firstCheckpointDiff(o.checkpoints, nq.checkpoints, k + 1), `reopened at ${k + 1}, every checkpoint's full-state hash is the never-quit run's`).toBeNull();
      expect(firstDiff(rows(o.steps), rows(nq.steps.filter((s) => s.step > k && s.step <= k + NEXT))), `reopened at ${k + 1}, every step's hashes and arrays are the never-quit run's`).toBeNull();
      expect(o.frames[0]?.length, `reopened at ${k + 1}, the frames of the next 600 steps`).toBe(NEXT * FRAMES_A_STEP);
      expect(firstFrameDiff(o.frames[0]!, nq.frames[i]!), `reopened at ${k + 1}, every frame is the never-quit run's, bit for bit`).toBeNull();
    });
  }, TIMEOUT);

  it(`${AC[6]} a planted save that drops the linear write's previous values (save_drops_linear_previous) blends from zero on the first frame and fails, naming the array and the frame`, () => {
    const k = SAVES[0]!;
    const o = saveAndOpen(k, ['save_drops_linear_previous']);
    const nq = neverQuit();
    const first = o.frames[0]?.[0];
    expect(first?.arrays['fixture.pos'], 'the first frame after the open blends fixture.pos from zero').toEqual([0]);
    const d = firstFrameDiff(o.frames[0]!, nq.frames[0]!);
    expect(d, 'the frames comparison fails').not.toBeNull();
    expect([d!.array, d!.frame, d!.t], 'naming the array, fixture.pos, and the first frame').toEqual(['fixture.pos', 0, k * stepOf(FIXTURE_HZ)]);
  }, TIMEOUT);
});
