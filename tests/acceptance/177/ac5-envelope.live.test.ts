// AC5 #177.3a1b9bb2: In the combined envelope (#99), with HDR output on the reference Mac's XDR display beside every
// other pass, the scene holds the envelope's totals and input still shows within 2 frames; and with no other HDR
// content on screen, auto turns HDR on and the current headroom reads above 1 within 1 s.
//
// Live, on a reference Mac with its XDR display (Mac15,7 or Mac17,10), on mains power, Low Power Mode off, the thermal
// state nominal (#1903's `offReference`), with DEEP_177_LIVE=1 and nothing else on screen showing HDR content:
// - The envelope: #1903's `envelope` call on this Mac's GPU (`deep-gpu run`, test-meter build, no stubs) with
//   `screen: "main"` (its window on the main display, full screen) and `hdr: "auto"`, over an every-pass scene of this
//   suite (an orbit camera, a casting sun, a lamp of emission 8 and a box the `nudge` toggle lifts, under a look with
//   agx, bloom and ambient occlusion), five 60 s runs with 1,000 seeded inputs each (#1903's rule). Its reply's `hdr`
//   says HDR was on through the timed runs with a current headroom above 1; the scene's frame time and GPU memory read
//   PASS against its class, and input on screen PASS within 2 frames.
// - Auto: `deep-app --hdr` (hdr-fixture build), the lamps in the app's real window with `hdr: "auto"` for 120 frames:
//   a frame within 1,000 ms of the view's first presented frame presents HDR with the display's current headroom above
//   1. The wrong program, `auto_waits_for_headroom`, turns HDR on only once the display's current headroom reads above
//   1, which with nothing else on screen asking for EDR it never does.
// A budget-class verdict of INCONCLUSIVE (the five-run rule) reads INCONCLUSIVE here, never PASS.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, ENVELOPE_LOOK, LOOK, TIMEOUT, XDR_MACS, answered, envelopeOf, fixtureRow, hwModel, inconclusive, lampsDoc, liveHdr, num, obj, offReference,
  requireLive, requireXdr, runGpu, seededTimes, str, useBuild, useDir, writeJson, type AppPlant, type JsonObject,
} from './helpers.ts';

const gpu = useBuild('gpu', true);
const app = useBuild('app');
const dir = useDir();

const NUDGE = 'nudge';
/** The every-pass scene as a writer sends it (#1903's form: no id, no layers), full screen, the showpiece class. */
function scene(pixels: [number, number]): JsonObject {
  const item = (id: string, order: string, rest: JsonObject): JsonObject => ({ id, name: id, order, ...rest });
  return {
    format: 1, profile: 'scene', title: 'The #177 envelope scene', description: 'Every pass on at once, with a lamp above paper white.',
    size: pixels, camera: 'cam', requires: { modules: { scene3d: '^1' } }, budget: { class: 'showpiece' }, transport: { span: '60s' },
    items: {
      cam: item('cam', 'a0', { kind: 'camera@1', params: { projection: 'perspective', target: [0, 0.5, 0], orbit: { azimuth: 30, elevation: 30, distance: 9 }, fov: 40 } }),
      floor: item('floor', 'b0', { kind: 'mark.box@1', params: { size: [12, 0.1, 12], paint: { fill: { role: 'muted' } } }, at: { pos: [0, -0.05, 0] } }),
      box: item('box', 'b1', { kind: 'mark.box@1', params: { size: [1, 1, 1], paint: { fill: { role: 'accent' } } }, at: { pos: [0, 0.5, 0] } }),
      lamp_mat: item('lamp_mat', 'b2', { kind: 'material@1', params: { base_color: [0, 0, 0, 1], emission: [1, 1, 1], emission_strength: 8 } }),
      lamp: item('lamp', 'b3', { kind: 'mark.box@1', params: { size: [0.5, 0.5, 0.5] }, material: 'lamp_mat', at: { pos: [1.5, 0.25, 0.5] } }),
      sun: item('sun', 'b4', { kind: 'light.sun@1', params: { illuminance: Math.PI, color: [1, 1, 1], shadow: true }, at: { rot: [-45, 30, 0] } }),
    },
    channels: { spin: { target: 'items/cam/params/orbit/azimuth', type: 'f32', keys: { k0: { t: '0s', value: 30, interp: 'linear' }, k1: { t: '60s', value: 390, interp: 'linear' } } } },
    controls: { [NUDGE]: { kind: 'toggle', class: 'document', label: 'Nudge', role: 'switch', binds: ['items/box/at/pos/1'], range: [0.5, 0.75], default: false } },
  };
}
const ENV_LOOK: JsonObject = {
  ...ENVELOPE_LOOK, id: 'envelope-177', tone_map: { agx: { white: 8, contrast: 1.25 } }, bloom: { intensity: 0.04, radius: 0.85 },
  ao: { radius: 0.5, strength: 1, samples: 8, resolution: 'half', multi_bounce: true, specular: true },
};

