// Test-side tools for the #155 acceptance tests: `deep-show run` (#393's convention: one scenario on stdin, one answer
// line) with the media document's strips, buses, processors, markers and spawns, `media_mix` (#499) and its `voices`
// (#500), the first-party foley@1 pack installed with `install_pack` (#306) and planned with `foley_plan`; the
// renderer deepbuild/foley-render installed into a real hub (`deep hub run`) in a temp home and run with deep_job over
// `deep mcp` (#1922), as an agent's MCP client calls it; the hub's socket as the cli role for the record. Every reading
// comes from what deep-show or the hub answers or writes; the truths the judges hold them to are this suite's own
// formulas (README: The surface under test, Fixtures).
//
// Safety: every folder is under /tmp/dh155-* and removed after its file; the hub, `deep` commands and `deep mcp` run
// with HOME in the world's temp folder and without the caller's DEEP_*, CLAUDE*, CODEX*, NODE_OPTIONS; nothing leaves
// 127.0.0.1; no model is called; every process is one this file started, stopped by its PID.
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import net, { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';
import { arr, decodeWav, getAsset, int, interleaved, isObject, num, obj, putAsset, str, type JsonObject, type JsonValue } from '../499/mix/helpers.ts';

export { arr, getAsset, int, isObject, num, obj, putAsset, str, type JsonObject, type JsonValue };

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages/cli/dist/main.js');
const NODE = process.execPath;
/** Every `it` passes this timeout (or a multiple): a first deep-show build or a hub world on a loaded Mac is slow. */
export const TIMEOUT = 3_600_000;

/** Each criterion's ID (scripts/proof-change.mjs, `criterionId`: `#155.<8 hex of the text's sha256>`), which starts its
 * tests' names. */
export const AC = {
  1: 'AC1 #155.2ad28764',
  2: 'AC2 #155.c0ec4150',
  3: 'AC3 #155.5d489fd3',
  4: 'AC4 #155.fd738754',
  5: 'AC5 #155.dfb89544',
  6: 'AC6 #155.5ffbe66e',
  7: 'AC7 #155.3c3c0a49',
  8: 'AC8 #155.ec088f1d',
  9: 'AC9 #155.eaff7d6a',
} as const;

/** The wrong programs behind deep-show's scenario `planted` (README: Planted programs). */
export type Planted = 'round_robin_by_hash_alone' | 'foley_first_collection_material';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const parse = (text: string): Line | undefined => { try { const v: unknown = JSON.parse(text); return typeof v === 'object' && v !== null ? (v as Line) : undefined; } catch { return undefined; } };
export const show = (v: unknown, n = 800): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
/** The criterion stays open, whatever the reason: never a pass (AGENTS.md, the four invariants). */
export const inconclusive = (reason: string): never => expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
export const blocked = (reason: string): never => expect.fail(`BLOCKED: ${reason}; this is not a pass`);
/** A judge's failures, which must be none. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}: ${failures.slice(0, 8).join(' | ')}`).toEqual([]);
}
/** A wrong program's run: the same judge must fail it, and some failure must name `named`. */
export function failsNaming(failures: readonly string[], named: RegExp, what: string): void {
  expect(failures.length, `${what}: the judge fails the wrong program`).toBeGreaterThan(0);
  expect(failures.some((f) => named.test(f)), `${what}: a failure names ${named}; the failures: ${failures.slice(0, 8).join(' | ')}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// Time (Time and the flick): 705,600,000 flicks a second; at 48 kHz a sample is 14,700 flicks.

export const FLICKS = 705_600_000;
export const RATE = 48_000;
export const SAMPLE = FLICKS / RATE;
export const BLOCK = 128;
export const secs = (s: number): number => Math.round(s * FLICKS);
/** The first sample at or after a flick (Spawn: a voice starts at its flick, sample-accurately). */
export const sampleAt = (t: number): number => Math.ceil(t / SAMPLE);
export const sOf = (t: number): string => `${Number((t / FLICKS).toFixed(6))} s`;

// ---------------------------------------------------------------------------------------------------
// Temp folders and processes, all gone after the file.

const made: string[] = [];
/** A fresh folder under /tmp/dh155-*, removed after the file. */
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh155-'));
  made.push(dir);
  return dir;
}
const owned = new Set<number>();
const closers: (() => Promise<void>)[] = [];
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
afterAll(async () => {
  for (const close of closers.splice(0)) await close().catch(() => undefined);
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}, 60_000);

// ---------------------------------------------------------------------------------------------------
// deep-show, built once per file (`cargo build --locked --bin deep-show`, honoring CARGO_TARGET_DIR, rustup's cargo
// first on PATH), copied out of the target folder; a test that uses a build that failed fails with cargo's error.

const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
export function useShow(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = tempDir();
    const env = { ...process.env, CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG ?? '0', ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env.PATH ?? ''}` } : {}) };
    const run = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-show'], { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (run.error) error = `cargo could not run: ${run.error.message}`;
    else if (run.status !== 0) error = `cargo build --locked --bin deep-show failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n').slice(0, 4000)}`;
    else copyFileSync(join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', 'deep-show'), join(dir, 'deep-show'));
  }, TIMEOUT);
  return () => {
    expect(error, 'deep-show builds: cargo build --locked --bin deep-show').toBe('');
    return join(dir, 'deep-show');
  };
}

