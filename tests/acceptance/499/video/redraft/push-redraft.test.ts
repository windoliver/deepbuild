// AC3 #499.65f30d78, its third clause, redrafted blind: "a 2D shot that pushes 2× onto the recording keeps a cursor
// ring keyed at a recorded click's image anchor within 0.5 px of the click's pixel through the whole push".
//
// A 2D film (1920 × 1080 u) places a 30 fps screen recording as an image@1 whose anchor `click` sits on the recorded
// click, a cursor ring (circle@1) anchored there, and one shot that pushes onto the recording. Shot: "`push` comes in
// from (1 + `by`) times the framed distance, or view width in an orthographic view"; so a 2× push is `by: 1`, from twice
// the framed view width to the framed one, and with an explicit framed pose (Shot: "its explicit pose") the framing is
// exact. Every 60 fps frame of the push is drawn by `deep-show run`'s `eval` with `pixels` (the canonical snapshot),
// and in each the click's pixel (the recorded mark, read from the drawn recording) and the ring's centre are found in
// the picture, inside a window that holds only the recording. REDRAFT.md gives the surface and the readings.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC3, F60, REC, TIMEOUT, evalPixels, failsNaming, fl, mediaImport, none, obj, pictureOf, present, putStore, readPicture,
  recording, runShow, scenario, sha256, show, str, useShow, useTemp, type JsonObject, type Window,
} from './helpers.ts';

const bin = useShow();
const temp = useTemp();

// ---- The film

/** The recording's box in u: 960 × 540 (1.5 u a source px), centred on the page. */
const BOX: [number, number, number, number] = [480, 270, 960, 540];
const U_PER_PX = BOX[2] / REC.w;
/** The recorded click: the centre of its mark, in source px, and as the image anchor (fractions of the image). */
const CLICK_PX: [number, number] = [REC.click.x + REC.click.size / 2, REC.click.y + REC.click.size / 2]; // (408, 216)
const anchorAt = (sx: number, sy: number): [number, number] => [sx / REC.w, sy / REC.h];
/** Where an anchor of the image lies on the page, in u (Image image@1: anchors, fractions of the image; fit fill). */
const onPage = (a: [number, number]): [number, number] => [BOX[0] + a[0] * BOX[2], BOX[1] + a[1] * BOX[3]];
/** The shot's framed pose (an explicit pose: target and view width) and its push (`by: 1`, so it comes in from 2×). */
const TARGET: [number, number] = [960, 540];
const FRAMED_WIDTH = 1200;
const BY = 1;
const START = 0.5; const END = 1.5;
const SIZE: [number, number] = [1920, 1080];
/** The cursor ring, in u: around the click's 24 u mark with room to spare at every scale. */
const RING_R = 30; const RING_INNER = 22;

/** The film whose ring is keyed at the anchor `ringAnchor` of the recording. */
function filmDoc(asset: string, ringAnchor: string): JsonObject {
  const license: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture.' };
  return {
    format: 1, id: 'push-onto-recording', profile: 'film', title: '#499 push onto a recording',
    description: 'A screen recording placed as an image, pushed onto by a 2D shot, with a cursor ring on its recorded click.',
    size: SIZE, camera: 'cam', transport: { span: '2s' },
    assets: { recording: { sha256: asset, license } },
    items: {
      cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [SIZE[0] / 2, SIZE[1] / 2, 0], view_width: SIZE[0] } },
      rec: {
        id: 'rec', kind: 'image@1', name: 'Recording', order: 'b0', at: { pos: [0, 0, 0] },
        params: {
          asset, alt: 'A screen recording with one click.', box: BOX, fit: 'fill', frames: { start: '0s' },
          anchors: { click: anchorAt(...CLICK_PX), beside: anchorAt(CLICK_PX[0] + 1, CLICK_PX[1]) },
        },
      },
      ring: {
        id: 'ring', kind: 'circle@1', name: 'Cursor ring', order: 'c0', at: { anchor: `rec#${ringAnchor}`, pos: [0, 0, 0] },
        params: { center: [0, 0], r: RING_R, inner_r: RING_INNER, paint: { fill: { role: 'accent' } } },
      },
    },
    shots: { push: { start: `${START}s`, end: `${END}s`, camera: 'cam', move: 'push', by: BY, target: [TARGET[0], TARGET[1], 0], view_width: FRAMED_WIDTH } },
  };
}
// ---- What the design fixes

