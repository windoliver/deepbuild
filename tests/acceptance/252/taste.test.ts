// #252.b3fac129: "Shown to you: screenshots of the flock of 262,144 boids, live fire and a soft blob, taken by the
// check run from the canvas's own frames, with a recording of each stepping, are attached to the PR and shown to you
// in the session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never
// PASS, and no criterion above reads a picture to judge it"
//
// Three screenshots, each a `view3d` frame's final target as the canvas wrote it (#378's PNG, kept byte for byte):
// the flock at step 1,800 (helpers.ts: flockOps, 30 s in), the fire at step 240 (4 s in, its floor burning 60 cells
// either side of the middle; fireOps) and the blob at step 30 (0.5 s after its push; blobOps), each 512 × 512. Three
// recordings, each the canvas's own final PNGs at 256 × 256 and 30 fps put into one animated PNG unchanged
// (helpers.ts: apng): the flock stepping for 2 s from 30 s, the fire for 4 s from its start and the blob for 2 s from
// its push. They are kept in DEEPBUILD_EVIDENCE_DIR (else a temporary folder) and their paths printed, for the PR and
// the session. The taste call is a file you record, named by DEEPBUILD_TASTE_252: {"criterion": "#252.b3fac129",
// "by": "you", "screenshots": [sha256 × 3], "recordings": [sha256 × 3], "call": "looks_right" | "looks_wrong"}. With
// no record, or one made on other files, the test fails as INCONCLUSIVE; looks_wrong fails it. No other test in this
// suite reads a picture to judge it.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DEFAULT_RING, SHA, apng, blobOps, fireOps, flockOps, inconclusive, requireGpu, run, sceneDoc, sha256, useBin, useOut, view3dCall, view3dFrames, withEstimates,
  writeJson, type JsonObject,
} from './helpers.ts';

const bin = useBin();
const out = useOut();
const SHOT: [number, number] = [512, 512];
const REC: [number, number] = [256, 256];
const REC_FPS = 30;

describe(`${AC[4]} one taste call on the canvas's own screenshots and recordings`, () => {
  it(`${AC[4]} the flock of 262,144 boids, live fire and a soft blob, each a screenshot and a recording of its stepping from the canvas's own frames, and the recorded taste call says they look right`, () => {
    requireGpu();
    const dir = out();
    const doc = (name: string, ops: JsonObject[]): string => writeJson(dir, `${name}.json`, sceneDoc(`${name}-252`, withEstimates(bin(), dir, ops)));
    const fixtures = [
      { name: 'flock-262144', doc: doc('flock', flockOps(DEFAULT_RING)), shot: { fps: 60, from: 1800 }, rec: { from: 900, frames: 60 } },
      { name: 'fire', doc: doc('fire', fireOps()), shot: { fps: 60, from: 240 }, rec: { from: 0, frames: 120 } },
      { name: 'blob', doc: doc('blob', blobOps()), shot: { fps: 60, from: 30 }, rec: { from: 0, frames: 60 } },
    ];
    const calls = fixtures.flatMap((f) => [
      view3dCall({ doc: f.doc, size: SHOT, ...f.shot, frames: 1, capture: [f.shot.from], targets: ['final'] }),
      view3dCall({ doc: f.doc, size: REC, fps: REC_FPS, ...f.rec, capture: 'every', targets: ['final'] }),
    ]);
    const replies = run(bin(), dir, calls);
    const keep = process.env['DEEPBUILD_EVIDENCE_DIR'] ?? join(tmpdir(), 'deep-252-taste');
    mkdirSync(keep, { recursive: true });
    const png = (hash: string | null, what: string): Buffer => {
      expect(hash, `${what}: the canvas's final PNG, named by its SHA-256`).toMatch(SHA);
      const b = readFileSync(join(dir, `${hash!}.png`));
      expect(sha256(b), `${what}: the PNG's SHA-256 is its name`).toBe(hash);
      return b;
    };
    const screenshots: string[] = [];
    const recordings: string[] = [];
    fixtures.forEach((f, k) => {
      const shot = view3dFrames(replies[2 * k]!, `${f.name}: the screenshot`).find((x) => x.frame === f.shot.from);
      expect(shot, `${f.name}: the screenshot's frame ${f.shot.from} is in the reply`).toBeDefined();
      const shotFile = join(keep, `${f.name}-${shot!.final ?? 'none'}.png`);
      png(shot!.final, `${f.name}: the screenshot`);
      copyFileSync(join(dir, `${shot!.final!}.png`), shotFile);
      screenshots.push(shot!.final!);
      const frames = view3dFrames(replies[2 * k + 1]!, `${f.name}: the recording`);
      expect(frames.map((x) => x.frame), `${f.name}: the recording holds frames ${f.rec.from} to ${f.rec.from + f.rec.frames - 1}`).toEqual(Array.from({ length: f.rec.frames }, (_, i) => f.rec.from + i));
      const anim = apng(frames.map((x) => png(x.final, `${f.name}: recording frame ${x.frame}`)), REC_FPS, `${f.name}: the recording`);
      const recHash = sha256(anim);
      const recFile = join(keep, `${f.name}-stepping-${recHash}.apng`);
      writeFileSync(recFile, anim);
      recordings.push(recHash);
      console.log(`for the taste call: ${shotFile}\nfor the taste call: ${recFile}`);
    });
    const path = process.env['DEEPBUILD_TASTE_252'];
    const files = `screenshots ${screenshots.join(', ')}; recordings ${recordings.join(', ')}`;
    if (!path || !existsSync(path)) inconclusive(`no taste call is recorded on these files (${files}); record yours in a file named by DEEPBUILD_TASTE_252`);
    const record = JSON.parse(readFileSync(path, 'utf8')) as { criterion?: string; by?: string; screenshots?: string[]; recordings?: string[]; call?: string };
    const same = (a: string[] | undefined, b: string[]): boolean => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...b].sort());
    if (record.criterion !== AC[4] || record.by !== 'you' || !same(record.screenshots, screenshots) || !same(record.recordings, recordings)) {
      inconclusive(`the recorded taste call at ${path} isn't yours on these files (${files})`);
    }
    expect(record.call, 'your taste call').toBe('looks_right');
  }, 3_600_000);
});
