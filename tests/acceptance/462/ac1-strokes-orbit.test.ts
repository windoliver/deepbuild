// AC1: "Through an orbit, every stroke stays within 0.5 px of its reprojected anchor on its surface, and a frame reached
// by seeking equals the played one by pixel hash on the same machine"
//
// Three boxes (helpers.ts: orbitDoc) seen by a camera whose azimuth a channel turns from 20° to 110° over 3 s, drawn by
// `view3d` at 15 fps (frames 0 to 45) under each stroke look in turn, brush, dab and dot (helpers.ts: strokeLook), with
// this suite's `strokes` field: each frame lists every stroke it draws, its item, its anchor (world m) and where its
// quad's centre lands (frame px). For every stroke in every frame: its anchor lies on its box's surface (within 1e-6 m),
// is the same anchor in every frame that draws the stroke (laid out from stable IDs, never reseeded), and its drawn
// centre is within 0.5 px of the anchor projected through the camera the document gives at that frame, worked out here
// from the camera's orbit (helpers.ts: orbitCamAt). Guards: every frame draws at least 50 strokes; at least half of a
// frame's strokes are drawn again in the next (so the anchors are compared across frames, not renamed each frame).
// Then frames 13 and 37, each opened in a fresh process (`from`), have the played frames' pixel hashes; the two differ,
// and frame 13 drawn by the same look without `strokes` hashes otherwise (the strokes are in what is compared).
// The planted `strokes_from_previous_frame` (README: Planted programs) draws each frame's strokes where the previous
// frame's camera put them and fails the reprojection, naming the stroke and frame.

