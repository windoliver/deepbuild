// AC9 #428.8c47edc1: Shown to you: screenshots of the Khronos samples SheenChair, AnisotropyStrengthTest, DispersionTest
// and IridescenceDielectricSpheres, and the flake panel, taken by the check run from the renderer's own output, with a
// recording of the flake panel under a camera dolly, are attached to the PR and shown to you in the session. Whether
// they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion
// above reads a picture to judge it.
//
// One run draws the four samples, each fetched by hash, in a three-quarter view framed from its own bounds under a
// daylight sky that lights by its environment and a sun, filmic; the flake panel of AC7 at frame 0; and the panel's
// dolly (AC7's document at 550 × 550, every frame of its first second at 30 fps) as an animated PNG of its final
// targets. It writes them to `docs/evidence/428/` (README: The taste call), the screenshots byte for byte the renderer's
// PNGs, printing each SHA-256. It then reads `tests/acceptance/428/TASTE.json`: none, or one made on other pictures, is
// INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these passes. No other test reads these pictures or the call.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, ASSET, FLAKE_FPS, FLAKE_PAINT, REPO, SHOW_LOOK, SHOW_SKY, camera, encodeApng, flakeDoc, frameAt, framesOf, inconclusive, khronos, readNamed,
  readPng, requireMetal, runGpu, sceneAsset, sessionDoc, sha256, sun, useDir, useGpu, view3dCall, writeJson, PLAIN_LOOK,
  type Fetched, type JsonObject, type JsonValue, type SampleName,
} from './helpers.ts';
import { add, length, scale, sub, traceable, type V3 } from './reference.ts';

const ID = AC[9];
const bin = useGpu();
const dir = useDir();
const SHOTS = join(REPO, 'docs', 'evidence', '428');
const TASTE = join(REPO, 'tests', 'acceptance', '428', 'TASTE.json');
const SAMPLES: [SampleName, string][] = [
  ['SheenChair', 'khronos-sheen-chair.png'], ['AnisotropyStrengthTest', 'khronos-anisotropy-strength.png'],
  ['DispersionTest', 'khronos-dispersion.png'], ['IridescenceDielectricSpheres', 'khronos-iridescence-spheres.png'],
];
const NAMES = [...SAMPLES.map(([, n]) => n), 'flake-panel.png', 'flake-dolly.apng'] as const;
const SHOT: [number, number] = [1280, 800];

/** A three-quarter view of the sample, framed from its triangles' bounds. */
function showcase(f: Fetched): JsonObject {
  const lo: V3 = [Infinity, Infinity, Infinity]; const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const t of traceable(f.gltf).tris) for (const p of t.p) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, p[k]!); hi[k] = Math.max(hi[k]!, p[k]!); }
  const centre = scale(add(lo, hi), 0.5); const r = length(sub(hi, lo)) / 2;
  const eye = add(centre, scale([0.35, 0.3, 1], (2.4 * r) / length([0.35, 0.3, 1])));
  return sessionDoc(`show-${f.sample.name}`, SHOT, { cam: camera(eye, centre, 40, { near: r / 100, far: r * 20 }), sky: SHOW_SKY, sun: sun(30_000, [-40, 25, 0]), [ASSET]: sceneAsset(f.sha) });
}

describe(`${ID} the screenshots, the recording and the one taste call on them`, () => {
  it(`${ID} the run writes the four Khronos samples, the flake panel and its dolly from the renderer's own output, and the owner's recorded call on exactly those says they look right`, async () => {
    requireMetal();
    const out = dir();
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    const keep = (name: string, bytes: Buffer): void => { writeFileSync(join(SHOTS, name), bytes); hashes[name] = sha256(bytes); };
    for (const [name, file] of SAMPLES) {
      const f = await khronos(name, out);
      const [r] = runGpu(bin(), out, [view3dCall({ doc: writeJson(out, `show-${name}`, showcase(f)), look: SHOW_LOOK, size: SHOT, targets: ['final'], assets: f.assets, uris: f.uris, licenses: f.licenses })]);
      keep(file, readNamed(out, frameAt(framesOf(r!, name), 0, name).final, 'png', name));
    }
    const [panel, dolly] = runGpu(bin(), out, [
      view3dCall({ doc: writeJson(out, 'flakes', flakeDoc(1100, FLAKE_PAINT)), look: PLAIN_LOOK, size: [1100, 1100], fps: FLAKE_FPS, targets: ['final'] }),
      view3dCall({ doc: writeJson(out, 'dolly', flakeDoc(550, FLAKE_PAINT)), look: PLAIN_LOOK, size: [550, 550], fps: FLAKE_FPS, frames: FLAKE_FPS + 1, capture: 'every', targets: ['final'] }),
    ]);
    keep('flake-panel.png', readNamed(out, frameAt(framesOf(panel!, 'the flake panel'), 0, 'the flake panel').final, 'png', 'the flake panel'));
    keep('flake-dolly.apng', encodeApng(framesOf(dolly!, 'the dolly').map((fr) => readPng(out, fr.final, `the dolly's frame ${fr.frame}`)), FLAKE_FPS));

    const listed = NAMES.map((n) => `  ${join('docs', 'evidence', '428', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: screenshots and recording written from this run's pixels:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/428/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(428);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#428.8c47edc1');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the five screenshots and the recording').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, 3_600_000);
});
