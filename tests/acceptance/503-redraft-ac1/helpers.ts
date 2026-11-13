// Test-side tools for the blind redraft of #503 AC1's bar chart: the criterion's sound, written at test time as a
// 32-bit float WAV; the chart document; the design's spectrum of that sound computed here, which the bars' heights are
// held to; each bar's height read from a drawn frame; and the judge. The `deep-show` build, the scenario, `deep show`,
// the evidence store and the PNG reader are #501's (../501/helpers.ts), the float WAV writer is #1819's
// (../1819/fixtures/synth.ts), both imported read only. Nothing here stands in for the bake, the column or the drawing:
// every height is read from a frame `deep-show` drew. README: The surface under test.

import { expect } from 'vitest';
import {
  arr, camera2d, decodePng, getEvidence, hex64, int, obj, present, presented, show, str, type Image, type JsonObject,
} from '../501/helpers.ts';
import { wavF32 } from '../1819/fixtures/synth.ts';

/** The criterion's ID (scripts/proof-change.mjs `criterionId`), which starts each test's name. */
export const AC1 = 'AC1 #503.385199c8';
/** The planted wrong program, passed as the scenario's `planted` (README: Wrong programs). */
export const PLANTED = 'spectrum_plays_a_row_late';

// ---------------------------------------------------------------------------------------------------
// The sound: 10 s, mono, 48 kHz, a 937.5 Hz sine of amplitude 0.5 from 2 s to 4 s, silence elsewhere.

export const SAMPLE_RATE = 48_000;
export const SECONDS = 10;
export const TONE = { hz: 937.5, amplitude: 0.5, from: 2 * SAMPLE_RATE, to: 4 * SAMPLE_RATE } as const;

/** The samples as the WAV holds them (f32): the tone's phase is 0 at 2 s, a whole number of cycles from the start. */
export function sound(): Float32Array {
  const x = new Float32Array(SAMPLE_RATE * SECONDS);
  for (let n = TONE.from; n < TONE.to; n++) x[n] = TONE.amplitude * Math.sin((2 * Math.PI * TONE.hz * (n - TONE.from)) / SAMPLE_RATE);
  return x;
}
/** One channel of 32-bit IEEE floats, so the decoded PCM is the samples exactly and no quantization reaches the bands. */
export const soundWav = (x: Float32Array): Uint8Array => wavF32(x, SAMPLE_RATE);

// ---------------------------------------------------------------------------------------------------
// The design's spectrum (Analysis bake: Semantics), computed here from the same f32 samples in f64.

/** The criterion's bake: bands 16, scale log, range [40, 16000], rate 60, window 2048. */
export const SPECTRUM = { bands: 16, scale: 'log', range: [40, 16_000] as [number, number], rate: 60, window: 2048 } as const;
export const FLOOR = -120;

/** The band edges in Hz, spaced evenly in log frequency across the range (band 8 is 800 to 1,163 Hz). */
export function bandEdges(): number[] {
  const [lo, hi] = SPECTRUM.range;
  return Array.from({ length: SPECTRUM.bands + 1 }, (_, i) => lo * (hi / lo) ** (i / SPECTRUM.bands));
}

/** In-place radix-2 FFT of a power-of-two length. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const c = Math.cos(step * k); const s = Math.sin(step * k);
        const a = i + k; const b = a + half;
        const vr = re[b]! * c - im[b]! * s; const vi = re[b]! * s + im[b]! * c;
        re[b] = re[a]! - vr; im[b] = im[a]! - vi;
        re[a] = re[a]! + vr; im[a] = im[a]! + vi;
      }
    }
  }
}

/**
 * Rows 0 … count − 1 of the spectrum, each band's level in dB: row r reads the `window` samples that end at r ÷ rate
 * (samples [800 r − 2048, 800 r), those before the start reading 0) under a periodic Hann window, and each band is
 * 10 log10(Σ|X_k|² ÷ (3N²/32)) over the bins whose centres fall in it (a centre on an edge belongs to the band above),
 * floored at −120 dB. Mono, so the channels' mean is the one channel.
 */
export function spectrumRows(x: Float32Array, count: number): number[][] {
  const n = SPECTRUM.window;
  const edges = bandEdges();
  const bandOf = Array.from({ length: n / 2 + 1 }, (_, k) => {
    const f = (k * SAMPLE_RATE) / n;
    return edges.findIndex((e, i) => i < SPECTRUM.bands && f >= e && f < edges[i + 1]!);
  });
  const hann = Float64Array.from({ length: n }, (_, j) => 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / n));
  const norm = (3 * n * n) / 32;
  const perRow = SAMPLE_RATE / SPECTRUM.rate;
  const rows: number[][] = [];
  for (let r = 0; r < count; r++) {
    const end = r * perRow;
    const re = new Float64Array(n); const im = new Float64Array(n);
    let any = false;
    for (let j = 0; j < n; j++) {
      const at = end - n + j;
      const v = at >= 0 && at < x.length ? x[at]! : 0;
      if (v !== 0) any = true;
      re[j] = v * hann[j]!;
    }
    if (!any) { rows.push(Array.from({ length: SPECTRUM.bands }, () => FLOOR)); continue; }
    fft(re, im);
    const sums = new Array<number>(SPECTRUM.bands).fill(0);
    for (let k = 0; k <= n / 2; k++) { const b = bandOf[k]!; if (b >= 0) sums[b]! += re[k]! * re[k]! + im[k]! * im[k]!; }
    rows.push(sums.map((s) => { const level = 10 * Math.log10(s / norm); return level > FLOOR ? level : FLOOR; }));
  }
  return rows;
}

