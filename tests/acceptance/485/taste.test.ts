// AC8 #485.977f4f15: Shown to you: screenshots of the cel-banded sphere under the sun with a post's shadow, and the room
// with 32 shaded point lights, taken by the check run from the renderer's own output, are attached to the PR and shown
// to you in the session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE,
// never PASS, and no criterion above reads a picture to judge it.
//
// One run draws, under a filmic look: AC2's cel sphere (helpers: `celDoc`, 512 × 512, EV 0) and AC3's room (`roomDoc`,
// 480 × 320, EV 5) with its plaster under the cel response (light grey base color), so each of the 32 shaded lamps
// bands its own pool. It writes them to `target/acceptance/485/` (README: The taste call), `cel-sphere.png` and
// `room-32-lights.png`, each byte for byte the renderer's final PNG, printing each SHA-256. It then reads
// `tests/acceptance/485/TASTE.json`: none, or one made on other pictures, is INCONCLUSIVE; `looks_wrong` fails;
// `looks_right` on exactly these passes. No other test reads these pictures or the call.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, CEL, REPO, ROOM, TIMEOUT, celDoc, celOp, drawFirst, inconclusive, look, requireMetal, roomDoc, sha256, useDir, useGpu, type Frame, type JsonValue,
} from './helpers.ts';

const ID = AC[8];
const bin = useGpu();
const dir = useDir();
const SHOTS = join(REPO, 'target', 'acceptance', '485');
const TASTE = join(REPO, 'tests', 'acceptance', '485', 'TASTE.json');
const NAMES = ['cel-sphere.png', 'room-32-lights.png'] as const;

describe(`${ID} the screenshots and the one taste call on them`, () => {
  it(`${ID} the run writes the cel-banded sphere with the post's shadow and the room with 32 shaded point lights from the renderer's own output, and the owner's recorded call on exactly those says they look right`, () => {
    requireMetal();
    const [sphere, room] = drawFirst(bin(), dir(), [
      { name: 'show-cel', doc: celDoc('show-cel'), look: look('filmic', 0), size: CEL.size },
      { name: 'show-room', doc: roomDoc('show-room', 'toon', celOp([0.7, 0.7, 0.7])), look: look('filmic', 5), size: ROOM.size },
    ], ['final']) as [Frame, Frame];
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    const keep = (name: string, bytes: Buffer | null): void => {
      expect(bytes, `${name}: the frame has its final target`).not.toBeNull();
      writeFileSync(join(SHOTS, name), bytes!);
      hashes[name] = sha256(bytes!);
    };
    keep('cel-sphere.png', sphere.final);
    keep('room-32-lights.png', room.final);

    const listed = NAMES.map((n) => `  ${join('target', 'acceptance', '485', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: screenshots written from this run's pixels:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/485/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(485);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#485.977f4f15');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the two screenshots').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, TIMEOUT);
});
