// AC3 #177.ab6f72b4: An export, a render-back snapshot and a golden of the same revision are byte-identical with HDR
// output on or off.
//
// Two `deep-gpu run` processes over the same document (the lamps) and look. In each, a live view on the stub display
// (potential 4, current 4) first, with `hdr: "auto"` in one and `hdr: "off"` in the other; the first must present HDR,
// or the comparison proves nothing. Then, in the same process, the revision's export (view3d `class: "export"`), its
// render-back snapshot (`class: "render_back"`) and its golden (#380's `golden` with `oracle: "hash"`, which reports
// the snapshot's pixel hash beside the golden's). The golden is a checker blessed by you first, so each run's golden
// call compares and reports its own snapshot's pixels. Each of the three must be byte-identical across the two runs:
// the export's and the render-back's final PNG and pixel hash, and the golden snapshot's pixel hash. The wrong program
// draws them from the HDR surface while a view presents HDR.
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AC, SIZE, STUB, TIMEOUT, answered, encodeRgbaPng, frameAt, lampsDoc, obj, runGpu, str, useBuild, useDir, view3d, writeJson,
  type GpuPlant, type JsonObject,
} from './helpers.ts';

const bin = useBuild('gpu');
const dir = useDir();
const FIXTURE = 'lamps-177';

interface Outputs { hdr: string; export: [string | null, string | null]; renderBack: [string | null, string | null]; golden: string }

function session(out: string, store: string, doc: string, hdr: 'auto' | 'off', planted?: GpuPlant): Outputs {
  const replies = runGpu(bin(), out, [
    view3d({ doc, hdr, stub_display: STUB, frames: 2, capture: [1], targets: ['surface'] }),
    view3d({ doc, class: 'export', targets: ['final'] }),
    view3d({ doc, class: 'render_back', targets: ['final'] }),
    { call: 'golden', store, fixture: FIXTURE, oracle: 'hash', view3d: view3d({ doc }) },
  ], planted);
  const what = `hdr ${hdr}`;
  const live = frameAt(replies[0]!, 1, `${what}: the live view`);
  const ex = frameAt(replies[1]!, 0, `${what}: the export`);
  const rb = frameAt(replies[2]!, 0, `${what}: the render-back`);
  const g = answered(replies[3]!, `${what}: the golden`);
  const numbers = obj(g['numbers'], `${what}: the golden's numbers (it compared against the blessed checker): ${JSON.stringify(g).slice(0, 600)}`);
  return { hdr: live.hdr.state, export: [ex.final, ex.pixel_hash], renderBack: [rb.final, rb.pixel_hash], golden: str(numbers['pixels'], `${what}: the golden snapshot's pixel hash`) };
}

function both(planted?: GpuPlant): { on: Outputs; off: Outputs } {
  const root = dir();
  const store = join(root, 'goldens');
  const checker = new Uint8Array(SIZE[0] * SIZE[1] * 4);
  for (let i = 0; i < SIZE[0] * SIZE[1]; i++) { const v = ((i % SIZE[0]) >> 4) % 2 ^ (Math.floor(i / SIZE[0]) >> 4) % 2 ? 230 : 30; checker.set([v, v, v, 255], i * 4); }
  const png = join(root, 'checker.png');
  writeFileSync(png, encodeRgbaPng(SIZE[0], SIZE[1], checker));
  const outs = ['bless', 'on', 'off'].map((n) => { const d = join(root, n); mkdirSync(d); return d; });
  const [blessed] = runGpu(bin(), outs[0]!, [{ call: 'decide', store, via: 'you', decision: { bless: { fixture: FIXTURE, png } } }]);
  expect(blessed!['outcome'], `the checker is blessed as ${FIXTURE}'s golden by your decision: ${JSON.stringify(blessed)}`).toBe('decided');
  const doc = writeJson(root, 'lamps', lampsDoc(FIXTURE) as JsonObject);
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

describe(`${AC[3]} exports, render-back and goldens stay SDR with HDR output on`, () => {
  it(`${AC[3]} the export, the render-back snapshot and the golden of the lamps are byte-identical after a live view presented HDR and after one with hdr off`, () => {
    expect(problems(both())).toEqual([]);
  }, TIMEOUT);

  it(`${AC[3]} planted export_reads_hdr_surface (they draw from the HDR surface while a view presents HDR) fails, naming the output`, () => {
    const p = problems(both('export_reads_hdr_surface'));
    expect(p.some((s) => /^the (export|render-back snapshot|golden's snapshot) differs/.test(s)), `the check fails, naming an output: ${JSON.stringify(p)}`).toBe(true);
  }, TIMEOUT);
});
