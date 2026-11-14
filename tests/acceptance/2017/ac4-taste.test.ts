// AC4 #2017.44d27f48: "Shown to you: screenshots of the scattered field, the vase on the table, the terrain plate at 1080p
// and 4K, and the trees in wind, taken by the check run from the renderer's own output, with a recording of the wind
// rolling across the tree field, are attached to the PR and shown to you in the session. Whether they look right is one
// taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to
// judge it"
//
// The run draws with `view3d` in the filmic look, one frame each from the renderer's own final target (README: The taste
// call), and writes to `docs/evidence/2017/`: `scattered-field.png` (#2013's garden, 960 × 540), `vase-on-table.png`
// (#2013's vase rested on the tilted table, 960 × 540), `terrain-1080p.png` and `terrain-4k.png` (criterion 1's plate
// from its pose at 1920 × 1080 and 3840 × 2160), `trees-in-wind.png` (#2016's field at 2.5 s, 960 × 540) and
// `wind-rolling.apng` (the field at 480 × 270, 8 fps, 0 to 6 s, 49 frames), printing each one's SHA-256. It then reads
// the recorded call, `tests/acceptance/2017/TASTE.json`: none, or one made on other pictures (another SHA-256), is
// INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these pictures passes. No other test reads these pictures
// or the call.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FILMIC, HD, REPO, TIMEOUT, UHD, decodePng, encodeApng, encodePng, framesOf, gardenDoc, inconclusive, plateDoc, readNamed, requireMetal, runGpu,
  sha256, useBins, useOut, vaseDoc, windDoc, writeJson, type Image, type JsonObject, type JsonValue, type Size,
} from './helpers.ts';

const ID = AC[4];
const NAME = `AC4 ${ID}`;
const bin = useBins(['deep-gpu']);
const out = useOut();
const SHOTS = join(REPO, 'docs', 'evidence', '2017');
const TASTE = join(REPO, 'tests', 'acceptance', '2017', 'TASTE.json');
const NAMES = ['scattered-field.png', 'vase-on-table.png', 'terrain-1080p.png', 'terrain-4k.png', 'trees-in-wind.png', 'wind-rolling.apng'] as const;
const SHOT: Size = [960, 540];
const REC: Size = [480, 270];
const REC_FPS = 8;

/** The renderer's final target of each frame of `doc` drawn at `size`, from `from`, `frames` frames at `fps`. */
function finals(doc: JsonObject, size: Size, what: string, from = 0, frames = 1, fps = REC_FPS): Image[] {
  const dir = out();
  const path = writeJson(dir, 'shot', doc);
  const [reply] = runGpu(bin('deep-gpu'), dir, [{ call: 'view3d', doc: path, look: FILMIC, size: [...size], fps, from, frames, capture: 'every', targets: ['final'] }]);
  return framesOf(reply!, frames, what, from).map((f) => decodePng(readNamed(dir, f['final'], 'png', `${what}: frame ${String(f['frame'])}`)));
}

describe(`${NAME} the screenshots, the recording and the one taste call on them`, () => {
  it(`${NAME} the run writes the scattered field, the vase on the table, the plate at 1080p and 4K, the trees in wind and the wind rolling across them, and the recorded call on exactly those says they look right`, () => {
    requireMetal();
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    const keep = (name: string, bytes: Buffer): void => { writeFileSync(join(SHOTS, name), bytes); hashes[name] = sha256(bytes); };
    keep('scattered-field.png', encodePng(finals(gardenDoc(SHOT), SHOT, 'the scattered field')[0]!));
    keep('vase-on-table.png', encodePng(finals(vaseDoc(SHOT), SHOT, 'the vase on the table')[0]!));
    keep('terrain-1080p.png', encodePng(finals(plateDoc(HD, 'filmic'), HD, 'the plate at 1080p')[0]!));
    keep('terrain-4k.png', encodePng(finals(plateDoc(UHD, 'filmic'), UHD, 'the plate at 4K')[0]!));
    keep('trees-in-wind.png', encodePng(finals(windDoc(SHOT), SHOT, 'the trees in wind', 20, 1)[0]!));
    keep('wind-rolling.apng', encodeApng(finals(windDoc(REC), REC, 'the wind rolling across the field', 0, 6 * REC_FPS + 1), REC_FPS));

    const listed = NAMES.map((n) => `  ${join('docs', 'evidence', '2017', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: screenshots and recording written from this run's pixels:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/2017/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(2017);
    expect(c['criterion'], 'TASTE.json: criterion').toBe(ID);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the five screenshots and the recording').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, 2 * TIMEOUT);
});
