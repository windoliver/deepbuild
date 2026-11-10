// AC7 #486.8b403bfa: Shown to you: screenshots of the coat plate, the occlusion plate and the core.bump@1 relief plate,
// taken by the check run from the renderer's own output, are attached to the PR and shown to you in the session. Whether
// they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above
// reads a picture to judge it.
//
// One run draws, under a filmic look: AC1's coat plate under `coat_split` (512 × 512); AC2's occlusion plate with its
// operator writing occlusion 0 and writing 1 (512 × 512 each); and a relief plate, ripples 3 mm high, six to the metre
// each way, through core.bump@1 on a clay plate under a low sun and the studio environment (640 × 640; helpers:
// `ripplesDoc`). It writes them to `target/acceptance/486/` (README: The taste call): `coat-plate.png` and
// `relief-plate.png` byte for byte the renderer's final PNGs, `occlusion-plate.png` the two occlusion frames' final
// targets side by side, printing each SHA-256. It then reads `tests/acceptance/486/TASTE.json`: none, or one made on
// other pictures, is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these passes. No other test reads these
// pictures or the call.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, REPO, SHOW_LOOK, coatOpDoc, decodePng, draw, encodePng, inconclusive, occlusionDoc, requireMetal, ripplesDoc, sha256, sideBySide, useDir, useGpu,
  type Drawn, type JsonValue,
} from './helpers.ts';

const ID = AC[7];
const bin = useGpu();
const dir = useDir();
const SHOTS = join(REPO, 'target', 'acceptance', '486');
const TASTE = join(REPO, 'tests', 'acceptance', '486', 'TASTE.json');
const NAMES = ['coat-plate.png', 'occlusion-plate.png', 'relief-plate.png'] as const;

describe(`${ID} the screenshots and the one taste call on them`, () => {
  it(`${ID} the run writes the coat plate, the occlusion plate and the core.bump@1 relief plate from the renderer's own output, and the owner's recorded call on exactly those says they look right`, () => {
    requireMetal();
    const [coat, zero, one, relief] = draw(bin(), dir(), [
      { name: 'show-coat', doc: coatOpDoc('show-coat', 'coat_split', 1, 0) },
      { name: 'show-occlusion-0', doc: occlusionDoc('show-occlusion-0', true, 0) },
      { name: 'show-occlusion-1', doc: occlusionDoc('show-occlusion-1', true, 1) },
      { name: 'show-relief', doc: ripplesDoc() },
    ], undefined, SHOW_LOOK) as [Drawn, Drawn, Drawn, Drawn];
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    const keep = (name: string, bytes: Buffer): void => { writeFileSync(join(SHOTS, name), bytes); hashes[name] = sha256(bytes); };
    keep('coat-plate.png', coat.final);
    keep('occlusion-plate.png', encodePng(sideBySide([decodePng(zero.final), decodePng(one.final)])));
    keep('relief-plate.png', relief.final);

    const listed = NAMES.map((n) => `  ${join('target', 'acceptance', '486', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: screenshots written from this run's pixels:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/486/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(486);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#486.8b403bfa');
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
