// AC10 #167.25ddf151: "Shown to you: screenshots of the bar race at 2000, 2000.5 and 2001, the line reveal with its head
// point, and the scale with its growing ticks, taken by the check run from the canvas's own frames, with a recording of
// the race and the reveal, are attached to the PR and shown to you in the session. Whether they look right is one taste
// call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it"
//
// One run draws each picture with `raster`, copying its PNG byte for byte to `docs/evidence/167/`, and builds the two
// recordings as animated PNGs of the same frames, printing each SHA-256. It then reads `tests/acceptance/167/TASTE.json`,
// as #443's suite does: none, or one made on other pictures, is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on
// exactly these passes. No other test reads these pictures or the call.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, LINE_SPAN, LOOK, REPO, TIMEOUT, apng, fl, growingDoc, isObject, item, lineDoc, raceDoc, rasterAt, sha256, useRender, useTemp, type JsonObject, type JsonValue,
} from './helpers.ts';

const render = useRender();
const temp = useTemp('taste');
const ID = AC[10];
const SHOTS = join(REPO, 'docs', 'evidence', '167');
const TASTE = join(REPO, 'tests', 'acceptance', '167', 'TASTE.json');

/** The line with a point held on `#head` by an attachment (`at.anchor`). */
const revealDoc = (): JsonObject => lineDoc([item('dot', 'circle@1', 'b2', { center: [0, 0], r: 5, paint: { fill: { role: 'ink' } } }, { at: { anchor: 'line#head', pos: [0, 0, 0] } })]);
const inconclusive = (message: string): never => expect.fail(`INCONCLUSIVE: ${message}`);

describe(`${ID} the screenshots, the recordings and the one taste call on them`, () => {
  it(`${ID} the run writes the pictures from the canvas's own frames, and the recorded call on exactly those says they look right`, () => {
    const bin = render();
    const dir = temp();
    const pngs = (doc: JsonObject, times: number[], name: string): Buffer[] => rasterAt(bin, doc, times, LOOK, dir, name).map((f) => readFileSync(f.out));
    const race = pngs(raceDoc(), Array.from({ length: 31 }, (_, k) => fl(k / 30)), 'race');
    const reveal = pngs(revealDoc(), Array.from({ length: LINE_SPAN * 15 + 1 }, (_, k) => fl(k / 15)), 'reveal');
    const ticks = pngs(growingDoc(), [0, fl(0.5), fl(1)], 'ticks');
    const files: Record<string, Buffer> = {
      'race-2000.png': race[0]!, 'race-2000-5.png': race[15]!, 'race-2001.png': race[30]!,
      'reveal.png': reveal[Math.floor(reveal.length * 0.6)]!,
      'ticks-2000.png': ticks[0]!, 'ticks-2000-5.png': ticks[1]!, 'ticks-2001.png': ticks[2]!,
      'race.apng': apng(race, 33), 'reveal.apng': apng(reveal, 67),
    };
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    for (const [name, bytes] of Object.entries(files)) { writeFileSync(join(SHOTS, name), bytes); hashes[name] = sha256(bytes); }
    const names = Object.keys(files);
    const listed = names.map((n) => `  ${join('docs', 'evidence', '167', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: written from this run's frames:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/167/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(isObject(call), 'TASTE.json is an object').toBe(true);
    const c = call as JsonObject;
    expect(c['issue'], 'TASTE.json: issue').toBe(167);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#167.25ddf151');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    expect(isObject(c['screenshots']), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = c['screenshots'] as JsonObject;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the screenshots and recordings').toEqual([...names].sort());
    const other = names.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, TIMEOUT);
});
