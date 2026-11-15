// AC9: "Shown to you: screenshots of a screen in a part's faces, a second-camera inset, the projected heatmap on the
// terrain, a bottom-right overlay and the card anchored to the lamp, taken by the check run from the renderer's own
// output, with a recording of an inset staying masked while the part moves and is taken apart, are attached to the PR
// and shown to you in the session. Whether they look right is one taste call, recorded; without it the run stays
// INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it"
//
// One `deep-gpu run` draws, keeping each frame's final PNG byte for byte: the masked screen at 1.5 s, turned and taken
// apart (helpers.ts: screenDoc, frame 15 at 10 fps); the second-camera inset at 2 s (feedDoc, frame 20); the heatmap on
// the terrain from view A under the sun at 45° (terrainDoc); the film with its view overlay in the bottom-right quarter
// at 1.5 s (filmDoc, frame 3 at 2 fps); and the card over the sofa at the orbit's start (roomDoc, frame 0); and the
// recording: the masked screen's 40 frames at 10 fps put into one animated PNG unchanged (#449's apng). All six go to
// `docs/evidence/506/`, each with its SHA-256 printed. The test then reads `tests/acceptance/506/TASTE.json`: with none,
// or one made on other bytes, it is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these passes.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FEED, FEED_CAM, FILM, MASKED, MASKED_CAM, REPO, ROOM, SHA, TERRAIN_SIZE, TIMEOUT, ac, apng, cardImage, feedDoc, filmDoc, framesOf, inconclusive, look,
  readNamed, requireGpu, roomDoc, runGpu, screenDoc, sha256, show, terrainDoc, terrainMesh, useBins, useDir, view3d, writeBytes, writeJson, writeTerrain,
  type Frame, type JsonValue,
} from './helpers.ts';

const bin = useBins(['deep-gpu']);
const dir = useDir();
const SHOTS = join(REPO, 'docs', 'evidence', '506');
const TASTE = join(REPO, 'tests', 'acceptance', '506', 'TASTE.json');
const SCREENSHOTS = ['screen-inset.png', 'second-camera-inset.png', 'terrain-heatmap.png', 'overlay-view.png', 'lamp-card.png'] as const;
const RECORDINGS = ['masked-inset.apng'] as const;

describe(`${ac(9)} the screenshots and the recording, and the one taste call on them`, () => {
  it(`${ac(9)} the run writes a screen in a part's face, a second-camera inset, the heatmap on the terrain, a bottom-right overlay, the card on the lamp and a recording of the masked inset from the renderer's own frames, and the recorded call on exactly those says they look right`, () => {
    requireGpu();
    const out = dir();
    const terrain = writeTerrain(out, terrainMesh());
    const image = cardImage();
    const imageSha = sha256(image);
    const one = (fps: number, frame: number) => ({ fps, from: frame, frames: 1, capture: [frame] });
    const calls = [
      view3d({ doc: writeJson(out, 'screen', screenDoc()), look: look(), size: MASKED_CAM.size, fps: MASKED.fps, frames: MASKED.frames, capture: 'every' }),
      view3d({ doc: writeJson(out, 'feed', feedDoc()), look: look(), size: FEED_CAM.size, ...one(FEED.fps, 20) }),
      view3d({ doc: writeJson(out, 'terrain', terrainDoc(terrain.sha, { view: 0, sun: 45, heatmap: true })), look: look(), size: TERRAIN_SIZE, assets: { [terrain.sha]: terrain.path } }),
      view3d({ doc: writeJson(out, 'film', filmDoc()), look: look(), size: FILM.size, ...one(FILM.fps, 3) }),
      view3d({ doc: writeJson(out, 'room', roomDoc(imageSha, 'orbit')), look: look(), size: ROOM.size, ...one(10, 0), assets: { [imageSha]: writeBytes(out, `${imageSha}.png`, image) } }),
    ];
    const replies = runGpu(bin('deep-gpu'), out, calls);
    const png = (f: Frame | undefined, what: string): Buffer => {
      expect(f?.final, `${what}: the renderer's final PNG, named by its SHA-256`).toMatch(SHA);
      return readNamed(out, f!.final, 'png', what);
    };
    const screen = framesOf(replies[0]!, 'the masked screen');
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    const keep = (name: string, bytes: Buffer): void => { writeFileSync(join(SHOTS, name), bytes); hashes[name] = sha256(bytes); };
    keep('screen-inset.png', png(screen.find((f) => f.frame === 15), 'screen-inset.png'));
    SCREENSHOTS.slice(1).forEach((name, i) => keep(name, png(framesOf(replies[i + 1]!, name)[0], name)));
    keep('masked-inset.apng', apng(screen.map((f) => png(f, `masked-inset.apng: frame ${f.frame}`)), MASKED.fps, 'masked-inset.apng'));
    const listed = [...SCREENSHOTS, ...RECORDINGS].map((n) => `  ${join('docs', 'evidence', '506', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ac(9)}: written from this run's frames:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/506/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(506);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#506.58529d4d');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded = { ...(c['screenshots'] as Record<string, JsonValue> | undefined ?? {}), ...(c['recordings'] as Record<string, JsonValue> | undefined ?? {}) };
    expect(Object.keys(recorded).sort(), `TASTE.json names the five screenshots and the recording: ${show(recorded)}`).toEqual([...SCREENSHOTS, ...RECORDINGS].sort());
    const other = Object.keys(hashes).filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other bytes than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
  }, TIMEOUT);
});
