// AC9 #431.6cd4c5b0: Shown to you: screenshots of the polar ring, the see-through card before its wall and the
// emission target brightening a sign, taken by the check run from the renderer's own output, are attached to the PR
// and shown to you in the session. Whether they look right is one taste call, recorded; without it the run stays
// INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it.
//
// One run draws, with the fixtures the criteria use (helpers): AC5's ring with sample_grad; AC7's card at lod 3 (the
// frosted form) before its striped wall and red pane; AC3's sign without and with the emission pass, so the
// brightening shows side by side, under the plain look at an exposure of 1/8 (the sign's linear 4 reads as 0.5 red,
// its 8 as full red, where at unit exposure both clip). It copies each `view3d` final target, the renderer's own PNG
// byte for byte, into DEEPBUILD_EVIDENCE_DIR (else $TMPDIR/deep-431-taste) and prints each path and SHA-256, for the PR
// and the session. The taste call is a file you record, named by DEEPBUILD_TASTE_431: {"criterion": "#431.6cd4c5b0",
// "by": "<who>", "screenshots": [sha256 × 4],
// "call": "looks_right" | "looks_wrong"}. With no record, or one made on other screenshots, the test fails as
// INCONCLUSIVE; looks_wrong fails it. No other test in this suite reads a picture to judge it.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, CARD, PLAIN_LOOK, RING, SHA, SIGN, cardDoc, checkerRgba, frameAt, inconclusive, readNamed, requireGpu, ringDoc, run, signDoc, useBin, useOut,
  view3dCall, writeJson, writePngAsset,
} from './helpers.ts';

const bin = useBin();
const out = useOut();
const CRITERION = '#431.6cd4c5b0';
/** The plain look at the exposure whose scale 1 ÷ (1.2 × 2^EV100) is 1/8. */
const EIGHTH = { ...PLAIN_LOOK, exposure: Math.log2(8 / 1.2) };

describe(`${AC[9]} one taste call on the renderer's own screenshots`, () => {
  it(`${AC[9]} the ring, the see-through card and the sign before and after the emission pass are taken from the renderer's output, and the recorded taste call says they look right`, () => {
    requireGpu();
    const dir = out();
    const tex = writePngAsset(dir, RING.tex[0], RING.tex[1], checkerRgba());
    const shots = [
      { name: 'polar-ring', call: view3dCall({ doc: writeJson(dir, 'ring.json', ringDoc('ring-431', tex.sha)), size: RING.size, targets: ['final'], assets: { [tex.sha]: tex.path } }) },
      { name: 'see-through-card', call: view3dCall({ doc: writeJson(dir, 'card.json', cardDoc('card-431', { lod: 3, card: 'blend' })), size: CARD.size, targets: ['final'] }) },
      { name: 'sign-without-emission-pass', call: view3dCall({ doc: writeJson(dir, 'sign0.json', signDoc('sign-431', false)), size: SIGN.size, targets: ['final'], look: EIGHTH }) },
      { name: 'sign-with-emission-pass', call: view3dCall({ doc: writeJson(dir, 'sign1.json', signDoc('sign-431', true)), size: SIGN.size, targets: ['final'], look: EIGHTH }) },
    ];
    const replies = run(bin(), dir, shots.map((s) => s.call));
    const keep = process.env['DEEPBUILD_EVIDENCE_DIR'] ?? join(tmpdir(), 'deep-431-taste');
    mkdirSync(keep, { recursive: true });
    const hashes = shots.map((s, i) => {
      const final = frameAt(replies[i]!, 0, s.name).final;
      expect(final, `${s.name}: the final target is written, named by its SHA-256`).toMatch(SHA);
      readNamed(dir, final, 'png', s.name);
      const kept = join(keep, `${s.name}-${final as string}.png`);
      copyFileSync(join(dir, `${final as string}.png`), kept);
      console.log(`${AC[9]}: screenshot for the taste call: ${kept}  ${final as string}`);
      return final as string;
    });
    const path = process.env['DEEPBUILD_TASTE_431'];
    if (!path || !existsSync(path)) inconclusive(`no taste call is recorded on these screenshots (${hashes.join(', ')}); record yours in a file named by DEEPBUILD_TASTE_431`);
    const record = JSON.parse(readFileSync(path, 'utf8')) as { criterion?: string; by?: string; screenshots?: string[]; call?: string };
    const same = JSON.stringify([...(record.screenshots ?? [])].sort()) === JSON.stringify([...hashes].sort());
    if (record.criterion !== CRITERION || typeof record.by !== 'string' || record.by === '' || !same) {
      inconclusive(`the taste call recorded at ${path} isn't one on these four screenshots (${hashes.join(', ')})`);
    }
    console.log(`${AC[9]}: the taste call by ${record.by}: ${record.call}`);
    expect(record.call, 'the recorded taste call').toBe('looks_right');
  }, 1_800_000);
});
