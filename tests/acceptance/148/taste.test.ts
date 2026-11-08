// AC17 #148.62546d1a: Shown to you: screenshots of the Agents page with a server and a skill, the agents each is synced
// to, and the per-file diff you approve, taken by the check run from the app at the reference window, are attached to
// the PR and shown to you in the session. Whether they look right is one taste call, recorded; without it the run stays
// INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it.
//
// The check run (the implementer's capture from the app, crates/deep-app, at the reference window, named in the PR)
// writes two PNGs into the folder DEEP148_SHOTS names (README: The taste call): `agents-page.png`, the Agents page
// with a server and a skill and the agents each is synced to, and `approve-diff.png`, the per-file diff you approve.
// This test checks they are the reference window's size, 3024 × 1964 px (1512 × 982 points at 2×), prints each SHA-256
// and never reads their pixels. Then it reads tests/acceptance/148/TASTE.json, #149's shape: none, or a call on other
// pictures, is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these passes. No other test reads a picture.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, SHOTS, SUITE, inconclusive, type Line } from './helpers.ts';

const NAMES = ['agents-page.png', 'approve-diff.png'];
const REFERENCE = { width: 3024, height: 1964 };
const TASTE = join(SUITE, 'TASTE.json');

describe('#148 shown to you', () => {
  it(`${AC[17]} the check run's screenshots of the Agents page and the per-file diff are at the reference window, and a recorded taste call on exactly those says they look right`, () => {
    const shots = SHOTS ?? inconclusive('no check run\'s screenshots: DEEP148_SHOTS names no folder (README: The taste call)');
    const hashes: Record<string, string> = {};
    for (const name of NAMES) {
      const file = join(shots, name);
      expect(existsSync(file), `the check run wrote ${file}`).toBe(true);
      const bytes = readFileSync(file);
      expect(bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), `${file} is a PNG`).toBe(true);
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], `${file} is the reference window, ${REFERENCE.width} × ${REFERENCE.height} px`).toEqual([REFERENCE.width, REFERENCE.height]);
      hashes[name] = createHash('sha256').update(bytes).digest('hex');
    }
    const listed = NAMES.map((n) => `  ${join(shots, n)}  ${hashes[n]}`).join('\n');
    console.log(`${AC[17]}: the screenshots to show:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/148/TASTE.json (README: The taste call)`);
    let c: Line;
    try { c = JSON.parse(readFileSync(TASTE, 'utf8')) as Line; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(c.issue, 'TASTE.json: issue').toBe(148);
    expect(c.criterion, 'TASTE.json: criterion').toBe('#148.62546d1a');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c.verdict);
    expect(typeof c.who === 'string' && c.who.trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c.when === 'string' && !Number.isNaN(Date.parse(c.when)), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded = (c.screenshots ?? {}) as Record<string, string>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names both screenshots').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c.who)}, ${String(c.when)}) was made on other pictures: ${other.map((n) => `${n} recorded ${recorded[n]}, now ${hashes[n]}`).join('; ')}`);
    if (c.verdict === 'looks_wrong') expect.fail(`the owner's taste call (${String(c.who)}, ${String(c.when)}) says they don't look right${typeof c.note === 'string' ? `: ${c.note}` : ''}`);
  });
});
