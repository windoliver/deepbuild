// #853.a7fb57f6: "Shown to you: screenshots of the sand pile at 5 s and particles bouncing off the moving floor,
// taken by the check run from the canvas's own frames, with a recording of the pour and the bounce, are attached to
// the PR and shown to you in the session. Whether they look right is one taste call, recorded; without it the run
// stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it"
//
// The check run draws, with `view3d` and each frame's final PNG kept byte for byte (#378's `final` target): the sand
// pile, the pour (helpers.ts: pourDoc) at 5 s, frame 300 at 60 frames a second, 640 × 360; the bounce, the lift
// (liftDoc) at frame 127, 0.117 s after its floor stops, when particles thrown off it at 1.2 m/s are near the top of
// their rise; and two recordings, each the canvas's own final PNGs at 320 × 180 and 30 frames a second put into one
// animated PNG unchanged (helpers.ts: apng): the pour's first 5 s (151 frames) and the lift from 0.5 s to 3 s (76
// frames), through the floor's rise and the bounce after it. Before a file is kept, each screenshot's frame must
// report the item's buffer at the step named (300; 127), so the pictures are of stepped particles, and each
// recording must hold more than one picture. The four files go to docs/evidence/853/, each listed with its SHA-256,
// for the PR and the session.
//
// Then the test reads tests/acceptance/853/TASTE.json (README: The taste call's files): none, or a call made on other
// files, fails `INCONCLUSIVE:`, never a pass; `looks_wrong` fails; `looks_right` on exactly these files passes. It
// judges no picture, and no other test of this suite reads one.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIFT, POUR_STEPS, tasteVerdict } from './judges.ts';
import {
  BEADS, CRITERIA, REPO, SAND, ac, apng, carriedOn, finalPng, frameAt, inconclusive, judgesHold, liftDoc, pourDoc, requireGpu, run, sha256, useBin, useOut, view3dCall,
  view3dFrames, writeJson, type JsonObject,
} from './helpers.ts';

const bin = useBin();
const out = useOut();
const EVIDENCE = join(REPO, 'docs', 'evidence', '853');
const TASTE = join(REPO, 'tests', 'acceptance', '853', 'TASTE.json');
const SHOT: [number, number] = [640, 360];
const REC: [number, number] = [320, 180];
const REC_FPS = 30;
/** The bounce's frame at 60 frames a second: 7 steps after the floor stops at step 120, near the top of a 1.2 m/s rise
 * (1.2 ÷ 9.81 = 0.122 s, 7.3 steps). */
const BOUNCE_AT = LIFT.stopsAt + 7;

describe(`${ac(6)} one taste call on the canvas's own screenshots and recordings`, () => {
  it(`${ac(6)} the check run takes screenshots of the sand pile at 5 s and of particles bouncing off the moving floor, and recordings of the pour and the bounce, from the canvas's own frames, and the recorded taste call on exactly those says they look right; with none the run is INCONCLUSIVE, never PASS`, () => {
    judgesHold();
    requireGpu();
    const dir = out();
    const scenes = [
      { shot: 'sand-pile-5s.png', recording: 'pour.apng', doc: writeJson(dir, 'pour.json', pourDoc()), key: SAND, at: POUR_STEPS.fiveSeconds, rec: { from: 0, frames: 151 } },
      { shot: 'bounce-off-moving-floor.png', recording: 'bounce.apng', doc: writeJson(dir, 'lift.json', liftDoc()), key: BEADS, at: BOUNCE_AT, rec: { from: 15, frames: 76 } },
    ];
    const calls = scenes.flatMap((s): JsonObject[] => [
      view3dCall({ doc: s.doc, size: SHOT, fps: 60, from: s.at, frames: 1, capture: [s.at], targets: ['final'] }),
      view3dCall({ doc: s.doc, size: REC, fps: REC_FPS, ...s.rec, capture: 'every', targets: ['final'] }),
    ]);
    const replies = run(bin(), dir, calls);
    const screenshots: Record<string, Buffer> = {};
    const recordings: Record<string, Buffer> = {};
    scenes.forEach((s, k) => {
      const shot = frameAt(view3dFrames(replies[2 * k]!, s.shot), s.at, s.shot);
      expect(carriedOn(shot, s.key, s.shot).step, `${s.shot}: its frame shows ${s.key} at step ${s.at}`).toBe(s.at);
      screenshots[s.shot] = finalPng(dir, shot, s.shot);
      const frames = view3dFrames(replies[2 * k + 1]!, s.recording);
      expect(frames.map((f) => f.frame), `${s.recording} holds frames ${s.rec.from} to ${s.rec.from + s.rec.frames - 1} at ${REC_FPS} frames a second`).toEqual(Array.from({ length: s.rec.frames }, (_, i) => s.rec.from + i));
      const last = frames[frames.length - 1]!;
      expect(carriedOn(last, s.key, s.recording).step, `${s.recording}: its last frame shows ${s.key} at step ${2 * last.frame}`).toBe(2 * last.frame);
      expect(new Set(frames.map((f) => f.final)).size, `${s.recording} holds more than one picture: the particles move`).toBeGreaterThan(1);
      recordings[s.recording] = apng(frames.map((f) => finalPng(dir, f, s.recording)), REC_FPS, s.recording);
    });
    expect(sha256(screenshots['sand-pile-5s.png']!), 'the two screenshots are two pictures').not.toBe(sha256(screenshots['bounce-off-moving-floor.png']!));

    // Kept for the PR and the session, each with its SHA-256.
    const all = { ...screenshots, ...recordings };
    const hashes = (set: Record<string, Buffer>): Record<string, string> => Object.fromEntries(Object.entries(set).map(([n, b]) => [n, sha256(b)]));
    mkdirSync(EVIDENCE, { recursive: true });
    for (const [n, b] of Object.entries(all)) {
      const path = join(EVIDENCE, n);
      if (!existsSync(path) || sha256(readFileSync(path)) !== sha256(b)) writeFileSync(path, b);
    }
    const listed = Object.entries(hashes(all)).map(([n, h]) => `  docs/evidence/853/${n}  ${h}`).join('\n');
    console.log(`${ac(6)}: the check run's pictures:\n${listed}`);

    let record: unknown = null;
    if (existsSync(TASTE)) {
      try { record = JSON.parse(readFileSync(TASTE, 'utf8')) as unknown; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    }
    const call = tasteVerdict(record, CRITERIA[6], { screenshots: hashes(screenshots), recordings: hashes(recordings) });
    if (call.verdict === 'INCONCLUSIVE') inconclusive(`${call.line}: attach these to the PR, show them to the owner\n${listed}\nand record the answer in tests/acceptance/853/TASTE.json (README: The taste call)`);
    expect(call.verdict, call.line).toBe('PASS');
    console.log(`${ac(6)}: ${call.line}`);
  }, 3_600_000);
});
