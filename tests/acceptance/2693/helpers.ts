// Test-side tools for the #2693 acceptance tests: the probe (probe/main.rs) built in release from this
// checkout's deep-canvas, once without and once with its feature `ring` (README: The probe), started with
// one JSON request and read back; the seeded seek times; and the checks each criterion makes, each giving
// its failures as sentences that name what failed (bytes, a time, a step count). Nothing here stands in for
// the scheduler, its checkpoints or its ring: the probe plays the real scheduler, and the heap it counts is
// the probe's own allocator's.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/2693 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** Flicks in one second (Time and the flick). */
export const FLICKS = 705_600_000;
export const sec = (s: number): number => Math.round(s * FLICKS);
/** The test modules' step, 60 Hz: also the frame the probe plays at. */
export const STEP = FLICKS / 60;
/** The input track's checkpoint spacing before any doubling, 0.5 s (Input track: `checkpoint_every`). */
export const FIRST_SPACING = sec(0.5);
/** One hour, in flicks. */
export const HOUR = sec(3600);
/** The scheduler's default checkpoint budget, which `test.ring` declares: 16 MiB. */
export const MIB16 = 16 * 1024 * 1024;
/** One checkpoint of a test module's stepping arrays: 8,192 f64 cells, 65,536 bytes (and an i64 count). */
export const CHECKPOINT_BYTES = 65_536;
/** `test.tight`'s declared byte budget, a quarter of one checkpoint. */
export const TIGHT_BUDGET = 16 * 1024;

// ---------------------------------------------------------------------------------------------------
// The probe, built once per file for each feature set it needs.

export type ProbeBuild = 'plain' | 'ring';
const PROBE = join(REPO, 'target', 'acceptance-2693-probe');
const CARGO_TOML = `[package]
name = "acceptance-2693-probe"
version = "0.0.0"
edition = "2021"
publish = false

[workspace]

[features]
ring = []

[dependencies]
deep-canvas = { path = "../../../crates/deep-canvas" }
serde_json = { version = "1", features = ["preserve_order"] }

[profile.release]
debug = false
`;

/** The probe's crate laid out under target/ (never in this folder), its lock the workspace's, then built. */
function buildProbe(build: ProbeBuild): { bin: string; error: string } {
  const crate = join(PROBE, 'crate');
  mkdirSync(join(crate, 'src'), { recursive: true });
  writeFileSync(join(crate, 'Cargo.toml'), CARGO_TOML);
  copyFileSync(join(HERE, 'probe', 'main.rs'), join(crate, 'src', 'main.rs'));
  copyFileSync(join(REPO, 'Cargo.lock'), join(crate, 'Cargo.lock'));
  const args = ['build', '--release', '--offline', '--target-dir', join(PROBE, 'target'), ...(build === 'ring' ? ['--features', 'ring'] : [])];
  const run = spawnSync('cargo', args, { cwd: crate, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CARGO_TERM_COLOR: 'never' } });
  if (run.error) return { bin: '', error: `cargo could not run: ${run.error.message}` };
  if (run.status !== 0) {
    const lines = run.stderr.split('\n').filter((l) => /^(error|  -->|\s+\||\s*= )/.test(l) || /^\s*\d+ \|/.test(l));
    return { bin: '', error: `cargo ${args.join(' ').replace(REPO, '<repo>')} failed:\n${lines.slice(0, 60).join('\n').split(REPO).join('<repo>')}` };
  }
  return { bin: join(PROBE, 'target', 'release', 'acceptance-2693-probe'), error: '' };
}

export interface Probes { bin: (build: ProbeBuild) => string }

