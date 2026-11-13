// Test-side tools for the #204 acceptance tests (criteria 1 to 15): `deep-show` built once per file and driven by one
// JSON scenario on stdin (`deep-show run`, as #499's, #500's and #1818's suites drive it); fixture packs that carry
// synth presets in their manifests' `presets`, written at run time and installed with `install_pack` (#306); media
// documents whose strips and Spawn templates take `src: {synth: …}` (Synth `synth@1`, As built); the `media_mix` call
// with the reply fields this suite reads (README: The surface under test); the panel world for the live transport
// (#498's gate, #499's `handed`); the film world for an export (#501, #502); a logic program written as WebAssembly
// bytes by hand; and the readings the tests judge samples by. Nothing here stands in for a node, a preset, the pack
// check, the mixer, the gate, the export or the meter: each is read from what `deep-show` answers or writes.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { arr, decodeWav, getAsset, int, interleaved, isObject, num, obj, putAsset, sha256, str, type JsonObject, type JsonValue } from '../499/mix/helpers.ts';

export { arr, int, isObject, num, obj, putAsset, sha256, str, type JsonObject, type JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/204 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const SHOW_BIN = 'deep-show';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
/** Every `it` passes this timeout: a first build of `deep-show` on a shared Mac can take many minutes. */
export const TIMEOUT = 3_600_000;

/** Each criterion's ID (scripts/proof-change.mjs: `#<issue>.<8 hex of the text's sha256>`), which starts its test's name. */
export const AC = {
  1: 'AC1 #204.47d50ee6',
  2: 'AC2 #204.a92b7fff',
  3: 'AC3 #204.0e49d0c7',
  4: 'AC4 #204.9195397b',
  5: 'AC5 #204.5aacbddd',
  6: 'AC6 #204.9d525978',
  7: 'AC7 #204.4e815a43',
  8: 'AC8 #204.0458a4e3',
  9: 'AC9 #204.33127906',
  10: 'AC10 #204.f87a60ba',
  11: 'AC11 #204.2ade263b',
  12: 'AC12 #204.ba5e9d18',
  13: 'AC13 #204.cb2d85e8',
  14: 'AC14 #204.fe8c5ca9',
  15: 'AC15 #204.a523543e',
} as const;

/** The wrong programs, each named in the scenario's `planted` (README: Planted programs). */
export type Planted =
  | 'synth_holds_params_per_frame'
  | 'osc_phase_f32'
  | 'synth_grid_from_seek'
  | 'synth_reads_logic_per_frame'
  | 'synth_bypasses_master'
  | 'spawn_synth_starts_next_block'
  | 'export_synth_block_64'
  | 'synth_ring_drops_oldest'
  | 'shaper_bias'
  | 'synth_tail_halved'
  | 'steal_keeps_filter_state'
  | 'crush_7_bits';

/** A failure that isn't a pass: off the reference Mac, a budget is a reading. */
export function inconclusive(reason: string): never { return expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`); }
/** A judge's failures, which must be none. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}: ${failures.slice(0, 8).join(' | ')}`).toEqual([]);
}
/** A wrong program's failures, which must include one matching `named`. */
export function failsNaming(failures: readonly string[], named: RegExp, what: string): void {
  expect(failures.length > 0 && failures.some((f) => named.test(f)), `${what} fails, naming ${named}; got ${JSON.stringify(failures.slice(0, 8))}`).toBe(true);
}
export const show = (v: unknown, n = 800): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';

// ---------------------------------------------------------------------------------------------------
// The build: `cargo build --locked --bin deep-show` once per file, copied out of the target folder (honoring
// CARGO_TARGET_DIR), as #499's and #1818's suites do; a test that uses a build that failed fails, naming it.

function cargoBuild(): string {
  const args = ['build', '--locked', '--bin', SHOW_BIN];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}

