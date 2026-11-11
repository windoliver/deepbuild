// #504.a3d1f3d0: "Shown to you: screenshots of the projectile board with its sliders and stages, a take-apart assembly
// and the recoloured case, taken by the check run from the canvas's own frames, with a recording of a stage gliding
// and a take-apart, are attached to the PR and shown to you in the session. Whether they look right is one taste call,
// recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it"
//
// This test judges no picture. It reads the record (README: The taste call): the check run's pictures under
// `docs/evidence/504/` and `tests/acceptance/504/TASTE.json`, the one call on them. Missing pictures, no call, or a call
// made on other pictures (another SHA-256) is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these
// pictures passes.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO, TIMEOUT, inconclusive, sha256, type JsonValue } from './helpers.ts';

/** The criterion's ID: `#504.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#504.a3d1f3d0';

const PICTURES = join(REPO, 'docs', 'evidence', '504');
const TASTE = join(REPO, 'tests', 'acceptance', '504', 'TASTE.json');
/** The screenshots (PNG, from the canvas's own frames) and the recordings (animated PNG) the criterion names. */
const NAMES = ['projectile-board.png', 'take-apart.png', 'recoloured-case.png', 'stage-glide.apng', 'take-apart.apng'];

describe(`${ID} the screenshots, the recordings and the one taste call on them`, () => {
  it(`${ID} the recorded call on exactly the check run's pictures says they look right; without it the run is INCONCLUSIVE, never PASS`, () => {
    const missing = NAMES.filter((f) => !existsSync(join(PICTURES, f)));
    if (missing.length) inconclusive(`the check run's pictures are not in docs/evidence/504/: ${missing.join(', ')}`);
    const hashes = Object.fromEntries(NAMES.map((f) => [f, sha256(readFileSync(join(PICTURES, f)))]));
    const listed = NAMES.map((f) => `  ${join('docs', 'evidence', '504', f)}  ${hashes[f]}`).join('\n');
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/504/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(504);
    expect(c['criterion'], 'TASTE.json: criterion').toBe(ID);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the screenshots and the recordings').toEqual([...NAMES].sort());
    const other = NAMES.filter((f) => recorded[f] !== hashes[f]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures: ${other.map((f) => `${f} recorded ${String(recorded[f])}, on disk ${hashes[f]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, TIMEOUT);
});
