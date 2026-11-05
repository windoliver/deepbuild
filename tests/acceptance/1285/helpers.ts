// Test-side tools for the #1285 acceptance tests. The build, the documents, `view3d`'s reply and PNG reading come from
// #422's suite helpers (imported, not copied); this file adds what #1285's criteria need on top: their IDs, a run of
// `deep-gpu run` that keeps its stderr (the 422 helper's `runGpu` drops it), film.blank's measure as the design and the
// issue state it, and the small fixtures the criteria name. Nothing here stands in for the renderer under test.

import { spawnSync } from 'node:child_process';
import { expect } from 'vitest';
import {
  REPO, arr, camera, decodePng, frameAt, framesOf, obj, readNamed, sessionDoc, shown, sun,
  type Image, type JsonObject, type JsonValue, type ViewFrame,
} from '../422/helpers.ts';

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed
 * (`scripts/proof-change.mjs`, `criterionId`), from issue #1285's body as of 2026-11-04. */
export const AC = {
  1: 'AC1 #1285.2ac36129',
  2: 'AC2 #1285.9b9bfe99',
  3: 'AC3 #1285.a78aa552',
  4: 'AC4 #1285.3c874962',
  5: 'AC5 #1285.b504b684',
} as const;

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run`, keeping stderr

export interface Kept { replies: JsonObject[]; stderr: string }
/** One process, the calls in order, a reply per call, and everything the binary wrote to stderr. */
export function runKeepingStderr(bin: string, out: string, calls: JsonObject[]): Kept {
  const name = 'deep-gpu run';
  const run = spawnSync(bin, ['run'], {
    cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL',
  });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${name}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const stderr = run.stderr ?? '';
  expect(timedOut, `${name} finished within its timeout`).toBe(false);
  expect(run.status, `${name} exited 0 (${run.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${stderr.slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, `${name}: the answer`);
  expect(answer['ok'], `${name} refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${name}: replies`).map((r, i) => obj(r, `${name}: replies[${i}]`));
  expect(replies.length, `${name}: one reply per call`).toBe(calls.length);
  return { replies, stderr };
}

/** The lines of stderr that report a device validation error (wgpu's "Validation Error", or the message of one, such as
 * "expects a BindGroup to be set at index 3"). */
export function validationErrors(stderr: string): string[] {
  return stderr.split('\n').filter((l) => /validation error|expects a bindgroup|wgpu error/i.test(l));
}
/** No device validation error was written while drawing (a soft check, so a test reports it beside its other failures). */
export function noValidationError(stderr: string, what: string): void {
  expect.soft(validationErrors(stderr), `${what}: deep-gpu writes no device validation error to stderr; stderr was:\n${stderr.slice(-3000)}`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------------
// film.blank's measure (technical design, the parity suite's blank guard; canvas primitives, film.blank):
// a frame is blank when its luma is at most 0.06 over at least 98% of its pixels.

/** A pixel's luma, 0..1, from its 8-bit values with Rec. 709's weights. */
export const luma = (im: Image, i: number): number =>
  (0.2126 * im.rgba[i * 4]! + 0.7152 * im.rgba[i * 4 + 1]! + 0.0722 * im.rgba[i * 4 + 2]!) / 255;
/** The share of pixels whose luma is at most 0.06. */
export function darkShare(im: Image): number {
  const n = im.width * im.height;
  let dark = 0;
  for (let i = 0; i < n; i++) if (luma(im, i) <= 0.06) dark++;
  return dark / n;
}
export const isBlank = (im: Image): boolean => darkShare(im) >= 0.98;
/** The frame isn't blank (a soft check, so a test reports it beside its other failures). */
export function notBlank(im: Image, what: string): void {
  expect.soft(isBlank(im), `${what} isn't blank under film.blank's measure (luma ≤ 0.06 over ≥ 98% of its pixels): ${(darkShare(im) * 100).toFixed(1)}% of its pixels are at or under 0.06`).toBe(false);
}

// ---------------------------------------------------------------------------------------------------
// Frames

export interface Drawn { frame: ViewFrame; final: Image }
/** Each reply's frame `n` and its final target, read back from the PNG it names. */
export function finals(out: string, replies: JsonObject[], names: string[], n = 0): Drawn[] {
  return replies.map((r, i) => {
    const f = frameAt(framesOf(r, names[i]!), n, names[i]!);
    return { frame: f, final: decodePng(readNamed(out, f.final, 'png', `${names[i]}: the final target`)) };
  });
}
/** The pixel at (x, y): [r, g, b]. */
export const px = (im: Image, x: number, y: number): [number, number, number] => {
  const o = (y * im.width + x) * 4;
  return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!];
};
/** The largest channel difference, in 8-bit codes, between two pixels. */
export const codes = (a: [number, number, number], b: [number, number, number]): number =>
  Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
/** The pixels of a w × h frame within `r` px of its centre. */
export function centre(w: number, h: number, r: number): [number, number][] {
  const out: [number, number][] = [];
  for (let y = Math.floor(h / 2) - r; y < Math.floor(h / 2) + r; y++) for (let x = Math.floor(w / 2) - r; x < Math.floor(w / 2) + r; x++) out.push([x, y]);
  return out;
}
/** The pixels of a w × h frame in its four `r` × `r` corners. */
export function corners(w: number, h: number, r: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [x0, y0] of [[0, 0], [w - r, 0], [0, h - r], [w - r, h - r]] as const) for (let y = y0; y < y0 + r; y++) for (let x = x0; x < x0 + r; x++) out.push([x, y]);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The fixtures

/** Small frames, as the issue's repro draws them. */
export const SIZE: [number, number] = [64, 48];
/** The camera on +Z looking at the origin. */
export const CAM = camera([0, 0, 5], [0, 0, 0], 40, { near: 0.1, far: 100 });
/** A sky whose gradient is bright at both ends, near white (AC1), with a little ambient light. */
export const BRIGHT_SKY: JsonObject = {
  kind: 'sky@1', params: { top: [0.95, 0.95, 0.95, 1], low: [0.85, 0.85, 0.85, 1], ambient_top: [0.1, 0.1, 0.1], ambient_low: [0.1, 0.1, 0.1] },
};
/** The key sun, from over the camera's right shoulder. */
export const KEY = sun(3, [-35, 25, 0]);
/** A document of a camera and the given items, at the small size. */
export const doc = (id: string, items: Record<string, JsonObject>): JsonObject => sessionDoc(id, SIZE, { cam: CAM, ...items });
