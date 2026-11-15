// #524.b97ba86d: "Shown to you: screenshots of the rope bridge, the banner on its plate and the balloon cube, taken by
// the check run from the canvas's own frames, with a recording of each settling, are attached to the PR and shown to you
// in the session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never
// PASS, and no criterion above reads a picture to judge it"
//
// Three screenshots, each a `view3d` frame's final target as the canvas wrote it (#378's PNG, kept byte for byte), at
// 640 × 360 and 3 s (frame 180 at 60 fps): the rope bridge lab and the banner lab (their documents, README: The labs,
// the banner drawn on its plate by its skin) and the balloon cube (helpers.ts: cubeScene at 60 fps, the soft volume
// inflated to 1.2 on the ground). Three recordings, each the canvas's own final PNGs at 320 × 180 and 30 fps for the
// first 3 s, as the scene settles, put into one animated PNG unchanged (../252/helpers.ts: apng). They are kept in
// DEEPBUILD_EVIDENCE_DIR (else a folder under the temporary folder) and their paths printed, for the PR and the session.
// The taste call is a file you record, named by DEEPBUILD_TASTE_524: {"criterion": "#524.b97ba86d", "by": "you",
// "screenshots": [sha256 × 3], "recordings": [sha256 × 3], "call": "looks_right" | "looks_wrong"}. With no record, or one
// made on other files, the test fails as INCONCLUSIVE; looks_wrong fails it. No other test in this suite reads a picture.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, LOOK, TIMEOUT, apng, arr, cleanBuilds, cubeScene, evidenceDir, forGpu, gpu, inconclusive, labOf, num, obj, readPng, sha256, useTemp,
  type JsonObject,
} from './helpers.ts';

cleanBuilds();
const temp = useTemp();
const ID = CRITERIA[8];
const SHOT: [number, number] = [640, 360];
const REC: [number, number] = [320, 180];
const AT = 180;
const REC_FPS = 30;
const REC_FRAMES = 90;

describe(`${ID} one taste call on the canvas's own screenshots and recordings of the three soft scenes`, () => {
  it(`${ID} the rope bridge, the banner on its plate and the balloon cube, each a screenshot and a recording of its settling from the canvas's own frames, and the recorded taste call says they look right`, () => {
    const scenes: [string, JsonObject][] = [['rope-bridge', labOf('bridge').scene!], ['banner', labOf('banner').scene!], ['balloon-cube', cubeScene(60).scene!]];
    if (process.platform !== 'darwin') inconclusive(`the canvas draws its frames on macOS's Metal device; this is ${process.platform}`);
    const out = temp();
    const docs = scenes.map(([name, scene]) => { const p = join(out, `${name}.json`); writeFileSync(p, JSON.stringify(forGpu(scene, `${name}-524`))); return p; });
    const replies = gpu(out, docs.flatMap((doc) => [
      { call: 'view3d', look: LOOK, doc, size: SHOT, fps: 60, from: AT, frames: 1, capture: [AT], targets: ['final'] },
      { call: 'view3d', look: LOOK, doc, size: REC, fps: REC_FPS, from: 0, frames: REC_FRAMES, capture: 'every', targets: ['final'] },
    ]));
    const framesOf = (reply: JsonObject, what: string): JsonObject[] => {
      if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
      expect(reply['code'], `${what} is drawn, not refused: ${JSON.stringify(reply).slice(0, 800)}`).toBeUndefined();
      return arr(reply['frames'], `${what}: frames`).map((f, i) => obj(f, `${what}: frames[${i}]`));
    };
    const keep = evidenceDir();
    mkdirSync(keep, { recursive: true });
    const screenshots: string[] = [];
    const recordings: string[] = [];
    scenes.forEach(([name], k) => {
      const shot = framesOf(replies[2 * k]!, `${name}: the screenshot`).find((f) => f['frame'] === AT);
      expect(shot, `${name}: the screenshot's frame ${AT} is in the reply`).toBeDefined();
      const png = readPng(out, shot!['final'], `${name}: the screenshot`);
      const shotFile = join(keep, `${name}-${sha256(png)}.png`);
      writeFileSync(shotFile, png);
      screenshots.push(sha256(png));
      const frames = framesOf(replies[2 * k + 1]!, `${name}: the recording`);
      expect(frames.map((f) => num(f['frame'], `${name}: a recording frame`)), `${name}: the recording holds frames 0 to ${REC_FRAMES - 1}`).toEqual(Array.from({ length: REC_FRAMES }, (_, i) => i));
      const anim = apng(frames.map((f) => readPng(out, f['final'], `${name}: recording frame ${String(f['frame'])}`)), REC_FPS, `${name}: the recording`);
      const recFile = join(keep, `${name}-settling-${sha256(anim)}.apng`);
      writeFileSync(recFile, anim);
      recordings.push(sha256(anim));
      console.log(`for the taste call: ${shotFile}\nfor the taste call: ${recFile}`);
    });
    const path = process.env['DEEPBUILD_TASTE_524'];
    const files = `screenshots ${screenshots.join(', ')}; recordings ${recordings.join(', ')}`;
    if (!path || !existsSync(path)) inconclusive(`no taste call is recorded on these files (${files}); record yours in a file named by DEEPBUILD_TASTE_524`);
    const record = JSON.parse(readFileSync(path, 'utf8')) as { criterion?: string; by?: string; screenshots?: string[]; recordings?: string[]; call?: string };
    const same = (a: string[] | undefined, b: string[]): boolean => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...b].sort());
    if (record.criterion !== ID || record.by !== 'you' || !same(record.screenshots, screenshots) || !same(record.recordings, recordings)) {
      inconclusive(`the recorded taste call at ${path} isn't yours on these files (${files})`);
    }
    expect(record.call, 'your taste call').toBe('looks_right');
  }, TIMEOUT);
});