async function onReference(): Promise<[number, number]> {
  const off = await offReference();
  if (off) inconclusive(`not a reference Mac in its conditions: ${off}`);
  const model = hwModel();
  const pixels = model ? XDR_MACS[model] : undefined;
  if (!pixels) inconclusive(`${model} has no XDR display (the reference Macs with one: ${Object.keys(XDR_MACS).join(', ')})`);
  return pixels;
}

function autoProblems(plant?: AppPlant): string[] {
  const out = dir();
  const doc = writeJson(out, 'lamps', lampsDoc());
  const r = liveHdr(app(), out, { doc, look: LOOK, window: [1200, 800], page: [200, 200, 200], view: [0, 0, 1200, 800], hdr: 'auto', frames: 120 }, plant);
  requireXdr(r);
  const first = r.frames.find((f) => f.state === 'on' && f.headroom > 1);
  if (!first) return [`auto never turned HDR on with the current headroom above 1 in ${r.frames.length} frames (${r.frames.at(-1)?.ms ?? 0} ms); last frame ${JSON.stringify(r.frames.at(-1))}`];
  if (first.ms > 1000) return [`auto turned HDR on with the current headroom above 1 only at frame ${first.frame}, ${first.ms} ms after the view first presented, past 1 s`];
  return [];
}

describe(`${AC[5]} on the reference Mac's XDR display: the envelope with HDR on, and auto within 1 s`, () => {
  it(`${AC[5]} the every-pass scene with HDR output on holds the envelope's frame time and memory, input within 2 frames`, async () => {
    requireLive('the envelope on the XDR display');
    const pixels = await onReference();
    const out = dir();
    const call: JsonObject = {
      call: 'envelope', look: ENV_LOOK, writer: 'agent:alpha', store: join(out, 'store'), scene: writeJson(out, 'scene', scene(pixels)),
      render: { seconds: 60, pixels }, inputs: { control: NUDGE, at_ns: seededTimes(177, 1000, 59e9) }, hdr: 'auto', screen: 'main',
    };
    const [reply] = runGpu(gpu(), out, [call]);
    const e = envelopeOf(answered(reply!, 'the envelope'), 'the envelope');
    const hdr = obj(reply!['hdr'], 'the envelope\'s hdr report');
    if (!(num(hdr['potential_headroom'], 'hdr.potential_headroom') > 1)) inconclusive(`the main display reports a potential headroom of ${String(hdr['potential_headroom'])}: no XDR display`);
    const p: string[] = [];
    if (str(hdr['state'], 'hdr.state') !== 'on') p.push(`HDR output wasn't on through the envelope's timed runs (hdr.state ${String(hdr['state'])})`);
    if (!(num(hdr['headroom'], 'hdr.headroom') > 1)) p.push(`the current headroom read ${String(hdr['headroom'])} in the timed runs, not above 1`);
    const row = fixtureRow(e, 'scene');
    const ft = row?.frame_time;
    const raw = (reply!['fixtures'] as JsonObject[] | undefined)?.find((f) => f['fixture'] === 'scene');
    const mem = raw && typeof raw['gpu_memory'] === 'object' && raw['gpu_memory'] !== null ? String((raw['gpu_memory'] as JsonObject)['verdict']) : 'missing';
    const verdicts = [['the scene\'s frame time', ft?.verdict ?? 'missing'], ['the scene\'s GPU memory', mem], ['input on screen within 2 frames', e.input.verdict]] as const;
    for (const [what, v] of verdicts) if (v !== 'PASS' && v !== 'INCONCLUSIVE') p.push(`${what} reads ${v} with HDR on (${what.startsWith('input') ? JSON.stringify(e.input.runs) : JSON.stringify(ft?.runs ?? null)})`);
    expect(p).toEqual([]);
    const open = verdicts.filter(([, v]) => v === 'INCONCLUSIVE');
    if (open.length) inconclusive(`${open.map(([w]) => w).join(' and ')} read INCONCLUSIVE under the five-run rule`);
  }, TIMEOUT);

  it(`${AC[5]} with no other HDR content on screen, auto turns HDR on and the current headroom reads above 1 within 1 s`, async () => {
    requireLive('auto on the XDR display');
    await onReference();
    expect(autoProblems()).toEqual([]);
  }, TIMEOUT);

  it(`${AC[5]} planted auto_waits_for_headroom (HDR on only once the headroom already reads above 1) fails, naming auto`, async () => {
    requireLive('auto on the XDR display');
    await onReference();
    const p = autoProblems('auto_waits_for_headroom');
    expect(p.some((s) => s.startsWith('auto ')), `the check fails, naming auto: ${JSON.stringify(p)}`).toBe(true);
  }, TIMEOUT);
});
