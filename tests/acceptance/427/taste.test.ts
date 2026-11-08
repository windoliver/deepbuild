// AC8 #427.78a8171b: Shown to you: screenshots of the lighting, overdraw, cascades, bounds, lights and cameras and UV
// checker modes on a test scene, taken by the check run from the renderer's own output, are attached to the PR and shown
// to you in the session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE,
// never PASS, and no criterion above reads a picture to judge it.
//
// `deep-show run` draws the test scene (boxes on a ground slab under a shadow-casting sun, a spot, two point lights and
// a glTF plate with uv0 in metres) in the six modes, and the run copies each mode's snapshot, the renderer's own PNG
// from the evidence store, byte for byte to `docs/evidence/427/<mode>.png`, printing its SHA-256 (README: The taste
// call). It then reads `tests/acceptance/427/TASTE.json`: none, or one made on other pictures, is INCONCLUSIVE;
// `looks_wrong` fails; `looks_right` on exactly these six passes. No other test reads these pictures or the call.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, REPO, type JsonValue, box, camera, drew, evidenceBytes, gltf, inconclusive, meshAsset, mode, plate, point, requireMetal, runShow,
  scenario, scene, seed, sha256, show, sun, useBuilds, useDir,
} from './helpers.ts';

const ID = AC[8];
const bin = useBuilds(['deep-show']);
const dir = useDir();
const SHOTS = join(REPO, 'docs', 'evidence', '427');
const TASTE = join(REPO, 'tests', 'acceptance', '427', 'TASTE.json');
const MODES = ['lighting_only', 'overdraw', 'cascade_splits', 'bounds', 'lights_cameras', 'uv_checker'] as const;
const NAMES = MODES.map((m) => `${m}.png`);

function screenshots(): Record<string, string> {
  const evidence = dir();
  const doc = scene('Diagnostic modes', {
    cam: camera([0, 0.5, 0], 11),
    ground: box([0, -0.25, 0], [12, 0.5, 9]),
    'cube.a': box([-2.5, 0.5, 0]),
    'cube.b': box([0, 0.75, -1.5], [1.5, 1.5, 1.5]),
    'cube.c': box([2.5, 0.5, 1]),
    plate: meshAsset(seed(evidence, gltf(plate(2, 1, 2, 1))), [0, 0.6, 2]),
    key: sun(),
    spot: { kind: 'light.spot@1', params: { power: 800, inner: 15, outer: 30 }, at: { pos: [0, 3, 0], rot: [-90, 0, 0] } },
    'lamp.1': point([-3, 1.5, 2]),
    'lamp.2': point([3, 1.5, -2]),
  });
  const replies = runShow(bin('deep-show'), scenario(evidence, [show(doc), ...MODES.map((m) => mode(m))]));
  mkdirSync(SHOTS, { recursive: true });
  const hashes: Record<string, string> = {};
  MODES.forEach((m, i) => {
    const bytes = evidenceBytes(evidence, drew(replies[i + 1]!, m).sha, `${m}'s snapshot`);
    writeFileSync(join(SHOTS, NAMES[i]!), bytes);
    hashes[NAMES[i]!] = sha256(bytes);
  });
  return hashes;
}

describe(`${ID} the six modes' screenshots and the one taste call on them`, () => {
  it(`${ID} the run writes the lighting, overdraw, cascades, bounds, lights and cameras and UV checker screenshots, and the owner's recorded call on exactly those says they look right`, () => {
    requireMetal();
    const hashes = screenshots();
    const listed = NAMES.map((n) => `  ${join('docs', 'evidence', '427', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: screenshots written from this run's renderer output:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/427/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(427);
    expect(c['criterion'], 'TASTE.json: criterion').toBe(ID);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names exactly the six screenshots').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, 1_800_000);
});
