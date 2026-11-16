// AC3 #177.ab6f72b4 (blind redraft): An export, a render-back snapshot and a golden of the same revision are
// byte-identical with HDR output on or off.
//
// As the first draft (tests/acceptance/177/ac3-sdr-outputs.test.ts), with fixtures the golden's blank guard counts on
// (DISPUTE.md). Two `deep-gpu run` processes over the same document and look. In each, a live view on the stub display
// (potential 4, current 4) first, `hdr: "auto"` in one and `hdr: "off"` in the other; the first must present HDR, or
// nothing was compared. Then, in the same process, the revision's export (view3d `class: "export"`), its render-back
// snapshot (`class: "render_back"`) and its golden (#380's `golden`, `oracle: "hash"`, which reports the snapshot's
// pixel hash as `numbers.pixels`). The golden is a gradient blessed by you first, the view's size, so each run's
// golden compares and reports its own snapshot. Each of the three is byte-identical across the two runs. The
// document is the shaded ball: a lit sphere's smooth shading (hundreds of colors over a quarter of the frame) beside a
// lamp at 8 times paper white and a highlight at 2, so the snapshot passes the blank guard and an HDR frame differs
// from the SDR one. The wrong program, `export_reads_hdr_surface`, draws the three from the HDR surface while a view
// presents HDR, and fails naming an output.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ball, box, material, readNamed, sun } from '../424/helpers.ts';
import {
  AC, DARK_SKY, LOOK, SIZE, STUB, TIMEOUT, answered, decodePng, encodeRgbaPng, frameAt, obj, ortho, runGpu, sessionDoc, str, useBuild, useDir,
  view3d, writeJson, type GpuPlant, type Image, type JsonObject,
} from '../177/helpers.ts';

const bin = useBuild('gpu');
const dir = useDir();
const FIXTURE = 'shaded-ball-177';

/**
 * `blank` in crates/deep-gpu-layer/src/golden.rs at the base (#1399), ported to say why: dark (98% of the pixels at
 * Rec. 709 luma 0.06 or under), or flat (under 32 distinct RGBA colors, or under 5% of the pixels off the modal color).
 */
