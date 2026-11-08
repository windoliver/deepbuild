// AC7 #467.16dd5c0a: Shown to you: screenshots of text with a drop, glow, inner shade, bevel and satin, the isometric y
// sort and the parallax clouds, taken by the check run from the canvas's own frames, with a recording of the looping
// parallax bands, are attached to the PR and shown to you in the session. Whether they look right is one taste call,
// recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it
//
// One run draws every picture through `deep-gpu run`'s `film2d` with `capture` (#149), the frames the canvas shows, and
// writes them to `docs/evidence/467/` (README: The taste call): the screenshots byte for byte the canvas's PNGs and the
// recording an animated PNG of its frames, printing each SHA-256. It then reads `tests/acceptance/467/TASTE.json`: none,
// or one made on other pictures, is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these passes. No other
// test reads these pictures or the call.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, REPO, bands, capturedPng, card, decodePng, encodeApng, film2dCall, inconclusive, obj, requireMetal, runGpu, sha256,
  sortingLine, useBin, useDir, type JsonObject, type JsonValue,
} from './helpers.ts';

const ID = AC[7];
const bin = useBin('deep-gpu');
const dir = useDir();
const SHOTS = join(REPO, 'docs', 'evidence', '467');
const TASTE = join(REPO, 'tests', 'acceptance', '467', 'TASTE.json');

/** Each still: its file name, its document and the frame (at 30 fps) it shows. */
const STILLS: [string, JsonObject, number][] = [
  ['text-drop.png', card('taste-drop', { drop: { offset: [6, 6], role: 'drop' } }, 'Drop'), 0],
  ['text-glow.png', card('taste-glow', { glow: { role: 'glow', size: 10 } }, 'Glow'), 0],
  ['text-inner-shade.png', card('taste-shade', { shade: { kind: 'inner', role: 'shade', offset: 5, blur: 3 } }, 'Shade'), 0],
  ['text-bevel.png', card('taste-bevel', { bevel: { size: 5, highlight: { role: 'light' }, shadow: { role: 'dark' } } }, 'Bevel'), 0],
  ['text-satin.png', card('taste-satin', { satin: { role: 'satin' } }, 'Satin'), 0],
  ['y-sort.png', sortingLine(), 75],
  ['parallax-clouds.png', bands(), 30],
];
/** The recording: the 4.7 s loop's frames 0, 3, … 138 at 30 fps, played at 10 fps. */
const RECORDED = Array.from({ length: 47 }, (_, k) => k * 3);
const RECORDING = 'parallax-bands.apng';
const NAMES = [...STILLS.map(([n]) => n), RECORDING];

describe(`${ID} the screenshots, the recording and the one taste call on them`, () => {
  it(`${ID} the run writes the pictures from the canvas's own frames, and the recorded call on exactly those says they look right`, () => {
    requireMetal();
    const out = dir();
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    const keep = (name: string, bytes: Buffer): void => { writeFileSync(join(SHOTS, name), bytes); hashes[name] = sha256(bytes); };
    const frame = (n: number): JsonObject => ({ fps: 30, from: n, frames: 1, capture: [n] });
    const stills = runGpu(bin(), out, STILLS.map(([, d, n]) => film2dCall(d, frame(n))));
    STILLS.forEach(([name, , n], i) => keep(name, capturedPng(out, stills[i]!, n, name)));
    const loop = bands();
    const recorded = runGpu(bin(), out, RECORDED.map((n) => film2dCall(loop, frame(n))));
    keep(RECORDING, encodeApng(RECORDED.map((n, i) => decodePng(capturedPng(out, recorded[i]!, n, `the recording's frame ${n}`))), 10));

    const listed = NAMES.map((n) => `  ${join('docs', 'evidence', '467', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: screenshots and recording written from this run's pixels:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/467/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    const c = obj(call, 'TASTE.json');
    expect(c['issue'], 'TASTE.json: issue').toBe(467);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#467.16dd5c0a');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recordedCall = obj(c['screenshots'], 'TASTE.json: screenshots, by name');
    expect(Object.keys(recordedCall).sort(), 'TASTE.json names every screenshot and the recording').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recordedCall[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recordedCall[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  });
});
