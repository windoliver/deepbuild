// #1173.2197a951: Shown to you: screenshots of the city, the effects scene and the house before and after, zoomed on an
// edge and a puff, taken by the check run from the renderer's own output, are attached to the PR and shown to you in the
// session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and
// no criterion above reads a picture to judge it.
//
// The run draws the three scenes (helpers.ts: `cityDoc`, `effectsDoc`, `houseDoc`) by #378's `view3d` with two
// builds of `deep-gpu`: "before", the change's merge base (built from `git archive` of it into
// `target/acceptance/1173/`, or this checkout's build when the renderer's sources equal the merge base's), and "after",
// this checkout. It writes the screenshots to `target/acceptance/1173/` (README: The taste call) from those pixels,
// printing each one's SHA-256, then reads the owner's recorded call, `tests/acceptance/1173/TASTE.json`: none, or one
// made on other pictures, is INCONCLUSIVE; "looks wrong" fails; "looks right" on exactly these pictures passes. No other
// test reads these pictures or the call.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BIN, REPO, SCENE_LOOK, answered, SHOT_VIEW, cargoBuild, cityDoc, crop, effectsDoc, encodePng, finalOf, houseDoc, inconclusive, mergeBase, readPng,
  requireMetal, run, sha256, sideBySide, useBuild, useOut, view3dCall, writeJson, type Image, type JsonObject, type JsonValue,
} from './helpers.ts';

const ID = '#1173.2197a951';
/** Where the run writes the screenshots (under the checkout's ignored `target/`). */
const SHOTS = join(REPO, 'target', 'acceptance', '1173');
/** Where the owner's taste call is recorded (README: The taste call). */
const TASTE = join(REPO, 'tests', 'acceptance', '1173', 'TASTE.json');
const NAMES = [
  'city-before.png', 'city-after.png', 'city-edge-x6.png',
  'effects-before.png', 'effects-after.png', 'effects-edge-x6.png', 'effects-puff-x4.png',
  'house-before.png', 'house-after.png', 'house-edge-x6.png',
] as const;
const FRAME = 30;

const after = useBuild();
const out = useOut();

/** The merge base's `deep-gpu`: this checkout's build when the renderer's sources equal the merge base's, else built from it. */
function beforeBin(): string {
  const base = mergeBase();
  const same = spawnSync('git', ['-C', REPO, 'diff', '--quiet', base, '--', 'crates', 'vendor', 'Cargo.toml', 'Cargo.lock']);
  if (same.status === 0) return after();
  const src = join(SHOTS, `before-${base.slice(0, 12)}`);
  if (!existsSync(join(src, 'Cargo.toml'))) {
    mkdirSync(src, { recursive: true });
    const x = spawnSync('sh', ['-c', 'git -C "$1" archive "$2" | tar -x -C "$3"', 'sh', REPO, base, src], { encoding: 'utf8' });
    expect(x.status, `git archive ${base} unpacked into ${src}: ${x.stderr}`).toBe(0);
  }
  const target = join(SHOTS, 'before-target');
  expect(cargoBuild(src, target), `the merge base ${base} builds`).toBe('');
  return join(target, 'debug', BIN);
}

/** The ID target's pick ID at each pixel (r + 2^8 g + 2^16 b + 2^24 a; 0 where nothing draws). */
const picksOf = (im: Image): Uint32Array => Uint32Array.from({ length: im.width * im.height }, (_, i) => (im.rgba[i * 4]! + im.rgba[i * 4 + 1]! * 256 + im.rgba[i * 4 + 2]! * 65_536 + im.rgba[i * 4 + 3]! * 16_777_216) >>> 0);
/** The edge nearest the view's centre: a pixel whose pick ID differs from its right neighbour's, one of them drawn. */
function edgeAt(ids: Uint32Array, [w, h]: [number, number]): [number, number] {
  let best: [number, number] | null = null; let d = Infinity;
  for (let y = 0; y < h; y++) for (let x = 0; x < w - 1; x++) {
    const a = ids[y * w + x]!; const b = ids[y * w + x + 1]!;
    if (a === b || (a === 0 && b === 0)) continue;
    const e = (x - w / 2) ** 2 + (y - h / 2) ** 2;
    if (e < d) { d = e; best = [x, y]; }
  }
  expect(best, 'the view shows an item\'s edge').not.toBeNull();
  return best!;
}

