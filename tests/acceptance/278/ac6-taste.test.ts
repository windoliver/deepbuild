// AC6 #278.c711dda6: Shown to you: screenshots of the Start button after the second copy joins, the lobby while it is
// open and the next match's Start after a finish, taken by the check run from the app at the reference window, with a
// recording of a join and a play again, are attached to the PR and shown to you in the session. Whether they look
// right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a
// picture to judge it
//
// This test judges no picture and makes none. It reads the record (README: The taste call): `docs/evidence/278/`, the
// check run's three pictures and its recording, taken from the app at the reference window, and
// `tests/acceptance/278/TASTE.json`, the call on them. No pictures, no call, or a call made on other pictures (another
// SHA-256) is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these passes. Wrong programs it fails: a run
// with no pictures; a call recorded for other pictures; a call that says they look wrong.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, REPO, TIMEOUT } from './helpers.ts';

const PICTURES = join(REPO, 'docs', 'evidence', '278');
const TASTE = join(REPO, 'tests', 'acceptance', '278', 'TASTE.json');
/** The Start button after the second copy joins; the lobby while it is open; the next match's Start after a finish;
 * the recording of a join and a play again. */
const NAMES = ['start-after-second-join.png', 'lobby-open.png', 'next-start-after-finish.png', 'join-and-play-again.webm'];
const CRITERION = '#278.c711dda6';
const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

describe(`${AC[6]} the Start button, the open lobby, the next match's Start, a recording, and the one taste call on them`, () => {
  it(`${AC[6]} the recorded call on exactly the check run's pictures says they look right; with none the run is INCONCLUSIVE, never PASS`, () => {
    const missing = NAMES.filter((n) => !existsSync(join(PICTURES, n)));
    if (missing.length) expect.fail(`INCONCLUSIVE: the check run's pictures are not in docs/evidence/278/: ${missing.join(', ')}; this is not a pass`);
    const hashes = Object.fromEntries(NAMES.map((n) => [n, sha256(readFileSync(join(PICTURES, n)))]));
    const listed = NAMES.map((n) => `  ${join('docs', 'evidence', '278', n)}  ${hashes[n]}`).join('\n');
    if (!existsSync(TASTE)) expect.fail(`INCONCLUSIVE: no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/278/TASTE.json (README: The taste call); this is not a pass`);
    let call: unknown;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')); } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, unknown>;
    expect(c['issue'], 'TASTE.json: issue').toBe(278);
    expect(c['criterion'], 'TASTE.json: criterion').toBe(CRITERION);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, unknown>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the three pictures and the recording').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) expect.fail(`INCONCLUSIVE: the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures: ${other.map((n) => `${n} recorded ${String(recorded[n])}, on disk ${hashes[n]}`).join('; ')}; this is not a pass`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${AC[6]}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, TIMEOUT);
});
