// Test-side tools for the #549 acceptance tests (README: The surface under test). They build `deep-show` per Cargo
// feature set and the shipped relay `deep-relay`; drive `deep-show run` (#393's scenario: one JSON line in, one answer
// line out) without blocking this process, so the doors and servers below keep running; make a throwaway certificate
// (#309's helper); stand a door in front of the relay that ends TLS with that certificate, reads every relay@1 message
// that crosses it (relay@1 is a WebSocket over https, packages/contracts/slots/relay@1.json) and can delay or drop
// them as a network would; speak relay@1 as a third connection; serve a bundle over HTTP; and drive Google Chrome
// headless over its DevTools protocol, logging every request and socket a page makes. Nothing here stands in for the
// net module, a network backend, the relay, the player or a check: every hash, entry, prompt, notice and report a test
// reads is the implementation's own, and every expected value comes from the issue, the design and fixtures.ts.

import { X509Certificate, createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { cpus, homedir, loadavg, tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { connect as tlsConnect, createServer as createTlsServer, type Server as TlsServer } from 'node:tls';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { startRelay, useCerts, useCleanup, type Certs, type Relay } from '../309/helpers.ts';
import { FLICKS, STEP, type JsonObject, type JsonValue, type Play, type Plays } from './fixtures.ts';

export { startRelay, useCleanup };
export type { Certs, JsonObject, JsonValue, Relay };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/549 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** cargo on PATH: the pinned toolchain's folder first when it is there (as #172's helpers do). */
const TOOLCHAIN = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
if (existsSync(TOOLCHAIN) && !(process.env['PATH'] ?? '').split(':').includes(TOOLCHAIN)) process.env['PATH'] = `${TOOLCHAIN}:${process.env['PATH'] ?? ''}`;
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
};
const MIB = 1024 * 1024;

/** Every `it` passes this: a first build of `deep-show` takes many minutes on a loaded machine, and a live match of
 * 3,600 steps at 20 Hz lasts three minutes at the least. */
export const TIMEOUT = 5_400_000;
/** How long a live phase may take on the wall clock before the test gives up on it (never an assertion on speed). */
export const LIVE_MS = 2_400_000;

/** Each criterion's ID: `#549.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #549.a86e15ac',
  2: 'AC2 #549.83ea272a',
  3: 'AC3 #549.ef287875',
  4: 'AC4 #549.a6b30a32',
  5: 'AC5 #549.6bf6ea62',
  6: 'AC6 #549.28bcfddc',
  7: 'AC7 #549.c5f03db3',
  8: 'AC8 #549.c5b39b72',
} as const;

/** A tool or host this machine lacks: the test fails with this message, never passes (invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}; this is not a pass`); };
/** A live phase that didn't finish in time: INCONCLUSIVE when the machine's 1-minute load is above its cores (the
 * rule #23's and #140's timed tests gate on), a plain failure otherwise. Never a pass. */
export function gaveUp(what: string): never {
  const load = loadavg()[0] ?? 0;
  if (load > cpus().length) throw Error(`INCONCLUSIVE: ${what}, with a 1-minute load of ${load.toFixed(1)} on ${cpus().length} cores; run it again on a quieter machine; this is not a pass`);
  throw Error(`${what} (1-minute load ${load.toFixed(1)} on ${cpus().length} cores)`);
}
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

// ---------------------------------------------------------------------------------------------------
// JSON

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: unknown, n = 1500): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v, 600)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v, 600)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a number, got ${show(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v, 600)}`).toBe('string');
  return v as string;
}
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 30).join('\n  ')}`).toEqual([]);
}
/** A planted program's run: this suite's own judgement must fail it, and some failure must match every one of `named`. */
export function failsNaming(failures: readonly string[], named: RegExp[], what: string): void {
  expect(failures.length, `${what}: the criterion's check fails the planted program`).toBeGreaterThan(0);
  expect(failures.some((f) => named.every((n) => n.test(f))), `${what}: a failure names ${named.join(' and ')}; the failures:\n  ${failures.slice(0, 12).join('\n  ')}`).toBe(true);
}
/** Runs `make` once per file, the first time a test asks (a file's tests share one run). */
export function once<T>(make: () => Promise<T>): () => Promise<T> {
  let done: Promise<T> | null = null;
  return () => (done ??= make());
}
/** mulberry32: a fixed-seed generator of numbers in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------------
// Builds: `deep-show` once per feature set and the shipped relay, in the file's beforeAll, copied out of the target.

/** The shipped set, and criterion 7's two builds (both at the base: #1920's and #533's test features). */
export const FULL = 'full';
export const PHYSICS_PATCH = 'full,test-physics-rapier-patch';
export const LOGIC_PATCH = 'full,test-logic-patch';

function cargo(args: string[]): string {
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * MIB, env: { ...process.env, ...CARGO_ENV } });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${(r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|^\s*Compiling|^\s*Finished|Download|^\s*Locking|^\s*Updating/.test(l)).join('\n').slice(-4000)}`;
  return '';
}
export interface Builds { show: (set?: string) => string; relay: () => string }
export function useBuilds(o: { show?: readonly string[]; relay?: boolean }): Builds {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-549-bins-'));
    for (const set of o.show ?? [FULL]) {
      const bin = join(dir, `deep-show-${set.replace(/,/g, '+')}`);
      const error = cargo(['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', set]);
      if (error === '') copyFileSync(join(TARGET, 'debug', 'deep-show'), bin);
      made.set(`show:${set}`, { bin, error });
    }
    if (o.relay) {
      const bin = join(dir, 'deep-relay');
      const error = cargo(['build', '--locked', '--bin', 'deep-relay']);
      if (error === '') copyFileSync(join(TARGET, 'debug', 'deep-relay'), bin);
      made.set('relay', { bin, error });
    }
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  const take = (key: string, what: string): string => {
    const e = made.get(key);
    if (!e) throw Error(`the file didn't list ${what} in useBuilds`);
    if (/cargo could not run/.test(e.error)) blocked(`${e.error}: this machine lacks the Rust toolchain`);
    expect(e.error, `the binary builds: ${what}`).toBe('');
    return e.bin;
  };
  return { show: (set = FULL) => take(`show:${set}`, `deep-show with features ${set}`), relay: () => take('relay', 'deep-relay') };
}
/** #309's throwaway certificate authority and relay certificate for 127.0.0.1, made with the openssl CLI in a temporary
 * folder and deleted after the file; without openssl the test is BLOCKED, never a pass. */
export function useCertificate(): () => Certs {
  const made = useCerts();
  let missing: string | null = null;
  return () => {
    if (missing === null) {
      const probe = spawnSync('openssl', ['version'], { encoding: 'utf8' });
      missing = probe.error || probe.status !== 0 ? (probe.error?.message ?? probe.stderr ?? 'openssl version failed') : '';
    }
    if (missing) blocked(`the openssl CLI can't run (${missing}); the throwaway certificate for 127.0.0.1 is made with it. Unblock: install openssl`);
    return made();
  };
}
/** Fresh folders for a test (evidence stores, bundles), all deleted after it. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-549-')); made.push(d); return d; };
}
/** #15's evidence store: `<2 hex>/<62 hex>`, each file named by its bytes' SHA-256. */
export function putEvidence(evidence: string, bytes: Uint8Array): string {
  const h = sha256(bytes);
  mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line on stdin, one answer `{ok, replies}`. The scenario is #169's and #172's world:
// you and an agent's session, each document on a panel of its own (the first on `main`), #383's virtual clock, so
// every call carries `at` in flicks.

/** The scenario's `planted` values this suite adds (README: Planted twins). */
export type Planted = 'net_runs_step_early' | 'net_resends_nothing';
const AGENT = { id: 'sess-549', thread: 'thread-549', name: 'Test agent: shared play', process: { pid: 4100, start: 1_000 } } as const;
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 },
  { pid: 4100, ppid: 3001, start: 1_000 }, { pid: 4101, ppid: 4100, start: 1_100 }, { pid: 4102, ppid: 4101, start: 1_200 },
];
/** `deep show` from your shell acts as you. */
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
/** A process that posts a synthetic click, as deep_drive's replica does (it is not in your shell's tree). */
export const DRIVER_PID = 4102;
export const PANEL = 'main';
export const PANEL_SIZE: [number, number] = [640, 360];

