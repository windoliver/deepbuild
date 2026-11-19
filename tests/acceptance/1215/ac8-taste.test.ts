// AC8 #1215.c041c4e8: Shown to you: screenshots of a vertical title card, a column of mixed Chinese, Latin and digits,
// and vertical punctuation, taken by the check run from the app at the reference window, are attached to the PR and shown
// to you in the session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE,
// never PASS, and no criterion above reads a picture to judge it
//
// The check run (README: The taste call). Three documents the size of the reference window, 1512 × 982 u, in the clean
// look's light theme, each drawn by `deep-canvas-render render`, GPUI's frame path, the app's, at view zoom 2: 3024 × 1964
// device px, the window's 1512 × 982 points at 2×. The run copies each PNG, as drawn, to docs/evidence/1215/ and prints
// its SHA-256, then reads tests/acceptance/1215/TASTE.json: none, or a call on other pictures, fails INCONCLUSIVE, never
// a pass; `looks_wrong` fails; `looks_right` on exactly these pictures passes. Nothing here judges a picture.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { answers, needsMac, readFrame } from '../1479/helpers.ts';
import { TIMEOUT, inconclusive, useRender } from '../496/helpers.ts';
import { AC, LOOK, REPO, figure, textItem, type JsonObject, type JsonValue } from './helpers.ts';

const b = useRender();
const SHOTS = join(REPO, 'docs', 'evidence', '1215');
const TASTE = join(REPO, 'tests', 'acceptance', '1215', 'TASTE.json');
const CRITERION = '#1215.c041c4e8';
/** The reference window (technical design: Decided): 1512 × 982 points at 2×. */
const WINDOW: [number, number] = [1512, 982];
const SCALE = 2;

const band: JsonObject = { id: 'band', kind: 'rect@1', layer: 'main', name: 'band', order: 'a0', params: { box: [0, 380, 1512, 220], paint: { fill: { role: 'accent' } } } };
const DOCS: Record<string, JsonObject> = {
  'title-card.png': figure('ac8-title-card', [
    band,
    textItem('title', '敦煌莫高窟', { size: 160, flow: 'vertical_rl', halo: [{ width: 8, role: 'ground' }] }, [700, 90], 'a1'),
    textItem('subtitle', '北魏　第二百五十四窟', { size: 48, flow: 'vertical_rl' }, [560, 120], 'a2'),
  ], WINDOW),
  'mixed-column.png': figure('ac8-mixed-column', [
    textItem('mixed', '第4窟与第12窟，开凿于隋代，距今约1400年。Mogao 石窟', { size: 64, flow: 'vertical_rl', box: { w: 420, h: 880 }, name: true }, [540, 50]),
  ], WINDOW),
  'punctuation.png': figure('ac8-punctuation', [
    textItem('marks', '（敦煌，莫高窟。）「散花楼」、《飞天》！', { size: 64, flow: 'vertical_rl', box: { w: 300, h: 880 } }, [600, 50]),
  ], WINDOW),
};
const NAMES = Object.keys(DOCS);
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

describe(`${AC[8]} the screenshots of the vertical title card, the mixed column and the vertical punctuation, and the one taste call on them`, () => {
  it(`${AC[8]} the check run takes the three screenshots from the app at the reference window, and the recorded call on exactly those says they look right; with none the run is INCONCLUSIVE, never PASS`, () => {
    needsMac();
    const lines = NAMES.map((n) => ({ out: join(b.out(), n), doc: DOCS[n]!, look: LOOK, view: { zoom: SCALE, theme: 'light' } }));
    const drawn = answers(b.bin(), 'render', lines);
    const files: Record<string, Buffer> = {};
    NAMES.forEach((n, i) => {
      const frame = readFrame(lines[i]!, drawn[i]!, `render: ${n}`);
      expect([frame.image.width, frame.image.height], `${n} is the reference window's 3024 × 1964 device px`).toEqual([WINDOW[0] * SCALE, WINDOW[1] * SCALE]);
      files[n] = readFileSync(lines[i]!.out);
    });
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    for (const n of NAMES) { writeFileSync(join(SHOTS, n), files[n]!); hashes[n] = sha256(files[n]!); }
    const listed = NAMES.map((n) => `  docs/evidence/1215/${n}  ${hashes[n]}`).join('\n');
    console.log(`${AC[8]}: the check run's pictures:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: attach these to the PR, show them to the owner\n${listed}\nand record the answer in tests/acceptance/1215/TASTE.json (README: The taste call)`);
    let parsed: JsonValue;
    try { parsed = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed), 'TASTE.json is an object').toBe(true);
    const call = parsed as Record<string, JsonValue>;
    expect(call['issue'], 'TASTE.json: issue').toBe(1215);
    expect(call['criterion'], 'TASTE.json: criterion').toBe(CRITERION);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(call['verdict']);
    expect(typeof call['who'] === 'string' && call['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof call['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(call['when']) && !Number.isNaN(Date.parse(call['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = call['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the three screenshots').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(call['who'])}, ${String(call['when'])}) was made on other pictures: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (call['verdict'] === 'looks_wrong') expect.fail(`the taste call (${String(call['who'])}, ${String(call['when'])}) says they don't look right${typeof call['note'] === 'string' ? `: ${call['note']}` : ''}`);
    console.log(`${AC[8]}: taste call recorded by ${String(call['who'])} at ${String(call['when'])}: looks right`);
  }, TIMEOUT);
});
