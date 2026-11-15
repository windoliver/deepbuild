// AC7 #1164.6ccc5166: "Shown to you: screenshots of the board as the presses place X and O, the taken-cell press and
// the win, taken by the check run from the app at the reference window, with a recording of the game played with keys,
// are attached to the PR and shown to you in the session. Whether they look right is one taste call, recorded; without
// it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it"
//
// This test judges no picture. The check run, `node scripts/checkpoint-1164-shots.mjs` (chosen; README: The taste
// call), writes its pictures into `docs/evidence/1164/`: three PNGs of the app's window at the reference window (1512 ×
// 982 points at 2×: 3024 × 1964 px) and the recording as an MP4. A missing file, or no `TASTE.json`, or a call made on
// other files (another SHA-256), is INCONCLUSIVE, never a pass; `looks_wrong` fails; `looks_right` on exactly these
// files passes.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, REPO, inconclusive, isObject, sha256, show, type JsonValue } from './helpers.ts';

const PICTURES = join(REPO, 'docs', 'evidence', '1164');
const TASTE = join(REPO, 'tests', 'acceptance', '1164', 'TASTE.json');
/** The board as the presses place X and O, the taken-cell press, and the win (README: The taste call). */
const SHOTS = ['x-and-o.png', 'taken-cell.png', 'win.png'] as const;
const RECORDING = 'game-keys.mp4';
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** The reference window (technical design: 1512 × 982 points at 2×). */
const REFERENCE: [number, number] = [3024, 1964];

describe(`${AC[7]} the check run's pictures and the one taste call on them`, () => {
  it(`${AC[7]} the check run's screenshots at the reference window and its recording exist in docs/evidence/1164/, and the run reads INCONCLUSIVE unless a recorded taste call on exactly these files says they look right`, () => {
    const missing = [...SHOTS, RECORDING].filter((f) => !existsSync(join(PICTURES, f)));
    if (missing.length) inconclusive(`the check run's pictures are not in docs/evidence/1164/: ${missing.join(', ')}; run node scripts/checkpoint-1164-shots.mjs`);
    const hashes: Record<string, string> = {};
    for (const name of SHOTS) {
      const png = readFileSync(join(PICTURES, name));
      expect(png.subarray(0, 8).equals(PNG), `${name} is a PNG`).toBe(true);
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], `${name} is the app's window at the reference window, ${REFERENCE.join(' × ')} px`).toEqual(REFERENCE);
      hashes[name] = sha256(png);
    }
    const mp4 = readFileSync(join(PICTURES, RECORDING));
    expect(mp4.length > 12 && mp4.toString('latin1', 4, 8) === 'ftyp', `${RECORDING} is an MP4`).toBe(true);
    hashes[RECORDING] = sha256(mp4);
    const listed = Object.entries(hashes).map(([f, h]) => `  docs/evidence/1164/${f}  ${h}`).join('\n');
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/1164/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(isObject(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(1164);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#1164.6ccc5166');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = isObject(c['screenshots']) ? c['screenshots'] : {};
    const other = Object.keys(hashes).filter((f) => shots[f] !== hashes[f]);
    if (other.length || Object.keys(shots).length !== Object.keys(hashes).length) inconclusive(`the recorded call was made on other files (${show(shots)}), not this run's:\n${listed}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
  }, 60_000);
});
