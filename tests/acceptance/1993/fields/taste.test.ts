// #1993.c2ad7c76: "Shown to you: screenshots of the ring at step 100, the pattern at 10 s and the hanging cloth, taken
// by the check run from the canvas's own frames, with a recording of each stepping, are attached to the PR and shown
// to you in the session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE,
// never PASS, and no criterion above reads a picture to judge it"
//
// Three screenshots, each a `view3d` frame's final target as the canvas wrote it (#378's PNG, kept byte for byte),
// 512 × 512: the ring at step 100 (helpers.ts: ringOps; criterion 1's 128 × 128 grid at 60 steps a second, so frame
// 100 at 60 frames a second), the pattern at 10 s (patternOps; criterion 4's two 1,024 × 1,024 textures at 600 steps
// a second, so step 6,000) and the hanging cloth at step 600, 1 s after it is let go (clothOps and clothViewOps;
// criterion 5's cloth). Three recordings, each the canvas's own final PNGs at 256 × 256 put into one animated PNG
// unchanged (helpers.ts: apng): the ring stepping to step 150 at 30 frames a second, the pattern growing through its
// 10 s at 12 frames a second, and the cloth swinging for 2 s at 30 frames a second. Each screenshot's frame says the
// step it shows (#252's `carried`, for a carried texture as for carried storage), and each recording's frames aren't
// all one picture. They are kept in DEEPBUILD_EVIDENCE_DIR (else a temporary folder) and their paths printed, for the
// PR and the session. The taste call is a file you record, named by DEEPBUILD_TASTE_1993: {"criterion":
// "#1993.c2ad7c76", "by": "you", "screenshots": [sha256 × 3], "recordings": [sha256 × 3], "call": "looks_right" |
// "looks_wrong"}. With no record, or one made on other files, the test fails as INCONCLUSIVE; looks_wrong fails it.
// No other test in this part reads a picture to judge it.
//
// At the base (9550dc0f) a texture output's `carry` and a texture input's `step: previous` are read past, and a
// stepped operator that writes a texture doesn't run, so the ring's frame reports no carried `water.height`.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, CLOTH_RATE, PATTERN, SHA, WATER, apng, checks, clothOps, clothViewOps, inconclusive, patternOps, refusal, refusals, requireGpu, ringOps, run, sceneDoc, sha256,
  useBin, useOut, view3dCall, view3dFrames, withEstimates, writeJson, type JsonObject,
} from './helpers.ts';

const bin = useBin();
const out = useOut();
const SHOT: [number, number] = [512, 512];
const REC: [number, number] = [256, 256];

interface Fixture {
  name: string; ops: JsonObject[];
  /** The screenshot: the frame, at `fps`, that shows `step` of each carried output named. */
  shot: { fps: number; frame: number; step: number; carried: string[] };
  /** The recording: frames 0 to `frames` − 1 at `fps`. */
  rec: { fps: number; frames: number };
}
const FIXTURES: Fixture[] = [
  { name: 'ring', ops: ringOps(), shot: { fps: WATER.rate, frame: 100, step: 100, carried: ['water.height', 'water.rate'] }, rec: { fps: 30, frames: 76 } },
  {
    name: 'pattern', ops: patternOps(),
    shot: { fps: 60, frame: 60 * PATTERN.seconds, step: PATTERN.rate * PATTERN.seconds, carried: ['pattern_a.a', 'pattern_b.b'] }, rec: { fps: 12, frames: 12 * PATTERN.seconds + 1 },
  },
  { name: 'cloth', ops: [...clothOps(), ...clothViewOps()], shot: { fps: 60, frame: 60, step: CLOTH_RATE, carried: ['cloth.position', 'cloth.previous', 'cloth.pinned'] }, rec: { fps: 30, frames: 61 } },
];