/** Where this test's own spectrum misses the criterion's values: at 3 s band 8 at −6.02 dB within 0.01 dB and every
 * other band at the floor; at 1 s every band at the floor. Empty when it gives them. */
export function issueValues(rows: number[][]): string[] {
  const out: string[] = [];
  const at3 = rows[3 * SPECTRUM.rate]!; const at1 = rows[SPECTRUM.rate]!;
  at3.forEach((l, i) => {
    if (i === 8 ? Math.abs(l + 6.02) > 0.01 : l !== FLOOR) out.push(`3 s band ${i}: ${l} dB, not ${i === 8 ? '−6.02' : '−120'}`);
  });
  at1.forEach((l, i) => { if (l !== FLOOR) out.push(`1 s band ${i}: ${l} dB, not −120`); });
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The chart: 640 × 360 u, 16 bars on a linear scale of 2 u per dB, each bar from its base at y 340 up to its level.

export const PAGE: [number, number] = [640, 360];
export const FPS = 60;
/** A frame at 60 fps in flicks (705,600,000 ÷ 60). */
export const FRAME = 11_760_000;
export const FRAMES = SECONDS * FPS;
export const BAKE_ID = 'music';
export const ARRAY = `spectrum.${BAKE_ID}`;
const DOMAIN: [number, number] = [-128, 0];
const BASE = 340;
const TOP = 84;
const PX_PER_DB = (BASE - TOP) / (DOMAIN[1] - DOMAIN[0]);
const left = (i: number): number => 40 * i + 8;
const right = (i: number): number => 40 * i + 32;
/** The pixel column at a bar's centre. */
const centre = (i: number): number => 40 * i + 20;
/** A level's bar height in px (1 u is 1 px: the camera shows the page at its size). */
export const heightOf = (level: number): number => (level - DOMAIN[0]) * PX_PER_DB;
/** One pixel either way: an anti-aliased top edge covers at most one pixel partly. */
export const TOLERANCE_PX = 1;

const f32Column = (values: number[]): JsonObject => {
  const b = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => b.writeFloatLE(v, 4 * i));
  return { dtype: 'f32', len: values.length, data: b.toString('base64') };
};
export const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #503 acceptance tests.' };

