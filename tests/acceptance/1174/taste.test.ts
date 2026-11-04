// #1174.20f41e3e: Shown to you: screenshots of the same labels in 2D and 3D side by side, and the shard view's labels at
// internal scales 1 and 0.5, taken by the check run from the renderer's own output, are attached to the PR and shown
// to you in the session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE,
// never PASS, and no criterion above reads a picture to judge it.
//
// The run draws AC1's label by scene3d and by the 2D path and the shard view at internal scales 1 and 0.5 (the same
// calls as masks.test.ts and shard.test.ts), and writes five screenshots of those pixels to `target/acceptance/1174/`
// (README: The taste call), printing each one's SHA-256. It then reads the owner's recorded call,
// `tests/acceptance/1174/TASTE.json`: none, or one made on other pictures (another SHA-256), is INCONCLUSIVE; "looks
// wrong" fails; "looks right" on exactly these pictures passes. No other test reads these pictures or the call.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC1_VIEW, HD, REPO, SHARD_LABEL, SHARD_LABELS, crop, encodePng, inconclusive, labelBoard, labelScene, layersCall, maskOf, regionOf, regionProblems,
  requireReferenceMac, run, sha256, shardScene, sideBySide, twoD, useBuild, useOut, view3dCall, viewFrame, writeJson,
  type Image, type JsonValue,
} from './helpers.ts';

const ID = '#1174.20f41e3e';
/** Where the run writes the screenshots (under the checkout's ignored `target/`). */
const SHOTS = join(REPO, 'target', 'acceptance', '1174');
/** Where the owner's taste call is recorded (README: The taste call). */
const TASTE = join(REPO, 'tests', 'acceptance', '1174', 'TASTE.json');
const NAMES = ['labels-2d-3d.png', 'labels-2d-3d-x4.png', 'shard-scale-1.png', 'shard-scale-0.5.png', 'shard-label-x4.png'] as const;

const bin = useBuild();
const out = useOut();

/** The five screenshots, written from this run's pixels; their SHA-256 by name. */
function screenshots(): Record<string, string> {
  const label = writeJson(out(), 'label-3d', labelScene());
  const shard = writeJson(out(), 'shard', shardScene());
  const [r3, r2, r1, r05] = run(bin(), out(), [view3dCall(label, AC1_VIEW), layersCall(labelBoard()), view3dCall(shard, HD, { internal_scale: 1 }), view3dCall(shard, HD, { internal_scale: 0.5 })]);
  const three = viewFrame(out(), r3!, 'scene3d\'s label').image;
  const two = twoD(out(), r2!, 'the 2D text').image;
  const one = viewFrame(out(), r1!, 'the shard view at scale 1');
  const half = viewFrame(out(), r05!, 'the shard view at internal scale 0.5');
  expect([one.scale, half.scale, half.upscale], 'the shard view drew at scale 1 and at internal scale 0.5, upscaled').toEqual([1, 0.5, 'edge_adaptive']);
  // The pictures show something: both labels have ink, and every shard label is in its region.
  for (const [who, im] of [['scene3d', three], ['the 2D path', two]] as const) expect(maskOf(im).filter((v) => v >= 32).length, `${who}'s label has ink`).toBeGreaterThan(200);
  expect(regionProblems(one.image), 'the shard view\'s labels are where their regions are').toEqual([]);
  const box: [number, number, number, number] = [60, 24, 200, 48];
  const region = regionOf(SHARD_LABELS.find((l) => l.id === SHARD_LABEL)!);
  const shots: Record<(typeof NAMES)[number], Image> = {
    'labels-2d-3d.png': sideBySide([two, three]),
    'labels-2d-3d-x4.png': sideBySide([crop(two, box), crop(three, box)], 4),
    'shard-scale-1.png': one.image,
    'shard-scale-0.5.png': half.image,
    'shard-label-x4.png': sideBySide([crop(one.image, region), crop(half.image, region)], 4),
  };
  mkdirSync(SHOTS, { recursive: true });
  const hashes: Record<string, string> = {};
  for (const name of NAMES) {
    const png = encodePng(shots[name]);
    writeFileSync(join(SHOTS, name), png);
    hashes[name] = sha256(png);
  }
  return hashes;
}

describe(`${ID} the screenshots and the one taste call on them`, () => {
  it(`${ID} the run writes the 2D and 3D labels side by side and the shard view at internal scales 1 and 0.5, and the owner's recorded call on exactly those says they look right`, () => {
    requireReferenceMac();
    const hashes = screenshots();
    const listed = NAMES.map((n) => `  ${join('target', 'acceptance', '1174', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: screenshots written from this run's pixels:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner the screenshots\n${listed}\nand record the answer in tests/acceptance/1174/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    const c = call as Record<string, JsonValue>;
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    expect(c['issue'], 'TASTE.json: issue').toBe(1174);
    expect(c['criterion'], 'TASTE.json: criterion').toBe(ID);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the five screenshots').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says the labels don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, 1_800_000);
});
