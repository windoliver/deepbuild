// #3034.20ebe811: "Shown to you: one frame from below and one from above the same lake, taken by the check run. Whether
// the frame from below reads as under water is one taste call, recorded; without it the run stays INCONCLUSIVE"
//
// The check run (README: The taste call), in #980's form: this test draws the lake of criteria 4 and 5 (helpers.ts
// `lakeDoc`: waves and ripples over a sand bed, posts standing through the surface, a buoy and a rock under it, a day
// sky and a sun) under a filmic look at 1280 × 720, twice from the one document: at 0.5 s, the camera 1.51 m above
// the surface, and at 3.5 s, 1.49 m below it. Each picture is the renderer's own final PNG, byte for byte, written to
// docs/evidence/3034/ as `lake-from-above.png` and `lake-from-below.png` and listed with its SHA-256.
//
// Then it reads tests/acceptance/3034/TASTE.json, which nobody but the owner's call fills: none, or a call on other
// pictures, fails `INCONCLUSIVE:`, never a pass; `looks_wrong` fails; `looks_right` (the frame from below reads as
// under water) on exactly these pictures passes. It judges no picture, and no other test of the suite reads one.
//
// Guarded, before any file is written: the two frames are two pictures, and the frame from below is the view's, whose
// cone follows `ior`: at 3.5 s the default `ior` and 1.5 draw different frames. So a tree that draws the frame from
// below by no rule (the merge base) fails here and offers nobody a picture to call on, and a tree that refuses the
// camera under water (the first change alone) fails at the refusal.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FILMIC, ID, type JsonObject, type JsonValue, OTHER_IOR, REPO, aboveFrame, belowFrame, frameAt, framesOf, hashAt, inconclusive, isObject, lakeDoc, readNamed,
  requireMachine, runGpu, sha256, useGpu, useOut, view3d, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const EVIDENCE = join(REPO, 'docs', 'evidence', '3034');
const TASTE = join(REPO, 'tests', 'acceptance', '3034', 'TASTE.json');
const SHOT: [number, number] = [1280, 720];
const FPS = 30;
const ABOVE = 'lake-from-above.png';
const BELOW = 'lake-from-below.png';
const NAMES = [ABOVE, BELOW];

describe(`${AC[6]} the check run's two frames of one lake, and the one taste call on them`, () => {
  it(`${AC[6]} the check run takes one frame from above and one from below the same lake from the renderer's own output, and the recorded call on exactly those says the frame from below reads as under water; with none the run is INCONCLUSIVE, never PASS`, () => {
    requireMachine();
    const dir = out();
    const [above, below] = [aboveFrame(FPS), belowFrame(FPS)];
    const lake = writeJson(dir, 'lake', lakeDoc('lake', SHOT));
    const shot = (doc: string, n: number): JsonObject => view3d({ doc, look: FILMIC, size: SHOT, from: n, frames: 1, fps: FPS, capture: [n], targets: ['final'] });
    const [fromAbove, fromBelow, other] = runGpu(bin(), dir, [shot(lake, above), shot(lake, below), shot(writeJson(dir, 'lake-ior', lakeDoc('lake-ior', SHOT, OTHER_IOR)), below)]);
    const a = frameAt(framesOf(fromAbove!, 'the lake from above'), above, 'the lake from above');
    const b = frameAt(framesOf(fromBelow!, 'the lake from below'), below, 'the lake from below');
    expect(b.pixel_hash, 'the frame from below and the frame from above are two pictures').not.toBe(a.pixel_hash);
    expect(hashAt(other!, below, `the lake from below with ior ${OTHER_IOR}`), `the frame from below is the view's, whose cone follows ior: but ior ${OTHER_IOR} draws the default's very frame, so no rule draws it and there is nothing to call on (the merge base draws so)`).not.toBe(b.pixel_hash);

    const files: Record<string, Buffer> = {
      [ABOVE]: readNamed(dir, a.raw['final'], 'png', 'the lake from above: its final PNG'),
      [BELOW]: readNamed(dir, b.raw['final'], 'png', 'the lake from below: its final PNG'),
    };
    const hashes = Object.fromEntries(NAMES.map((n) => [n, sha256(files[n]!)]));
    mkdirSync(EVIDENCE, { recursive: true });
    for (const n of NAMES) {
      const path = join(EVIDENCE, n);
      if (!existsSync(path) || sha256(readFileSync(path)) !== hashes[n]) writeFileSync(path, files[n]!);
    }
    const listed = NAMES.map((n) => `  docs/evidence/3034/${n}  ${hashes[n]}`).join('\n');
    console.log(`${AC[6]}: the check run's pictures:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show these to the owner\n${listed}\nand record whether the frame from below reads as under water in tests/acceptance/3034/TASTE.json (README: The taste call)`);
    let parsed: JsonValue;
    try { parsed = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(isObject(parsed), 'TASTE.json is an object').toBe(true);
    const call = parsed as JsonObject;
    expect(call['issue'], 'TASTE.json: issue').toBe(3034);
    expect(call['criterion'], 'TASTE.json: criterion').toBe(ID[6]);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(call['verdict']);
    expect(typeof call['who'] === 'string' && call['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof call['when'] === 'string' && /^\d{4}-\d\d-\d\dT/.test(call['when']) && !Number.isNaN(Date.parse(call['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded = isObject(call['screenshots']) ? call['screenshots'] : {};
    expect(Object.keys(recorded).sort(), 'TASTE.json: screenshots names the two files').toEqual([...NAMES].sort());
    const others = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (others.length) inconclusive(`the recorded call (${String(call['who'])}, ${String(call['when'])}) was made on other pictures: ${others.join(', ')} differ from this run's; this run's are written for a new call`);
    if (call['verdict'] === 'looks_wrong') expect.fail(`the taste call (${String(call['who'])}, ${String(call['when'])}) says the frame from below doesn't read as under water${typeof call['note'] === 'string' ? `: ${call['note']}` : ''}`);
    console.log(`${AC[6]}: taste call recorded by ${String(call['who'])} at ${String(call['when'])}: the frame from below reads as under water`);
  });
});
