// AC11 #518.2feca46b: "Shown to you: screenshots of the 60 s fixture film exported as H.264 with AAC and the AV1
// tool's delivery, taken by the check run from the exported file, with a recording of both films playing, are attached
// to the PR and shown to you in the session. Whether they look right is one taste call, recorded; without it the run
// stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it"
//
// This test judges no picture, as #157's taste test judges none. It reads the record (README: The taste call):
// `docs/evidence/518/`, the check run's two screenshots and its recording, and `tests/acceptance/518/TASTE.json`, the
// call on them. No pictures, no recording, no call, or a call made on other files (another SHA-256) is INCONCLUSIVE;
// `looks_wrong` fails; `looks_right` on exactly these passes.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, REPO, TIMEOUT, inconclusive, sha256, type JsonValue } from './helpers.ts';

const SHOWN = join(REPO, 'docs', 'evidence', '518');
const TASTE = join(REPO, 'tests', 'acceptance', '518', 'TASTE.json');
const SCREENSHOTS = ['h264-aac.png', 'av1.png'];
const RECORDING = ['both-films.mp4'];
const ID = AC[11].split(' ')[1]!;

describe(`${AC[11]} the screenshots of the H.264 delivery and the AV1 tool's, the recording of both playing, and the one taste call on them`, () => {
  it(`${AC[11]} the recorded call on exactly the check run's two screenshots and its recording says they look right; with none the run is INCONCLUSIVE, never PASS`, () => {
    const names = [...SCREENSHOTS, ...RECORDING];
    const missing = names.filter((f) => !existsSync(join(SHOWN, f)));
    if (missing.length) inconclusive(`the check run's screenshots and recording are not in docs/evidence/518/: ${missing.join(', ')}`);
    const hashes = Object.fromEntries(names.map((f) => [f, sha256(readFileSync(join(SHOWN, f)))]));
    const listed = names.map((f) => `  ${join('docs', 'evidence', '518', f)}  ${hashes[f]}`).join('\n');
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/518/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(518);
    expect(c['criterion'], 'TASTE.json: criterion').toBe(ID);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const other: string[] = [];
    for (const [key, files] of [['screenshots', SCREENSHOTS], ['recording', RECORDING]] as const) {
      const recorded = c[key];
      expect(typeof recorded === 'object' && recorded !== null && !Array.isArray(recorded), `TASTE.json: ${key}, by name`).toBe(true);
      const byName = recorded as Record<string, JsonValue>;
      expect(Object.keys(byName).sort(), `TASTE.json: ${key} names ${files.join(' and ')}`).toEqual([...files].sort());
      other.push(...files.filter((f) => byName[f] !== hashes[f]).map((f) => `${f} recorded ${String(byName[f])}, on disk ${hashes[f]}`));
    }
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other files: ${other.join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${AC[11]}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, TIMEOUT);
});
