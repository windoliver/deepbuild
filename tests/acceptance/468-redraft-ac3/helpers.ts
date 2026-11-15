// Test-side tools for the blind redraft of #468's AC3 (README: The surface under test). The binary build, the
// `deep-gpu run` driver, the reply parsing, the look, the document envelope, the pinhole and the PNG decoding are
// #506's suite's (tests/acceptance/506/helpers.ts), reused unchanged, since AC3 reads #506's `overlays` rows. Here:
// the lid fixture, the 200 seeded times, the `view3d` call with #484's seeks, and the references the readings are held
// to, written from the issue and the design: the anchor's world place from the lid's pivot and opening, and its
// projection through the orbiting camera. Nothing here stands in for an overlay, a leader, a line or the renderer.

import { expect } from 'vitest';
import {
  DARK_SKY, add, box, doc3, frameSeconds, isObject, keyed, linear, look, num, orbitPosition, rotate, sub, toScreen, unlit,
  type Cam, type JsonObject, type JsonValue, type V3,
} from '../506/helpers.ts';

export {
  TIMEOUT, codeOff, finalOf, fmt, framesOf, none, px, requireGpu, runGpu, useBins, useDir, writeJson, type Frame,
} from '../506/helpers.ts';

/** AC3's ID: `#468.` and the first 8 hex digits of SHA-256 of its text, trimmed, white space collapsed (criterionId). */
export const AC3 = 'AC3 #468.632af807';

/** The frame (px), its safe inset (the envelope's `safe`), the clock and the span. */
const SIZE: [number, number] = [480, 270];
const SAFE = 24;
const FPS = 240;
const SPAN = 4;
export const GRID = SPAN * FPS;

/**
 * The chest: a 0.6 × 0.3 × 0.4 m box on the floor. The lid: a 0.6 × 0.04 × 0.4 m box whose pivot, the bottom of its
 * back edge (0, −0.02, −0.2) in its own space, sits on the chest's top back edge (0, 0.3, −0.2); it opens about +X from
 * 0° to −110° over the span. Its anchor `hinge` is at (0.28, 0.02, −0.2) in its own space: the top of its back edge
 * near its right end, where a strap hinge sits, 4 cm off the pivot's line, so it moves as the lid opens.
 */
const LID = { size: [0.6, 0.04, 0.4] as V3, pos: [0, 0.3, -0.2] as V3, pivot: [0, -0.02, -0.2] as V3, hinge: [0.28, 0.02, -0.2] as V3, open: [[0, 0], [SPAN, -110]] as [number, number][] };
/** The camera orbits (−0.6, 0.35, 0.4) at 1.2 m, 15° up, its azimuth from −30° to −120° over the span (90°), fov 35°. */
const ORBIT = { target: [-0.6, 0.35, 0.4] as V3, distance: 1.2, elevation: 15, fov: 35, azimuth: [[0, -30], [SPAN, -120]] as [number, number][] };
/** The label's frame (px), anchored to the right edge: its top left at (W − safe − w, (H − h) ÷ 2) (README item 1). */
const LABEL: [number, number] = [120, 40];
export const LABEL_RECT: [number, number, number, number] = [SIZE[0] - SAFE - LABEL[0], (SIZE[1] - LABEL[1]) / 2, LABEL[0], LABEL[1]];
/** The wire's two fixed points; its middle point is `lid#hinge`. */
export const WIRE: [V3, V3] = [[0.6, 0, -0.6], [0.9, 0, -0.1]];

/** Frame n's time, s (⌊n × flicks ÷ fps⌋ flicks). */
const secondsOf = (n: number): number => frameSeconds(n, FPS);
/** The lid's opening, degrees about +X, at frame n. */
const openingAt = (n: number): number => keyed(LID.open, secondsOf(n));
/** The anchor `lid#hinge` in the world at a lid opening of `deg`: the pivot's place plus the turned offset from the pivot. */
export const hingeOpen = (deg: number): V3 => add(LID.pos, rotate([deg, 0, 0], sub(LID.hinge, LID.pivot)));
export const hingeAt = (n: number): V3 => hingeOpen(openingAt(n));
/** The lid's own origin at frame n: where the base resolves `lid#hinge` in a line's points (a wrong program). */
export const lidOriginAt = (n: number): V3 => add(LID.pos, rotate([openingAt(n), 0, 0], sub([0, 0, 0], LID.pivot)));
/** The camera at frame n. */
function camAt(n: number): Cam {
  const position = orbitPosition(ORBIT.target, ORBIT.distance, keyed(ORBIT.azimuth, secondsOf(n)), ORBIT.elevation);
  return { kind: 'perspective', position, target: ORBIT.target, fov: ORBIT.fov, size: SIZE };
}
/** A world point's projection through frame n's camera, px, and its depth (≤ 0 behind the eye). */
export const projAt = (n: number, p: V3): { x: number; y: number; depth: number } => toScreen(camAt(n), p);
/** How far (x, y) lies inside the safe frame, px: positive inside, negative outside. */
export const safeMargin = (x: number, y: number): number => Math.min(x - SAFE, SIZE[0] - SAFE - x, y - SAFE, SIZE[1] - SAFE - y);

/** 200 distinct frames of the 960 on the 240 fps grid over 4 s, drawn by a seeded generator, in drawing order. */
export const SAMPLES: number[] = (() => {
  let a = 468;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: number[] = [];
  while (out.length < 200) { const n = Math.floor(next() * GRID); if (!out.includes(n)) out.push(n); }
  return out;
})();

