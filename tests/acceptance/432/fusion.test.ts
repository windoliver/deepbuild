// AC2 #432.e7e1c505: A fused chain's output matches the unfused chain within one 10-bit code value per channel on 99.9%
// of pixels on the same machine, since fusion drops the intermediate targets' rounding and WGSL lets the compiler
// reassociate and fuse; the meter still reports each operator's own cost, split from the pass's timestamps by declared
// shares and checked by calibration runs that give each operator its own pass.
//
// The fixture (helpers: `chainDoc`, `CHAIN`): a 480 × 240 view of 32 unlit boxes in seeded colors under the effects
// chain grain, vignette, tint and grade, four pixel-wise passes at full resolution declaring 0.1, 0.2, 0.3 and 0.4 ns a
// px. The unfused chain is the same document with `fuse: none` on every operator. On one machine (Metal), in one run:
// - `view3d` draws both and reads `pre_tone` (#418: the linear image after the effects chain, before tone mapping);
//   a pixel is off when any of R, G, B is more than one 10-bit code from the unfused value (1/1023 of max(1, |value|),
//   #429's reading); at most 0.1% of the 115,200 pixels (115) may be off.
// - `live` with `report: ["passes"]` (README: The surface under test) draws each: the fused chain is one pass listing
//   grain, vignette, tint and grade in that order with shares 0.1, 0.2, 0.3 and 0.4 (each its declared cost over their
//   sum), each operator's `ms` its share of the pass's timed span; the unfused chain is four passes of one operator
//   each; and the fused document under `calibration: true` runs each operator in its own pass too.
// Wrong programs: fusion that changes an operator's output (an intermediate rounded twice, a step dropped or reordered);
// no fusion (four passes in the fused run); a meter that reports the fused pass whole, or splits it evenly.
// Oracle (criterion 2): Blender's compositor pixel_nodes scenes check that runs of adjacent pixel nodes compiled into one
// operation match a reference; their idea, consecutive pixel-wise passes fused against unfused, is the fixture here, at
// our bound, not Blender's 0.016 on 1% of pixels. Blender's own scenes need Blender to run (README: The oracle page).
import { describe, expect, it } from 'vitest';
import {
  AC, CHAIN, WRITER, chainDoc, codes10, liveCall, liveReply, operatorPasses, payload, readF32Image, requireGpu, run, shown, useBin, useOut,
  view3dCall, view3dFrame, writeJson, type Live, type Pass,
} from './helpers.ts';

const bin = useBin();
const out = useOut();
const SHARES = CHAIN.costs.map((c) => c / CHAIN.costs.reduce((a, b) => a + b, 0));

/** The session's operator passes in the first frame it drew with any. */
function firstPasses(live: Live, session: string): Pass[] {
  const rows = operatorPasses(live, session);
  expect(rows.length, `${session} reports operator passes (report: passes): ${shown(live.raw['frames'])}`).toBeGreaterThan(0);
  return rows[0]!.passes;
}

