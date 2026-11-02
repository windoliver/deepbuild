// Criterion 5: Vello GPU draws only after its spike shows a second 2D handoff under 1 ms a frame; an alpha, luminance
// or feathered mask draws on it only once its mask layers do, and goldens and snapshots render with Vello CPU either
// way.
//
// `deep-gpu run`'s `vello_gpu` call answers the renderer, the spike record in force, whether Vello GPU is on and whether
// its mask layers draw; `layers` answers each writer layer's draw path (README). The test judges the record from its
// own frames (each run's p95 against 1 ms, the design's judge), never from the binary's word. A test-spike build reads
// a record from `--spike-record` instead of the shipped one: one over budget, one under, written here. The wrong
// program is `--planted ignores_spike`: Vello GPU on whatever the record says. Snapshots are #140's headless
// `snapshot` (`deep-gpu run --headless`); goldens are `raster`. The spike's own timing on the reference Mac is
// spike.test.ts. At the base there is no `vello_gpu` call, no test-spike feature and no planted program.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEEP_GPU, DEEP_GPU_SPIKE, LOOK, RENDER, answers, arr, drawLine, fixturePath, gateDoc, gpuReplies, isBlank, layersCall, lockedVersions, needsMac, obj,
  outPng, readDrawn, readLayers, spikeArgs, spikeRecord, spikeVerdict, str, useBuilds, useDir, within, type JsonObject,
} from './helpers.ts';

const builds = useBuilds([DEEP_GPU, DEEP_GPU_SPIKE, RENDER]);
const dir = useDir('deep-385-gate-');
const DRAWS = ['rounded', 'opacity', 'multistop'] as const;
const WAITS = ['alpha', 'luminance', 'feather'] as const;

/** The gate's calls: `vello_gpu`, then each case's layers with Vello GPU asked to draw it. */
const gateCalls = (): JsonObject[] => [{ call: 'vello_gpu' }, ...[...DRAWS, ...WAITS].map((k) => layersCall(gateDoc(k).doc, LOOK, ['gpu_layer']))];

/** What's wrong with a run's gate: `want` is whether the record's frames say Vello GPU may draw. */
function gateProblems(out: string, replies: JsonObject[], want: boolean): string[] {
  const p: string[] = [];
  const [vg, ...cases] = replies;
  const enabled = vg!['enabled'];
  if (enabled !== want) p.push(`Vello GPU is ${enabled ? 'on' : 'off'} though its spike record says ${want ? 'PASS' : 'not PASS'}`);
  if (vg!['mask_layers'] !== false) p.push(`Vello GPU ${lockedVersions('vello_gpu').join('/')} reports its mask layers ${JSON.stringify(vg!['mask_layers'])}; 0.3.0 refuses them as unimplemented`);
  for (const [i, k] of [...DRAWS, ...WAITS].entries()) {
    const { item } = gateDoc(k);
    const main = readLayers(out, cases[i]!, k).get('main');
    if (!main) { p.push(`${k}: no layer main in the reply`); continue; }
    const side = main.drawn.gpu_layer;
    const drawn = side !== undefined && 'image' in side;
    const shouldDraw = want && (DRAWS as readonly string[]).includes(k);
    if (shouldDraw) {
      if (main.path !== 'gpu_layer') p.push(`${k}: the live view's path is ${JSON.stringify(main.path)}, not gpu_layer, though Vello GPU is on`);
      if (!drawn) p.push(`${k}: Vello GPU refused to draw the layer: ${JSON.stringify(side)}`);
      else if (isBlank((side as { image: Parameters<typeof isBlank>[0] }).image)) p.push(`${k}: Vello GPU drew a blank layer`);
    } else {
      if (main.path === 'gpu_layer' || main.path === 'gpui') p.push(`${k}: the live view draws it on ${String(main.path)}${(WAITS as readonly string[]).includes(k) ? ' before Vello GPU\'s mask layers do' : ' though the spike did not pass'}`);
      else if (JSON.stringify(main.path) !== JSON.stringify({ ok: false, code: 'module_missing', path: `items/${item}` })) p.push(`${k}: the live view's refusal is ${JSON.stringify(main.path)}, not module_missing naming items/${item}`);
      if (drawn) p.push(`${k}: Vello GPU drew the layer when asked${(WAITS as readonly string[]).includes(k) ? ', before its mask layers do' : ', though the spike did not pass'}`);
    }
  }
  return p;
}

