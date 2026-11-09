// #1434's helpers (README: The surface under test): the two builds, the replica's and the live app's fixture runs, the
// planted programs, the CPU references the pixel criteria compare with, and the reference-Mac judge. The PNG reader is
// #391's, reused by import.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';
import { decodePng, type Image } from '../391/helpers.ts';

export type { Image };
export type Obj = { [key: string]: unknown };
export type Rgba = [number, number, number, number];
/** `[x, y, w, h]` in points (fixtures) or device px (pixel checks). */
export type Rect = [number, number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');
export const fixture = (name: string): Obj => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as Obj;

/** The wrong programs, each selected by `DEEP_CHROME_PLANT` in a `chrome-fixture` build only (README: Planted programs). */
export type Plant = 'multiplies_per_element' | 'straight_alpha_slot' | 'no_card_guard' | 'redraws_settled_effects';

export function requireMacos(): void {
  if (process.platform !== 'darwin') expect.fail('INCONCLUSIVE: chrome layers run on macOS only (the issue: Runs on Mac only)');
}
export function requireLive(what: string): void {
  if (process.env['DEEP_1434_LIVE'] !== '1') expect.fail(`INCONCLUSIVE: ${what} opens the app's window on this Mac's screen; run with DEEP_1434_LIVE=1 (README: Run them)`);
  requireMacos();
}

// ---------------------------------------------------------------------------------------------------
// Builds: each file builds what it uses once, copies the binary out of target/ and fails the tests that use a build that
// failed with cargo's error.

function cargo(args: string[]): string {
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${(r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}

export const REPLICA_BUILD = ['build', '--locked', '-p', 'deep-replica', '--bin', 'deep-replica', '--features', 'chrome-fixture'];
export const APP_BUILD = ['build', '--locked', '--release', '-p', 'deep-app', '--bin', 'deep-app', '--features', 'chrome-fixture'];

/** `which` is built once before the file's tests; `bin()` fails the test with cargo's error if it didn't build. A live
 *  file's builds (the app's always) are made only with DEEP_1434_LIVE=1, since its tests fail INCONCLUSIVE without it. */
export function useBuild(which: 'replica' | 'app', live = which === 'app'): () => string {
  let dir = '';
  let error = 'not built';
  beforeAll(() => {
    if (process.platform !== 'darwin' || (live && process.env['DEEP_1434_LIVE'] !== '1')) return;
    dir = mkdtempSync(join(tmpdir(), 'deep-1434-bin-'));
    const args = which === 'replica' ? REPLICA_BUILD : APP_BUILD;
    error = cargo(args);
    const name = which === 'replica' ? 'deep-replica' : 'deep-app';
    if (error === '') copyFileSync(join(REPO, 'target', which === 'replica' ? 'debug' : 'release', name), join(dir, name));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => {
    requireMacos();
    const args = which === 'replica' ? REPLICA_BUILD : APP_BUILD;
    expect(error, `it builds: cargo ${args.join(' ')}`).toBe('');
    return join(dir, which === 'replica' ? 'deep-replica' : 'deep-app');
  };
}

const plantEnv = (plant?: Plant): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  delete env['DEEP_CHROME_PLANT'];
  if (plant) env['DEEP_CHROME_PLANT'] = plant;
  return env;
};

// ---------------------------------------------------------------------------------------------------
// The replica: `deep-replica --chrome <fixture> --out <dir> [--omit-effect <id>]…` draws the fixture headless and writes
// `screens/chrome.png` and `chrome.json`.

export interface Refusal { effect: string; operator: string; over: string; code: string }
export interface Drawn { png: Image; report: Obj; refusals: Refusal[] }

export function replica(bin: string, fx: Obj, opts: { omit?: string[]; plant?: Plant } = {}): Drawn {
  const out = mkdtempSync(join(tmpdir(), 'deep-1434-replica-'));
  try {
    const file = join(out, 'fixture.json');
    writeFileSync(file, JSON.stringify(fx));
    const args = ['--chrome', file, '--out', out, ...(opts.omit ?? []).flatMap((id) => ['--omit-effect', id])];
    const r = spawnSync(bin, args, { cwd: REPO, encoding: 'utf8', env: plantEnv(opts.plant), timeout: 300_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 });
    expect(r.status, `deep-replica ${args.join(' ')}${opts.plant ? ` (DEEP_CHROME_PLANT=${opts.plant})` : ''} exits 0 (${r.signal ?? 'no signal'}): ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
    const report = JSON.parse(readFileSync(join(out, 'chrome.json'), 'utf8')) as Obj;
    const png = decodePng(readFileSync(join(out, 'screens', 'chrome.png')));
    const [w, h] = fx['window'] as [number, number];
    const scale = fx['scale'] as number;
    expect([png.width, png.height], 'the screenshot is the fixture\'s window in device px').toEqual([w * scale, h * scale]);
    expect(Array.isArray(report['refusals']), `chrome.json lists its refusals: ${JSON.stringify(report).slice(0, 500)}`).toBe(true);
    return { png, report, refusals: report['refusals'] as Refusal[] };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------------
// The live app: `deep-app --chrome <fixture> (--snapshot <png> | --idle <s> | --frames <n>)` opens the app's real window
// on this Mac's screen and prints one report line `{"chrome": 1434, "mode", …}`.

export function live(bin: string, fx: Obj, mode: string[], plant?: Plant): { report: Obj; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'deep-1434-live-'));
  const file = join(dir, 'fixture.json');
  writeFileSync(file, JSON.stringify(fx));
  const args = ['--chrome', file, ...mode.map((m) => m.replace('{dir}', dir))];
  const r = spawnSync(bin, args, { cwd: REPO, encoding: 'utf8', env: plantEnv(plant), timeout: 300_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 });
  expect(r.status, `deep-app ${args.join(' ')} exits 0 (${r.signal ?? 'no signal'}): ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  const report = (r.stdout ?? '').split('\n').reverse().map((l) => { try { return JSON.parse(l) as unknown; } catch { return null; } })
    .find((v): v is Obj => typeof v === 'object' && v !== null && (v as Obj)['chrome'] === 1434);
  expect(report, `deep-app prints its report line: ${(r.stdout ?? '').slice(-800)}`).toBeDefined();
  return { report: report!, dir };
}

// ---------------------------------------------------------------------------------------------------
// Pixels

export function at(img: Image, x: number, y: number): Rgba {
  const o = (y * img.width + x) * 4;
  return [img.rgba[o]!, img.rgba[o + 1]!, img.rgba[o + 2]!, img.rgba[o + 3]!];
}
/** Every pixel of `rect` (device px) where `a` and `b` differ, as `(x, y)`; at most `limit`. */
export function differing(a: Image, b: Image, rect: Rect, limit = 5): string[] {
  const f: string[] = [];
  for (let y = rect[1]; y < rect[1] + rect[3]; y++) for (let x = rect[0]; x < rect[0] + rect[2]; x++) {
    const p = at(a, x, y); const q = at(b, x, y);
    if (p.some((v, i) => v !== q[i])) { f.push(`pixel (${x}, ${y}): ${JSON.stringify(p)} against ${JSON.stringify(q)}`); if (f.length >= limit) return f; }
  }
  return f;
}
/** The check every pixel criterion uses: each pixel's RGB within `tol` code values of `want(x, y)`; findings name the pixel. */
export function within(img: Image, pixels: Iterable<[number, number]>, want: (x: number, y: number) => number[], tol: number, limit = 5): string[] {
  const f: string[] = [];
  for (const [x, y] of pixels) {
    const got = at(img, x, y); const w = want(x, y);
    if ([0, 1, 2].some((i) => Math.abs(got[i]! - w[i]!) > tol)) {
      f.push(`pixel (${x}, ${y}): got ${JSON.stringify(got.slice(0, 3))}, want ${JSON.stringify(w.map((v) => Math.round(v * 100) / 100))} ± ${tol}`);
      if (f.length >= limit) return f;
    }
  }
  return f;
}
export function* pixelsOf(rect: Rect, skip?: (x: number, y: number) => boolean): Generator<[number, number]> {
  for (let y = rect[1]; y < rect[1] + rect[3]; y++) for (let x = rect[0]; x < rect[0] + rect[2]; x++) if (!skip?.(x, y)) yield [x, y];
}

/** GPUI's rounded-rect coverage, as its quad shader computes it: saturate(0.5 − sdf) at the pixel's center. */
export function coverage(x: number, y: number, rect: Rect, radius: number): number {
  const [rx, ry, rw, rh] = rect;
  const qx = Math.abs(x + 0.5 - (rx + rw / 2)) - (rw / 2 - radius);
  const qy = Math.abs(y + 0.5 - (ry + rh / 2)) - (rh / 2 - radius);
  const sdf = radius === 0 ? Math.max(qx, qy) : Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
  return Math.min(1, Math.max(0, 0.5 - sdf));
}

/** `frost@1`'s CPU reference (README: The operator): over `rect` of `backdrop`, a separable Gaussian of σ px (weights
 *  exp(−k²/2σ²), |k| ≤ ⌈3σ⌉, normalized; sampling clamped to `rect`), then the premultiplied tint over it. 0..255. */
export function frostReference(backdrop: Image, rect: Rect, sigma: number, tint: Rgba): (x: number, y: number) => number[] {
  const [rx, ry, rw, rh] = rect;
  const r = Math.ceil(3 * sigma);
  const w: number[] = [];
  for (let k = -r; k <= r; k++) w.push(sigma === 0 ? 1 : Math.exp(-(k * k) / (2 * sigma * sigma)));
  const sum = w.reduce((a, b) => a + b, 0);
  const clampX = (x: number): number => Math.min(rx + rw - 1, Math.max(rx, x));
  const clampY = (y: number): number => Math.min(ry + rh - 1, Math.max(ry, y));
  const rows = new Float64Array(rw * rh * 4);
  for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) for (let c = 0; c < 4; c++) {
    let v = 0;
    for (let k = -r; k <= r; k++) v += w[k + r]! * at(backdrop, clampX(x + k), y)[c]!;
    rows[((y - ry) * rw + (x - rx)) * 4 + c] = v / sum;
  }
  const ta = tint[3] / 255;
  return (x, y) => [0, 1, 2].map((c) => {
    let v = 0;
    for (let k = -r; k <= r; k++) v += w[k + r]! * rows[((clampY(y + k) - ry) * rw + (x - rx)) * 4 + c]!;
    return tint[c]! + (v / sum) * (1 - ta);
  });
}

// ---------------------------------------------------------------------------------------------------
// Budgets: five runs after warm-up, judged by scripts/benchmark.mjs's judgeLimit (the reference Macs, mains power, Low
// Power Mode off, thermal state nominal, the load at each run's start and end); anywhere else INCONCLUSIVE, never PASS.

export const load = (): number => loadavg()[0]!;
export async function judge(limit: number, runs: number[], loads: { start: number; end: number }[]): Promise<Obj> {
  const bench = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as { fingerprint: () => Obj; judgeLimit: (o: Obj) => Obj };
  return bench.judgeLimit({ limit, runs, fingerprint: bench.fingerprint(), loads });
}
/** The nearest-rank p95. */
export function p95(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(0.95 * s.length) - 1)]!;
}