describe(`${AC[2]} a fused chain matches the unfused one, and the meter still reports each operator's own cost`, () => {
  it(`${AC[2]} grain, vignette, tint and grade fused are within one 10-bit code of unfused on 99.9% of pixels; one fused pass is split by declared shares, four unfused passes and a calibration run give each operator its own`, () => {
    requireGpu();
    const dir = out();
    const fused = writeJson(dir, 'fused.json', chainDoc('chain-432', 'pixel_wise'));
    const unfused = writeJson(dir, 'unfused.json', chainDoc('chain-unfused-432', 'none'));
    const [a, b] = run(bin(), dir, [
      view3dCall({ doc: fused, size: CHAIN.size, targets: ['pre_tone'] }),
      view3dCall({ doc: unfused, size: CHAIN.size, targets: ['pre_tone'] }),
    ], { lane: 'gpu' });
    const f = readF32Image(dir, view3dFrame(a!, 0, 'the fused chain')['pre_tone'], CHAIN.size, 'the fused chain: pre_tone');
    const u = readF32Image(dir, view3dFrame(b!, 0, 'the unfused chain')['pre_tone'], CHAIN.size, 'the unfused chain: pre_tone');
    const off: string[] = [];
    let worst = 0;
    for (let y = 0; y < CHAIN.size[1]; y++) {
      for (let x = 0; x < CHAIN.size[0]; x++) {
        const p = f.at(x, y); const q = u.at(x, y);
        const d = Math.max(codes10(p[0], q[0]), codes10(p[1], q[1]), codes10(p[2], q[2]));
        worst = Math.max(worst, d);
        if (d > 1) off.push(`pixel (${x}, ${y}): fused (${p.slice(0, 3).map((v) => v.toFixed(5)).join(', ')}), unfused (${q.slice(0, 3).map((v) => v.toFixed(5)).join(', ')}), ${d.toFixed(2)} codes`);
      }
    }
    const total = CHAIN.size[0] * CHAIN.size[1];
    const allowed = Math.floor(total * 0.001);
    console.log(`${AC[2]}: ${off.length} of ${total} pixels more than one 10-bit code apart (allowed ${allowed}); worst ${worst.toFixed(2)} codes${off.length ? `; first: ${off[0]}` : ''}`);
    expect(off.length, `at most 0.1% of pixels more than one 10-bit code apart: ${off.slice(0, 5).join('; ')}`).toBeLessThanOrEqual(allowed);

    const sessions = (doc: string, session: string) => [{ session, writer: WRITER, doc, size: CHAIN.size }];
    const [lf, lu, lc] = run(bin(), dir, [
      liveCall({ frames: 2, fps: 30, report: ['passes'], sessions: sessions(writeJson(dir, 'fused-live.json', payload(chainDoc('chain-432', 'pixel_wise'))), 'fused') }),
      liveCall({ frames: 2, fps: 30, report: ['passes'], sessions: sessions(writeJson(dir, 'unfused-live.json', payload(chainDoc('chain-unfused-432', 'none'))), 'unfused') }),
      liveCall({ frames: 2, fps: 30, report: ['passes'], calibration: true, sessions: sessions(writeJson(dir, 'calibration-live.json', payload(chainDoc('chain-432', 'pixel_wise'))), 'calibration') }),
    ], { lane: 'gpu' });

    const fp = firstPasses(liveReply(lf!, 'the fused chain, live'), 'fused');
    expect(fp.map((p) => p.operators.map((o) => o.operator)), 'the fused chain runs as one pass of its four operators, in chain order').toEqual([CHAIN.ops]);
    const pass = fp[0]!;
    const span = (pass.end_ns - pass.start_ns) / 1e6;
    expect(span, 'the fused pass has a timed span').toBeGreaterThanOrEqual(0);
    pass.operators.forEach((o, k) => {
      expect(Math.abs(o.share - SHARES[k]!), `${o.operator}'s share is its declared cost over the pass's: ${SHARES[k]}, got ${o.share}`).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(o.ms - span * SHARES[k]!), `${o.operator}'s cost is its share of the pass's ${span} ms: ${span * SHARES[k]!}, got ${o.ms}`).toBeLessThanOrEqual(1e-6 + 1e-6 * span);
    });
    console.log(`${AC[2]}: the fused pass, ${span.toFixed(4)} ms, split ${pass.operators.map((o) => `${o.operator} ${o.ms.toFixed(4)} ms (${o.share})`).join(', ')}`);

    const up = firstPasses(liveReply(lu!, 'the unfused chain, live'), 'unfused');
    expect(up.map((p) => p.operators.map((o) => o.operator)), 'the unfused chain runs four passes of one operator each, in chain order').toEqual(CHAIN.ops.map((op) => [op]));
    up.forEach((p) => expect(Math.abs(p.operators[0]!.share - 1), `${p.operators[0]!.operator}: an operator alone in its pass has share 1`).toBeLessThanOrEqual(1e-6));
    const cp = firstPasses(liveReply(lc!, 'the fused chain in a calibration run'), 'calibration');
    expect(cp.map((p) => p.operators.map((o) => o.operator)), 'a calibration run gives each operator its own pass').toEqual(CHAIN.ops.map((op) => [op]));
    cp.forEach((p) => expect(p.operators[0]!.ms, `${p.operators[0]!.operator}: its own pass is timed`).toBeGreaterThanOrEqual(0));
  }, 1_800_000);
});
