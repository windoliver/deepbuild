// AC7 #1992.b0119deb: Shown to you: screenshots of the linear fixture's panels at 8, 30 and 60 m, the off-axis pair,
// and the fogged and unfogged marks, taken by the check run from the renderer's own output, are attached to the PR and
// shown to you in the session. Whether they look right is one taste call, recorded; without it the run stays
// INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it.
//
// One run draws, with the fixtures the criteria use (helpers), each under `fog_curve: linear {near: 10, far: 50}`: the
// panels 8, 10, 30 and 60 m from the eye (AC1); the pair 30 m away, on the axis and 40° off it, from the camera
// looking along −Z (AC2); the marks with their default fog; and the marks with `fog: false` on the line, the point and
// the image (AC3). It copies each final target, the renderer's own PNG byte for byte, to `target/acceptance/1992/`,
// printing each SHA-256. It then reads `tests/acceptance/1992/TASTE.json`: none, or one made on other pictures
// (another SHA-256), is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these pictures passes. No other
// test reads these pictures or the call.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, LINEAR, MARKS_SIZE, PAIR_SIZE, PANELS_SIZE, REPO, idOf, inconclusive, marksDoc, only, pairDoc, panelsDoc, readNamed, requireMetal, runGpu, sha256,
  useBin, useDir, view3dCall, writeJson, writeWhitePng, type JsonValue,
} from './helpers.ts';

const ID = AC[7];
const bin = useBin();
const dir = useDir();
const SHOTS = join(REPO, 'target', 'acceptance', '1992');
const TASTE = join(REPO, 'tests', 'acceptance', '1992', 'TASTE.json');
const NAMES = ['panels-8-10-30-60m.png', 'off-axis-pair.png', 'marks-fogged.png', 'marks-unfogged.png'] as const;

describe(`${ID} the screenshots and the one taste call on them`, () => {
  it(`${ID} the run writes the linear fixture's panels, the off-axis pair, and the fogged and unfogged marks from the renderer's own output, and the owner's recorded call on exactly those says they look right`, () => {
    requireMetal();
    const out = dir();
    const image = writeWhitePng(out);
    const assets = { [image.sha]: image.path };
    const replies = runGpu(bin(), out, [
      view3dCall({ doc: writeJson(out, 'panels', panelsDoc(LINEAR.sky)), size: PANELS_SIZE, targets: ['final'] }),
      view3dCall({ doc: writeJson(out, 'pair', pairDoc(LINEAR.sky, false)), size: PAIR_SIZE, targets: ['final'] }),
      view3dCall({ doc: writeJson(out, 'marks-fogged', marksDoc(LINEAR.sky, image.sha)), size: MARKS_SIZE, targets: ['final'], assets }),
      view3dCall({ doc: writeJson(out, 'marks-unfogged', marksDoc(LINEAR.sky, image.sha, { fog: false })), size: MARKS_SIZE, targets: ['final'], assets }),
    ]);
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    NAMES.forEach((name, i) => {
      const bytes = readNamed(out, only(replies[i]!, name).final, 'png', name);
      writeFileSync(join(SHOTS, name), bytes); hashes[name] = sha256(bytes);
    });
    const listed = NAMES.map((n) => `  ${join('target', 'acceptance', '1992', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: screenshots written from this run's pixels:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/1992/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(1992);
    expect(c['criterion'], 'TASTE.json: criterion').toBe(idOf(7));
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the four screenshots').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, 1_800_000);
});
