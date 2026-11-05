// AC6 #425.e26677a1: Shown to you: screenshots of a mesh at each level of detail, a band margin blend, and a view
// climbing the ladder, taken by the check run from the renderer's own output, with a recording of an orbit and zoom
// across the bands, are attached to the PR and shown to you in the session. Whether they look right is one taste call,
// recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it.
//
// The run draws, with the calls the other tests use, and writes to `docs/evidence/425/` (README: The taste call):
// `mesh-levels.png` (the rock of the level sweep at the first out-leg frame drawing each level, side by side),
// `band-blend.png` (the band sweep's last frame before the ball's margin, its margin frame nearest an even blend, and
// its first frame past the margin), `ladder-climb.png` (the climbing showpiece's live view at frame 100, at render scale
// 0.5, and at frame 140, climbed to 1) and `orbit-zoom.apng` (the band scene orbited half a turn while the camera zooms
// out across the ball's band and back, at 24 fps), each from the renderer's own final targets, printing each one's
// SHA-256. It then reads the owner's recorded call, `tests/acceptance/425/TASTE.json`: none, or one made on other
// pictures (another SHA-256), is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these pictures passes. No
// other test reads these pictures or the call.
//
// Blind redraft of ../taste.test.ts (redraft/README: D1): as the original, word for word, except that the band and
// level sweeps' documents come from ./helpers.ts, whose dolly keys are time literals the base's grammar accepts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, BAND_SIZE, BAND_SWEEP, LEVEL_SWEEP, LOOK, REPO, bandItems, decodePng, encodeApng, encodePng, frameAt, framesOf, inconclusive,
  liveCall, liveOf, readNamed, requireMetal, rockGltf, runGpu, sessionDoc, sha256, showpiece, sideBySide, simplifiedOf, useBuilds,
  useDir, view3dCall, writeJson, type Frame3, type Image, type JsonValue,
} from '../helpers.ts';
import { bandDoc, levelDoc } from './helpers.ts';

const ID = AC[6];
const bin = useBuilds(['default', 'test-meter']);
const dir = useDir();
/** Where the run writes the screenshots and the recording. */
const SHOTS = join(REPO, 'docs', 'evidence', '425');
/** Where the owner's taste call is recorded (README: The taste call). */
const TASTE = join(REPO, 'tests', 'acceptance', '425', 'TASTE.json');
const NAMES = ['mesh-levels.png', 'band-blend.png', 'ladder-climb.png', 'orbit-zoom.apng'] as const;
const REC_FPS = 24;

const final = (out: string, f: Frame3, what: string): Image => decodePng(readNamed(out, f.final, 'png', what));

