// AC3, and AC4 in chrome (README: Criteria to tests): the 100 ms GIF in the replica's picture window, a window GPUI
// draws only when it says the window is dirty, its frames counted over 3 s of the clock and read back tile by tile; the
// planted image element that asks for a frame at every vsync, as the base's does; and the same window with reduced
// motion on.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chromeGif, chromeShown, pictureRun, scratch, useDrive, type PictureRun } from './helpers.ts';

const drive = useDrive();
const dir = scratch('chrome');
let written: string | undefined;
/** The GIF, as a file the window's image element reads by its path. */
const picture = (): string => {
  if (written === undefined) {
    written = join(dir, 'ten-frames.gif');
    writeFileSync(written, chromeGif());
  }
  return written;
};

/** The picture's centre in the window's device px: 64 × 64 at its top-left corner, at scale 1. */
const CENTRE: [number, number] = [32, 32];
/** The measured step: 3 s of the clock, so 10 frames a second is 30 frames; one either side is where 100 ms steps fall against the step's edges. */
const SECONDS = 3;

/** AC3's check on the measured step: the GIF causes 10 frames a second, each frame it causes shows a new frame of it, and the window shows the GIF. */
function rateProblems(run: PictureRun): string[] {
  const out: string[] = [];
  const drawn = run.measured.drawn;
  if (Math.abs(drawn - 10 * SECONDS) > 1) out.push(`the GIF caused ${(drawn / SECONDS).toFixed(1)} frames a second (${drawn} drawn in ${SECONDS} s of the clock), not 10`);
  if (run.report.read_back !== 'tiles') out.push(`the read-back is ${run.report.read_back}, so no frame's change can be read`);
  const unchanged = run.frames.filter((f) => f.drawn && !(f.tiles !== null && f.tiles.changed > 0));
  if (unchanged.length > 0) out.push(`${unchanged.length} of the ${drawn} frames drawn changed no tile of the window (frames ${unchanged.slice(0, 8).map((f) => f.frame).join(', ')}…): each drew the picture it already showed`);
  const shown = chromeShown(run.shot, CENTRE);
  if (typeof shown === 'string') out.push(`the window shows ${shown} at the picture's centre`);
  return out;
}

// Names are plain literals, so the trace lane and the carried-patch lint read them, and the criterion's ID, unrun.
describe('AC3 #1489.2f43c62d A 100 ms GIF in chrome causes 10 frames a second, not 120', () => {
  it(`AC3 #1489.2f43c62d a 10-frame GIF of 100 ms a frame in the replica's picture window (GPUI's img element, the window active, a frame drawn only when GPUI says the window is dirty): over 3 s of the clock it draws 30 frames, 10 a second, each showing a new frame of the GIF`, async () => {
    const run = await pictureRun(drive(), { picture: picture() });
    console.log(`AC3: ${run.measured.drawn} frames drawn in ${run.measured.frames} frames of the clock`);
    expect(rateProblems(run), 'the GIF causes 10 frames a second, each a new frame of it').toEqual([]);
  });

  it('AC3 #1489.2f43c62d planted picture-frame-each-vsync: the image element as the base has it, asking for a frame at every vsync, draws at every frame of the clock, and the check fails naming the frames a second it caused', async () => {
    const run = await pictureRun(drive(), { picture: picture(), plant: 'picture-frame-each-vsync' });
    console.log(`AC3 planted: ${run.measured.drawn} frames drawn in ${run.measured.frames} frames of the clock`);
    expect(run.measured.drawn, 'the planted element draws at every frame of the clock: a frame each vsync').toBeGreaterThanOrEqual(run.measured.frames);
    const problems = rateProblems(run);
    expect(problems.length, 'AC3\'s check fails on it').toBeGreaterThan(0);
    expect(problems[0], 'naming the frames a second it caused').toMatch(/^the GIF caused \d+\.\d frames a second/);
  });
});

describe('AC4 #1489.f265e8f8 Reduced motion holds the frame, and a seek to t shows the same frame as playing to t', () => {
  it(`AC4 #1489.f265e8f8 chrome: with reduced motion on, the picture window shows the GIF's first frame and holds it: no frame drawn over 3 s of the clock changes a tile`, async () => {
    const run = await pictureRun(drive(), { picture: picture(), reducedMotion: true });
    expect(run.report.read_back, 'every frame drawn is read back').toBe('tiles');
    const changed = run.frames.filter((f) => f.drawn && !(f.tiles !== null && f.tiles.changed === 0));
    expect(changed.map((f) => `frame ${f.frame} at t ${f.t}: ${f.tiles === null ? 'not read back' : `${f.tiles.changed} tiles changed`}`), 'with reduced motion, no frame drawn changes the picture').toEqual([]);
    expect(chromeShown(run.shot, CENTRE), 'the window shows the GIF\'s first frame, held').toBe(0);
  });
});
