// Test-side tools for the #154 acceptance tests: score.music@1 documents and their plans through `deep-show run`
// (#393's convention: one scenario on stdin, one answer line), the first-party plug-in deepbuild/score installed from
// packages/jobs/score into a real hub (`deep hub run`) in a temp home, its stems rendered with deep_job over `deep mcp`
// as an agent's MCP client calls it, sample-library packs written at test time and served over HTTPS on 127.0.0.1
// under a test CA the hub trusts, fetched through the hub's pack fetch (#1820), and the hub's socket as the cli role
// for the record, the evidence store, `pack.rule` and your yes. Every reading comes from what deep-show, the hub or
// the stems they wrote answer; the truth each judge holds them to comes from the fixtures, made here by construction
// (README: Fixtures). The stems are read by this suite's own FLAC reader (flac.ts).
//
// Safety: every folder is under /tmp/dh154-* and removed after its file; the hub, `deep` commands and `deep mcp` run
// with HOME in the world's temp folder and without the caller's DEEP_*, CLAUDE*, CODEX*, NODE_OPTIONS; nothing leaves
// 127.0.0.1; no model is called; every process is one this file started, stopped by its PID.
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import net, { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';
import { DOC, FLICKS, present, presented, runShow, scenario, sha256, show, type JsonObject, type JsonValue } from '../501/helpers.ts';
import { readFlac, type Flac } from './flac.ts';

export { DOC, FLICKS, sha256, show, type JsonObject, type JsonValue };
export type { Flac };

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages/cli/dist/main.js');
const NODE = process.execPath;
/** Every hub test passes this: a world starts a hub, installs a plug-in that qualifies its tool, and renders stems. */
export const TIMEOUT = 3_600_000;

/** Each criterion's ID (scripts/proof-change.mjs: `#<issue>.<8 hex of the text's sha256>`), which starts its tests' names. */
export const AC = {
  1: 'AC1 #154.c8c95dbc',
  2: 'AC2 #154.8b0e5b99',
  3: 'AC3 #154.6e31be7c',
  4: 'AC4 #154.ee9b85a0',
  5: 'AC5 #154.87a31a62',
  6: 'AC6 #154.74061b19',
  7: 'AC7 #154.54798db1',
  8: 'AC8 #154.a25e77d2',
  9: 'AC9 #154.d6804da4',
} as const;

/** The renderer as the design's As built (#154) names it. */
export const PLUGIN = 'deepbuild/score';
export const PACKAGE = join(REPO, 'packages/jobs/score');
export const KIND = 'score.render';
export const TOOL = 'score-render@1.0.0';
export const CHECK = 'score.render.pitch';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const parse = (text: string): Line | undefined => { try { const v: unknown = JSON.parse(text); return typeof v === 'object' && v !== null ? (v as Line) : undefined; } catch { return undefined; } };
/** The criterion stays open, whatever the reason: never a pass (AGENTS.md, the four invariants). */
export const inconclusive = (reason: string): never => expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
export const blockedLeg = (reason: string): never => expect.fail(`BLOCKED: ${reason}; this is not a pass`);

// ---------------------------------------------------------------------------------------------------
// Time (Time and the flick): 705,600,000 flicks a second; stems at 48 kHz, 14,700 flicks a sample.

export const RATE = 48_000;
export const SAMPLE = FLICKS / RATE;
/** A beat count written as a finite decimal, as an exact fraction. */
function decimal(text: string): { num: bigint; den: bigint } {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) throw Error(`not a decimal: ${text}`);
  const frac = m[2] ?? '';
  return { num: BigInt(`${m[1]}${frac}`), den: 10n ** BigInt(frac.length) };
}
/** The flick of `bar:beat` under one constant tempo in 4/4 from time 0, rounded to the nearest flick, exactly. */
export function flickAt(at: string, bpm: number, perBar = 4): number {
  const m = /^(\d+):([\d.]+)b?$/.exec(at);
  if (!m) throw Error(`not a bar:beat: ${at}`);
  const beat = decimal(m[2]!);
  // beats from the start = (bar − 1)·perBar + beat − 1, as num/den
  const num = (BigInt(Number(m[1]) - 1) * BigInt(perBar) - 1n) * beat.den + beat.num;
  const n = num * 60n * BigInt(FLICKS);
  const d = beat.den * BigInt(bpm);
  return Number((2n * n + d) / (2n * d));
}
/** The 48 kHz sample a flick rounds to (Score: As built, "the 48 kHz sample it rounds to"). */
export const sampleOf = (t: number): number => Math.round(t / SAMPLE);
/** A bar:beat string for a beat count from the start (beat 0 is "1:1"), in 4/4, its beat a finite decimal. */
export function barBeat(beats: number, perBar = 4): string {
  const bar = Math.floor(beats / perBar) + 1;
  const beat = beats - (bar - 1) * perBar + 1;
  return `${bar}:${Number(beat.toFixed(10))}`;
}

// ---------------------------------------------------------------------------------------------------
// Sound fixtures, made here by construction: 48 kHz mono 16-bit PCM WAV takes (README: Fixtures).

export const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);
export function wav16(x: Float64Array, rate = RATE): Buffer {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i]!)) * 32767), 44 + 2 * i);
  return b;
}
/** A take of a round robin: its fundamental at `f0` and, so each take can be told apart in a stem, one harmonic of
 * its own, (k + 2) × f0 for take k; 2 ms faded at its end. */
