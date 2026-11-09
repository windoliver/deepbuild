// AC17 #499.9dbb482c: Shown to you: screenshots of the recording's frames at 3 s and 3.5 s, the crop to its top-left
// quarter and the cursor ring during the 2x push, taken by the check run from the canvas's own frames, with a
// recording of the push, are attached to the PR and shown to you in the session. Whether they look right is one
// taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to
// judge it.
//
// This test judges no picture. It reads the record (README: The taste call): `docs/evidence/499/`, the check run's
// pictures, and `tests/acceptance/499/video/TASTE.json`, the call on them. No pictures, no call, or a call made on
// other pictures (another SHA-256) is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these passes.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, REPO, TIMEOUT, inconclusive, type JsonValue } from './helpers.ts';

const PICTURES = join(REPO, 'docs', 'evidence', '499');
const TASTE = join(REPO, 'tests', 'acceptance', '499', 'video', 'TASTE.json');
const NAMES = ['frame-3s.png', 'frame-3.5s.png', 'crop-quarter.png', 'push-ring.png', 'push.apng'];

describe(`${AC[17]} the screenshots, the push's recording and the one taste call on them`, () => {
  it(`${AC[17]} the recorded call on exactly the check run's pictures says they look right; with none the run is INCONCLUSIVE, never PASS`, () => {
    const missing = NAMES.filter((n) => !existsSync(join(PICTURES, n)));
    if (missing.length) inconclusive(`the check run's pictures are not in docs/evidence/499/: ${missing.join(', ')}`);
    const hashes = Object.fromEntries(NAMES.map((n) => [n, createHash('sha256').update(readFileSync(join(PICTURES, n))).digest('hex')]));
    const listed = NAMES.map((n) => `  ${join('docs', 'evidence', '499', n)}  ${hashes[n]}`).join('\n');
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/499/video/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(499);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#499.9dbb482c');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the pictures and the recording').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures: ${other.map((n) => `${n} recorded ${String(recorded[n])}, on disk ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${AC[17]}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, TIMEOUT);
});