const SURFACE = 'README: The surface under test';
/** `deep-show run` on one scenario: exit 0, one line out, answered ok with one reply per call, in call order. A run that
 * hangs is stopped by spawnSync's own timeout, which signals only this child. Returns the replies and the wall time. */
export function runTimed(bin: string, s: JsonObject, what: string, timeoutMs = 1_800_000): { replies: JsonObject[]; ms: number } {
  const t0 = performance.now();
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(s)}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const ms = performance.now() - t0;
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${what}: deep-show run did not finish within ${timeoutMs} ms`);
  const stdout = r.stdout ?? '';
  expect(r.status, `${what}: deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 800)}; stderr: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  const out = stdout.split('\n').filter((l) => l !== '');
  expect(out.length, `${what}: one output line for the one scenario line`).toBe(1);
  const answer = obj(JSON.parse(out[0]!) as JsonValue, `${what}: the answer`);
  expect(answer['ok'], `${what}: deep-show run answers the scenario ok (${SURFACE}${s['planted'] ? `; planted ${String(s['planted'])}` : ''}); got ${show(answer, 900)}`).toBe(true);
  const replies = arr(answer['replies'], `${what}: replies`).map((v, i) => obj(v, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(arr(s['calls'], 'calls').length);
  return { replies, ms };
}
export const runShow = (bin: string, s: JsonObject, what: string, timeoutMs?: number): JsonObject[] => runTimed(bin, s, what, timeoutMs).replies;
/** A scenario: the evidence store, the done deep_job replies the hub holds (`jobs`, README) and the calls. */
export function scenario(evidence: string, calls: JsonObject[], opts: { jobs?: Line[]; planted?: Planted } = {}): JsonObject {
  return { evidence, ...(opts.jobs ? { jobs: opts.jobs as JsonValue } : {}), ...(opts.planted ? { planted: opts.planted } : {}), calls };
}

// ---------------------------------------------------------------------------------------------------
// The foley@1 pack and its jobs (README: The surface under test).

export const MATERIALS = ['paper', 'wood', 'metal', 'glass', 'plastic', 'rubber', 'ink', 'cloth', 'stone', 'electronic'] as const;
export const ACTIONS = ['tap', 'hit', 'scrape', 'slide', 'whoosh', 'pop', 'tear', 'drip', 'click'] as const;
export type Material = (typeof MATERIALS)[number];
export type Action = (typeof ACTIONS)[number];
/** The first-party pack: `packs/foley-1.0.0`, `name: "foley"`, installed as `deepbuild/foley` (1720's reading of a
 * first-party pack's ID) *(chosen)*. */
export const PACK_DIR = join(REPO, 'packs', 'foley-1.0.0');
export const PACK_ID = 'deepbuild/foley';
export const PACK_REF = `${PACK_ID}@1.0.0`;
/** A preset's key in the manifest's `presets` and its name in a document (Synth As built: `<pack>.<name>@<major>`). */
export const presetKey = (m: string, a: string): string => `${m}.${a}@1`;
export const presetName = (m: string, a: string): string => `foley.${m}.${a}@1`;
/** A foley job's ID: the preset's name without its major, `foley.<material>.<action>` *(chosen)*. */
export const jobId = (m: string, a: string): string => `foley.${m}.${a}`;
/** The renderer (README): the plug-in deepbuild/foley-render at packages/jobs/foley, its kind and its one tool. */
export const PLUGIN = 'deepbuild/foley-render';
export const PACKAGE = join(REPO, 'packages', 'jobs', 'foley');
export const KIND = 'foley.render';
export const TOOL = 'foley-render@1.0.0';
/** The job's outputs, one per variant: `l<level>r<round robin>`, levels 1 (soft) to 3 (hard), round robins 1 to 4
 * *(chosen)*. */
export const VARIANTS = [1, 2, 3].flatMap((l) => [1, 2, 3, 4].map((r) => `l${l}r${r}`));
export const variantOf = (output: string): { level: number; rr: number } | null => {
  const m = /^l([1-3])r([1-4])$/.exec(output);
  return m ? { level: Number(m[1]), rr: Number(m[2]) } : null;
};
/** `install_pack` (#306) of the first-party foley pack. */
export const installFoley = (): JsonObject => ({ call: 'install_pack', id: PACK_ID, dir: PACK_DIR });
export function installedOk(reply: JsonObject | undefined, what: string): void {
  const r = obj(reply, what);
  expect([r['outcome'], arr(r['issues'] ?? [], `${what}: issues`).length], `${what}: install_pack admits it (outcome installed, no issue); got ${show(r, 1500)}`).toEqual(['installed', 0]);
}
/** A generator source (Strip and track: generator sources): `{generator: {job, output}}` *(chosen: the variant's tag as
 * the key holding it, as a strip's `src: {asset}` and `src: {synth}` are written)*. */
export const generator = (job: string, output: string): JsonObject => ({ generator: { job, output } });

export interface PlanJob { kind: string; tool: string; params: JsonObject; inputs: JsonValue[] }
/** `{call: "foley_plan", doc}` *(chosen)*: every foley job the document's generator sources reach. */
export const foleyPlanCall = (doc: JsonObject): JsonObject => ({ call: 'foley_plan', doc });
/** The plan read strictly: `jobs: {<job ID> → {kind: foley.render, tool: foley-render@1.0.0, params, inputs: []}}`. */
export function foleyPlanOf(reply: JsonObject | undefined, what: string): Record<string, PlanJob> {
  const r = obj(reply, what);
  expect(isObject(r['jobs']) && Object.keys(r['jobs'] as JsonObject).length > 0, `${what}: foley_plan answers jobs: {<job ID> → {kind, tool, params, inputs}}; got ${show(r, 1200)}`).toBe(true);
  const out: Record<string, PlanJob> = {};
  for (const [id, raw] of Object.entries(r['jobs'] as JsonObject)) {
    const j = obj(raw, `${what}: jobs.${id}`);
    expect([j['kind'], j['tool']], `${what}: jobs.${id} is a ${KIND} job on ${TOOL}`).toEqual([KIND, TOOL]);
    const params = obj(j['params'], `${what}: jobs.${id}.params`);
    const inputs = arr(j['inputs'] ?? [], `${what}: jobs.${id}.inputs`);
    out[id] = { kind: KIND, tool: TOOL, params, inputs };
  }
  return out;
}
/** The deep_job arguments for one planned job, as #154's plan hands a stem over: params as JSON text, inputs as given. */
export const jobArgs = (j: PlanJob): Line => ({ op: 'run', kind: j.kind, tool: j.tool, params: JSON.stringify(j.params), inputs: j.inputs });

// ---------------------------------------------------------------------------------------------------
// Media documents and `media_mix` (#499, #500): replies read strictly, a missing field failing, naming it.

export interface SegmentAsk { from: number; to: number; write?: boolean }
export const mixCall = (doc: JsonObject, segments: SegmentAsk[]): JsonObject => ({
  call: 'media_mix', doc, segments: segments.map((s) => ({ from: s.from, to: s.to, ...(s.write ? { write: true } : {}) })),
});
/** Whether a reply says BLOCKED: some top-level field equals "BLOCKED" (as `media_bake` and #154's plan answer it). */
export const isBlocked = (reply: JsonObject): boolean => Object.values(reply).includes('BLOCKED');

export interface Segment { from: number; to: number; first: number; frames: number; channels: number; sha256: string; wav: string | null; taps: Record<string, string>; raw: JsonObject }
export interface Voice { spawn: string; occurrence: number; start: number; end: number; job: string | null; output: string | null; raw: JsonObject }
export interface Mix { segments: Segment[]; voices: Voice[]; raw: JsonObject }
const hex64 = (v: JsonValue | undefined, what: string): string => {
  const s = str(v, what);
  expect(/^[0-9a-f]{64}$/.test(s), `${what} is a SHA-256 in lower-case hex: ${s}`).toBe(true);
  return s;
};
/** A `media_mix` reply that isn't BLOCKED: its segments (each covering the samples asked) and its voices. */
export function mixOf(reply: JsonObject | undefined, asks: SegmentAsk[], what: string): Mix {
  const r = obj(reply, what);
  expect('mix' in r && !isBlocked(r), `${what}: media_mix answers a mix; got ${show(r, 1200)}`).toBe(true);
  const m = obj(r['mix'], `${what}: mix`);
  expect(int(m['sample_rate'], `${what}: mix.sample_rate`), `${what}: mix.sample_rate`).toBe(RATE);
  const segs = arr(m['segments'], `${what}: mix.segments`);
  expect(segs.length, `${what}: one segment reply per segment asked`).toBe(asks.length);
  const segments = segs.map((v, i) => {
    const w = `${what}: mix.segments[${i}]`;
    const g = obj(v, w);
    const first = int(g['first'], `${w}.first`);
    const frames = int(g['frames'], `${w}.frames`);
    expect([first, first + frames], `${w}: the segment covers the samples asked`).toEqual([sampleAt(asks[i]!.from), sampleAt(asks[i]!.to)]);
    const taps = isObject(g['taps']) ? Object.fromEntries(Object.entries(g['taps']).map(([k, h]) => [k, hex64(h, `${w}.taps.${k}`)])) : {};
    return {
      from: asks[i]!.from, to: asks[i]!.to, first, frames, channels: int(g['channels'], `${w}.channels`), sha256: hex64(g['sha256'], `${w}.sha256`),
      wav: asks[i]!.write ? str(g['wav'], `${w}.wav (asked with write: true)`) : null, taps, raw: g,
    };
  });
  const voices = m['voices'] === undefined ? [] : arr(m['voices'], `${what}: mix.voices`).map((v, k) => {
    const o = obj(v, `${what}: mix.voices[${k}]`);
    return {
      spawn: str(o['spawn'], `${what}: mix.voices[${k}].spawn`), occurrence: int(o['occurrence'], `${what}: mix.voices[${k}].occurrence`),
      start: int(o['start'], `${what}: mix.voices[${k}].start`), end: int(o['end'], `${what}: mix.voices[${k}].end`),
      job: typeof o['job'] === 'string' ? o['job'] : null, output: typeof o['output'] === 'string' ? o['output'] : null, raw: o,
    };
  });
  return { segments, voices, raw: m };
}
/** A voice that plays a job's output: its `job` and `output` (README: voices of a generator template); missing fails. */
export function playedOf(v: Voice, what: string): { job: string; output: string } {
  expect(v.job !== null && v.output !== null, `${what}: the voice names the job and the output it plays (fields job and output); got ${show(v.raw)}`).toBe(true);
  return { job: v.job!, output: v.output! };
}

export interface Pcm { first: number; frames: number; channels: Float32Array[] }
/** A written segment's WAV: IEEE float, 48 kHz, its samples hashing (interleaved f32le) to the reply's sha256. */
export function pcmOf(evidence: string, g: Segment, what: string): Pcm {
  expect(g.wav, `${what}: a WAV was written (write: true)`).not.toBeNull();
  const wav = decodeWav(getAsset(evidence, g.wav!, `${what}: the WAV`), `${what}: the WAV ${g.wav}`);
  expect([wav.float, wav.sampleRate, wav.channels.length, wav.frames], `${what}: the WAV is float, 48 kHz, the reply's channels and frames`).toEqual([true, RATE, g.channels, g.frames]);
  expect(sha256(interleaved(wav.channels)), `${what}: the WAV's samples, interleaved f32le, hash to the reply's sha256`).toBe(g.sha256);
  return { first: g.first, frames: g.frames, channels: wav.channels };
}
/** The sample at absolute index n on channel c (0 outside the segment). */
export const at = (p: Pcm, c: number, n: number): number => p.channels[c]![n - p.first] ?? 0;
/** The first absolute sample where two PCMs differ (bit for bit) over the samples both cover, or null. */
export function firstDiff(a: Pcm, b: Pcm): number | null {
  const from = Math.max(a.first, b.first);
  const to = Math.min(a.first + a.frames, b.first + b.frames);
  for (let n = from; n < to; n++) for (let c = 0; c < a.channels.length; c++) if (!Object.is(at(a, c, n), at(b, c, n))) return n;
  return null;
}

/** IEEE float 32-bit WAV bytes, so an asset's samples are exactly the f32 values written. */
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
export const putSignal = (evidence: string, channels: Float32Array[]): string => putAsset(evidence, floatWav(channels));

/** Least squares of y over [from, to) against one reference, one gain: the gain and the residual's energy relative to
 * y's. */
export function fitGain(y: ArrayLike<number>, ref: ArrayLike<number>, from: number, to: number): { gain: number; residual: number } {
  let yr = 0;
  let rr = 0;
  let yy = 0;
  for (let n = from; n < to; n++) { yr += y[n]! * ref[n]!; rr += ref[n]! * ref[n]!; yy += y[n]! * y[n]!; }
  const gain = rr > 0 ? yr / rr : 0;
  let e = 0;
  for (let n = from; n < to; n++) { const d = y[n]! - gain * ref[n]!; e += d * d; }
  return { gain, residual: yy > 0 ? e / yy : Number.POSITIVE_INFINITY };
}

// ---------------------------------------------------------------------------------------------------
// The hub world: a temp home, optionally a test CA and an HTTPS shelf on 127.0.0.1 the hub trusts (the Oracle lane's
// sample library), a real hub, and `deep mcp` in a work folder (as #154's suite opens one).

function childEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|GH_|GITHUB_|AI_AGENT|TMUX)/.test(key) || key === 'NODE_OPTIONS' || key === 'NODE_EXTRA_CA_CERTS') continue;
    env[key] = value;
  }
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C', ...extra };
}
export interface Ran { code: number | null; stdout: string; stderr: string }
export const shown = (r: Ran): string => `exit ${r.code}, stdout ${JSON.stringify(r.stdout.slice(-1500))}, stderr ${JSON.stringify(r.stderr.slice(-1500))}`;
export const said = (r: Ran): string => `${r.stdout}\n${r.stderr}`;
function deep(args: readonly string[], home: string, cwd: string): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(NODE, [CLI, ...args], { cwd, env: childEnv(home), stdio: ['ignore', 'pipe', 'pipe'] });
    if (child.pid) owned.add(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 900_000);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}${error.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

function certs(dir: string): { key: string; cert: string; ca: string } {
  const at = (f: string) => join(dir, f);
  writeFileSync(at('ca.cnf'), '[req]\ndistinguished_name = dn\n[dn]\n[v3_ca]\nbasicConstraints = critical,CA:TRUE\nkeyUsage = critical,keyCertSign,cRLSign\nsubjectKeyIdentifier = hash\n');
  writeFileSync(at('leaf.cnf'), '[req]\ndistinguished_name = dn\n[dn]\n[v3_leaf]\nbasicConstraints = CA:FALSE\nkeyUsage = critical,digitalSignature,keyEncipherment\nextendedKeyUsage = serverAuth\nsubjectAltName = IP:127.0.0.1\n');
  const ssl = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] });
  ssl('req', '-x509', '-new', '-nodes', '-newkey', 'rsa:2048', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=dh155 test CA', '-config', 'ca.cnf', '-extensions', 'v3_ca');
  ssl('req', '-new', '-nodes', '-newkey', 'rsa:2048', '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', '/CN=127.0.0.1', '-config', 'leaf.cnf');
  ssl('x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'leaf.pem', '-days', '2', '-extfile', 'leaf.cnf', '-extensions', 'v3_leaf');
  return { key: readFileSync(at('leaf.key'), 'utf8'), cert: readFileSync(at('leaf.pem'), 'utf8'), ca: at('ca.pem') };
}
/** An HTTPS server on 127.0.0.1 serving the files a test puts on it. */
export interface Shelf { host: string; serve(path: string, body: Buffer): void }
async function openShelf(tls: { key: string; cert: string }): Promise<Shelf> {
  const routes = new Map<string, Buffer>();
  const server: Server = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    const path = new URL(req.url ?? '/', 'https://x.invalid').pathname;
    req.resume();
    const body = routes.get(path);
    if (req.method !== 'GET' || !body) return void res.writeHead(404).end('not found');
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length, 'accept-ranges': 'bytes' }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  let closed = false;
  closers.push(() => (closed ? Promise.resolve() : new Promise<void>((resolve) => { closed = true; server.close(() => resolve()); server.closeAllConnections(); })));
  return { host: `127.0.0.1:${(server.address() as AddressInfo).port}`, serve: (path, body) => { routes.set(path, body); } };
}