interface Drawn { final: Image; ids: Image; bare: Image | null }
function draw(bin: string, doc: JsonObject, bare: JsonObject | null, what: string): Drawn {
  // The effects scene's lamp is selected, so its outline draws (#380's `all` scene).
  const selection = 'lamp' in (doc['items'] as JsonObject) ? ['lamp'] : [];
  const call = (path: string, targets: ('final' | 'ids')[]) => view3dCall({ doc: path, look: SCENE_LOOK, size: SHOT_VIEW, from: FRAME, frames: 1, fps: 30, capture: [FRAME], targets, selection });
  const calls = [call(writeJson(out(), `${what}`, doc), ['final', 'ids']), ...(bare ? [call(writeJson(out(), `${what}-bare`, bare), ['final'])] : [])];
  const [r, b] = run(bin, out(), calls).map((reply, i) => answered(reply, i === 0 ? what : `${what} without puffs`));
  // Frames are read without viewOf, since the merge base's reply has none of this suite's fields.
  const frameOf = (reply: JsonObject | undefined, w: string) => {
    const frames = (reply!['frames'] as JsonValue[]).map((f) => f as JsonObject);
    const f = frames.find((x) => x['frame'] === FRAME);
    expect(f, `${w}: frame ${FRAME} is drawn: ${JSON.stringify(reply).slice(0, 600)}`).toBeDefined();
    return { frame: FRAME, pixel_hash: f!['pixel_hash'] as string, final: f!['final'] as string, ids: (f!['ids'] as string | undefined) ?? null, picks: null };
  };
  const f = frameOf(r, what);
  return { final: finalOf(out(), f, what), ids: readPng(out(), f.ids, `${what}: the ID target`), bare: b ? finalOf(out(), frameOf(b, `${what} without puffs`), `${what} without puffs`) : null };
}

/** The ten screenshots, written from this run's pixels; their SHA-256 by name. */
function screenshots(beforeBinPath: string, afterBinPath: string): Record<string, string> {
  const shots: Partial<Record<(typeof NAMES)[number], Image>> = {};
  for (const [name, doc, bare] of [['city', cityDoc(), null], ['effects', effectsDoc(true), effectsDoc(false)], ['house', houseDoc(), null]] as const) {
    const b = draw(beforeBinPath, doc, bare, `${name} before`);
    const a = draw(afterBinPath, doc, bare, `${name} after`);
    const [x, y] = edgeAt(picksOf(a.ids), SHOT_VIEW);
    const edge: [number, number, number, number] = [x - 40, y - 30, 80, 60];
    shots[`${name}-before.png`] = b.final;
    shots[`${name}-after.png`] = a.final;
    shots[`${name}-edge-x6.png`] = sideBySide([crop(b.final, edge), crop(a.final, edge)], 6);
    if (a.bare) {
      let n = 0; let sx = 0; let sy = 0;
      for (let i = 0; i < a.final.width * a.final.height; i++) {
        const o = i * 4;
        const d = Math.abs(a.final.rgba[o]! - a.bare.rgba[o]!) + Math.abs(a.final.rgba[o + 1]! - a.bare.rgba[o + 1]!) + Math.abs(a.final.rgba[o + 2]! - a.bare.rgba[o + 2]!);
        if (d > 30) { n++; sx += i % a.final.width; sy += Math.floor(i / a.final.width); }
      }
      expect(n, `${name}: the puffs draw (at least 200 px where they change the frame by over 30 codes)`).toBeGreaterThanOrEqual(200);
      const puff: [number, number, number, number] = [Math.round(sx / n) - 60, Math.round(sy / n) - 45, 120, 90];
      shots['effects-puff-x4.png'] = sideBySide([crop(b.final, puff), crop(a.final, puff)], 4);
    }
  }
  mkdirSync(SHOTS, { recursive: true });
  const hashes: Record<string, string> = {};
  for (const name of NAMES) {
    const png = encodePng(shots[name]!);
    writeFileSync(join(SHOTS, name), png);
    hashes[name] = sha256(png);
  }
  return hashes;
}

describe(`${ID} the screenshots before and after and the one taste call on them`, () => {
  it(`${ID} the run writes the city, the effects scene and the house before and after, zoomed on an edge and a puff, and the owner's recorded call on exactly those says they look right`, () => {
    requireMetal();
    const hashes = screenshots(beforeBin(), after());
    const listed = NAMES.map((n) => `  ${join('target', 'acceptance', '1173', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: screenshots written from this run's pixels:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: attach the screenshots to the PR, show them to the owner\n${listed}\nand record the answer in tests/acceptance/1173/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(1173);
    expect(c['criterion'], 'TASTE.json: criterion').toBe(ID);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the ten screenshots').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says the pictures don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, 10_800_000);
});