/**
 * The lid, its wire and, with `label`, the label: a whole scene document (#506's envelope: one writer layer `main`,
 * every item in it in this order, `safe: 24`). Both versions share their ID and every item before the label's, so a
 * frame without the label is the same document less the label's four items.
 */
export function lidDoc(label: boolean): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', target: [...ORBIT.target], orbit: { azimuth: ORBIT.azimuth[0]![1], elevation: ORBIT.elevation, distance: ORBIT.distance }, fov: ORBIT.fov, near: 0.05, far: 100 } },
    sky: DARK_SKY,
    'floor-mat': unlit([0.03, 0.03, 0.04]), 'chest-mat': unlit([0.1, 0.06, 0.03]), 'lid-mat': unlit([0.16, 0.1, 0.05]),
    floor: box([4, 0.1, 4], [0, -0.05, 0], 'floor-mat'),
    chest: box([0.6, 0.3, 0.4], [0, 0.15, 0], 'chest-mat'),
    lid: { ...box(LID.size, LID.pos, 'lid-mat'), at: { pos: [...LID.pos], rot: [0, 0, 0], pivot: [...LID.pivot] }, anchors: { hinge: { pos: [...LID.hinge], rot: [0, 0, 0] } } },
    wire: { kind: 'mark.line@1', params: { points: [[...WIRE[0]], 'lid#hinge', [...WIRE[1]]], width: 3, paint: { stroke: { role: 'glow' } } } },
  };
  if (label) {
    items['label-frame'] = { kind: 'frame@1', params: { box: [0, 0, ...LABEL] } };
    items['label-bg'] = { kind: 'rect@1', parent: 'label-frame', params: { box: [0, 0, ...LABEL], paint: { fill: { role: 'card' } } } };
    items['label-text'] = { kind: 'text@1', parent: 'label-frame', params: { text: 'Hinge', font: 'body', size: 14, box: { w: 96, h: 20 }, paint: { fill: { role: 'ink' } } }, at: { pos: [12, 10, 0] } };
    items['label'] = { kind: 'overlay.frame@1', params: { frame: 'label-frame', anchor: 'e', offset: [0, 0], leader: { to: 'lid#hinge', line: 'tint', width: 1.5, end: 'dot' }, hide: 'off_frame' } };
  }
  return doc3('lid-hinge', 'A lid opening under an orbiting camera', SIZE, items, {
    safe: SAFE,
    channels: { open: linear('items/lid/at/rot/0', LID.open), orbit: linear('items/cam/params/orbit/azimuth', ORBIT.azimuth) },
  });
}

/** A `view3d` call (#378) in this suite's look at 240 fps, with no frame captured unless asked. */
export const view3d = (doc: string, fields: JsonObject): JsonObject => ({ call: 'view3d', doc, look: look(), size: SIZE, fps: FPS, targets: ['final'], ...fields });
/** Played: frames 0 … through the last sampled one, one after another. */
export const played = (): JsonObject => ({ from: 0, frames: Math.max(...SAMPLES) + 1 });
/** Sought: the session opens at the first sampled frame and, after each, jumps to the next (#484's `seeks`). */
export const sought = (): JsonObject => ({
  from: SAMPLES[0]!, frames: SAMPLES.length,
  seeks: SAMPLES.slice(1).map((to, k) => ({ after: SAMPLES[k]!, to })) as unknown as JsonValue[],
});

/** The label's row in a frame's `overlays` (README item 4): where it draws and where its leader ends, or why not. */
interface LabelRow { at: [number, number] | null; to: [number, number] | null; problem?: string }
export function labelRow(raw: JsonObject, what: string): LabelRow {
  const rows = raw['overlays'];
  if (!Array.isArray(rows)) return { at: null, to: null, problem: `${what}: the frame reports no overlays` };
  const row = rows.find((r) => isObject(r) && r['id'] === 'label');
  if (!isObject(row)) return { at: null, to: null, problem: `${what}: no overlays row for the label` };
  const pair = (v: JsonValue | undefined, field: string): [number, number] => {
    expect(Array.isArray(v) && v.length === 2, `${what}: the label's ${field} is [x, y], got ${JSON.stringify(v)}`).toBe(true);
    return (v as JsonValue[]).map((x) => num(x, `${what}: the label's ${field}`)) as [number, number];
  };
  if (!('leader' in row)) return { at: null, to: null, problem: `${what}: the label's row has no leader` };
  const leader = row['leader'];
  return {
    at: row['at'] === null ? null : pair(row['at'], 'at'),
    to: leader === null ? null : pair(isObject(leader) ? leader['to'] : undefined, 'leader.to'),
  };
}
/** A frame's `segments` for one line (README item 5): each segment's two ends in world metres, or why not. */
export function segmentsOf(raw: JsonObject, line: string, what: string): { segments: [V3, V3][]; problem?: string } {
  const all = raw['segments'];
  if (!isObject(all)) return { segments: [], problem: `${what}: the frame reports no segments` };
  const list = all[line];
  if (!Array.isArray(list)) return { segments: [], problem: `${what}: the frame reports no segments for ${line} (it lists ${JSON.stringify(Object.keys(all))})` };
  return {
    segments: list.map((s, k) => {
      const ends = s as JsonValue[];
      expect(Array.isArray(ends) && ends.length === 2, `${what}: ${line}'s segment ${k} is [a, b], got ${JSON.stringify(s)}`).toBe(true);
      return ends.map((e) => (e as JsonValue[]).map((x) => num(x, `${what}: ${line}'s segment ${k}`))) as [V3, V3];
    }),
  };
}
export const dist3 = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
