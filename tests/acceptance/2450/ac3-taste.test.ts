// AC3 #2450.9a0cac61: "Shown to you: the axes with a vector title at four azimuths, taken by the check run from the
// canvas's own frames; one taste call, recorded"
//
// The run draws with `view3d` in the filmic look, from the renderer's own final target (README: The taste call), and
// writes to `docs/evidence/2450/`: `axes-vector-title-az030.png`, `-az120.png`, `-az210.png` and `-az300.png`: #226's
// axes with the xy grid plane, their x title the vector item `xt` (the suite's "x′") and their y and z titles text,
// `ticks.size` 0.15 m so a title is 0.75 m, under a perspective orbit at 20° elevation, 1280 × 720, frames 3, 12, 21
// and 30 of the 36-frame orbit. Each is the frame's `final` target re-encoded without filtering, and its SHA-256 is
// printed. It then reads the recorded call, `tests/acceptance/2450/TASTE.json`: none, or one made on other pictures,
// is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these pictures passes. No other test reads these
// pictures or the call.
// Wrong programs: the base (the vector title is refused `bad_axis`, so nothing is drawn or written); a run with no
// recorded call, or with one made on other pixels; a call that says they look wrong.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FILMIC, ORBIT, REPO, SPIN, TIMEOUT, VECTOR, decodePng, encodePng, framesOf, inconclusive, orbitCamera, putBytes, readNamed, requireMetal, runGpu, sceneItems,
  sessionDoc, sha256, titleSvg, useBins, useOut, writeJson, type JsonValue, type Size,
} from './helpers.ts';

const ID = AC[3];
const NAME = `AC3 ${ID}`;
const bin = useBins(['deep-gpu']);
const out = useOut();
const SHOTS = join(REPO, 'docs', 'evidence', '2450');
const TASTE = join(REPO, 'tests', 'acceptance', '2450', 'TASTE.json');
const FRAMES = [3, 12, 21, 30];
const NAMES = ['axes-vector-title-az030.png', 'axes-vector-title-az120.png', 'axes-vector-title-az210.png', 'axes-vector-title-az300.png'] as const;
const SHOT: Size = [1280, 720];

describe(`${NAME} the pictures of the axes with a vector title and the one taste call on them`, () => {
  it(`${NAME} the run writes the axes with a vector title at four azimuths from the canvas's own frames, and the recorded call on exactly those says they look right`, () => {
    requireMetal();
    const dir = out();
    const items = sceneItems(putBytes(dir, titleSvg()), orbitCamera('perspective', 26), { x: VECTOR, y: 'y', z: 'z' }, { ticks: { size: 0.15 }, planes: ['xy'] });
    const doc = writeJson(dir, 'shot', sessionDoc('taste-2450', SHOT, items, SPIN));
    const [reply] = runGpu(bin('deep-gpu'), dir, [{ call: 'view3d', doc, look: FILMIC, size: [...SHOT], fps: ORBIT.fps, frames: ORBIT.frames, capture: [...FRAMES], targets: ['final'], store: dir }]);
    const captured = framesOf(reply!, ORBIT.frames, 'the orbit').filter((f) => f['final'] !== undefined);
    expect(captured.map((f) => f['frame']), 'the four azimuths are captured').toEqual(FRAMES);
    const hashes: Record<string, string> = {};
    mkdirSync(SHOTS, { recursive: true });
    captured.forEach((f, i) => {
      const bytes = encodePng(decodePng(readNamed(dir, f['final'], 'png', `the orbit: frame ${String(f['frame'])}`)));
      writeFileSync(join(SHOTS, NAMES[i]!), bytes);
      hashes[NAMES[i]!] = sha256(bytes);
    });
    expect(new Set(Object.values(hashes)).size, 'four azimuths give four different pictures').toBe(4);

    const listed = NAMES.map((n) => `  ${join('docs', 'evidence', '2450', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: pictures written from this run's pixels:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/2450/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(2450);
    expect(c['criterion'], 'TASTE.json: criterion').toBe(ID);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the four pictures').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, TIMEOUT);
});
