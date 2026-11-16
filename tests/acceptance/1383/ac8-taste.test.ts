// #1383.92cc9800: "Shown to you: a cliff, a snow line by aspect and ground before and after rain, taken by the check run
// from the fixture document, with a recording of the snow line, are attached to the PR and shown to you in the session.
// Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no
// criterion above reads a picture to judge it"
//
// The check run (README: The taste call) draws the fixture document as written (helpers: fixtureDoc) through `view3d` in
// the filmic look, each picture a frame's own final target, and writes to `docs/evidence/1383/`: `cliff.png` (the cliff
// shot at 0 s), `snow-line-by-aspect.png` (the snow shot at 5 s, the north faces' line 120 m under the rest),
// `ground-before-rain.png` and `ground-after-rain.png` (the field shot at 0 s, wet amount 0, and at 8 s, amount 1), all
// 960 × 540, and `snow-line.apng` (the snow shot at 480 × 270 from 0 s to 10 s, drawn and played at 6 frames a second,
// 61 frames), re-encoded so the same pixels give the same SHA-256, which it prints. Then it reads
// `tests/acceptance/1383/TASTE.json`: none, or a call made on other pictures, is INCONCLUSIVE, never a pass;
// `looks_wrong` fails; `looks_right` on exactly these pictures passes. No other test reads these pictures or the call.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FILMIC, REPO, TIMEOUT, checkerAsset, encodeApng, encodePng, finalOf, fixtureDoc, frameAt, framesOf, inconclusive, requireMetal, runGpu, sha256,
  useGpu, useOut, view3d, writeJson, type Image, type JsonValue, type Shot, type Size,
} from './helpers.ts';

const ID = AC[8];
const gpu = useGpu();
const out = useOut();
const SHOTS_DIR = join(REPO, 'docs', 'evidence', '1383');
const TASTE = join(REPO, 'tests', 'acceptance', '1383', 'TASTE.json');
const NAMES = ['cliff.png', 'snow-line-by-aspect.png', 'ground-before-rain.png', 'ground-after-rain.png', 'snow-line.apng'] as const;
const SHOT: Size = [960, 540];
const REC: Size = [480, 270];

describe(`${ID} the cliff, the snow line by aspect, the ground before and after rain, the recording, and the one taste call on them`, () => {
  it(`${ID} the check run takes the pictures and the recording from the fixture document, and the recorded call on exactly those says they look right; with none the run is INCONCLUSIVE, never PASS`, () => {
    requireMetal();
    const dir = out();
    const assets = checkerAsset(dir);
    const still = (shot: Shot, frame: number) => view3d({ doc: writeJson(dir, `${shot}-${frame}`, fixtureDoc({ shot, size: SHOT })), size: SHOT, look: FILMIC, from: frame, capture: [frame], assets });
    const recording = Array.from({ length: 61 }, (_, k) => k);
    const replies = runGpu(gpu(), dir, [
      still('cliff', 0), still('snow', 20), still('field', 0), still('field', 32),
      view3d({ doc: writeJson(dir, 'snow-rec', fixtureDoc({ shot: 'snow', size: REC })), size: REC, look: FILMIC, fps: 6, frames: 61, capture: recording, assets }),
    ]);
    const shot = (k: number, frame: number, what: string): Image => finalOf(dir, frameAt(framesOf(replies[k]!, what), frame, what), what);
    const files: Record<string, Buffer> = {
      'cliff.png': encodePng(shot(0, 0, 'the cliff')),
      'snow-line-by-aspect.png': encodePng(shot(1, 20, 'the snow line by aspect at 5 s')),
      'ground-before-rain.png': encodePng(shot(2, 0, 'the ground before rain')),
      'ground-after-rain.png': encodePng(shot(3, 32, 'the ground after rain')),
      'snow-line.apng': encodeApng(recording.map((n) => shot(4, n, 'the snow line recording')), 6),
    };
    mkdirSync(SHOTS_DIR, { recursive: true });
    const hashes: Record<string, string> = {};
    for (const n of NAMES) { writeFileSync(join(SHOTS_DIR, n), files[n]!); hashes[n] = sha256(files[n]!); }
    const listed = NAMES.map((n) => `  ${join('docs', 'evidence', '1383', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: the check run's pictures and recording, from the fixture document:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: attach these to the PR, show them to the owner in the session\n${listed}\nand record the answer in tests/acceptance/1383/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(1383);
    expect(c['criterion'], 'TASTE.json: criterion').toBe(ID);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the four pictures and the recording').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, 2 * TIMEOUT);
});
