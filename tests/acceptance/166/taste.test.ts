// #166.ad7d1fa8: "Shown to you: screenshots of the lake fixture with waves and the mirror's ripples, rain rings, and foam
// with a boat's wake, taken by the check run from the renderer's own output, with a recording of the lake with rain and
// the boat's wake, are attached to the PR and shown to you in the session. Whether they look right is one taste call,
// recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it"
//
// Four files, from this run's `view3d` frames under a filmic look, all of helpers.ts's `harbour` (a lake reflecting a red
// post and two crates under a day sky and a sun): `lake.png`, the lake with LAKE_WAVES and ripples at 0.3, at 1 s, 1280 ×
// 720, the renderer's final PNG byte for byte; `rain.png`, the same lake in rain at 50 drops per m² per s; `foam-wake.png`,
// the lake with STEEP_WAVES, foam at 0.6 and a wake behind the boat crossing it, at 12 s; and `rain-wake.apng`, the lake
// in rain with the boat's wake, 90 frames from 9 s at 30 fps and 640 × 360, the renderer's final frames as an animated
// PNG. They are kept in DEEPBUILD_EVIDENCE_DIR (else a folder under $TMPDIR), their paths printed for the PR and the
// session. The taste call is a file you record, named by DEEPBUILD_TASTE_166: {"criterion": "#166.ad7d1fa8", "by":
// "you", "screenshots": [sha256 × 4], "call": "looks_right" | "looks_wrong"}. With no record, or one made on other
// files, the test fails as INCONCLUSIVE; looks_wrong fails it. No other test in this suite reads a picture to judge it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FILMIC, LAKE_WAVES, STEEP_WAVES, decodePng, encodeApng, evidenceDir, frameAt, framesOf, harbour, inconclusive, readNamed, requireGpu, runGpu,
  sha256, useGpu, useOut, view3d, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SHOT: [number, number] = [1280, 720];
const REC: [number, number] = [640, 360];

describe(`${AC[10]} one taste call on the renderer's own screenshots and recording`, () => {
  it(`${AC[10]} the lake with waves and the mirror's ripples, rain rings, foam with a boat's wake, and the recording, from the renderer's own frames, and the recorded taste call says they look right`, () => {
    requireGpu();
    const dir = out();
    const shot = (name: string, doc: ReturnType<typeof harbour>, n: number) =>
      view3d({ doc: writeJson(dir, name, doc), look: FILMIC, size: SHOT, from: n, frames: 1, fps: 30, capture: [n], targets: ['final'] });
    const [lakeShot, rainShot, foamShot, rec] = runGpu(bin(), dir, [
      shot('lake', harbour('lake', SHOT, { waves: LAKE_WAVES, ripples: { strength: 0.3 } }), 30),
      shot('rain', harbour('rain', SHOT, { waves: LAKE_WAVES, ripples: { strength: 0.3 }, rain: 50 }), 30),
      shot('foam', harbour('foam', SHOT, { waves: STEEP_WAVES, foam: { threshold: 0.6 }, wake: { item: 'boat', span: 8 } }, { boat: true }), 360),
      view3d({
        doc: writeJson(dir, 'rec', harbour('rain-wake', REC, { waves: LAKE_WAVES, rain: 50, foam: { threshold: 0.6 }, wake: { item: 'boat', span: 8 } }, { boat: true })),
        look: FILMIC, size: REC, from: 270, frames: 90, fps: 30, capture: 'every', targets: ['final'],
      }),
    ]);
    const keep = evidenceDir();
    const kept = (name: string, bytes: Buffer): string => {
      const hash = sha256(bytes); const [base, ext] = name.split('.') as [string, string];
      const file = join(keep, `${base}-${hash}.${ext}`);
      writeFileSync(file, bytes);
      console.log(`for the taste call: ${file}`);
      return hash;
    };
    const final = (r: typeof lakeShot, n: number, what: string) => readNamed(dir, frameAt(framesOf(r!, what), n, what).raw['final'], 'png', `${what}'s final PNG`);
    const frames = framesOf(rec!, 'the recording');
    expect(frames.length, 'the recording holds 90 frames').toBe(90);
    const screenshots = [
      kept('lake.png', final(lakeShot, 30, 'the lake')),
      kept('rain.png', final(rainShot, 30, 'the rain')),
      kept('foam-wake.png', final(foamShot, 360, 'the foam and wake')),
      kept('rain-wake.apng', encodeApng(frames.map((f) => decodePng(readNamed(dir, f.raw['final'], 'png', `the recording's frame ${f.frame}`))), 30)),
    ];
    const path = process.env['DEEPBUILD_TASTE_166'];
    if (!path || !existsSync(path)) inconclusive(`no taste call is recorded on these screenshots (${screenshots.join(', ')}); record yours in a file named by DEEPBUILD_TASTE_166`);
    const record = JSON.parse(readFileSync(path, 'utf8')) as { criterion?: string; by?: string; screenshots?: string[]; call?: string };
    const same = JSON.stringify([...(record.screenshots ?? [])].sort()) === JSON.stringify([...screenshots].sort());
    if (record.criterion !== AC[10] || record.by !== 'you' || !same) inconclusive(`the recorded taste call at ${path} isn't yours on these screenshots (${screenshots.join(', ')})`);
    expect(record.call, 'your taste call').toBe('looks_right');
  });
});