/** px per u at the push's two ends: the view width spans the frame's width (Camera camera@1; a 2D camera's target and
 * view width in u, the target at the frame's centre). */
const S_START = SIZE[0] / ((1 + BY) * FRAMED_WIDTH); // 0.8
const S_END = SIZE[0] / FRAMED_WIDTH; // 1.6
/** A page point's pixel at scale s about the fixed target (a push only changes the view width). */
const pixelAt = (p: [number, number], s: number): [number, number] => [SIZE[0] / 2 + (p[0] - TARGET[0]) * s, SIZE[1] / 2 + (p[1] - TARGET[1]) * s];
const CLICK_U = onPage(anchorAt(...CLICK_PX)); // (1092, 594)
/** The search window: the recording's rectangle at the push's start, 4 px in from its edges. The recording is centred
 * on the target, so it only grows through the push and covers this window at every frame; the ground never enters. */
const WINDOW: Window = (() => {
  const [x0, y0] = pixelAt([BOX[0], BOX[1]], S_START); const [x1, y1] = pixelAt([BOX[0] + BOX[2], BOX[1] + BOX[3]], S_START);
  return { x0: Math.ceil(x0) + 4, y0: Math.ceil(y0) + 4, x1: Math.floor(x1) - 4, y1: Math.floor(y1) - 4 };
})();
/** How far a counted pixel may lie from each centre: the mark's half-diagonal and the ring's outer radius at the push's
 * end, plus 3 px of fringe. */
const REACH = { click: (REC.click.size / 2) * U_PER_PX * Math.SQRT2 * S_END + 3, ring: RING_R * S_END + 3 };
const TOL = 0.5;

/** Every 60 fps frame of the push, [0.5 s, 1.5 s), and its last flick, where the push lands on the framed pose. */
const TIMES: number[] = [...Array.from({ length: 60 }, (_, k) => fl(START) + k * F60), fl(END) - 1];
const label = (t: number): string => `frame at ${(t / 705_600_000).toFixed(6)} s (${t} flicks)`;

interface Frame { t: number; ring: [number, number] | null; click: [number, number] | null; problems: string[] }

/** The film presented and drawn at `times`: in each picture, the ring's centre and the click's pixel. */
function drawn(ringAnchor: string, times: number[]): Frame[] {
  const dir = temp(); const evidence = join(dir, 'evidence');
  const file = recording(dir);
  const bytes = readFileSync(file);
  const asset = putStore(evidence, bytes);
  const replies = runShow(bin(), scenario(evidence, [mediaImport(file), present(filmDoc(asset, ringAnchor)), ...times.map(evalPixels)]));
  const imported = obj(obj(replies[0], 'media_import')['asset'], `media_import's asset: ${show(replies[0])}`);
  expect(str(imported['sha256'], 'asset.sha256'), 'the recording is imported by its hash').toBe(sha256(bytes));
  expect(imported['kind'], 'the recording is imported as a video').toBe('video');
  expect(replies[1]!['outcome'], `the film is presented: ${show(replies[1])}`).toBe('presented');
  return times.map((t, i) => {
    const r = readPicture(pictureOf(evidence, replies[i + 2]!, label(t)), WINDOW, REACH);
    return { t, ring: r.ring && [r.ring.x, r.ring.y], click: r.click && [r.click.x, r.click.y], problems: r.problems.map((p) => `${label(t)}: ${p}`) };
  });
}