export function roundRobinTake(k: number, f0: number, seconds: number): Float64Array {
  const n = Math.round(seconds * RATE);
  const x = new Float64Array(n);
  const fade = 96;
  for (let i = 0; i < n; i++) {
    const g = i >= n - fade ? (n - i) / fade : 1;
    x[i] = g * (0.3 * Math.sin((2 * Math.PI * f0 * i) / RATE) + 0.2 * Math.sin((2 * Math.PI * (k + 2) * f0 * i) / RATE));
  }
  return x;
}
/** A steady tone at `f`, 10 ms faded in and out. */
export function toneTake(f: number, seconds: number, amp = 0.5): Float64Array {
  const n = Math.round(seconds * RATE);
  const x = new Float64Array(n);
  const fade = 480;
  for (let i = 0; i < n; i++) x[i] = amp * Math.min(1, i / fade, (n - i) / fade) * Math.sin((2 * Math.PI * f * i) / RATE);
  return x;
}
/** WPT's impulse: 1 at its first sample, 0 elsewhere, 512 samples long. */
export function impulseTake(): Float64Array {
  const x = new Float64Array(512);
  x[0] = 1;
  return x;
}

/**
 * score.pitch's measure as the design states it (Score: As built), written here from that text alone: over the 4,096
 * samples from `start`, under a Hann window, the strongest of the frequencies 5 cents apart within ±100 cents of
 * `midi`, refined between its neighbours by a parabola. Returns its offset from `midi` in cents.
 */
export function measureCents(x: Float64Array, start: number, midi: number): number {
  const N = 4096;
  const f0 = hz(midi);
  const steps: number[] = [];
  for (let c = -100; c <= 100; c += 5) {
    const f = f0 * 2 ** (c / 1200);
    let re = 0;
    let im = 0;
    for (let n = 0; n < N; n++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (N - 1));
      const v = (x[start + n] ?? 0) * w;
      re += v * Math.cos((2 * Math.PI * f * n) / RATE);
      im -= v * Math.sin((2 * Math.PI * f * n) / RATE);
    }
    steps.push(Math.hypot(re, im));
  }
  let k = 0;
  for (let i = 1; i < steps.length; i++) if (steps[i]! > steps[k]!) k = i;
  let offset = 0;
  if (k > 0 && k < steps.length - 1) {
    const [a, b, c] = [steps[k - 1]!, steps[k]!, steps[k + 1]!];
    const den = a - 2 * b + c;
    if (den !== 0) offset = (0.5 * (a - c)) / den;
  }
  return -100 + 5 * (k + offset);
}
/** A Hann-windowed cosine and sine at `f` over `len` samples, kept once made. */
const bases = new Map<string, { c: Float64Array; s: Float64Array }>();
function basis(f: number, len: number): { c: Float64Array; s: Float64Array } {
  const key = `${f}|${len}`;
  let b = bases.get(key);
  if (!b) {
    b = { c: new Float64Array(len), s: new Float64Array(len) };
    for (let n = 0; n < len; n++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (len - 1));
      b.c[n] = w * Math.cos((2 * Math.PI * f * n) / RATE);
      b.s[n] = w * Math.sin((2 * Math.PI * f * n) / RATE);
    }
    bases.set(key, b);
  }
  return b;
}
/** Which of `count` round-robin takes sounds at `onset` in `x`: the take whose own harmonic, (k + 2) × f0, is strongest
 * over the window [onset + skip, onset + skip + len). */
export function heardTake(x: Float64Array, onset: number, f0: number, count = 4, skip = 120, len = 2160): number {
  let best = -1;
  let take = -1;
  for (let k = 0; k < count; k++) {
    const { c, s } = basis((k + 2) * f0, len);
    let re = 0;
    let im = 0;
    for (let n = 0; n < len; n++) {
      const v = x[onset + skip + n] ?? 0;
      re += v * c[n]!;
      im -= v * s[n]!;
    }
    const p = Math.hypot(re, im);
    if (p > best) { best = p; take = k; }
  }
  return take;
}

// ---------------------------------------------------------------------------------------------------
// Sample libraries: packs written at test time (Pack: assets fetched on first use; Score's `samples` on Pack).

export interface Lic { id: string; terms: string; shareable: boolean; credit: string | null }
export const CC0: Lic = { id: 'CC0-1.0', terms: 'https://creativecommons.org/publicdomain/zero/1.0/', shareable: true, credit: null };
export const CC_BY: Lic = { id: 'CC-BY-4.0', terms: 'https://creativecommons.org/licenses/by/4.0/', shareable: true, credit: 'Sample Shelf test fixture, made by the #154 acceptance tests' };
export const CC_BY_SA: Lic = { id: 'CC-BY-SA-4.0', terms: 'https://creativecommons.org/licenses/by-sa/4.0/', shareable: true, credit: 'Share-alike fixture' };
export const CC_BY_NC: Lic = { id: 'CC-BY-NC-4.0', terms: 'https://creativecommons.org/licenses/by-nc/4.0/', shareable: false, credit: 'Non-commercial fixture' };
export const GPL: Lic = { id: 'GPL-3.0-only', terms: 'https://www.gnu.org/licenses/gpl-3.0.html', shareable: true, credit: null };

export interface Take { path: string; bytes: Buffer; license?: Lic }
export interface Zone { lo: number; hi: number; root: number; takes: Take[] }
export interface Library { id: string; version: string; license: Lic; presets: Record<string, { sustained?: boolean; zones: Zone[] }> }
export const ref = (lib: Library): string => `${lib.id}@${lib.version}`;
export const takesOf = (lib: Library): Take[] => Object.values(lib.presets).flatMap((p) => p.zones.flatMap((z) => z.takes));
const take = (path: string, x: Float64Array, license?: Lic): Take => ({ path, bytes: wav16(x), ...(license ? { license } : {}) });

/** test/keys: `piano` (root MIDI 60) and `bell` (root 72), four takes of 0.25 s each, and `staccato` (root 60), four
 * takes of 0.05 s; every take in tune at its root, each with a harmonic of its own. CC0. */
