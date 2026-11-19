// AC10 #1634.186fabe5: Shown to you: a still and a 10 s orbit of the 512-lamp street, and the same street under the
// 32-light policy, taken by the check run from the canvas's own frames, are attached to the PR and shown to you in the
// session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and
// no criterion above reads a picture to judge it.
//
// Four files, from this run's `view3d` frames of the street under its orbiting camera (helpers: `STREET.orbit`, one
// turn in 10 s, 40 m off and 12° up) in a filmic look at EV100 1: `street-512.png`, the street of 512 fill lamps at
// 2.2 s, looking down its length, 1280 × 720, the canvas's final PNG byte for byte; `street-512-orbit.apng`, its
// whole orbit, 150 frames at 15 frames a second and 640 × 360, the canvas's final frames as an animated PNG; and
// `street-32.png` and `street-32-orbit.apng`, the same street, camera, look, times and sizes with `fill` left off every
// lamp, so the policy's 32 key lights shade it. They are kept in DEEPBUILD_EVIDENCE_DIR (else a folder under the
// temporary folder), each named with its SHA-256, and their paths printed for the PR and the session.
// This test judges no picture. The taste call is a file you record, named by DEEPBUILD_TASTE_1634:
// {"criterion": "#1634.186fabe5", "by": "you", "screenshots": [sha256 × 2], "recordings": [sha256 × 2],
// "call": "looks_right" | "looks_wrong"}. With no record, or one made on other files, the test fails as INCONCLUSIVE;
// looks_wrong fails it. No other test in this suite reads a picture to judge it or reads the call.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, decodePng, encodeApng, evidenceDir, frameAt, framesOf, inconclusive, look, requireMetal, runGpu, sha256, streetDoc, useDir, useGpu, view3dCall,
  writeJson, type Size,
} from './helpers.ts';

const ID = AC[10];
const CRITERION = ID.split(' ')[1]!;
const bin = useGpu();
const dir = useDir();
const LOOK = look('filmic', 1);
const SHOT: Size = [1280, 720];
const REC: Size = [640, 360];
const FPS = 15;
const FRAMES = 150;
const STILL = 33;

describe(`${ID} one taste call on the canvas's own still and orbit of the street, under 512 fill lamps and under the 32-light policy`, () => {
  it(`${ID} a still and a 10 s orbit of the 512-lamp street, and of the same street under the 32-light policy, from the canvas's own frames, and the recorded taste call says they look right`, () => {
    requireMetal();
    const out = dir();
    const streets = [{ name: 'street-512', fill: true }, { name: 'street-32', fill: false }];
    const replies = runGpu(bin(), out, streets.flatMap((s) => [
      view3dCall({ doc: writeJson(out, `${s.name}-still`, streetDoc(s.name, { camera: 'orbit', fill: s.fill, size: SHOT })), look: LOOK, size: SHOT, fps: FPS, from: STILL, frames: 1, targets: ['final'] }),
      view3dCall({ doc: writeJson(out, `${s.name}-orbit`, streetDoc(s.name, { camera: 'orbit', fill: s.fill, size: REC })), look: LOOK, size: REC, fps: FPS, frames: FRAMES, targets: ['final'] }),
    ]));
    const keep = evidenceDir();
    const kept = (name: string, bytes: Buffer): string => {
      const hash = sha256(bytes); const [base, ext] = name.split('.') as [string, string];
      const file = join(keep, `${base}-${hash}.${ext}`);
      writeFileSync(file, bytes);
      console.log(`for the taste call: ${file}`);
      return hash;
    };
    const screenshots: string[] = []; const recordings: string[] = [];
    streets.forEach((s, i) => {
      const still = frameAt(framesOf(out, replies[2 * i]!, SHOT, `${s.name}, the still`), STILL, `${s.name}, the still`);
      screenshots.push(kept(`${s.name}.png`, still.final!));
      const orbit = framesOf(out, replies[2 * i + 1]!, REC, `${s.name}, the orbit`);
      expect(orbit.length, `${s.name}: the orbit holds ${FRAMES} frames`).toBe(FRAMES);
      recordings.push(kept(`${s.name}-orbit.apng`, encodeApng(orbit.map((f) => decodePng(f.final!)), FPS)));
    });
    const path = process.env['DEEPBUILD_TASTE_1634'];
    const made = `screenshots ${screenshots.join(', ')}; recordings ${recordings.join(', ')}`;
    if (!path || !existsSync(path)) inconclusive(`no taste call is recorded on these files (${made}); record yours in a file named by DEEPBUILD_TASTE_1634`);
    const record = JSON.parse(readFileSync(path, 'utf8')) as { criterion?: string; by?: string; screenshots?: string[]; recordings?: string[]; call?: string };
    const same = (a: string[] | undefined, b: string[]): boolean => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...b].sort());
    if (record.criterion !== CRITERION || record.by !== 'you' || !same(record.screenshots, screenshots) || !same(record.recordings, recordings)) inconclusive(`the recorded taste call at ${path} isn't yours on these files (${made})`);
    expect(record.call, 'your taste call').toBe('looks_right');
  }, TIMEOUT);
});
