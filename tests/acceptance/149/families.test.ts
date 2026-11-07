// AC1 #149.71fb5e48: Each family renders its own fixture with an original subject in a 2D drawing look and a 3D drawing
// look, with no film-specific code, each frame matching its golden pixel hash on the reference Mac with the blank guard
// (#64) before the comparison; a planted family that draws its fill flat misses its golden and fails, naming the
// family, and a black frame reads BLOCKED under the guard, never PASS.
//
// Every frame goes through `golden` with `oracle: "pixel_hash"` (README: The surface under test): the guard first, then
// the frame's RGBA8 pixel hash against `goldens/<family>.<2d|3d>.f<n>.golden.json`, under the fingerprint it was recorded
// on. A golden is recorded once, by the command in the README, on a reference Mac; a missing one reads INCONCLUSIVE, a
// golden from another machine reads INCONCLUSIVE naming both, and neither ever passes.
//
// Wrong programs: a family drawing flat (the planted `ink_fill_flat`, which leaves `wash` alone); a black frame (the
// planted `draws_black`), which must read BLOCKED before any hash is compared; a fixture's own name in the program.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DIMS, FAMILIES, FAMILY_FPS, FAMILY_FRAMES, FAMILY_SIZE, GOLDENS, answered, failsNaming, familyFixture, film2dCall, goldenName, hasFile, inconclusive, lookOf, namedInCode,
  none, obj, onReferenceMac, requireMetal, rows, runGpu, shown, str, useDir, useGpu, view3dCall, writeJson, type Dim, type Family, type JsonObject, type Planted,
} from './helpers.ts';

const ID = AC[1];
const bin = useGpu();
const dir = useDir();
const RECORDING = process.env['DEEP_149_RECORD_GOLDENS'] === '1';

interface Verdict { family: Family; dim: Dim; frame: number; verdict: string; reason: string; pixels: string | null; fingerprint: JsonObject; raw: JsonObject }
/** A fixture drawn at its frames, each sought in its own call, then each frame through `golden`. */
function judged(out: string, family: Family, dim: Dim, planted?: Planted): Verdict[] {
  const fixture = familyFixture(family);
  const look = lookOf(fixture);
  const doc = obj(fixture[dim], `${family}: its ${dim} document`);
  const path = dim === '3d' ? writeJson(out, `${family}-3d.json`, doc) : '';
  const calls = FAMILY_FRAMES.map((n) => (dim === '2d'
    ? film2dCall(doc, look, { fps: FAMILY_FPS, from: n, frames: 1, capture: [n] })
    : view3dCall(path, look, FAMILY_SIZE, { fps: FAMILY_FPS, from: n, frames: 1, capture: [n], targets: ['final'] })));
  const drawn = runGpu(bin(), out, calls, planted);
  const golden = FAMILY_FRAMES.map((n, i) => {
    const row = rows(drawn[i]!, `${family} ${dim} frame ${n}`).find((r) => r.frame === n);
    expect(row?.png, `${family} ${dim}: frame ${n} was captured: ${shown(drawn[i]!)}`).toBeTruthy();
    hasFile(out, row!.png, 'png', `${family} ${dim} frame ${n}`);
    return { call: 'golden', store: GOLDENS, fixture: goldenName(family, dim, n), png: join(out, `${row!.png!}.png`), oracle: 'pixel_hash' } as JsonObject;
  });
  return runGpu(bin(), out, golden).map((reply, i) => {
    answered(reply, `golden for ${family} ${dim} frame ${FAMILY_FRAMES[i]!}`);
    const numbers = reply['numbers'];
    const pixels = typeof numbers === 'object' && numbers !== null && !Array.isArray(numbers) ? numbers['pixels'] : null;
    return {
      family, dim, frame: FAMILY_FRAMES[i]!, verdict: str(reply['verdict'], 'verdict'), reason: typeof reply['reason'] === 'string' ? reply['reason'] : '',
      pixels: typeof pixels === 'string' ? pixels : null, fingerprint: obj(reply['fingerprint'], 'fingerprint'), raw: reply,
    };
  });
}
const label = (v: Verdict): string => `family ${v.family} ${v.dim} frame ${v.frame}`;
const missed = (vs: Verdict[]): string[] => vs.filter((v) => v.verdict === 'FAIL').map((v) => `${label(v)} misses its golden: ${shown(v.raw['numbers'])}`);
const noGolden = (v: Verdict): boolean => v.verdict === 'BLOCKED' && v.reason === 'no_golden';

