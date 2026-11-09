// AC4 #481.7124c07a: Shown to you: screenshots of the slab lit by a thin line of light, the skin sphere before a white
// wall and the backlit fin, taken by the check run from the renderer's own output, are attached to the PR and shown to
// you in the session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never
// PASS, and no criterion above reads a picture to judge it.
//
// One run draws, under a filmic look, AC1's slab at subsurface weight 1 under its line of light (800 × 800), AC2's skin
// sphere before the white wall with its lobe (480 × 480), and AC3's backlit fins at 2 mm and 6 mm (256 × 256 each). It
// writes them to `target/acceptance/481/` (README: The taste call): `slab-line.png` and `skin-wall.png` byte for byte
// the renderer's final PNGs, `backlit-fin.png` the two fins' final targets side by side, printing each SHA-256. It then
// reads `tests/acceptance/481/TASTE.json`: none, or one made on other pictures, is INCONCLUSIVE; `looks_wrong` fails;
// `looks_right` on exactly these passes. No other test reads these pictures or the call.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, REPO, SHOW_LOOK, SLAB, decodePng, draw, encodePng, finDoc, inconclusive, requireMetal, sha256, sideBySide, slabDoc, useDir, useGpu, wallDoc,
  type JsonValue,
} from './helpers.ts';

const ID = AC[4];
const bin = useGpu();
const dir = useDir();
const SHOTS = join(REPO, 'target', 'acceptance', '481');
const TASTE = join(REPO, 'tests', 'acceptance', '481', 'TASTE.json');
const NAMES = ['slab-line.png', 'skin-wall.png', 'backlit-fin.png'] as const;

describe(`${ID} the screenshots and the one taste call on them`, () => {
  it(`${ID} the run writes the slab under its line of light, the skin sphere before the white wall and the backlit fin from the renderer's own output, and the owner's recorded call on exactly those says they look right`, () => {
    requireMetal();
    const [slab, skin, two, six] = draw(bin(), dir(), [
      { name: 'show-slab', doc: slabDoc('show', 800, { weight: 1, color: [1, 1, 1, 1], radius: SLAB.radius, thin: false }) },
      { name: 'show-wall', doc: wallDoc('show', true) },
      { name: 'show-fin-2mm', doc: finDoc('show-2mm', 0.002) },
      { name: 'show-fin-6mm', doc: finDoc('show-6mm', 0.006) },
    ], undefined, SHOW_LOOK);
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    const keep = (name: string, bytes: Buffer): void => { writeFileSync(join(SHOTS, name), bytes); hashes[name] = sha256(bytes); };
    keep('slab-line.png', slab!.final);
    keep('skin-wall.png', skin!.final);
    keep('backlit-fin.png', encodePng(sideBySide([decodePng(two!.final), decodePng(six!.final)])));

    const listed = NAMES.map((n) => `  ${join('target', 'acceptance', '481', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: screenshots written from this run's pixels:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/481/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(481);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#481.7124c07a');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the three screenshots').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, 3_600_000);
});
