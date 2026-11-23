// AC7 #2386.e61634a0: Shown to you: screenshots of the isometric wall fixture and the square grid's tree fixture, taken
// by the check run from the renderer's own output, are attached to the PR and shown to you in the session. Whether they
// look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above
// reads a picture to judge it
//
// The check run (README: The taste call), in #536's form: this test draws the two fixtures (fixtures.ts `wallScene`,
// `treeScene`) through `deep-canvas-render raster` at zoom 1 (Vello CPU, every platform; one atlas texel a device
// pixel), takes each PNG exactly as raster wrote it, writes them to docs/evidence/2386/ and prints their SHA-256s. Then
// it reads tests/acceptance/2386/TASTE.json: none, or a call on other pictures, fails `INCONCLUSIVE:`, never a pass;
// `looks_wrong` fails; `looks_right` on exactly these pictures passes. It judges no picture. Raster's output is
// deterministic, so a call stands on the hashes alone.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { floorAtlas, grassAtlas, treeAtlas, treeScene, wallAtlas, wallScene } from './fixtures.ts';
import { AC, REPO, TIMEOUT, inconclusive, putAssets, rasterLine, rasterLines, sha256, useBin, useTemp, type JsonValue } from './helpers.ts';

const ID = AC[7];
const bin = useBin('deep-canvas-render');
const temp = useTemp();
const EVIDENCE = join(REPO, 'docs', 'evidence', '2386');
const TASTE = join(REPO, 'tests', 'acceptance', '2386', 'TASTE.json');
const CRITERION = '#2386.e61634a0';
const NAMES = ['isometric-wall.png', 'square-tree.png'] as const;

describe(`${ID} the check run's pictures of the isometric wall and the square grid's trees, and the one taste call on them`, () => {
  it(`${ID} the check run takes the two screenshots from the renderer's own output, and the recorded call on exactly those pictures says they look right; with none the run is INCONCLUSIVE, never PASS`, () => {
    const store = temp();
    const [wall, floor, tree, grass] = putAssets(store, [wallAtlas(), floorAtlas(), treeAtlas(), grassAtlas()]);
    const lines = [wallScene(wall!, floor!), treeScene(tree!, grass!)].map((d) => rasterLine(temp(), d, 0, { store, view: { zoom: 1 } }));
    rasterLines(bin(), lines, 'the check run\'s pictures');
    const files = Object.fromEntries(NAMES.map((n, i) => [n, readFileSync(String(lines[i]!['out']))])) as Record<(typeof NAMES)[number], Buffer>;
    const hashes = Object.fromEntries(NAMES.map((n) => [n, sha256(files[n])]));
    mkdirSync(EVIDENCE, { recursive: true });
    for (const n of NAMES) {
      const path = join(EVIDENCE, n);
      if (!existsSync(path) || sha256(readFileSync(path)) !== hashes[n]) writeFileSync(path, files[n]);
    }
    const listed = NAMES.map((n) => `  docs/evidence/2386/${n}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: the check run's pictures:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: attach these to the PR, show them to the owner\n${listed}\nand record the answer in tests/acceptance/2386/TASTE.json (README: The taste call)`);
    let parsed: JsonValue;
    try { parsed = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed), 'TASTE.json is an object').toBe(true);
    const call = parsed as Record<string, JsonValue>;
    expect(call['issue'], 'TASTE.json: issue').toBe(2386);
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
