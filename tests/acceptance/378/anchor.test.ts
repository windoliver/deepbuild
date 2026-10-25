// #378.c16ba7c3: while a camera orbits at 90° a second, a 2D marker anchored to a 3D point stays within 0.5 px
// of it in a capture of every presented frame, and presentation feedback reports the `frame_seq` the shown
// slot carries; a planted composer that pairs the newest slot with the current 2D layers fails, naming the
// frame.
// fixtures/anchored.json: a red 16 px point 3 m from the target in a 3D writer layer, and in a 2D writer
// layer a green dot anchored to it through an overlay, under a perspective camera that orbits at 90° a
// second. Sixty frames at 60 fps, the window captured at every present. Run A has no latency: each present
// shows its own frame's slot. Run B holds slots back (`latency`, a fault fixture), so some presents show an
// earlier frame's slot: there the 2D layer must draw from the frame_seq that slot carries. Feedback is
// checked against what the slot shows: the point in B's present m sits where it sits in A's frame
// frame_seq(m). The planted composer is `--planted pairs_newest_slot`. At the base `deep-gpu` answers the
// view3d call with bad_input.
import { describe, expect, it } from 'vitest';
import {
  GPU_BIN, everyFrame, fixture, fixturePath, greenness, ink, look, readPng, redness, requireGpu, runGpu, useBins, useOut, view3d, view3Reply,
  type Planted,
} from './helpers.ts';

const bins = useBins([GPU_BIN]);
const out = useOut();
const DOC = fixture('anchored.json');
const SIZE = DOC['size'] as [number, number];
const WINDOW = { size: [SIZE[0] + 80, SIZE[1] + 80] as [number, number], view: [40, 40] as [number, number], page: [32, 32, 32] as [number, number, number] };
const FRAMES = 60;
const LATENCY = [0, 1, 1, 0, 1, 0, 1, 1];
const TOLERANCE_PX = 0.5;

interface Present { frame: number; frame_seq: number; point: [number, number]; marker: [number, number] }

function presents(latency: number[], planted?: Planted): Present[] {
  const what = `${planted ? `--planted ${planted}` : 'the clean run'}, latency ${latency.join(',')}`;
  const [reply] = runGpu(bins.bin(GPU_BIN), out(), [view3d({ doc: fixturePath('anchored.json'), look: look(), size: SIZE, frames: FRAMES, fps: 60, window: WINDOW, capture: 'every', latency })], planted ? { planted } : {});
  const v = view3Reply(reply!, what);
  everyFrame(v, FRAMES, what);
  return v.frames.map((f) => {
    const image = readPng(out(), f.window, `${what}: present ${f.frame}'s window capture`);
    const p = ink(image, redness); const m = ink(image, greenness);
    expect(p.mass, `${what}: present ${f.frame} shows the point`).toBeGreaterThan(5);
    expect(m.mass, `${what}: present ${f.frame} shows the marker`).toBeGreaterThan(2);
    expect(f.frame_seq <= f.frame && f.frame_seq >= 0, `${what}: present ${f.frame} reports a frame_seq of a frame already latched (${f.frame_seq})`).toBe(true);
    return { frame: f.frame, frame_seq: f.frame_seq, point: [p.cx, p.cy], marker: [m.cx, m.cy] };
  });
}

/** In every present, the marker is within 0.5 px of the point; each failure names the frame. */
function anchorProblems(list: Present[], what: string): string[] {
  return list.flatMap((p) => {
    const d = Math.hypot(p.marker[0] - p.point[0], p.marker[1] - p.point[1]);
    return d <= TOLERANCE_PX ? [] : [`${what}: presented frame ${p.frame} (frame_seq ${p.frame_seq}): the marker is ${d.toFixed(2)} px from the point`];
  });
}

describe('#378.c16ba7c3 while a camera orbits at 90° a second, a 2D marker anchored to a 3D point stays within 0.5 px of it in a capture of every presented frame, and presentation feedback reports the frame_seq the shown slot carries; a planted composer that pairs the newest slot with the current 2D layers fails, naming the frame', () => {
  it('#378.c16ba7c3 with slots held back, the marker stays within 0.5 px of the point in every presented frame, and each present\'s frame_seq is the frame its slot shows', () => {
    requireGpu();
    const a = presents([0]);
    expect(a.map((p) => p.frame_seq), 'with no latency each present shows its own frame').toEqual(a.map((p) => p.frame));
    const steps = a.slice(1).map((p, i) => Math.hypot(p.point[0] - a[i]!.point[0], p.point[1] - a[i]!.point[1]));
    expect(Math.min(...steps), 'the camera orbits: the point moves more than 1 px every frame, so a slot a frame old would show').toBeGreaterThan(1);
    expect(anchorProblems(a, 'run A'), 'the marker on the point, no latency').toEqual([]);
    const b = presents(LATENCY);
    expect(b.filter((p) => p.frame_seq < p.frame).length, 'the held slots took effect: at least a third of the presents show an earlier frame').toBeGreaterThanOrEqual(FRAMES / 3);
    const feedback = b.flatMap((p) => {
      const ref = a[p.frame_seq]!;
      const d = Math.hypot(p.point[0] - ref.point[0], p.point[1] - ref.point[1]);
      return d <= TOLERANCE_PX ? [] : [`present ${p.frame} reports frame_seq ${p.frame_seq}, but its slot shows the point ${d.toFixed(2)} px from where frame ${p.frame_seq} draws it`];
    });
    expect(feedback, 'presentation feedback reports the frame_seq the shown slot carries').toEqual([]);
    expect(anchorProblems(b, 'run B'), 'the marker on the point, with slots held back').toEqual([]);
  }, 1_800_000);

  it('#378.c16ba7c3 a planted composer that pairs the newest slot with the current 2D layers (--planted pairs_newest_slot) fails, naming the frame', () => {
    requireGpu();
    const problems = anchorProblems(presents(LATENCY, 'pairs_newest_slot'), 'pairs_newest_slot');
    expect(problems.length, 'the marker leaves the point in the presents that show an earlier slot').toBeGreaterThan(0);
    expect(problems[0], 'the failure names the frame').toMatch(/presented frame \d+ \(frame_seq \d+\): the marker is/);
  }, 1_800_000);
});