const fmt = (p: [number, number]): string => `(${p[0].toFixed(2)}, ${p[1].toFixed(2)})`;
const dist = (a: [number, number], b: [number, number]): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The clause: in every frame the ring's centre lies within 0.5 px of the click's pixel. */
function ringFailures(frames: Frame[]): string[] {
  const out: string[] = [];
  for (const f of frames) {
    out.push(...f.problems);
    if (!f.ring || !f.click) { out.push(`${label(f.t)}: ${f.ring ? '' : 'no ring found'}${!f.ring && !f.click ? ', ' : ''}${f.click ? '' : 'no click found'}`); continue; }
    const d = dist(f.ring, f.click);
    if (d > TOL) out.push(`${label(f.t)}: the ring's centre is at ${fmt(f.ring)} px, the click's pixel at ${fmt(f.click)}: ${d.toFixed(3)} px apart (at most ${TOL})`);
  }
  return out;
}

/** That the frames are a 2× push onto the framed pose: the click's pixel at the first frame where twice the framed view
 * width puts it and at the last where the framed width does, and between them on the line from the target's pixel
 * through it, moving only outward (a push changes only the view width, by a monotone ease). */
function pushFailures(frames: Frame[]): string[] {
  const out: string[] = [];
  const first = frames[0]!; const last = frames[frames.length - 1]!;
  const want0 = pixelAt(CLICK_U, S_START); const want1 = pixelAt(CLICK_U, S_END);
  if (first.click && dist(first.click, want0) > TOL) out.push(`${label(first.t)}: at the push's start (view width ${(1 + BY) * FRAMED_WIDTH} u) the click's pixel should be ${fmt(want0)}, it is ${fmt(first.click)}`);
  if (last.click && dist(last.click, want1) > TOL) out.push(`${label(last.t)}: at the push's end (the framed view width ${FRAMED_WIDTH} u) the click's pixel should be ${fmt(want1)}, it is ${fmt(last.click)}`);
  const d: [number, number] = [CLICK_U[0] - TARGET[0], CLICK_U[1] - TARGET[1]]; const len = Math.hypot(...d);
  let before = -Infinity;
  for (const f of frames) {
    if (!f.click) continue;
    const rel: [number, number] = [f.click[0] - SIZE[0] / 2, f.click[1] - SIZE[1] / 2];
    const s = (rel[0] * d[0] + rel[1] * d[1]) / (len * len);
    const off = Math.abs(rel[0] * d[1] - rel[1] * d[0]) / len;
    if (off > TOL) out.push(`${label(f.t)}: the click's pixel ${fmt(f.click)} is ${off.toFixed(3)} px off the push's line from the frame's centre`);
    if (s < S_START - 0.005 || s > S_END + 0.005) out.push(`${label(f.t)}: the click's pixel ${fmt(f.click)} is at scale ${s.toFixed(4)}, outside the push's ${S_START} to ${S_END}`);
    if (s < before - 0.005) out.push(`${label(f.t)}: the push moves back out (scale ${s.toFixed(4)} after ${before.toFixed(4)})`);
    before = Math.max(before, s);
  }
  return out;
}

describe(`${AC3} a 2D shot pushing 2× onto a recording keeps a cursor ring on the recorded click`, () => {
  it(`${AC3} through every frame of a 2× push (by 1) onto the recording, the ring keyed at the click's image anchor stays within 0.5 px of the click's pixel`, () => {
    const frames = drawn('click', TIMES);
    none([...pushFailures(frames), ...ringFailures(frames)], 'the push onto the recording');
  }, TIMEOUT);

  it(`${AC3} a planted twin whose ring is keyed one source pixel beside the click fails the same check, naming the frame`, () => {
    // One source px is 1.5 u: 1.2 px on screen at the push's start and 2.4 px at its end, both past 0.5 px.
    const ends = [TIMES[0]!, TIMES[TIMES.length - 1]!];
    const frames = drawn('beside', ends);
    none(frames.flatMap((f) => f.problems), 'the twin is drawn and read like the film');
    failsNaming(ringFailures(frames), ends.map(label), 'the ring keyed beside the click');
  }, TIMEOUT);
});