export function keysLibrary(): Library {
  const rr = (name: string, f0: number, seconds: number): Take[] => [0, 1, 2, 3].map((k) => take(`${name}/${name}-${k + 1}.wav`, roundRobinTake(k, f0, seconds)));
  return {
    id: 'test/keys', version: '1.0.0', license: CC0,
    presets: {
      piano: { zones: [{ lo: 0, hi: 127, root: 60, takes: rr('piano', hz(60), 0.25) }] },
      bell: { zones: [{ lo: 0, hi: 127, root: 72, takes: rr('bell', hz(72), 0.25) }] },
      staccato: { zones: [{ lo: 0, hi: 127, root: 60, takes: rr('staccato', hz(60), 0.05) }] },
    },
  };
}
/** The pitch libraries (criterion 2): one take of 1 s whose manifest says it is A4 (root MIDI 69); test/intune's take
 * sounds at 440 Hz, test/sharp's 50 cents sharp of it, at 440 × 2^(50/1200) Hz. */
export const SHARP_CENTS = 50;
export function tuningLibrary(sharp: boolean): Library {
  return {
    id: sharp ? 'test/sharp' : 'test/intune', version: '1.0.0', license: CC0,
    presets: { a4: { zones: [{ lo: 0, hi: 127, root: 69, takes: [take('a4.wav', toneTake(hz(69 + (sharp ? SHARP_CENTS / 100 : 0)), 1))] }] } },
  };
}
/** A one-preset library of `takes` takes of 0.25 s at root MIDI 60, under `license` (its takes too, unless `takeLicense`). */
export function plainLibrary(id: string, license: Lic, takes = 2, preset = 'main', takeLicense?: (k: number) => Lic | undefined): Library {
  const list = Array.from({ length: takes }, (_, k) => take(`${preset}-${k + 1}.wav`, roundRobinTake(k, hz(60), 0.25), takeLicense?.(k)));
  return { id, version: '1.0.0', license, presets: { [preset]: { zones: [{ lo: 0, hi: 127, root: 60, takes: list }] } } };
}

// ---------------------------------------------------------------------------------------------------
// TLS and the shelf: a test CA and a leaf for 127.0.0.1 (openssl), and an HTTPS server holding the libraries' takes
// with a request log; "offline" is the server closed (as #1820's suite reads it).

function certs(dir: string): { key: string; cert: string; ca: string } {
  const at = (f: string) => join(dir, f);
  writeFileSync(at('ca.cnf'), '[req]\ndistinguished_name = dn\n[dn]\n[v3_ca]\nbasicConstraints = critical,CA:TRUE\nkeyUsage = critical,keyCertSign,cRLSign\nsubjectKeyIdentifier = hash\n');
  writeFileSync(at('leaf.cnf'), '[req]\ndistinguished_name = dn\n[dn]\n[v3_leaf]\nbasicConstraints = CA:FALSE\nkeyUsage = critical,digitalSignature,keyEncipherment\nextendedKeyUsage = serverAuth\nsubjectAltName = IP:127.0.0.1\n');
  const ssl = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] });
  ssl('req', '-x509', '-new', '-nodes', '-newkey', 'rsa:2048', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=dh154 test CA', '-config', 'ca.cnf', '-extensions', 'v3_ca');
  ssl('req', '-new', '-nodes', '-newkey', 'rsa:2048', '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', '/CN=127.0.0.1', '-config', 'leaf.cnf');
  ssl('x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'leaf.pem', '-days', '2', '-extfile', 'leaf.cnf', '-extensions', 'v3_leaf');
  return { key: readFileSync(at('leaf.key'), 'utf8'), cert: readFileSync(at('leaf.pem'), 'utf8'), ca: at('ca.pem') };
}
export interface Shelf { host: string; log: { method: string; path: string }[]; serve(path: string, body: Buffer): void; close(): Promise<void> }
async function openShelf(tls: { key: string; cert: string }): Promise<Shelf> {
  const log: { method: string; path: string }[] = [];
  const routes = new Map<string, Buffer>();
  const server: Server = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    const path = new URL(req.url ?? '/', 'https://x.invalid').pathname;
    log.push({ method: req.method ?? '', path });
    req.resume();
    const body = routes.get(path);
    if (req.method !== 'GET' || !body) return void res.writeHead(404).end('not found');
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length, 'accept-ranges': 'bytes' }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  let closed = false;
  return {
    host: `127.0.0.1:${(server.address() as AddressInfo).port}`, log,
    serve: (path, body) => { routes.set(path, body); },
    close: () => (closed ? Promise.resolve() : new Promise<void>((resolve) => { closed = true; server.close(() => resolve()); server.closeAllConnections(); })),
  };
}
/** The URL path a library's take is served at. */
export const takePath = (lib: Library, t: Take): string => `/${lib.id}/${t.path}`;
/**
 * A library's pack folder: `pack.json` with `id`, `name`, `version`, its own `license`, `assets` (each take by url,
 * sha256, size, license and upstream) and `samples` (each preset's zones, its takes by asset path); its takes served
 * on the shelf. README: Fixtures.
 */