export interface World {
  evidence: string;
  /** The documents shown, the first on `main`; `link`: the link this copy opened the piece through (README). */
  docs: { id: string; link?: string }[];
  calls: JsonObject[];
  planted?: Planted;
  /** #172's scenario key: the app's secret store, as the scenario holds it. */
  secrets?: Record<string, string>;
  /** The PEM authority the app's network backend trusts for this run beside the platform's own (README). */
  relayCa?: string;
}
export function scenario(w: World): JsonObject {
  const panels: JsonObject = {};
  const docs: JsonObject = {};
  w.docs.forEach((d, k) => {
    const panel = k === 0 ? PANEL : `side-${k}`;
    panels[panel] = { rect: k === 0 ? [0, 0, ...PANEL_SIZE] : [0, 720, ...PANEL_SIZE] };
    docs[d.id] = { panel, ...(d.link ? { link: d.link } : {}) };
  });
  return {
    evidence: w.evidence, sessions: { [AGENT.id]: { thread: AGENT.thread, name: AGENT.name, process: { ...AGENT.process } } }, processes: PROCESSES,
    panels, docs, clock: { refresh_hz: 60, lead: 0, check: 0 },
    ...(w.planted ? { planted: w.planted } : {}), ...(w.secrets ? { secrets: w.secrets } : {}), ...(w.relayCa ? { relay_ca: w.relayCa } : {}), calls: w.calls,
  };
}

/** #1920's scenario for a build's published plan: no document, no clock, so its calls carry no `at`. */
export function planScenario(evidence: string, calls: JsonObject[]): JsonObject {
  return { evidence, sessions: { [AGENT.id]: { thread: AGENT.thread, name: AGENT.name, process: { ...AGENT.process } } }, processes: PROCESSES, panels: { [PANEL]: { rect: [0, 0, 800, 600] } }, docs: {}, calls };
}

