// AC9 #446.cf21f50f: Shown to you: screenshots of the house by day and at night, soft shadows at contact and widened, and
// the engine fixture cut by a plane, taken by the check run from the renderer's own output, are attached to the PR and
// shown to you in the session. Whether they look right is one taste call, recorded; without it the run stays
// INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it.
//
// One run draws, with the fixtures the criteria use (helpers): the house by day and at night (AC2), the blade at the
// sun's own 0.53° with contact shadows and at 9° (AC1), and the engine cut by a plane under its sun (AC8). It copies each
// final target, the renderer's own PNG byte for byte, to `docs/evidence/446/` (README: The taste call), printing each
// SHA-256. It then reads `tests/acceptance/446/TASTE.json`: none, or one made on other pictures (another SHA-256), is
// INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these pictures passes. No other test reads these pictures
// or the call.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, ENGINE, HOUSE, REPO, SOFT, bladeDoc, engineDoc, houseDoc, inconclusive, only, readNamed, requireMetal, runGpu, sha256, useDir, useGpu, view3dCall, writeJson, type JsonValue,
} from './helpers.ts';

const ID = AC[9];
const bin = useGpu();
const dir = useDir();
const SHOTS = join(REPO, 'docs', 'evidence', '446');
const TASTE = join(REPO, 'tests', 'acceptance', '446', 'TASTE.json');
const NAMES = ['house-day.png', 'house-night.png', 'soft-contact.png', 'soft-widened.png', 'engine-cut.png'] as const;

describe(`${ID} the screenshots and the one taste call on them`, () => {
  it(`${ID} the run writes the house by day and at night, soft shadows at contact and widened, and the cut engine from the renderer's own output, and the owner's recorded call on exactly those says they look right`, () => {
    requireMetal();
    const out = dir();
    const replies = runGpu(bin(), out, [
      view3dCall({ doc: writeJson(out, 'day', houseDoc('day')), look: HOUSE.dayLook, size: HOUSE.size, targets: ['final'] }),
      view3dCall({ doc: writeJson(out, 'night', houseDoc('night')), look: HOUSE.nightLook, size: HOUSE.size, targets: ['final'] }),
      view3dCall({ doc: writeJson(out, 'contact', bladeDoc(0.53, { policy: { contact: { length: 0.3, samples: 16 } } })), size: SOFT.size, targets: ['final'] }),
      view3dCall({ doc: writeJson(out, 'widened', bladeDoc(9)), size: SOFT.size, targets: ['final'] }),
      view3dCall({ doc: writeJson(out, 'engine', engineDoc('sun', 'cut')), size: ENGINE.size, targets: ['final'] }),
    ]);
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    NAMES.forEach((name, i) => {
      const bytes = readNamed(out, only(replies[i]!, name).final, 'png', name);
      writeFileSync(join(SHOTS, name), bytes); hashes[name] = sha256(bytes);
    });
    const listed = NAMES.map((n) => `  ${join('docs', 'evidence', '446', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: screenshots written from this run's pixels:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/446/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(446);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#446.cf21f50f');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the five screenshots').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, 1_800_000);
});
