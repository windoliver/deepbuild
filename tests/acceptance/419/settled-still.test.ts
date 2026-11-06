// AC2 #419.a8380bef: A still exported with 16 samples per frame equals the live frame settled at rest, by pixel hash on
// the same machine, and no frame that reports settling is ever exported or compared.
//
// The still scene (helpers: `stillDoc`): a lit floor, a block turned 23° and a ball under a casting sun, nothing
// moving, at 320 × 240, with the look's samples {live: 1, export: 16, at_rest: settle}, Blackman-Harris 1.5 px. The
// export draws frames 0–2: each reports samples {drawn: 16, settling: false} and all three final targets are one hash
// E (offsets from the sample index alone, never the frame number). The same export at one sample per frame differs
// from E (the control: the 16 samples are drawn). The live view of the same document, 48 frames at rest: every frame
// reports samples; a frame reporting settling holds fewer than 16; it reaches {drawn: 16, settling: false} within the
// 48 frames, and from that frame on every frame reports it and has final-target hash E. Only that settled frame is
// compared, and no export frame reports settling.
// Wrong programs: the base (no export class or samples report; the look's export count isn't read); an export that
// jitters by frame number; a settle that never finishes, or one whose settled frame isn't the export's.
import { describe, expect, it } from 'vitest';
import { AC, STILL_SIZE, framesOf, look, requireMetal, runGpu, samplesOf, stillDoc, useDir, useGpu, view3dCall, writeJson } from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const LIVE_FRAMES = 48;
const settle = (exportN: number) => look({ live: 1, export: exportN, atRest: 'settle', filter: 'blackman_harris', filterPx: 1.5 });

describe(`${AC[2]} a 16-sample still equals the live frame settled at rest`, () => {
  it(`${AC[2]} the 16-sample export's final hash, the same at frames 0–2, is the hash of the live frame that settles at rest, and no compared or exported frame reports settling`, () => {
    requireMetal();
    const out = dir();
    const doc = writeJson(out, 'still', stillDoc(false));
    const [x16, x1, live] = runGpu(bin(), out, [
      view3dCall({ doc, look: settle(16), size: STILL_SIZE, class: 'export', frames: 3, targets: ['final'] }),
      view3dCall({ doc, look: settle(1), size: STILL_SIZE, class: 'export', frames: 1, targets: ['final'] }),
      view3dCall({ doc, look: settle(16), size: STILL_SIZE, class: 'live', frames: LIVE_FRAMES, targets: ['final'] }),
    ]).map((r, i) => framesOf(r, ['the 16-sample export', 'the 1-sample export', 'the live view'][i]!));
    expect(x16!.length, 'the export draws frames 0–2').toBe(3);
    for (const f of x16!) expect(samplesOf(f, 'the export'), `export frame ${f.frame} holds all 16 samples and isn't settling`).toEqual({ drawn: 16, settling: false });
    const e = x16![0]!.final;
    expect(x16!.map((f) => f.final), 'the export\'s frames 0–2 have one hash: offsets come from the sample index alone').toEqual([e, e, e]);
    expect(samplesOf(x1![0]!, 'the 1-sample export'), 'the 1-sample export holds one sample').toEqual({ drawn: 1, settling: false });
    expect(x1![0]!.final, 'the control: one sample per frame gives another picture').not.toBe(e);

    expect(live!.length, `the live view reports ${LIVE_FRAMES} frames`).toBe(LIVE_FRAMES);
    const s = live!.map((f) => samplesOf(f, 'the live view'));
    console.log(`${AC[2]}: live samples by frame: ${s.map((x) => `${x.drawn}${x.settling ? 's' : ''}`).join(' ')}`);
    for (const [i, x] of s.entries()) if (x.settling) expect(x.drawn, `live frame ${i} reports settling, so holds fewer than 16 samples`).toBeLessThan(16);
    const k = s.findIndex((x) => !x.settling && x.drawn === 16);
    expect(k, `the live view settles to 16 samples within ${LIVE_FRAMES} frames`).toBeGreaterThanOrEqual(0);
    expect(live![k]!.final, `the settled live frame ${k} equals the 16-sample export by hash`).toBe(e);
    for (let n = k; n < LIVE_FRAMES; n++) {
      expect(s[n], `live frame ${n}, after settling, stays settled`).toEqual({ drawn: 16, settling: false });
      expect(live![n]!.final, `live frame ${n}, after settling, keeps the export's hash`).toBe(e);
    }
  }, 1_800_000);
});
