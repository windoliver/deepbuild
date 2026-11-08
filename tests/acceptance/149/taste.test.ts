// AC12 #149.583b9b35: Shown to you: screenshots of each family's fixture in a 2D and a 3D drawing look, paper under a dolly
// and a zoom, and the coloured shadow play, taken by the check run from the canvas's own frames, with a recording of the
// dolly and the zoom, are attached to the PR and shown to you in the session. Whether they look right is one taste call,
// recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it.
//
// One run draws every picture through the same calls the other tests use and writes them to `docs/evidence/149/`
// (README: The taste call), the screenshots byte for byte the canvas's PNGs and the recording an animated PNG of its
// frames, printing each SHA-256. It then reads `tests/acceptance/149/TASTE.json`: none, or one made on other pictures, is
// INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these passes. No other test reads these pictures or the call.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DIMS, FAMILIES, FAMILY_FPS, FAMILY_SIZE, REPO, decodePng, encodeApng, familyFixture, film2dCall, fixtureJson, inconclusive, lookOf, obj, pngOf, requireMetal, rows, runGpu, sha256, useDir,
  useGpu, view3dCall, writeJson, type Image, type JsonObject, type JsonValue,
} from './helpers.ts';

const ID = AC[12];
const bin = useGpu();
const dir = useDir();
const SHOTS = join(REPO, 'docs', 'evidence', '149');
const TASTE = join(REPO, 'tests', 'acceptance', '149', 'TASTE.json');
const SHOT_FRAME = 30;
const NAMES = [...FAMILIES.flatMap((f) => DIMS.map((d) => `${f}-${d}.png`)), 'paper-dolly.png', 'paper-zoom.png', 'shadow-play.png', 'paper-dolly-zoom.apng'];

describe(`${ID} the screenshots, the recording and the one taste call on them`, () => {
  it(`${ID} the run writes the pictures from the canvas's own frames, and the recorded call on exactly those says they look right`, () => {
    requireMetal();
    const out = dir();
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    const keep = (name: string, bytes: Buffer): void => { writeFileSync(join(SHOTS, name), bytes); hashes[name] = sha256(bytes); };
    const frame2d = (doc: JsonObject, look: JsonObject, n: number, fps: number, what: string): Buffer => {
      const [reply] = runGpu(bin(), out, [film2dCall(doc, look, { fps, from: n, frames: 1, capture: [n] })]);
      return pngOf(out, rows(reply!, what)[0]!, what);
    };
    for (const f of FAMILIES) {
      const fixture = familyFixture(f);
      const look = lookOf(fixture);
      keep(`${f}-2d.png`, frame2d(obj(fixture['2d'], '2d'), look, SHOT_FRAME, FAMILY_FPS, `${f} in 2D`));
      const call = view3dCall(writeJson(out, `${f}-3d.json`, obj(fixture['3d'], '3d')), look, FAMILY_SIZE, { fps: FAMILY_FPS, from: SHOT_FRAME, frames: 1, capture: [SHOT_FRAME], targets: ['final'] });
      keep(`${f}-3d.png`, pngOf(out, rows(runGpu(bin(), out, [call])[0]!, `${f} in 3D`)[0]!, `${f} in 3D`));
    }
    const move = fixtureJson('paper-move.json');
    const moveDoc = obj(move['doc'], 'the move'); const moveLook = lookOf(move);
    keep('paper-dolly.png', frame2d(moveDoc, moveLook, 300, 30, 'the paper part way along the dolly'));
    keep('paper-zoom.png', frame2d(moveDoc, moveLook, 840, 30, 'the paper at 5×'));
    const play = fixtureJson('shadow-play.json');
    keep('shadow-play.png', frame2d(obj(play['doc'], 'the film'), lookOf(play), 90, 30, 'the shadow play'));
    const recording: Image[] = Array.from({ length: 61 }, (_, k) => decodePng(frame2d(moveDoc, moveLook, k * 14, 30, `the recording's frame ${k}`)));
    keep('paper-dolly-zoom.apng', encodeApng(recording, 10));

    const listed = NAMES.map((n) => `  ${join('docs', 'evidence', '149', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: screenshots and recording written from this run's pixels:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/149/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    const c = obj(call, 'TASTE.json');
    expect(c['issue'], 'TASTE.json: issue').toBe(149);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#149.583b9b35');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded = obj(c['screenshots'], 'TASTE.json: screenshots, by name');
    expect(Object.keys(recorded).sort(), 'TASTE.json names every screenshot and the recording').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  });
});
