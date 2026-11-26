// AC6 #3036.28aa4780: "Shown to you: one still of wheel tracks across a field, taken by the check run. Whether they read
// as tracks is one taste call, recorded; without it the run stays INCONCLUSIVE"
//
// The check run (README: The taste call): this test draws the field (helpers.ts `fieldDoc`: a cart on four wheels
// driven in a straight line across a 24 × 16 m field of gentle rises, its plate keeping the wheels' tracks, 0.3 m wide
// and 6 cm deep, under a low sun) with `view3d` in the filmic look, 1280 × 720, the one frame at 8 s, and keeps the
// renderer's own final PNG, byte for byte, as docs/evidence/3036/wheel-tracks.png, printing its SHA-256. Before it
// keeps anything it draws the same field without tracks: the two frames differ, so the tracks are in the still.
// Then it reads tests/acceptance/3036/TASTE.json: none, or a call made on another picture, fails `INCONCLUSIVE:`,
// never a pass; `looks_wrong` fails; `looks_right` on exactly this picture passes. With no GPU the test is BLOCKED. It
// judges no picture, and no other test reads one.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FILMIC, ID, REPO, STILL_FPS, STILL_FRAME, STILL_SIZE, TIMEOUT, fieldDoc, finalOf, hashAt, inconclusive, requireGpu, runGpu, sha256, useBins, useFolders, view3d, writeJson,
  type JsonValue,
} from './helpers.ts';

const bin = useBins(['deep-gpu']);
const folder = useFolders();
const EVIDENCE = join(REPO, 'docs', 'evidence', '3036');
const TASTE = join(REPO, 'tests', 'acceptance', '3036', 'TASTE.json');
const STILL = 'wheel-tracks.png';

describe(`${AC[6]} one still of wheel tracks across a field, and the one taste call on it`, () => {
  it(`${AC[6]} the check run takes one still of wheel tracks across a field from the renderer's own output, and the recorded call on exactly that still says they read as tracks; with none the run is INCONCLUSIVE, never PASS`, () => {
    requireGpu();
    const dir = folder();
    const shot = (name: string, tracks: boolean) =>
      view3d({ doc: writeJson(dir, name, fieldDoc(name, tracks)), look: FILMIC, size: STILL_SIZE, fps: STILL_FPS, from: STILL_FRAME, frames: 1, capture: [STILL_FRAME], targets: ['final'] });
    const [tracked, untracked] = runGpu(bin('deep-gpu'), dir, [shot('field-tracks', true), shot('field-bare', false)]);
    expect(hashAt(tracked!, STILL_FRAME, 'the field with wheel tracks'), 'the tracks are in the still: the same field without tracks draws another frame').not.toBe(hashAt(untracked!, STILL_FRAME, 'the field without tracks'));
    const png = finalOf(tracked!, dir, STILL_FRAME, 'the field with wheel tracks');
    const hash = sha256(png);
    mkdirSync(EVIDENCE, { recursive: true });
    const kept = join(EVIDENCE, STILL);
    if (!existsSync(kept) || sha256(readFileSync(kept)) !== hash) writeFileSync(kept, png);
    const listed = `  docs/evidence/3036/${STILL}  ${hash}`;
    console.log(`${ID[6]}: the check run's still:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/3036/TASTE.json (README: The taste call)`);
    let parsed: JsonValue;
    try { parsed = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed), 'TASTE.json is an object').toBe(true);
    const call = parsed as Record<string, JsonValue>;
    expect(call['issue'], 'TASTE.json: issue').toBe(3036);
    expect(call['criterion'], 'TASTE.json: criterion').toBe(ID[6]);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(call['verdict']);
    expect(typeof call['who'] === 'string' && call['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof call['when'] === 'string' && /^\d{4}-\d\d-\d\dT/.test(call['when']) && !Number.isNaN(Date.parse(call['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded = (call['screenshots'] ?? {}) as Record<string, JsonValue>;
    expect(Object.keys(recorded), 'TASTE.json: screenshots names the one still').toEqual([STILL]);
    if (recorded[STILL] !== hash) inconclusive(`the recorded call (${String(call['who'])}, ${String(call['when'])}) was made on another picture (${String(recorded[STILL])}) than this run's (${hash}); this run's is written for a new call`);
    if (call['verdict'] === 'looks_wrong') expect.fail(`the taste call (${String(call['who'])}, ${String(call['when'])}) says they don't read as tracks${typeof call['note'] === 'string' ? `: ${call['note']}` : ''}`);
    console.log(`${ID[6]}: taste call recorded by ${String(call['who'])} at ${String(call['when'])}: they read as tracks`);
  }, TIMEOUT);
});