describe(`${AC[8]} one taste call on the canvas's own screenshots and recordings`, () => {
  it(`${AC[8]} the ring at step 100, the pattern at 10 s and the hanging cloth, each a screenshot and a recording of its stepping from the canvas's own frames, and the recorded taste call says they look right`, () => {
    requireGpu();
    const dir = out();
    const docs = FIXTURES.map((f) => {
      const replies = checks(bin(), dir, f.ops);
      expect(refusals(f.ops, replies), `the ${f.name}'s operators check`).toEqual([]);
      return writeJson(dir, `${f.name}.json`, sceneDoc(`${f.name}-1993`, withEstimates(f.ops, replies)));
    });
    const calls = FIXTURES.flatMap((f, k) => [
      view3dCall({ doc: docs[k]!, size: SHOT, fps: f.shot.fps, from: f.shot.frame, frames: 1, capture: [f.shot.frame], targets: ['final'] }),
      view3dCall({ doc: docs[k]!, size: REC, fps: f.rec.fps, frames: f.rec.frames, capture: 'every', targets: ['final'] }),
    ]);
    const replies = run(bin(), dir, calls);
    const keep = process.env['DEEPBUILD_EVIDENCE_DIR'] ?? join(tmpdir(), 'deep-1993-taste');
    mkdirSync(keep, { recursive: true });
    const png = (hash: string | null, what: string): Buffer => {
      expect(hash, `${what}: the canvas's final PNG, named by its SHA-256`).toMatch(SHA);
      const b = readFileSync(join(dir, `${hash!}.png`));
      expect(sha256(b), `${what}: the PNG's SHA-256 is its name`).toBe(hash);
      return b;
    };
    const screenshots: string[] = [];
    const recordings: string[] = [];
    FIXTURES.forEach((f, k) => {
      const shot = view3dFrames(replies[2 * k]!, `${f.name}: the screenshot`).find((x) => x.frame === f.shot.frame);
      expect(shot, `${f.name}: the screenshot's frame ${f.shot.frame} is in the reply (${refusal(replies[2 * k]!)})`).toBeDefined();
      for (const key of f.shot.carried) expect(shot!.carried.get(key)?.step, `${f.name}: the screenshot's frame shows carried ${key} at step ${f.shot.step}`).toBe(f.shot.step);
      png(shot!.final, `${f.name}: the screenshot`);
      const shotFile = join(keep, `${f.name}-${shot!.final!}.png`);
      copyFileSync(join(dir, `${shot!.final!}.png`), shotFile);
      screenshots.push(shot!.final!);
      const frames = view3dFrames(replies[2 * k + 1]!, `${f.name}: the recording`);
      expect(frames.map((x) => x.frame), `${f.name}: the recording holds frames 0 to ${f.rec.frames - 1} (${refusal(replies[2 * k + 1]!)})`).toEqual(Array.from({ length: f.rec.frames }, (_, i) => i));
      const pictures = frames.map((x) => png(x.final, `${f.name}: recording frame ${x.frame}`));
      expect(new Set(frames.map((x) => x.final)).size, `${f.name}: the recording shows it stepping: its frames aren't all one picture`).toBeGreaterThan(1);
      const anim = apng(pictures, f.rec.fps);
      expect(anim, `${f.name}: the recording's frames are PNGs of one size and format`).not.toBeNull();
      const recHash = sha256(anim!);
      const recFile = join(keep, `${f.name}-stepping-${recHash}.apng`);
      writeFileSync(recFile, anim!);
      recordings.push(recHash);
      console.log(`for the taste call: ${shotFile}\nfor the taste call: ${recFile}`);
    });
    const path = process.env['DEEPBUILD_TASTE_1993'];
    const files = `screenshots ${screenshots.join(', ')}; recordings ${recordings.join(', ')}`;
    if (!path || !existsSync(path)) inconclusive(`no taste call is recorded on these files (${files}); record yours in a file named by DEEPBUILD_TASTE_1993`);
    const record = JSON.parse(readFileSync(path, 'utf8')) as { criterion?: string; by?: string; screenshots?: string[]; recordings?: string[]; call?: string };
    const same = (a: string[] | undefined, b: string[]): boolean => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...b].sort());
    if (record.criterion !== AC[8] || record.by !== 'you' || !same(record.screenshots, screenshots) || !same(record.recordings, recordings)) {
      inconclusive(`the recorded taste call at ${path} isn't yours on these files (${files})`);
    }
    expect(record.call, 'your taste call').toBe('looks_right');
  }, 3_600_000);
});
