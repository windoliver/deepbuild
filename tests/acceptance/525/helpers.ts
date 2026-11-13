// Test-side tools for #525 (README: The surface under test): `deep-show` built once per file and feature set; `deep-show
// run [--planted <name>]` driven by one JSON scenario on stdin; #498's gate world with #499's test audio backend, a media
// document holding a live world that steps while sound plays, and the readings this suite adds (the transport's block
// log, the gate's stats, a world's occurrence list as played, the recorded input track); `media_mix` as the replay; and
// the golden, the published plan and the export receipt for criterion 3. Nothing here stands in for the transport, the
// world, the spawn, the mixer, the golden or the export: each is read from what the binary answers or writes, and every
// expected value is written from the issue, the design and arithmetic before the binary runs.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/525 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const SHOW = 'deep-show';
const MIB = 1024 * 1024;

/** Each criterion's ID: scripts/proof-change.mjs's, the first eight hex digits of the SHA-256 of its text, trimmed, white
 * space collapsed, computed with that code from the live issue. */
export const CRITERIA = { 1: '#525.06f030c7', 2: '#525.bc91e6a4', 3: '#525.105c2755', 4: '#525.316e3bea' } as const;

/** Every test's own timeout: the ten-minute play logs 225,000 blocks; a build before it may be cold. */
export const TIMEOUT = 3_600_000;

// ---------------------------------------------------------------------------------------------------
// Time (Time and the flick): integers only.

export const FLICKS = 705_600_000;
export const SEC = FLICKS;
export const MS = FLICKS / 1000; // 705,600
/** The transport's sample rate (Transport: `sample_rate: Hz = 48,000`) and the test device's. */
export const RATE = 48_000;
/** Flicks a sample at 48 kHz: 14,700. */
export const SAMPLE = FLICKS / RATE;
/** One audio block, 128 samples (Sound and video on the picture's clock: Blocks): 1,881,600 flicks. */
export const BLOCK = 128;
/** One 120 Hz physics step: 5,880,000 flicks, 400 samples. */
export const STEP = FLICKS / 120;
/** A row's (or any flick's) sample at 48 kHz: ⌊t × 48,000 ÷ 705,600,000⌋, in integers (Time and the flick: Conversions). */
export const sampleOf = (t: number): number => Number((BigInt(t) * BigInt(RATE)) / BigInt(FLICKS));
/** Seconds as flicks, for times written in seconds here. */
export const secs = (s: number): number => Math.round(s * SEC);
export const sOf = (n: number): string => `${(n / RATE).toFixed(6)} s (sample ${n})`;
export const fOf = (t: number): string => `${(t / SEC).toFixed(6)} s (${t} flicks)`;

