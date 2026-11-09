// C5 #1479.67deff55: "Shown to you: screenshots of a title at 1×, 8× and 16× beside the Vello CPU snapshot, taken by the
// check run from the canvas at the reference window, with a recording of the zoom, are attached to the PR and shown to you
// in the session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS,
// and no criterion above reads a picture to judge it"
//
// The check run (README: The taste call). The 40 u title of criterion 2 (`HIMN`, white ink on a black ground) is drawn at
// the reference window, 3024 × 1964 device px (1512 × 982 points at 2×), centred, at view zoom 1, 8 and 16: GPUI's frame by
// `deep-canvas-render render` beside Vello CPU's snapshot of the same document by `raster`, one PNG per zoom; and the zoom
// itself, 120 frames from 1× to 16× (criterion 2's steps) drawn in order by one `render` process, as one animated PNG. The
// files go to `docs/evidence/1479/`, each SHA-256 printed. Then it reads `tests/acceptance/1479/TASTE.json`: none, or a call
// made on other pictures (another SHA-256), is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these passes.
// Nothing here judges a picture: the pixels are copied, never measured. At the base `render` and `raster` refuse a zoom
// above 8, so the run can't take the 16× screenshot or the end of the recording and fails before writing anything.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  REPO, TITLE_EM, WORD, answers, arr, drawLine, needsMac, notUnsupported, num, obj, readFrame, textDoc, useDir, useRender, zoomAt,
  type Image, type JsonObject, type JsonValue,
} from '../helpers.ts';

const ID = 'C5 #1479.67deff55';
const bin = useRender();
const dir = useDir('deep-1479-taste-');
const SHOTS = join(REPO, 'docs', 'evidence', '1479');
const TASTE = join(REPO, 'tests', 'acceptance', '1479', 'TASTE.json');
/** The reference window (design: Decided, "The reference window"): 1512 × 982 points at 2×, in device px. */
const WINDOW: [number, number] = [3024, 1964];
const SHOT_ZOOMS = [1, 8, 16];
/** Criterion 2's zoom: 120 frames from 1× to 16×, played back at 30 a second (4 s). */
const FRAMES = 120;
const FPS = 30;
/** The strip between GPUI's frame (left) and Vello CPU's snapshot (right), mid grey. */
const GAP = 32;
const GREY = [128, 128, 128, 255];
const shotName = (z: number): string => `title-${z}x.png`;
const RECORDING = 'zoom-1x-16x.apng';
const NAMES = [...SHOT_ZOOMS.map(shotName), RECORDING];

/** The title's ink box relative to its item's position, in u, from Vello CPU's glyph outlines (framing only). */
function inkBox(answer: JsonObject, item: string): [number, number, number, number] {
  const glyphs = arr(obj(obj(answer['texts'], 'texts')[item], `texts.${item}`)['glyphs'], `texts.${item}.glyphs`);
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [i, g] of glyphs.entries()) {
    const o = obj(g, `glyph ${i}`);
    const m = arr(o['transform'], `glyph ${i}'s transform`).map((v) => num(v, 'transform'));
    for (const c of arr(o['outline'], `glyph ${i}'s outline`)) {
      const p = arr(c, 'outline command').slice(1).map((v) => num(v, 'outline point'));
      for (let k = 0; k + 1 < p.length; k += 2) {
        const x = m[0]! * p[k]! + m[2]! * p[k + 1]! + m[4]!; const y = m[1]! * p[k]! + m[3]! * p[k + 1]! + m[5]!;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
  }
  expect(x1 > x0 && y1 > y0, `the title's outlines bound a box: ${[x0, y0, x1, y1].join(', ')}`).toBe(true);
  return [x0, y0, x1, y1];
}

/** The canvas as the reference window shows it at `zoom`: a document of the window's extent in u, the title at its centre. */
function windowDoc(zoom: number, ink: [number, number, number, number]): JsonObject {
  const [w, h] = [WINDOW[0] / zoom, WINDOW[1] / zoom];
  return textDoc('title-1479-window', WORD, TITLE_EM, [w, h], [w / 2 - (ink[0] + ink[2]) / 2, h / 2 - (ink[1] + ink[3]) / 2]).doc;
}

/** `image` on exactly the window's pixels: a size off by the renderer's rounding (≤ 1 px) is padded with its ground or cut. */
function fit(image: Image): Image {
  const [w, h] = WINDOW;
  if (image.width === w && image.height === h) return image;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba.set(image.rgba.subarray(0, 4), i * 4);
  for (let y = 0; y < Math.min(h, image.height); y++) rgba.set(image.rgba.subarray(y * image.width * 4, (y * image.width + Math.min(w, image.width)) * 4), y * w * 4);
  return { width: w, height: h, rgba };
}

/** GPUI's frame and Vello CPU's snapshot side by side, their pixels unchanged, a grey strip between. */
function beside(gpui: Image, vello: Image): Image {
  const [w, h] = WINDOW;
  const width = 2 * w + GAP;
  const rgba = new Uint8Array(width * h * 4);
  for (let y = 0; y < h; y++) {
    rgba.set(gpui.rgba.subarray(y * w * 4, (y + 1) * w * 4), y * width * 4);
    for (let x = w; x < w + GAP; x++) rgba.set(GREY, (y * width + x) * 4);
    rgba.set(vello.rgba.subarray(y * w * 4, (y + 1) * w * 4), (y * width + w + GAP) * 4);
  }
  return { width, height: h, rgba };
}

// PNG and APNG writing (8-bit RGBA, filter 0 on every row).
function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const n = Buffer.alloc(4); n.writeUInt32BE(data.length);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(body));
  return Buffer.concat([n, body, c]);
}
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function header(image: Image): Buffer {
  const b = Buffer.alloc(13); b.writeUInt32BE(image.width, 0); b.writeUInt32BE(image.height, 4); b[8] = 8; b[9] = 6;
  return chunk('IHDR', b);
}
function deflated(image: Image): Buffer {
  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y++) raw.set(image.rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return deflateSync(raw, { level: 9 });
}
const png = (image: Image): Buffer => Buffer.concat([SIGNATURE, header(image), chunk('IDAT', deflated(image)), chunk('IEND', Buffer.alloc(0))]);
/** An animated PNG of frames of the window's size, given as their deflated rows, `FPS` a second, looping. */
function apng(frames: Buffer[]): Buffer {
  const [w, h] = WINDOW;
  const actl = Buffer.alloc(8); actl.writeUInt32BE(frames.length, 0);
  const parts = [SIGNATURE, header({ width: w, height: h, rgba: new Uint8Array(0) }), chunk('acTL', actl)];
  let seq = 0;
  frames.forEach((data, f) => {
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0); fctl.writeUInt32BE(w, 4); fctl.writeUInt32BE(h, 8); fctl.writeUInt16BE(1, 20); fctl.writeUInt16BE(FPS, 22);
    parts.push(chunk('fcTL', fctl));
    if (f === 0) parts.push(chunk('IDAT', data));
    else { const s = Buffer.alloc(4); s.writeUInt32BE(seq++); parts.push(chunk('fdAT', Buffer.concat([s, data]))); }
  });
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}
const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}