const live = new Set<ChildProcess>();
/** Stops every `deep-show` this file started that still runs, by its PID, after each test. */
export function useChildren(): void {
  afterEach(() => { stopChildren(); });
}
/** Stops every `deep-show` this file started that still runs, by its PID (a copy left waiting for a match). */
export function stopChildren(): void {
  for (const c of live) c.kill('SIGKILL');
  live.clear();
}
export interface Ran { status: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean }
function run(bin: string, args: string[], input: string, timeoutMs: number): Promise<Ran> {
  return new Promise((done) => {
    const child = spawn(bin, args, { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
    live.add(child);
    const out: Buffer[] = [];
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (d: Buffer) => { out.push(d); });
    child.stderr.setEncoding('utf8').on('data', (d: string) => { stderr = (stderr + d).slice(-20_000); });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    const end = (status: number | null, signal: string | null, error = ''): void => {
      clearTimeout(timer);
      live.delete(child);
      done({ status, signal, stdout: Buffer.concat(out).toString('utf8'), stderr: error || stderr, timedOut });
    };
    child.once('error', (e) => end(null, null, `${bin} could not run: ${e.message}`));
    child.once('close', (status, signal) => end(status, signal));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
/** `deep-show run` on one scenario: exit 0, one answer line, ok, one reply per call, in call order. */
export async function runShow(bin: string, sc: JsonObject, what: string, timeoutMs = LIVE_MS): Promise<JsonObject[]> {
  const tag = typeof sc['planted'] === 'string' ? `${what} (planted ${sc['planted']})` : what;
  const r = await run(bin, ['run'], `${JSON.stringify(sc)}\n`, timeoutMs);
  if (r.timedOut) gaveUp(`${tag}: deep-show run did not finish within ${Math.round(timeoutMs / 60_000)} minutes`);
  expect(r.status, `${tag}: deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${r.stdout.slice(0, 800)}; stderr: ${r.stderr.slice(-1500)}`).toBe(0);
  const lines = r.stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${tag}: one answer line`).toBe(1);
  let parsed: JsonValue;
  try { parsed = JSON.parse(lines[0]!) as JsonValue; } catch { parsed = lines[0]!.slice(0, 500); }
  const out = obj(parsed, `${tag}: the answer`);
  expect(out['ok'], `${tag}: deep-show run answers the scenario ok${typeof sc['planted'] === 'string' ? ` (it takes the planted ${sc['planted']})` : ''}; got ${show(out)}`).toBe(true);
  const list = arr(out['replies'], `${tag}: replies`).map((x, i) => obj(x, `${tag}: replies[${i}]`));
  expect(list.length, `${tag}: one reply per call`).toBe(arr(sc['calls'], 'calls').length);
  return list;
}

/** The calls of one run on the virtual clock, each at its own `at`, in order; each method gives its call's index. */
export class Script {
  readonly calls: JsonObject[] = [];
  private t = 0;
  /** The time of the last call, in flicks. */
  get now(): number { return this.t; }
  add(c: JsonObject, gapSeconds = 0.05): number {
    this.t += Math.round(gapSeconds * FLICKS);
    this.calls.push({ ...c, at: this.t });
    return this.calls.length - 1;
  }
  /** `deep show` of a whole document from your shell (#393), with its issues. */
  present(doc: string, document: JsonObject): number { return this.add({ call: 'deep show', peer: YOU_PEER, doc, document, include: ['issues'] }, 0.001); }
  /** #383's `scope`: the panel's state, with the app's Join prompt as `state.join` (README). */
  scope(gapSeconds = 0.2): number { return this.add({ call: 'scope', panel: PANEL }, gapSeconds); }
  /** A click at `pos` (panel px): a press and a release 60 ms apart. `synthetic`: posted by a process, not hardware. */
  click(pos: [number, number], synthetic = false): [number, number] {
    const source: JsonObject = synthetic ? { source: 'synthetic', pid: DRIVER_PID } : {};
    return [
      this.add({ call: 'input', panel: PANEL, event: { type: 'down', pos, ...source } }, 0.2),
      this.add({ call: 'input', panel: PANEL, event: { type: 'up', pos, ...source } }, 0.06),
    ];
  }
  /** README: `sockets`. Every connection and request this run has opened so far. */
  sockets(gapSeconds = 0.05): number { return this.add({ call: 'sockets' }, gapSeconds); }
  /** README: `match`. Every copy of the document's match in this process over the test relay, with no network. */
  match(doc: string, steps: number, o: MatchAsk = {}): number {
    return this.add({
      call: 'match', doc, steps, ...(o.plays ? { plays: o.plays as unknown as JsonObject } : {}), ...(o.relay ? { relay: o.relay as unknown as JsonObject } : {}),
      ...(o.check ? { check: o.check } : {}), ...(o.renderBack ? { render_back: o.renderBack as unknown as JsonValue[] } : {}),
    });
  }
  /** README: `play_match`. This copy's live match, in real time, until it has run `steps` match steps or the match ends. */
  playMatch(steps: number, o: { plays?: Play[]; linkTo?: string } = {}): number {
    return this.add({ call: 'play_match', panel: PANEL, steps, ...(o.plays ? { plays: o.plays as unknown as JsonValue[] } : {}), ...(o.linkTo ? { link_to: o.linkTo } : {}) });
  }
  /** Moves the clock to `seconds` (the next call comes then, plus its own gap). */
  until(seconds: number): void { this.t = Math.max(this.t, Math.round(seconds * FLICKS)); }
}
/** The test relay's faults on its own clock (README: `match`): seconds are match-clock seconds. */
export interface RelayAsk { seed: number; drop?: number; hold?: { player: number; at: number; for: number }[]; log?: boolean }
export interface MatchAsk { plays?: Plays; relay?: RelayAsk; check?: 'net.rollback' | 'net.budget'; renderBack?: { player: number; t: number }[] }

/** A `deep show` reply that presented its document with no error. */
export function presented(reply: JsonObject | undefined, what: string): void {
  const r = obj(reply, what);
  const issues = Array.isArray(r['issues']) ? r['issues'].filter(isObject) : [];
  expect(r['outcome'], `${what} is presented: ${show(r['issues'] ?? r, 2500)}`).toBe('presented');
  expect(issues.filter((i) => i['severity'] === 'error'), `${what} is presented with no error`).toEqual([]);
}
/** The app's Join prompt in a `scope` (or `input`) reply: `state.join`, null when the app shows none (README). */
export interface Prompt { state: string; relay: string; text: string; button: [number, number, number, number]; raw: JsonObject }
export function promptOf(reply: JsonObject | undefined, what: string): Prompt | null {
  const state = obj(obj(reply, what)['state'], `${what}: state (${show(reply, 600)})`);
  expect('join' in state, `${what}: the scope's state says whether the app shows a Join prompt (state.join, null when it shows none); state holds ${Object.keys(state).join(', ')}`).toBe(true);
  if (state['join'] === null) return null;
  const j = obj(state['join'], `${what}: state.join`);
  const b = arr(j['button'], `${what}: state.join.button`).map((x, i) => num(x, `${what}: state.join.button[${i}]`));
  expect(b.length, `${what}: state.join.button is [x, y, w, h] in panel px`).toBe(4);
  return { state: str(j['state'], `${what}: state.join.state`), relay: str(j['relay'], `${what}: state.join.relay`), text: str(j['text'], `${what}: state.join.text`), button: b as [number, number, number, number], raw: j };
}
export const centreOf = (b: readonly [number, number, number, number]): [number, number] => [b[0] + b[2] / 2, b[1] + b[3] / 2];

/** One line of the app's `sockets` log (README): a connection or a request the capability layer opened. */
export interface Opened { kind: string; host: string; raw: JsonObject }
export function socketsOf(reply: JsonObject | undefined, what: string): Opened[] {
  const r = obj(reply, what);
  expect(r['code'], `${what}: the sockets call answers, not refuses: ${show(r)}`).toBeUndefined();
  return arr(r['log'], `${what}: sockets.log`).map((v, i) => { const e = obj(v, `${what}: log[${i}]`); return { kind: str(e['kind'], `${what}: log[${i}].kind`), host: str(e['host'], `${what}: log[${i}].host`), raw: e }; });
}

// ---------------------------------------------------------------------------------------------------
// A copy's report (README: A copy's report): what `match` gives for each copy, what `play_match` gives for its own,
// and what the web player's `probe().match` gives.

export interface Entry { t: number; player: number; control: string; value: JsonValue; writer: string; seq: number }
export interface Wait { step: number; player: number; from: number; to: number | null }
export interface Notice { player: number; from: number; to: number | null }
export interface MatchRecord { document: string; moduleSetDigest: string; runtimeDigest: string; players: number; track: Entry[]; confirmed: number; end: string | null; raw: JsonObject }
export interface Copy {
  player: number; ran: number; rollbacks: number; hashes: { step: number; hash: string }[]; waits: Wait[]; notices: Notice[]; end: string | null;
  record: MatchRecord | null;
  /** When it ran each match step, in seconds on the test relay's clock (`match` only): index k is step k. */
  ranAt: number[] | null;
  raw: JsonObject;
}
const HASH64 = /^[0-9a-f]{16}$/;
function entriesOf(v: JsonValue | undefined, what: string): Entry[] {
  return arr(v, what).map((x, i) => {
    const e = obj(x, `${what}[${i}]`);
    return { t: num(e['t'], `${what}[${i}].t`), player: num(e['player'], `${what}[${i}].player`), control: String(e['control'] ?? ''), value: e['value'] ?? null, writer: String(e['writer'] ?? ''), seq: typeof e['seq'] === 'number' ? e['seq'] : 0 };
  });
}
export function copyOf(v: JsonValue | undefined, what: string): Copy {
  const c = obj(v, what);
  const seconds = (x: JsonValue | undefined, w: string): number | null => (x === null || x === undefined ? null : num(x, w));
  const hashes = arr(c['hashes'], `${what}: hashes (the full-state hash at each hash interval this copy confirmed)`).map((x, i) => {
    const h = obj(x, `${what}: hashes[${i}]`);
    const hash = str(h['hash'], `${what}: hashes[${i}].hash`);
    expect(hash, `${what}: hashes[${i}].hash is a u64 as 16 hex digits`).toMatch(HASH64);
    return { step: num(h['step'], `${what}: hashes[${i}].step`), hash };
  });
  const waits = arr(c['waits'], `${what}: waits`).map((x, i) => {
    const w = obj(x, `${what}: waits[${i}]`);
    return { step: num(w['step'], `${what}: waits[${i}].step`), player: num(w['player'], `${what}: waits[${i}].player`), from: num(w['from'], `${what}: waits[${i}].from`), to: seconds(w['to'], `${what}: waits[${i}].to`) };
  });
  const notices = arr(c['notices'], `${what}: notices`).map((x, i) => {
    const n = obj(x, `${what}: notices[${i}]`);
    return { player: num(n['player'], `${what}: notices[${i}].player`), from: num(n['from'], `${what}: notices[${i}].from`), to: seconds(n['to'], `${what}: notices[${i}].to`) };
  });
  let record: MatchRecord | null = null;
  if (c['record'] !== null && c['record'] !== undefined) {
    const r = obj(c['record'], `${what}: record`);
    record = {
      document: str(r['document'], `${what}: record.document`), moduleSetDigest: str(r['module_set_digest'], `${what}: record.module_set_digest`),
      runtimeDigest: str(r['runtime_digest'], `${what}: record.runtime_digest`), players: num(r['players'], `${what}: record.players`),
      track: entriesOf(r['track'], `${what}: record.track`), confirmed: num(r['confirmed'], `${what}: record.confirmed`),
      end: r['end'] === null || r['end'] === undefined ? null : str(r['end'], `${what}: record.end`), raw: r,
    };
  }
  return {
    player: num(c['player'], `${what}: player`), ran: num(c['ran'], `${what}: ran (the match steps this copy ran)`), rollbacks: num(c['rollbacks'], `${what}: rollbacks`),
    hashes, waits, notices, end: c['end'] === null || c['end'] === undefined ? null : str(c['end'], `${what}: end`), record,
    ranAt: Array.isArray(c['ran_at']) ? c['ran_at'].map((x, i) => num(x, `${what}: ran_at[${i}]`)) : null, raw: c,
  };
}
/** The test relay's report in a `match` reply (README): its counts and, when asked, every frame it carried. */
export interface CarriedFrame { player: number; first: number; count: number; confirmed: number; at: number; delivered: number | null }
export interface RelayReport { frames: number; dropped: number; log: CarriedFrame[] }
export function relayOf(reply: JsonObject | undefined, what: string): RelayReport {
  const r = obj(obj(reply, what)['relay'], `${what}: relay (the test relay's report)`);
  const log = arr(r['log'], `${what}: relay.log`).map((x, i) => {
    const f = obj(x, `${what}: relay.log[${i}]`);
    return {
      player: num(f['player'], `${what}: relay.log[${i}].player`), first: num(f['first'], `${what}: relay.log[${i}].first`), count: num(f['count'], `${what}: relay.log[${i}].count`),
      confirmed: num(f['confirmed'], `${what}: relay.log[${i}].confirmed`), at: num(f['at'], `${what}: relay.log[${i}].at`),
      delivered: f['delivered'] === null ? null : num(f['delivered'], `${what}: relay.log[${i}].delivered`),
    };
  });
  return { frames: num(r['frames'], `${what}: relay.frames`), dropped: num(r['dropped'], `${what}: relay.dropped`), log };
}
/** A check's report in a `match` reply, as `logic`'s is (#539): its kind, verdict and failures. */
export interface CheckReport { kind: string; verdict: string; failures: JsonObject[]; raw: JsonObject }
export function checkOf(reply: JsonObject | undefined, what: string): CheckReport {
  const c = obj(obj(reply, what)['check'], `${what}: check`);
  return { kind: str(c['kind'], `${what}: check.kind`), verdict: str(c['verdict'], `${what}: check.verdict`), failures: arr(c['failures'], `${what}: check.failures`).filter(isObject), raw: c };
}
/** The piece's own layer as render-back draws it for one copy at one match time (README: `render_back`). */
export interface Render { player: number; t: number; step: number; sha256: string; notice: { player: number; since: number } | null }
export function rendersOf(reply: JsonObject | undefined, what: string): Render[] {
  return arr(obj(reply, what)['renders'], `${what}: renders`).map((x, i) => {
    const r = obj(x, `${what}: renders[${i}]`);
    const hash = str(r['sha256'], `${what}: renders[${i}].sha256`);
    expect(hash, `${what}: renders[${i}].sha256 is the SHA-256 of the layer's pixels`).toMatch(/^[0-9a-f]{64}$/);
    expect('notice' in r, `${what}: renders[${i}].notice is the app's waiting notice at that time, or null`).toBe(true);
    const n = r['notice'] === null ? null : obj(r['notice'], `${what}: renders[${i}].notice`);
    return {
      player: num(r['player'], `${what}: renders[${i}].player`), t: num(r['t'], `${what}: renders[${i}].t`), step: num(r['step'], `${what}: renders[${i}].step`), sha256: hash,
      notice: n ? { player: num(n['player'], `${what}: renders[${i}].notice.player`), since: num(n['since'], `${what}: renders[${i}].notice.since`) } : null,
    };
  });
}
/** A `match` reply's copies, in player order; a refusal fails, naming it. */
export function copiesOf(reply: JsonObject | undefined, what: string): Copy[] {
  const m = obj(reply, what);
  expect(m['code'], `${what}: the match call answers, not refuses: ${show(m, 1500)}`).toBeUndefined();
  return arr(m['copies'], `${what}: copies`).map((c, i) => copyOf(c, `${what}: copies[${i}]`)).sort((a, b) => a.player - b.player);
}
/** A copy's last value of a logic array (#540's `steps`: each logic step's row with its arrays). */
export function lastArray(copy: Copy, name: string, what: string): JsonValue[] {
  const rows = arr(copy.raw['steps'], `${what}: steps`);
  const last = obj(rows[rows.length - 1], `${what}: the last step's row`);
  return arr(obj(last['arrays'], `${what}: the last step's arrays`)[name], `${what}: the last step's ${name}`);
}

/** Hashes of two copies (or two runs) at every step both report: each failure names the first step that differs. */
export function hashFailures(a: Copy, b: Copy, what: string, o: { hashEvery: number; atLeast: number }): string[] {
  const f: string[] = [];
  for (const [c, label] of [[a, 'the first'], [b, 'the second']] as const) {
    if (c.hashes.length < o.atLeast) f.push(`${what}: ${label} copy reports ${c.hashes.length} full-state hashes, fewer than ${o.atLeast}`);
    c.hashes.forEach((h, i) => { if (i > 0 && h.step - c.hashes[i - 1]!.step !== o.hashEvery) f.push(`${what}: ${label} copy's hashes at steps ${c.hashes[i - 1]!.step} and ${h.step} are not ${o.hashEvery} match steps apart`); });
  }
  const other = new Map(b.hashes.map((h) => [h.step, h.hash]));
  let shared = 0;
  for (const h of a.hashes) {
    const got = other.get(h.step);
    if (got === undefined) continue;
    shared += 1;
    if (got !== h.hash) { f.push(`${what}: the full-state hashes differ first at match step ${h.step}: ${h.hash} and ${got}`); break; }
  }
  if (shared < o.atLeast) f.push(`${what}: the two report only ${shared} hashes at the same steps, fewer than ${o.atLeast}`);
  return f;
}
/** The first step at which two hash lists differ, or null. */
export function firstDifference(a: Copy, b: Copy): number | null {
  const other = new Map(b.hashes.map((h) => [h.step, h.hash]));
  for (const h of a.hashes) { const got = other.get(h.step); if (got !== undefined && got !== h.hash) return h.step; }
  return null;
}
/** A merged track as every copy must record it: each entry's step, player, control and value, in (step, player, seq)
 * order, up to but not including match step `before`. The writer isn't compared: your entry is a peer's on the other copy. */
export function merged(track: readonly Entry[], before: number): string[] {
  return track.filter((e) => e.t < before * STEP).slice().sort((x, y) => x.t - y.t || x.player - y.player || x.seq - y.seq)
    .map((e) => `${e.t / STEP} p${e.player} ${e.control}=${JSON.stringify(e.value)}`);
}
/** Every entry of a script, as the merged track must hold it once stamped `delay` steps later. */
export function expectedTrack(plays: Plays, delay: number, before: number): string[] {
  const out: { step: number; player: number; line: string }[] = [];
  for (const [player, list] of Object.entries(plays)) for (const e of list) if (e.step + delay < before) out.push({ step: e.step + delay, player: Number(player), line: `${e.step + delay} p${player} ${e.control}=${JSON.stringify(e.value)}` });
  return out.sort((x, y) => x.step - y.step || x.player - y.player).map((x) => x.line);
}

// ---------------------------------------------------------------------------------------------------
// relay@1 on the wire (packages/contracts/slots/relay@1.json): a WebSocket over https; each control message one JSON
// text message with exactly one member; each frame one binary message. This file reads WebSocket framing (RFC 6455)
// only to find each message; it never changes one.

export interface Message { kind: 'text' | 'binary' | 'close' | 'ping' | 'pong'; bytes: Buffer; json: JsonObject | null; member: string | null; dropped: boolean }
interface WsFrame { fin: boolean; opcode: number; payload: Buffer; raw: Buffer }
/** Splits a byte stream into WebSocket frames, unmasking each payload for reading; `raw` is the frame as it came. */
class Frames {
  private buf: Buffer = Buffer.alloc(0);
  push(chunk: Buffer): WsFrame[] {
    this.buf = Buffer.concat([this.buf, chunk]);
    const out: WsFrame[] = [];
    for (;;) {
      if (this.buf.length < 2) return out;
      const b0 = this.buf[0]!;
      const b1 = this.buf[1]!;
      let len = b1 & 0x7f;
      let at = 2;
      if (len === 126) { if (this.buf.length < 4) return out; len = this.buf.readUInt16BE(2); at = 4; } else if (len === 127) { if (this.buf.length < 10) return out; len = Number(this.buf.readBigUInt64BE(2)); at = 10; }
      const masked = (b1 & 0x80) !== 0;
      const total = at + (masked ? 4 : 0) + len;
      if (this.buf.length < total) return out;
      const raw = Buffer.from(this.buf.subarray(0, total));
      let payload = Buffer.from(raw.subarray(at + (masked ? 4 : 0)));
      if (masked) { const key = raw.subarray(at, at + 4); payload = Buffer.from(payload.map((x, i) => x ^ key[i % 4]!)); }
      out.push({ fin: (b0 & 0x80) !== 0, opcode: b0 & 0x0f, payload, raw });
      this.buf = this.buf.subarray(total);
    }
  }
}
/** Groups frames into messages (a fragmented message's frames together), each with its raw bytes. */
class Messages {
  private readonly frames = new Frames();
  private parts: WsFrame[] = [];
  push(chunk: Buffer): { message: Message; raw: Buffer }[] {
    const out: { message: Message; raw: Buffer }[] = [];
    for (const f of this.frames.push(chunk)) {
      if (f.opcode >= 8) { out.push({ message: messageOf(f.opcode, f.payload), raw: f.raw }); continue; }
      this.parts.push(f);
      if (!f.fin) continue;
      const parts = this.parts;
      this.parts = [];
      out.push({ message: messageOf(parts[0]!.opcode, Buffer.concat(parts.map((p) => p.payload))), raw: Buffer.concat(parts.map((p) => p.raw)) });
    }
    return out;
  }
}
function messageOf(opcode: number, payload: Buffer): Message {
  const kind = opcode === 1 ? 'text' : opcode === 2 ? 'binary' : opcode === 8 ? 'close' : opcode === 9 ? 'ping' : 'pong';
  let json: JsonObject | null = null;
  if (kind === 'text') { try { const v = JSON.parse(payload.toString('utf8')) as JsonValue; if (isObject(v)) json = v; } catch { /* not JSON: kept as bytes */ } }
  return { kind, bytes: payload, json, member: json ? (Object.keys(json)[0] ?? null) : null, dropped: false };
}
/** A stream's HTTP header block, then the rest. */
class Head {
  private buf: Buffer = Buffer.alloc(0);
  done = false;
  /** Null until the header block is whole; then its text and whatever followed it. */
  push(chunk: Buffer): { head: string; rest: Buffer } | null {
    this.buf = Buffer.concat([this.buf, chunk]);
    const end = this.buf.indexOf('\r\n\r\n');
    if (end < 0) return null;
    this.done = true;
    return { head: this.buf.subarray(0, end + 4).toString('latin1'), rest: Buffer.from(this.buf.subarray(end + 4)) };
  }
}
/** relay@1's frame, read in its documented little-endian layout: {match: 16 B, player: u8, confirmed: u32, first: u32,
 * count: u16, then each step's entries}. */
export interface RelayFrame { match: string; player: number; confirmed: number; first: number; count: number; entries: Buffer }
export const FRAME_HEADER = 27;
export function readFrame(bytes: Buffer, what: string): RelayFrame {
  expect(bytes.length, `${what}: a relay@1 frame holds at least its ${FRAME_HEADER}-byte header, got ${bytes.length} bytes`).toBeGreaterThanOrEqual(FRAME_HEADER);
  return { match: bytes.subarray(0, 16).toString('hex'), player: bytes.readUInt8(16), confirmed: bytes.readUInt32LE(17), first: bytes.readUInt32LE(21), count: bytes.readUInt16LE(25), entries: bytes.subarray(FRAME_HEADER) };
}

// ---------------------------------------------------------------------------------------------------
// The door: a listener on 127.0.0.1 that ends TLS with the relay's own throwaway certificate, opens its own TLS
// connection to the relay for each connection it takes, and hands every byte on. It is the network between a copy and
// the relay, seen from outside both: it logs each connection's request head and every relay@1 message either way, and
// on request delays each frame the relay forwards by a seeded time (in order), or drops the signaling a direct path
// needs. A piece declares the door's address as its relay.

export interface DoorAsk {
  /** Each binary frame the relay forwards to a copy waits a seeded time in this range (ms) first, order kept. */
  delayMs?: [number, number];
  seed?: number;
  /** false: every `signal` message is dropped, so no direct path can be set up. */
  signals?: boolean;
}
export interface Connection {
  id: number;
  /** The upgrade request's line and headers (names lower-cased), as the copy sent them. */
  request: { line: string; headers: Record<string, string> } | null;
  /** What the copy sent the relay, and what the relay sent the copy, in order. */
  sent: Message[];
  received: Message[];
  open: boolean;
}
export interface Door { host: string; url: string; connections: Connection[]; close: () => Promise<void> }
export async function startDoor(target: string, certs: Certs, ask: DoorAsk = {}): Promise<Door> {
  const [, port] = target.split(':');
  const connections: Connection[] = [];
  const sockets = new Set<Duplex>();
  const random = rng(ask.seed ?? 549);
  const server: TlsServer = createTlsServer({ cert: readFileSync(certs.cert), key: readFileSync(certs.key), ALPNProtocols: ['http/1.1'] }, (down) => {
    const conn: Connection = { id: connections.length + 1, request: null, sent: [], received: [], open: true };
    connections.push(conn);
    const up = tlsConnect({ host: '127.0.0.1', port: Number(port), ca: readFileSync(certs.ca), ALPNProtocols: ['http/1.1'] });
    for (const s of [down, up]) { sockets.add(s); s.once('close', () => sockets.delete(s)); }
    const heads = { down: new Head(), up: new Head() };
    const messages = { down: new Messages(), up: new Messages() };
    let release = 0;
    let pending = 0;
    let upEnded = false;
    const finish = (): void => { if (upEnded && pending === 0) down.end(); };
    const fromCopy = (bytes: Buffer): void => {
      for (const { message, raw } of messages.down.push(bytes)) {
        conn.sent.push(message);
        if (ask.signals === false && message.member === 'signal') { message.dropped = true; continue; }
        up.write(raw);
      }
    };
    const fromRelay = (bytes: Buffer): void => {
      for (const { message, raw } of messages.up.push(bytes)) {
        conn.received.push(message);
        if (ask.signals === false && message.member === 'signal') { message.dropped = true; continue; }
        const wait = ask.delayMs && message.kind === 'binary' ? ask.delayMs[0] + random() * (ask.delayMs[1] - ask.delayMs[0]) : 0;
        release = Math.max(release, Date.now() + wait);
        const after = release - Date.now();
        if (after <= 0 && pending === 0) { down.write(raw); continue; }
        pending += 1;
        setTimeout(() => { pending -= 1; if (!down.destroyed) down.write(raw); finish(); }, Math.max(0, after));
      }
    };
    down.on('data', (d: Buffer) => {
      if (heads.down.done) { fromCopy(d); return; }
      const h = heads.down.push(d);
      if (!h) return;
      const lines = h.head.split('\r\n').filter((l) => l !== '');
      const headers: Record<string, string> = {};
      for (const l of lines.slice(1)) { const i = l.indexOf(':'); if (i > 0) headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim(); }
      conn.request = { line: lines[0] ?? '', headers };
      // No extension is negotiated through the door, so every frame stays readable as it is.
      up.write(Buffer.from(`${lines.filter((l) => !/^sec-websocket-extensions:/i.test(l)).join('\r\n')}\r\n\r\n`, 'latin1'));
      if (h.rest.length) fromCopy(h.rest);
    });
    up.on('data', (d: Buffer) => {
      if (heads.up.done) { fromRelay(d); return; }
      const h = heads.up.push(d);
      if (!h) return;
      down.write(Buffer.from(h.head, 'latin1'));
      if (h.rest.length) fromRelay(h.rest);
    });
    up.on('end', () => { upEnded = true; finish(); });
    up.on('close', () => { upEnded = true; conn.open = false; finish(); });
    down.on('end', () => up.end());
    down.on('close', () => { conn.open = false; up.destroy(); });
    down.on('error', () => up.destroy());
    up.on('error', () => down.destroy());
  });
  server.on('tlsClientError', () => { /* a copy that refuses the certificate shows as no connection */ });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
  const address = server.address();
  const host = `127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  return {
    host, url: `https://${host}`, connections,
    close: () => new Promise<void>((done) => { for (const s of sockets) s.destroy(); server.close(() => done()); }),
  };
}
/** Every relay@1 message the copies sent through the door, each with its connection. */
export const sentThrough = (door: Door): { conn: number; message: Message }[] => door.connections.flatMap((c) => c.sent.map((message) => ({ conn: c.id, message })));
/** The binary frames among them. */
export const framesThrough = (door: Door): { conn: number; message: Message }[] => sentThrough(door).filter((m) => m.message.kind === 'binary');
/** The match IDs the copies' `join` messages named, in order. */
export function joinedMatches(door: Door): string[] {
  return sentThrough(door).flatMap((m) => (m.message.member === 'join' && isObject(m.message.json?.['join']) ? [String(m.message.json['join']['match'])] : []));
}
/** What a connection's request head and messages may never hold: a cookie, a credential, or any of `secrets`. Each
 * failure names the connection and what it held. */
export function leakFailures(door: Door, secrets: readonly string[], what: string): string[] {
  const f: string[] = [];
  for (const c of door.connections) {
    if (!c.request) { f.push(`${what}: connection ${c.id} sent no request head the door could read`); continue; }
    for (const h of ['cookie', 'authorization', 'proxy-authorization']) if (h in c.request.headers) f.push(`${what}: connection ${c.id}'s request carries a ${h} header`);
    if (/@/.test(c.request.line.split(' ')[1] ?? '')) f.push(`${what}: connection ${c.id}'s request target carries user information: ${c.request.line}`);
    const head = `${c.request.line}\n${Object.entries(c.request.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}`;
    for (const s of secrets) {
      if (head.includes(s)) f.push(`${what}: connection ${c.id}'s request head holds the secret ${s.slice(0, 12)}…`);
      if (c.sent.some((m) => m.bytes.includes(Buffer.from(s)))) f.push(`${what}: a message on connection ${c.id} holds the secret ${s.slice(0, 12)}…`);
    }
  }
  return f;
}

/** This suite's own relay@1 connection, a third party's: it connects to `host` trusting `ca`, reads whatever arrives
 * and sends the control messages it is given. */
export interface Third { received: Message[]; send: (message: JsonObject) => void; waitFor: (member: string, ms?: number) => Promise<Message | null>; close: () => void; closed: () => boolean }
export async function third(host: string, ca: string): Promise<Third> {
  const [name, port] = host.split(':');
  const socket = tlsConnect({ host: name!, port: Number(port), ca: readFileSync(ca), ALPNProtocols: ['http/1.1'] });
  const received: Message[] = [];
  const head = new Head();
  const messages = new Messages();
  let closed = false;
  let status = '';
  const opened = new Promise<void>((done, fail) => {
    socket.once('error', (e) => fail(Error(`no relay@1 connection to ${host}: ${e.message}`)));
    socket.once('secureConnect', () => {
      socket.write(`GET / HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    socket.on('data', (d: Buffer) => {
      let rest = d;
      if (!head.done) {
        const h = head.push(d);
        if (!h) return;
        status = h.head.split('\r\n')[0] ?? '';
        if (!/ 101 /.test(status)) { fail(Error(`${host} answered the WebSocket upgrade with "${status}"`)); return; }
        done();
        rest = h.rest;
      }
      for (const { message } of messages.push(rest)) received.push(message);
    });
  });
  socket.on('close', () => { closed = true; });
  await opened;
  const frame = (opcode: number, payload: Buffer): Buffer => {
    const key = randomBytes(4);
    const len = payload.length < 126 ? Buffer.from([0x80 | payload.length]) : Buffer.from([0x80 | 126, payload.length >> 8, payload.length & 0xff]);
    return Buffer.concat([Buffer.from([0x80 | opcode]), len, key, Buffer.from(payload.map((x, i) => x ^ key[i % 4]!))]);
  };
  return {
    received,
    send: (message) => { socket.write(frame(1, Buffer.from(JSON.stringify(message)))); },
    waitFor: async (member, ms = 30_000) => {
      const until = Date.now() + ms;
      for (;;) {
        const m = received.find((x) => x.member === member);
        if (m) return m;
        if (Date.now() > until || closed) return null;
        await sleep(20);
      }
    },
    close: () => { if (!closed) { socket.write(frame(8, Buffer.alloc(0))); socket.end(); } },
    closed: () => closed,
  };
}
/** A random match ID: 16 bytes as 32 lowercase hex digits. */
export const guess = (): string => randomBytes(16).toString('hex');

// ---------------------------------------------------------------------------------------------------
// A live copy in the app (README: `play_match`): the piece shown, the app's prompt read, a person's click on its Join
// button, then the match played in real time. One `deep-show run` per copy, all running at once.

export interface LiveAsk {
  evidence: string; document: JsonObject; steps: number; plays?: Play[]; relayCa: string;
  /** The first player's link, for a copy that joins through it. */
  link?: string;
  /** Where the first player's link is written as soon as the relay seats it. */
  linkTo?: string;
  secrets?: Record<string, string>;
}
export interface LiveCopy { prompt: Prompt | null; after: Prompt | null; reply: JsonObject; sockets: Opened[] }
/** One live copy: present, read the prompt, click Join as a person, play, read the prompt and the sockets again. */
export async function liveCopy(bin: string, ask: LiveAsk, what: string): Promise<LiveCopy> {
  const doc = String(ask.document['id']);
  // The prompt's button isn't known before the run, so the click goes where a first run's prompt says it is.
  const probe = new Script();
  probe.present(doc, ask.document);
  const seen = probe.scope();
  const world = { evidence: ask.evidence, docs: [{ id: doc, ...(ask.link ? { link: ask.link } : {}) }], relayCa: ask.relayCa, ...(ask.secrets ? { secrets: ask.secrets } : {}) };
  const first = await runShow(bin, scenario({ ...world, calls: probe.calls }), `${what}: the prompt`);
  presented(first[0], `${what}: the piece`);
  const prompt = promptOf(first[seen], `${what}: the scope`);
  expect(prompt, `${what}: a piece whose net item declares a relay shows the app's Join prompt (state.join)`).not.toBeNull();
  const s = new Script();
  s.present(doc, ask.document);
  s.scope();
  s.click(centreOf(prompt!.button));
  const played = s.playMatch(ask.steps, { ...(ask.plays ? { plays: ask.plays } : {}), ...(ask.linkTo ? { linkTo: ask.linkTo } : {}) });
  const after = s.scope();
  const sockets = s.sockets();
  const r = await runShow(bin, scenario({ ...world, calls: s.calls }), what);
  return { prompt, after: promptOf(r[after], `${what}: the scope after the match`), reply: r[played]!, sockets: socketsOf(r[sockets], `${what}: sockets`) };
}
/** The first player's link, once its copy wrote it (README: `link_to`). */
export async function linkFrom(file: string, what: string, copy: Promise<unknown>, ms = LIVE_MS): Promise<string> {
  let finished = false;
  copy.then(() => { finished = true; }, () => { finished = true; });
  const until = Date.now() + ms;
  for (;;) {
    if (existsSync(file) && statSync(file).size > 0) { const text = readFileSync(file, 'utf8').trim(); if (text.includes('#')) return text; }
    if (finished) {
      // A copy that failed says why; one that ended without a link is the failure.
      await copy;
      throw Error(`${what}: the first player's copy finished without writing its link to ${file}`);
    }
    if (Date.now() > until) return gaveUp(`${what}: the first player's copy wrote no link to ${file} within ${Math.round(ms / 60_000)} minutes`);
    await sleep(100);
  }
}
/** Two live copies of one match in the app: the first joins and writes its link, the second joins through it. */
export interface PairAsk { bins: [string, string]; stores: [string, string]; linkFile: string; document: JsonObject; steps: number; plays: Plays; relayCa: string; secrets?: Record<string, string> }
export interface Pair { one: LiveCopy; two: LiveCopy; link: string }
export async function livePair(ask: PairAsk, what: string, between?: (link: string) => Promise<void>): Promise<Pair> {
  const common = { document: ask.document, steps: ask.steps, relayCa: ask.relayCa, ...(ask.secrets ? { secrets: ask.secrets } : {}) };
  const first = liveCopy(ask.bins[0], { ...common, evidence: ask.stores[0], linkTo: ask.linkFile, ...(ask.plays['1'] ? { plays: ask.plays['1'] } : {}) }, `${what}: the first copy`);
  first.catch(() => undefined);
  const link = await linkFrom(ask.linkFile, `${what}: the first copy`, first);
  if (between) await between(link);
  const two = await liveCopy(ask.bins[1], { ...common, evidence: ask.stores[1], link, ...(ask.plays['2'] ? { plays: ask.plays['2'] } : {}) }, `${what}: the second copy`);
  return { one: await first, two, link };
}
/** A link's fragment, with its `#`, and the match ID it must carry. */
export function fragmentOf(link: string, matchId: string | null, what: string): string {
  const at = link.indexOf('#');
  expect(at, `${what}: the first player's link carries a fragment: ${link}`).toBeGreaterThanOrEqual(0);
  const fragment = link.slice(at);
  if (matchId !== null) {
    expect(fragment, `${what}: the link's fragment carries the match ID ${matchId}`).toContain(matchId);
    expect(link.slice(0, at), `${what}: the match ID is nowhere in the link but its fragment`).not.toContain(matchId);
  }
  return fragment;
}
/** A `play_match` reply that played: no refusal code, and its copy's report. */
export function playedOf(reply: JsonObject, what: string): Copy & { match: string; link: string | null } {
  expect(reply['code'], `${what}: play_match plays the match, not refuses: ${show(reply, 1500)}`).toBeUndefined();
  const match = str(reply['match'], `${what}: match (the match ID)`);
  expect(match, `${what}: the match ID is 16 bytes as 32 hex digits`).toMatch(/^[0-9a-f]{32}$/);
  return { ...copyOf(reply, what), match, link: typeof reply['link'] === 'string' ? reply['link'] : null };
}

// ---------------------------------------------------------------------------------------------------
// The web export (#172's `export` with `video.codec: web`) and its bundle, served over HTTP on 127.0.0.1 by this
// process, which logs every request.

export async function exportBundle(bin: string, evidence: string, document: JsonObject, out: string, what: string): Promise<JsonObject> {
  const doc = String(document['id']);
  const s = new Script();
  s.present(doc, document);
  const exported = s.add({ call: 'export', doc, out, video: { codec: 'web' } });
  const r = await runShow(bin, scenario({ evidence, docs: [{ id: doc }], calls: s.calls }), what);
  presented(r[0], `${what}: the piece`);
  const reply = r[exported]!;
  expect(reply['outcome'], `${what}: the web export delivers the bundle (a piece with a net item exports to the web): ${show(reply, 2500)}`).toBe('exported');
  expect(existsSync(join(out, 'index.html')), `${what}: the bundle holds index.html`).toBe(true);
  return reply;
}
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };
export interface Served { origin: string; requests: { path: string; status: number; cookie: string | null }[]; stop: () => Promise<void> }
export async function serve(root: string): Promise<Served> {
  const requests: Served['requests'] = [];
  const base = resolve(root);
  const server: HttpServer = createHttpServer((q, r) => {
    const url = decodeURIComponent((q.url ?? '/').split('?')[0]!);
    const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
    const file = resolve(base, rel);
    let body: Buffer | null = null;
    if (file.startsWith(base + sep)) { try { body = readFileSync(file); } catch { body = null; } }
    requests.push({ path: q.url ?? '/', status: body ? 200 : 404, cookie: q.headers.cookie ?? null });
    if (!body) { r.statusCode = 404; r.end(); return; }
    const wasm = body.length >= 4 && body.readUInt32BE(0) === 0x0061736d;
    r.setHeader('content-type', wasm ? 'application/wasm' : (TYPES[extname(file)] ?? 'application/octet-stream'));
    r.setHeader('cache-control', rel === 'index.html' ? 'no-cache' : 'max-age=31536000');
    r.end(body);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
  const address = server.address();
  const origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  return { origin, requests, stop: () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }) };
}

// ---------------------------------------------------------------------------------------------------
// Google Chrome, headless with WebGPU on (as #172's suite runs it), over its DevTools protocol in flat sessions, by
// this file alone. Chrome runs in a process group of its own and is stopped by that PID; its profile is a fresh
// folder. The page's every request and socket is logged twice: by the browser (the Network domain) and by a script
// installed before the page's own, which wraps the constructors a page opens a connection with.

export const CHROME = process.env['CHROME_BIN'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_ARGS = [
  '--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--use-mock-keychain',
  '--password-store=basic', '--disable-background-networking', '--disable-component-update', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist',
  '--autoplay-policy=no-user-gesture-required',
];
/** The pin Chrome trusts a certificate by: the base64 SHA-256 of its public key (SPKI). The throwaway certificate is
 * trusted by this pin alone, for this browser alone; nothing is installed. */
export const pinOf = (certPem: string): string => createHash('sha256').update(new X509Certificate(readFileSync(certPem)).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');

type CdpMessage = { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message: string }; sessionId?: string };
class Protocol {
  private n = 0;
  private readonly pending = new Map<number, { done: (r: Record<string, unknown>) => void; fail: (e: Error) => void }>();
  private readonly listeners: { session: string; method: string; on: (p: Record<string, unknown>) => void }[] = [];
  private readonly ws: WebSocket;
  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(String(ev.data)) as CdpMessage;
      if (m.id !== undefined) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) p?.fail(Error(m.error.message)); else p?.done(m.result ?? {});
      } else if (m.method) for (const l of this.listeners) if (l.session === (m.sessionId ?? '') && l.method === m.method) l.on(m.params ?? {});
    });
  }
  static async connect(url: string): Promise<Protocol> {
    const ws = new WebSocket(url);
    await new Promise<void>((done, fail) => { ws.addEventListener('open', () => done()); ws.addEventListener('error', () => fail(Error(`no DevTools connection at ${url}`))); });
    return new Protocol(ws);
  }
  send(method: string, params: Record<string, unknown> = {}, session = '', timeoutMs = 60_000): Promise<Record<string, unknown>> {
    const id = ++this.n;
    return new Promise((done, fail) => {
      const timer = setTimeout(() => { this.pending.delete(id); fail(Error(`${method}: no answer within ${timeoutMs} ms`)); }, timeoutMs);
      this.pending.set(id, { done: (r) => { clearTimeout(timer); done(r); }, fail: (e) => { clearTimeout(timer); fail(e); } });
      this.ws.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
    });
  }
  on(session: string, method: string, on: (p: Record<string, unknown>) => void): void { this.listeners.push({ session, method, on }); }
  close(): void { this.ws.close(); }
}

/** Installed before the page's scripts: every way a page opens a connection, logged in `window.__deep549`. */
const SPY = `(() => {
  const log = []; Object.defineProperty(window, '__deep549', { value: log });
  const note = (kind, url, extra) => { try { log.push({ kind, url: String(url), extra: extra === undefined ? null : extra }); } catch (e) {} };
  const wrap = (name, describe) => { const Real = window[name]; if (typeof Real !== 'function') return;
    window[name] = new Proxy(Real, { construct(t, args, nt) { const d = describe(args); note(name, d.url, d.extra); return Reflect.construct(t, args, nt); } }); };
  wrap('WebSocket', (a) => ({ url: a[0] }));
  wrap('WebTransport', (a) => ({ url: a[0] }));
  wrap('EventSource', (a) => ({ url: a[0] }));
  wrap('RTCPeerConnection', (a) => ({ url: 'rtc:', extra: ((a[0] && a[0].iceServers) || []).flatMap((s) => [].concat(s.urls || s.url || [])).map(String) }));
  const f = window.fetch; if (f) window.fetch = function (input, init) { note('fetch', input && input.url ? input.url : input, init && init.credentials ? String(init.credentials) : null); return f.apply(this, arguments); };
  const open = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function (m, u) { note('xhr', u); return open.apply(this, arguments); };
  const beacon = navigator.sendBeacon; if (beacon) navigator.sendBeacon = function (u) { note('beacon', u); return beacon.apply(this, arguments); };
})();`;

/** One request or socket a page opened: who logged it, what kind, where to, and the request's headers when the
 * browser gave them. */
export interface Reached { by: 'browser' | 'page'; kind: string; url: string; headers: Record<string, string>; extra: JsonValue }
/** What the page's own Join prompt shows (README: The web player's prompt). */
export interface WebPrompt { state: string; text: string; button: { x: number; y: number; w: number; h: number } | null }

export class Tab {
  readonly reached: Reached[] = [];
  readonly errors: string[] = [];
  private readonly cdp: Protocol;
  private readonly session: string;
  constructor(cdp: Protocol, session: string) { this.cdp = cdp; this.session = session; }
  send(method: string, params: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<Record<string, unknown>> { return this.cdp.send(method, params, this.session, timeoutMs); }
  /** A script's value in the page, awaited. Never a user's gesture. */
  async evaluate<T>(expression: string, timeoutMs = 60_000): Promise<T> {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: false }, timeoutMs);
    const thrown = r['exceptionDetails'] as { text?: string; exception?: { description?: string } } | undefined;
    if (thrown) throw Error(`a script in the page threw: ${thrown.text ?? ''} ${thrown.exception?.description ?? ''}`);
    return (r['result'] as { value?: T } | undefined)?.value as T;
  }
  /** Waits until the page's `<deep-player>` says `ready`; BLOCKED when the browser offers no WebGPU adapter here. */
  async mustBeReady(what: string, ms = 180_000): Promise<void> {
    const until = Date.now() + ms;
    let s = { ready: false, player: false, notices: [] as string[] };
    while (Date.now() < until && !s.ready) {
      s = await this.evaluate<typeof s>(`(() => { const p = document.querySelector('deep-player'); return { player: !!p, ready: !!(p && p.ready === true),
        notices: [...document.querySelectorAll('[data-deep-notice]')].map((e) => (e.textContent || '').trim()) }; })()`).catch(() => s);
      if (!s.ready) await sleep(200);
    }
    if (!s.ready) {
      const gpu = await this.evaluate<string>(`(async () => !navigator.gpu ? 'no navigator.gpu' : (await navigator.gpu.requestAdapter()) ? '' : 'no adapter')()`).catch((e: Error) => e.message);
      if (gpu) blocked(`Chrome at ${CHROME} offers no WebGPU here (${gpu}); the player needs WebGPU in headless Chrome. Unblock: run on a Mac whose Chrome gives a WebGPU adapter headless`);
    }
    expect(s.ready, `${what}: the player (<deep-player>) is ready within ${ms} ms; it shows ${s.player ? 'a player' : 'no <deep-player>'}, notices ${JSON.stringify(s.notices)}, page errors ${JSON.stringify(this.errors.slice(0, 5))}`).toBe(true);
  }
  /** The player's own Join prompt: the element marked `data-deep-join`, or null when the page shows none. */
  prompt(): Promise<WebPrompt | null> {
    return this.evaluate<WebPrompt | null>(`(() => { const p = document.querySelector('[data-deep-join]'); if (!p) return null; const b = p.querySelector('button'); const r = b ? b.getBoundingClientRect() : null;
      return { state: p.getAttribute('data-deep-join') || '', text: (p.textContent || '').trim(), button: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null }; })()`);
  }
  /** `probe().match`: the player's copy of the match (README), or null. */
  async match(): Promise<JsonObject | null> {
    const v = await this.evaluate<JsonValue>(`(async () => { const v = await document.querySelector('deep-player').probe(); return JSON.parse(JSON.stringify(v && v.match !== undefined ? v.match : null)); })()`);
    return isObject(v) ? v : null;
  }
  /** A person's click at a point of the page: the browser's own input, a trusted event with a user activation. */
  async click(x: number, y: number): Promise<void> {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  }
  /** Every request and socket so far: the browser's log, then the page-side spy's. */
  async everything(): Promise<Reached[]> {
    const spied = await this.evaluate<{ kind: string; url: string; extra: JsonValue }[] | null>('window.__deep549 ? JSON.parse(JSON.stringify(window.__deep549)) : null').catch(() => null);
    return [...this.reached, ...(spied ?? []).map((s): Reached => ({ by: 'page', kind: s.kind, url: s.url, headers: {}, extra: s.extra }))];
  }
}
export class Chrome {
  private readonly chrome: ChildProcess;
  private readonly cdp: Protocol;
  private readonly profile: string;
  private constructor(chrome: ChildProcess, cdp: Protocol, profile: string) { this.chrome = chrome; this.cdp = cdp; this.profile = profile; }
  /** `pins`: certificates this browser trusts by their public key's pin (the throwaway relay certificate). */
  static async open(pins: readonly string[] = []): Promise<Chrome> {
    if (!existsSync(CHROME)) blocked(`no Google Chrome at ${CHROME}; the web player is played in headless Chrome with WebGPU. Unblock: install Google Chrome there or set CHROME_BIN`);
    const profile = mkdtempSync(join(tmpdir(), 'deep-549-chrome-'));
    const args = [...CHROME_ARGS, ...(pins.length ? [`--ignore-certificate-errors-spki-list=${pins.join(',')}`] : []), `--user-data-dir=${profile}`, 'about:blank'];
    const chrome = spawn(CHROME, args, { detached: true, stdio: 'ignore' });
    const portFile = join(profile, 'DevToolsActivePort');
    const until = Date.now() + 120_000;
    while (!existsSync(portFile) || readFileSync(portFile, 'utf8').split('\n').length < 2) {
      if (Date.now() > until || chrome.exitCode !== null) { stop(chrome, profile); blocked(`${CHROME} opened no DevTools port within 120 s (exit ${String(chrome.exitCode)}). Unblock: run where headless Chrome starts`); }
      await sleep(100);
    }
    const [port, path] = readFileSync(portFile, 'utf8').split('\n');
    let cdp: Protocol;
    try { cdp = await Protocol.connect(`ws://127.0.0.1:${port!.trim()}${path!.trim()}`); } catch (e) { stop(chrome, profile); return blocked((e as Error).message); }
    return new Chrome(chrome, cdp, profile);
  }
  /** Opens `url` in a new page of 1280 × 720 px, the spy installed first and the browser's network log on. */
  async open(url: string): Promise<Tab> {
    const { targetId } = await this.cdp.send('Target.createTarget', { url: 'about:blank' }) as { targetId: string };
    const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId, flatten: true }) as { sessionId: string };
    const tab = new Tab(this.cdp, sessionId);
    const headersOf = (h: unknown): Record<string, string> => Object.fromEntries(Object.entries((h ?? {}) as Record<string, unknown>).map(([k, v]) => [k.toLowerCase(), String(v)]));
    this.cdp.on(sessionId, 'Network.requestWillBeSent', (p) => { const q = p['request'] as { url?: string; headers?: unknown } | undefined; tab.reached.push({ by: 'browser', kind: 'request', url: String(q?.url ?? ''), headers: headersOf(q?.headers), extra: null }); });
    this.cdp.on(sessionId, 'Network.requestWillBeSentExtraInfo', (p) => { const h = headersOf(p['headers']); if ('cookie' in h || 'authorization' in h) tab.reached.push({ by: 'browser', kind: 'request-headers', url: String(h[':authority'] ?? h['host'] ?? ''), headers: h, extra: null }); });
    this.cdp.on(sessionId, 'Network.webSocketCreated', (p) => tab.reached.push({ by: 'browser', kind: 'websocket', url: String(p['url'] ?? ''), headers: {}, extra: null }));
    this.cdp.on(sessionId, 'Network.webSocketWillSendHandshakeRequest', (p) => { const q = p['request'] as { headers?: unknown } | undefined; const h = headersOf(q?.headers); tab.reached.push({ by: 'browser', kind: 'websocket-handshake', url: String(h['host'] ?? ''), headers: h, extra: null }); });
    this.cdp.on(sessionId, 'Network.webTransportCreated', (p) => tab.reached.push({ by: 'browser', kind: 'webtransport', url: String(p['url'] ?? ''), headers: {}, extra: null }));
    this.cdp.on(sessionId, 'Runtime.exceptionThrown', (p) => tab.errors.push(JSON.stringify(p['exceptionDetails'] ?? p).slice(0, 500)));
    await this.cdp.send('Network.enable', {}, sessionId);
    await this.cdp.send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
    await this.cdp.send('Page.enable', {}, sessionId);
    await this.cdp.send('Runtime.enable', {}, sessionId);
    await this.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false }, sessionId);
    await this.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: SPY }, sessionId);
    await this.cdp.send('Page.navigate', { url }, sessionId).catch(() => undefined);
    return tab;
  }
  async close(): Promise<void> {
    await this.cdp.send('Browser.close', {}, '', 5_000).catch(() => undefined);
    this.cdp.close();
    stop(this.chrome, this.profile);
  }
}
function stop(chrome: ChildProcess, profile: string): void {
  if (chrome.pid && chrome.exitCode === null) { try { process.kill(-chrome.pid, 'SIGKILL'); } catch { /* already gone */ } }
  rmSync(profile, { recursive: true, force: true });
}
/** Browsers, servers and doors a test opened, closed after it whether it passed or not. */
export function useClosers(): (close: () => Promise<void> | void) => void {
  const open: (() => Promise<void> | void)[] = [];
  afterEach(async () => { for (const c of open.splice(0).reverse()) { try { await c(); } catch { /* already closed */ } } });
  return (close) => { open.push(close); };
}

