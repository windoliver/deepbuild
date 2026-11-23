// AC3 #1561.ca22b9de: Shown to you: screenshots of the drawn-look fixture in the live window and in deep-show, taken by
// the check run from the app, are attached to the PR and shown to you in the session. Whether they look right is one
// taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to
// judge it.
//
// One run draws the fixture (fixtures/paper-boat.json under fixtures/look.json) at t = 1 s, the camera moved, through
// the two calls AC1's tests use, and writes each path's own frame, byte for byte its PNG, to `target/acceptance/1561/`:
// `live-window.png`, frame 5 of the `live` call at 4 frames a second, and `deep-show.png`, frame 4 of deep-show's
// `frames`. It prints each SHA-256. It then reads `tests/acceptance/1561/TASTE.json` (README: The taste call): none, or
// one made on other pictures, is INCONCLUSIVE; a call made on a blank screenshot is BLOCKED; `looks_wrong` fails;
// `looks_right` on exactly these passes. No other test reads these pictures or the call.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, BOAT, LOOK, REPO, blocked, inconclusive, liveCall, liveRows, liveShot, obj, requireMetal, runGpu, runShow, sha256, showScenario, showShots, useBins, useDir,
  writePayload, type JsonValue, type Shot,
} from './helpers.ts';

const ID = AC[3];
const bin = useBins(['deep-gpu', 'deep-show']);
const dir = useDir();
const SHOTS = join(REPO, 'target', 'acceptance', '1561');
const TASTE = join(REPO, 'tests', 'acceptance', '1561', 'TASTE.json');
const NAMES = ['live-window.png', 'deep-show.png'] as const;
const FPS = 4;

describe(`${ID} the screenshots and the one taste call on them`, () => {
  it(`${ID} the run writes the fixture's screenshot from the live window and from deep-show, and the recorded call on exactly those says they look right`, () => {
    requireMetal();
    const out = dir();
    const [live] = runGpu(bin('deep-gpu'), out, [liveCall(writePayload(out, 'fixture.json', BOAT), LOOK, FPS, 5)]);
    const [show] = runShow(bin('deep-show'), [showScenario(out, BOAT, LOOK, 5, `${60 / FPS}f`)]);
    const shots: Record<(typeof NAMES)[number], Shot> = {
      'live-window.png': liveShot(out, liveRows(live!, 5, 'the live window on the fixture'), 5, 'the live window on the fixture'),
      'deep-show.png': showShots(out, show!, [4], FPS, 'deep-show on the fixture').get(4)!,
    };
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    for (const n of NAMES) { writeFileSync(join(SHOTS, n), shots[n].png); hashes[n] = sha256(shots[n].png); }
    const listed = NAMES.map((n) => `  ${join('target', 'acceptance', '1561', n)}  ${hashes[n]}${shots[n].blank ? '  (blank: one color in every pixel)' : ''}`).join('\n');
    console.log(`${ID}: screenshots written from this run's frames:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/1561/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    const c = obj(call, 'TASTE.json');
    expect(c['issue'], 'TASTE.json: issue').toBe(1561);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#1561.ca22b9de');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded = obj(c['screenshots'], 'TASTE.json: screenshots, by name');
    expect(Object.keys(recorded).sort(), 'TASTE.json names the two screenshots').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    for (const n of NAMES) if (shots[n].blank) blocked(`${n} is blank, one color in every pixel, so the recorded call judged nothing`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  });
});