/** The film: the sound as an asset by its SHA-256, its spectrum bake, and the bar set reading `spectrum.music`. */
export function chart(sha: string): JsonObject {
  const bands = Array.from({ length: SPECTRUM.bands }, (_, i) => i);
  return {
    format: 1, id: 'spectrum-bars', profile: 'film', title: 'Spectrum bars',
    description: 'Sixteen bars, one per spectrum band of a 10 s sound, each as tall as its band\'s level in dB.',
    size: PAGE, camera: 'cam', transport: { span: '10s', frame_rate: [FPS, 1] },
    assets: { tone: { sha256: sha, license: LICENSE } },
    bakes: { [BAKE_ID]: { asset: sha, analyzer: 'spectrum@1', kind: 'spectrum', ...SPECTRUM } },
    items: {
      cam: camera2d(PAGE),
      db: { id: 'db', kind: 'scale@1', name: 'Level scale', order: 'a1', params: { type: 'linear', domain: DOMAIN, range: [BASE, TOP], nice: false } },
      bars: {
        id: 'bars', kind: 'marks@1', name: 'Spectrum bars', order: 'a2',
        params: {
          mark: 'bar',
          columns: { level: { array: ARRAY, as: 'f64' }, x: f32Column(bands.map(left)), x2: f32Column(bands.map(right)), base: { const: BASE } },
          encode: { x: { column: 'x' }, x2: { column: 'x2' }, y: { column: 'level', scale: 'db' }, y2: { column: 'base' } },
          paint: { fill: { role: 'accent' } },
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// The calls: the chart shown, its 600 frames played in order, then each frame seeked to.

/** Each frame once, every step a jump of 241 frames forward or 359 back, never to the next frame. */
export const seekOrder = (): number[] => Array.from({ length: FRAMES }, (_, j) => (241 * j) % FRAMES);
export function calls(doc: string, document: JsonObject): JsonObject[] {
  return [
    present(doc, document),
    { call: 'frames', doc, count: FRAMES, step: '1f', pixels: true },
    ...seekOrder().map((k): JsonObject => ({ call: 'eval', doc, t: k * FRAME, pixels: true })),
  ];
}

// ---------------------------------------------------------------------------------------------------
// Heights read from the drawn frames.

const rgb = (img: Image, x: number, y: number): [number, number, number] => {
  const o = (y * img.width + x) * 4;
  return [img.rgba[o]!, img.rgba[o + 1]!, img.rgba[o + 2]!];
};
/** Each bar's height in px: down its centre column, each pixel's share of the way from the ground to the bars' fill,
 * in the channel where they differ most, summed. The ground is read at (2, 2), the fill 2 px above bar 0's base. */
export function barHeights(img: Image, what: string): number[] {
  expect([img.width, img.height], `${what}: the frame is the page, ${PAGE[0]} × ${PAGE[1]} px`).toEqual(PAGE);
  const ground = rgb(img, 2, 2);
  const fill = rgb(img, centre(0), BASE - 2);
  const diffs = fill.map((v, c) => Math.abs(v - ground[c]!));
  const c = diffs.indexOf(Math.max(...diffs));
  const span = fill[c]! - ground[c]!;
  expect(Math.abs(span) >= 32, `${what}: bar 0 is drawn at its base: the pixel at (${centre(0)}, ${BASE - 2}) is ${fill.join(',')}, the ground ${ground.join(',')}`).toBe(true);
  return Array.from({ length: SPECTRUM.bands }, (_, i) => {
    let h = 0;
    for (let y = 0; y < img.height; y++) h += Math.min(1, Math.max(0, (rgb(img, centre(i), y)[c]! - ground[c]!) / span));
    return h;
  });
}

/** Each frame's 16 heights, played and seeked, [frame][band] in px. */
export interface Drawn { played: number[][]; seeked: number[][] }
/** The replies of `calls` (one per call, as #501's `runShow` holds): the chart presented, `frames` with each frame's
 * PNG, and each `eval`'s snapshot. A missing field fails, naming it. */
export function drawnOf(replies: JsonObject[], evidence: string, what: string): Drawn {
  presented(replies[0]!, `${what}: deep show of the chart`);
  const cache = new Map<string, number[]>();
  const heights = (sha: string, of: string): number[] => {
    let h = cache.get(sha);
    if (!h) { h = barHeights(decodePng(getEvidence(evidence, sha, of)), of); cache.set(sha, h); }
    return h;
  };
  const list = arr(replies[1]!['frames'], `${what}: frames: frames`);
  expect(list.length, `${what}: frames answers each of the ${FRAMES} frames played: ${show(replies[1], 600)}`).toBe(FRAMES);
  const played = list.map((v, k) => {
    const f = obj(v, `${what}: frames[${k}]`);
    expect(int(f['t'], `${what}: frames[${k}].t`), `${what}: frames[${k}] is frame ${k}`).toBe(k * FRAME);
    return heights(hex64(f['pixel_hash'], `${what}: frames[${k}].pixel_hash`), `${what}: frame ${k} played`);
  });
  const seeked: number[][] = new Array<number[]>(FRAMES);
  seekOrder().forEach((k, j) => {
    const reply = replies[2 + j]!;
    const of = `${what}: frame ${k} seeked (eval)`;
    expect(str(reply['outcome'], `${of}: outcome`), `${of} is evaluated: ${show(reply, 600)}`).toBe('evaluated');
    expect(int(reply['t'], `${of}: t`), `${of}: at its time`).toBe(k * FRAME);
    const snaps = arr(reply['snapshots'], `${of}: snapshots`);
    expect(snaps.length, `${of}: one snapshot`).toBe(1);
    seeked[k] = heights(hex64(obj(snaps[0], `${of}: snapshots[0]`)['sha256'], `${of}: snapshots[0].sha256`), of);
  });
  return { played, seeked };
}

const px = (h: number): string => h.toFixed(2);
const when = (k: number): string => `frame ${k} (${(k / FPS).toFixed(3)} s)`;
/** Every way the drawn heights miss the clause: a bar played or seeked more than a pixel from its band's level, and a
 * bar whose played and seeked heights differ. Each failure starts with its frame. */
export function judge(drawn: Drawn, levels: number[][]): string[] {
  const out: string[] = [];
  for (let k = 0; k < FRAMES; k++) {
    const row = levels[k]!;
    for (const [side, list] of [['played', drawn.played], ['seeked', drawn.seeked]] as const) {
      list[k]!.forEach((h, i) => {
        const want = heightOf(row[i]!);
        if (Math.abs(h - want) > TOLERANCE_PX) out.push(`${when(k)} ${side}: band ${i} is ${px(h)} px tall; its level ${row[i]!.toFixed(2)} dB reads ${px(want)} px`);
      });
    }
    drawn.played[k]!.forEach((h, i) => {
      const s = drawn.seeked[k]![i]!;
      if (h !== s) out.push(`${when(k)}: band ${i} is ${px(h)} px played and ${px(s)} px seeked`);
    });
  }
  return out;
}
