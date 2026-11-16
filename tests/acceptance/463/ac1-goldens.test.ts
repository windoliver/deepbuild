// AC1 #463.d6ee1ca5: "One test scene renders in every art@1 look, in 2D and in 3D, with no change to its data, each
// look's frame matching its golden pixel hash on the reference Mac with the blank guard (#64) before the comparison; a
// planted look that draws a black frame reads BLOCKED under the guard, never PASS, and one that draws the scene with
// another look's passes misses that look's golden and fails, naming the look"
//
// The shared test scene (fixtures/scene.json) is drawn at frame 30 (1 s) in each of the twelve looks the pack lists,
// its 2D film through `film2d` and its 3D scene through `view3d`, each look named by its ID with the art@1 pack
// installed through the call's `packs` (README: The surface under test). The same document goes to every look: the 2D
// film's revision hash is the same for all twelve and unchanged after drawing, and the 3D file's bytes are unchanged.
// Every final frame then goes through `golden` with `oracle: "pixel_hash"`: the blank guard first, then the frame's
// RGBA8 hash against `goldens/<look>.<dim>.golden.json` under the fingerprint it was recorded on. A missing golden or
// one from another machine reads INCONCLUSIVE, never a pass; goldens are recorded once on a reference Mac (README).
//
// Wrong programs: a look that draws black (`draws_black`) must read BLOCKED `blank`, in 2D and 3D, for every look; a
// look drawing with another look's passes (`halftone_pop_takes_dot_passes`) changes art.halftone_pop's pixels only,
// and misses its goldens, the failures naming art.halftone_pop; looks that draw alike, or don't draw, fail the guards.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DIMS, FRAME, GOLDENS, LOOKS, TIMEOUT, ac, drawCall, drawnFrame, failsNaming, goldenCall, goldenName, inconclusive, label, none,
  obj, onReferenceMac, packLooks, requireGpu, run, scene, sha256, show, str, useBins, useDir, verdictOf, writeJson,
  type Dim, type Drawn, type Planted, type Verdict,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const RECORDING = process.env['DEEP_463_RECORD_GOLDENS'] === '1';

interface Judged { drawn: Map<string, Drawn>; verdicts: Verdict[]; problems: string[] }
const key = (look: string, dim: Dim): string => `${look} ${dim}`;

/** The scene in each of `looks`, in 2D and 3D, at frame 30, then each final frame through `golden`. */
function judge(looks: readonly string[], planted?: Planted): Judged {
  requireGpu();
  const out = dir();
  const s = scene();
  const doc2 = obj(s['2d'], 'the scene: its 2D film');
  const path3 = writeJson(out, 'scene-3d.json', obj(s['3d'], 'the scene: its 3D scene'));
  const before3 = sha256(readFileSync(path3));
  const calls = DIMS.flatMap((dim) => looks.map((look) => drawCall(dim, dim === '2d' ? doc2 : path3, look)));
  const replies = run(bins.bin('deep-gpu'), out, calls, planted);
  const problems: string[] = [];
  const drawn = new Map<string, Drawn>();
  const opened = new Set<string>();
  DIMS.forEach((dim, d) => looks.forEach((look, i) => {
    const reply = replies[d * looks.length + i]!;
    const f = drawnFrame(reply, FRAME, `the scene in ${look}, ${dim}`);
    drawn.set(key(look, dim), f);
    if (dim === '2d') {
      const doc = obj(reply['document'], `the scene in ${look}, 2d: document`);
      opened.add(str(doc['opened'], 'document.opened'));
      if (doc['played'] !== doc['opened']) problems.push(`look ${look} 2d changed the scene's data while drawing it: opened ${show(doc['opened'])}, played ${show(doc['played'])}`);
    }
  }));
  if (opened.size !== 1) problems.push(`the 2D scene opened as ${opened.size} different documents across the looks, not one: ${[...opened].join(', ')}`);
  if (sha256(readFileSync(path3)) !== before3) problems.push('the 3D scene file changed while the looks drew it');
  const golden = DIMS.flatMap((dim) => looks.map((look) => goldenCall(look, dim, join(out, `${drawn.get(key(look, dim))!.final}.png`))));
  const verdicts = run(bins.bin('deep-gpu'), out, golden).map((reply, k) => {
    const dim = DIMS[Math.floor(k / looks.length)]!;
    return verdictOf(reply, looks[k % looks.length]!, dim);
  });
  return { drawn, verdicts, problems };
}
const missed = (vs: readonly Verdict[]): string[] => vs.filter((v) => v.verdict === 'FAIL').map((v) => `${label(v)} misses its golden: ${show(v.raw['numbers'])}`);
const noGolden = (v: Verdict): boolean => v.verdict === 'BLOCKED' && v.reason === 'no_golden';

