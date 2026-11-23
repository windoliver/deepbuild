// AC6 #1488.0776f3d0: Shown to you: screenshots of a rotated phone photo and a rotated clip, taken by the check run from
// the fixture document, are attached to the PR and shown to you in the session. Whether they look right is one taste
// call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it.
//
// This test is the check run (README: The taste call). The fixture document is one board holding a phone photo (a
// scene stored on its side with EXIF orientation 6) and a phone clip (the same scene, a ball rising, stored on its side
// with the track turned a quarter clockwise). `deep-show run` presents it and `eval` draws it with `pixels`, the hub's
// canonical snapshot, at 0.1 s and 0.8 s, so the clip's ball is seen moving; the two pictures are written, as stored,
// to `docs/evidence/1488/`. Then it reads `tests/acceptance/1488/TASTE.json`: no call, or a call made on other pictures
// (another SHA-256), is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these pictures passes. It judges no
// picture.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fl, inconclusive, putEvidence, useBinary, useTemp } from '../499/video/helpers.ts';
import {
  AC, DOC, REPO, TASTE_CLIP, TASTE_PHOTO, answered, boardOf, clipItem, evalPixels, present, scenario, sha256, show, showRun, snapshotBytes,
  stillItem, tasteClip, tastePhoto, writeInto, type JsonObject, type JsonValue,
} from './helpers.ts';

const showBin = useBinary('deep-show');
const temp = useTemp('1488-taste');
const PICTURES = join(REPO, 'docs', 'evidence', '1488');
const TASTE = join(REPO, 'tests', 'acceptance', '1488', 'TASTE.json');
const SHOTS = [{ name: 'photo-and-clip-0.1s.png', t: fl(0.1) }, { name: 'photo-and-clip-0.8s.png', t: fl(0.8) }];

describe('AC6 #1488.0776f3d0 screenshots of the turned photo and clip, and the one taste call on them', () => {
  it('AC6 #1488.0776f3d0 the check run takes the screenshots from the fixture document; the recorded call on exactly them says they look right; with none the run is INCONCLUSIVE, never PASS', () => {
    const dir = temp();
    const photo = tastePhoto();
    const clipPath = join(dir, 'taste-clip.mp4');
    tasteClip(clipPath);
    const evidence = join(dir, 'evidence');
    const photoSha = putEvidence(evidence, photo);
    const clipSha = putEvidence(evidence, readFileSync(clipPath));
    // A 540 × 360 board: the photo (240 × 320 upright) and the clip (192 × 256 upright, drawn 240 × 320), side by side.
    const doc = boardOf('taste', [540, 360], [stillItem('photo', photoSha, [20, 20, 240, 320]), clipItem('clip', clipSha, [280, 20, 240, 320])], { photo: photoSha, clip: clipSha });
    const replies = answered(showRun(showBin(), scenario(evidence, [present(DOC.a, doc), ...SHOTS.map((s) => evalPixels(DOC.a, s.t))])), 'the fixture document drawn at 0.1 s and 0.8 s');
    expect(replies[0]!['outcome'], `the fixture document is presented: ${show(replies[0])}`).toBe('presented');
    const hashes: Record<string, string> = {};
    SHOTS.forEach((s, i) => {
      const bytes = snapshotBytes(evidence, replies[i + 1] as JsonObject, `eval at ${s.name}`);
      writeInto(PICTURES, s.name, bytes);
      hashes[s.name] = sha256(bytes);
    });
    const listed = SHOTS.map((s) => `  docs/evidence/1488/${s.name}  ${hashes[s.name]}`).join('\n');
    console.log(`${AC[6]}: the check run's screenshots (${TASTE_PHOTO.w} × ${TASTE_PHOTO.h} photo, ${TASTE_CLIP.w} × ${TASTE_CLIP.h} clip):\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: attach these to the PR, show them to the owner in the session\n${listed}\nand record the answer in tests/acceptance/1488/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(1488);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#1488.0776f3d0');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the two screenshots').toEqual(SHOTS.map((s) => s.name).sort());
    const other = SHOTS.filter((s) => recorded[s.name] !== hashes[s.name]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures: ${other.map((s) => `${s.name} recorded ${String(recorded[s.name])}, this run ${hashes[s.name]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${AC[6]}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, 3_600_000);
});
