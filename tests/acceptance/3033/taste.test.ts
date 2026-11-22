// #3033.5c2dc7ad: "Shown to you: one still of a 1 km sea at 10 m/s beside the same plate with four waves, taken by the
// check run. Whether it reads as open water is one taste call, recorded; without it the run stays INCONCLUSIVE"
//
// Drawn on this machine's Metal GPU; without one the test reads BLOCKED, never PASS.
//
// The two pictures, from this run's `view3d` frames under a filmic look at 1280 × 720, each the renderer's final PNG
// byte for byte: `sea.png`, a plate 1 km × 1 km of 1,024 × 1,024 cells whose material carries `water: {waves: {sea:
// {wind: 10, direction: 90, spread: 30, seed: 3033}}}` and every other field its default, with a white tower standing
// in it 22 m high, under a day sky and a sun, seen at 20 s from 14 m up near one corner looking across the wind at the
// tower, 450 m off; and `four-waves.png`, the same plate, tower, camera and time with `waves: {wind: {speed: 10,
// direction: 90}}`, the four waves a wind picks. The still, `sea-beside-four-waves.png`, is the two side by side, the
// sea on the left, every pixel one of theirs. All three are kept in DEEPBUILD_EVIDENCE_DIR (else a folder under
// $TMPDIR), each named with its SHA-256, and their paths are printed for the PR and the session.
//
// Before anything is kept the run shows that the still is of a sea beside something else: the sea's receipt lists its
// wave table, and the two pictures differ.
//
// The taste call is a file the owner records (README: The taste call): tests/acceptance/3033/TASTE.json, or the file
// DEEPBUILD_TASTE_3033 names: {"criterion": "#3033.5c2dc7ad", "by": "you", "screenshots": [the SHA-256 of sea.png and
// of four-waves.png], "call": "looks_right" | "looks_wrong"}. With no record, or one made on other pictures, the test
// fails as INCONCLUSIVE; looks_wrong fails it. No other test in this suite reads a picture to judge it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FILMIC, REPO, type Sea, type Size, TOWER, type Wind, camera, decodePng, evidenceDir, finalOf, fourWaves, frameAt, framesOf, inconclusive, requireGpu, runGpu, sea,
  seaDoc, sha256, sideBySide, useGpu, useOut, view3d, waveTable, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SHOT: Size = [1280, 720];
const AT = 600;

describe(`${AC[7]} one taste call on the check run's still`, () => {
  it(`${AC[7]} the check run takes one still of a 1 km sea at 10 m/s beside the same plate with four waves, and the recorded taste call says it reads as open water`, () => {
    requireGpu();
    const dir = out();
    const shot = (name: string, waves: Sea | Wind) => view3d({
      doc: writeJson(dir, name, seaDoc(name, SHOT, camera([-330, 14, 300], [40, 0, -160], 50, 5000), waves, [1000, 1000], [1024, 1024], TOWER)),
      look: FILMIC, size: SHOT, from: AT, frames: 1, fps: 30, capture: [AT], targets: ['final'], receipt: true,
    });
    const [seaShot, fourShot] = runGpu(bin(), dir, [shot('sea-1km', sea(10)), shot('four-waves-1km', fourWaves(10))]);
    expect(waveTable(seaShot!, 'the 1 km sea at 10 m/s'), 'the still is of a sea: its receipt lists the sea\'s wave table, receipt.water.waves').not.toBeNull();
    const final = (r: typeof seaShot, what: string) => finalOf(dir, frameAt(framesOf(r!, what), AT, what), what);
    const [swell, four] = [final(seaShot, 'the 1 km sea at 10 m/s'), final(fourShot, 'the same plate with four waves')];
    expect(sha256(swell), 'the sea draws another picture than the same plate with four waves').not.toBe(sha256(four));

    const keep = evidenceDir();
    const kept = (name: string, bytes: Buffer): string => {
      const hash = sha256(bytes); const [base, ext] = name.split('.') as [string, string];
      const file = join(keep, `${base}-${hash}.${ext}`);
      writeFileSync(file, bytes);
      console.log(`for the taste call: ${file}`);
      return hash;
    };
    const screenshots = [kept('sea.png', swell), kept('four-waves.png', four)];
    kept('sea-beside-four-waves.png', sideBySide(decodePng(swell), decodePng(four)));

    const path = process.env['DEEPBUILD_TASTE_3033'] ?? join(REPO, 'tests', 'acceptance', '3033', 'TASTE.json');
    if (!existsSync(path)) inconclusive(`no taste call is recorded on this still's two pictures (${screenshots.join(', ')}); the owner's goes in tests/acceptance/3033/TASTE.json, or the file DEEPBUILD_TASTE_3033 names`);
    const record = JSON.parse(readFileSync(path, 'utf8')) as { criterion?: string; by?: string; screenshots?: string[]; call?: string };
    const same = JSON.stringify([...(record.screenshots ?? [])].sort()) === JSON.stringify([...screenshots].sort());
    if (record.criterion !== AC[7] || record.by !== 'you' || !same) inconclusive(`the recorded taste call at ${path} isn't yours on this still's two pictures (${screenshots.join(', ')})`);
    expect(record.call, 'your taste call: whether the still reads as open water').toBe('looks_right');
  });
});
