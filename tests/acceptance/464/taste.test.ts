// #464.d22bf5b7: "Shown to you: screenshots of the two offset separations, the print finishes, the vignette and grain,
// and the 320 × 180 indexed look with the puff, taken by the check run from the renderer's own output, are attached to
// the PR and shown to you in the session. Whether they look right is one taste call, recorded; without it the run stays
// INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it"
//
// Five screenshots, each a `film2d` frame's final PNG as the renderer wrote it, kept byte for byte: the two separations
// offset 3 px (separations.test.ts's print, 800 × 600); the print finishes, as a worn print (print wear with flicker,
// weave, scratches, dust, hair and a rounded gate, and a tone curve) and as a CRT (scanlines, the aperture mask,
// curvature 0.1), each 1280 × 720 over the same picture, at t = 1 s; the vignette and grain (vignette-grain.test.ts's
// vignette with grain at 4%, 1920 × 1080); and the 320 × 180 indexed look with the dithered puff (see-through.test.ts's,
// at scale 4). They are kept in DEEPBUILD_EVIDENCE_DIR (else a folder under $TMPDIR) and their paths printed, for the PR
// and the session. The taste call is a file you record, named by DEEPBUILD_TASTE_464: {"criterion": "#464.d22bf5b7",
// "by": "you", "screenshots": [sha256 × 5], "call": "looks_right" | "looks_wrong"}. With no record, or one made on other
// files, the test fails as INCONCLUSIVE; looks_wrong fails it. No other test in this suite reads a picture to judge it.
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, type JsonObject, circle, doc2d, evidenceDir, film2d, flat, frameAt, FRAME_SIZE, inconclusive, indexedLook, look2d, readNamed, rect, requireGpu, runGpu, sha256,
  tbox, useBins, useOut,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const out = useOut();

const SCENE = doc2d('scene-464', [1280, 720], [
  rect('sky', 'a0', [0, 0, 1280, 460], 'cyan'), circle('sun', 'a1', [940, 220], 110, 'ochre'),
  rect('field', 'a2', [0, 460, 1280, 260], 'moss'), rect('house', 'a3', [300, 300, 260, 220], 'rose'), rect('door', 'a4', [400, 410, 60, 110], 'ink'),
]);
const SCENE_COLORS = { cyan: '#28aae6', rose: '#e65a96', ochre: '#c98f2b', moss: '#5f7f3b' };

describe(`${AC[15]} one taste call on the renderer's own screenshots`, () => {
  it(`${AC[15]} the two offset separations, the print finishes, the vignette and grain, and the indexed look with the puff, from the renderer's own frames, and the recorded taste call says they look right`, () => {
    requireGpu();
    const shots: [string, JsonObject, number][] = [
      ['separations', film2d(
        doc2d('separations-464', [800, 600], [rect('cyan-sheet', 'a0', [200, 200, 300, 200], 'cyan'), rect('rose-sheet', 'a1', [350, 250, 300, 200], 'rose')]),
        look2d('separations-464', SCENE_COLORS, { separations: [
          { role: 'cyan', halftone: 'solid', offset: [0, 0], order: 0, overprint: 'multiply', anchor: 'plate' },
          { role: 'rose', halftone: 'solid', offset: [3, 0], order: 1, overprint: 'multiply', anchor: 'plate' },
        ] }), { frames: 1, capture: [0] }), 0],
      ['print-wear', film2d(SCENE, look2d('worn-464', SCENE_COLORS, { finish: [
        { print_wear: { flicker: '5%', weave: 1.5, scratches: { count: [1, 3], width: 2, life: 6 }, dust: { density: 0.3, size: 3 }, hair: 0.2, gate: { corner_radius: 40, softness: 8 }, rate: 24 } },
        { tone_curve: { black: 0.04, white: 0.96, contrast: 1.15, toe: 0.2, shoulder: 0.2 } },
      ] }), { fps: 24, frames: 25, capture: [24] }), 24],
      ['crt', film2d(SCENE, look2d('crt-464', SCENE_COLORS, { finish: [{ screen: { kind: 'crt', scanlines: 240, mask: 'aperture', curvature: 0.1 } }] }), { fps: 24, frames: 25, capture: [24] }), 24],
      ['vignette-grain', film2d(flat('white-464', [1920, 1080]), look2d('vignette-grain-464', {}, { finish: [
        { vignette: { color: 'ink', inner: 0.45, outer: 1, amount: 0.7, aspect: 'frame' } }, { grain: { amount: '4%', size: '1px', tone: 'flat', rate: 24 } },
      ] }), { frames: 1, capture: [0] }), 0],
      ['indexed-puff', film2d(doc2d('puff-464', FRAME_SIZE, [
        rect('wall', 'a0', tbox(40, 40, 100, 80), 'wall'), rect('shield', 'a1', tbox(96, 80, 16, 16), 'guard'),
        rect('puff', 'a2', tbox(48, 48, 64, 48), 'smoke', { adjust: { opacity: 0.5 } }),
      ]), indexedLook('puff-dither-464', { wall: '#2c3e7b', smoke: '#c8b4a0', guard: '#d9482b' }, ['wall', 'smoke', 'guard'], { protected: ['guard'], see_through: 'dither' }),
      { frames: 1, capture: [0] }), 0],
    ];
    const replies = runGpu(bins.bin('deep-gpu'), out(), shots.map(([, call]) => call));
    const keep = evidenceDir();
    const screenshots = shots.map(([name, , n], k) => {
      const f = frameAt(replies[k]!, n, name);
      const bytes = readNamed(out(), f.raw['final'], 'png', `${name}: the renderer's final PNG`);
      const hash = sha256(bytes);
      const file = join(keep, `${name}-${hash}.png`);
      copyFileSync(join(out(), `${hash}.png`), file);
      console.log(`for the taste call: ${file}`);
      return hash;
    });
    const path = process.env['DEEPBUILD_TASTE_464'];
    if (!path || !existsSync(path)) inconclusive(`no taste call is recorded on these screenshots (${screenshots.join(', ')}); record yours in a file named by DEEPBUILD_TASTE_464`);
    const record = JSON.parse(readFileSync(path, 'utf8')) as { criterion?: string; by?: string; screenshots?: string[]; call?: string };
    const same = JSON.stringify([...(record.screenshots ?? [])].sort()) === JSON.stringify([...screenshots].sort());
    if (record.criterion !== AC[15] || record.by !== 'you' || !same) inconclusive(`the recorded taste call at ${path} isn't yours on these screenshots (${screenshots.join(', ')})`);
    expect(record.call, 'your taste call').toBe('looks_right');
  });
});