describe(`${ID} the screenshots at 1×, 8× and 16×, the recording of the zoom, and the one taste call on them`, () => {
  it(`${ID} the run draws the title at the reference window by GPUI beside Vello CPU and records the zoom, and the recorded call on exactly those pictures says they look right; with none the run is INCONCLUSIVE, never PASS`, () => {
    needsMac();
    // Framing: the title's ink box, from one Vello CPU snapshot of it at its item's origin.
    const probe = textDoc('title-1479-probe', WORD, TITLE_EM, [200, 100], [0, 0]);
    const probeLine = drawLine(dir(), probe.doc, 1);
    const [probed] = answers(bin(), 'raster', [probeLine]);
    readFrame(probeLine, probed!, 'raster: the title at its origin');
    const ink = inkBox(probed!, probe.item);

    const zooms = Array.from({ length: FRAMES }, (_, k) => zoomAt(k, FRAMES));
    expect(zooms[0], 'the recording starts at 1×').toBe(1);
    expect(zooms[FRAMES - 1], 'the recording ends at 16×').toBeCloseTo(16, 9);
    const live = SHOT_ZOOMS.map((z) => drawLine(dir(), windowDoc(z, ink), z));
    const snap = SHOT_ZOOMS.map((z) => drawLine(dir(), windowDoc(z, ink), z));
    const film = zooms.map((z) => drawLine(dir(), windowDoc(z, ink), z));
    const LIVE = "GPUI's frame (render)"; const SNAP = "Vello CPU's snapshot (raster)"; const FILM = "the recording's frame (render)";
    const liveA = answers(bin(), 'render', live);
    const snapA = answers(bin(), 'raster', snap);
    const filmA = answers(bin(), 'render', film);
    const refused: string[] = [];
    for (const [what, got, at] of [[LIVE, liveA, SHOT_ZOOMS], [SNAP, snapA, SHOT_ZOOMS], [FILM, filmA, zooms]] as const) {
      got.forEach((a, k) => {
        const z = at[k]!;
        notUnsupported(a, `${what} at ${z.toFixed(3)}×`);
        if (a['ok'] !== true) refused.push(`${what} at ${z.toFixed(3)}× (${(TITLE_EM * z).toFixed(1)} device px a em) was refused: ${JSON.stringify(a).slice(0, 300)}`);
      });
    }
    expect(refused, `the check run takes every picture at the reference window (${refused.length} refused)`).toEqual([]);

    const files: Record<string, Buffer> = {};
    SHOT_ZOOMS.forEach((z, i) => {
      const g = fit(readFrame(live[i]!, liveA[i]!, `${LIVE} at ${z}×`).image);
      const v = fit(readFrame(snap[i]!, snapA[i]!, `${SNAP} at ${z}×`).image);
      files[shotName(z)] = png(beside(g, v));
    });
    files[RECORDING] = apng(zooms.map((z, k) => deflated(fit(readFrame(film[k]!, filmA[k]!, `${FILM} ${k} at ${z.toFixed(3)}×`).image))));

    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    for (const n of NAMES) { writeFileSync(join(SHOTS, n), files[n]!); hashes[n] = sha256(files[n]!); }
    const listed = NAMES.map((n) => `  ${join('docs', 'evidence', '1479', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: the check run's pictures, from this run's frames (GPUI left, Vello CPU right):\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: attach these to the PR, show the owner\n${listed}\nand record the answer in tests/acceptance/1479/TASTE.json (taste/README.md: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(1479);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#1479.67deff55');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the three screenshots and the recording').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, 3_600_000);
});
