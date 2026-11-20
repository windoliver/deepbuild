// AC6 #1484.c44e2788: "Shown to you: screenshots of a title and a label at 400, 450 and 500, taken by the check run from
// the text fixture document, are attached to the PR and shown to you in the session. Whether they look right is one
// taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to
// judge it"
//
// The check run: the text fixture document (`fixtures/text.json`: a 64 u title and a 14 u label in the body role at
// 400, 450 and 500, one 140 u row a weight) drawn at the reference window's scale, zoom 2, in the shipped clean look's
// light theme, by GPUI's frame path (`deep-canvas-render render`, the window's) and by Vello CPU (`raster`, the
// snapshot). One PNG a weight goes to `docs/evidence/1484/`: that weight's row from the window (left) beside the same
// row from the snapshot (right), a grey strip between, the renderers' pixels copied, not altered. Each file's SHA-256
// is printed. Then `TASTE.json` beside this file is read: no call (verdict null), or one made on other pictures, is
// INCONCLUSIVE; `looks_wrong` fails, quoting it; `looks_right` on exactly these pictures passes. Nothing here judges a
// picture, and no other test reads these files. At the base the pictures are taken and no call is recorded.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { AC, REPO, drawLine, inconclusive, isObject, needsMac, picture, run, useBin, useDir, type Image, type JsonObject, type JsonValue } from './helpers.ts';

const ID = AC[6];
const CRITERION = ID.split(' ')[1]!;
const bin = useBin('deep-canvas-render');
const dir = useDir('deep-1484-taste-');

const SHOTS = join(REPO, 'docs', 'evidence', '1484');
const TASTE = join(REPO, 'tests', 'acceptance', '1484', 'TASTE.json');
const FIXTURE = join(REPO, 'tests', 'acceptance', '1484', 'fixtures', 'text.json');
const ZOOM = 2;
/** The fixture's rows, in u: weight → [top, bottom). */
const ROWS: [number, [number, number]][] = [[400, [0, 140]], [450, [140, 280]], [500, [280, 420]]];
const GAP = 32;
const GREY = [128, 128, 128, 255];
const shot = (weight: number): string => `weight-${weight}.png`;
const NAMES = ROWS.map(([w]) => shot(w));

/** Rows [y0, y1) of the window's frame and of the snapshot side by side, their pixels unchanged, a grey strip between. */
function beside(window: Image, snapshot: Image, y0: number, y1: number): Image {
  const w = Math.min(window.width, snapshot.width);
  const width = 2 * w + GAP;
  const height = y1 - y0;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    rgba.set(window.rgba.subarray(((y0 + y) * window.width) * 4, ((y0 + y) * window.width + w) * 4), y * width * 4);
    for (let x = w; x < w + GAP; x++) rgba.set(GREY, (y * width + x) * 4);
    rgba.set(snapshot.rgba.subarray(((y0 + y) * snapshot.width) * 4, ((y0 + y) * snapshot.width + w) * 4), (y * width + w + GAP) * 4);
  }
  return { width, height, rgba };
}

// PNG writing: 8-bit RGBA, filter 0 on every row.
function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const n = Buffer.alloc(4); n.writeUInt32BE(data.length);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(body));
  return Buffer.concat([n, body, c]);
}
function png(image: Image): Buffer {
  const header = Buffer.alloc(13); header.writeUInt32BE(image.width, 0); header.writeUInt32BE(image.height, 4); header[8] = 8; header[9] = 6;
  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y++) raw.set(image.rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

describe(`${ID} the screenshots of a title and a label at 400, 450 and 500, and the one taste call on them`, () => {
  it(`${ID} the check run takes the fixture's rows in the window beside Vello CPU's snapshot, and the recorded call on exactly those pictures says they look right; with none the run is INCONCLUSIVE, never PASS`, () => {
    needsMac();
    const doc = JSON.parse(readFileSync(FIXTURE, 'utf8')) as JsonObject;
    const live = drawLine(dir(), doc, ZOOM, 'light');
    const snap = drawLine(dir(), doc, ZOOM, 'light');
    const [g] = run(bin(), ['render'], [live]);
    const [v] = run(bin(), ['raster'], [snap]);
    const window = picture(live, g!, 'render (the window) of the text fixture document');
    const snapshot = picture(snap, v!, 'raster (Vello CPU) of the text fixture document');
    const files: Record<string, Buffer> = {};
    for (const [weight, [top, bottom]] of ROWS) files[shot(weight)] = png(beside(window, snapshot, top * ZOOM, Math.min(bottom * ZOOM, window.height, snapshot.height)));
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    for (const n of NAMES) { writeFileSync(join(SHOTS, n), files[n]!); hashes[n] = sha256(files[n]!); }
    const listed = NAMES.map((n) => `  docs/evidence/1484/${n}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: the check run's pictures (the window left, Vello CPU's snapshot right):\n${listed}`);

    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`tests/acceptance/1484/TASTE.json can't be read as JSON: ${(e as Error).message}`); }
    expect(isObject(call), 'TASTE.json is an object').toBe(true);
    const c = call as JsonObject;
    expect(c['issue'], 'TASTE.json: issue').toBe(1484);
    expect(c['criterion'], 'TASTE.json: criterion').toBe(CRITERION);
    if (c['verdict'] === null || c['verdict'] === undefined) inconclusive(`no taste call is recorded (TASTE.json's verdict is null): attach these to the PR, show them in the session\n${listed}\nand record the call in tests/acceptance/1484/TASTE.json (README: The taste call)`);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    expect(isObject(c['screenshots']), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = c['screenshots'] as JsonObject;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the three screenshots').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, 1_800_000);
});
