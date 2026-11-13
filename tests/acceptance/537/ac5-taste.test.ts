// AC5 #537.7f9c9403: Shown to you: screenshots of the instancer with slot 3 turning off and on, the fog overlay on the
// terrain plate and the 3D line segments, taken by the check run from the canvas's own frames, with a recording of the
// slot and the fog changing, are attached to the PR and shown to you in the session. Whether they look right is one
// taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to
// judge it
//
// The check run (README: The taste call): this test draws the criteria's own fixtures through `deep-gpu run`'s `view3d`
// (each picture a frame's final target, the PNG the canvas wrote), re-encodes each so the same pixels always give the
// same bytes, writes them to docs/evidence/537/ and prints their SHA-256s. Then it reads tests/acceptance/537/TASTE.json:
// none, or a call on other pictures, fails `INCONCLUSIVE:`, never a pass; `looks_wrong` fails; `looks_right` on exactly
// these pictures passes. It judges no picture. The canvas's frames are deterministic on one machine, so a call stands on
// the hashes alone.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OFF_FROM, ON_AGAIN, SQUARE_STEP, fogProgram, lineProgram, slotsProgram } from './programs.ts';
import { LINE_SIZE, UNITS_SIZE, fogSession, lineSession, unitsSession } from './fixtures.ts';
import {
  AC, REPO, TIMEOUT, binOf, encodeApng, finalOf, frameAt, framesOf, inconclusive, pngBytes, prebuild, putAsset, requireMetal, runGpu,
  sha256, useTemp, view3dCall, writeJson, type Image, type JsonObject, type JsonValue,
} from './helpers.ts';

prebuild(['deep-gpu']);
const temp = useTemp();
const EVIDENCE = join(REPO, 'docs', 'evidence', '537');
const TASTE = join(REPO, 'tests', 'acceptance', '537', 'TASTE.json');
const CRITERION = '#537.7f9c9403';
const NAMES = ['slot3-live-gen1.png', 'slot3-off.png', 'slot3-live-gen2.png', 'fog-overlay.png', 'line-segments.png', 'slot-and-fog.apng'] as const;
/** The recording: slot 3 from step 45 to 65, then the fog from step 590 to 600, at 12 frames a second, 400 × 400 px. */
const SLOT_CLIP = { from: 45, to: 65 } as const;
const FOG_CLIP = { from: SQUARE_STEP - 10, to: SQUARE_STEP } as const;
const OFF_SHOT = 55;
const LINE_SHOT = 50;
const FOG_SHOT_SIZE: [number, number] = [1024, 1024];

describe(`${AC[5]} the check run's pictures of the slot, the fog and the lines, and the one taste call on them`, () => {
  it(`${AC[5]} the check run takes the screenshots and the recording from the canvas's own frames, and the recorded call on exactly those pictures says they look right; with none the run is INCONCLUSIVE, never PASS`, () => {
    requireMetal();
    const out = temp();
    const [slots, fog, line] = [slotsProgram(), fogProgram(), lineProgram()];
    const assets = { ...putAsset(out, slots.bytes, 'wasm'), ...putAsset(out, fog.bytes, 'wasm'), ...putAsset(out, line.bytes, 'wasm') };
    const clip = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);
    const [u, fClip, fShot, l] = runGpu(binOf('deep-gpu'), out, [
      view3dCall({ doc: writeJson(out, 'units', unitsSession(slots)), size: UNITS_SIZE, frames: SLOT_CLIP.to + 1, capture: clip(SLOT_CLIP.from, SLOT_CLIP.to), targets: ['final'], assets }),
      view3dCall({ doc: writeJson(out, 'fog-small', fogSession(fog, UNITS_SIZE)), size: UNITS_SIZE, from: FOG_CLIP.from, frames: FOG_CLIP.to - FOG_CLIP.from + 1, capture: 'every', targets: ['final'], assets }),
      view3dCall({ doc: writeJson(out, 'fog-shot', fogSession(fog, FOG_SHOT_SIZE)), size: FOG_SHOT_SIZE, from: SQUARE_STEP, frames: 1, capture: [SQUARE_STEP], targets: ['final'], assets }),
      view3dCall({ doc: writeJson(out, 'links', lineSession(line)), size: LINE_SIZE, from: LINE_SHOT, frames: 1, capture: [LINE_SHOT], targets: ['final'], assets }),
    ], 'AC5 the check run');
    const shot = (reply: JsonObject | undefined, n: number, what: string): Image => finalOf(out, frameAt(framesOf(reply!, what), n, what), what);
    const unitFrames = clip(SLOT_CLIP.from, SLOT_CLIP.to).map((n) => shot(u, n, `the units at step ${n}`));
    const fogFrames = clip(FOG_CLIP.from, FOG_CLIP.to).map((n) => shot(fClip, n, `the fog at step ${n}`));
    const files: Record<string, Buffer> = {
      'slot3-live-gen1.png': pngBytes(unitFrames[OFF_FROM - 1 - SLOT_CLIP.from]!),
      'slot3-off.png': pngBytes(unitFrames[OFF_SHOT - SLOT_CLIP.from]!),
      'slot3-live-gen2.png': pngBytes(unitFrames[ON_AGAIN - SLOT_CLIP.from]!),
      'fog-overlay.png': pngBytes(shot(fShot, SQUARE_STEP, 'the fog at step 600')),
      'line-segments.png': pngBytes(shot(l, LINE_SHOT, 'the line at step 50')),
      'slot-and-fog.apng': encodeApng([...unitFrames, ...fogFrames], 12),
    };
    const hashes = Object.fromEntries(NAMES.map((n) => [n, sha256(files[n]!)]));
    mkdirSync(EVIDENCE, { recursive: true });
    for (const n of NAMES) {
      const path = join(EVIDENCE, n);
      if (!existsSync(path) || sha256(readFileSync(path)) !== hashes[n]) writeFileSync(path, files[n]!);
    }
    const listed = NAMES.map((n) => `  docs/evidence/537/${n}  ${hashes[n]}`).join('\n');
    console.log(`${AC[5]}: the check run's pictures:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: attach these to the PR, show them to the owner\n${listed}\nand record the answer in tests/acceptance/537/TASTE.json (README: The taste call)`);
    let parsed: JsonValue;
    try { parsed = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed), 'TASTE.json is an object').toBe(true);
    const call = parsed as Record<string, JsonValue>;
    expect(call['issue'], 'TASTE.json: issue').toBe(537);
    expect(call['criterion'], 'TASTE.json: criterion').toBe(CRITERION);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(call['verdict']);
    expect(typeof call['who'] === 'string' && call['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof call['when'] === 'string' && /^\d{4}-\d\d-\d\dT/.test(call['when']) && !Number.isNaN(Date.parse(call['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded = (call['screenshots'] ?? {}) as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json: screenshots names the six files').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(call['who'])}, ${String(call['when'])}) was made on other pictures: ${other.join(', ')} differ from this run's; this run's are written for a new call`);
    if (call['verdict'] === 'looks_wrong') expect.fail(`the taste call (${String(call['who'])}, ${String(call['when'])}) says they don't look right${typeof call['note'] === 'string' ? `: ${call['note']}` : ''}`);
    console.log(`${AC[5]}: taste call recorded by ${String(call['who'])} at ${String(call['when'])}: looks right`);
  }, TIMEOUT);
});