describe('C5 Vello GPU draws only after its spike passes, masks only once its mask layers do; goldens and snapshots stay Vello CPU', () => {
  it('C5 the shipped spike record is five runs of at least 300 frames of Vello GPU, judged here; Vello GPU is on exactly when it passes; alpha, luminance and feathered masks never draw on it', () => {
    needsMac();
    const out = dir();
    const replies = gpuReplies(builds.bin(DEEP_GPU), out, gateCalls());
    const vg = replies[0]!;
    expect(obj(vg['renderer'], 'vello_gpu: renderer'), 'the renderer is Vello GPU at the version Cargo.lock holds').toEqual({ name: 'vello_gpu', version: lockedVersions('vello_gpu')[0] });
    const record = obj(vg['spike'], 'vello_gpu: the spike record in force');
    expect(obj(record['renderer'], 'the record\'s renderer'), 'the spike measured Vello GPU at this version').toEqual({ name: 'vello_gpu', version: lockedVersions('vello_gpu')[0] });
    const judged = spikeVerdict(record, 'the shipped spike record');
    expect(judged.problems, 'the record holds five runs of at least 300 frames').toEqual([]);
    console.log(`the shipped spike's p95 handoff per run: ${judged.p95s.map((v) => v.toFixed(3)).join(', ')} ms → ${judged.verdict}`);
    expect(gateProblems(out, replies, judged.verdict === 'PASS'), 'the gate follows the record').toEqual([]);
    expect(judged.verdict, 'the spike shows the second 2D handoff under 1 ms a frame, so R2 draws on Vello GPU').toBe('PASS');
  }, 1_800_000);

  it('C5 with a record over budget Vello GPU is off and those layers are refused module_missing; with one under budget it draws them; the planted program that ignores the record fails', () => {
    needsMac();
    const d = dir();
    const overFile = join(d, 'over.json'); const underFile = join(d, 'under.json');
    writeFileSync(overFile, JSON.stringify(spikeRecord(1.4)));
    writeFileSync(underFile, JSON.stringify(spikeRecord(0.6)));
    expect(spikeVerdict(spikeRecord(1.4), 'over').verdict, 'the over-budget record is judged FAIL').toBe('FAIL');
    expect(spikeVerdict(spikeRecord(0.6), 'under').verdict, 'the under-budget record is judged PASS').toBe('PASS');
    const bin = builds.bin(DEEP_GPU_SPIKE);
    const runIn = (name: string, args: string[]): { out: string; replies: JsonObject[] } => {
      const out = join(d, name);
      mkdirSync(out);
      return { out, replies: gpuReplies(bin, out, gateCalls(), args) };
    };
    const over = runIn('over', spikeArgs(overFile));
    expect(gateProblems(over.out, over.replies, false), 'over budget: Vello GPU off').toEqual([]);
    const under = runIn('under', spikeArgs(underFile));
    expect(gateProblems(under.out, under.replies, true), 'under budget: Vello GPU on').toEqual([]);
    const planted = runIn('planted', [...spikeArgs(overFile), '--planted', 'ignores_spike']);
    const found = gateProblems(planted.out, planted.replies, false);
    expect(found.some((s) => /rounded: the live view draws it on gpu_layer though the spike did not pass/.test(s)), `the program that ignores the record fails, naming the layer it drew: ${JSON.stringify(found)}`).toBe(true);
  }, 1_800_000);

  it('C5 goldens and render-back snapshots of a layer Vello GPU can draw are Vello CPU\'s pixels, whether the spike passed or not', () => {
    needsMac();
    const d = dir();
    const scene = fixturePath('parity/gpu/vello-gate.scene');
    const doc = JSON.parse(readFileSync(fixturePath('parity/gpu/vello-gate/rounded.json'), 'utf8')) as JsonObject;
    const look = JSON.parse(readFileSync(fixturePath('parity/gpu/vello-gate/look.json'), 'utf8')) as JsonObject;
    const line = drawLine(d, doc, look);
    const golden = readDrawn(line, answers(builds.bin(RENDER), ['raster'], [line])[0]!, 'the golden');
    expect(golden.report['renderer'], 'the golden is Vello CPU, f32, scalar').toMatchObject({ name: 'vello_cpu', pipeline: 'f32', simd: 'scalar' });
    const [ref] = gpuReplies(builds.bin(DEEP_GPU), d, [layersCall(doc, look, ['vello_cpu'])]);
    const vello = readLayers(d, ref!, 'rounded').get('main')!.drawn.vello_cpu as { image: Parameters<typeof isBlank>[0] };
    expect(vello && 'image' in vello, 'Vello CPU drew the layer').toBe(true);
    for (const ms of [1.4, 0.6]) {
      const file = join(d, `record-${ms}.json`);
      writeFileSync(file, JSON.stringify(spikeRecord(ms)));
      const [snap] = gpuReplies(builds.bin(DEEP_GPU_SPIKE), d, [{ call: 'snapshot', scene, case: 'rounded' }], ['--headless', ...spikeArgs(file)]);
      const record = obj(snap!['record'], `the snapshot (spike ${ms} ms)`);
      const layers = arr(record['layers'], 'the snapshot\'s layers').map((v) => obj(v, 'layer'));
      expect(layers.map((l) => l['layer']), 'the snapshot has the layer main').toEqual(['main']);
      const image = outPng(d, str(layers[0]!['png'], 'png'), `the snapshot's layer (spike ${ms} ms)`);
      const same = within(image, vello.image, 0);
      expect(same.share, `the snapshot's layer is Vello CPU's pixels with the spike at ${ms} ms; first difference (${same.worst?.x}, ${same.worst?.y})`).toBe(1);
    }
  }, 1_800_000);
});