interface Hub { pid: number; socket: string; root: string }
async function startHub(home: string, env: Record<string, string>): Promise<Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home, env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  if (child.pid) owned.add(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err = (err + d).slice(-8000)));
  const ready = await new Promise<Line | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 120_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      if (out.includes('\n')) { clearTimeout(timer); resolve(parse(out.split('\n')[0]!)); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(undefined); });
  });
  expect(ready?.ready, `the hub starts (deep hub run): ${out.slice(0, 500)} ${err.slice(-1500)}`).toBe(true);
  return { pid: child.pid!, socket: typeof ready!.socket === 'string' ? ready!.socket : join(home, '.deepbuild', 'hub.sock'), root: join(home, '.deepbuild') };
}
/** One call on the hub's socket as the cli role, with the control token and this process for the peer check. */
export async function control(w: World, method: string, params: Line, timeoutMs = 120_000): Promise<Line> {
  const token = readFileSync(join(w.hub.root, 'control.token'), 'utf8').trim();
  const start = execFileSync('ps', ['-o', 'lstart=', '-p', String(process.pid)], { env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8' }).trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(w.hub.socket);
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`BLOCKED: the hub gave no answer to ${method} within ${timeoutMs} ms`)); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (error) => { clearTimeout(timer); reject(error); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = parse(buffer.slice(0, i)) ?? {};
        buffer = buffer.slice(i + 1);
        if (step === 0) { step = 1; sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token, peer: { pid: process.pid, start } })}\n`); }
        else if (step === 1) { step = 2; sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`); }
        else if (line.id === 1) { clearTimeout(timer); sock.destroy(); resolve(line); }
      }
    });
  });
}
export async function must(w: World, method: string, params: Line): Promise<Line> {
  const reply = await control(w, method, params);
  expect(reply.error, `${method} ${JSON.stringify(params)} is answered: ${JSON.stringify(reply.error)}`).toBeUndefined();
  return reply.result as Line;
}
/** The hub's record after log position `after`, through events.read on the cli role. */
export async function events(w: World, after = 0): Promise<Line[]> {
  const all: Line[] = [];
  for (let from = after; ;) {
    const page = (await must(w, 'events.read', { after: from, limit: 1000 })).events as Line[];
    all.push(...page);
    if (page.length < 1000) return all;
    from = page[page.length - 1]!.log_pos;
  }
}
export async function lastPos(w: World): Promise<number> {
  const all = await events(w);
  return all.length ? Math.max(...all.map((e) => Number(e.log_pos))) : 0;
}

