// AC5 #426.45886847: Shown to you: screenshots of the product fixture on a dark sky gradient, the HDR backdrop on its own ground,
// the blurred background and the background fog, taken by the check run from the renderer's own output, are attached to the PR and
// shown to you in the session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never
// PASS, and no criterion above reads a picture to judge it.
//
// One run draws, with the fixtures the criteria use (helpers): the product fixture on the dark gradient under the studio (AC1); the
// grid HDR as the backdrop on its own ground with the box at the origin, the camera at (0, 1.5, 5) (AC2); the blur fixture at
// `background_blur: 0.5` over the two-level HDR (AC3); and the fog fixture above the horizon, `fog: background` at 0.02 per m (AC4).
// It copies each final target, the renderer's own PNG byte for byte, to `target/acceptance/426/`, printing each SHA-256. It then reads
// `tests/acceptance/426/TASTE.json`: none, or one made on other pictures (another SHA-256), is INCONCLUSIVE; `looks_wrong` fails;
// `looks_right` on exactly these pictures passes. No other test reads these pictures or the call.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, BLUR_SIZE, DARK_GRADIENT, FOG_SIZE, GROUND_SIZE, PRODUCT_SIZE, REPO, STUDIO, blurDoc, fogDoc, gridPixel, groundDoc, inconclusive, only, productDoc, readNamed, redBluePixel, requireMetal,
  runGpu, sha256, stepPixel, useDir, useGpu, view3dCall, writeHdr, writeJson, type JsonValue,
} from './helpers.ts';

const ID = AC[5];
const bin = useGpu();
const dir = useDir();
const SHOTS = join(REPO, 'target', 'acceptance', '426');
const TASTE = join(REPO, 'tests', 'acceptance', '426', 'TASTE.json');
const NAMES = ['product-gradient.png', 'backdrop-ground.png', 'blurred-background.png', 'background-fog.png'] as const;

describe(`${ID} the screenshots and the one taste call on them`, () => {
  it(`${ID} the run writes the product on its dark gradient, the backdrop on its ground, the blurred background and the background fog from the renderer's own output, and the owner's recorded call on exactly those says they look right`, () => {
    requireMetal();
    const out = dir();
    const grid = writeHdr(out, [720, 360], gridPixel); const step = writeHdr(out, [720, 360], stepPixel); const redBlue = writeHdr(out, [720, 360], redBluePixel);
    const assets = { [grid.sha]: grid.path, [step.sha]: step.path, [redBlue.sha]: redBlue.path };
    const replies = runGpu(bin(), out, [
      view3dCall({ doc: writeJson(out, 'product', productDoc({ ...DARK_GRADIENT, ...STUDIO })), size: PRODUCT_SIZE, targets: ['final'] }),
      view3dCall({ doc: writeJson(out, 'ground', groundDoc(grid.sha, { catcher: false, moves: false })), size: GROUND_SIZE, targets: ['final'], assets }),
      view3dCall({ doc: writeJson(out, 'blur', blurDoc(step.sha, 0.5)), size: BLUR_SIZE, targets: ['final'], assets }),
      view3dCall({ doc: writeJson(out, 'fog', fogDoc(redBlue.sha, 10, 0.02)), size: FOG_SIZE, targets: ['final'], assets }),
    ]);
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    NAMES.forEach((name, i) => {
      const bytes = readNamed(out, only(replies[i]!, name).final, 'png', name);
      writeFileSync(join(SHOTS, name), bytes); hashes[name] = sha256(bytes);
    });
    const listed = NAMES.map((n) => `  ${join('target', 'acceptance', '426', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: screenshots written from this run's pixels:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/426/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(426);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#426.45886847');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the four screenshots').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, 1_800_000);
});
