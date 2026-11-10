// #268.f8d9db3f: "Shown to you: screenshots of the pile in the 20 × 20 m plate with shore foam, the calm swell beside the
// quay and the water under the floating deck, taken by the check run from the renderer's own output, are attached to
// the PR and shown to you in the session. Whether they look right is one taste call, recorded; without it the run stays
// INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it"
//
// Three files, from this run's `view3d` frames under a filmic look at 1280 × 720, each the renderer's final PNG byte for
// byte: `pile-foam.png`, the pile fixture (helpers.ts `pileDoc`) with gentle waves and its shore foam (width 0.5,
// breakup 0.5) seen from 4 m up and 9 m off; `quay-calm.png`, the quay fixture (`quayDoc`) with two swells and `calm:
// {near: 0.25, far: 20}`, seen along the quay from above its end; `deck-shade.png`, the deck fixture (`deckDoc`) with
// shade 0.8, seen from just above the water so the water under the deck shows. They are kept in DEEPBUILD_EVIDENCE_DIR
// (else a folder under $TMPDIR), their paths printed for the PR and the session. The taste call is a file you record,
// named by DEEPBUILD_TASTE_268: {"criterion": "#268.f8d9db3f", "by": "you", "screenshots": [sha256 × 3], "call":
// "looks_right" | "looks_wrong"}. With no record, or one made on other files, the test fails as INCONCLUSIVE;
// looks_wrong fails it. No other test in this suite reads a picture to judge it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FILMIC, type JsonObject, PILE_SHORE, QUAY_WAVE, camera, deckDoc, evidenceDir, frameAt, framesOf, inconclusive, pileDoc, quayDoc, readNamed,
  requireGpu, runGpu, sha256, useGpu, useOut, view3d, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SHOT: [number, number] = [1280, 720];
const AT = 60;

describe(`${AC[7]} one taste call on the renderer's own screenshots`, () => {
  it(`${AC[7]} the pile with shore foam, the calm swell beside the quay and the water under the floating deck, from the renderer's own frames, and the recorded taste call says they look right`, () => {
    requireGpu();
    const dir = out();
    const shot = (name: string, doc: JsonObject) => view3d({ doc: writeJson(dir, name, doc), look: FILMIC, size: SHOT, from: AT, frames: 1, fps: 30, capture: [AT], targets: ['final'] });
    const gentle = [{ direction: 30, length: 6, amplitude: 0.05, steepness: 0.4 }, { direction: 120, length: 3.5, amplitude: 0.03, steepness: 0.4 }];
    const [pileShot, quayShot, deckShot] = runGpu(bin(), dir, [
      shot('pile', pileDoc('pile-taste', SHOT, camera([0, 4, 9], [0, 0, 0], 50), { waves: gentle, ripples: { strength: 0.3 }, foam: { threshold: 1 }, shore: { ...PILE_SHORE, foam: { width: 0.5, breakup: 0.5 } } })),
      shot('quay', quayDoc('quay-taste', SHOT, camera([-1, 4, 3.5], [14, 0, 0], 55), { near: 0.25, far: 20 }, [QUAY_WAVE, { direction: 70, length: 5, amplitude: 0.15, steepness: 0.3 }])),
      shot('deck', deckDoc('deck-taste', SHOT, camera([0, 0.35, 8], [0, 0.2, 0], 40), 0.8)),
    ]);
    const keep = evidenceDir();
    const kept = (name: string, bytes: Buffer): string => {
      const hash = sha256(bytes); const [base, ext] = name.split('.') as [string, string];
      const file = join(keep, `${base}-${hash}.${ext}`);
      writeFileSync(file, bytes);
      console.log(`for the taste call: ${file}`);
      return hash;
    };
    const final = (r: typeof pileShot, what: string) => readNamed(dir, frameAt(framesOf(r!, what), AT, what).raw['final'], 'png', `${what}'s final PNG`);
    const screenshots = [
      kept('pile-foam.png', final(pileShot, 'the pile with shore foam')),
      kept('quay-calm.png', final(quayShot, 'the calm swell beside the quay')),
      kept('deck-shade.png', final(deckShot, 'the water under the floating deck')),
    ];
    const path = process.env['DEEPBUILD_TASTE_268'];
    if (!path || !existsSync(path)) inconclusive(`no taste call is recorded on these screenshots (${screenshots.join(', ')}); record yours in a file named by DEEPBUILD_TASTE_268`);
    const record = JSON.parse(readFileSync(path, 'utf8')) as { criterion?: string; by?: string; screenshots?: string[]; call?: string };
    const same = JSON.stringify([...(record.screenshots ?? [])].sort()) === JSON.stringify([...screenshots].sort());
    if (record.criterion !== AC[7] || record.by !== 'you' || !same) inconclusive(`the recorded taste call at ${path} isn't yours on these screenshots (${screenshots.join(', ')})`);
    expect(record.call, 'your taste call').toBe('looks_right');
  });
});