/** The deep-show binary for this file's tests. */
export function useShow(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-204-bin-'));
    error = cargoBuild();
    const target = process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
    if (error === '') copyFileSync(join(target, 'debug', exe(SHOW_BIN)), join(dir, exe(SHOW_BIN)));
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo build --locked --bin ${SHOW_BIN}`).toBe('');
    return join(dir, exe(SHOW_BIN));
  };
}

/** A fresh folder per call (an evidence store, a pack root, an export folder), all deleted after the test. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => {
    const d = mkdtempSync(join(tmpdir(), 'deep-204-'));
    made.push(d);
    return d;
  };
}

const SURFACE = 'synth@1 on a strip or a Spawn template, presets in a pack\'s manifest, `install_pack`, `media_mix`\'s `synths`, `taps`, `seek` and `seek_ms`, README: The surface under test';

/** `deep-show run` on one scenario line: exit 0, one line out, answered ok with one reply per call, in call order. A run
 * that hangs is stopped by spawnSync's own timeout, which signals only this child. Returns the replies and the wall time. */
export function runTimed(bin: string, s: JsonObject, what: string, timeoutMs = 1_800_000): { replies: JsonObject[]; ms: number } {
  const t0 = performance.now();
  const r = spawnSync(bin, ['run'], {
    cwd: REPO, input: `${JSON.stringify(s)}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL',
  });
  const ms = performance.now() - t0;
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${what}: deep-show run did not finish within ${timeoutMs} ms`);
  const stdout = r.stdout ?? '';
  expect(r.status, `${what}: deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 800)}; stderr: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  const out = stdout.split('\n').filter((l) => l !== '');
  expect(out.length, `${what}: one output line for the one scenario line`).toBe(1);
  const answer = obj(JSON.parse(out[0]!) as JsonValue, `${what}: the answer`);
  expect(answer['ok'], `${what}: deep-show run answers the scenario ok (${SURFACE}${s['planted'] ? `, planted ${String(s['planted'])}` : ''}); got ${show(answer, 600)}`).toBe(true);
  const replies = arr(answer['replies'], `${what}: replies`).map((v, i) => obj(v, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(arr(s['calls'], 'calls').length);
  return { replies, ms };
}
export const runShow = (bin: string, s: JsonObject, what: string, timeoutMs?: number): JsonObject[] => runTimed(bin, s, what, timeoutMs).replies;

// ---------------------------------------------------------------------------------------------------
// Time (Time and the flick): 705,600,000 flicks a second; a 48 kHz sample is 14,700 flicks, a 44.1 kHz one 16,000.

export const FLICKS = 705_600_000;
export const SEC = FLICKS;
export const MS = FLICKS / 1000;
export const RATE = 48_000;
/** Synth `synth@1`, As built: the block rule's block. */
export const BLOCK = 128;
/** Seconds to whole flicks. */
export const secs = (s: number): number => Math.round(s * SEC);
/** Sample n's time in flicks at `rate`. */
export const atSample = (n: number, rate = RATE): number => (n * FLICKS) / rate;
/** The first sample at or after a time. */
export const sampleAt = (t: number, rate = RATE): number => Math.ceil((t * rate) / FLICKS);
/** A sample index as seconds, for messages. */
export const sOf = (n: number, rate = RATE): string => `${(n / rate).toFixed(6)} s (sample ${n})`;
export const toDb = (g: number): number => 20 * Math.log10(g);
export const fmt = (x: number, d = 2): string => (Number.isFinite(x) ? x.toFixed(d) : String(x));

// ---------------------------------------------------------------------------------------------------
// Synth presets and the packs that carry them (Synth `synth@1`, As built: "Presets in a pack", "Preset fields",
// "Edges", "Nodes").

/** A node: its kind from the closed list and its fields beside it *(chosen: the Processor's form, `{kind, …fields}`)*.
 * A numeric field takes a number or the name of one of the preset's params. */
export type Node = JsonObject & { kind: string };
/** A param: its unit, its range [low, high] and its default, in the field's own unit. */
export interface Param { unit: string; range: [number, number]; default: number }
/** A preset: `{nodes, edges: [[from, to, input]], out, params, cost}` (cost: multiply-adds per sample per voice). */
export interface Preset { nodes: Record<string, Node>; edges: [string, string, string][]; out: string; params: Record<string, Param>; cost: number }

/** A pack written on disk: its ID `test/<name>`, the folder `install_pack` reads, and its version. */
export interface PackFixture { id: string; name: string; version: string; dir: string }
/** `owner/name@version`, as a document's `packs` names a pack version. */
export const packRef = (p: PackFixture): string => `${p.id}@${p.version}`;
/** A preset's name in a document: `<pack>.<name>@<major>`, from the pack's name half. */
export const presetOf = (p: PackFixture, name: string): string => `${p.name}.${name}@1`;

/** Writes `<root>/<name>-<version>/pack.json`: a pack whose manifest carries `presets: {<name>@1 → preset}`. */
export function writePack(root: string, name: string, presets: Record<string, Preset>, version = '1.0.0'): PackFixture {
  const dir = join(root, `${name}-${version}`);
  mkdirSync(dir, { recursive: true });
  const manifest = {
    name, version, license: 'MIT',
    description: `A fixture pack of the #204 acceptance suite: synth presets as data (${Object.keys(presets).join(', ')}).`,
    requires: { core: '>=0.0.0', modules: { media: '>=0.0.0' } },
    presets: Object.fromEntries(Object.entries(presets).map(([n, p]) => [`${n}@1`, p])),
  };
  writeFileSync(join(dir, 'pack.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { id: `test/${name}`, name, version, dir };
}
/** `install_pack` (#306): one pack version read from its folder and put through the pack check once. */
export const installCall = (p: PackFixture, at?: number): JsonObject => ({ call: 'install_pack', id: p.id, dir: p.dir, ...(at === undefined ? {} : { at }) });

export interface Install { outcome: string; issues: JsonObject[] }
export function installOf(reply: JsonObject | undefined, what: string): Install {
  const r = obj(reply, what);
  const outcome = str(r['outcome'], `${what}: install_pack's outcome`);
  const issues = arr(r['issues'], `${what}: install_pack's issues`).map((v, i) => obj(v, `${what}: issues[${i}]`));
  return { outcome, issues };
}
/** A pack the check admits: `installed`, no issue. */
export function installed(reply: JsonObject | undefined, what: string): void {
  const r = installOf(reply, what);
  expect([r.outcome, r.issues.length], `${what}: the pack check admits it (outcome installed, no issue); got ${show(reply, 1500)}`).toEqual(['installed', 0]);
}

// ---------------------------------------------------------------------------------------------------
// Nodes and presets the fixtures share

export const osc = (wave: 'sine' | 'saw' | 'square' | 'triangle', hz: number | string): Node => ({ kind: 'osc', wave, hz });
export const noise = (color: 'white' | 'pink' | 'brown'): Node => ({ kind: 'noise', color });
export const gain = (g: number | string): Node => ({ kind: 'gain', gain: g });
export const mix = (): Node => ({ kind: 'mix' });
export const env = (attack: number, hold: number, decay: number, sustain: number, release: number): Node => ({ kind: 'env', attack, hold, decay, sustain, release });
export const biquad = (type: string, freq: number | string, q: number, g = 0): Node => ({ kind: 'biquad', type, freq, q, gain: g });
export const delay = (time: number, feedback: number, wet: number): Node => ({ kind: 'delay', time, feedback, mix: wet });

/** The engine (criteria 1, 2's form, 7, 8, 9): a sine whose frequency is the param `hz`, at half scale. Cost: osc 4 + gain 1. */
export const ENGINE: Preset = {
  nodes: { tone: osc('sine', 'hz'), level: gain(0.5) },
  edges: [['tone', 'level', 'in']],
  out: 'level',
  params: { hz: { unit: 'Hz', range: [60, 180], default: 60 } },
  cost: 5,
};
/** The engine's frequency: 60 Hz plus 4 Hz per m/s of the car's speed channel. */
export const ENGINE_HZ = '60 + 4 * speed';

// ---------------------------------------------------------------------------------------------------
// Documents (README: The surface under test). Times are flicks; a channel's keys are the Channel row's.

/** A synth source: `src: {synth: {preset, params, voices, seed, byte_budget}}`. */
export interface Synth { preset: string; params?: Record<string, string>; voices?: number; seed?: number; byte_budget?: number }
export const synthSrc = (s: Synth): JsonObject => ({
  synth: {
    preset: s.preset, params: (s.params ?? {}) as JsonObject, voices: s.voices ?? 1, seed: s.seed ?? 204,
    ...(s.byte_budget === undefined ? {} : { byte_budget: s.byte_budget }),
  },
});
/** A strip that plays a synth from `start` for `span`. */
export const synthStrip = (track: number, s: Synth, start: number, span: number, bus?: string): JsonObject =>
  ({ track, src: synthSrc(s), start, span, ...(bus ? { bus } : {}) });
/** A strip that plays an asset from its start to its end (#499's form). */
export const assetStrip = (track: number, asset: string, start: number, extra: JsonObject = {}): JsonObject =>
  ({ track, src: { asset }, start, in: 0, ...extra });

export type Key = [t: number, value: number, interp?: 'linear' | 'hold'];
/** A channel (Channel and key): `{target, type: f32, keys: {ID → {t, value, interp}}}`. */
export const channel = (target: string, keys: Key[]): JsonObject => ({
  target, type: 'f32',
  keys: Object.fromEntries(keys.map(([t, value, interp], i) => [`k${i}`, { t, value, interp: interp ?? 'linear' }])),
});

export interface MediaDoc {
  rate?: number;
  span: number;
  packs: PackFixture[];
  strips?: Record<string, JsonObject>;
  channels?: Record<string, JsonObject>;
  extra?: JsonObject;
}
/** A media document (#499's, with `packs` pinned as a document pins them and synth strips). */
export function mediaDoc(d: MediaDoc): JsonObject {
  return {
    transport: { sample_rate: d.rate ?? RATE, span: d.span },
    packs: d.packs.map(packRef),
    strips: (d.strips ?? {}) as JsonObject,
    ...(d.channels ? { channels: d.channels as JsonObject } : {}),
    ...(d.extra ?? {}),
  };
}

// ---------------------------------------------------------------------------------------------------
// `media_mix` (#499): one transport playing and seeking through its segments in order. The reply as #499 built it,
// with this suite's fields (README): `mix.synths`, a synth node's output hash in `taps`, a synth's restore in `seek`,
// and `seek_ms`.

export interface SegmentAsk { from: number; to: number; write?: boolean }
export interface Sought { restored: number | null; rendered_from: number }
export interface SegmentReply {
  from: number; to: number; first: number; frames: number; channels: number; sha256: string; wav: string | null;
  taps: Record<string, string>; seek: null | Record<string, Sought>; raw: JsonObject;
}
export interface MixReply { rate: number; segments: SegmentReply[]; synths: Record<string, JsonObject>; raw: JsonObject }

const hex64 = (v: JsonValue | undefined, what: string): string => {
  const s = str(v, what);
  expect(/^[0-9a-f]{64}$/.test(s), `${what} is a SHA-256 in lower-case hex: ${s}`).toBe(true);
  return s;
};

export const mixCall = (doc: JsonObject, segments: SegmentAsk[], extra: JsonObject = {}): JsonObject => ({
  call: 'media_mix', doc, segments: segments.map((s) => ({ from: s.from, to: s.to, ...(s.write ? { write: true } : {}) })), ...extra,
});

/** A `media_mix` reply; a field this suite reads that is missing fails, naming it. */
export function mixOf(reply: JsonObject | undefined, asks: SegmentAsk[], rate: number, what: string): MixReply {
  const r = obj(reply, what);
  expect('mix' in r, `${what}: media_mix answers a mix; got ${show(r, 800)}`).toBe(true);
  const m = obj(r['mix'], `${what}: mix`);
  expect(int(m['sample_rate'], `${what}: mix.sample_rate`), `${what}: mix.sample_rate is the transport's`).toBe(rate);
  const segs = arr(m['segments'], `${what}: mix.segments`);
  expect(segs.length, `${what}: one segment reply per segment asked`).toBe(asks.length);
  return {
    rate,
    segments: segs.map((v, i) => {
      const w = `${what}: mix.segments[${i}]`;
      const g = obj(v, w);
      const first = int(g['first'], `${w}.first`);
      const frames = int(g['frames'], `${w}.frames`);
      expect([first, first + frames], `${w}: the segment covers the samples asked`).toEqual([sampleAt(asks[i]!.from, rate), sampleAt(asks[i]!.to, rate)]);
      const taps = obj(g['taps'], `${w}.taps`);
      expect('seek' in g, `${w}: the field \`seek\` is present (null, or what each processor and synth restored)`).toBe(true);
      const seek = g['seek'] === null ? null : Object.fromEntries(Object.entries(obj(g['seek'], `${w}.seek`)).map(([id, p]) => {
        const o = obj(p, `${w}.seek.${id}`);
        expect('restored' in o, `${w}.seek.${id}.restored is present (null or a checkpoint's t)`).toBe(true);
        return [id, { restored: o['restored'] === null ? null : int(o['restored'], `${w}.seek.${id}.restored`), rendered_from: int(o['rendered_from'], `${w}.seek.${id}.rendered_from`) }];
      }));
      return {
        from: asks[i]!.from, to: asks[i]!.to, first, frames, channels: int(g['channels'], `${w}.channels`), sha256: hex64(g['sha256'], `${w}.sha256`),
        wav: asks[i]!.write ? str(g['wav'], `${w}.wav (asked with write: true)`) : null,
        taps: Object.fromEntries(Object.entries(taps).map(([id, h]) => [id, hex64(h, `${w}.taps.${id}`)])), seek, raw: g,
      };
    }),
    synths: isObject(m['synths']) ? Object.fromEntries(Object.entries(m['synths']).map(([id, s]) => [id, obj(s, `${what}: mix.synths.${id}`)])) : {},
    raw: m,
  };
}
/** One synth strip's report: `mix.synths.<strip ID>`; missing fails, naming it. */
export function synthOf(m: MixReply, strip: string, what: string): JsonObject {
  expect(isObject(m.raw['synths']), `${what}: mix.synths, each synth strip's report, is present; got ${show(m.raw['synths'] ?? null)}`).toBe(true);
  expect(m.synths[strip], `${what}: mix.synths.${strip} reports the synth strip \`${strip}\`; got ${show(Object.keys(m.synths))}`).toBeDefined();
  return m.synths[strip]!;
}
export interface Ring { budget: number; bytes: number; peak_bytes: number; spacing: number; checkpoints: { t: number; bytes: number }[] }
/** A synth's checkpoint ring, in the processors' report form (#499). */
export function ringOf(report: JsonObject, what: string): Ring {
  const r = obj(report['ring'], `${what}.ring`);
  return {
    budget: int(r['budget'], `${what}.ring.budget`), bytes: int(r['bytes'], `${what}.ring.bytes`), peak_bytes: int(r['peak_bytes'], `${what}.ring.peak_bytes`),
    spacing: int(r['spacing'], `${what}.ring.spacing`),
    checkpoints: arr(r['checkpoints'], `${what}.ring.checkpoints`).map((c, k) => {
      const x = obj(c, `${what}.ring.checkpoints[${k}]`);
      return { t: int(x['t'], `${what}.ring.checkpoints[${k}].t`), bytes: int(x['bytes'], `${what}.ring.checkpoints[${k}].bytes`) };
    }),
  };
}

/** Mixes, one `media_mix` call each, in one offline scenario (installs first). */
export function mixes(bin: string, evidence: string, packs: PackFixture[], asks: { doc: JsonObject; segments: SegmentAsk[]; rate?: number }[], what: string, planted?: Planted): MixReply[] {
  const label = planted ? `${what} (planted ${planted})` : what;
  const calls: JsonObject[] = [...packs.map((p) => installCall(p)), ...asks.map((a) => mixCall(a.doc, a.segments))];
  const replies = runShow(bin, { evidence, ...(planted ? { planted } : {}), calls }, label);
  packs.forEach((p, i) => installed(replies[i], `${label}: the pack ${p.id}`));
  return asks.map((a, i) => mixOf(replies[packs.length + i], a.segments, a.rate ?? RATE, `${label}: media_mix ${i + 1}`));
}

// ---------------------------------------------------------------------------------------------------
// PCM: a float WAV in the evidence store, tied to the reply's hash of its interleaved f32le samples.

export interface Pcm { first: number; frames: number; rate: number; channels: Float32Array[] }

/** A written segment's (or a `handed` reply's) WAV: IEEE float, the reply's rate, channels and length, its samples
 * hashing (interleaved f32le) to the reply's `sha256`. */
export function pcmOf(evidence: string, g: { first: number; frames: number; channels: number; sha256: string; wav: string | null }, rate: number, what: string): Pcm {
  expect(g.wav, `${what}: a WAV was written (write: true)`).not.toBeNull();
  const wav = decodeWav(getAsset(evidence, g.wav!, `${what}: the WAV`), `${what}: the WAV ${g.wav}`);
  expect(wav.float, `${what}: the WAV is IEEE float 32-bit, the mix's own samples`).toBe(true);
  expect(wav.sampleRate, `${what}: the WAV's sample rate`).toBe(rate);
  expect(wav.channels.length, `${what}: the WAV's channel count is the reply's`).toBe(g.channels);
  expect(wav.frames, `${what}: the WAV holds the reply's frames`).toBe(g.frames);
  expect(sha256(interleaved(wav.channels)), `${what}: the WAV's samples, interleaved f32le, hash to the reply's sha256`).toBe(g.sha256);
  return { first: g.first, frames: g.frames, rate, channels: wav.channels };
}
/** The interleaved f32le bytes of samples [from, to) of each channel (a missing sample reads 0). */
export function interleavedOf(chs: Float32Array[], from: number, to: number): Uint8Array {
  const b = Buffer.alloc(Math.max(0, to - from) * chs.length * 4);
  let o = 0;
  for (let i = from; i < to; i++) for (const c of chs) { b.writeFloatLE(c[i] ?? 0, o); o += 4; }
  return new Uint8Array(b);
}
/** The sample at absolute index n on channel c. */
export const at = (p: Pcm, c: number, n: number): number => p.channels[c]![n - p.first]!;

/** The first absolute sample where two PCMs differ on any channel over [from, to) (bit for bit), or null. */
export function firstDiff(a: Pcm, b: Pcm, from = Math.max(a.first, b.first), to = Math.min(a.first + a.frames, b.first + b.frames)): number | null {
  expect(a.channels.length, 'two PCMs compared have the same channel count').toBe(b.channels.length);
  for (let n = from; n < to; n++) for (let c = 0; c < a.channels.length; c++) if (!Object.is(at(a, c, n), at(b, c, n))) return n;
  return null;
}
/** The largest magnitude over [from, to) on every channel. */
export function peak(p: Pcm, from: number, to: number): number {
  let m = 0;
  for (const c of p.channels) for (let n = Math.max(from, p.first); n < Math.min(to, p.first + p.frames); n++) m = Math.max(m, Math.abs(c[n - p.first]!));
  return m;
}
/** Samples [from, to) of each channel, as their own buffers. */
export const slice = (p: Pcm, from: number, to: number): Float32Array[] => p.channels.map((c) => c.slice(from - p.first, to - p.first));

/** IEEE float 32-bit WAV bytes. */
export function floatWav(channels: Float32Array[], rate = RATE): Uint8Array {
  const nch = channels.length;
  const frames = channels[0]!.length;
  const data = frames * nch * 4;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(3, 20); b.writeUInt16LE(nch, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * nch * 4, 28); b.writeUInt16LE(nch * 4, 32); b.writeUInt16LE(32, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(data, 40);
  let o = 44;
  for (let i = 0; i < frames; i++) for (const c of channels) { b.writeFloatLE(c[i]!, o); o += 4; }
  return new Uint8Array(b);
}
export const putSignal = (evidence: string, channels: Float32Array[], rate = RATE): string => putAsset(evidence, floatWav(channels, rate));
/** amp · sin(2π · hz · n / rate). */
export function sine(hz: number, frames: number, amp: number, rate = RATE): Float32Array {
  const x = new Float32Array(frames);
  for (let n = 0; n < frames; n++) x[n] = amp * Math.sin((2 * Math.PI * hz * n) / rate);
  return x;
}

/** #500's `media_bake` loudness bake of an asset: its true peak in dBTP at `oversample`. */
export const bakeCall = (asset: string, oversample: 4 | 8): JsonObject => ({ call: 'media_bake', bake: { asset, kind: 'loudness', tp_oversample: oversample } });
export function truePeakOf(reply: JsonObject | undefined, asset: string, what: string): number {
  const b = obj(obj(reply, what)['bake'], `${what}: bake`);
  expect(b['asset'], `${what}: bake.asset is the asset asked`).toBe(asset);
  return num(b['true_peak'], `${what}: bake.true_peak (dBTP)`);
}

/** Per channel, the least-squares gain of `y` on `ref` over [from, to) and the residual's energy against the fitted
 * reference's, in dB. */
export function fit(y: Float32Array, ref: Float64Array, from: number, to: number): { gain: number; db: number } {
  let yr = 0, rr = 0;
  for (let n = from; n < to; n++) { yr += y[n]! * ref[n]!; rr += ref[n]! * ref[n]!; }
  const g = rr > 0 ? yr / rr : 0;
  let e = 0, s = 0;
  for (let n = from; n < to; n++) { const d = y[n]! - g * ref[n]!; e += d * d; s += (g * ref[n]!) ** 2; }
  return { gain: g, db: s > 0 ? 10 * Math.log10(e / s) : Infinity };
}

/** The frequency of a steady tone's largest Hann-windowed spectral peak in [lo, hi] Hz (Goertzel power), coarse to fine. */
export function pitch(x: Float32Array, rate: number, lo = 50, hi = 4000): number {
  const w = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) w[i] = x[i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (x.length - 1)));
  const best = (from: number, to: number, step: number): number => {
    let hz = from, most = -1;
    for (let k = 0; from + k * step <= to + 1e-9; k++) {
      const f = from + k * step;
      const c = 2 * Math.cos((2 * Math.PI * f) / rate);
      let s1 = 0, s2 = 0;
      for (let i = 0; i < w.length; i++) { const s0 = w[i]! + c * s1 - s2; s2 = s1; s1 = s0; }
      const p = s1 * s1 + s2 * s2 - c * s1 * s2;
      if (p > most) { most = p; hz = f; }
    }
    return hz;
  };
  const coarse = best(lo, hi, 2);
  const medium = best(coarse - 4, coarse + 4, 0.1);
  return best(medium - 0.1, medium + 0.1, 0.005);
}

// ---------------------------------------------------------------------------------------------------
// The panel world for the live transport (#400's virtual display clock, #498's gate, #499's `open` with a media
// document, `play` and `handed`): two displays, the main window with one panel, every call at a flick, played again
// from the start with each step's calls added, as #499's and #1163's suites drive it.

const DISPLAYS: JsonObject[] = [
  { uuid: '37D8832A-2D66-02CA-B9F7-8F30A301B230', bounds: [0, 0, 1512, 982], scale: 2, refresh_hz: 120, next_vsync: FLICKS / 120, color_space: 'p3' },
  { uuid: '9C1E5F4B-6A2D-4E8F-A1B3-0D2C7E6F5A49', bounds: [1512, 0, 1920, 1080], scale: 1, refresh_hz: 60, next_vsync: 3 * MS, color_space: 'srgb' },
];
/** Your shell (3000, 3001, and 3002, which runs `deep show`) and the test agent (4100). */
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
export const AGENT = 'sess-alpha';
const SESSIONS: JsonObject = { [AGENT]: { thread: 'thread-alpha', name: 'Test agent: synth', process: { pid: 4100, start: 1_000 } } };
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
export const PANEL = 'player';
const PANEL_RECT: [number, number, number, number] = [0, 0, 960, 540];
/** A document the hub minted: the film the panel shows (criterion 7). */
export const DOC = '01JB204D000000000000000001';

export interface World { evidence: string; planted?: Planted; film?: boolean }
export function appScenario(w: World, calls: JsonObject[]): JsonObject {
  const sorted = calls.map((c, i) => ({ c, i })).sort((p, q) => int(p.c['at'], 'a call\'s at') - int(q.c['at'], 'a call\'s at') || p.i - q.i).map((p) => p.c);
  return {
    evidence: w.evidence, sessions: SESSIONS, processes: PROCESSES, clock: { lead: 2 * MS, check: MS / 2 }, displays: DISPLAYS, window: [1200, 700],
    panels: { [PANEL]: { rect: PANEL_RECT } }, ...(w.film ? { docs: { [DOC]: { panel: PANEL } } } : {}),
    ...(w.planted ? { planted: w.planted } : {}), calls: sorted,
  };
}
/** Drives one world step by step on the virtual clock: each step's calls may use what the steps before answered (a
 * serial), and the whole scenario is played again from the start with them added. */
export class Driver {
  private calls: JsonObject[] = [];
  constructor(private readonly bin: string, private readonly world: World) {}
  step(added: JsonObject[], what: string): JsonObject[] {
    const fresh = added.map((c) => ({ ...c }));
    const s = appScenario(this.world, [...this.calls, ...fresh]);
    const replies = runShow(this.bin, s, this.world.planted ? `${what} (planted ${this.world.planted})` : what);
    const sorted = arr(s['calls'], 'calls');
    this.calls = [...this.calls, ...fresh];
    return fresh.map((c) => replies[sorted.indexOf(c)]!);
  }
}
const centre = (): [number, number] => [PANEL_RECT[0] + PANEL_RECT[2] / 2, PANEL_RECT[1] + PANEL_RECT[3] / 2];
/** Your click in the panel: a press at its centre and its release 60 ms later; the press's reply holds its serial. */
export const click = (t: number): JsonObject[] => [
  { call: 'input', at: t, panel: PANEL, event: { type: 'down', pos: centre() } },
  { call: 'input', at: t + 60 * MS, panel: PANEL, event: { type: 'up', pos: centre() } },
];
export const CLICK_UP = 60 * MS;
/** Opens a media document in the panel (#499's `open` with `media`). */
export const openMedia = (t: number, doc: string, media: JsonObject): JsonObject => ({ call: 'open', at: t, panel: PANEL, doc, media });
/** Play in the panel: your press (the serial of your click there), the agent's request, or the panel's own. */
export const play = (t: number, by: { serial: number } | { session: string } | 'panel'): JsonObject =>
  ({ call: 'play', at: t, panel: PANEL, ...(by === 'panel' ? {} : by) });
export const gateCall = (t: number): JsonObject => ({ call: 'gate', at: t, panel: PANEL });
/** The PCM the panel's live transport handed the device gate over [from, to) of the document's time, asked at `t`. */
export const handed = (t: number, from: number, to: number): JsonObject => ({ call: 'handed', at: t, panel: PANEL, from, to });
export const serialOf = (reply: JsonObject | undefined, what: string): number => int(obj(reply, what)['serial'], `${what}: serial (the input router's serial for your input)`);
export const opened = (reply: JsonObject | undefined): boolean => isObject(reply) && reply['opened'] === true && !('code' in reply);
export const playing = (reply: JsonObject | undefined): boolean => isObject(reply) && reply['playing'] === true && !('code' in reply);
export function gateOf(reply: JsonObject | undefined, what: string): { owner: string; granted_by: number | null; state: string } {
  const g = obj(obj(reply, what)['gate'], `${what}: gate`);
  expect('granted_by' in g, `${what}: gate.granted_by is present`).toBe(true);
  return { owner: str(g['owner'], `${what}: gate.owner`), granted_by: g['granted_by'] === null ? null : int(g['granted_by'], `${what}: gate.granted_by`), state: str(g['state'], `${what}: gate.state`) };
}
/** A `handed` reply, as a segment-like record for `pcmOf`. */
export function handedOf(reply: JsonObject | undefined, from: number, to: number, what: string): { first: number; frames: number; channels: number; sha256: string; wav: string } {
  const h = obj(obj(reply, what)['handed'], `${what}: handed (${show(reply, 400)})`);
  expect(int(h['sample_rate'], `${what}: handed.sample_rate`), `${what}: handed.sample_rate is the transport's`).toBe(RATE);
  const first = int(h['first'], `${what}: handed.first`);
  const frames = int(h['frames'], `${what}: handed.frames`);
  expect([first, first + frames], `${what}: handed covers the document's samples asked`).toEqual([sampleAt(from), sampleAt(to)]);
  return { first, frames, channels: int(h['channels'], `${what}: handed.channels`), sha256: hex64(h['sha256'], `${what}: handed.sha256`), wav: str(h['wav'], `${what}: handed.wav`) };
}

// ---------------------------------------------------------------------------------------------------
// The film world (criterion 7): `deep show` of a whole film from your shell (#393), `export` (#501, #502) and
// `media_decode` (#498).

const atOf = (at?: number): JsonObject => (at === undefined ? {} : { at });
/** `deep show` of a whole film from your shell (#393), its issues included. */
export const present = (document: JsonObject, at?: number): JsonObject => ({ call: 'deep show', ...atOf(at), peer: YOU_PEER, doc: DOC, document, include: ['issues'] });
export const exportCall = (out: string, profile?: string, at?: number): JsonObject =>
  ({ call: 'export', ...atOf(at), doc: DOC, out, video: { codec: 'h264' }, audio: { codec: 'pcm' }, ...(profile ? { loudness_profile: profile } : {}) });
export const decodeCall = (path: string, out: string): JsonObject => ({ call: 'media_decode', path, out, video_frames: 0 });
/** A scenario with no display clock: your shell, the film's panel, the calls (#501's). */
export const filmScenario = (evidence: string, calls: JsonObject[], planted?: Planted): JsonObject =>
  ({ evidence, sessions: SESSIONS, processes: PROCESSES, panels: { [PANEL]: { rect: PANEL_RECT } }, docs: { [DOC]: { panel: PANEL } }, ...(planted ? { planted } : {}), calls });
export function presented(reply: JsonObject | undefined, what: string): void {
  expect(obj(reply, what)['outcome'], `${what} is presented: ${show(reply, 1500)}`).toBe('presented');
}
const LAYER = 'main';
export const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #204 acceptance tests.' };

/** The engine fixture as a film: 320 × 180 at 24 fps for `seconds` s at 48 kHz, a ground, a car whose x follows the
 * speed channel, and the engine synth strip over the whole span (README: Fixtures). */
export function engineFilm(pack: PackFixture, opts: { seconds?: number; byteBudget?: number } = {}): JsonObject {
  const seconds = opts.seconds ?? 10;
  const rect = (id: string, box: number[], role: string, order: string): JsonObject =>
    ({ id, kind: 'rect@1', layer: LAYER, name: `Rect ${id}`, order, params: { box, paint: { fill: { role } } } });
  return {
    format: 1, id: 'engine', profile: 'film', title: '#204 engine', description: 'The #204 acceptance tests\' engine fixture: a car whose engine pitch follows its speed.',
    size: [320, 180], layers: { [LAYER]: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items: {
      cam: { id: 'cam', kind: 'camera@1', layer: LAYER, name: 'Camera cam', order: 'a0cam', params: { projection: 'orthographic', target: [160, 90, 0], view_width: 320 } },
      back: rect('back', [0, 0, 320, 180], 'ground', 'a1'),
      car: rect('car', [0, 80, 40, 20], 'accent', 'a2'),
    },
    camera: 'cam',
    transport: { span: `${seconds}s`, frame_rate: [24, 1], sample_rate: RATE },
    packs: [packRef(pack)],
    channels: { speed: SPEED },
    strips: { engine: synthStrip(1, { preset: presetOf(pack, 'engine'), params: { hz: ENGINE_HZ }, ...(opts.byteBudget ? { byte_budget: opts.byteBudget } : {}) }, 0, secs(seconds)) },
  };
}
/** The car's speed (m/s), the channel `speed`: 0 to 30 over the first 4 s, then down to 12 by 6.001 s, then held. It
 * drives the car's x, and the engine reads it by its ID. */
export const SPEED: JsonObject = channel('items/car/params/box/0', [[0, 0], [secs(4), 30], [secs(6.001), 12], [secs(10), 12]]);

// ---------------------------------------------------------------------------------------------------
// A logic program as WebAssembly bytes written by hand (criterion 3), as #499's clock suite writes its game: exports
// memory, init(seed), step(k), reads_at and writes_at (Logic `logic@1`: Exports).
//
//   (module
//     (memory (export "memory") 1 1)
//     (global (export "reads_at") i32 (i32.const 0))
//     (global (export "writes_at") i32 (i32.const 4096))
//     (func (export "init") (param $seed i64))
//     (func (export "step") (param $k i64)
//       ;; gain, the write region's one f64: 0 before step 120, 1 from it
//       (f64.store (i32.const 4096) (select (f64.const 1) (f64.const 0) (i64.ge_s (local.get $k) (i64.const 120))))))

function uleb(n: number): number[] {
  const out: number[] = [];
  do { let b = n & 0x7f; n >>>= 7; if (n !== 0) b |= 0x80; out.push(b); } while (n !== 0);
  return out;
}
function sleb(n: number): number[] {
  const out: number[] = [];
  for (;;) {
    const b = n & 0x7f;
    n >>= 7;
    if ((n === 0 && (b & 0x40) === 0) || (n === -1 && (b & 0x40) !== 0)) { out.push(b); return out; }
    out.push(b | 0x80);
  }
}
const vec = (items: number[][]): number[] => [...uleb(items.length), ...items.flat()];
const wname = (s: string): number[] => [...uleb(s.length), ...Buffer.from(s, 'utf8')];
const section = (id: number, body: number[]): number[] => [id, ...uleb(body.length), ...body];
const fbody = (code: number[]): number[] => [...uleb(code.length + 2), 0x00, ...code, 0x0b];
const f64 = (x: number): number[] => { const b = Buffer.alloc(8); b.writeDoubleLE(x); return [...b]; };
/** The step at which the fader's gain turns from 0 to 1. */
export const GAIN_STEP = 120;
export const WRITES_AT = 4096;
export function faderProgram(): Uint8Array {
  const step = [
    0x41, ...sleb(WRITES_AT),
    0x44, ...f64(1), 0x44, ...f64(0),
    0x20, 0x00, 0x42, ...sleb(GAIN_STEP), 0x59, // local.get k; i64.const 120; i64.ge_s
    0x1b, // select
    0x39, 0x03, 0x00, // f64.store align 8, offset 0
  ];
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([[0x60, 1, 0x7e, 0]])), // (i64) -> ()
    ...section(3, vec([[0], [0]])),
    ...section(5, vec([[0x01, 1, 1]])),
    ...section(6, vec([[0x7f, 0x00, 0x41, ...sleb(0), 0x0b], [0x7f, 0x00, 0x41, ...sleb(WRITES_AT), 0x0b]])),
    ...section(7, vec([[...wname('memory'), 0x02, 0], [...wname('reads_at'), 0x03, 0], [...wname('writes_at'), 0x03, 1], [...wname('init'), 0x00, 0], [...wname('step'), 0x00, 1]])),
    ...section(10, vec([fbody([]), fbody(step)])),
  ]);
}
/** The fader logic item (`fader`, 60 Hz, writing `gain`), its program put in the evidence store. */
export function faderItem(evidence: string): { items: JsonObject; assets: JsonObject } {
  const program = faderProgram();
  const sha = putAsset(evidence, program);
  return {
    items: { fader: { id: 'fader', kind: 'logic@1', name: 'Fader', order: 'a0', params: { program: sha, step_rate: 60, writes: { gain: { type: 'f64' } } } } },
    assets: { fader: { sha256: sha, license: LICENSE } },
  };
}

/** The SHA-256 of bytes, hex. */
export const hashOf = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
/** A file's bytes. */
export const read = (path: string): Buffer => readFileSync(path);