// ---- deep mcp, as an agent's MCP client talks to it.
export interface Outcome { isError: boolean; value: Line; text: string }
class Mcp {
  private lines: string[] = [];
  private wakers = new Set<() => void>();
  private n = 0;
  readonly child: ChildProcess;
  constructor(child: ChildProcess) {
    this.child = child;
    let buffer = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      buffer += d;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) { this.lines.push(buffer.slice(0, i)); buffer = buffer.slice(i + 1); }
      for (const w of [...this.wakers]) w();
    });
    child.stdin!.on('error', () => undefined);
  }
  request(method: string, params: Line, timeoutMs = 1_800_000): Promise<Line> {
    const id = ++this.n;
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.wakers.delete(check); reject(Error(`deep mcp gave no reply to ${method} in ${timeoutMs} ms`)); }, timeoutMs);
      const check = () => {
        const found = this.lines.map((l) => parse(l)).find((l) => l?.id === id);
        if (found) { clearTimeout(timer); this.wakers.delete(check); resolve(found); }
        else if (this.child.exitCode !== null) { clearTimeout(timer); this.wakers.delete(check); reject(Error(`deep mcp exited ${this.child.exitCode}`)); }
      };
      this.wakers.add(check);
      check();
    });
  }
  notify(method: string): void { this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method, params: {} })}\n`); }
}
async function startMcp(home: string, cwd: string): Promise<Mcp> {
  const child = spawn(NODE, [CLI, 'mcp'], { cwd, env: childEnv(home), stdio: ['pipe', 'pipe', 'ignore'] });
  if (child.pid) owned.add(child.pid);
  const mcp = new Mcp(child);
  const init = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-155', version: '0' } });
  expect(init.result, `deep mcp answers initialize: ${JSON.stringify(init)}`).toBeDefined();
  mcp.notify('notifications/initialized');
  return mcp;
}
async function tool(w: World, name: string, args: Line): Promise<Outcome> {
  const reply = await w.mcp.request('tools/call', { name, arguments: args });
  if (reply.error) return { isError: true, value: reply.error as Line, text: JSON.stringify(reply.error) };
  const result = (reply.result ?? {}) as Line;
  const text = Array.isArray(result.content) ? String(result.content.find((c: Line) => c?.type === 'text')?.text ?? '') : '';
  const value = (result.structuredContent ?? parse(text) ?? {}) as Line;
  return { isError: result.isError === true, value, text: text || JSON.stringify(value) };
}
export const deepJob = (w: World, args: Line): Promise<Outcome> => tool(w, 'deep_job', args);
export const deepKinds = (w: World, args: Line): Promise<Outcome> => tool(w, 'deep_kinds', args);

export interface World {
  tmp: string; home: string; work: string; hub: Hub; mcp: Mcp;
  /** The hub's evidence store: the variants the jobs kept, which `deep-show run` reads as its `evidence`. */
  evidence: string;
  /** With `shelf`: the HTTPS shelf the hub trusts. */
  shelf: Shelf | null;
}
/** A world: a temp home, a real hub (DEEP_HUB_TEST_CONFIRM stubs the OS confirming you) and a deep mcp; with `foley`,
 * deepbuild/foley-render installed from packages/jobs/foley; with `shelf`, a test CA the hub trusts and a shelf. */
export async function openWorld(opts: { foley?: boolean; shelf?: boolean } = {}): Promise<World> {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const work = join(tmp, 'work');
  mkdirSync(home);
  mkdirSync(work);
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  const env: Record<string, string> = { DEEP_HUB_TEST_CONFIRM: join(tmp, 'confirm') };
  let shelf: Shelf | null = null;
  if (opts.shelf) {
    mkdirSync(join(tmp, 'tls'));
    const tls = certs(join(tmp, 'tls'));
    shelf = await openShelf(tls);
    env['NODE_EXTRA_CA_CERTS'] = tls.ca;
  }
  const hub = await startHub(home, env);
  const mcp = await startMcp(home, work);
  const w: World = { tmp, home, work, hub, mcp, evidence: join(home, '.deepbuild', 'evidence'), shelf };
  if (opts.foley) await installFoleyPlugin(w);
  return w;
}
/** `deep install <folder>`, as you, confirmed by the stubbed OS. */
export const install = (w: World, folder: string): Promise<Ran> => deep(['install', folder], w.home, w.work);
/** deepbuild/foley-render installed from packages/jobs/foley, its tool qualifying at install. */
export async function installFoleyPlugin(w: World): Promise<Ran> {
  expect(existsSync(join(PACKAGE, 'deepbuild.json')), `the first-party renderer ${PLUGIN} is at packages/jobs/foley (README: The surface under test): no ${join(PACKAGE, 'deepbuild.json')}`).toBe(true);
  const ran = await install(w, PACKAGE);
  expect(ran.code, `deep install packages/jobs/foley installs ${PLUGIN}: ${shown(ran)}`).toBe(0);
  return ran;
}

export interface Rendered { outcome: Outcome; started: number; ms: number }
/** One deep_job call and the processes it started: the record's process.starting events from just before the call
 * until 500 ms after its reply (#1922's count). */
export async function counted(w: World, call: () => Promise<Outcome>): Promise<Rendered> {
  const before = await lastPos(w);
  const t0 = performance.now();
  const outcome = await call();
  const ms = performance.now() - t0;
  await sleep(500);
  const started = (await events(w, before)).filter((e) => e.kind === 'process.starting').length;
  return { outcome, started, ms };
}
export const done = (o: Outcome): boolean => !o.isError && o.value.status === 'done';
export const cacheOf = (o: Outcome): unknown => o.value.receipt?.cache;
/** A done foley run: its twelve variants by hash; anything else fails, naming the job and the reply. */
export function variantsOf(o: Outcome, what: string): Record<string, string> {
  const outs = (o.value.outputs ?? {}) as Line;
  const got = VARIANTS.map((v) => outs[v]?.sha256);
  expect(done(o) && got.every((h) => /^[0-9a-f]{64}$/.test(String(h))), `${what}: deep_job runs ${KIND} on ${TOOL}, done with its twelve variants l1r1 to l3r4 by hash: ${o.text.slice(0, 1500)}`).toBe(true);
  return Object.fromEntries(VARIANTS.map((v, i) => [v, String(got[i])]));
}
/** Every job of a plan run once, in ID order; each reply as deep_job gave it (for the scenario's `jobs`) and its variants. */
export async function renderPlan(w: World, plan: Record<string, PlanJob>, what: string): Promise<Record<string, { reply: Line; variants: Record<string, string> }>> {
  const out: Record<string, { reply: Line; variants: Record<string, string> }> = {};
  for (const id of Object.keys(plan).sort()) {
    const o = await deepJob(w, jobArgs(plan[id]!));
    out[id] = { reply: o.value, variants: variantsOf(o, `${what}, job ${id}`) };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The proof (the issue's Proof line), rewritten each run under $TMPDIR/deep-155-proof/.

export const PROOF_DIR = join(tmpdir(), 'deep-155-proof');
export function proof(name: string, value: unknown): void {
  mkdirSync(PROOF_DIR, { recursive: true });
  writeFileSync(join(PROOF_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}