// ---------------------------------------------------------------------------------------------------
// JSON

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: JsonValue | undefined, n = 800): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v)}`).toBe(true);
  return v as JsonValue[];
}
export function int(v: JsonValue | undefined, what: string): number {
  expect(Number.isSafeInteger(v), `${what} is an integer, got ${show(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v)}`).toBe('string');
  return v as string;
}
export function hex64(v: JsonValue | undefined, what: string): string {
  const s = str(v, what);
  expect(/^[0-9a-f]{64}$/.test(s), `${what} is 64 lowercase hex, got ${s}`).toBe(true);
  return s;
}
/** A failure list must be empty; the message lists every failure. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n${failures.join('\n')}`).toEqual([]);
}
/** A wrong program's failure list: not empty, and one failure names what the criterion says it names. */
export function failsNaming(failures: readonly string[], named: RegExp, what: string): void {
  expect(failures.length, `${what}: the same checks fail on the wrong program`).toBeGreaterThan(0);
  expect(failures.some((f) => named.test(f)), `${what}: a failure names ${named}; the failures were:\n${failures.join('\n')}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// Builds: one `deep-show` per feature set, built once per file before its tests and copied out of the target folder.

/** The default full set, shared with every suite that builds `cargo build --locked --bin deep-show`; and #1920's builds of
 * B at 1.0.0 and at 1.0.1. */
export type BuildSet = 'full' | 'core,test-sim-b' | 'core,test-sim-b-1-0-1';
/** rustup's toolchain and Homebrew's rustup, which keep cargo off this Mac's default PATH. */
const CARGO_DIRS = [join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin'), '/opt/homebrew/opt/rustup/bin'];
const cargoEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  PATH: [...CARGO_DIRS.filter((d) => existsSync(d)), process.env['PATH'] ?? ''].join(delimiter),
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
});
const argsOf = (set: BuildSet): string[] => ['build', '--locked', '--bin', SHOW, ...(set === 'full' ? [] : ['--no-default-features', '--features', set])];

/** Builds `set` and copies the binary to `to`: '' when it built, a line starting `BLOCKED:` when cargo isn't there, else cargo's error. */
function buildTo(set: BuildSet, to: string): string {
  const env = cargoEnv();
  const args = argsOf(set);
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * MIB, env });
  if (run.error) return (run.error as NodeJS.ErrnoException).code === 'ENOENT' ? `BLOCKED: cargo isn't on this machine (looked on PATH and in ${CARGO_DIRS.join(', ')}), so ${SHOW} can't be built` : `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Checking|Finished|Downloaded|Downloading|Updating|Locking/.test(l)).join('\n').slice(-4000)}`;
  const target = env['CARGO_TARGET_DIR'] ? resolve(REPO, env['CARGO_TARGET_DIR']) : join(REPO, 'target');
  copyFileSync(join(target, 'debug', SHOW), to);
  return '';
}

/** Builds every listed set once, in order, before the file's tests; a test asking for a set that didn't build fails at
 * "the binary builds" with cargo's error, or throws `BLOCKED:` when cargo is missing. Nothing unrun passes. */
export function useBuilds(sets: readonly BuildSet[]): (set: BuildSet) => string {
  let dir = '';
  const made = new Map<BuildSet, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-525-bins-'));
    for (const set of sets) {
      const bin = join(dir, `${SHOW}-${set.replace(/,/g, '+')}`);
      made.set(set, { bin, error: buildTo(set, bin) });
    }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (set: BuildSet): string => {
    const entry = made.get(set);
    if (!entry) throw Error(`the file didn't list the build ${set} in useBuilds`);
    if (entry.error.startsWith('BLOCKED:')) throw Error(entry.error);
    expect(entry.error, `the binary builds: cargo ${argsOf(set).join(' ')}`).toBe('');
    return entry.bin;
  };
}