function blankWhy(img: Image): string | null {
  const total = img.width * img.height;
  let dark = 0;
  const counts = new Map<number, number>();
  for (let i = 0; i < total; i++) {
    const [r, g, b, a] = [img.rgba[i * 4]!, img.rgba[i * 4 + 1]!, img.rgba[i * 4 + 2]!, img.rgba[i * 4 + 3]!];
    if ((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 <= 0.06) dark++;
    const k = ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const modal = Math.max(0, ...counts.values());
  if (dark >= 0.98 * total) return `dark: ${dark} of ${total} pixels at luma 0.06 or under`;
  if (counts.size < 32) return `flat: ${counts.size} distinct colors, under 32`;
  if (total - modal < 0.05 * total) return `flat: ${total - modal} of ${total} pixels off the modal color, under 5%`;
  return null;
}

/** The golden blessed first: a gradient the view's size, red across, green down, blue 96. */
function gradient(): Uint8Array {
  const px = new Uint8Array(SIZE[0] * SIZE[1] * 4);
  for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++)
    px.set([Math.round((255 * x) / (SIZE[0] - 1)), Math.round((255 * y) / (SIZE[1] - 1)), 96, 255], (y * SIZE[0] + x) * 4);
  return px;
}

/**
 * The shaded ball (480 × 240, orthographic, 40 px per m, a black sky with no ambient): a 2.4 m-radius sphere at the
 * centre, base color 0.8, roughness 1, front-lit by a sun of π lx along −Z, so its shading falls off smoothly from 0.8
 * at its centre (about 29,000 px, a quarter of the frame); a 1.6 m lamp of emission 8 at x −4.6 m and a 1.6 m
 * highlight of emission 2 at x 4.6 m.
 */
function shadedBallDoc(): JsonObject {
  const glow = (s: number): JsonObject => material({ base_color: [0, 0, 0, 1], emission: [1, 1, 1], emission_strength: s });
  return sessionDoc(FIXTURE, SIZE, {
    cam: ortho([0, 0, 0], 12), sky: DARK_SKY,
    ball_mat: material({ base_color: [0.8, 0.8, 0.8, 1], roughness: 1 }), lamp_mat: glow(8), hi_mat: glow(2),
    ball: ball(2.4, [0, 0, 0], 'ball_mat'),
    lamp: box([1.6, 1.6, 0.1], [-4.6, 0, 0], { material: 'lamp_mat' }),
    highlight: box([1.6, 1.6, 0.1], [4.6, 0, 0], { material: 'hi_mat' }),
    key: sun(Math.PI, [0, 0, 0], false),
  });
}

interface Outputs { hdr: string; export: [string | null, string | null]; renderBack: [string | null, string | null]; golden: string }

function session(out: string, store: string, doc: string, hdr: 'auto' | 'off', planted?: GpuPlant): Outputs {
  const replies = runGpu(bin(), out, [
    view3d({ doc, look: LOOK, hdr, stub_display: STUB, frames: 2, capture: [1], targets: ['surface'] }),
    view3d({ doc, look: LOOK, class: 'export', targets: ['final'] }),
    view3d({ doc, look: LOOK, class: 'render_back', targets: ['final'] }),
    { call: 'golden', store, fixture: FIXTURE, oracle: 'hash', view3d: view3d({ doc, look: LOOK }) },
  ], planted);
  const what = `hdr ${hdr}`;
  const live = frameAt(replies[0]!, 1, `${what}: the live view`);
  const ex = frameAt(replies[1]!, 0, `${what}: the export`);
  const rb = frameAt(replies[2]!, 0, `${what}: the render-back`);
  // The fixture: the revision's canonical frames are ones the golden's blank guard counts on.
  for (const [name, f] of [['export', ex], ['render-back', rb]] as const) {
    const why = blankWhy(decodePng(readNamed(out, f.final, 'png', `${what}: the ${name}'s final`)));
    expect(why, `the fixture: the ${name}'s frame passes the golden's blank guard (${why})`).toBeNull();
  }
  const g = answered(replies[3]!, `${what}: the golden`);
  expect(g['reason'], `${what}: the golden compared rather than refusing a blank frame: ${JSON.stringify(g).slice(0, 600)}`).not.toBe('blank');
  const numbers = obj(g['numbers'], `${what}: the golden's numbers (it compared against the blessed gradient): ${JSON.stringify(g).slice(0, 600)}`);
  return { hdr: live.hdr.state, export: [ex.final, ex.pixel_hash], renderBack: [rb.final, rb.pixel_hash], golden: str(numbers['pixels'], `${what}: the golden snapshot's pixel hash`) };
}

function both(planted?: GpuPlant): { on: Outputs; off: Outputs } {
  const root = dir();
  const store = join(root, 'goldens');
  const golden = gradient();
  const why = blankWhy({ width: SIZE[0], height: SIZE[1], rgba: golden, channels: 4 });
  expect(why, `the fixture: the blessed gradient passes the golden's blank guard (${why})`).toBeNull();
  const png = join(root, 'gradient.png');
  writeFileSync(png, encodeRgbaPng(SIZE[0], SIZE[1], golden));
  const outs = ['bless', 'on', 'off'].map((n) => { const d = join(root, n); mkdirSync(d); return d; });
  const [blessed] = runGpu(bin(), outs[0]!, [{ call: 'decide', store, via: 'you', decision: { bless: { fixture: FIXTURE, png } } }]);
  expect(blessed!['outcome'], `the gradient is blessed as ${FIXTURE}'s golden by your decision: ${JSON.stringify(blessed)}`).toBe('decided');
  const doc = writeJson(root, 'shaded-ball', shadedBallDoc());
  return { on: session(outs[1]!, store, doc, 'auto', planted), off: session(outs[2]!, store, doc, 'off', planted) };
}

function problems({ on, off }: { on: Outputs; off: Outputs }): string[] {
  const p: string[] = [];
  if (on.hdr !== 'on') p.push(`the live view with hdr auto on the stub display didn't present HDR (hdr.state ${on.hdr}), so nothing was compared with HDR on`);
  if (off.hdr !== 'off') p.push(`the live view with hdr off reports hdr.state ${off.hdr}`);
  if (on.export.some((v, i) => v === null || v !== off.export[i])) p.push(`the export differs with HDR on and off: final ${on.export[0]} / ${off.export[0]}, pixel hash ${on.export[1]} / ${off.export[1]}`);
  if (on.renderBack.some((v, i) => v === null || v !== off.renderBack[i])) p.push(`the render-back snapshot differs with HDR on and off: final ${on.renderBack[0]} / ${off.renderBack[0]}, pixel hash ${on.renderBack[1]} / ${off.renderBack[1]}`);
  if (on.golden !== off.golden) p.push(`the golden's snapshot differs with HDR on and off: pixels ${on.golden} / ${off.golden}`);
  return p;
}

describe(`${AC[3]} exports, render-back and goldens stay SDR with HDR output on (redraft)`, () => {
  it(`${AC[3]} the export, the render-back snapshot and the golden of the shaded ball are byte-identical after a live view presented HDR and after one with hdr off`, () => {
    expect(problems(both())).toEqual([]);
  }, TIMEOUT);

  it(`${AC[3]} planted export_reads_hdr_surface (they draw from the HDR surface while a view presents HDR) fails, naming the output`, () => {
    const p = problems(both('export_reads_hdr_surface'));
    expect(p.some((s) => /^the (export|render-back snapshot|golden's snapshot) differs/.test(s)), `the check fails, naming an output: ${JSON.stringify(p)}`).toBe(true);
  }, TIMEOUT);
});