/** Builds each listed probe once before the file's tests, copying each binary out under its own name. */
export function useProbes(builds: readonly ProbeBuild[]): Probes {
  let dir = '';
  const made = new Map<ProbeBuild, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-2693-probes-'));
    for (const build of builds) {
      if (made.has(build)) continue;
      const built = buildProbe(build);
      const bin = join(dir, `probe-${build}`);
      if (built.error === '') copyFileSync(built.bin, bin);
      made.set(build, { bin, error: built.error });
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(build: ProbeBuild): string {
      const entry = made.get(build);
      if (!entry) throw Error(`the file didn't list the probe build ${build} in useProbes`);
      const what = build === 'ring'
        ? 'the probe builds with its feature `ring`: Session::checkpoint_ring and the planted rings ring_drops_start and ring_newest_only (README: What the change adds)'
        : 'the probe builds against this checkout\'s deep-canvas';
      expect(entry.error, what).toBe('');
      return entry.bin;
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// One probe run: a request in, one JSON line out.

export interface Request {
  module: 'ring' | 'tight';
  play_to: number;
  seeks?: number[];
  play_side?: boolean;
  planted?: 'ring_drops_start' | 'ring_newest_only';
}

export interface Frame { t: number; steps: number; first_step: number | null; last_count: number | null; hash: string; frozen: string | null; reading?: JsonValue }
export interface Held { t: number; bytes: number }
export interface Reading { budget: number; spacing: number; bytes: number; held: Held[]; over_budget: boolean; raw: JsonObject }
export interface Answer {
  load_issues: JsonObject[];
  heap: { after_load: number; after_start: number; after_play: number; held_since_start: number; after_seeks: number };
  played: { steps: number; first: Frame; last: Frame };
  reading: JsonValue;
  seeks: Frame[];
  play: { t: number; hash: string }[];
  ms: number;
  raw: JsonObject;
}

export function probe(bin: string, req: Request, timeoutMs = 3_000_000): Answer {
  const run = spawnSync(bin, [], { input: JSON.stringify(req), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  expect(run.error === undefined, `the probe ran within ${timeoutMs / 60_000} minutes: ${run.error?.message ?? ''}`).toBe(true);
  expect(run.status, `the probe exited 0 (${run.signal ?? 'no signal'}); stderr: ${(run.stderr ?? '').slice(-2000)}`).toBe(0);
  const lines = (run.stdout ?? '').split('\n').filter((l) => l.trim() !== '');
  expect(lines.length, 'the probe answers one line').toBe(1);
  const raw = JSON.parse(lines[0]!) as JsonObject;
  expect(raw['refused'], `the probe took the request: ${JSON.stringify(raw['refused'])}`).toBeUndefined();
  return {
    load_issues: (raw['load_issues'] as JsonObject[]) ?? [],
    heap: raw['heap'] as unknown as Answer['heap'],
    played: raw['played'] as unknown as Answer['played'],
    reading: raw['reading'] ?? null,
    seeks: (raw['seeks'] as unknown as Frame[]) ?? [],
    play: (raw['play'] as unknown as Answer['play']) ?? [],
    ms: Number(raw['ms']),
    raw,
  };
}

/** The checkpoint ring's reading (README: The reading), its form checked. */
export function reading(value: JsonValue | undefined, what: string): Reading {
  expect(typeof value === 'object' && value !== null && !Array.isArray(value), `${what}: the checkpoint ring's reading is an object, got ${JSON.stringify(value)?.slice(0, 400)}`).toBe(true);
  const o = value as JsonObject;
  for (const k of ['budget', 'spacing', 'bytes']) expect(Number.isSafeInteger(o[k]), `${what}: reading.${k} is an integer, got ${JSON.stringify(o[k])}`).toBe(true);
  expect(typeof o['over_budget'], `${what}: reading.over_budget is a boolean`).toBe('boolean');
  expect(Array.isArray(o['held']), `${what}: reading.held is a list`).toBe(true);
  const held = (o['held'] as JsonValue[]).map((h, i) => {
    const e = h as JsonObject;
    expect(Number.isSafeInteger(e['t']) && Number.isSafeInteger(e['bytes']), `${what}: reading.held[${i}] is {t, bytes}, got ${JSON.stringify(h)}`).toBe(true);
    return { t: e['t'] as number, bytes: e['bytes'] as number };
  });
  for (let i = 1; i < held.length; i++) expect(held[i]!.t > held[i - 1]!.t, `${what}: reading.held is ascending at [${i}]`).toBe(true);
  return { budget: o['budget'] as number, spacing: o['spacing'] as number, bytes: o['bytes'] as number, held, over_budget: o['over_budget'] as boolean, raw: o };
}

// ---------------------------------------------------------------------------------------------------
// Seeded seek times

/** mulberry32: a small seeded generator, so the times repeat on every run. */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export const SEED = 2693;

/**
 * The 100 seeded seek times after the hour, in the order the probe seeks them: descending, so each seek
 * jumps back from a later time. Ten lie in the first spacing (0, 0.5 s), before any checkpoint but the
 * start's, whatever the ring's spacing has doubled to; ninety lie anywhere in [0.5 s, 1 h). Each is any
 * flick, mostly between steps.
 */
export function seededTimes(): number[] {
  const next = generator(SEED);
  const draw = (lo: number, hi: number): number => {
    const r = Math.floor(next() * 2 ** 21) * 2 ** 32 + Math.floor(next() * 2 ** 32);
    return lo + (r % (hi - lo));
  };
  const out = new Set<number>();
  while (out.size < 10) out.add(draw(1, FIRST_SPACING));
  while (out.size < 100) out.add(draw(FIRST_SPACING, HOUR));
  return [...out].sort((a, b) => b - a);
}

// ---------------------------------------------------------------------------------------------------
// Checks

/** Each seek whose full-state hash differs from the straight play's at its time, as a sentence naming the time. */
export function hashFailures(a: Answer, what: string): { t: number; text: string }[] {
  const played = new Map(a.play.map((p) => [p.t, p.hash]));
  const out: { t: number; text: string }[] = [];
  for (const s of [...a.seeks].sort((x, y) => x.t - y.t)) {
    const p = played.get(s.t);
    if (p === undefined) out.push({ t: s.t, text: `${what}: no straight play reached ${s.t} flicks` });
    else if (p !== s.hash) out.push({ t: s.t, text: `${what}: the seek to ${s.t} flicks (${(s.t / FLICKS).toFixed(6)} s) gives full-state hash ${s.hash.slice(0, 16)}…, playing to it gives ${p.slice(0, 16)}…` });
  }
  return out;
}

/** Each seek that stepped forward more than one spacing's steps, as a sentence naming the steps. */
export function stepFailures(a: Answer, spacing: number, what: string): string[] {
  const most = Math.floor(spacing / STEP);
  return a.seeks.filter((s) => s.steps > most).map((s) => `${what}: the seek to ${s.t} flicks stepped forward ${s.steps} steps, over one spacing's ${most} steps (spacing ${spacing} flicks)`);
}

/** Every frame of a run that froze, as a sentence. */
export function frozen(a: Answer): string[] {
  return [a.played.first, a.played.last, ...a.seeks].filter((f) => f.frozen !== null).map((f) => `the frame at ${f.t} flicks froze: ${f.frozen}`);
}

export const mib = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;

