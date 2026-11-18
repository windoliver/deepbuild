// AC7 #1381.63539ab9: "Shown to you: a long ridge shadow across a valley at sunset and valley occlusion on and off,
// taken by the check run from the fixture document, with a recording of the sun moving, are attached to the PR and shown
// to you in the session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE,
// never PASS, and no criterion above reads a picture to judge it"
//
// The run draws with `view3d` in the filmic look, from the renderer's own final target (README: The taste call), and
// writes to `docs/evidence/1381/`:
//   - `ridge-shadow-sunset.png`: the sunset of criteria 4 and 5 (the ridge plate, the valley seen from its south end,
//     cascades to 300 m) at 2.5 s, the sun at 5°, the ridge's shadow lying 1.1 km across the valley floor; 960 × 540;
//   - `valley-occlusion-on.png` and `valley-occlusion-off.png`: criterion 3's crater, a valley in the round, under a high
//     sun and a bright sky, with the plate's horizon and with it left out (README: Assumed surfaces 1); 960 × 540;
//   - `sun-moving.apng`: the sunset from 0 to 3 s, the sun sinking from 15° to 3°, 8 frames a second, 25 frames at
//     480 × 270;
// printing each one's SHA-256. So the call is made on pictures that show something, each still passes #1399's blank
// guard, the occlusion pair differ, and the recording's first and last frames differ. It then reads the recorded call,
// `tests/acceptance/1381/TASTE.json`: none, or one made on other pictures (another SHA-256), is INCONCLUSIVE;
// `looks_wrong` fails; `looks_right` on exactly these pictures passes. No other test reads these pictures or the call.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, REPO, blankReason, craterDoc, decodePng, encodeApng, encodePng, framesOf, inconclusive, lookOf, readNamed, requireMetal, ridgeDoc, runGpu,
  sha256, useGpu, useOut, writeJson, type Image, type JsonObject, type JsonValue, type Size,
} from './helpers.ts';

const ID = AC[7];
const NAME = `AC7 ${ID}`;
const bin = useGpu();
const out = useOut();
const SHOTS = join(REPO, 'docs', 'evidence', '1381');
const TASTE = join(REPO, 'tests', 'acceptance', '1381', 'TASTE.json');
const NAMES = ['ridge-shadow-sunset.png', 'valley-occlusion-on.png', 'valley-occlusion-off.png', 'sun-moving.apng'] as const;
const SHOT: Size = [960, 540];
const REC: Size = [480, 270];
const REC_FPS = 8;

/** The renderer's final target of each frame of `doc` drawn at `size`, `frames` frames from `from` at `fps`. */
function finals(doc: JsonObject, size: Size, what: string, from = 0, frames = 1, fps = REC_FPS): Image[] {
  const dir = out();
  const path = writeJson(dir, 'shot', doc);
  const [reply] = runGpu(bin(), dir, [{ call: 'view3d', doc: path, look: lookOf('filmic'), size: [...size], fps, from, frames, capture: 'every', targets: ['final'] }]);
  return framesOf(reply!, frames, what, from).map((f) => decodePng(readNamed(dir, f['final'], 'png', `${what}: frame ${String(f['frame'])}`)));
}

describe(`${NAME} the pictures, the recording and the one taste call on them`, () => {
  it(`${NAME} the run writes the ridge's shadow across the valley at sunset, the valley's occlusion on and off and the sun moving, and the recorded call on exactly those says they look right`, () => {
    requireMetal();
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    const keep = (name: string, bytes: Buffer): void => { writeFileSync(join(SHOTS, name), bytes); hashes[name] = sha256(bytes); };
    const still = (name: string, image: Image): void => {
      expect(blankReason(image), `${name} isn't blank by #1399's guard`).toBe('');
      keep(name, encodePng(image));
    };
    still('ridge-shadow-sunset.png', finals(ridgeDoc({ size: SHOT, sun: 'sunset', view: 'sunset', look: 'filmic' }), SHOT, 'the ridge\'s shadow at sunset', 25, 1, 10)[0]!);
    still('valley-occlusion-on.png', finals(craterDoc({ size: SHOT, look: 'filmic' }), SHOT, 'the valley with occlusion')[0]!);
    still('valley-occlusion-off.png', finals(craterDoc({ size: SHOT, look: 'filmic', horizon: false }), SHOT, 'the valley without occlusion')[0]!);
    expect(hashes['valley-occlusion-on.png'], 'the valley with occlusion and without it are other pictures').not.toBe(hashes['valley-occlusion-off.png']);
    const rec = finals(ridgeDoc({ size: REC, sun: 'sunset', view: 'sunset', look: 'filmic' }), REC, 'the sun moving', 0, 3 * REC_FPS + 1);
    expect(sha256(encodePng(rec[0]!)), 'the recording\'s first and last frames differ: the sun moves').not.toBe(sha256(encodePng(rec[rec.length - 1]!)));
    keep('sun-moving.apng', encodeApng(rec, REC_FPS));

    const listed = NAMES.map((n) => `  ${join('docs', 'evidence', '1381', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: pictures and recording written from this run's pixels:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/1381/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(1381);
    expect(c['criterion'], 'TASTE.json: criterion').toBe(ID);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the three pictures and the recording').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, 2 * 3_600_000);
});
