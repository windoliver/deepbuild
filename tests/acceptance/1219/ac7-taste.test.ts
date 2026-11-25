// AC7 #1219.9c284fc3: "Shown to you: screenshots of a seven-bay hall with each roof type, and of the folded profile beside
// a straight one, taken by the check run from the app at the reference window, are attached to the PR and shown to you
// in the session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never
// PASS, and no criterion above reads a picture to judge it"
//
// The run draws six pictures with `deep-gpu run`'s `view3d` (the app's frame path for a 3D scene), each one frame's
// `final` target at the reference window, 3024 × 1964 px (1512 × 982 points at 2×), in a filmic look under a day sky
// and a shadowed sun (judges.ts `hallPicture`, `profilesPicture`): the whole seven-bay hall (frame, a bracket set on
// its column heads and one between, a folded roof with rising corners, timber and `roof_tiles` materials) under each
// of hip_ridge, hip_gable, overhang_gable, flush_gable and pyramid, and two hip_ridge halls seen from the end, one
// folded and one straight 14 m behind it. Once all six are drawn it writes the renderer's own PNG bytes to
// `docs/evidence/1219/`, prints each SHA-256, and then reads the recorded call, `tests/acceptance/1219/TASTE.json`:
// none, or one made on other pictures (another SHA-256), is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on
// exactly these pictures passes. A picture `view3d` refuses to draw fails the test before anything is written. No
// other test reads these pictures or the call, and this one reads no pixel.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REPO, drawn, hallPicture, inconclusive, judgesFailTheirPlants, profilesPicture, requireMetal, sha256, tasteOf, useBins, useFolders, type JsonObject, type JsonValue,
} from './helpers.ts';

/** The criterion's ID: `#1219.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = 'AC7 #1219.9c284fc3';
const bin = useBins(['deep-gpu']);
const folder = useFolders();
const SHOTS = join(REPO, 'docs', 'evidence', '1219');
const TASTE = join(REPO, 'tests', 'acceptance', '1219', 'TASTE.json');
/** The pictures, by the names TASTE.json records them under. */
const PICTURES: readonly (readonly [name: string, doc: () => JsonObject])[] = [
  ['hall-hip-ridge.png', () => hallPicture('hip_ridge')], ['hall-hip-gable.png', () => hallPicture('hip_gable')],
  ['hall-overhang-gable.png', () => hallPicture('overhang_gable')], ['hall-flush-gable.png', () => hallPicture('flush_gable')],
  ['hall-pyramid.png', () => hallPicture('pyramid')], ['folded-beside-straight.png', profilesPicture],
];

describe(`${ID} the screenshots and the one taste call on them`, () => {
  it(`${ID} the run writes a seven-bay hall with each roof type and the folded profile beside a straight one from the renderer at the reference window, and the recorded call on exactly those pictures says they look right`, () => {
    judgesFailTheirPlants();
    requireMetal();
    const pngs = PICTURES.map(([name, doc]) => [name, drawn(bin('deep-gpu'), folder(), name.replace(/\.png$/, ''), doc())] as const);
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    for (const [name, png] of pngs) {
      writeFileSync(join(SHOTS, name), png);
      hashes[name] = sha256(png);
    }
    const listed = PICTURES.map(([name]) => `  ${join('docs', 'evidence', '1219', name)}  ${hashes[name]}`).join('\n');
    console.log(`${ID}: screenshots written from this run's pixels:\n${listed}`);

    let call: JsonValue | undefined;
    if (existsSync(TASTE)) {
      try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    }
    const taste = tasteOf(call, hashes);
    if (taste.state !== 'looks_right') {
      if (taste.state === 'inconclusive') inconclusive(`${taste.why}: show the owner\n${listed}\nand record the answer in tests/acceptance/1219/TASTE.json (README: The taste call)`);
      return expect.fail(taste.why);
    }
    console.log(`${ID}: taste call recorded by ${taste.who} at ${taste.when}: looks right`);
  });
});
