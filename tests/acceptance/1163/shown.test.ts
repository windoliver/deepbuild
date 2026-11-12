// AC8 #1163.28f11e13: "Shown to you: screenshots of the 20 s film's push, pan cross-fade and pull back shots with the
// bounce dot and the title, and the viewer stepping a frame, taken by the check run from the exported file, with a
// recording of the exported MP4, are attached to the PR and shown to you in the session. Whether they look right is
// one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture
// to judge it"
//
// This test judges no picture. The check run, `node scripts/checkpoint-1163-shots.mjs` (README: The taste call),
// writes its pictures into `docs/evidence/1163/`: the three shots as 1920 × 1080 PNG frames of the exported MP4, the
// viewer stepping a frame as a PNG, and the recording as an MP4. A missing or malformed file fails, naming it. The call
// is `tests/acceptance/1163/TASTE.json`, recorded later: with none, or one made on other files (another SHA-256), the
// test is INCONCLUSIVE, never a pass; `looks_wrong` fails; `looks_right` on exactly these files passes.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, REPO, inconclusive, isObject, sha256, show, type JsonValue } from './helpers.ts';

const PICTURES = join(REPO, 'docs', 'evidence', '1163');
const TASTE = join(REPO, 'tests', 'acceptance', '1163', 'TASTE.json');
/** The shots, each a frame of the exported film at its own size. */
const SHOTS = ['push.png', 'pan-cross-fade.png', 'pull-back.png'] as const;
const VIEWER_STEP = 'viewer-step.png';
const RECORDING = 'film-recording.mp4';
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

describe(`${AC[8]} the check run's pictures and the one taste call on them`, () => {
  it(`${AC[8]} the check run's screenshots and recording exist in docs/evidence/1163/, and the run reads INCONCLUSIVE unless a recorded taste call on exactly these files says they look right`, () => {
    const hashes: Record<string, string> = {};
    const missing = [...SHOTS, VIEWER_STEP, RECORDING].filter((f) => !existsSync(join(PICTURES, f)));
    if (missing.length) inconclusive(`the check run's pictures are not in docs/evidence/1163/: ${missing.join(', ')}; run node scripts/checkpoint-1163-shots.mjs`);
    for (const name of [...SHOTS, VIEWER_STEP]) {
      const png = readFileSync(join(PICTURES, name));
      expect(png.subarray(0, 8).equals(PNG), `${name} is a PNG`).toBe(true);
      if ((SHOTS as readonly string[]).includes(name)) expect([png.readUInt32BE(16), png.readUInt32BE(20)], `${name} is a frame of the exported film, 1920 × 1080`).toEqual([1920, 1080]);
      hashes[name] = sha256(png);
    }
    const mp4 = readFileSync(join(PICTURES, RECORDING));
    expect(mp4.length > 12 && mp4.toString('latin1', 4, 8) === 'ftyp', `${RECORDING} is an MP4`).toBe(true);
    hashes[RECORDING] = sha256(mp4);
    const listed = Object.entries(hashes).map(([f, h]) => `  docs/evidence/1163/${f}  ${h}`).join('\n');
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/1163/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(isObject(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(1163);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#1163.28f11e13');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = isObject(c['screenshots']) ? c['screenshots'] : {};
    const other = Object.keys(hashes).filter((f) => shots[f] !== hashes[f]);
    if (other.length || Object.keys(shots).length !== Object.keys(hashes).length) inconclusive(`the recorded call was made on other files (${show(shots)}), not this run's:\n${listed}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
  }, 60_000);
});
