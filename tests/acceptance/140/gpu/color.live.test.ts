// AC5 (its first half), AC9 and AC19, live: the color seam on the app's real window. `deep-app --color-check` opens
// the app's window with a GPU-layer view and a surface wgpu configures with its Srgb color space, draws each status
// color of the shipped look as a swatch through every Metal layer the app presents through, reads each back from its
// layer's drawable, and prints each layer's colorspace as the layer itself reports it. The expected 8-bit values are
// the look's own status map (crates/deep-canvas-marks/looks/clean.json), read here. `--planted gpui_layer_untagged`
// drops the GPUI patch's tag (GPUI alone leaves the window's CAMetalLayer untagged); `--planted
// wgpu_default_colorspace` leaves the wgpu surface at wgpu's default. Each must read nil and fail, naming the layer.
// The run opens a window on this Mac's screen, so it runs only with DEEP_140_LIVE=1; otherwise each test fails
// INCONCLUSIVE, never passing. At the base `deep-app` has no --color-check and the run ends without a report.
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { REPO, arr, buildApp, num, obj, reportLine, requireLive, str, type JsonObject } from './helpers.ts';

const SRGB = 'kCGColorSpaceSRGB';
const look = JSON.parse(readFileSync(join(REPO, 'crates', 'deep-canvas-marks', 'looks', 'clean.json'), 'utf8')) as { status: { [status: string]: string } };
const STATUS: [string, [number, number, number]][] = Object.entries(look.status).map(([s, hex]) => [s, [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]]);

let app: { bin: string; error: string; dir: string } | null = null;
afterAll(() => { if (app) rmSync(app.dir, { recursive: true, force: true }); });

interface Layer { layer: string; owner: string; colorspace: string | null }
interface Report { raw: JsonObject; layers: Layer[]; swatches: { layer: string; status: string; read: number[] }[] }

function colorCheck(planted?: 'gpui_layer_untagged' | 'wgpu_default_colorspace'): Report {
  requireLive('the color check');
  app ??= buildApp();
  expect(app.error, 'deep-app builds: cargo build --locked -p deep-app').toBe('');
  const args = ['--color-check', ...(planted ? ['--planted', planted] : [])];
  const r = spawnSync(app.bin, args, { cwd: REPO, encoding: 'utf8', timeout: 120_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 });
  expect(r.status, `deep-app ${args.join(' ')} exits 0 (${r.signal ?? 'no signal'}): ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  const line = reportLine(r.stdout ?? '', 'color');
  expect(line, `deep-app ${args.join(' ')} prints its report line: ${(r.stdout ?? '').slice(-800)}`).toBeDefined();
  const layers = arr(line!['layers'], 'report: layers').map((v, i) => {
    const l = obj(v, `layers[${i}]`);
    const cs = l['colorspace'];
    expect(cs === null || typeof cs === 'string', `layers[${i}].colorspace is a name or null (nil), got ${JSON.stringify(cs)}`).toBe(true);
    return { layer: str(l['layer'], `layers[${i}].layer`), owner: str(l['owner'], `layers[${i}].owner`), colorspace: cs as string | null };
  });
  const swatches = arr(line!['swatches'], 'report: swatches').map((v, i) => {
    const s = obj(v, `swatches[${i}]`);
    return { layer: str(s['layer'], `swatches[${i}].layer`), status: str(s['status'], `swatches[${i}].status`), read: arr(s['read'], `swatches[${i}].read`).map((x, j) => num(x, `swatches[${i}].read[${j}]`)) };
  });
  return { raw: line!, layers, swatches };
}

/** The check: every layer reports the sRGB colorspace; a failure names the layer and what it read. */
const untagged = (r: Report): string[] => r.layers.filter((l) => l.colorspace !== SRGB).map((l) => `the ${l.owner} layer ${l.layer} reports the colorspace ${l.colorspace ?? 'nil'}, not ${SRGB}`);
/** The check: each status swatch reads back through `layer` as the look's 8-bit values. */
function swatchProblems(r: Report, layer: string): string[] {
  const f: string[] = [];
  for (const [status, want] of STATUS) {
    const s = r.swatches.find((x) => x.layer === layer && x.status === status);
    if (!s) f.push(`${layer}: no swatch read back for ${status}`);
    else if (JSON.stringify(s.read.slice(0, 3)) !== JSON.stringify(want)) f.push(`${layer}: ${status} read back as ${JSON.stringify(s.read)}, not the look's ${JSON.stringify(want)}`);
  }
  return f;
}
const ownedBy = (r: Report, owner: string): Layer[] => r.layers.filter((l) => l.owner === owner);