function screenshots(): Record<string, string> {
  const out = dir();
  mkdirSync(SHOTS, { recursive: true });
  const hashes: Record<string, string> = {};
  const keep = (name: string, bytes: Buffer): void => { writeFileSync(join(SHOTS, name), bytes); hashes[name] = sha256(bytes); };

  // The rock at each level.
  const asset = join(out, 'rock.gltf');
  writeFileSync(asset, rockGltf());
  const [j] = runGpu(bin('default'), out, [{ call: 'simplify', asset, node: 0, levels: 'auto' }]);
  const rock = simplifiedOf(j!, out, 'the simplify job');
  const levelsDoc = writeJson(out, 'levels', levelDoc(rock.sha));
  const [l] = runGpu(bin('default'), out, [view3dCall({ doc: levelsDoc, look: LOOK, size: BAND_SIZE, frames: LEVEL_SWEEP.leg + 1, capture: 'every', targets: ['final'], lod: true, assets: { [rock.sha]: rock.path } })]);
  const firsts = new Map<number, Frame3>();
  for (const f of framesOf(l!, 'the level sweep')) {
    const level = f.lod?.find((r) => r.item === 'rock')?.level;
    if (typeof level === 'number' && !firsts.has(level)) firsts.set(level, f);
  }
  expect(firsts.size, 'the level sweep draws more than one level').toBeGreaterThan(1);
  keep('mesh-levels.png', encodePng(sideBySide([...firsts.entries()].sort((a, b) => a[0] - b[0]).map(([k, f]) => final(out, f, `level ${k}`)))));

  // The band margin blend.
  const bands = writeJson(out, 'bands', bandDoc());
  const [b] = runGpu(bin('default'), out, [view3dCall({ doc: bands, look: LOOK, size: BAND_SIZE, frames: BAND_SWEEP.leg + 1, capture: 'every', targets: ['final'], lod: true })]);
  const sweep = framesOf(b!, 'the band sweep');
  const blend = (f: Frame3) => f.lod?.find((r) => r.item === 'ball')?.blend ?? null;
  const margin = sweep.filter((f) => blend(f) !== null);
  expect(margin.length, 'the band sweep has a margin frame').toBeGreaterThan(0);
  const mid = margin.reduce((a, f) => (Math.abs(blend(f)!.level / blend(f)!.of - 0.5) < Math.abs(blend(a)!.level / blend(a)!.of - 0.5) ? f : a));
  const before = frameAt(sweep, Math.max(0, margin[0]!.frame - 1), 'the band sweep');
  const after = frameAt(sweep, Math.min(BAND_SWEEP.leg, margin.at(-1)!.frame + 1), 'the band sweep');
  keep('band-blend.png', encodePng(sideBySide([before, mid, after].map((f) => final(out, f, `band sweep frame ${f.frame}`)))));

  // The live view climbing the ladder.
  const show = writeJson(out, 'showpiece', showpiece(true));
  const [c] = runGpu(bin('test-meter'), out, [liveCall({ doc: show, frames: 140, charges: [{ from: 1, gpu_ms: 5 }], capture: [100, 140] })]);
  const climb = liveOf(c!, 'the climbing live view');
  keep('ladder-climb.png', encodePng(sideBySide([100, 140].map((n) => {
    const v = climb.views.find((x) => x.frame === n);
    return decodePng(readNamed(out, v?.final ?? null, 'png', `the live view at frame ${n}`));
  }))));

  // An orbit and zoom across the bands.
  const items = bandItems();
  items['cam'] = { kind: 'camera@1', params: { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 0, elevation: 14, distance: 6 }, fov: 40, near: 0.1, far: 200 } };
  const orbitDoc = writeJson(out, 'orbit', sessionDoc('orbit-425', BAND_SIZE, items, { channels: {
    turn: { target: 'items/cam/params/orbit/azimuth', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '4s', value: 180, interp: 'linear' } } },
    zoom: { target: 'items/cam/params/orbit/distance', type: 'f32', keys: { k0: { t: '0s', value: 6, interp: 'linear' }, k1: { t: '2s', value: 30, interp: 'linear' }, k2: { t: '4s', value: 6, interp: 'linear' } } },
  } }));
  const [o] = runGpu(bin('default'), out, [{ ...view3dCall({ doc: orbitDoc, look: LOOK, size: BAND_SIZE, frames: 4 * REC_FPS + 1, capture: 'every', targets: ['final'] }), fps: REC_FPS }]);
  const rec = framesOf(o!, 'the orbit and zoom');
  keep('orbit-zoom.apng', encodeApng(rec.map((f) => final(out, f, `the orbit's frame ${f.frame}`)), REC_FPS));
  return hashes;
}

describe(`${ID} the screenshots, the recording and the one taste call on them`, () => {
  it(`${ID} the run writes the rock at each level, a band margin blend, the climbing view and the orbit and zoom, and the owner's recorded call on exactly those says they look right`, () => {
    requireMetal();
    const hashes = screenshots();
    const listed = NAMES.map((n) => `  ${join('docs', 'evidence', '425', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: screenshots and recording written from this run's pixels:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/425/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(425);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#425.e26677a1');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the three screenshots and the recording').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, 3_600_000);
});