/** Temporary folders made by a test (evidence stores, pack folders, export outputs), deleted after it. */
export function useTemp(): (tag: string) => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return (tag: string) => {
    const d = mkdtempSync(join(tmpdir(), `deep-525-${tag}-`));
    made.push(d);
    return d;
  };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run [--planted <name>]`: one scenario in as a JSON line, one answer out, one reply per call.

export function runShow(bin: string, scenario: JsonObject, what: string, startPlanted?: string): JsonObject[] {
  const args = ['run', ...(startPlanted ? ['--planted', startPlanted] : [])];
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: TIMEOUT - 120_000, killSignal: 'SIGKILL' });
  const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
  if (r.error && code !== 'ETIMEDOUT' && code !== 'EPIPE') throw Error(`${what}: ${r.error.message}`);
  expect(code === 'ETIMEDOUT' ? 'timed out' : '', `${what}: \`deep-show ${args.join(' ')}\` finished in time`).toBe('');
  const stdout = r.stdout ?? '';
  expect(r.status, `${what}: \`deep-show ${args.join(' ')}\` exits 0; stdout: ${stdout.slice(0, 1200)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one answer line for the scenario`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${what}: the answer`);
  expect(out['ok'], `${what}: the scenario runs (README: The surface under test${scenario['planted'] ? `; planted ${String(scenario['planted'])}` : ''}); got ${show(out, 1200)}`).toBe(true);
  const replies = arr(out['replies'], `${what}: replies`).map((x, i) => obj(x, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(arr(scenario['calls'], 'calls').length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// The evidence store (`<first 2 hex>/<other 62 hex>`, each file named by its bytes' SHA-256) and WAV files

export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
export function putAsset(evidence: string, bytes: Uint8Array): string {
  const sha = sha256(bytes);
  mkdirSync(join(evidence, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, sha.slice(0, 2), sha.slice(2)), bytes);
  return sha;
}
function getAsset(evidence: string, sha: string, what: string): Uint8Array {
  const path = join(evidence, sha.slice(0, 2), sha.slice(2));
  expect(existsSync(path), `${what}: the evidence store holds ${sha}`).toBe(true);
  const bytes = new Uint8Array(readFileSync(path));
  expect(sha256(bytes), `${what}: the file hashes to its name`).toBe(sha);
  return bytes;
}

/** A mono 16-bit PCM WAV at 48 kHz. */
function wav16(x: Float32Array): Uint8Array {
  const data = x.length * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(data, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i]!)) * 32767), 44 + 2 * i);
  return new Uint8Array(b);
}
/** A cosine of `hz` at amplitude `amp` for `frames` samples: its first sample is `amp`, never silence, so an onset is exact. */
export function cosine(hz: number, frames: number, amp: number): Float32Array {
  const x = new Float32Array(frames);
  for (let i = 0; i < frames; i++) x[i] = amp * Math.cos((2 * Math.PI * hz * i) / RATE);
  return x;
}
export const putTone = (evidence: string, hz: number, frames: number, amp: number): string => putAsset(evidence, wav16(cosine(hz, frames, amp)));

/** PCM read back: every channel's samples from document sample `first`. */
export interface Pcm { first: number; frames: number; channels: Float32Array[] }
/** An IEEE float 32-bit WAV from the store, its samples hashing (interleaved f32le, Export's PCM hash) to `sha`. */
export function pcmOf(evidence: string, g: { first: number; frames: number; sha256: string; wav: string }, what: string): Pcm {
  const b = Buffer.from(getAsset(evidence, g.wav, `${what}: the WAV`));
  expect(b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE', `${what}: the WAV is RIFF WAVE`).toBe(true);
  let fmt: { tag: number; nch: number; rate: number; bits: number } | null = null;
  let data: Buffer | null = null;
  for (let o = 12; o + 8 <= b.length;) {
    const id = b.toString('ascii', o, o + 4);
    const size = b.readUInt32LE(o + 4);
    const body = b.subarray(o + 8, Math.min(b.length, o + 8 + size));
    if (id === 'fmt ') {
      let tag = body.readUInt16LE(0);
      if (tag === 0xfffe && body.length >= 26) tag = body.readUInt16LE(24);
      fmt = { tag, nch: body.readUInt16LE(2), rate: body.readUInt32LE(4), bits: body.readUInt16LE(14) };
    } else if (id === 'data') data = body;
    o += 8 + size + (size % 2);
  }
  expect(fmt && data, `${what}: the WAV has fmt and data chunks`).toBeTruthy();
  expect(fmt!.tag === 3 && fmt!.bits === 32, `${what}: the WAV is IEEE float 32-bit, the mix's own samples`).toBe(true);
  expect(fmt!.rate, `${what}: the WAV's rate`).toBe(RATE);
  const nch = fmt!.nch;
  const frames = data!.length / (4 * nch);
  expect(frames, `${what}: the WAV holds the reply's frames`).toBe(g.frames);
  expect(sha256(data!), `${what}: the WAV's samples, interleaved f32le, hash to the reply's sha256`).toBe(g.sha256);
  const channels = Array.from({ length: nch }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < nch; c++) channels[c]![i] = data!.readFloatLE(4 * (i * nch + c));
  return { first: g.first, frames, channels };
}
/** Silence: at most 2^−20 (−120 dBFS), as #498's suite reads it. */
export const SILENCE = 2 ** -20;
/** The first document sample at or after `from` where channel `c` is above silence, or null. */
export function onset(p: Pcm, c: number, from = p.first): number | null {
  for (let n = Math.max(from, p.first); n < p.first + p.frames; n++) if (Math.abs(p.channels[c]![n - p.first]!) > SILENCE) return n;
  return null;
}
/** The first document sample at or after `from` where two PCMs over the same samples differ on any channel, or null. */
export function firstDiff(a: Pcm, b: Pcm, from = a.first): number | null {
  expect([a.first, a.frames, a.channels.length], 'two PCMs compared cover the same samples').toEqual([b.first, b.frames, b.channels.length]);
  for (let n = Math.max(from, a.first); n < a.first + a.frames; n++) {
    for (let c = 0; c < a.channels.length; c++) if (!Object.is(a.channels[c]![n - a.first], b.channels[c]![n - a.first])) return n;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------
// The live world: #498's gate scenario with #499's test audio backend (displays A at 120 Hz and B, the clock, one plain
// panel `player`), this suite's `delays`, `packs` (#306's) and planted names.

const DISPLAY_A = { uuid: '37D8832A-2D66-02CA-B9F7-8F30A301B230', bounds: [0, 0, 1512, 982], scale: 2, refresh_hz: 120, next_vsync: FLICKS / 120, color_space: 'p3' };
const DISPLAY_B = { uuid: '9C1E5F4B-6A2D-4E8F-A1B3-0D2C7E6F5A49', bounds: [1512, 0, 1920, 1080], scale: 1, refresh_hz: 60, next_vsync: 3 * MS, color_space: 'srgb' };
const SLOT = [0, 0, 400, 350];
const SESSIONS: JsonObject = { 'sess-alpha': { thread: 'thread-alpha', name: 'Claude Code: physics lab', process: { pid: 4100, start: 1_000 } } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 }];
export const PANEL = 'player';

/** The test device (#499's TestDevice): 48 kHz on host time (0 ppm), 256 frames a callback pulled 240 + 256 samples
 * ahead of when they play, no jitter. */
export const SPEAKERS: JsonObject = { id: 'speakers', rate: RATE, ppm: 0, buffer: 256, latency: 240, jitter: 0, seed: 525 };

/** The scenario `planted` names of this suite's live wrong programs (README: Planted programs). */
export type LivePlanted = 'voice_at_frame' | 'world_steps_on_frames' | 'late_step_moves_voice' | 'entry_stamped_at_frame';
/** This suite's deliberate test condition (README: The scenario): step `step` of world `world` takes `by` flicks of host time. */
export interface Delay { world: string; step: number; by: number }
export interface LiveWorld { evidence: string; planted?: LivePlanted; delays?: Delay[]; packs?: JsonObject[] }

function liveScenario(w: LiveWorld, calls: JsonObject[]): JsonObject {
  const sorted = calls.map((c, i) => ({ c, i })).sort((p, q) => (p.c['at'] as number) - (q.c['at'] as number) || p.i - q.i).map((p) => p.c);
  return {
    evidence: w.evidence, sessions: SESSIONS, processes: PROCESSES, clock: { lead: 2 * MS, check: MS / 2 },
    displays: [DISPLAY_A, DISPLAY_B] as unknown as JsonValue, window: [1200, 700], panels: { [PANEL]: { rect: SLOT } },
    audio: { backend: 'test', devices: [SPEAKERS], default: 'speakers' },
    ...(w.packs ? { packs: w.packs } : {}),
    ...(w.delays ? { delays: w.delays.map((d) => ({ world: d.world, step: d.step, by: d.by })) } : {}),
    ...(w.planted ? { planted: w.planted } : {}),
    calls: sorted,
  };
}

/** Drives one world on the virtual clock as #498's and #499's suites do: each step's calls may use what earlier steps
 * answered (your click's serial), and the whole scenario is played again from the start with them added. */
export class Driver {
  private calls: JsonObject[] = [];
  constructor(private readonly bin: string, private readonly world: LiveWorld) {}
  step(added: JsonObject[], what: string): JsonObject[] {
    const fresh = added.map((c) => ({ ...c }));
    const s = liveScenario(this.world, [...this.calls, ...fresh]);
    const replies = runShow(this.bin, s, this.world.planted ? `${what} (planted ${this.world.planted})` : what);
    const sorted = arr(s['calls'], 'calls');
    this.calls = [...this.calls, ...fresh];
    return fresh.map((c) => replies[sorted.indexOf(c)]!);
  }
}

/** Your press of Play: 1.06 s on the host clock, 50,880 samples, a whole number of samples and 0.8 of a 120 Hz step past a
 * step boundary, so the display's frames under the audio master fall 80 samples past each step's time. */
export const PLAY_AT = SEC + 60 * MS; // 747,936,000 flicks
/** Opening the lab at 10 ms and your click at 1 s (down, then up 60 ms later): returns the click's serial, which grants
 * the gate when Play is pressed with it. */
export function startLab(d: Driver, media: JsonObject, what: string): number {
  const centre = [SLOT[0]! + SLOT[2]! / 2, SLOT[1]! + SLOT[3]! / 2];
  const [opened, down] = d.step([
    { call: 'open', at: 10 * MS, panel: PANEL, doc: 'lab', media },
    { call: 'input', at: SEC, panel: PANEL, event: { type: 'down', pos: centre } },
    { call: 'input', at: SEC + 60 * MS, panel: PANEL, event: { type: 'up', pos: centre } },
  ], `${what}: the lab opened, and your click`);
  expect(opened!['opened'], `${what}: the lab opens in the panel (open with its media document: README, The media document); got ${show(opened)}`).toBe(true);
  return int(down!['serial'], `${what}: your click's serial`);
}
/** Your press of Play, with your click's serial: the transport plays the document from its time 0. */
export const play = (serial: number): JsonObject => ({ call: 'play', at: PLAY_AT, panel: PANEL, serial });
export const playing = (r: JsonObject | undefined, what: string): void => {
  expect(r?.['playing'], `${what}: your press of Play plays the lab: ${show(r)}`).toBe(true);
};

// Calls (README: Calls and replies)
export const transport = (at: number): JsonObject => ({ call: 'transport', at, panel: PANEL, from: 0, to: at });
export const gate = (at: number): JsonObject => ({ call: 'gate', at, panel: PANEL });
export const handed = (at: number, from: number, to: number): JsonObject => ({ call: 'handed', at, panel: PANEL, from, to });
export const occurrences = (at: number): JsonObject => ({ call: 'occurrences', at, panel: PANEL });
export const inputTrack = (at: number): JsonObject => ({ call: 'input_track', at, panel: PANEL });
/** A scripted press of control `control`, arriving at host `at`, the platform's timestamp of the event `t`. */
export const press = (at: number, t: number, control: string): JsonObject =>
  ({ call: 'input', at, panel: PANEL, event: { type: 'control', control, value: true, t } });

// ---------------------------------------------------------------------------------------------------
// Readings (README: Calls and replies)

/** One block render: the host time it rendered, the document sample it began at (the first sample not yet written), and
 * each live world's time when it began. */
export interface Block { at: number; first: number; stepped: Record<string, number> }
export function blocksOf(reply: JsonObject | undefined, what: string): Block[] {
  const tr = obj(obj(reply, what)['transport'], `${what}: transport`);
  return arr(tr['blocks'], `${what}: transport.blocks`).map((v, i) => {
    const b = obj(v, `${what}: transport.blocks[${i}]`);
    const stepped = obj(b['stepped'], `${what}: transport.blocks[${i}].stepped`);
    return {
      at: int(b['at'], `${what}: blocks[${i}].at`), first: int(b['first'], `${what}: blocks[${i}].first`),
      stepped: Object.fromEntries(Object.entries(stepped).map(([w, t]) => [w, int(t, `${what}: blocks[${i}].stepped.${w}`)])),
    };
  });
}

/** The device gate's stats (Device gate: `stats: {underruns, underrun_time, latency}`). */
export interface Stats { underruns: number; underrun_time: number; latency: number }
export function statsOf(reply: JsonObject | undefined, what: string): Stats {
  const g = obj(obj(reply, what)['gate'], `${what}: gate`);
  const s = obj(g['stats'], `${what}: gate.stats (Device gate: stats {underruns, underrun_time, latency})`);
  return { underruns: int(s['underruns'], `${what}: gate.stats.underruns`), underrun_time: int(s['underrun_time'], `${what}: gate.stats.underrun_time`), latency: int(s['latency'], `${what}: gate.stats.latency`) };
}

/** A `handed` reply (#499's) or a `media_mix` segment: its samples, hash and WAV. */
export interface Rendered { first: number; frames: number; sha256: string; wav: string }
function renderedOf(g: JsonObject, from: number, to: number, what: string): Rendered {
  const first = int(g['first'], `${what}.first`);
  const frames = int(g['frames'], `${what}.frames`);
  const firstAt = (t: number): number => Math.ceil(t / SAMPLE);
  expect([first, first + frames], `${what}: the samples are the document's [⌈from⌉, ⌈to⌉) at 48 kHz`).toEqual([firstAt(from), firstAt(to)]);
  expect(int(g['channels'], `${what}.channels`), `${what}: the master is stereo`).toBe(2);
  return { first, frames, sha256: hex64(g['sha256'], `${what}.sha256`), wav: hex64(g['wav'], `${what}.wav`) };
}
export const handedOf = (reply: JsonObject | undefined, from: number, to: number, what: string): Rendered =>
  renderedOf(obj(obj(reply, what)['handed'], `${what}: handed`), from, to, `${what}: handed`);

/** A world's occurrence row as played (#1918's Row): its step and kind. */
export interface Row { step: number; kind: string }
export function rowsOf(reply: JsonObject | undefined, list: string, what: string): Row[] {
  const lists = obj(obj(reply, what)['occurrences'], `${what}: occurrences`);
  return arr(lists[list], `${what}: occurrences["${list}"]`).map((v, i) => {
    const r = obj(v, `${what}: ${list}[${i}]`);
    return { step: int(r['step'], `${what}: ${list}[${i}].step`), kind: str(r['kind'], `${what}: ${list}[${i}].kind`) };
  });
}
/** The recorded input track's entries (Input track: `{t, seq, control, value, writer, …}`), as the binary answers them. */
export function trackOf(reply: JsonObject | undefined, what: string): JsonObject[] {
  return arr(obj(reply, what)['input_track'], `${what}: input_track`).map((v, i) => obj(v, `${what}: input_track[${i}]`));
}

/**
 * The criterion-2 reading of a block log: every block the play rendered whose 128 samples lie below `toSample` is there,
 * in order, each beginning at most one block after the last, up to within a block of `toSample`; and before each one
 * rendered the world had stepped at least one audio block past the first sample not yet written, `stepped ≥ (first +
 * 128) × 14,700` flicks. A world's time is a whole number of its steps.
 */
export function blockFailures(blocks: Block[], world: string, toSample: number, what: string): string[] {
  const f: string[] = [];
  const kept = blocks.filter((b) => b.first + BLOCK <= toSample);
  if (kept.length === 0) return [`${what}: no block rendered below ${sOf(toSample)}`];
  const last = kept[kept.length - 1]!;
  if (last.first <= toSample - 2 * BLOCK) f.push(`${what}: the block log stops at ${sOf(last.first)}, short of ${sOf(toSample)}`);
  for (let i = 0; i < kept.length && f.length < 5; i++) {
    const b = kept[i]!;
    const prev = kept[i - 1];
    if (prev && !(b.first > prev.first && b.first - prev.first <= BLOCK)) f.push(`${what}: block ${i} begins at ${sOf(b.first)} after block ${i - 1} at ${sOf(prev.first)}: blocks run in order, each at most 128 samples after the last`);
    if (prev && b.at < prev.at) f.push(`${what}: block ${i} rendered at host ${fOf(b.at)}, before block ${i - 1} (${fOf(prev.at)})`);
    const t = b.stepped[world];
    if (t === undefined) { f.push(`${what}: block ${i} (${sOf(b.first)}) names no time for the world ${world}`); continue; }
    if (t % STEP !== 0) f.push(`${what}: block ${i}: the world ${world}'s time ${t} is not a whole number of 120 Hz steps`);
    const need = (b.first + BLOCK) * SAMPLE;
    if (t < need) f.push(`${what}: block ${i} began at ${sOf(b.first)}, the first sample not yet written, while the world ${world} had stepped only to ${fOf(t)}, short of one audio block past it (${fOf(need)})`);
  }
  return f;
}
/** The first sample not yet written at host time `h`: the first sample of the first block rendered after `h`. */
export function unwrittenAt(blocks: Block[], h: number, what: string): number {
  const next = blocks.find((b) => b.at > h);
  expect(next, `${what}: a block renders after host ${fOf(h)}`).toBeDefined();
  return next!.first;
}

// ---------------------------------------------------------------------------------------------------
// `media_mix` (#499's, with #544's `track`): the replay, the document rendered offline as the export renders it.

/** The replay of `doc` over [from, to): `media_mix` plays it from 0 to `from` and on to `to` (two segments, the second
 * continuing the first, so nothing seeks), and the second segment's samples, hash and WAV are what it answers. */
export function replay(bin: string, evidence: string, doc: JsonObject, [from, to]: [number, number], what: string, track?: JsonObject[], packs?: JsonObject[]): Rendered {
  const call: JsonObject = { call: 'media_mix', doc, segments: [{ from: 0, to: from }, { from, to, write: true }], ...(track ? { track } : {}) };
  const [reply] = runShow(bin, { evidence, ...(packs ? { packs } : {}), calls: [call] }, what);
  const segs = arr(obj(obj(reply, what)['mix'], `${what}: mix`)['segments'], `${what}: mix.segments`);
  expect(segs.length, `${what}: one segment per segment asked`).toBe(2);
  return renderedOf(obj(segs[1], `${what}: mix.segments[1]`), from, to, `${what}: mix.segments[1]`);
}

// ---------------------------------------------------------------------------------------------------
// The lab: a physics.world@1 document (#2009's form) inside a media document (#499's, with #500's spawns), its sound a
// bed on the left and each hit's clack on the right, so the right channel is silent but for the clacks.

export const G = 9.81;
const material = (restitution: number): JsonObject => ({ friction: 0.5, restitution, density: 1000 });
/** A world of a static floor whose top is y = 0 and a 0.1 m ball whose lowest point is 1 m above it. */
function labWorld(o: { gravity: boolean; restitution: number; span?: number; inputs?: JsonObject }): JsonObject {
  return {
    kind: 'physics.world@1', dimensions: 3, step_rate: 120, substeps: 4, gravity: o.gravity ? [0, -G, 0] : [0, 0, 0], seed: 525, mode: 'dynamic',
    ...(o.span ? { span: o.span } : {}),
    capacity: { bodies: 4, shapes: 4, joints: 0, contacts: 16, particles: 0 },
    backend: { name: 'rapier3d', version: '=0.36.1' },
    contact_materials: { stone: material(o.restitution), rubber: material(o.restitution) },
    shapes: { floor: { kind: 'box', half: [2, 0.1, 2] }, ball: { kind: 'sphere', radius: 0.1 } },
    bodies: {
      floor: { kind: 'static', shapes: [{ shape: 'floor', contact_material: 'stone' }], pose: { pos: [0, -0.1, 0] } },
      ball: { kind: 'dynamic', shapes: [{ shape: 'ball', contact_material: 'rubber' }], pose: { pos: [0, 1.1, 0] }, sleep: false },
    },
    ...(o.inputs ? { inputs: o.inputs } : {}),
  };
}
/** The free fall's landing: 1 m from rest, t = √(2 × 1 ÷ g) = 0.451524 s, in 120 Hz steps 54.18. */
export const LANDING_STEPS = Math.sqrt(2 / G) * 120;

/** The bed (a 1 s 220 Hz cosine at 0.25, looping from 0, panned hard left: its right gain is exactly sin 0 = 0) and the
 * clack (50 ms of 1 kHz cosine at 0.5, spawned on every hit of the world `lab`, panned hard right). */
export interface Sounds { bed: string; clack: string; ping: string }
export function sounds(evidence: string): Sounds {
  return { bed: putTone(evidence, 220, RATE, 0.25), clack: putTone(evidence, 1000, RATE / 20, 0.5), ping: putTone(evidence, 2000, RATE / 10, 0.4) };
}
function labMedia(s: Sounds, span: number, world: JsonObject, extra: JsonObject = {}): JsonObject {
  return {
    transport: { sample_rate: RATE, span },
    strips: { bed: { track: 0, src: { asset: s.bed }, start: 0, in: 0, out: SEC, loop: true, pan: -1 } },
    worlds: { lab: world },
    spawns: { clack: { on: { list: 'lab.occurrences', kinds: ['hit'] }, play: { src: { asset: s.clack }, in: 0, out: SEC / 20 }, pan: 1 } },
    ...extra,
  };
}
/** Criteria 1 and 2: the ball dropped at t = 0 under gravity onto the floor, restitution 0.5, so it bounces a few times. */
export const dropLab = (s: Sounds, span: number, worldSpan?: number): JsonObject =>
  labMedia(s, span, labWorld({ gravity: true, restitution: 0.5, ...(worldSpan ? { span: worldSpan } : {}) }));

/** Criterion 4: the press `go`, the recipe instance `chime` whose strip `ping` the press starts, and the world input
 * `kick`, which launches the resting ball (no gravity) down at 2 m/s on each entry of `go`, so it hits the floor 1 m
 * below about 0.5 s later. */
export const PACK_ID = 'test/lab';
export const PACK = `${PACK_ID}@1.0.0`;
export const pressLab = (s: Sounds, span: number): JsonObject => labMedia(s, span, labWorld({
  gravity: false, restitution: 0,
  inputs: { kick: { kind: 'launch', targets: ['ball'], on: { control: 'go', each: 'entry' }, linear: [0, -2, 0], angular: [0, 0, 0] } },
}), {
  packs: [PACK],
  controls: { go: { kind: 'press', label: 'Go' } },
  items: { chime: { kind: 'lab.ping@1', params: { sound: s.ping, press: 'go' } } },
});
/** The test pack `test/lab@1.0.0` (#306's folder form: `pack.json` and each recipe's file), with the one recipe
 * `lab.ping@1`: its step `ping` writes a strip of the given sound on track 2 that each entry of the given press starts
 * (README: Readings, "a recipe's strip"). */
export function writePack(dir: string): JsonObject {
  writeFileSync(join(dir, 'pack.json'), JSON.stringify({
    name: 'lab', version: '1.0.0', license: 'CC0-1.0', description: 'The #525 acceptance tests\' lab pack: a ping a press starts.',
    requires: { core: '>=0.0.0', modules: { media: '>=0.0.0' } }, recipes: { 'lab.ping@1': 'lab.ping@1.json' },
  }, null, 2));
  writeFileSync(join(dir, 'lab.ping@1.json'), JSON.stringify({
    id: 'lab.ping', version: '1.0', title: 'Ping on a press', license: 'CC0-1.0', author: 'test',
    description: 'A strip of the given sound that each entry of the given press starts.',
    inputs: { sound: { type: 'asset', about: 'the ping\'s sound' }, press: { type: 'ID', about: 'the press control that starts it' } },
    steps: { ping: { op: 'strip', params: { track: 2, src: { asset: 'sound' }, start: 0, in: 0, out: SEC / 10, start_on: { control: 'press', each: 'entry' } } } },
    outputs: {},
  }, null, 2));
  return { id: PACK_ID, dir };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 3: a document presented by an agent's session, its golden, the published plan, and an export.

const AGENT = 'sess-alpha';
export const DOC_ID = '01JB525000000000000000000A';
/** A scenario of plain calls on one presented document (the shape #1920's suite runs `deep_show` and `eval` in). */
export function docScenario(evidence: string, calls: JsonObject[]): JsonObject {
  return { evidence, sessions: SESSIONS, processes: PROCESSES, panels: { main: { rect: [0, 0, 800, 600] } }, docs: { [DOC_ID]: { panel: 'main' } }, calls };
}
export const present = (document: JsonObject): JsonObject => ({ call: 'deep_show', session: AGENT, doc: DOC_ID, document, include: ['issues'] });
export function presented(reply: JsonObject | undefined, what: string): void {
  expect(reply?.['outcome'], `${what}: the document is presented: ${show(reply)}`).toBe('presented');
}
/** A board of one test.sim@1 item (the shape of #185's kit fixtures), so B's operator writes `test.sim.pos` at each step. */
export function simBoard(): JsonObject {
  return {
    format: 1, profile: 'board', title: 'Golden board', description: 'The #525 golden\'s board of one test.sim item.', size: [320, 200],
    requires: { modules: { 'test.sim': '^1' } },
    items: { s1: { id: 's1', kind: 'test.sim@1', name: 'Item s1', order: 'a0', params: { box: [20, 20, 60, 40], value: 1.5 } } },
  };
}
/** A 64 × 64 film at 24 fps for 0.5 s (12 frames): a ground and a block sliding across, so every frame differs. */
export function receiptFilm(): JsonObject {
  const rect = (id: string, box: number[], role: string, order: string): JsonObject => ({ id, kind: 'rect@1', name: `Rect ${id}`, order, params: { box, paint: { fill: { role } } } });
  return {
    format: 1, profile: 'film', title: 'Receipt film', description: 'The #525 export receipt\'s film.', size: [64, 64], camera: 'cam',
    transport: { span: '0.5s', frame_rate: [24, 1] },
    items: {
      cam: { id: 'cam', kind: 'camera@1', name: 'Camera cam', order: 'a0', params: { projection: 'orthographic', target: [32, 32, 0], view_width: 64 } },
      back: rect('back', [0, 0, 64, 64], 'ground', 'a1'),
      dot: rect('dot', [0, 24, 16, 16], 'accent', 'a2'),
    },
    channels: { slide: { target: 'items/dot/params/box/0', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '0.5s', value: 48, interp: 'linear' } } } },
  };
}

/** The runtime digest a build publishes with its sealed plan (#1920: `schedule.runtime_digest`). */
export const runtimeDigestOf = (schedule: JsonObject | undefined, what: string): string => hex64(obj(schedule, what)['runtime_digest'], `${what}: schedule.runtime_digest`);

/** A golden_verify reply (README: The golden). A missing field fails, naming it. */
export interface Verified { verdict: string; steps_run: number; report: JsonObject | null; blocked: JsonObject | null; reason: string; raw: JsonObject }
export function verifiedOf(reply: JsonObject | undefined, what: string): Verified {
  const r = obj(reply, what);
  for (const k of ['verdict', 'steps_run', 'report', 'blocked', 'reason']) expect(k in r, `${what}: golden_verify answers \`${k}\` (README: The golden); got ${show(r)}`).toBe(true);
  return {
    verdict: str(r['verdict'], `${what}: verdict`), steps_run: int(r['steps_run'], `${what}: steps_run`),
    report: r['report'] === null ? null : obj(r['report'], `${what}: report`), blocked: r['blocked'] === null ? null : obj(r['blocked'], `${what}: blocked`),
    reason: str(r['reason'], `${what}: reason`), raw: r,
  };
}
