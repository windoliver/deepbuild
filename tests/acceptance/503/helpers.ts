// Test-side tools for the #503 acceptance tests (README: The surface under test): the two binaries the base already
// has, `deep-show run` (the canvas core, the decode worker, `media_bake`, `media_decode`, `eval`, `determinism`,
// `spatial`) and `deep-gpu run` (`view3d`), each built once per file and driven by JSON lines; the fixtures made at test
// time (the spectrum tone, the depth and equirectangular videos, the still HDR, the audio files of every listed format);
// and the references the criteria are held to: log-spaced band edges and empty bands, the unprojection in f64, the
// equirectangular lookup in linear light, the FFmpeg decode. Nothing here stands in for the bake, the decode worker,
// the point operator, the background or a decoder: each is read from what the binaries answer or write.
//
// JSON readers, scenarios, the evidence store and the deep-show build are #501's helpers; the float WAV writer #1819's;
// ffmpeg, its probe and its I420 reference decode #499's; the deep-gpu build, the plain look, the pinhole, the scene
// items and the target readers #422's. The Linux leg follows tests/acceptance/501-redraft-ac10 (its image and recipe).

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect } from 'vitest';
import { wavF32 } from '../1819/fixtures/synth.ts';
import { ffmpeg, ffmpegTools, probeFixture } from '../499/video/helpers.ts';
import {
  DOC, FLICKS, LICENSE, REPO, TIMEOUT, arr, blocked, inconclusive, int, isObject, num, obj, present, presented, repliesOf,
  scenario, sha256, show, str, type JsonObject, type JsonValue,
} from '../501/helpers.ts';
import { linuxImage, LINUX } from '../501-redraft-ac10/helpers.ts';
import { PLAIN_LOOK, camera, readIds, readLinear, readPng, inside, pixelRay, type Ids, type Image, type Linear, type Pinhole, type ViewFrame, type V3 } from '../422/helpers.ts';

export {
  DOC, FLICKS, LICENSE, REPO, TIMEOUT, arr, blocked, inconclusive, int, isObject, num, obj, present, presented, putEvidence, scenario, sha256, show, str,
  type JsonObject, type JsonValue,
} from '../501/helpers.ts';
export { FULL, decodePng, failsNaming, getEvidence, hex64, none, snapshotPicture, useShow, useTemp } from '../501/helpers.ts';
export { ffmpeg, ffmpegTools, referenceFrames } from '../499/video/helpers.ts';
export { PLAIN_LOOK, ball, camera, frameAt, framesOf, inside, material, readIds, readLinear, readPng, sessionDoc, useGpu, type Ids, type Image, type Linear, type ViewFrame } from '../422/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs: `#<issue>.<8 hex of the text's SHA-256>`), which starts its tests' names. */
export const AC = {
  1: 'AC1 #503.385199c8',
  2: 'AC2 #503.c6bbfb83',
  3: 'AC3 #503.d2172917',
  4: 'AC4 #503.89909452',
  5: 'AC5 #503.07910052',
} as const;

/** The wrong programs the criteria name (README: Planted programs). deep-show's go in the scenario's `planted`. */
export type ShowPlanted = 'spectrum_bands_even_hz' | 'spectrum_skips_window_norm';
/** deep-gpu's go in `deep-gpu run --planted <name>`. */
export type GpuPlanted = 'point_video_keeps_frame_before_seek' | 'video_background_prefiltered';

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export const secs = (flicks: number): string => `${(flicks / FLICKS).toFixed(4)} s`;

/** Temporary folders that last for the whole file (a fixture several tests read), removed after it. */
export function useFileTemp(tag: string): () => string {
  const made: string[] = [];
  afterAll(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), `deep-503-${tag}-`)); made.push(d); return d; };
}

/** The decode worker's codecs and the GPU layer's Metal device are macOS's (#498, #377): elsewhere a need is missing. */
export function requireMac(what: string): void {
  if (process.platform !== 'darwin') blocked(`${what} runs on macOS (the decode worker's platform codecs and the GPU layer's Metal device); this host is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// deep-show run, with its pid (criterion 4 reads which process decoded)

