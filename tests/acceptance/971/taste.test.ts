// AC9 #971.573c2449: Shown to you: screenshots of the temple-style fixture with and without local tone mapping and the
// two-wall edge fixture, taken by the check run from the renderer's own output, are attached to the PR and shown to you
// in the session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never
// PASS, and no criterion above reads a picture to judge it.
//
// One `deep-gpu run` draws three frames at 1920 × 1080 and keeps each one's final PNG byte for byte: the temple
// (helpers.ts `templeDoc`) under filmic with `local: {strength: 0.5}`, the same temple without `local`, and the two
// walls (`wallsDoc`) under tone map none with `local: {strength: 0.5}`. It writes `temple-local.png`,
// `temple-plain.png` and `walls-edge.png` to `docs/evidence/971/`, each with its SHA-256 printed. Then it reads
// `tests/acceptance/971/TASTE.json` (README: The taste call): with none, or one made on other bytes, it is
// INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these passes. This test judges no picture, and no other
// test reads these files.
//
// The temple's two pictures must be two: where the frame with `local` is byte for byte the frame without it, nothing
// shows local tone mapping, and the test fails before it writes anything. At the base that is what happens.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sha256, writeJson, type JsonValue } from '../418/helpers.ts';
import { AC, FULL, HALF, REPO, TIMEOUT, drawn, finalPng, frame, inconclusive, lookWith, requireGpu, runGpu, templeDoc, useGpu, useOut, view3d, wallsDoc } from './helpers.ts';

const bin = useGpu();
const out = useOut();
const ID = AC[9].split(' ')[1]!;
const SHOTS = join(REPO, 'docs', 'evidence', '971');
const TASTE = join(REPO, 'tests', 'acceptance', '971', 'TASTE.json');
const NAMES = ['temple-local.png', 'temple-plain.png', 'walls-edge.png'] as const;

describe(`${AC[9]} the screenshots and the one taste call on them`, () => {
  it(`${AC[9]} the run writes the temple with and without local tone mapping and the two-wall edge fixture from the renderer's own output, and the recorded call on exactly those says they look right; with none the run is INCONCLUSIVE, never PASS`, () => {
    requireGpu();
    const dir = out();
    const temple = writeJson(dir, 'temple.json', templeDoc('temple-taste'));
    const walls = writeJson(dir, 'walls.json', wallsDoc('walls-taste'));
    const shot = { size: FULL, targets: ['final' as const], capture: [0] };
    const replies = runGpu(bin(), dir, [
      view3d({ doc: temple, look: lookWith('filmic', HALF), ...shot }),
      view3d({ doc: temple, look: lookWith('filmic'), ...shot }),
      view3d({ doc: walls, look: lookWith('none', HALF), ...shot }),
    ]);
    const bytes = NAMES.map((name, k) => finalPng(dir, frame(drawn(replies[k]!, name), 0, name), name));
    const hashes: Record<string, string> = Object.fromEntries(NAMES.map((name, k) => [name, sha256(bytes[k]!)]));
    expect(hashes['temple-local.png'], 'the temple with local tone mapping is another picture than the temple without it').not.toBe(hashes['temple-plain.png']);
    mkdirSync(SHOTS, { recursive: true });
    NAMES.forEach((name, k) => writeFileSync(join(SHOTS, name), bytes[k]!));
    const listed = NAMES.map((name) => `  ${join('docs', 'evidence', '971', name)}  ${hashes[name]}`).join('\n');
    console.log(`${AC[9]}: written from this run's frames:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/971/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(971);
    expect(c['criterion'], 'TASTE.json: criterion').toBe(ID);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the three screenshots').toEqual([...NAMES].sort());
    const other = NAMES.filter((name) => recorded[name] !== hashes[name]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other bytes than this run's: ${other.map((name) => `${name} recorded ${String(recorded[name])}, drawn ${hashes[name]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${AC[9]}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, TIMEOUT);
});