/** Where a URL goes: its host and port, as a piece's relay is named. */
export function hostOf(url: string): string {
  try { const u = new URL(url); return u.port ? `${u.hostname}:${u.port}` : u.hostname; } catch { return url; }
}
/** Everything a page reached that isn't the bundle's own origin, the declared relay or a browser-internal URL:
 * each failure names where it went. `allowed` are hosts (host:port). */
export function strayFailures(reached: readonly Reached[], origin: string, allowed: readonly string[], what: string): string[] {
  const own = hostOf(origin);
  const f: string[] = [];
  for (const r of reached) {
    if (r.kind === 'RTCPeerConnection') {
      for (const u of Array.isArray(r.extra) ? r.extra : []) { const h = String(u).replace(/^(stun|turn|turns):/, '').split('?')[0]!; if (!allowed.includes(h)) f.push(`${what}: the page set up a direct path through ${String(u)}, a host the piece doesn't declare`); }
      continue;
    }
    if (r.kind === 'request-headers' || r.kind === 'websocket-handshake') continue;
    if (/^(data|blob|about|chrome|devtools):/.test(r.url)) continue;
    const h = hostOf(new URL(r.url, origin).href);
    if (h === own && !/^wss?:/.test(r.url)) continue;
    if (allowed.includes(h)) continue;
    f.push(`${what}: the page opened ${r.kind} to ${r.url} (${r.by === 'browser' ? 'the browser\'s log' : 'the page-side log'})`);
  }
  return f;
}
/** The sockets among what a page reached (anything but plain requests to the bundle's own origin). */
export function socketsReached(reached: readonly Reached[], origin: string): Reached[] {
  const own = hostOf(origin);
  return reached.filter((r) => ['websocket', 'webtransport', 'WebSocket', 'WebTransport', 'EventSource', 'RTCPeerConnection'].includes(r.kind) || (r.kind !== 'request-headers' && r.kind !== 'websocket-handshake' && !/^(data|blob|about|chrome|devtools):/.test(r.url) && hostOf(new URL(r.url, origin).href) !== own));
}
/** A cookie or a credential on any request the browser logged: each failure names the request. */
export function credentialFailures(reached: readonly Reached[], what: string): string[] {
  const f: string[] = [];
  for (const r of reached) for (const h of ['cookie', 'authorization', 'proxy-authorization']) if (h in r.headers) f.push(`${what}: the ${r.kind} to ${r.url} carries a ${h} header`);
  return f;
}
