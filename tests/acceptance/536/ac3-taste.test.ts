// AC3 #536.9a17b91a: Shown to you: screenshots of the 6 × 6 pointy odd hex fixture and the terrain recipe's water, sand
// and grass tiles, taken by the check run from the renderer's own output, are attached to the PR and shown to you in the
// session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no
// criterion above reads a picture to judge it
//
// The check run (README: The taste call): this test draws criterion 2's terrain fixture and a sheet of the recipe's
// tiles through `deep-canvas-render raster` at zoom 2 (Vello CPU, every platform), takes each PNG exactly as raster
// wrote it, writes them to docs/evidence/536/ and prints their SHA-256s. Then it reads tests/acceptance/536/TASTE.json:
// none, or a call on other pictures, fails `INCONCLUSIVE:`, never a pass; `looks_wrong` fails; `looks_right` on exactly
// these pictures passes. It judges no picture. Raster's output is deterministic, so a call stands on the hashes alone.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, REPO, TIMEOUT, atlasPng, putAssets, rasterLine, rasterLines, terrainDoc, tileSheet, useDir, useRender, type JsonValue,
} from './helpers.ts';

const ID = AC[3];
const bin = useRender();
const dir = useDir();
const EVIDENCE = join(REPO, 'docs', 'evidence', '536');
const TASTE = join(REPO, 'tests', 'acceptance', '536', 'TASTE.json');
const CRITERION = '#536.9a17b91a';
const NAMES = ['hex-terrain.png', 'terrain-tiles.png'] as const;
const hash = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const inconclusive = (reason: string): never => expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);

describe(`${ID} the check run's pictures of the hex fixture and the recipe's tiles, and the one taste call on them`, () => {
  it(`${ID} the check run takes the screenshots from the renderer's own output, and the recorded call on exactly those pictures says they look right; with none the run is INCONCLUSIVE, never PASS`, () => {
    const store = dir();
    const [asset] = putAssets(store, [atlasPng()]);
    const lines = [terrainDoc('terrain', asset!), tileSheet(asset!)].map((d) => rasterLine(dir(), d, 0, { store, view: { zoom: 2 } }));
    rasterLines(bin(), lines, 'the check run\'s pictures');
    const files = Object.fromEntries(NAMES.map((n, i) => [n, readFileSync(String(lines[i]!['out']))])) as Record<(typeof NAMES)[number], Buffer>;
    const hashes = Object.fromEntries(NAMES.map((n) => [n, hash(files[n])]));
    mkdirSync(EVIDENCE, { recursive: true });
    for (const n of NAMES) {
      const path = join(EVIDENCE, n);
      if (!existsSync(path) || hash(readFileSync(path)) !== hashes[n]) writeFileSync(path, files[n]);
    }
    const listed = NAMES.map((n) => `  docs/evidence/536/${n}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: the check run's pictures:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: attach these to the PR, show them to the owner\n${listed}\nand record the answer in tests/acceptance/536/TASTE.json (README: The taste call)`);
    let parsed: JsonValue;
    try { parsed = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed), 'TASTE.json is an object').toBe(true);
    const call = parsed as Record<string, JsonValue>;
    expect(call['issue'], 'TASTE.json: issue').toBe(536);
    expect(call['criterion'], 'TASTE.json: criterion').toBe(CRITERION);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(call['verdict']);
    expect(typeof call['who'] === 'string' && call['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof call['when'] === 'string' && /^\d{4}-\d\d-\d\dT/.test(call['when']) && !Number.isNaN(Date.parse(call['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded = (call['screenshots'] ?? {}) as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json: screenshots names the two files').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(call['who'])}, ${String(call['when'])}) was made on other pictures: ${other.join(', ')} differ from this run's; this run's are written for a new call`);
    if (call['verdict'] === 'looks_wrong') expect.fail(`the taste call (${String(call['who'])}, ${String(call['when'])}) says they don't look right${typeof call['note'] === 'string' ? `: ${call['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(call['who'])} at ${String(call['when'])}: looks right`);
  }, TIMEOUT);
});
