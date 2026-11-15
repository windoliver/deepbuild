// AC8 #226.6f3a3161: "Shown to you: screenshots of the 3D axes with tick labels at four camera azimuths, a surface and a
// point parented to them, and a tick entering the x domain, taken by the check run from the canvas's own frames, with a
// recording of the 360 degree orbit and the domain change, are attached to the PR and shown to you in the session.
// Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no
// criterion above reads a picture to judge it"
//
// The run draws with `view3d` in the filmic look, from the renderer's own final target (README: The taste call), and
// writes to `docs/evidence/226/`: `axes-az000.png`, `axes-az090.png`, `axes-az180.png` and `axes-az270.png` (the axes
// with titles and the xy grid plane, the surface and the point at (2, 3, 1) parented to them, under a perspective
// orbit, 960 × 540, frames 0, 9, 18 and 27 of the 36-frame orbit), `tick-entering.png` (criterion 6's keyed x domain
// with the surface and the point, at t = 0.5 s, 960 × 540), `orbit-360.apng` (the orbit's 36 frames at 480 × 270,
// 12 fps) and `domain-change.apng` (the keyed domain from 0 to 1 s, 21 frames at 480 × 270, 20 fps), printing each
// one's SHA-256. It then reads the recorded call, `tests/acceptance/226/TASTE.json`: none, or one made on other
// pictures, is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these pictures passes. No other test reads
// these pictures or the call.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOMAIN_KEYS, FILMIC, ORBIT, REPO, TIMEOUT, axesDoc, decodePng, encodeApng, encodePng, framesOf, inconclusive, orbitDoc, pointOnAxes, readNamed,
  requireMetal, runGpu, sha256, surfaceOnAxes, useBins, useOut, writeJson, type Image, type JsonObject, type JsonValue, type Size,
} from './helpers.ts';

const ID = AC[8];
const NAME = `AC8 ${ID}`;
const bin = useBins(['deep-gpu']);
const out = useOut();
const SHOTS = join(REPO, 'docs', 'evidence', '226');
const TASTE = join(REPO, 'tests', 'acceptance', '226', 'TASTE.json');
const NAMES = ['axes-az000.png', 'axes-az090.png', 'axes-az180.png', 'axes-az270.png', 'tick-entering.png', 'orbit-360.apng', 'domain-change.apng'] as const;
const SHOT: Size = [960, 540];
const REC: Size = [480, 270];
const riders = (): Record<string, JsonObject> => ({ surface: surfaceOnAxes(6, 6), pt: pointOnAxes([2, 3, 1]) });

/** The renderer's final target of each frame of `doc` drawn at `size`, `frames` frames from `from` at `fps`, captured at `capture`. */
function finals(doc: JsonObject, size: Size, fps: number, from: number, frames: number, capture: number[] | 'every', what: string): Image[] {
  const dir = out();
  const path = writeJson(dir, 'shot', doc);
  const [reply] = runGpu(bin('deep-gpu'), dir, [{ call: 'view3d', doc: path, look: FILMIC, size: [...size], fps, from, frames, capture, targets: ['final'] }]);
  return framesOf(reply!, frames, what, from).filter((f) => f['final'] !== undefined).map((f) => decodePng(readNamed(dir, f['final'], 'png', `${what}: frame ${String(f['frame'])}`)));
}

describe(`${NAME} the screenshots, the recordings and the one taste call on them`, () => {
  it(`${NAME} the run writes the axes at four azimuths, a tick entering the x domain, the orbit and the domain change, and the recorded call on exactly those says they look right`, () => {
    requireMetal();
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    const keep = (name: string, bytes: Buffer): void => { writeFileSync(join(SHOTS, name), bytes); hashes[name] = sha256(bytes); };
    const orbit = (size: Size): JsonObject => orbitDoc('orbit-taste-226', size, 'perspective', riders(), 'filmic');
    const four = finals(orbit(SHOT), SHOT, ORBIT.fps, 0, ORBIT.frames, [0, 9, 18, 27], 'the orbit');
    expect(four.length, 'four azimuths are captured').toBe(4);
    four.forEach((image, i) => keep(NAMES[i]!, encodePng(image)));
    const keyed = (size: Size): JsonObject => axesDoc('keyed-taste-226', size, riders(), { transport: { span: '1s' }, channels: DOMAIN_KEYS }, { titles: { x: 'x', y: 'y', z: 'z' } });
    keep('tick-entering.png', encodePng(finals(keyed(SHOT), SHOT, 20, 10, 1, 'every', 'a tick entering the x domain')[0]!));
    keep('orbit-360.apng', encodeApng(finals(orbit(REC), REC, ORBIT.fps, 0, ORBIT.frames, 'every', 'the orbit recording'), 12));
    keep('domain-change.apng', encodeApng(finals(keyed(REC), REC, 20, 0, 21, 'every', 'the domain change recording'), 20));

    const listed = NAMES.map((n) => `  ${join('docs', 'evidence', '226', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: screenshots and recordings written from this run's pixels:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/226/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(226);
    expect(c['criterion'], 'TASTE.json: criterion').toBe(ID);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the five screenshots and the two recordings').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, 2 * TIMEOUT);
});
