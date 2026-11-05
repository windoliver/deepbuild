// AC9 #419.fc4ea214: Shown to you: screenshots of the car over the 1 px line background with 180° blur, the walking
// character with velocity blur and a still with 16 samples, taken by the check run from the renderer's own output,
// with a recording of the blur during a declared move, are attached to the PR and shown to you in the session. Whether
// they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion
// above reads a picture to judge it.
//
// One run draws, with the fixtures the criteria use (helpers): AC8's car at t = 2 s with 16-sample blur at 180°
// (seeked), AC4's walker at frame 6 with velocity blur at 180°, AC2's still exported with 16 samples, and AC1's slider
// over its first declared move (frames 0–24, 1 s at 24 fps) with 8-sample blur. It writes to `docs/evidence/419/`
// (README: The taste call) `car-lines-blur.png`, `walker-velocity.png` and `still-16-samples.png` (the renderer's own
// final-target PNGs, byte for byte) and `blur-move.apng` (the slider's final targets as an animated PNG), printing
// each one's SHA-256. It then reads the recorded call, `tests/acceptance/419/TASTE.json`: none, or one made on other
// pictures (another SHA-256), is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these pictures passes.
// No other test reads these pictures or the call.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, CAR, CAR_SIZE, REPO, SLIDER, SLIDER_SIZE, STILL_SIZE, WALKER, WALKER_SIZE, blur, carDoc, encodeApng, framesOf, inconclusive, look,
  readNamed, readPng, requireMetal, runGpu, sha256, sliderDoc, stillDoc, useDir, useGpu, view3dCall, walkerDoc, writeJson, type JsonValue,
} from './helpers.ts';

const ID = AC[9];
const bin = useGpu();
const dir = useDir();
/** Where the run writes the screenshots and the recording. */
const SHOTS = join(REPO, 'docs', 'evidence', '419');
/** Where the taste call is recorded (README: The taste call). */
const TASTE = join(REPO, 'tests', 'acceptance', '419', 'TASTE.json');
const NAMES = ['car-lines-blur.png', 'walker-velocity.png', 'still-16-samples.png', 'blur-move.apng'] as const;
const REC_FRAMES = 25;

function screenshots(): Record<string, string> {
  const out = dir();
  const [car, walker, still, rec] = runGpu(bin(), out, [
    view3dCall({ doc: writeJson(out, 'car', carDoc()), look: look({ motionBlur: blur('samples', 16) }), size: CAR_SIZE, class: 'export', fps: CAR.fps, from: CAR.frame, frames: 1, targets: ['final'] }),
    view3dCall({ doc: writeJson(out, 'walker', walkerDoc()), look: look({ motionBlur: blur('velocity') }), size: WALKER_SIZE, class: 'export', fps: WALKER.fps, from: WALKER.frame, frames: 1, targets: ['final'] }),
    view3dCall({ doc: writeJson(out, 'still', stillDoc(false)), look: look({ live: 1, export: 16, atRest: 'settle', filter: 'blackman_harris', filterPx: 1.5 }), size: STILL_SIZE, class: 'export', frames: 1, targets: ['final'] }),
    view3dCall({ doc: writeJson(out, 'slider', sliderDoc(false)), look: look({ motionBlur: blur('samples', 8) }), size: SLIDER_SIZE, class: 'export', fps: SLIDER.fps, frames: REC_FRAMES, targets: ['final'] }),
  ]).map((r, i) => framesOf(r, NAMES[i]!));
  mkdirSync(SHOTS, { recursive: true });
  const hashes: Record<string, string> = {};
  const keep = (name: string, bytes: Buffer): void => { writeFileSync(join(SHOTS, name), bytes); hashes[name] = sha256(bytes); };
  keep('car-lines-blur.png', readNamed(out, car![0]!.final, 'png', 'the car'));
  keep('walker-velocity.png', readNamed(out, walker![0]!.final, 'png', 'the walker'));
  keep('still-16-samples.png', readNamed(out, still![0]!.final, 'png', 'the still'));
  expect(rec!.length, `the recording holds the move's ${REC_FRAMES} frames`).toBe(REC_FRAMES);
  keep('blur-move.apng', encodeApng(rec!.map((f) => readPng(out, f.final, `the slider's frame ${f.frame}`)), SLIDER.fps));
  return hashes;
}

describe(`${ID} the screenshots, the recording and the one taste call on them`, () => {
  it(`${ID} the run writes the blurred car over its lines, the velocity-blurred walker, the 16-sample still and a recording of a blurred move from the renderer's own output, and the recorded call on exactly those says they look right`, () => {
    requireMetal();
    const hashes = screenshots();
    const listed = NAMES.map((n) => `  ${join('docs', 'evidence', '419', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: screenshots and recording written from this run's pixels:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/419/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(419);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#419.fc4ea214');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the three screenshots and the recording').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, 3_600_000);
});
