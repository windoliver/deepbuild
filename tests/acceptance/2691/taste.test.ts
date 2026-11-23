// #2691.bf51397a: Shown to you: the castle's lake at internal scale 0.5 on the merge base and on the change, taken by
// the check run at the reference window, attached to the PR. Whether the coarser reflection looks right is one taste
// call, recorded; without it the run stays INCONCLUSIVE, never PASS.
//
// The shipped castle has no lake, so the picture is of helpers.ts's `castleLake`: packs/examples/castle.json with its
// look and its pack, standing in a mirror lake (README: Ambiguities, the castle's lake). One release `deep-gpu run` on
// this Mac's Metal GPU draws its first frame by `view3d` at the reference window's 3024 × 1964 px (1512 × 982 points
// at 2×) through a surface at internal scale 0.5, and the run writes two pictures to docs/evidence/2691/:
//   - lake-change.png: this run's final target, the renderer's own PNG byte for byte;
//   - lake-merge-base.png: the same call's picture on the merge base, fixtures/base/lake-merge-base.png, the file this
//     suite's run on the unchanged base kept (README: The merge base's readings); on another machine, INCONCLUSIVE.
// The change draws the lake's reflection from a quarter of the pixels, so its picture must differ from the merge
// base's; a run that draws the merge base's picture fails. It then reads tests/acceptance/2691/TASTE.json: none, or
// one made on other pictures, is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these two passes. No
// other test reads these pictures or the call. The run also keeps its picture and reading under target/acceptance/2691/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, KEPT, LAKE_FRAME, REFERENCE_WINDOW, REPO, by, castleLake, drewOf, frameAt, inconclusive, keep, mergeBase, mergeBaseFile, readNamed, requireMetal, runGpu,
  sha256, useOut, useRelease, view3d, writeJson, type JsonValue,
} from './helpers.ts';

const ID = AC[5];
const bin = useRelease();
const out = useOut();
const SHOTS = join(REPO, 'docs', 'evidence', '2691');
const TASTE = join(REPO, 'tests', 'acceptance', '2691', 'TASTE.json');
const NAMES = ['lake-merge-base.png', 'lake-change.png'] as const;

describe(`${ID} the castle's lake at internal scale 0.5, and the one taste call on it`, () => {
  it(`${ID} the run writes the castle's lake at 3024 × 1964 and internal scale 0.5 as the merge base draws it and as this checkout does, the two differ, and the owner's recorded call on exactly those says the coarser reflection looks right`, () => {
    requireMetal();
    const dir = out();
    const { doc, look, packs } = castleLake();
    const [reply] = runGpu(bin(), dir, [view3d({
      doc: writeJson(dir, 'castle-lake', doc), look, size: REFERENCE_WINDOW, packs, from: LAKE_FRAME, frames: 1, fps: 30, capture: [LAKE_FRAME], targets: ['final'], surface: { internal_scale: 0.5 },
    })]);
    const what = `the castle's lake at ${by(REFERENCE_WINDOW)} and internal scale 0.5`;
    const drew = drewOf(reply!, what);
    expect([drew.internal_scale, drew.size_px], `${what} drew through a ${by(REFERENCE_WINDOW)} surface at internal scale 0.5`).toEqual([0.5, REFERENCE_WINDOW]);
    const change = readNamed(dir, frameAt(reply!, LAKE_FRAME, what).raw['final'], 'png', `${what}: final`);
    mkdirSync(KEPT, { recursive: true });
    writeFileSync(join(KEPT, 'lake.png'), change);
    keep('lake', { file: 'lake.png', sha256: sha256(change), size_px: drew.size_px, internal_scale: drew.internal_scale, internal_px: drew.internal_px, mirror_px: drew.mirror_px, frame: LAKE_FRAME });

    // The merge base's picture of the same call, on this machine.
    const base = mergeBase('lake');
    const shots: Record<(typeof NAMES)[number], Buffer> = { 'lake-merge-base.png': mergeBaseFile('lake-merge-base.png', base['sha256']), 'lake-change.png': change };
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    for (const n of NAMES) { writeFileSync(join(SHOTS, n), shots[n]); hashes[n] = sha256(shots[n]); }
    const listed = NAMES.map((n) => `  docs/evidence/2691/${n}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: pictures written (the lake's mirror drew at ${drew.mirror_px ? by(drew.mirror_px) : 'a size the reply doesn\'t name'}):\n${listed}`);
    expect(hashes['lake-change.png'], 'the lake draws differently on the change than on the merge base: its reflection is coarser').not.toBe(hashes['lake-merge-base.png']);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: attach these to the PR, show them to the owner\n${listed}\nand record the answer in tests/acceptance/2691/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(2691);
    expect(c['criterion'], 'TASTE.json: criterion').toBe(ID);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded = c['screenshots'];
    expect(typeof recorded === 'object' && recorded !== null && !Array.isArray(recorded), 'TASTE.json: screenshots, by name').toBe(true);
    const r = recorded as Record<string, JsonValue>;
    expect(Object.keys(r).sort(), 'TASTE.json names the two pictures').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => r[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(r[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says the coarser reflection doesn't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: the coarser reflection looks right`);
  }, 1_800_000);
});