/** `DEEP_149_RECORD_GOLDENS=1`: writes each missing golden once, on a reference Mac, and never a blank frame's. */
function record(all: Verdict[]): never {
  if (!onReferenceMac()) inconclusive('goldens are recorded on a reference Mac (Mac15,7 or Mac15,12), and this is not one');
  mkdirSync(GOLDENS, { recursive: true });
  let written = 0;
  for (const v of all.filter(noGolden)) {
    expect(v.pixels, `${label(v)}: the no_golden reply carries the frame's pixel hash`).toMatch(/^[0-9a-f]{64}$/);
    const file = join(GOLDENS, `${goldenName(v.family, v.dim, v.frame)}.golden.json`);
    if (existsSync(file)) continue;
    writeFileSync(file, `${JSON.stringify({ fixture: goldenName(v.family, v.dim, v.frame), fingerprint: v.fingerprint, pixels: v.pixels }, null, 1)}\n`);
    written++;
  }
  inconclusive(`recorded ${written} goldens; a recording run proves nothing, so run the suite again without DEEP_149_RECORD_GOLDENS`);
}

describe(`${ID} each family's fixtures, the guard and the goldens`, () => {
  it(`${ID} each family's 2D and 3D fixtures match their goldens by pixel hash, the blank guard first, with no film-specific code`, () => {
    requireMetal();
    const all = FAMILIES.flatMap((f) => DIMS.flatMap((d) => judged(dir(), f, d)));
    const blank = all.filter((v) => v.verdict === 'BLOCKED' && v.reason === 'blank').map(label);
    none(blank, 'BLOCKED under the blank guard, a frame no fixture may draw');
    if (RECORDING) record(all);
    none(missed(all), 'frames that miss their goldens');
    const other = all.filter((v) => v.verdict === 'INCONCLUSIVE');
    if (other.length) inconclusive(`${other.length} goldens were recorded on another machine: ${other.slice(0, 3).map((v) => `${label(v)}: ${shown(v.raw['changed'])}`).join('; ')}`);
    const absent = all.filter(noGolden);
    if (absent.length) inconclusive(`${absent.length} of ${all.length} frames have no golden, ${absent.slice(0, 3).map(label).join(', ')}, …: record them once on a reference Mac (README: The goldens)`);
    expect(all.filter((v) => v.verdict !== 'PASS').map((v) => `${label(v)}: ${shown(v.raw)}`), 'every frame reads PASS').toEqual([]);
    expect(all.length, 'every family, in 2D and 3D, at each of its frames').toBe(FAMILIES.length * DIMS.length * FAMILY_FRAMES.length);
    const names = FAMILIES.flatMap((f) => { const x = familyFixture(f); return [str(obj(x['2d'], '2d')['id'], 'id'), str(obj(x['3d'], '3d')['id'], 'id'), str(obj(x['look'], 'look')['id'], 'id')]; });
    none(namedInCode(names), 'a fixture named in the program');
  });

  it(`${ID} a planted family drawing its fill flat misses its goldens, naming the family; the family beside it keeps them`, () => {
    requireMetal();
    const honest = (['ink', 'wash'] as const).flatMap((f) => DIMS.flatMap((d) => judged(dir(), f, d)));
    const planted = (['ink', 'wash'] as const).flatMap((f) => DIMS.flatMap((d) => judged(dir(), f, d, 'ink_fill_flat')));
    planted.forEach((v, i) => {
      const was = honest[i]!;
      expect(v.pixels, `${label(v)}: a pixel hash`).toMatch(/^[0-9a-f]{64}$/);
      if (v.family === 'ink') expect(v.pixels, `${label(v)}: the flat fill draws other pixels`).not.toBe(was.pixels);
      else expect(v.pixels, `${label(v)}: the plant leaves the other family alone`).toBe(was.pixels);
    });
    if (planted.some(noGolden)) inconclusive('the ink and wash goldens are not recorded, so nothing can miss them (README: The goldens)');
    const failures = missed(planted);
    failsNaming(failures, 'family ink', 'the planted flat family');
    expect(failures.filter((f) => !f.startsWith('family ink')), 'only the planted family misses').toEqual([]);
    expect(planted.filter((v) => v.family === 'ink').every((v) => v.verdict === 'FAIL'), 'every ink frame reads FAIL, in 2D and 3D').toBe(true);
  });

  it(`${ID} a black frame reads BLOCKED under the guard, never PASS, in 2D and 3D`, () => {
    requireMetal();
    for (const dim of DIMS) {
      const verdicts = judged(dir(), 'paper', dim, 'draws_black');
      for (const v of verdicts) {
        expect(v.verdict, `${label(v)}, black, reads BLOCKED: ${shown(v.raw)}`).toBe('BLOCKED');
        expect(v.reason, `${label(v)}: the guard names the blank frame, before any golden is read`).toBe('blank');
      }
    }
  });
});
