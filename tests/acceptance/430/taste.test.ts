// AC5 #430.9e7e049e: Shown to you: screenshots of the blurred group beside items drawn before and after it, the backdrop
// group and the eleven blend modes, taken by the check run from the renderer's own output, with a recording of the
// dancing dissolve, are attached to the PR and shown to you in the session. Whether they look right is one taste call,
// recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it.
//
// One run draws AC1's figure (with a blur that reaches its whole grow), AC2's `main` layer, and the eleven modes' figure
// through `layers`, and thirty frames of the dancing dissolve, also through `layers`, at frames 0 to 29. It writes them
// to `docs/evidence/430/` (README: The taste call), the screenshots byte for byte the renderer's PNGs and the recording
// an animated PNG of its frames, printing each SHA-256. It then reads `tests/acceptance/430/TASTE.json`: none, or one
// made on other pictures, is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these passes. No other test
// reads these pictures or the call.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, BACK, BLUR, FILM_LOOK, LOOK, MIX, REPO, backdropDoc, danceDoc, encodeApng, flickOf, groupDoc, gridBlurPass, hasFile, inconclusive, layerOf, layersCall, mixDoc, readLayers,
  requireMetal, runGpu, sha256, useDir, useGpu, type JsonValue,
} from './helpers.ts';
import { ELEVEN } from './reference.ts';

const ID = AC[5];
const bin = useGpu();
const dir = useDir();
const SHOTS = join(REPO, 'docs', 'evidence', '430');
const TASTE = join(REPO, 'tests', 'acceptance', '430', 'TASTE.json');
const FRAMES = 30;
const NAMES = ['blurred-group.png', 'backdrop-group.png', ...ELEVEN.map((m) => `blend-${m}.png`), 'dancing-dissolve.apng'];

describe(`${ID} the screenshots, the recording and the one taste call on them`, () => {
  it(`${ID} the run writes the pictures from the renderer's own output, and the recorded call on exactly those says they look right`, () => {
    requireMetal();
    const out = dir();
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    const keep = (name: string, bytes: Buffer): void => { writeFileSync(join(SHOTS, name), bytes); hashes[name] = sha256(bytes); };
    // A shown blur reaches its whole grow, so the eye judges a blur and not the cut AC1 tests.
    const shown = groupDoc('shown-blur-430', [{ op: 'blur', params: {}, grow: 2 * BLUR.grow }], { blur: gridBlurPass('blur', BLUR.stride) });
    const replies = runGpu(bin(), out, [
      layersCall(shown, LOOK), layersCall(backdropDoc('shown-backdrop-430', true), LOOK), ...ELEVEN.map((m) => layersCall(mixDoc(m), LOOK)),
      ...Array.from({ length: FRAMES }, (_, n) => layersCall(danceDoc(true), FILM_LOOK, { t: flickOf(n) })),
    ]);
    const png = (i: number, size: readonly [number, number], what: string): { bytes: Buffer; sha: string } => {
      const sha = layerOf(readLayers(out, replies[i]!, size, what), 'main', what).sha;
      return { bytes: hasFile(out, sha, 'png', what), sha };
    };
    keep('blurred-group.png', png(0, BLUR.size, 'the blurred group').bytes);
    keep('backdrop-group.png', png(1, BACK.size, 'the backdrop group').bytes);
    ELEVEN.forEach((m, i) => keep(`blend-${m}.png`, png(2 + i, MIX.size, m).bytes));
    const frames = Array.from({ length: FRAMES }, (_, n) => layerOf(readLayers(out, replies[2 + ELEVEN.length + n]!, MIX.size, `frame ${n}`), 'main', `frame ${n}`).image);
    keep('dancing-dissolve.apng', encodeApng(frames, 15));

    const listed = NAMES.map((n) => `  ${join('docs', 'evidence', '430', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: screenshots and recording written from this run's pixels:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/430/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(430);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#430.9e7e049e');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names every screenshot and the recording').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, 3_600_000);
});
