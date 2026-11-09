// AC8 #505.c8aaffce: "Shown to you: screenshots of a formula written on, the parabola plot with its slider, the
// implicit curves and the filled area, taken by the check run from the canvas's own frames, with a recording of the
// formula writing on and the slider moving, are attached to the PR and shown to you in the session. Whether they look
// right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a
// picture to judge it"
//
// A review-and-evidence criterion: the machine part is here, the call is a person's. One run draws each picture with
// `raster` from the documents the criteria above check (docs.ts), copying each PNG byte for byte into the shots
// folder (`$TMPDIR/deep-505-shots/`), and builds the two recordings as animated PNGs of the canvas's own frames,
// printing each SHA-256. Those files are attached to the PR and shown to you. It then reads
// `tests/acceptance/505/TASTE.json` (#167's and #443's form): none, or one made on other pictures, is INCONCLUSIVE;
// `looks_wrong` fails; `looks_right` on exactly these passes. No other test reads these pictures or the call, which
// this test also checks of the folder's other files.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FORMULA_SVG, areaDoc, circleDoc, ellipticDoc, formulaDoc, parabolaDoc, smallDoc,
} from './docs.ts';
import {
  AC, TIMEOUT, apng, entry, fl, isObject, putStore, rasterAt, sha256, useRender, useTemp, type JsonObject, type JsonValue,
} from './helpers.ts';

const render = useRender();
const temp = useTemp('taste');
const ID = AC[8];
const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(tmpdir(), 'deep-505-shots');
const TASTE = join(HERE, 'TASTE.json');
const inconclusive = (message: string): never => expect.fail(`INCONCLUSIVE: ${message}`);

describe(`${ID} the screenshots, the recordings and the one taste call on them`, () => {
  it(`${ID} the run writes the pictures from the canvas's own frames, no other test reads them, and the recorded call on exactly those says they look right`, () => {
    // No criterion above reads a picture to judge it: no other file of this suite names the shots or the call.
    const others = readdirSync(HERE).filter((f) => f.endsWith('.ts') && f !== 'taste.test.ts');
    const readers = others.filter((f) => { const s = readFileSync(join(HERE, f), 'utf8'); return s.includes('TASTE.json') || s.includes('deep-505-shots'); });
    expect(readers, 'no other test file reads the taste call or its pictures').toEqual([]);

    const bin = render();
    const dir = temp();
    const store = join(dir, 'store');
    mkdirSync(store);
    const src = putStore(store, FORMULA_SVG());
    const pngs = (doc: JsonObject, requests: JsonObject[], name: string): Buffer[] => rasterAt(bin, doc, requests, dir, name).map((f) => readFileSync(f.out));
    const writing = pngs(formulaDoc(src), Array.from({ length: 37 }, (_, k) => ({ t: fl(k / 30), store })), 'formula');
    // The slider moves a from 0.5 to 2 over a second, one entry of yours per frame at 30 fps.
    const moves = Array.from({ length: 31 }, (_, k) => entry(fl(k / 30), k + 1, 'a', 0.5 + (1.5 * k) / 30));
    const sliding = pngs(parabolaDoc(), moves.map((m) => ({ t: m['t']!, input: moves })), 'slider');
    const [circle, elliptic, small, area] = [
      pngs(circleDoc(), [{}], 'circle')[0]!, pngs(ellipticDoc(), [{}], 'elliptic')[0]!, pngs(smallDoc(), [{}], 'small')[0]!,
      pngs(areaDoc(), [{}], 'area')[0]!,
    ];
    const files: Record<string, Buffer> = {
      'formula-mid-write.png': writing[14]!, 'formula-written.png': writing[36]!,
      'parabola-slider.png': sliding[30]!,
      'implicit-circle.png': circle, 'implicit-elliptic.png': elliptic, 'implicit-small-circle.png': small,
      'filled-area.png': area,
      'formula-write-on.apng': apng(writing, 33), 'slider-moving.apng': apng(sliding, 33),
    };
    rmSync(SHOTS, { recursive: true, force: true });
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    for (const [name, bytes] of Object.entries(files)) { writeFileSync(join(SHOTS, name), bytes); hashes[name] = sha256(bytes); }
    const names = Object.keys(files);
    const listed = names.map((n) => `  ${join(SHOTS, n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: written from this run's frames:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: attach these to the PR, show them to the owner\n${listed}\nand record the answer in tests/acceptance/505/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(isObject(call), 'TASTE.json is an object').toBe(true);
    const c = call as JsonObject;
    expect(c['issue'], 'TASTE.json: issue').toBe(505);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#505.c8aaffce');
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