/** `DEEP_463_RECORD_GOLDENS=1`: writes each missing golden once, on a reference Mac, never a blank frame's; then INCONCLUSIVE. */
function record(all: readonly Verdict[]): never {
  if (!onReferenceMac()) inconclusive('goldens are recorded on a reference Mac (Mac15,7, Mac15,12 or Mac17,10), and this is not one');
  mkdirSync(GOLDENS, { recursive: true });
  let written = 0;
  for (const v of all.filter(noGolden)) {
    expect(v.pixels, `${label(v)}: the no_golden reply carries the frame's pixel hash`).toMatch(/^[0-9a-f]{64}$/);
    const file = join(GOLDENS, `${goldenName(v.look, v.dim)}.golden.json`);
    if (existsSync(file)) continue;
    writeFileSync(file, `${JSON.stringify({ fixture: goldenName(v.look, v.dim), fingerprint: v.fingerprint, pixels: v.pixels }, null, 1)}\n`);
    written++;
  }
  inconclusive(`recorded ${written} goldens; a recording run proves nothing, so run the suite again without DEEP_463_RECORD_GOLDENS`);
}

describe(`${ac(1)} the shared test scene in every art@1 look, in 2D and 3D, held to its golden under the blank guard`, () => {
  it(`${ac(1)} the scene, unchanged, renders in each of the twelve looks in 2D and 3D, each frame matching its golden pixel hash, the blank guard first`, () => {
    expect(packLooks(), 'art@1 lists exactly the issue\'s twelve looks').toEqual([...LOOKS].sort());
    const { drawn, verdicts, problems } = judge(LOOKS);
    none(problems, 'the scene drawn in every look with no change to its data');
    for (const dim of DIMS) {
      const byHash = new Map<string, string[]>();
      for (const look of LOOKS) { const h = drawn.get(key(look, dim))!.pixelHash; byHash.set(h, [...(byHash.get(h) ?? []), look]); }
      none([...byHash.values()].filter((ls) => ls.length > 1).map((ls) => `${dim}: ${ls.join(' and ')} draw the scene to the same pixels`), `each look draws the scene its own way in ${dim}`);
    }
    none(verdicts.filter((v) => v.verdict === 'BLOCKED' && v.reason === 'blank').map(label), 'frames BLOCKED as blank under the guard, which no look may draw');
    if (RECORDING) record(verdicts);
    none(missed(verdicts), 'frames that miss their goldens');
    const other = verdicts.filter((v) => v.verdict === 'INCONCLUSIVE');
    if (other.length) inconclusive(`${other.length} goldens were recorded on another machine: ${other.slice(0, 3).map((v) => `${label(v)}: ${show(v.raw['changed'])}`).join('; ')}`);
    const absent = verdicts.filter(noGolden);
    if (absent.length) inconclusive(`${absent.length} of ${verdicts.length} frames have no golden (${absent.slice(0, 3).map(label).join(', ')}, …): record them once on a reference Mac (README: The goldens)`);
    expect(verdicts.filter((v) => v.verdict !== 'PASS').map((v) => `${label(v)}: ${show(v.raw)}`), 'every frame reads PASS').toEqual([]);
    expect(verdicts.length, 'every look, in 2D and in 3D').toBe(LOOKS.length * DIMS.length);
  }, TIMEOUT);

  it(`${ac(1)} (planted) a look that draws a black frame reads BLOCKED under the guard, never PASS, for every look in 2D and 3D`, () => {
    const { verdicts } = judge(LOOKS, 'draws_black');
    none(verdicts.filter((v) => !(v.verdict === 'BLOCKED' && v.reason === 'blank')).map((v) => `${label(v)}, drawn black, reads ${v.verdict} ${v.reason}: ${show(v.raw)}`),
      'black frames that the blank guard didn\'t block before the comparison');
  }, TIMEOUT);

  it(`${ac(1)} (planted) a look drawing the scene with another look's passes misses that look's goldens and fails, naming the look; the other look keeps its own`, () => {
    const pair = ['art.halftone_pop', 'art.dot'] as const;
    const honest = judge(pair);
    const planted = judge(pair, 'halftone_pop_takes_dot_passes');
    for (const dim of DIMS) {
      expect(planted.drawn.get(key('art.halftone_pop', dim))!.pixelHash, `art.halftone_pop ${dim}: the planted look draws other pixels than its own`).not.toBe(honest.drawn.get(key('art.halftone_pop', dim))!.pixelHash);
      expect(planted.drawn.get(key('art.dot', dim))!.pixelHash, `art.dot ${dim}: the plant leaves the look whose passes it borrows alone`).toBe(honest.drawn.get(key('art.dot', dim))!.pixelHash);
    }
    if (planted.verdicts.some(noGolden)) inconclusive('the art.halftone_pop and art.dot goldens are not recorded, so nothing can miss them (README: The goldens)');
    if (planted.verdicts.some((v) => v.verdict === 'INCONCLUSIVE')) inconclusive(`the goldens were recorded on another machine: ${show(planted.verdicts.map((v) => v.raw['changed']))}`);
    const failures = missed(planted.verdicts);
    failsNaming(failures, ['look art.halftone_pop 2d', 'look art.halftone_pop 3d'], 'the planted look drawing with art.dot\'s passes');
    expect(failures.filter((f) => !f.startsWith('look art.halftone_pop')), 'only the planted look misses its goldens').toEqual([]);
  }, TIMEOUT);
});