describe('AC5 status color swatches read back from the surface as the same 8-bit values (live)', () => {
  it('AC5 every status color of the look, drawn through each Metal layer the app presents through, reads back from that layer as the look\'s 8-bit values', () => {
    const r = colorCheck();
    expect(r.layers.length, 'the app presents through at least one Metal layer').toBeGreaterThan(0);
    expect(STATUS.length, 'the look has status colors').toBeGreaterThan(0);
    expect(r.layers.flatMap((l) => swatchProblems(r, l.layer)), 'the swatches read back').toEqual([]);
  }, 600_000);
});

describe('AC9 the window\'s CAMetalLayer reports the sRGB colorspace, which the GPUI patch sets and GPUI alone leaves unset, and a status swatch reads back as the same 8-bit values (live)', () => {
  it('AC9 the window\'s GPUI layer reports sRGB and its swatches read back exactly; with the patch\'s tag dropped it reads nil and fails, naming the layer', () => {
    const r = colorCheck();
    const windowLayers = ownedBy(r, 'gpui');
    expect(windowLayers.length, 'the window has its CAMetalLayer, GPUI\'s').toBe(1);
    const w = windowLayers[0]!;
    expect(w.colorspace, `the window's layer ${w.layer} reports sRGB`).toBe(SRGB);
    expect(swatchProblems(r, w.layer), 'a status swatch reads back through the window\'s layer').toEqual([]);
    const planted = colorCheck('gpui_layer_untagged');
    const pw = ownedBy(planted, 'gpui')[0];
    expect(pw, 'the planted run still has the window\'s layer').toBeDefined();
    expect(pw!.colorspace, 'GPUI alone leaves the window\'s layer untagged: it reads nil').toBe(null);
    const f = untagged(planted);
    expect(f.length, 'the check fails the untagged layer').toBeGreaterThan(0);
    expect(f.join('\n'), 'naming the layer').toContain(pw!.layer);
  }, 600_000);
});

describe('AC19 every Metal layer the app presents through reports an sRGB colorspace, including a surface wgpu configures with its Srgb color space (live)', () => {
  it('AC19 every layer reports sRGB, the wgpu-configured Srgb surface among them; a planted surface left at wgpu\'s default reads nil and fails, naming the layer', () => {
    const r = colorCheck();
    expect(ownedBy(r, 'wgpu').length, 'the app presents through a surface wgpu configures').toBeGreaterThan(0);
    expect(untagged(r), 'every Metal layer reports sRGB').toEqual([]);
    const planted = colorCheck('wgpu_default_colorspace');
    const pl = ownedBy(planted, 'wgpu');
    expect(pl.length, 'the planted run still presents through the wgpu surface').toBeGreaterThan(0);
    expect(pl.some((l) => l.colorspace === null), 'the surface left at wgpu\'s default reads nil').toBe(true);
    const named = pl.filter((l) => l.colorspace === null).map((l) => l.layer);
    const f = untagged(planted);
    for (const layer of named) expect(f.join('\n'), `the check fails naming the layer ${layer}`).toContain(layer);
    expect(ownedBy(planted, 'gpui').every((l) => l.colorspace === SRGB), 'the window\'s own layer is still tagged').toBe(true);
  }, 600_000);
});
