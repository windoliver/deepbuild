// #465.e3e14ecf: "Shown to you: screenshots of a lens flare with its ghosts and a planar mirror, including the mirror
// inside a mirror, taken by the check run from the renderer's own output, with a recording of the flare following its
// light, are attached to the PR and shown to you in the session. Whether they look right is one taste call, recorded;
// without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it"
//
// Three files, from this run's `view3d` frames under a filmic look: `flare.png`, the flare showcase (a night stage lit
// by a point light beyond a row of boxes, its flare with 6 ghosts, a halo, 4 streaks and a 6-bladed starburst) at
// 1280 × 720, the renderer's final PNG byte for byte; `mirror.png`, the two facing mirrors of mirror.test.ts (the front
// mirror showing the back one inside it) at 1280 × 720, byte for byte; and `flare-follows-light.apng`, the showcase with
// its light crossing the stage over 2 s, 60 frames at 30 fps and 640 × 360, the renderer's final frames as an animated
// PNG. They are kept in DEEPBUILD_EVIDENCE_DIR (else a folder under $TMPDIR), their paths printed for the PR and the
// session. The taste call is a file you record, named by DEEPBUILD_TASTE_465: {"criterion": "#465.e3e14ecf", "by":
// "you", "screenshots": [sha256 × 3], "call": "looks_right" | "looks_wrong"}. With no record, or one made on other
// files, the test fails as INCONCLUSIVE; looks_wrong fails it. No other test in this suite reads a picture to judge it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FILMIC, decodePng, encodeApng, evidenceDir, flareShowcase, frameAt, framesOf, inconclusive, mirrors, readNamed, requireGpu, runGpu, sha256,
  useGpu, useOut, view3d, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SHOT: [number, number] = [1280, 720];
const REC: [number, number] = [640, 360];

describe(`${AC[8]} one taste call on the renderer's own screenshots and recording`, () => {
  it(`${AC[8]} a lens flare with its ghosts, the planar mirror with a mirror inside it, and the flare following its light, from the renderer's own frames, and the recorded taste call says they look right`, () => {
    requireGpu();
    const dir = out();
    const [flareShot, mirrorShot, rec] = runGpu(bin(), dir, [
      view3d({ doc: writeJson(dir, 'flare', flareShowcase(SHOT, false)), look: FILMIC, size: SHOT, frames: 1, capture: [0], targets: ['final'] }),
      view3d({ doc: writeJson(dir, 'mirror', mirrors('both', SHOT)), look: FILMIC, size: SHOT, frames: 1, capture: [0], targets: ['final'] }),
      view3d({ doc: writeJson(dir, 'moving', flareShowcase(REC, true)), look: FILMIC, size: REC, frames: 60, fps: 30, capture: 'every', targets: ['final'] }),
    ]);
    const keep = evidenceDir();
    const kept = (name: string, bytes: Buffer): string => {
      const hash = sha256(bytes); const file = join(keep, `${name.replace(/\.(\w+)$/, '')}-${hash}.${name.split('.').at(-1)}`);
      writeFileSync(file, bytes);
      console.log(`for the taste call: ${file}`);
      return hash;
    };
    const frames = framesOf(rec!, 'the recording');
    expect(frames.length, 'the recording holds 60 frames').toBe(60);
    const screenshots = [
      kept('flare.png', readNamed(dir, frameAt(framesOf(flareShot!, 'the flare'), 0, 'the flare').raw['final'], 'png', 'the flare\'s final PNG')),
      kept('mirror.png', readNamed(dir, frameAt(framesOf(mirrorShot!, 'the mirrors'), 0, 'the mirrors').raw['final'], 'png', 'the mirrors\' final PNG')),
      kept('flare-follows-light.apng', encodeApng(frames.map((f) => decodePng(readNamed(dir, f.raw['final'], 'png', `the recording's frame ${f.frame}`))), 30)),
    ];
    const path = process.env['DEEPBUILD_TASTE_465'];
    if (!path || !existsSync(path)) inconclusive(`no taste call is recorded on these screenshots (${screenshots.join(', ')}); record yours in a file named by DEEPBUILD_TASTE_465`);
    const record = JSON.parse(readFileSync(path, 'utf8')) as { criterion?: string; by?: string; screenshots?: string[]; call?: string };
    const same = JSON.stringify([...(record.screenshots ?? [])].sort()) === JSON.stringify([...screenshots].sort());
    if (record.criterion !== AC[8] || record.by !== 'you' || !same) inconclusive(`the recorded taste call at ${path} isn't yours on these screenshots (${screenshots.join(', ')})`);
    expect(record.call, 'your taste call').toBe('looks_right');
  });
});
