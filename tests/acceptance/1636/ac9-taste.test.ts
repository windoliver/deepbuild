// AC9 #1636.3cc39a14: "Shown to you: stills of 8 seeded variants and a 10 s clip of the fixture tree under sway, taken by
// the check run from the canvas's own frames, are attached to the PR and shown to you in the session. Whether they look
// right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a
// picture to judge it"
//
// The run draws with `view3d` in the filmic look, each picture the renderer's own final target (README: The taste
// call), and writes to `docs/evidence/1636/`: `variant-1.png` … `variant-8.png` (the fixture's params at seeds 1 to 8,
// each tree alone on a ground plate under a casting sun, 640 × 640) and `sway-10s.apng` (the fixture tree under
// `mod.sway@1 {amount: 0.3, weight: wind}` with its default gusts, 0 to 10 s at 8 fps, 81 frames at 480 × 360),
// printing each one's SHA-256. It then reads the recorded call, `tests/acceptance/1636/TASTE.json`: none, or one made on
// other pictures (another SHA-256), is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these passes. No
// other test reads these pictures or the call.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FILMIC, FIXTURE, REPO, TIMEOUT, camera, decodePng, encodeApng, encodePng, framesOf, ground, inconclusive, readNamed, requireMetal, runGpu,
  sessionDoc, sha256, sun, treeItem, useBins, useFolders, writeJson, type Image, type JsonObject, type JsonValue, type Size,
} from './helpers.ts';

const ID = AC[9];
const NAME = `AC9 ${ID}`;
const bin = useBins(['deep-gpu']);
const folder = useFolders();
const SHOTS = join(REPO, 'docs', 'evidence', '1636');
const TASTE = join(REPO, 'tests', 'acceptance', '1636', 'TASTE.json');
const STILL: Size = [640, 640];
const CLIP: Size = [480, 360];
const CLIP_FPS = 8;
const VARIANTS = Array.from({ length: 8 }, (_, k) => k + 1);
const NAMES = [...VARIANTS.map((s) => `variant-${s}.png`), 'sway-10s.apng'];

/** A tree alone on a ground plate, as the stills and the clip draw it. */
const scene = (size: Size, tree: JsonObject): JsonObject => sessionDoc(`taste-1636-${size[0]}`, size, {
  cam: camera([0, 5, 17], [0, 4.2, 0], 45), sun: sun([-40, 30, 0], true), earth: ground([40, 40], [0, 0, 0]), tree,
});
/** The renderer's final target of each frame of `doc` drawn at `size`, `frames` frames from 0 at `fps`. */
function finals(doc: JsonObject, size: Size, what: string, frames = 1, fps = CLIP_FPS): Image[] {
  const out = folder();
  const [reply] = runGpu(bin('deep-gpu'), out, [{ call: 'view3d', doc: writeJson(out, 'shot', doc), look: FILMIC, size: [...size], fps, from: 0, frames, capture: 'every', targets: ['final'] }]);
  return framesOf(reply!, frames, what).map((f) => decodePng(readNamed(out, f['final'], 'png', `${what}: frame ${String(f['frame'])}`)));
}

describe(`${NAME} the stills, the clip and the one taste call on them`, () => {
  it(`${NAME} the run writes 8 seeded variants and 10 s of the fixture tree under sway, and the recorded call on exactly those says they look right`, () => {
    requireMetal();
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    const keep = (name: string, bytes: Buffer): void => { writeFileSync(join(SHOTS, name), bytes); hashes[name] = sha256(bytes); };
    for (const seed of VARIANTS) keep(`variant-${seed}.png`, encodePng(finals(scene(STILL, treeItem({ ...FIXTURE, seed })), STILL, `variant ${seed}`)[0]!));
    const swaying = treeItem(FIXTURE, { modifiers: [{ kind: 'mod.sway@1', params: { amount: 0.3, weight: 'wind', seed: 7 } }] });
    keep('sway-10s.apng', encodeApng(finals(scene(CLIP, swaying), CLIP, 'the fixture tree under sway', 10 * CLIP_FPS + 1), CLIP_FPS));

    const listed = NAMES.map((n) => `  ${join('docs', 'evidence', '1636', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: stills and clip written from this run's frames:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/1636/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(1636);
    expect(c['criterion'], 'TASTE.json: criterion').toBe(ID);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the eight stills and the clip').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, 3 * TIMEOUT);
});