import { describe, expect, it } from 'vitest';
import {
  BOXES, ORBIT, TIMEOUT, ac, failsNaming, fmt, framesOf, none, offSurface, orbitCamAt, orbitDoc, project, requireGpu, run,
  strokeFrames, strokeLook, useBins, useDir, view3d, writeJson, type Planted, type StrokeFrame, type StrokeLook, type V3,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const SOUGHT = [13, 37] as const;
const FRAMES = Array.from({ length: ORBIT.frames }, (_, n) => n);
const same = (a: V3, b: V3): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const at = (p: readonly number[]): string => `(${p.map((x) => fmt(x, 3)).join(', ')})`;

/** Every frame's strokes held to their anchors and surfaces; each failure names the frame and the stroke. */
function strokeProblems(frames: readonly StrokeFrame[]): string[] {
  const out: string[] = [];
  const anchors = new Map<string, { anchor: V3; frame: number }>();
  for (const f of frames) {
    if (f.strokes.length < 50) out.push(`frame ${f.frame}: draws ${f.strokes.length} strokes, fewer than 50`);
    const cam = orbitCamAt(f.frame, ORBIT.fps);
    const ids = new Set<string>();
    for (const s of f.strokes) {
      if (ids.has(s.id)) out.push(`frame ${f.frame}: stroke ${s.id} is listed twice`);
      ids.add(s.id);
      const b = BOXES[s.item];
      if (!b) { out.push(`frame ${f.frame}: stroke ${s.id} names ${s.item}, not one of the boxes`); continue; }
      const off = offSurface(s.anchor, b);
      if (!(off <= 1e-6)) out.push(`frame ${f.frame}: stroke ${s.id}'s anchor ${at(s.anchor)} lies ${off.toExponential(2)} m off ${s.item}'s surface`);
      const first = anchors.get(s.id);
      if (!first) anchors.set(s.id, { anchor: s.anchor, frame: f.frame });
      else if (!same(first.anchor, s.anchor)) out.push(`frame ${f.frame}: stroke ${s.id}'s anchor is ${at(s.anchor)}, at frame ${first.frame} it was ${at(first.anchor)}`);
      const p = project(cam, s.anchor);
      if (!p) { out.push(`frame ${f.frame}: stroke ${s.id}'s anchor is behind the eye, yet the frame draws it`); continue; }
      const d = Math.hypot(s.at[0] - p[0], s.at[1] - p[1]);
      if (!(d <= 0.5)) out.push(`frame ${f.frame}: stroke ${s.id} is drawn at ${at(s.at)}, ${fmt(d, 3)} px from its anchor's reprojection ${at(p)}`);
    }
  }
  for (let i = 0; i + 1 < frames.length; i++) {
    const next = new Set(frames[i + 1]!.strokes.map((s) => s.id));
    const kept = frames[i]!.strokes.filter((s) => next.has(s.id)).length;
    if (kept * 2 < frames[i]!.strokes.length) out.push(`frame ${frames[i + 1]!.frame} draws again only ${kept} of frame ${frames[i]!.frame}'s ${frames[i]!.strokes.length} strokes`);
  }
  return out;
}

function playedStrokes(bin: string, doc: string, look: StrokeLook, planted?: Planted): StrokeFrame[] {
  const [reply] = run(bin, dir(), [view3d({ doc, look: strokeLook(look), fps: ORBIT.fps, from: 0, frames: ORBIT.frames, strokes: true })], planted ? { planted } : {});
  const frames = strokeFrames(reply!, `the ${look} look through the orbit${planted ? `, planted ${planted}` : ''}`);
  expect(frames.map((f) => f.frame), `the ${look} look's orbit plays frames 0 to ${ORBIT.frames - 1}`).toEqual(FRAMES);
  return frames;
}

function orbit(look: StrokeLook): void {
  requireGpu();
  const bin = bins.bin('deep-gpu');
  const doc = writeJson(dir(), 'orbit.json', orbitDoc());
  const frames = playedStrokes(bin, doc, look);
  none(strokeProblems(frames), `the ${look} look's strokes stay on their anchors through the orbit`);

  const hashes = new Map(frames.map((f) => [f.frame, f.pixelHash]));
  expect(hashes.get(SOUGHT[0]), `frames ${SOUGHT.join(' and ')} differ (the camera orbits)`).not.toBe(hashes.get(SOUGHT[1]));
  const [bare] = run(bin, dir(), [view3d({ doc, look: strokeLook(look, false), fps: ORBIT.fps, from: SOUGHT[0], frames: 1 })]);
  const [plain] = framesOf(bare!, `frame ${SOUGHT[0]} without the look's strokes`);
  expect(plain?.pixelHash, `the strokes are in the pixels: frame ${SOUGHT[0]} drawn without them hashes otherwise`).not.toBe(hashes.get(SOUGHT[0]));

  const seek: string[] = [];
  for (const n of SOUGHT) {
    const [reply] = run(bin, dir(), [view3d({ doc, look: strokeLook(look), fps: ORBIT.fps, from: n, frames: 1, strokes: true })]);
    const sought = strokeFrames(reply!, `the ${look} look sought to frame ${n}`).find((f) => f.frame === n);
    if (sought?.pixelHash !== hashes.get(n)) seek.push(`frame ${n}: seeking gives pixel hash ${sought?.pixelHash.slice(0, 12)}, playing ${hashes.get(n)?.slice(0, 12)}`);
  }
  none(seek, `the ${look} look, seek against play`);
}

describe(`${ac(1)} strokes stay on their reprojected anchors through an orbit, and a sought frame equals the played one`, () => {
  it(`${ac(1)} the brush look: every stroke within 0.5 px of its reprojected anchor on its box, and frames 13 and 37 sought equal played by pixel hash`, () => {
    orbit('brush');
  }, TIMEOUT);

  it(`${ac(1)} the dab look: every stroke within 0.5 px of its reprojected anchor on its box, and frames 13 and 37 sought equal played by pixel hash`, () => {
    orbit('dab');
  }, TIMEOUT);

  it(`${ac(1)} the dot look: every stroke within 0.5 px of its reprojected anchor on its box, and frames 13 and 37 sought equal played by pixel hash`, () => {
    orbit('dot');
  }, TIMEOUT);

  it(`${ac(1)} (planted) strokes placed where the previous frame's camera put them fail the reprojection, naming the stroke`, () => {
    requireGpu();
    const doc = writeJson(dir(), 'orbit.json', orbitDoc());
    const plant: Planted = 'strokes_from_previous_frame';
    failsNaming(strokeProblems(playedStrokes(bins.bin('deep-gpu'), doc, 'brush', plant)), ['from its anchor\'s reprojection'], `the planted ${plant}`);
  }, TIMEOUT);
});
