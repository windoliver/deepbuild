// AC5 #239.85750ec9: "Shown to you: screenshots of the two fixture films, the strokes and paper one and the camera and
// transitions one, taken by the check run from the exported file, with a recording of each film, are attached to the
// PR and shown to you in the session. Whether they look right is one taste call, recorded; without it the run stays
// INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it"
//
// This test judges no picture. The check run (README: The taste call) exports each film and writes into
// docs/evidence/239/ each export's receipt, frames decoded from the exported MP4 as PNGs at the film's size (the size
// its receipt records) and a recording of each film. A file missing reads INCONCLUSIVE; a malformed one fails, naming
// it. The call is tests/acceptance/239/TASTE.json, recorded later by someone else: with none, or one made on other
// files (another SHA-256), the test is INCONCLUSIVE, never a pass; `looks_wrong` fails; `looks_right` on exactly these
// files passes.
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, EVIDENCE_239, FILMS, REPO, inconclusive, int, isObject, obj, sha256, show, type FilmName, type JsonValue } from './helpers.ts';

const TASTE = join(REPO, 'tests', 'acceptance', '239', 'TASTE.json');
/** Each film's screenshots, frames of its exported MP4 (README: The taste call). */
const SHOTS: Record<FilmName, string[]> = {
  'strokes-and-paper': ['strokes-and-paper-drawing.png', 'strokes-and-paper-drawn.png'],
  'camera-and-transitions': ['camera-and-transitions-shot.png', 'camera-and-transitions-transition-1.png', 'camera-and-transitions-transition-2.png'],
};
const RECORDING = (f: FilmName): string => `${f}.mp4`;
const RECEIPT = (f: FilmName): string => `${f}.receipt.json`;
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const rel = (name: string): string => relative(REPO, join(EVIDENCE_239, name));

describe(`${AC[5]} the check run's screenshots and recordings of both films, and the one taste call on them`, () => {
  it(`${AC[5]} the screenshots of both films from their exported files and a recording of each are in docs/evidence/239/, and the run reads INCONCLUSIVE unless a recorded taste call on exactly these files says they look right`, () => {
    const wanted = FILMS.flatMap((f) => [...SHOTS[f], RECORDING(f), RECEIPT(f)]);
    const missing = wanted.filter((n) => !existsSync(join(EVIDENCE_239, n)));
    if (missing.length) inconclusive(`the check run's files are not in docs/evidence/239/: ${missing.join(', ')} (README: The taste call)`);
    const hashes: Record<string, string> = {};
    for (const f of FILMS) {
      let receipt: JsonValue;
      try { receipt = JSON.parse(readFileSync(join(EVIDENCE_239, RECEIPT(f)), 'utf8')) as JsonValue; } catch (e) { return expect.fail(`${rel(RECEIPT(f))} is not JSON: ${(e as Error).message}`); }
      const size = obj(receipt, rel(RECEIPT(f)))['size'];
      expect(Array.isArray(size) && size.length === 2, `${rel(RECEIPT(f))}: the export's receipt records its size, got ${show(size ?? null)}`).toBe(true);
      const [w, h] = (size as JsonValue[]).map((v, i) => int(v, `${rel(RECEIPT(f))}: size[${i}]`));
      for (const name of SHOTS[f]) {
        const png = readFileSync(join(EVIDENCE_239, name));
        expect(png.subarray(0, 8).equals(PNG), `${rel(name)} is a PNG`).toBe(true);
        expect([png.readUInt32BE(16), png.readUInt32BE(20)], `${rel(name)} is a frame of the exported film, at the size its receipt records`).toEqual([w, h]);
        hashes[name] = sha256(png);
      }
      const mp4 = readFileSync(join(EVIDENCE_239, RECORDING(f)));
      expect(mp4.length > 12 && mp4.toString('latin1', 4, 8) === 'ftyp', `${rel(RECORDING(f))} is an MP4`).toBe(true);
      hashes[RECORDING(f)] = sha256(mp4);
    }
    const listed = Object.entries(hashes).map(([n, h]) => `  ${rel(n)}  ${h}`).join('\n');
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/239/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(isObject(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(239);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#239.85750ec9');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = isObject(c['screenshots']) ? c['screenshots'] : {};
    const other = Object.keys(hashes).filter((n) => shots[n] !== hashes[n]);
    if (other.length || Object.keys(shots).length !== Object.keys(hashes).length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other files (${show(shots)}), not this run's:\n${listed}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${AC[5]}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, 60_000);
});