export function runShowPid(bin: string, sc: JsonObject, what: string): { replies: JsonObject[]; pid: number } {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`deep-show run: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { replies: repliesOf({ status: r.status, signal: r.signal, timedOut, lines, stdout, stderr: r.stderr ?? '' }, sc, what), pid: r.pid ?? 0 };
}

/** One scenario: the document presented as doc a, then `calls`; their replies. A planted program goes in the scenario. */
export function docRun(bin: string, evidence: string, document: JsonObject, calls: JsonObject[], what: string, planted?: ShowPlanted): JsonObject[] {
  const label = planted ? `${what} (planted ${planted})` : what;
  const replies = runShowPid(bin, scenario(evidence, [present(DOC.a, document), ...calls], planted ? { planted } : {}), label).replies;
  presented(replies[0]!, `${label}: the document`);
  return replies.slice(1);
}

// ---------------------------------------------------------------------------------------------------
// Criterion 1: the spectrum fixture, the bake's reply and the criterion's readings

export const SR = 48_000;
/** The criterion's file: 10 s, one channel at 48 kHz, a 937.5 Hz sine of amplitude 0.5 from 2 s to 4 s, silence
 * elsewhere. 937.5 Hz is bin 40 of a 2048-sample window at 48 kHz, so the window holds 40 whole cycles. Written as
 * 32-bit float, so the decoded PCM is the samples and no quantization noise reaches the bands. */
export const TONE = { hz: 937.5, amp: 0.5, from: 2, to: 4, seconds: 10 } as const;
export function toneSamples(): Float32Array {
  const x = new Float32Array(TONE.seconds * SR);
  for (let n = TONE.from * SR; n < TONE.to * SR; n++) x[n] = Math.fround(TONE.amp * Math.sin((2 * Math.PI * TONE.hz * (n - TONE.from * SR)) / SR));
  return x;
}
export const toneWav = (): Uint8Array => wavF32(toneSamples(), SR);

/** A spectrum bake's fields (Analysis bake: `spectrum {bands, scale, range, rate, window}`). */
export interface SpectrumAsk { bands: number; scale: 'log' | 'mel'; range: [number, number]; rate: number; window: number }
export const BAKE16: SpectrumAsk = { bands: 16, scale: 'log', range: [40, 16000], rate: 60, window: 2048 };
export const ANALYZER = 'spectrum@1';
export const spectrumCall = (asset: string, ask: SpectrumAsk): JsonObject => ({ call: 'media_bake', bake: { asset, kind: 'spectrum', ...ask } });
export const FLOOR = -120;
/** The criterion's band 8 at 3 s: −6.02 dB within 0.01 dB (exactly 20 log10 0.5 = −6.0206). */
export const BAND8 = { level: -6.02, within: 0.01, unnormalized: 49.93 } as const;

export interface Spectrum { rate: number; bands: [number, number][]; rows: { t: number; levels: number[] }[]; key: string; sha256: string; raw: JsonObject }
/** A spectrum bake's reply (README: `media_bake`): `bake.rate`, `bake.bands` as [low, high] Hz, `bake.rows` of {t,
 * levels}, `bake.key` and `bake.sha256`. Row r's `t` is r ÷ rate in flicks, so the rows step every 1 ÷ rate s from 0. */
export function spectrumOf(reply: JsonObject, what: string): Spectrum {
  const b = obj(reply['bake'], `${what}: bake (${show(reply, 600)})`);
  expect(b['kind'], `${what}: bake.kind`).toBe('spectrum');
  const rate = int(b['rate'], `${what}: bake.rate`);
  const bands = arr(b['bands'], `${what}: bake.bands`).map((e, i) => {
    const p = arr(e, `${what}: bake.bands[${i}]`);
    expect(p.length, `${what}: bake.bands[${i}] is [low, high] Hz`).toBe(2);
    return [num(p[0], `${what}: bake.bands[${i}][0]`), num(p[1], `${what}: bake.bands[${i}][1]`)] as [number, number];
  });
  const rows = arr(b['rows'], `${what}: bake.rows`).map((v, r) => {
    const o = obj(v, `${what}: bake.rows[${r}]`);
    const levels = arr(o['levels'], `${what}: bake.rows[${r}].levels`).map((x, i) => num(x, `${what}: bake.rows[${r}].levels[${i}]`));
    return { t: int(o['t'], `${what}: bake.rows[${r}].t (flicks)`), levels };
  });
  const step = FLICKS / rate;
  const off = rows.findIndex((row, r) => row.t !== r * step || row.levels.length !== bands.length);
  expect(off, `${what}: row ${off} is at ${off * step} flicks (${off} ÷ ${rate} s) with one level per band; got ${show(rows[off] as unknown as JsonValue)}`).toBe(-1);
  return { rate, bands, rows, key: str(b['key'], `${what}: bake.key`), sha256: str(b['sha256'], `${what}: bake.sha256`), raw: b };
}
/** The levels of the row for `seconds` (row ⌊t × rate⌋), or null when the bake has none. */
export function rowAt(s: Spectrum, seconds: number): number[] | null {
  const t = Math.round(seconds * FLICKS);
  return s.rows.find((r) => r.t === t)?.levels ?? null;
}
/** Band edges spaced evenly in log frequency across [lo, hi]: edge k is lo × (hi ÷ lo)^(k ÷ n). */
export function logEdges(n: number, lo: number, hi: number): number[] {
  return Array.from({ length: n + 1 }, (_, k) => lo * Math.pow(hi / lo, k / n));
}
export const WINDOWS = [512, 1024, 2048, 4096, 8192, 16384] as const;
/** Whether band [lo, hi) holds a bin centre k × sr ÷ N (a centre on an edge belongs to the band above it). */
const fills = (lo: number, hi: number, n: number): boolean => { for (let k = Math.ceil((lo * n) / SR); (k * SR) / n < hi; k++) if ((k * SR) / n >= lo) return true; return false; };
/** The log bands of `ask` that hold no bin centre at 48 kHz, each with the shortest window of the list that fills it. */
export function emptyBands(ask: SpectrumAsk): { band: number; window: number | null }[] {
  const e = logEdges(ask.bands, ask.range[0], ask.range[1]);
  const out: { band: number; window: number | null }[] = [];
  for (let b = 0; b < ask.bands; b++) {
    if (fills(e[b]!, e[b + 1]!, ask.window)) continue;
    out.push({ band: b, window: WINDOWS.find((w) => fills(e[b]!, e[b + 1]!, w)) ?? null });
  }
  return out;
}
const db = (x: number): string => `${x.toFixed(3)} dB`;
/** Criterion 1's readings of the 16-band bake of the fixture, each failure naming its band: 16 log-spaced bands across
 * [40, 16000] Hz at 60 rows a second; at 3 s band 8 at −6.02 dB within 0.01 dB and every other band at the −120 dB
 * floor; at 1 s every band at the floor. */
export function spectrumFailures(s: Spectrum, what: string): string[] {
  const f: string[] = [];
  if (s.rate !== BAKE16.rate) f.push(`${what}: its rate is ${s.rate} rows a second, not ${BAKE16.rate}`);
  if (s.bands.length !== BAKE16.bands) f.push(`${what}: it has ${s.bands.length} bands, not ${BAKE16.bands}`);
  const e = logEdges(BAKE16.bands, 40, 16000);
  s.bands.forEach(([lo, hi], i) => {
    if (i < BAKE16.bands && (Math.abs(lo - e[i]!) > 0.5 || Math.abs(hi - e[i + 1]!) > 0.5)) {
      f.push(`${what}: band ${i} spans ${lo.toFixed(1)} to ${hi.toFixed(1)} Hz, not ${e[i]!.toFixed(1)} to ${e[i + 1]!.toFixed(1)} Hz (log spacing across [40, 16000])`);
    }
  });
  for (const [seconds, tone] of [[3, true], [1, false]] as const) {
    const row = rowAt(s, seconds);
    if (!row) { f.push(`${what}: no row for ${seconds} s`); continue; }
    row.forEach((level, i) => {
      if (tone && i === 8) {
        if (!(Math.abs(level - BAND8.level) <= BAND8.within + 1e-9)) f.push(`${what}: band 8 (800 to 1,163 Hz) at 3 s reads ${db(level)}, not ${BAND8.level} dB within ${BAND8.within} dB`);
      } else if (level !== FLOOR) {
        f.push(`${what}: band ${i} at ${seconds} s reads ${db(level)}, not the ${FLOOR} dB floor`);
      }
    });
  }
  return f;
}

/** A film with the fixture as an asset, a strip playing it from 0 and its spectrum declared as a bake (Analysis
 * bake: `bakes: {ID → {asset, analyzer, kind and the kind's fields}}`); `chart` adds the 16-row bar chart reading the
 * bands. The page is 320 × 180 u over x 0 to 320 and y −150 to 30, so a bar from y = −120 to y2 = the band's level in
 * dB is level + 120 u tall and a band at the floor draws nothing. */
export const BAKE_ID = 'tone';
export const ARRAY = `spectrum.${BAKE_ID}`;
export const CHART = { size: [320, 180] as [number, number], fps: 30, seconds: 6, bar: (i: number): [number, number] => [8 + 19 * i, 22 + 19 * i] } as const;
const f32Column = (values: number[]): JsonObject => {
  const b = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => b.writeFloatLE(v, 4 * i));
  return { dtype: 'f32', len: values.length, data: b.toString('base64') };
};
export function spectrumDocument(sha: string, ask: SpectrumAsk, chart: boolean): JsonObject {
  const layer = 'main';
  const item = (id: string, kind: string, order: string, params: JsonObject): JsonObject => ({ id, kind, layer, name: `${kind} ${id}`, order, params });
  const items: JsonObject = {
    cam: item('cam', 'camera@1', 'a0', { projection: 'orthographic', target: [160, -60, 0], view_width: 320 }),
    back: item('back', 'rect@1', 'a1', { box: [0, -150, 320, 180], paint: { fill: { role: 'ground' } } }),
  };
  if (chart) {
    items['bars'] = item('bars', 'marks@1', 'a2', {
      mark: 'rect', n: ask.bands,
      columns: {
        x: f32Column(Array.from({ length: ask.bands }, (_, i) => CHART.bar(i)[0])),
        x2: f32Column(Array.from({ length: ask.bands }, (_, i) => CHART.bar(i)[1])),
        y: { const: FLOOR },
        y2: { array: ARRAY, as: 'f64' },
      },
      paint: { fill: { role: 'accent' } },
    });
  }
  return {
    format: 1, id: 'spectrum', profile: 'film', title: 'Spectrum bars', description: 'The #503 spectrum fixture and its bar chart.',
    size: CHART.size, camera: 'cam', layers: { [layer]: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    transport: { span: `${CHART.seconds}s`, frame_rate: [CHART.fps, 1], sample_rate: SR },
    items,
    assets: { tone: { sha256: sha, license: LICENSE } },
    strips: { tone: { track: 1, src: sha, start: '0s', in: 0, out: CHART.seconds * FLICKS, rate: 1 } },
    bakes: { [BAKE_ID]: { asset: sha, analyzer: ANALYZER, kind: 'spectrum', ...ask } },
  };
}
/** The empty bands a refusal names (README: refusals): one `spectrum_band_empty` issue listing `bands: [{band,
 * window}]`, or one such issue per band carrying `band` and `window`. */
export function namedEmptyBands(issues: JsonObject[], what: string): { band: number; window: number | null }[] {
  const mine = issues.filter((i) => i['code'] === 'spectrum_band_empty');
  expect(mine.length, `${what}: an issue spectrum_band_empty; the issues: ${show(issues as unknown as JsonValue, 1500)}`).toBeGreaterThan(0);
  const out: { band: number; window: number | null }[] = [];
  for (const i of mine) {
    const list = Array.isArray(i['bands']) ? i['bands'] : [i];
    for (const [k, v] of list.entries()) {
      const o = obj(v, `${what}: spectrum_band_empty band ${k}`);
      out.push({ band: int(o['band'], `${what}: the empty band's number (band)`), window: o['window'] === null ? null : int(o['window'], `${what}: the window that fills band ${String(o['band'])} (window)`) });
    }
  }
  return out.sort((a, b) => a.band - b.band);
}

/** Every pixel of `img` in column x whose colour is more than half-way from the ground's to the column's most
 * different pixel: a bar's height in px (1 u a px here). */
export function barHeight(img: { width: number; height: number; rgba: Uint8Array }, x: number, ground: [number, number, number]): number {
  const diff = (y: number): number => { const o = (y * img.width + x) * 4; return Math.max(Math.abs(img.rgba[o]! - ground[0]), Math.abs(img.rgba[o + 1]! - ground[1]), Math.abs(img.rgba[o + 2]! - ground[2])); };
  let most = 0;
  for (let y = 0; y < img.height; y++) most = Math.max(most, diff(y));
  if (most < 24) return 0;
  let n = 0;
  for (let y = 0; y < img.height; y++) if (diff(y) > most / 2) n++;
  return n;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 1's Linux leg: the bake in a linux/amd64 container on this Mac, as tests/acceptance/501-redraft-ac10 runs
// its leg: the local image `deep-501-linux:<channel>` (the pinned slim image with g++ and libclang-dev), never pulled
// or built here; its toolchain probed; crate sources fetched in their own step; deep-show built offline with `full`.
// Its caches are #501's (target/acceptance-501-linux/), its evidence store under target/acceptance-503-linux/.

const channel = (): string => {
  const c = /channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8'))?.[1];
  if (!c) throw Error('rust-toolchain.toml names no channel');
  return c;
};
export const linuxRecipe = (): string =>
  `printf 'FROM rust:${channel()}-slim-bookworm\\nRUN apt-get update && apt-get install -y --no-install-recommends g++ libclang-dev && rm -rf /var/lib/apt/lists/*\\n' | docker build --platform linux/amd64 -t ${linuxImage()} -`;
export const LINUX_STORE = join(REPO, 'target', 'acceptance-503-linux');
function docker(args: string[], input: string | undefined, timeoutMs: number): { status: number | null; stdout: string; stderr: string; timedOut: boolean } {
  const r = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: Math.max(1_000, timeoutMs), killSignal: 'SIGKILL', ...(input !== undefined ? { input } : {}) });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) return { status: null, stdout: '', stderr: r.error.message, timedOut };
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', timedOut };
}
const PROBE = [
  'uname -m',
  'command -v cargo >/dev/null 2>&1 && cargo --version | grep -q " $0 " || echo "missing cargo $0"',
  'command -v cc >/dev/null 2>&1 || echo "missing a C compiler (cc)"',
  'command -v c++ >/dev/null 2>&1 || echo "missing a C++ compiler (c++)"',
  'ls /usr/lib/llvm-*/lib/libclang.so* /usr/lib/x86_64-linux-gnu/libclang*.so* >/dev/null 2>&1 || echo "missing libclang"',
].join('; ');
let linuxBuilt: { verdict: 'built' | 'blocked' | 'inconclusive' | 'failed'; text: string } | undefined;
/** Builds deep-show for linux/amd64 once per process, within `budgetMs`; BLOCKED for a missing need, INCONCLUSIVE when
 * the build runs out of time, a FAIL with cargo's error when every need is in place. */
function linuxShow(budgetMs: number): void {
  if (!linuxBuilt) {
    const deadline = Date.now() + budgetMs;
    const left = (cap: number): number => Math.min(cap, deadline - Date.now());
    const build = (): NonNullable<typeof linuxBuilt> => {
      const info = docker(['info', '--format', '{{.ServerVersion}}'], undefined, 30_000);
      if (info.status !== 0) return { verdict: 'blocked', text: `Docker is unreachable (docker info: ${info.stderr.trim().split('\n').slice(-1)[0] ?? ''}); the Linux machine is a linux/amd64 container on this Mac` };
      const image = linuxImage();
      const arch = docker(['image', 'inspect', '--format', '{{.Architecture}}', image], undefined, 30_000);
      if (arch.status !== 0 || arch.stdout.trim() !== 'amd64') return { verdict: 'blocked', text: `Docker has no linux/amd64 image ${image} here, and this suite pulls and builds nothing; make it once with: ${linuxRecipe()}` };
      const probe = docker(['run', '--rm', '--platform', 'linux/amd64', '-e', `RUSTUP_TOOLCHAIN=${channel()}`, image, 'sh', '-c', PROBE, channel()], undefined, left(300_000));
      if (probe.status !== 0) return { verdict: 'blocked', text: `the toolchain probe could not run in ${image} (exit ${probe.status}${probe.timedOut ? ', timed out' : ''}): ${probe.stderr.slice(-1000)}` };
      const [machine, ...missing] = probe.stdout.trim().split('\n');
      if (machine !== 'x86_64') return { verdict: 'blocked', text: `${image} with --platform linux/amd64 runs as ${machine ?? 'nothing'}, not x86_64` };
      if (missing.length) return { verdict: 'blocked', text: `${image} lacks what deep-show's Linux build needs: ${missing.join('; ')}; make the image with: ${linuxRecipe()}` };
      for (const d of ['target', 'registry', 'git']) mkdirSync(join(LINUX, d), { recursive: true });
      const mounts = [`${REPO}:/src:ro`, `${join(LINUX, 'target')}:/target`, `${join(LINUX, 'registry')}:/usr/local/cargo/registry`, `${join(LINUX, 'git')}:/usr/local/cargo/git`];
      const run = (cmd: string[]): string[] => ['run', '--rm', '--platform', 'linux/amd64', ...mounts.flatMap((m) => ['-v', m]), '-w', '/src', '-e', 'CARGO_TARGET_DIR=/target', '-e', `RUSTUP_TOOLCHAIN=${channel()}`, image, ...cmd];
      const fetched = docker(run(['cargo', 'fetch', '--locked', '--target', 'x86_64-unknown-linux-gnu']), undefined, left(1_200_000));
      if (fetched.status !== 0) return { verdict: fetched.timedOut ? 'inconclusive' : 'blocked', text: `cargo fetch --locked in ${image} could not get the crate sources${fetched.timedOut ? ' in the time left' : ''}:\n${fetched.stderr.slice(-2000)}` };
      const args = ['build', '--locked', '--offline', '--bin', 'deep-show', '--no-default-features', '--features', 'full'];
      const built = docker(run(['cargo', ...args]), undefined, left(budgetMs));
      if (built.timedOut) return { verdict: 'inconclusive', text: `cargo ${args.join(' ')} in ${image} (linux/amd64, emulated) did not finish in the test's time; a warm cache finishes it on a rerun` };
      return built.status === 0 ? { verdict: 'built', text: '' } : { verdict: 'failed', text: `cargo ${args.join(' ')} in ${image} (linux/amd64) failed with every probed need in place:\n${built.stderr.slice(-4000)}` };
    };
    linuxBuilt = build();
  }
  if (linuxBuilt.verdict === 'blocked') blocked(linuxBuilt.text);
  if (linuxBuilt.verdict === 'inconclusive') inconclusive(linuxBuilt.text);
  expect(linuxBuilt.text, 'deep-show builds for Linux x86_64').toBe('');
}
/** Runs one scenario through `deep-show run` in a linux/amd64 container, its evidence store at `evidence` (under
 * target/acceptance-503-linux/, mounted at /evidence). */
export function onLinux(sc: JsonObject, evidence: string, what: string, budgetMs: number): JsonObject[] {
  linuxShow(budgetMs);
  const inner = { ...sc, evidence: '/evidence' };
  const r = docker(['run', '--rm', '-i', '--platform', 'linux/amd64', '-v', `${join(LINUX, 'target')}:/target:ro`, '-v', `${evidence}:/evidence`,
    linuxImage(), '/target/debug/deep-show', 'run'], `${JSON.stringify(inner)}\n`, 900_000);
  const lines = r.stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  if (r.timedOut) inconclusive(`${what} on linux/amd64 did not answer within 15 minutes`);
  return repliesOf({ status: r.status, signal: null, timedOut: r.timedOut, lines, stdout: r.stdout, stderr: r.stderr }, inner, `${what} on linux/amd64`);
}

// ---------------------------------------------------------------------------------------------------
// deep-gpu run and view3d (README: view3d)

/** `deep-gpu run [--planted p]`: one scenario `{out, calls}` in, one answer line out, exit 0, ok, a reply per call. */
export function runGpu(bin: string, out: string, calls: JsonObject[], what: string, planted?: GpuPlanted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const name = `${what} (deep-gpu ${args.join(' ')})`;
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${name}: ${r.error.message}`);
  expect(timedOut, `${name} finished within 30 minutes`).toBe(false);
  expect(r.status, `${name} exited 0; stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${name}: one answer line`).toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, `${name}: the answer`);
  expect(answer['ok'], `${name} answered the scenario: ${show(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${name}: replies`).map((x, i) => obj(x, `${name}: replies[${i}]`));
  expect(replies.length, `${name}: one reply per call`).toBe(calls.length);
  for (const [i, x] of replies.entries()) if (x['code'] === 'unsupported_platform') blocked(`${name}: reply ${i} is unsupported_platform; the GPU layer draws on macOS's Metal device`);
  return replies;
}
/** A `view3d` call: the plain look (#422's: tone map none, exposure scale 1), 30 fps unless given. */
export const view3d = (v: JsonObject): JsonObject => ({ call: 'view3d', look: PLAIN_LOOK, fps: 30, ...v });
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}
/** A refusal at check (README: refusals): a reply with a string `code` and no `frames`, whose fields name `named`. */
export function refusalNaming(reply: JsonObject, named: RegExp, what: string): void {
  expect(typeof reply['code'], `${what} is refused with a code: ${show(reply)}`).toBe('string');
  expect(reply['frames'], `${what} draws nothing: ${show(reply)}`).toBeUndefined();
  const { code: _code, ...fields } = reply;
  expect(named.test(JSON.stringify(fields)), `${what}: the refusal names ${named} in its fields, got ${show(reply)}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// Video fixtures (README: Fixtures): gray, full range, so a frame's decoded 8-bit R′G′B′ is its Y′ at every pixel.

/** Encodes I420 frames (Cb = Cr = 128) as H.264, 30 fps, full range, BT.709 matrix and primaries, sRGB transfer,
 * libx264 at QP 10, no B-frames, a key frame every 30, time base 1/15360 with no edit list; checks the recipe held. */
export function grayVideo(path: string, size: [number, number], count: number, frame: (k: number) => Buffer): void {
  const [w, h] = size;
  const raw = Buffer.concat(Array.from({ length: count }, (_, k) => frame(k)));
  ffmpeg(['-y', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${w}x${h}`, '-r', '30', '-i', '-',
    '-vf', 'setparams=color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709:range=pc', '-color_range', 'pc',
    '-c:v', 'libx264', '-qp', '10', '-bf', '0', '-g', '30', '-pix_fmt', 'yuv420p', '-video_track_timescale', '15360', '-use_editlist', '0', path], raw);
  const p = probeFixture(path);
  expect([p.width, p.height], `fixture ${path}: ${w} × ${h}`).toEqual([w, h]);
  expect(p.pts, `fixture ${path}: frame k at 512k/15360 s = k/30 s`).toEqual(Array.from({ length: count }, (_, k) => 512 * k));
  expect(p.color['color_range'], `fixture ${path}: tagged full range`).toBe('pc');
}
/** A gray I420 frame from its luma. */
function i420(w: number, h: number, luma: (x: number, y: number) => number): Buffer {
  const f = Buffer.alloc((w * h * 3) / 2, 128);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f[y * w + x] = luma(x, y);
  return f;
}
/** R′G′B′ of full-range BT.709 Y′CbCr, rounded and clamped. */
export function rgbFull709(y: number, cb: number, cr: number): [number, number, number] {
  const c = (v: number): number => Math.min(255, Math.max(0, Math.round(v)));
  return [c(y + 1.5748 * (cr - 128)), c(y - 0.187324 * (cb - 128) - 0.468124 * (cr - 128)), c(y + 1.8556 * (cb - 128))];
}
/** A decoded I420 frame's R′G′B′ at every pixel (chroma by its 2 × 2 block). */
export function rgbOf(frame: Buffer, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 3); const ys = w * h; const cs = (w / 2) * (h / 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ci = (y >> 1) * (w / 2) + (x >> 1);
    out.set(rgbFull709(frame[y * w + x]!, frame[ys + ci]!, frame[ys + cs + ci]!), 3 * (y * w + x));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 2: the depth video, its unprojection and the point set's read-back

export const DEPTH = { w: 640, h: 480, count: 90, near: 1, far: 5, fov: [60, 45] as [number, number], sampled: [10, 45, 80] } as const;
/** Frame k's Y′ at (x, y): (x + 2y + 5k) mod 256, every level from 0 to 255 and every pixel 5 codes from the frame
 * before, so a point set showing another frame's depths misses at every pixel. */
export const depthFrame = (k: number, size: [number, number] = [DEPTH.w, DEPTH.h]): Buffer => i420(size[0], size[1], (x, y) => (x + 2 * y + 5 * k) & 255);
/** The depth value d at every pixel of a decoded frame (Marks in 3D: luma as (0.2126 R + 0.7152 G + 0.0722 B) ÷ 255
 * of the decoded 8-bit R′G′B′), after checking the frame is gray, so R′ = G′ = B′ = Y′. */
export function depthsOf(frame: Buffer, w: number, h: number, what: string): Float64Array {
  const chroma = frame.subarray(w * h);
  const off = chroma.findIndex((c) => c !== 128);
  expect(off, `${what}: the reference decode's chroma is 128 everywhere (the fixture's recipe), first other at byte ${off}`).toBe(-1);
  const rgb = rgbOf(frame, w, h);
  const d = new Float64Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = (0.2126 * rgb[3 * i]! + 0.7152 * rgb[3 * i + 1]! + 0.0722 * rgb[3 * i + 2]!) / 255;
  return d;
}
/** The criterion's unprojection in f64: z = far + d (near − far), x = ((u + 0.5) ÷ w − 0.5) × 2z × tan(fov_x ÷ 2),
 * y = (0.5 − (v + 0.5) ÷ h) × 2z × tan(fov_y ÷ 2), at −z. */
export function unprojected(u: number, v: number, d: number, w: number, h: number): V3 {
  const z = DEPTH.far + d * (DEPTH.near - DEPTH.far);
  const tx = Math.tan((DEPTH.fov[0] * Math.PI) / 360); const ty = Math.tan((DEPTH.fov[1] * Math.PI) / 360);
  return [((u + 0.5) / w - 0.5) * 2 * z * tx, (0.5 - (v + 0.5) / h) * 2 * z * ty, -z];
}
/** The point set's read-back (README: view3d `read`): `count` points, `components` (3 or 4) little-endian f32 a
 * point, x, y, z first, in the item's space, row-major over the sampled pixels; the file `<out>/<file>.f32`, named by
 * the SHA-256 of its bytes. */
export interface Points { count: number; components: number; file: string; bytes: Buffer }
export const POINTS = 'depth.points';
export function pointsOf(out: string, frame: JsonObject, what: string): Points {
  const read = obj(obj(frame['read'], `${what}: read (the operator outputs read back)`)[POINTS], `${what}: read["${POINTS}"]`);
  expect(read['type'], `${what}: the points are f32`).toBe('f32');
  const count = int(read['count'], `${what}: read.count (points)`);
  const components = int(read['components'], `${what}: read.components`);
  expect([3, 4], `${what}: 3 or 4 floats a point`).toContain(components);
  const file = str(read['file'], `${what}: read.file`);
  expect(/^[0-9a-f]{64}$/.test(file), `${what}: read.file is a SHA-256`).toBe(true);
  const path = join(out, `${file}.f32`);
  expect(existsSync(path), `${what}: ${path} was written`).toBe(true);
  const bytes = readFileSync(path);
  expect(sha256(bytes), `${what}: the file hashes to its name`).toBe(file);
  expect(bytes.length, `${what}: ${count} points of ${components} f32`).toBe(count * components * 4);
  return { count, components, file, bytes };
}
/** Every point against the unprojection of `depths` at its pixel; failures name `frame`. */
export function pointFailures(p: Points, depths: Float64Array, size: [number, number], step: number, frame: number, against = frame): string[] {
  const [w, h] = size; const cols = Math.floor(w / step); const rows = Math.floor(h / step);
  if (p.count !== cols * rows) return [`frame ${frame}: ${p.count} points, not ${cols} × ${rows} = ${cols * rows}`];
  let bad = 0; let first = '';
  for (let i = 0; i < p.count; i++) {
    const u = (i % cols) * step; const v = Math.floor(i / cols) * step;
    const d = depths[v * w + u]!;
    const want = unprojected(u, v, d, w, h);
    const o = i * p.components * 4;
    const got: V3 = [p.bytes.readFloatLE(o), p.bytes.readFloatLE(o + 4), p.bytes.readFloatLE(o + 8)];
    const dist = Math.hypot(got[0] - want[0], got[1] - want[1], got[2] - want[2]);
    if (!(dist <= 1e-4)) {
      if (bad === 0) first = `point ${i} at pixel (${u}, ${v}), d = ${d.toFixed(6)}: (${got.map((c) => c.toFixed(6)).join(', ')}), not (${want.map((c) => c.toFixed(6)).join(', ')}), ${dist.toExponential(2)} m off`;
      bad++;
    }
  }
  return bad ? [`frame ${frame}: ${bad} of ${p.count} points sit more than 1e-4 m from the unprojection of frame ${against}'s decoded depths; the first, ${first}`] : [];
}
/** The showpiece: a camera at the origin looking along −Z and the point set `depth` from the video (the criterion's
 * fields: near 1, far 5, fov [60, 45]; `step` and `depth` left at their defaults unless given). */
export function depthDocument(sha: string, extra: JsonObject = {}): JsonObject {
  const layer = 'main';
  return {
    format: 1, id: 'depth', profile: 'scene', title: 'Depth points', description: 'The #503 depth video drawn as points.', size: [640, 480], camera: 'cam',
    transport: { span: '3s', frame_rate: [30, 1] }, requires: { modules: { scene3d: '^1' } }, budget: { class: 'showpiece' },
    layers: { [layer]: { writer: 'agent:sess-alpha', title: layer, order: 'a0' } },
    items: {
      cam: { id: 'cam', name: 'cam', order: 'a000', layer, ...camera([0, 0, 0], [0, 0, -1], 60, { near: 0.1, far: 100 }) },
      depth: {
        id: 'depth', name: 'Depth points', order: 'a001', layer, kind: 'mark.point@1',
        params: { from: { video: { asset: sha, frames: { start: '0s', in: 0, rate: [1, 1] }, near: DEPTH.near, far: DEPTH.far, fov: DEPTH.fov, ...extra } } },
      },
    },
    assets: { depth: { sha256: sha, license: LICENSE } },
  };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 3: the equirectangular video, the still HDR, the scene and the CPU lookup

export const EQ = { w: 1024, h: 512, count: 90, frame: 75, at: 2.5 } as const;
/** Seven-segment digits (a b c d e f g) of 0 to 9. */
const SEGMENTS = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];
/** Frame n: Y′ 96 everywhere, and n's two digits in Y′ 192 about the image's centre (the view direction −Z), each a
 * 24 × 40 px seven-segment digit with 4 px strokes, 8 px apart. Mid levels keep a filtered edge's error in linear light
 * under a code value. */
export function equirectFrame(n: number): Buffer {
  const digits = [Math.floor(n / 10) % 10, n % 10];
  const on = (x: number, y: number): boolean => digits.some((dg, k) => {
    const x0 = EQ.w / 2 - 28 + k * 32; const y0 = EQ.h / 2 - 20; const lx = x - x0; const ly = y - y0;
    if (lx < 0 || lx >= 24 || ly < 0 || ly >= 40) return false;
    const s = SEGMENTS[dg]!;
    const top = ly < 4; const mid = ly >= 18 && ly < 22; const bottom = ly >= 36;
    const left = lx < 4; const right = lx >= 20; const upper = ly < 20; const lower = ly >= 20;
    return (s.includes('a') && top) || (s.includes('g') && mid) || (s.includes('d') && bottom)
      || (s.includes('f') && left && upper) || (s.includes('b') && right && upper) || (s.includes('e') && left && lower) || (s.includes('c') && right && lower);
  });
  return i420(EQ.w, EQ.h, (x, y) => (on(x, y) ? 192 : 96));
}
/** An RGBE Radiance file, flat (no run-length lines), each channel a mantissa m with exponent 128 (the value m ÷ 256),
 * as #426's suite writes its HDRs; named `<sha>.hdr` in `dir`. */
export function writeHdr(dir: string, size: [number, number], pixel: (x: number, y: number) => [number, number, number]): { path: string; sha: string } {
  const [w, h] = size;
  const head = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`, 'latin1');
  const body = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const m = pixel(x, y); const o = (y * w + x) * 4;
    body[o] = m[0]; body[o + 1] = m[1]; body[o + 2] = m[2]; body[o + 3] = m[0] + m[1] + m[2] === 0 ? 0 : 128;
    if (x === 0 && m[0] === 2 && m[1] === 2) throw Error(`HDR line ${y} would read as run-length encoded`);
  }
  const bytes = Buffer.concat([head, body]);
  const sha = sha256(bytes);
  const path = join(dir, `${sha}.hdr`);
  writeFileSync(path, bytes);
  return { path, sha };
}
/** The still environment: a warm sky over a dark brown ground, nothing like the gray video, 128 × 64. */
export const stillSky = (x: number, y: number): [number, number, number] =>
  y < 32 ? [Math.round(120 + 60 * Math.sin(x / 20)), Math.round(150 - y), 230] : [70, Math.round(40 + (y - 32)), 20];

export const VIEW: Pinhole = { position: [0, 0, 0], target: [0, 0, -1], fov: 60, size: [320, 240] };
/** The centre region judged: 128 × 96 px about the view's centre, which holds both digits. */
export const REGION = { x0: 96, y0: 72, x1: 224, y1: 168 } as const;
export const SPHERE = { id: 'sphere', radius: 0.6, pos: [1.8, -0.9, -5] as V3 } as const;
/** The 360° scene: the still HDR lights and reflects; the background is the video (`background: {video: {asset,
 * frames}}`, played with start 0) or, with no video, the HDR itself (auto); a white metal sphere beside the region. */
export function backgroundDocument(hdr: string, video: string | null, sky: JsonObject = {}): JsonObject {
  const layer = 'main';
  const at = (id: string, order: string, item: JsonObject): JsonObject => ({ id, name: id, order, layer, ...item });
  return {
    format: 1, id: 'panorama', profile: 'scene', title: 'A 360° video background', description: 'The #503 equirectangular video behind a white metal sphere.',
    size: VIEW.size, camera: 'cam', transport: { span: '3s', frame_rate: [30, 1] }, requires: { modules: { scene3d: '^1' } },
    layers: { [layer]: { writer: 'agent:sess-alpha', title: layer, order: 'a0' } },
    items: {
      cam: at('cam', 'a000', camera(VIEW.position, VIEW.target, VIEW.fov, { near: 0.1, far: 100 })),
      sky: at('sky', 'a001', {
        kind: 'sky@1',
        params: {
          ambient_top: [0, 0, 0], ambient_low: [0, 0, 0], environment: { from: hdr, intensity: 1 },
          ...(video ? { background: { video: { asset: video, frames: { start: '0s', in: 0, rate: [1, 1] } } } } : {}), ...sky,
        },
      }),
      white_metal: at('white_metal', 'a002', { kind: 'material@1', params: { base_color: [1, 1, 1, 1], metallic: 1, roughness: 0.3 } }),
      [SPHERE.id]: at(SPHERE.id, 'a003', { kind: 'ball@1', params: { radius: SPHERE.radius, segments: 256 }, at: { pos: SPHERE.pos }, material: 'white_metal' }),
    },
  };
}
const srgbDecode = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const srgbEncode = (l: number): number => (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);
/** A linear value as an 8-bit sRGB code. */
export const code = (l: number): number => Math.round(255 * srgbEncode(Math.min(1, Math.max(0, l))));
/** The CPU equirectangular lookup of a gray frame (Sky: environment, the base's convention: u = atan2(x, −z) ÷ 2π +
 * 0.5 from −Z toward +X, v = acos(y) ÷ π from the zenith), sampled bilinearly in linear light along pixel (px, py)'s
 * centre ray, u wrapping and v clamped, at rotation 0 and intensity 1: the linear value the pixel shows. */
export function lookup(frame: Buffer, px: number, py: number): number {
  const d = pixelRay(VIEW, px, py);
  const u = Math.atan2(d[0], -d[2]) / (2 * Math.PI) + 0.5; const v = Math.acos(Math.max(-1, Math.min(1, d[1]))) / Math.PI;
  const x = u * EQ.w - 0.5; const y = v * EQ.h - 0.5;
  const x0 = Math.floor(x); const y0 = Math.floor(y); const fx = x - x0; const fy = y - y0;
  const at = (xi: number, yi: number): number => srgbDecode(frame[Math.min(EQ.h - 1, Math.max(0, yi)) * EQ.w + (((xi % EQ.w) + EQ.w) % EQ.w)]! / 255);
  return (1 - fy) * ((1 - fx) * at(x0, y0) + fx * at(x0 + 1, y0)) + fy * ((1 - fx) * at(x0, y0 + 1) + fx * at(x0 + 1, y0 + 1));
}
/** The centre region against the lookup of `frame`, each channel of the linear target as an 8-bit sRGB code within
 * one code value of the lookup's; failures name `what` and the pixel. */
export function regionFailures(lin: Linear, frame: Buffer, what: string): string[] {
  let bad = 0; let first = '';
  for (let y = REGION.y0; y < REGION.y1; y++) for (let x = REGION.x0; x < REGION.x1; x++) {
    const want = code(lookup(frame, x, y));
    const got = lin.at(x, y).map(code);
    const off = Math.max(...got.map((g) => Math.abs(g - want)));
    if (off > 1) { if (!bad) first = `pixel (${x}, ${y}) shows [${got.join(', ')}], the lookup ${want}`; bad++; }
  }
  return bad ? [`${what}: ${bad} of ${(REGION.x1 - REGION.x0) * (REGION.y1 - REGION.y0)} centre-region pixels are more than 1 code value from the lookup of frame ${EQ.frame}; the first, ${first}`] : [];
}
/** How many centre-region pixels differ by more than one code between the lookups of two frames. */
export function lookupsDiffer(a: Buffer, b: Buffer): number {
  let n = 0;
  for (let y = REGION.y0; y < REGION.y1; y++) for (let x = REGION.x0; x < REGION.x1; x++) if (Math.abs(code(lookup(a, x, y)) - code(lookup(b, x, y))) > 1) n++;
  return n;
}
/** The sphere's interior pixels (3 px inside its silhouette in the object-ID target), compared byte for byte in the
 * linear and final targets between two renders; a failure names the sphere. */
export interface Drawn { linear: Linear; final: Image; ids: Ids; linearBytes: Buffer }
export function sphereFailures(withVideo: Drawn, still: Drawn, what: string): string[] {
  const px = inside(still.ids, SPHERE.id, 3);
  if (px.length < 500) return [`${what}: the sphere covers only ${px.length} interior pixels in the render with no video`];
  let bad = 0; let first = '';
  const w = withVideo.final.width;
  for (const [x, y] of px) {
    const o = (y * w + x) * 4;
    const lin = withVideo.linearBytes.subarray(o * 4, o * 4 + 12).equals(still.linearBytes.subarray(o * 4, o * 4 + 12));
    const fin = [0, 1, 2, 3].every((k) => withVideo.final.rgba[o + k] === still.final.rgba[o + k]);
    if (!lin || !fin || withVideo.ids.at(x, y) !== SPHERE.id) {
      if (!bad) first = `(${x}, ${y}): linear [${withVideo.linear.at(x, y).map((c) => c.toFixed(5)).join(', ')}] against [${still.linear.at(x, y).map((c) => c.toFixed(5)).join(', ')}]`;
      bad++;
    }
  }
  return bad ? [`${what}: the sphere's pixels differ from the render with no video at ${bad} of ${px.length} interior pixels, the first ${first}`] : [];
}
/** A frame's linear, final and ID targets. */
export function drawn(out: string, f: ViewFrame, size: [number, number], what: string): Drawn {
  const linear = readLinear(out, f.linear, size, `${what}: linear`);
  return { linear, linearBytes: readFileSync(join(out, `${f.linear!}.f32`)), final: readPng(out, f.final, `${what}: final`), ids: readIds(out, f, `${what}: ids`) };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 4: decodes in the worker against references (README: Fixtures, the audio files)

export const decodeCall = (path: string, out: string): JsonObject => ({ call: 'media_decode', path, out, video_frames: 0 });
export interface Pcm { rate: number; channels: number; frames: number; samples: Float32Array; bytes: Buffer }
const pcmOf = (bytes: Buffer, rate: number, channels: number): Pcm => {
  const samples = new Float32Array(bytes.length >> 2);
  for (let i = 0; i < samples.length; i++) samples[i] = bytes.readFloatLE(4 * i);
  return { rate, channels, frames: Math.floor(samples.length / Math.max(1, channels)), samples, bytes };
};
/** `media_decode`'s one audio stream: its rate, channels and the interleaved little-endian f32 file under `out`. */
export function decodedPcm(reply: JsonObject, out: string, what: string): Pcm {
  const d = obj(reply['decoded'], `${what}: media_decode's decoded (${show(reply, 600)})`);
  const audio = arr(d['streams'], `${what}: decoded.streams`).filter((s): s is JsonObject => isObject(s) && s['type'] === 'audio');
  expect(audio.length, `${what}: one audio stream decoded`).toBe(1);
  const s = audio[0]!;
  const bytes = readFileSync(join(out, str(s['file'], `${what}: the audio stream's file`)));
  return pcmOf(bytes, int(s['sample_rate'], `${what}: sample_rate`), int(s['channels'], `${what}: channels`));
}
/** The decode worker's pid from `media_decode`'s reply: some process other than deep-show's own. */
export function workerPid(reply: JsonObject, what: string): number {
  const w = isObject(reply['decoded']) && isObject(reply['decoded']['worker']) ? reply['decoded']['worker'] : reply['worker'];
  return int(obj(w, `${what}: the worker that decoded`)['pid'], `${what}: worker.pid`);
}
/** FFmpeg's decode of a file's first audio stream (its default decoder), interleaved f32, at the stream's own rate. */
export function ffmpegPcm(path: string): Pcm {
  const t = ffmpegTools();
  const s = obj(arr((JSON.parse(execFileSync(t.ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate,channels', '-of', 'json', path], { encoding: 'utf8' })) as JsonObject)['streams'], 'ffprobe streams')[0], 'ffprobe stream');
  const bytes = ffmpeg(['-i', path, '-map', '0:a:0', '-c:a', 'pcm_f32le', '-f', 'f32le', '-']);
  return pcmOf(bytes, Number(str(s['sample_rate'], 'ffprobe sample_rate')), int(s['channels'], 'ffprobe channels'));
}
/** The peak per-sample difference of two decodes in dBFS (−Infinity when equal), over their common length. */
export function peakDb(a: Float32Array, b: Float32Array, shift = 0): number {
  let peak = 0;
  for (let i = 0; i + shift < a.length && i < b.length; i++) peak = Math.max(peak, Math.abs(a[i + shift]! - b[i]!));
  return 20 * Math.log10(peak);
}
/** The criterion's bound: within −90 dBFS. */
export const LOSSY_DBFS = -90;
/** A seeded generator in [0, 1) (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Integer PCM for a lossless fixture: tones and seeded noise at 0.9 of full scale, with the depth's two extreme codes
 * at the start, interleaved; signed (8-bit is signed here and written as unsigned + 128). */
export function integerPcm(depth: 8 | 16 | 24, channels: number, frames: number, seed: number): Int32Array {
  const full = 2 ** (depth - 1); const rnd = seeded(seed);
  const x = new Int32Array(frames * channels);
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) {
    const s = 0.6 * Math.sin((2 * Math.PI * (440 + 220 * c) * i) / 48_000) + 0.2 * Math.sin((2 * Math.PI * 5_000 * i) / 48_000) + 0.1 * (2 * rnd() - 1);
    x[i * channels + c] = Math.max(-full, Math.min(full - 1, Math.round(s * full)));
  }
  x[0] = -full; x[1] = full - 1;
  return x;
}
/** Integer PCM as raw bytes: u8 (signed + 128), s16le or s24le. */
export function rawPcm(x: Int32Array, depth: 8 | 16 | 24): Buffer {
  const width = depth / 8; const b = Buffer.alloc(x.length * width);
  x.forEach((v, i) => { if (depth === 8) b[i] = v + 128; else if (depth === 16) b.writeInt16LE(v, 2 * i); else b.writeIntLE(v, 3 * i, 3); });
  return b;
}
/** The reference decode of integer PCM (Decode worker: sample ÷ 2^(depth − 1) as f32), as the bytes its hash is of. */
export function referencePcm(x: Int32Array, depth: number): Buffer {
  const b = Buffer.alloc(x.length * 4);
  x.forEach((v, i) => b.writeFloatLE(v / 2 ** (depth - 1), 4 * i));
  return b;
}
/** The lossy fixtures' source: 3 s of stereo at 48 kHz, tones, a sweep and seeded noise, well inside full scale. */
export function lossySource(): Buffer {
  const frames = 3 * 48_000; const rnd = seeded(503); const b = Buffer.alloc(frames * 2 * 4);
  for (let i = 0; i < frames; i++) {
    const t = i / 48_000;
    const l = 0.3 * Math.sin(2 * Math.PI * 440 * t) + 0.1 * Math.sin(2 * Math.PI * (200 + 2000 * t) * t) + 0.03 * (2 * rnd() - 1);
    const r = 0.25 * Math.sin(2 * Math.PI * 660 * t) + 0.08 * Math.sin(2 * Math.PI * 3150 * t) + 0.03 * (2 * rnd() - 1);
    b.writeFloatLE(l, 8 * i); b.writeFloatLE(r, 8 * i + 4);
  }
  return b;
}
/** FFmpeg's encoders a fixture needs, or the reason one is missing (a BLOCKED line). */
export function encodersMissing(names: string[]): string | null {
  const t = ffmpegTools();
  const enc = spawnSync(t.ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout ?? '';
  const missing = names.filter((n) => !new RegExp(`\\s${n}\\s`).test(enc));
  return missing.length ? `${t.ffmpeg} has no ${missing.join(', ')} encoder, which the fixtures need. Unblock: brew install ffmpeg (with libmp3lame, libopus and AudioToolbox)` : null;
}
/** What ffprobe says of a fixture's first audio stream. */
export function probeAudio(path: string): JsonObject {
  const t = ffmpegTools();
  const j = JSON.parse(execFileSync(t.ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,profile,sample_rate,channels,bits_per_raw_sample,sample_fmt', '-of', 'json', path], { encoding: 'utf8' })) as JsonObject;
  return obj(arr(j['streams'], `ffprobe ${path}: streams`)[0], `ffprobe ${path}: the audio stream`);
}