export function writeLibrary(dir: string, shelf: Pick<Shelf, 'host' | 'serve'>, lib: Library): string {
  mkdirSync(dir, { recursive: true });
  const url = (t: Take) => `https://${shelf.host}${takePath(lib, t)}`;
  for (const t of takesOf(lib)) shelf.serve(takePath(lib, t), t.bytes);
  const samples: JsonObject = {};
  for (const [name, p] of Object.entries(lib.presets)) {
    samples[name] = { ...(p.sustained === undefined ? {} : { sustained: p.sustained }), zones: p.zones.map((z) => ({ lo: z.lo, hi: z.hi, root: z.root, takes: z.takes.map((t) => t.path) })) };
  }
  const manifest = {
    id: lib.id, name: lib.id.split('/')[1], version: lib.version, license: lib.license.id,
    description: `A sample library made by the #154 acceptance tests (${lib.id}).`, requires: { core: '^1', modules: {} },
    assets: takesOf(lib).map((t) => ({
      path: t.path, url: url(t), sha256: sha256(t.bytes), size: t.bytes.length, license: t.license ?? lib.license,
      upstream: { url: url(t), version: lib.version, modified: '2026-01-01T00:00:00Z' },
    })),
    samples,
  };
  writeFileSync(join(dir, 'pack.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

// ---------------------------------------------------------------------------------------------------
// Temp folders and processes, all gone after the file.

const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh154-'));
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

// ---------------------------------------------------------------------------------------------------
// deep-show, built once per file (`cargo build --locked --bin deep-show`, honoring CARGO_TARGET_DIR), rustup's cargo
// on PATH; a test that uses a build that failed fails with cargo's error.

const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
export function useShow(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-154-bin-'));
    const env = { ...process.env, CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG ?? '0', ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env.PATH ?? ''}` } : {}) };
    const run = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-show'], { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (run.error) error = `cargo could not run: ${run.error.message}`;
    else if (run.status !== 0) error = `cargo build --locked --bin deep-show failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n').slice(0, 4000)}`;
    else copyFileSync(join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', 'deep-show'), join(dir, 'deep-show'));
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => {
    expect(error, 'deep-show builds: cargo build --locked --bin deep-show').toBe('');
    return join(dir, 'deep-show');
  };
}

// ---------------------------------------------------------------------------------------------------
// Documents (README: The surface under test). A film with a tempo map, the packs it names and score items.

export interface Segment { at?: string; bpm: number; meter: [number, number]; span: number; ramp: 'none' | { to_bpm: number; shape: 'linear_in_beats' } }
export const tempo = (bpm: number, span = 400): { segments: Segment[] } => ({ segments: [{ at: '0s', bpm, meter: [4, 4], span, ramp: 'none' }] });
export type Source = { sampled: { library: string; preset: string } } | { pluck: { preset: string; overrides?: { damping?: number; brightness?: number } } } | { synth: { preset: string } };
export interface Inst { source: Source; stem: string; bass?: boolean }
export interface Ev {
  at: string; inst: string; pitch: number | string; dur: string; vel: number;
  pan?: number; gain?: number; attack?: string; release?: string; bend?: number[][]; vib?: { hz: number; depth: number; from: number }; strum?: number;
}
export const sampled = (library: string, preset: string, stem: string, bass?: boolean): Inst => ({ source: { sampled: { library, preset } }, stem, ...(bass === undefined ? {} : { bass }) });
export const pluck = (preset: string, stem: string): Inst => ({ source: { pluck: { preset } }, stem });
export const synth = (preset: string, stem: string, bass?: boolean): Inst => ({ source: { synth: { preset } }, stem, ...(bass === undefined ? {} : { bass }) });
/** A score.music@1 item: its fields in `params`, as every kind's are. */
export function scoreItem(id: string, instruments: Record<string, Inst>, events: Record<string, Ev>, loop?: { from: string; to: string }): JsonObject {
  return { id, kind: 'score.music@1', name: `Score ${id}`, order: 'a5', params: { instruments, events, ...(loop ? { loop } : {}) } as unknown as JsonObject };
}
/** A film of `span` (a time literal) holding the camera and `items`, with a tempo map and the packs it names. */
export function film(items: JsonObject[], opts: { tempo: { segments: Segment[] }; packs?: string[]; span?: string }): JsonObject {
  const cam: JsonObject = { id: 'cam', kind: 'camera@1', name: 'Camera cam', order: 'a0cam', params: { projection: 'orthographic', target: [32, 32, 0], view_width: 64 } };
  return {
    format: 1, id: 'score', profile: 'film', title: 'A score', description: 'A film whose music is a score written as data, for the #154 acceptance tests.',
    size: [64, 64], camera: 'cam', transport: { span: opts.span ?? '60s', frame_rate: [24, 1], sample_rate: RATE },
    tempo_map: opts.tempo as unknown as JsonObject,
    ...(opts.packs?.length ? { packs: opts.packs } : {}),
    items: Object.fromEntries([cam, ...items].map((i) => [String(i['id']), i])),
  };
}

// ---------------------------------------------------------------------------------------------------
// deep-show run: the document check (`deep show`) and `{call: "score_plan", doc, item}` (Score: As built).

export interface PackDir { id: string; dir: string }
/** One scenario: the document presented with `deep show`, then `calls`; their replies. */
export function showRun(bin: string, evidence: string, document: JsonObject, calls: JsonObject[], packs: PackDir[], what: string): { shown: JsonObject; replies: JsonObject[] } {
  const replies = runShow(bin, scenario(evidence, [present(DOC.a, document), ...calls], packs.length ? { packs: packs as unknown as JsonValue } : {}), what);
  return { shown: replies[0]!, replies: replies.slice(1) };
}
/** The document check alone: `deep show`'s reply. */
export const check = (bin: string, evidence: string, document: JsonObject, packs: PackDir[], what: string): JsonObject => showRun(bin, evidence, document, [], packs, what).shown;
export const planCall = (item: string): JsonObject => ({ call: 'score_plan', doc: DOC.a, item });
/** The plan's reply for a score item, after its document is presented; a refused document fails, naming its issues. */
export function planReply(bin: string, evidence: string, document: JsonObject, item: string, packs: PackDir[], what: string): JsonObject {
  const { shown, replies } = showRun(bin, evidence, document, [planCall(item)], packs, what);
  presented(shown, `${what}: deep show presents the score's document (score.music@1 is a kind of the media module)`);
  return replies[0]!;
}
/** Whether a reply says BLOCKED (README: the plan's BLOCKED reply). */
export const isBlocked = (reply: JsonObject): boolean => Object.values(reply).includes('BLOCKED');

export interface PlanStem { kind: string; tool: string; params: JsonObject; inputs: { name: string; sha256: string }[] }
export interface NoteOn { t: number; sample: number; event: string; stem: string }
export interface Plan { stems: Record<string, PlanStem>; note_on: NoteOn[] }
/** A plan read strictly: not BLOCKED, each stem a score.render job on score-render@1.0.0 with params and inputs by hash,
 * and its note_on list; anything missing fails, naming the field. */
export function planOf(reply: JsonObject, what: string): Plan {
  expect(isBlocked(reply), `${what}: the plan isn't BLOCKED: ${show(reply)}`).toBe(false);
  const stems = reply['stems'];
  expect(typeof stems === 'object' && stems !== null && !Array.isArray(stems) && Object.keys(stems).length > 0, `${what}: score_plan answers stems: {name → job}; got ${show(reply)}`).toBe(true);
  const out: Record<string, PlanStem> = {};
  for (const [name, raw] of Object.entries(stems as JsonObject)) {
    const s = raw as JsonObject;
    expect([s?.['kind'], s?.['tool']], `${what}: stem ${name} is a ${KIND} job on ${TOOL}: ${show(s)}`).toEqual([KIND, TOOL]);
    expect(typeof s['params'] === 'object' && s['params'] !== null && !Array.isArray(s['params']), `${what}: stem ${name} has params: ${show(s)}`).toBe(true);
    const inputs = s['inputs'];
    expect(Array.isArray(inputs) && inputs.every((i) => (i as JsonObject)?.['name'] === 'samples' && /^[0-9a-f]{64}$/.test(String((i as JsonObject)?.['sha256']))), `${what}: stem ${name}'s inputs are [{name: "samples", sha256}]: ${show(inputs)}`).toBe(true);
    out[name] = { kind: KIND, tool: TOOL, params: s['params'] as JsonObject, inputs: (inputs as JsonObject[]).map((i) => ({ name: 'samples', sha256: String(i['sha256']) })) };
  }
  const list = reply['note_on'];
  expect(Array.isArray(list), `${what}: score_plan answers note_on: [{t, sample, event, stem}]; got ${show(reply)}`).toBe(true);
  const note_on = (list as JsonObject[]).map((n, i) => {
    expect(Number.isInteger(n?.['t']) && Number.isInteger(n?.['sample']) && typeof n?.['event'] === 'string' && typeof n?.['stem'] === 'string', `${what}: note_on[${i}] is {t, sample, event, stem}: ${show(n)}`).toBe(true);
    return { t: Number(n['t']), sample: Number(n['sample']), event: String(n['event']), stem: String(n['stem']) };
  });
  return { stems: out, note_on };
}
/** A canonical JSON text (keys sorted), to compare two params. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
/** A `deep show` reply's issues (`include: ["issues"]`), errors and warnings. */
export const issuesOf = (reply: JsonObject): JsonObject[] => (Array.isArray(reply['issues']) ? (reply['issues'] as JsonObject[]) : []);

// ---------------------------------------------------------------------------------------------------
// The hub.

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
/** A cli call that must succeed: its result. */
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
const dataOf = (e: Line): Line => (typeof e.data === 'string' ? parse(e.data) ?? {} : e.data ?? {});
export interface Ask { handle: string; kind: string; text: string; data: Line }
/** The asks raised in the record after `after`, oldest first. */
export async function asks(w: World, after = 0): Promise<Ask[]> {
  return (await events(w, after)).filter((e) => e.kind === 'ask.created').map((e) => ({ handle: `ask:${String(e.id)}`, kind: String(dataOf(e).kind), text: JSON.stringify(dataOf(e)), data: dataOf(e) }));
}
/** Your yes to an ask, on the trusted path: `deep inbox answer <ask> <the option whose decision is allow>`. */
export async function yes(w: World, ask: Ask): Promise<Ran> {
  const option = (ask.data.options as Line[] | undefined)?.find((o) => o.decision === 'allow')?.id;
  expect(typeof option, `${ask.handle} has an option whose decision is allow: ${JSON.stringify(ask.data.options)}`).toBe('string');
  return deep(['inbox', 'answer', ask.handle, String(option)], w.home, w.work);
}
/** The evidence store's entry for a hash (evidence.read), or undefined when it holds none. */
export async function stored(w: World, sha: string): Promise<Line | undefined> {
  const reply = await control(w, 'evidence.read', { sha });
  return reply.error ? undefined : (reply.result?.evidence as Line | undefined) ?? (reply.result as Line | undefined);
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
  const init = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-154', version: '0' } });
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

// ---- The world.
export interface World {
  tmp: string; home: string; work: string; hub: Hub; mcp: Mcp;
  /** The hub's evidence store: the takes it fetched and the stems it kept, which deep-show run reads too. */
  evidence: string;
  /** The shelves serving the libraries, by name: `main`, and any other a test opens. */
  shelves: Record<string, Shelf>;
  /** Each library written, by id: its folder (for deep-show's `packs`) and its install. */
  libraries: Record<string, { lib: Library; dir: string; shelf: string; install: Ran }>;
  tls: { key: string; cert: string; ca: string };
}
/** A world: a temp home, a test CA, a shelf, a real hub trusting the CA (DEEP_HUB_TEST_CONFIRM stubs the OS confirming
 * you), and a deep mcp in a work folder. With `score`, deepbuild/score installed from packages/jobs/score. */
export async function openWorld(opts: { score?: boolean; shelves?: string[] } = {}): Promise<World> {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const work = join(tmp, 'work');
  mkdirSync(home);
  mkdirSync(work);
  mkdirSync(join(tmp, 'tls'));
  const tls = certs(join(tmp, 'tls'));
  const shelves: Record<string, Shelf> = {};
  for (const name of ['main', ...(opts.shelves ?? [])]) {
    const shelf = await openShelf(tls);
    closers.push(() => shelf.close());
    shelves[name] = shelf;
  }
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  const hub = await startHub(home, { DEEP_HUB_TEST_CONFIRM: join(tmp, 'confirm'), NODE_EXTRA_CA_CERTS: tls.ca });
  const mcp = await startMcp(home, work);
  const w: World = { tmp, home, work, hub, mcp, evidence: join(home, '.deepbuild', 'evidence'), shelves, libraries: {}, tls };
  if (opts.score) await installScore(w);
  return w;
}
/** `deep install <folder>`, as you, confirmed by the stubbed OS. */
export const install = (w: World, folder: string): Promise<Ran> => deep(['install', folder], w.home, w.work);
/** deepbuild/score installed from packages/jobs/score, its tool qualifying at install. */
export async function installScore(w: World): Promise<Ran> {
  expect(existsSync(join(PACKAGE, 'deepbuild.json')), `the first-party plug-in ${PLUGIN} is at packages/jobs/score (Score: As built): no ${join(PACKAGE, 'deepbuild.json')}`).toBe(true);
  const ran = await install(w, PACKAGE);
  expect(ran.code, `deep install packages/jobs/score installs ${PLUGIN}: ${shown(ran)}`).toBe(0);
  return ran;
}
/** A library's pack written and installed with `deep install`; its install as it ran (a test reads refusals). */
export async function addLibrary(w: World, lib: Library, shelf = 'main'): Promise<Ran> {
  const dir = writeLibrary(join(w.tmp, 'libraries', lib.id.replace('/', '__')), w.shelves[shelf]!, lib);
  const ran = await install(w, dir);
  w.libraries[lib.id] = { lib, dir, shelf, install: ran };
  return ran;
}
/** A library that must install. */
export async function mustAddLibrary(w: World, lib: Library, shelf = 'main'): Promise<void> {
  const ran = await addLibrary(w, lib, shelf);
  expect(ran.code, `deep install of the library ${ref(lib)} (a pack with assets and samples) installs it: ${shown(ran)}`).toBe(0);
}
/** deep-show's `packs` for the world's libraries: each `{id, dir}`. */
export const packDirs = (w: World): PackDir[] => Object.values(w.libraries).map((l) => ({ id: l.lib.id, dir: l.dir }));
/** A fetch of one take through the hub (deep_kinds `{op: "fetch", pack, asset}`, #1820's). */
export const fetchTake = (w: World, lib: Library, t: Take): Promise<Outcome> => deepKinds(w, { op: 'fetch', pack: ref(lib), asset: t.path });
/** A fetch called again while it says held (the job after a yes or under a rule), up to `ms`. */
export async function fetchUntil(w: World, lib: Library, t: Take, ms = 120_000): Promise<Outcome> {
  const deadline = Date.now() + ms;
  for (;;) {
    const o = await fetchTake(w, lib, t);
    if (o.value.status !== 'held' || Date.now() > deadline) return o;
    await sleep(500);
  }
}
/** Your standing rule for a library (`pack.rule`), then every take fetched into the hub's evidence store. */
export async function fetchLibrary(w: World, lib: Library): Promise<void> {
  const licenses = [...new Set([lib.license.id, ...takesOf(lib).map((t) => (t.license ?? lib.license).id)])];
  await must(w, 'pack.rule', { pack: lib.id, licenses });
  for (const t of takesOf(lib)) {
    const o = await fetchUntil(w, lib, t);
    expect(o.value.status, `${ref(lib)}'s take ${t.path} is fetched under your standing rule: ${o.text.slice(0, 800)}`).toBe('fetched');
  }
}
/** A world with deepbuild/score and the libraries installed and fetched. */
export async function scoreWorld(libraries: Library[] = []): Promise<World> {
  const w = await openWorld({ score: true });
  for (const lib of libraries) {
    await mustAddLibrary(w, lib);
    await fetchLibrary(w, lib);
  }
  return w;
}

// ---------------------------------------------------------------------------------------------------
// deep_job on the plan's stems (#1922's deep_job; Score: As built).

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
/** The deep_job arguments for one stem of a plan, as the plan hands it over: its params as JSON text (the strict
 * schemas take no free-form object) and its inputs as given, every `samples` file by hash, in the plan's order. */
export const jobArgs = (stem: PlanStem): Line => ({ op: 'run', kind: stem.kind, tool: stem.tool, params: JSON.stringify(stem.params), inputs: stem.inputs });
export const renderStem = (w: World, stem: PlanStem): Promise<Rendered> => counted(w, () => deepJob(w, jobArgs(stem)));
export const done = (o: Outcome): boolean => !o.isError && o.value.status === 'done';
export const cacheOf = (o: Outcome): unknown => o.value.receipt?.cache;
/** A done render's two outputs by hash; anything else fails, naming the stem and the reply. */
export function outputsOf(r: Rendered, what: string): { stem: string; meta: string } {
  const stem = r.outcome.value.outputs?.stem?.sha256;
  const meta = r.outcome.value.outputs?.meta?.sha256;
  expect(done(r.outcome) && /^[0-9a-f]{64}$/.test(String(stem)) && /^[0-9a-f]{64}$/.test(String(meta)), `${what}: deep_job runs ${KIND} on ${TOOL}, done with its outputs stem and meta by hash: ${r.outcome.text.slice(0, 1500)}`).toBe(true);
  return { stem: String(stem), meta: String(meta) };
}
/** Every stem of a plan rendered, one after another, in name order. */
export async function renderPlan(w: World, plan: Plan, what: string): Promise<Record<string, Rendered & { stem: string; meta: string }>> {
  const out: Record<string, Rendered & { stem: string; meta: string }> = {};
  for (const name of Object.keys(plan.stems).sort()) {
    const r = await renderStem(w, plan.stems[name]!);
    out[name] = { ...r, ...outputsOf(r, `${what}, stem ${name}`) };
  }
  return out;
}

/** A file of the hub's evidence store by its hash (`<2 hex>/<62 hex>`), checked against it. */
export function fromStore(w: World, sha: string, what: string): Buffer {
  const path = join(w.evidence, sha.slice(0, 2), sha.slice(2));
  expect(existsSync(path), `${what}: the evidence store holds ${sha}`).toBe(true);
  const bytes = readFileSync(path);
  expect(sha256(bytes), `${what}: the stored file hashes to its name`).toBe(sha);
  return bytes;
}
/** A stem read by this suite's FLAC reader: 48 kHz, two channels, 24 bits (Score: As built). */
export function stemOf(w: World, sha: string, what: string): Flac {
  let f: Flac | undefined;
  let why = '';
  try { f = readFlac(fromStore(w, sha, what)); } catch (e) { why = e instanceof Error ? e.message : String(e); }
  expect(why, `${what}: the stem ${sha} is a valid FLAC stream`).toBe('');
  expect([f!.rate, f!.channels, f!.bits], `${what}: the stem is 48 kHz stereo 24-bit`).toEqual([RATE, 2, 24]);
  return f!;
}
export interface Meta {
  stem: string; sample_rate: number; length: number; loop: { start: number; end: number } | null;
  note_on: { event: string; sample: number; pitch: number; take: number | null }[];
  credits: { id: string; credit: string | null }[];
  made_by: Line;
}
/** A stem's `meta` output read from the store, its fields held to the design's shape. */
export function metaOf(w: World, sha: string, what: string): Meta {
  const m = parse(fromStore(w, sha, what).toString('utf8'));
  expect(m, `${what}: meta ${sha} is a JSON object`).toBeDefined();
  expect(Array.isArray(m!.note_on) && m!.note_on.every((n: Line) => typeof n?.event === 'string' && Number.isInteger(n?.sample)), `${what}: meta.note_on is [{event, sample, pitch, take}]: ${JSON.stringify(m).slice(0, 600)}`).toBe(true);
  expect(m!.loop === null || (Number.isInteger(m!.loop?.start) && Number.isInteger(m!.loop?.end)), `${what}: meta.loop is {start, end} or null: ${JSON.stringify(m!.loop)}`).toBe(true);
  return m as unknown as Meta;
}
/** A stem's samples as fractions of full scale, the two channels' mean. */
export function mono(f: Flac): Float64Array {
  const x = new Float64Array(f.frames);
  const scale = 2 ** (f.bits - 1);
  for (let i = 0; i < f.frames; i++) x[i] = (f.samples[0]![i]! + f.samples[1]![i]!) / (2 * scale);
  return x;
}

// ---------------------------------------------------------------------------------------------------
// Judges: each returns its failures in words; none is a pass.

/**
 * Criterion 1's noise judge: the stem with one note added is the stem without it plus that note rendered alone (the
 * same score item, so the same seed, and the same event ID), sample for sample on both channels within `lsb` steps of
 * 24 bits; a stem past its end is silent. Any other note whose noise moved breaks the sum.
 */
export function judgeSum(withNote: Flac, without: Flac, alone: Flac, lsb: number): string[] {
  const failures: string[] = [];
  const n = Math.max(withNote.frames, without.frames, alone.frames);
  for (let c = 0; c < 2; c++) {
    let worst = 0;
    let at = -1;
    for (let i = 0; i < n; i++) {
      const d = Math.abs((withNote.samples[c]![i] ?? 0) - (without.samples[c]![i] ?? 0) - (alone.samples[c]![i] ?? 0));
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > lsb) failures.push(`channel ${c}: the stem with the note differs from the stem without it plus the note alone by ${worst} steps of 24 bits at sample ${at} (${(at / RATE).toFixed(4)} s); allowed ${lsb}`);
  }
  return failures;
}
/** dBFS of a level. */
export const dbfs = (v: number): number => 20 * Math.log10(Math.max(v, 1e-12));
/**
 * Criterion 7's judge: two renders of the same span, channel by channel, from `from` to `to` (samples): the first sample
 * where they differ by more than `limitDb` dBFS, and the largest difference, each named; none when they agree.
 */
export function judgeMatch(got: Float64Array[], want: Float64Array[], from: number, to: number, limitDb: number, what: string): string[] {
  const failures: string[] = [];
  const limit = 10 ** (limitDb / 20);
  for (let c = 0; c < want.length; c++) {
    let worst = 0;
    let at = -1;
    let first = -1;
    for (let i = from; i < to; i++) {
      const d = Math.abs((got[c]![i] ?? 0) - (want[c]![i] ?? 0));
      if (d > limit && first < 0) first = i;
      if (d > worst) { worst = d; at = i; }
    }
    if (first >= 0) failures.push(`${what}, channel ${c}: first off at sample ${first} (${(first / RATE).toFixed(4)} s), largest difference ${dbfs(worst).toFixed(1)} dBFS at sample ${at}, over the ${limitDb} dBFS allowed`);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// The scores criteria 1 and 3 share (README: Fixtures), at 90 BPM in 4/4: a beat is 32,000 samples.

export const SONG_BPM = 90;
/** The song's onsets as bar:beat, by event: piano on beats 1 and 3 (3:3 left free), bell on beats 2 and 4, harp
 * between them; no two notes of piano, bell and harp sound at once. */
export const PIANO = ['1:1', '1:3', '2:1', '2:3', '3:1', '4:1', '4:3', '5:1', '5:3', '6:1', '6:3'].map((at, i) => ({ id: `p${String(i + 1).padStart(2, '0')}`, at }));
export const BELL = [1, 2, 3, 4, 5, 6].flatMap((bar) => [2, 4].map((beat) => `${bar}:${beat}`)).map((at, i) => ({ id: `b${String(i + 1).padStart(2, '0')}`, at }));
const HARP = [{ id: 'h1', at: '1:2.5' }, { id: 'h2', at: '2:4.5' }, { id: 'h3', at: '4:2.5' }, { id: 'h4', at: '5:4.5' }];
export type SongEdit = 'none' | 'strings_note' | 'harp_note' | 'piano_note' | 'louder_g3';
/** The note each edit adds, where it adds one. */
export const ADDED = { strings_note: 'g_new', harp_note: 'h_new', piano_note: 'a0_extra' } as const;
/**
 * The song: stem `keys` (piano and bell, sampled from test/keys, and harp, plucked), stem `strings` (guitar, plucked
 * nylon) and stem `pads` (warm, the synth pad, at MIDI 55 and up). An edit adds one note or changes one.
 */
export function song(lib: Library, edit: SongEdit = 'none', item = 'song'): JsonObject {
  const events: Record<string, Ev> = {};
  for (const p of PIANO) events[p.id] = { at: p.at, inst: 'piano', pitch: 60, dur: '0.25s', vel: 0.7, attack: '0s', release: '0s' };
  for (const b of BELL) events[b.id] = { at: b.at, inst: 'bell', pitch: 72, dur: '0.25s', vel: 0.6, attack: '0s', release: '0s' };
  for (const h of HARP) events[h.id] = { at: h.at, inst: 'harp', pitch: 64, dur: '0.25s', vel: 0.6, release: '0.05s' };
  [52, 54, 55, 57, 59, 60].forEach((pitch, i) => { events[`g${i + 1}`] = { at: `${i + 1}:1`, inst: 'guitar', pitch, dur: '1s', vel: edit === 'louder_g3' && i === 2 ? 0.9 : 0.6 }; });
  events['w1'] = { at: '1:1', inst: 'warm', pitch: 55, dur: '5s', vel: 0.4 };
  events['w2'] = { at: '3:1', inst: 'warm', pitch: 60, dur: '5s', vel: 0.4 };
  events['w3'] = { at: '5:1', inst: 'warm', pitch: 57, dur: '5s', vel: 0.4 };
  if (edit === 'strings_note') events[ADDED.strings_note] = { at: '3:3', inst: 'guitar', pitch: 59, dur: '1s', vel: 0.6 };
  if (edit === 'harp_note') events[ADDED.harp_note] = { at: '3:2.5', inst: 'harp', pitch: 67, dur: '0.25s', vel: 0.6, release: '0.05s' };
  if (edit === 'piano_note') events[ADDED.piano_note] = { at: '3:3', inst: 'piano', pitch: 60, dur: '0.25s', vel: 0.7, attack: '0s', release: '0s' };
  const instruments = {
    piano: sampled(ref(lib), 'piano', 'keys'), bell: sampled(ref(lib), 'bell', 'keys'), harp: pluck('harp', 'keys'),
    guitar: pluck('nylon', 'strings'), warm: synth('pad', 'pads'),
  };
  return film([scoreItem(item, instruments, events)], { tempo: tempo(SONG_BPM), packs: [ref(lib)], span: '20s' });
}
/** The harp note criterion 1 adds, alone: the same score item (so the same seed), the same event ID, instrument and stem. */
export function harpAlone(item = 'song'): JsonObject {
  const events: Record<string, Ev> = { [ADDED.harp_note]: { at: '3:2.5', inst: 'harp', pitch: 67, dur: '0.25s', vel: 0.6, release: '0.05s' } };
  return film([scoreItem(item, { harp: pluck('harp', 'keys') }, events)], { tempo: tempo(SONG_BPM), span: '20s' });
}
/** The etude (criterion 1): 1,000 sixteenth notes at 240 BPM on test/keys' `staccato`, four takes; note k on sample
 * k × 3,000. */
export const ETUDE_NOTES = 1000;
export function etude(lib: Library): JsonObject {
  const events: Record<string, Ev> = {};
  for (let k = 0; k < ETUDE_NOTES; k++) events[`n${String(k).padStart(4, '0')}`] = { at: barBeat(k / 4), inst: 'piano', pitch: 60, dur: '0.05s', vel: 0.7, attack: '0s', release: '0s' };
  return film([scoreItem('etude', { piano: sampled(ref(lib), 'staccato', 'keys') }, events)], { tempo: tempo(240, 260), packs: [ref(lib)], span: '64s' });
}

// ---------------------------------------------------------------------------------------------------
// The test plug-in (criterion 8): a second registration of score.render, written at test time.

const { packageDigest } = await import(new URL('../../../packages/extension-host/src/index.ts', import.meta.url).href) as typeof import('../../../packages/extension-host/src/index.ts');
export const RIVAL = 'test/score-rival';
/** test/score-rival@1.0.0: its manifest declares the job kind score.render and a check of its own, and its code
 * registers them with deep.registerJob and deep.registerCheck; it registers no tool. Its digest is the extension
 * host's packageDigest of the folder (its public entry, as #1922's suite sets one). */
export function rivalPlugin(dir: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.ts'), [
    '// A second registration of the job kind score.render (#154 criterion 8), with a check of its own.',
    'export default async function (deep: any): Promise<void> {',
    "  await deep.registerCheck('test.score_rival', async () => ({ outcome: 'passed', testsRun: 1, evidence: [], read: [], mask: null, failures: [] }));",
    `  await deep.registerJob(${JSON.stringify(KIND)}, {`,
    "    schema: { params: { type: 'object' }, inputs: { samples: { media: 'audio/wav', many: true } } },",
    "    outputs: { stem: { media: 'audio/flac' }, meta: { media: 'application/json' } },",
    "    key: ['tool', 'params', 'inputs'],",
    "    output_checks: ['test.score_rival'],",
    '    qualification: { fixtures: [] },',
    '  });',
    '}',
    '',
  ].join('\n'));
  const manifest: Line = { id: RIVAL, version: '1.0.0', digest: '', checks: ['test.score_rival'], jobs: [KIND], requires: { preview: ['deep.registerCheck', 'deep.registerJob'] } };
  writeFileSync(join(dir, 'deepbuild.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  manifest.digest = packageDigest(dir);
  writeFileSync(join(dir, 'deepbuild.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

// ---------------------------------------------------------------------------------------------------
// The proof (the issue's Proof line), rewritten each run under $TMPDIR/deep-154-proof/.

export const PROOF_DIR = join(tmpdir(), 'deep-154-proof');
export function proof(name: string, value: unknown): void {
  mkdirSync(PROOF_DIR, { recursive: true });
  writeFileSync(join(PROOF_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}
