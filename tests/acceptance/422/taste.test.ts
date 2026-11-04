// AC10 #422.99034ca1: Shown to you: screenshots of the castle above the clouds at the four sampled orbit times, and the
// white-furnace metal spheres, taken by the check run from the renderer's own output, with a recording of the castle
// orbiting, are attached to the PR and shown to you in the session. Whether they look right is one taste call,
// recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it.
//
// The run draws, with the same calls as castle.test.ts and metal-furnace.test.ts, the castle at its four sampled
// times, the three white metal balls in the furnace and under the sun, and the castle's whole orbit at 640 × 400 and
// 10 fps, and writes to `target/acceptance/422/` (README: The taste call): `castle-t0.png` … `castle-t3.png` (the
// renderer's own final-target PNGs, byte for byte), `furnace-metal.png` and `sunlit-metal.png` (the three balls' final
// targets side by side, roughness 0, 0.5, 1) and `castle-orbit.apng` (the orbit's final targets as an animated PNG),
// printing each one's SHA-256. It then reads the owner's recorded call, `tests/acceptance/422/TASTE.json`: none, or one
// made on other pictures (another SHA-256), is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these
// pictures passes. No other test reads these pictures or the call.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, CASTLE_FPS, CASTLE_PACKS, DARK_SKY, FURNACE_SKY, REPO, castle, drawSpheres, encodeApng, encodePng, frameAt, framesOf, inconclusive,
  readNamed, readPng, requireReferenceMac, runGpu, sha256, sideBySide, sphereDoc, sun, useDir, useGpu, view3dCall,
  type JsonValue,
} from './helpers.ts';

const ID = AC[10];
const bin = useGpu();
const dir = useDir();
/** Where the run writes the screenshots (under the checkout's ignored `target/`). */
const SHOTS = join(REPO, 'target', 'acceptance', '422');
/** Where the owner's taste call is recorded (README: The taste call). */
const TASTE = join(REPO, 'tests', 'acceptance', '422', 'TASTE.json');
const NAMES = ['castle-t0.png', 'castle-t1.png', 'castle-t2.png', 'castle-t3.png', 'furnace-metal.png', 'sunlit-metal.png', 'castle-orbit.apng'] as const;
const REC_SIZE: [number, number] = [640, 400];
const REC_FPS = 10;

function screenshots(): Record<string, string> {
  const out = dir();
  const c = castle();
  mkdirSync(SHOTS, { recursive: true });
  const hashes: Record<string, string> = {};
  const keep = (name: string, bytes: Buffer): void => { writeFileSync(join(SHOTS, name), bytes); hashes[name] = sha256(bytes); };

  const last = Math.max(...c.samples.map((s) => s.frame));
  const recFrames = c.seconds * REC_FPS;
  const [shots, rec] = runGpu(bin(), out, [
    view3dCall({ doc: c.doc, look: c.look, size: c.size, frames: last + 1, fps: CASTLE_FPS, capture: c.samples.map((s) => s.frame), targets: ['final'], packs: CASTLE_PACKS }),
    view3dCall({ doc: c.doc, look: c.look, size: REC_SIZE, frames: recFrames, fps: REC_FPS, capture: 'every', targets: ['final'], packs: CASTLE_PACKS }),
  ]);
  const castleFrames = framesOf(shots!, 'the castle');
  for (const s of c.samples) {
    const f = frameAt(castleFrames, s.frame, `the castle at ${s.t}`);
    keep(`castle-t${s.k}.png`, readNamed(out, f.final, 'png', `the castle at ${s.t}`));
  }
  const orbit = framesOf(rec!, 'the castle\'s orbit');
  expect(orbit.length, `the recording holds the whole orbit: ${recFrames} frames`).toBe(recFrames);
  keep('castle-orbit.apng', encodeApng(orbit.map((f) => readPng(out, f.final, `the orbit's frame ${f.frame}`)), REC_FPS));

  const params = (r: number) => ({ base_color: [1, 1, 1, 1], metallic: 1, roughness: r });
  const id = (r: number): string => `metal_r${String(Math.round(r * 100)).padStart(3, '0')}`;
  const rough = [0, 0.5, 1];
  const furnace = drawSpheres(bin(), out, rough.map((r) => sphereDoc(`shot-furnace-${id(r)}`, id(r), params(r), FURNACE_SKY, null)));
  const sunlit = drawSpheres(bin(), out, rough.map((r) => sphereDoc(`shot-sun-${id(r)}`, id(r), params(r), DARK_SKY, sun(1, [0, 0, 0]))));
  keep('furnace-metal.png', encodePng(sideBySide(furnace.map((d) => d.final))));
  keep('sunlit-metal.png', encodePng(sideBySide(sunlit.map((d) => d.final))));
  return hashes;
}

describe(`${ID} the screenshots, the recording and the one taste call on them`, () => {
  it(`${ID} the run writes the castle at its four sampled times, the white metal balls in the furnace and under the sun, and the castle's orbit, and the owner's recorded call on exactly those says they look right`, () => {
    requireReferenceMac();
    const hashes = screenshots();
    const listed = NAMES.map((n) => `  ${join('target', 'acceptance', '422', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: screenshots and recording written from this run's pixels:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/422/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(422);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#422.99034ca1');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the six screenshots and the recording').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, 3_600_000);
});
