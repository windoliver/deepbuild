// AC7 #423.35374578: Shown to you: screenshots of the Khronos texture samples, the anisotropic stripes floor and the
// KTX2 asset, taken by the check run from the renderer's own output, are attached to the PR and shown to you in the
// session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS,
// and no criterion above reads a picture to judge it.
//
// One deep-gpu run draws the six Khronos texture samples (AC2's five and AC4's TextureEncodingTest, fetched by hash
// as there, each framed orthographic from +Z), AC5's stripes floor and AC6's KTX2 asset, and copies each frame's
// final target, the PNG file the renderer itself wrote and named by its SHA-256, to `target/acceptance/423/` under
// the names in README (The taste call), printing each one's SHA-256. It then reads the recorded call,
// `tests/acceptance/423/TASTE.json`: none, or one made on other pictures (another SHA-256), is INCONCLUSIVE;
// `looks_wrong` fails; `looks_right` on exactly these pictures passes. No other test reads these pictures or the call.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, PANEL_CAM, PLAIN_LOOK, REPO, STRIPES_CAM, assetMaps, assetMaterial, assetsOf, byHash, frame0, framing, inconclusive, khronos, ortho, panelDoc,
  readNamed, requireMetal, runGpu, sceneAsset, sessionDoc, stripesFloor, sun, useDir, useGpu, view3dCall, writeJson,
  type JsonObject, type JsonValue, type SampleName,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
/** Where the run writes the screenshots (under the checkout's ignored `target/`). */
const SHOTS = join(REPO, 'target', 'acceptance', '423');
/** Where the owner's taste call is recorded (README: The taste call). */
const TASTE = join(REPO, 'tests', 'acceptance', '423', 'TASTE.json');
const MODELS: [SampleName, string][] = [
  ['TextureTransformTest', 'khronos-texture-transform.png'], ['TextureSettingsTest', 'khronos-texture-settings.png'],
  ['TextureCoordinateTest', 'khronos-texture-coordinate.png'], ['AlphaBlendModeTest', 'khronos-alpha-blend-mode.png'],
  ['NegativeScaleTest', 'khronos-negative-scale.png'], ['TextureEncodingTest', 'khronos-texture-encoding.png'],
];
const NAMES = [...MODELS.map(([, n]) => n), 'stripes-floor.png', 'ktx2-asset.png'];

/** The eight screenshots, copied from this run's final targets; their SHA-256 by name. */
async function screenshots(out: string): Promise<Record<string, string>> {
  const size: [number, number] = [640, 480];
  const calls: JsonObject[] = [];
  for (const [name] of MODELS) {
    const f = await khronos(name, out);
    const { target, viewWidth } = framing(f.gltf, size);
    const doc = sessionDoc(`shot-${name}`, size, { cam: ortho(target, viewWidth), sun: sun(3, [-20, 15, 0]), asset: sceneAsset(f.sha) });
    calls.push(view3dCall({ doc: writeJson(out, `shot-${name}`, doc), look: PLAIN_LOOK, size, targets: ['final'], ...byHash(f) }));
  }
  const floor = stripesFloor(out);
  calls.push(view3dCall({ doc: floor.doc, look: PLAIN_LOOK, size: STRIPES_CAM.size, targets: ['final'], assets: floor.assets }));
  const maps = assetMaps(out, 'ktx2');
  calls.push(view3dCall({ doc: writeJson(out, 'ktx2-asset', panelDoc('ktx2-asset', 'kit', assetMaterial(maps), true)), look: PLAIN_LOOK, size: PANEL_CAM.size, targets: ['final'], assets: assetsOf(maps) }));
  const { replies } = runGpu(bin(), out, calls);
  mkdirSync(SHOTS, { recursive: true });
  const hashes: Record<string, string> = {};
  for (const [i, name] of NAMES.entries()) {
    const f = frame0(replies[i]!, name);
    readNamed(out, f.final, 'png', `${name}: the renderer's final target`);
    copyFileSync(join(out, `${f.final}.png`), join(SHOTS, name));
    hashes[name] = f.final!;
  }
  return hashes;
}

describe(`${AC[7]} the screenshots and the one taste call on them`, () => {
  it(`${AC[7]} the run writes the Khronos samples, the stripes floor and the KTX2 asset from the renderer's own output, and the recorded call on exactly those says they look right`, async () => {
    requireMetal();
    const hashes = await screenshots(dir());
    const listed = NAMES.map((n) => `  ${join('target', 'acceptance', '423', n)}  ${hashes[n]}`).join('\n');
    console.log(`${AC[7]}: screenshots copied from this run's final targets:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner the screenshots\n${listed}\nand record the answer in tests/acceptance/423/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(423);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#423.35374578');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the eight screenshots').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says the pictures don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${AC[7]}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, 1_800_000);
});
