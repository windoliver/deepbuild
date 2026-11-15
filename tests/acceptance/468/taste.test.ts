// AC8 #468.ce8ac7ee: Shown to you: screenshots of the depth-of-field bokeh disc, a focus pull from A to B and a label
// leader on the opening lid, taken by the check run from the renderer's own output, with a recording of the focus pull
// and the lid, are attached to the PR and shown to you in the session. Whether they look right is one taste call,
// recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it.
//
// This test judges no picture. It reads the record (README: The taste call): `docs/evidence/468/`, the check run's
// pictures, and `tests/acceptance/468/TASTE.json`, the call on them. No pictures, no call, or a call made on other
// pictures (another SHA-256) is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these passes. No other test
// reads these files.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, REPO, TIMEOUT, inconclusive, sha256, type JsonValue } from './helpers.ts';

const PICTURES = join(REPO, 'docs', 'evidence', '468');
const TASTE = join(REPO, 'tests', 'acceptance', '468', 'TASTE.json');
const NAMES = ['bokeh-disc.png', 'focus-pull.png', 'lid-leader.png', 'focus-pull-and-lid.apng'];

describe(`${AC[8]} the screenshots, the recording and the one taste call on them`, () => {
  it(`${AC[8]} the recorded call on exactly the check run's pictures says they look right; with none the run is INCONCLUSIVE, never PASS`, () => {
    const missing = NAMES.filter((n) => !existsSync(join(PICTURES, n)));
    if (missing.length) inconclusive(`the check run's pictures are not in docs/evidence/468/: ${missing.join(', ')}`);
    const hashes = Object.fromEntries(NAMES.map((n) => [n, sha256(readFileSync(join(PICTURES, n)))]));
    const listed = NAMES.map((n) => `  ${join('docs', 'evidence', '468', n)}  ${hashes[n]}`).join('\n');
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/468/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(468);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#468.ce8ac7ee');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the three screenshots and the recording').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures: ${other.map((n) => `${n} recorded ${String(recorded[n])}, on disk ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${AC[8]}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, TIMEOUT);
});
