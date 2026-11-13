// Test-side tools for the #2324 acceptance tests (README: Surface choices). They reuse #238's suite for the sandbox
// runner `deep-sandbox`, deep-show's builds and headless Chrome, and #531's suite for the logic runner `deep-logic`
// and its replies; this file adds what neither has: the advisories' check on a version, one Linux x86_64 build of
// both runners, and the readings the merge base gave on the old engine (fixtures/base-*.json, with the programs it
// ran), which every test compares the work against. Nothing here stands in for the engine, the kit, the seal or a
// bake.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import * as S from '../238/helpers.ts';
import * as L from '../531/helpers.ts';

export { S, L };
export type JsonValue = S.JsonValue;
export type JsonObject = S.JsonObject;

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = S.REPO;
/** Every test passes this timeout: deep-show builds, and the Linux build under emulation, take many minutes. */
export const TIMEOUT = 5_400_000;
/** Each criterion's ID (scripts/proof-change.mjs, `criterionId`, over the text this job was given, starting `AC1:`). */
export const AC = { 1: '#2324.e835c82a', 2: '#2324.2b0e7ae9', 3: '#2324.c7dad014', 4: '#2324.adfd1cb3', 5: '#2324.ceee5c0f' } as const;
export const OLD = '49.0.2';

const fixture = <T>(name: string): T => JSON.parse(readFileSync(join(HERE, 'fixtures', name), 'utf8')) as T;
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------------
// The advisories (fixtures/advisories.json, read from the engine's project on 2026-11-12) and the check a version
// passes: outside every wasmtime range of each, and at or past its first fixed 49.0 release.

export interface Advisory { id: string; published: string; severity: string; summary: string; wasmtime: { vulnerable: string; patched: string }[]; first_fixed_49: string }
export const ADVISORIES = fixture<{ releases: string[]; advisories: Advisory[] }>('advisories.json');
const EXACT = /^(\d+)\.(\d+)\.(\d+)$/;
export const isExact = (v: string): boolean => EXACT.test(v);
function cmp(a: string, b: string): number {
  const x = EXACT.exec(a)!.slice(1).map(Number);
  const y = EXACT.exec(b)!.slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}
/**
 * Whether `v` is in an advisory's range as the engine's project writes it: comma-separated bounds read low to high,
 * each `>=`/`>` opening an interval and each `<`/`<=` closing it (a close with no open starts at 0.0.0), and a bare
 * version standing for itself, so `<36.0.18, >= 37.0.0, <48.0.6, >=49.0.0, <49.0.3` is three intervals.
 */
export function inRange(range: string, v: string): boolean {
  let lo: [string, boolean] | null = null;
  for (const raw of range.split(',')) {
    const t = raw.trim();
    if (t === '') continue;
    const m = /^(>=|>|<=|<)?\s*(\d+\.\d+\.\d+)$/.exec(t);
    if (!m) throw Error(`unreadable bound ${JSON.stringify(t)} in the range ${range}`);
    const [, op, at] = m as unknown as [string, string | undefined, string];
    if (!op) { if (cmp(v, at) === 0) return true; continue; }
    if (op.startsWith('>')) { lo = [at, op === '>=']; continue; }
    const above = lo === null || (lo[1] ? cmp(v, lo[0]) >= 0 : cmp(v, lo[0]) > 0);
    if (above && (op === '<=' ? cmp(v, at) <= 0 : cmp(v, at) < 0)) return true;
    lo = null;
  }
  return lo !== null && (lo[1] ? cmp(v, lo[0]) >= 0 : cmp(v, lo[0]) > 0);
}
/** The advisories `v` is still inside: one of its wasmtime ranges holds `v`. */
export const inside = (v: string): Advisory[] => ADVISORIES.advisories.filter((a) => a.wasmtime.some((w) => inRange(w.vulnerable, v)));
/** The engine's versions a Cargo.lock holds (each `[[package]]` named `wasmtime`). */
export const lockVersions = (lock: string): string[] => [...lock.matchAll(/^\[\[package\]\]\r?\nname = "wasmtime"\r?\nversion = "([^"]+)"/gm)].map((m) => m[1]!);
/**
 * AC1's check of a lock: the engine once, at an exact release, outside every advisory's range and at or past each
 * one's first fixed 49.0 release. Each failure names the advisory it is about.
 */
export function lockFailures(lock: string): string[] {
  const versions = lockVersions(lock);
  if (versions.length !== 1) return [`the lock holds the engine ${versions.length} times (${versions.join(', ') || 'none'}), not once`];
  const v = versions[0]!;
  if (!isExact(v)) return [`the lock holds the engine at ${v}, not at an exact release`];
  return ADVISORIES.advisories
    .filter((a) => a.wasmtime.some((w) => inRange(w.vulnerable, v)) || cmp(v, a.first_fixed_49) < 0)
    .map((a) => `wasmtime ${v} is still inside ${a.id} (${a.published}, ${a.severity}: "${a.summary}"), first fixed in ${a.first_fixed_49}`);
}
export const readLock = (): string => readFileSync(join(REPO, 'Cargo.lock'), 'utf8');
/** The one engine version Cargo.lock holds (the test fails when it holds another count). */
export function lockedVersion(): string {
  const versions = lockVersions(readLock());
  expect(versions, 'Cargo.lock holds the engine once').toHaveLength(1);
  return versions[0]!;
}

// ---------------------------------------------------------------------------------------------------
// Linux x86_64: deep-sandbox and deep-logic built once for linux/amd64 in Docker, in the image of the toolchain
// rust-toolchain.toml names, with their target and cargo caches under target/acceptance-2324-linux/. Nothing is
// pulled: no Docker or no amd64 image is BLOCKED, naming Linux x86_64.

const LINUX = join(REPO, 'target', 'acceptance-2324-linux');
const toolchain = (): string => S.linuxImage().replace(/^rust:/, '').replace(/-slim-bookworm$/, '');
function docker(args: string[], input?: string, timeoutMs = 600_000): { status: number | null; stdout: string; stderr: string; timedOut: boolean } {
  const run = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 2048 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL', ...(input !== undefined ? { input } : {}) });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) return { status: null, stdout: '', stderr: run.error.message, timedOut };
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '', timedOut };
}
let linuxBuilt: string | undefined;
function linuxBuild(): void {
  if (linuxBuilt === undefined) {
    const info = docker(['info', '--format', '{{.ServerVersion}}'], undefined, 30_000);
    if (info.status !== 0) S.blocked(`Linux x86_64: Docker is unreachable (${info.stderr.trim().split('\n').slice(-1)[0] ?? ''}); that host runs in a linux/amd64 container`);
    const image = S.linuxImage();
    // A tag that names a multi-platform index (Docker 29's containerd store) is read per platform.
    const arch = docker(['image', 'inspect', '--platform', 'linux/amd64', '--format', '{{.Architecture}}', image], undefined, 30_000);
    if (arch.status !== 0 || arch.stdout.trim() !== 'amd64') S.blocked(`Linux x86_64: Docker has no linux/amd64 image ${image} and this suite pulls nothing; run: docker pull --platform linux/amd64 ${image}`);
    for (const d of ['target', 'registry', 'cargo-git']) mkdirSync(join(LINUX, d), { recursive: true });
    // Two jobs: four rustc processes under emulation outgrow a 6 GiB Docker VM (exit 137).
    const build = docker([
      'run', '--rm', '--platform', 'linux/amd64',
      '-v', `${REPO}:/src:ro`, '-v', `${join(LINUX, 'target')}:/target`,
      '-v', `${join(LINUX, 'registry')}:/usr/local/cargo/registry`, '-v', `${join(LINUX, 'cargo-git')}:/usr/local/cargo/git`,
      '-w', '/src', '-e', 'CARGO_TARGET_DIR=/target', '-e', `RUSTUP_TOOLCHAIN=${toolchain()}`, '-e', 'CARGO_BUILD_JOBS=2',
      '-e', `CARGO_INCREMENTAL=${process.env['CARGO_INCREMENTAL'] ?? '0'}`, '-e', `CARGO_PROFILE_DEV_DEBUG=${process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0'}`,
      image, 'cargo', 'build', '--locked', '--bin', 'deep-sandbox', '--bin', 'deep-logic',
    ], undefined, TIMEOUT - 600_000);
    linuxBuilt = build.status === 0 ? '' : `cargo build --locked --bin deep-sandbox --bin deep-logic in ${image} (linux/amd64) failed${build.timedOut ? ' (timed out)' : ''}:\n${build.stderr.slice(-4000)}`;
  }
  expect(linuxBuilt, 'deep-sandbox and deep-logic build for Linux x86_64').toBe('');
}
/** Runs `calls` through one `deep-sandbox` or `deep-logic` process in a linux/amd64 container. */
export function onLinux(bin: 'deep-sandbox' | 'deep-logic', calls: JsonObject[]): JsonObject[] {
  linuxBuild();
  const text = `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`;
  const r = docker(['run', '--rm', '-i', '--platform', 'linux/amd64', '-v', `${join(LINUX, 'target')}:/target:ro`, S.linuxImage(), `/target/debug/${bin}`], text, 1_800_000);
  const lines = r.stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return S.replies({ status: r.status, signal: null, timedOut: r.timedOut, lines, stdout: r.stdout, stderr: r.stderr }, calls, `${bin} on Linux x86_64`);
}

// ---------------------------------------------------------------------------------------------------
// sandbox@1's kit as #238 recorded it at the merge base (fixtures/base-kit.json): every case, and the fuel each
// fixture that ends is charged, as the least fuel budget under which its run doesn't trap `fuel`.

export interface FuelCount { fixture: string; program: string; budget: JsonObject; count: number }
export interface BaseKit { base: string; made_by: string; cases: JsonObject[]; fuel: FuelCount[] }
export const BASE_KIT = (): BaseKit => fixture<BaseKit>('base-kit.json');
/** deep-show's kit call for the sandbox module's part `sandbox` (sandbox@1's kit, as #238's suite calls it). */
export const KIT_CALL: JsonObject = { call: 'kit', modules: ['sandbox'], parts: ['sandbox'] };
/** The cases of a deep-show `kit` reply's part `sandbox`. */
export function appKit(reply: JsonObject, what: string): S.Kit {
  const module = S.arr(reply['modules'], `${what}: modules`).map((m, i) => S.obj(m, `${what}: modules[${i}]`)).find((m) => m['module'] === 'sandbox');
  expect(module, `${what} reports the sandbox module: ${S.show(reply)}`).toBeDefined();
  const part = S.arr(module!['parts'], `${what}: sandbox.parts`).map((p, i) => S.obj(p, `${what}: parts[${i}]`)).find((p) => p['part'] === 'sandbox');
  expect(part, `${what}: the sandbox module's kit has the part sandbox`).toBeDefined();
  return S.kitOf({ interface: 'sandbox@1', verdict: part!['verdict'] ?? null, cases: part!['cases'] ?? [], failures: part!['failures'] ?? [] }, `${what}: part sandbox`);
}
const FIELDS = ['verdict', 'hash', 'refusals', 'trap', 'result', 'reads'] as const;
/** The fields of a case that #238 recorded and a host must give again. */
export const recorded = (c: S.Case): JsonObject => ({ fixture: c.fixture, verdict: c.verdict, hash: c.hash, refusals: c.refusals, trap: c.trap as unknown as JsonValue, result: c.result, reads: c.reads });
/** Each fixture whose case differs from #238's record, named with the first field that differs and both values. */
export function kitDiffs(host: string, kit: S.Kit): string[] {
  const base = BASE_KIT().cases.map((c, i) => recorded(S.caseOf(c, `base-kit.json cases[${i}]`)));
  const out: string[] = [];
  for (const want of base) {
    const name = String(want['fixture']);
    const got = kit.cases.find((c) => c.fixture === name);
    if (!got) { out.push(`${name} on ${host}: no case for it`); continue; }
    const g = recorded(got);
    const field = FIELDS.find((f) => JSON.stringify(g[f] ?? null) !== JSON.stringify(want[f] ?? null));
    if (field) out.push(`${name} on ${host}: ${field} is ${S.show(g[field] ?? null).slice(0, 300)}, #238 recorded ${S.show(want[field] ?? null).slice(0, 300)}`);
  }
  for (const c of kit.cases) if (!base.some((b) => b['fixture'] === c.fixture)) out.push(`${c.fixture} on ${host}: a case #238 didn't record`);
  return out;
}
/** The fixtures `kitDiffs` names (each of its lines starts with one). */
export const differing = (diffs: string[]): string[] => [...new Set(diffs.map((d) => d.split(' ')[0]!))];
/** A native `run` of a recorded kit program under its budget with `fuel` in place of its own. */
export const fuelRun = (f: FuelCount, fuel: number): JsonObject => ({ call: 'run', program: f.program, role: 'provider', seed: 0, budget: { ...f.budget, fuel }, read: [] });
/** Two runs per fixture: at its recorded count and one under it. */
export const fuelCalls = (): JsonObject[] => BASE_KIT().fuel.flatMap((f) => [fuelRun(f, f.count), fuelRun(f, f.count - 1)]);
/** A fixture is charged its recorded count when its run at the count traps no `fuel` and its run one under traps `fuel`. */
export function fuelDiffs(host: string, replies: JsonValue[]): string[] {
  const kind = (r: JsonValue | undefined): string => {
    const o = S.isObject(r) ? r : {};
    const trap = o['trap'];
    if (o['ok'] !== true) return `no run (${S.show(o).slice(0, 200)})`;
    return S.isObject(trap) ? `a ${String(trap['kind'])} trap` : 'no trap';
  };
  return BASE_KIT().fuel.flatMap((f, i) => {
    const [at, under] = [kind(replies[2 * i]), kind(replies[2 * i + 1])];
    return at !== 'a fuel trap' && !at.startsWith('no run') && under === 'a fuel trap' ? [] : [`${f.fixture} on ${host}: #238's run is charged ${f.count} fuel, but under ${f.count} it gave ${at} and under ${f.count - 1} ${under}`];
  });
}

// ---------------------------------------------------------------------------------------------------
// #531's fixtures as one piece (README: Surface choices), as the merge base baked it (fixtures/base-bake.json): the
// piece with its programs' bytes, the track and the step count, and what each fixture reached.

/** A bake's or a golden's input as the record keeps it: the piece with its assets, the track and the step count. */
export interface BakeInput { piece: JsonObject; track: JsonValue[]; steps: number }
export interface BakeTrap { step: number | null; kind: string; function: number; offset: number }
export interface BakeRecord { program: string; hash: string; key: string; steps: [string | null, number][]; checkpoints: [number, string][]; trap: BakeTrap | null }
export interface BaseBake extends BakeInput { base: string; made_by: string; items: Record<string, BakeRecord> }
export const BASE_BAKE = (): BaseBake => fixture<BaseBake>('base-bake.json');
/** The bake of #531's fixtures the merge base ran, as a `deep-logic` call. */
export const fixtureBake = (): JsonObject => { const b = BASE_BAKE(); return { call: 'bake', piece: b.piece, track: b.track, steps: b.steps }; };
/** A bake reply as the record keeps it, per fixture. */
export function bakeRecords(reply: JsonObject, what: string): Record<string, BakeRecord> {
  const b = L.bakeOf(reply, what);
  const keys = S.obj(reply['keys'], `${what}.keys`);
  return Object.fromEntries(Object.entries(b.items ?? {}).map(([id, c]) => [id, {
    program: c.program, hash: c.hash, key: S.str(keys[id], `${what}.keys.${id}`),
    steps: b.steps.map((s) => { const x = s.items[id]; return [x?.hash ?? null, x?.fuel ?? -1] as [string | null, number]; }),
    checkpoints: (b.checkpoints[id] ?? []).map((c) => [c.step, c.deep_hash] as [number, string]),
    trap: ((t) => (t ? { step: t.step, kind: t.kind, function: t.function, offset: t.offset } : null))(b.traps.find((t) => t.item === id)),
  }]));
}
/** Each fixture whose step hashes or full-state hashes differ from the old engine's, named with the first step that differs. */
export function hashDiffs(host: string, got: Record<string, BakeRecord>): string[] {
  const out: string[] = [];
  for (const [id, want] of Object.entries(BASE_BAKE().items)) {
    const g = got[id];
    if (!g) { out.push(`${id} on ${host}: the bake has no such fixture`); continue; }
    if (g.program !== want.program) { out.push(`${id} on ${host}: the program isn't the one the merge base ran (${g.program} against ${want.program}); this suite's fixture changed`); continue; }
    const k = want.steps.findIndex((s, i) => s[0] !== g.steps[i]?.[0]);
    if (k >= 0 || g.steps.length !== want.steps.length) out.push(`${id} on ${host}: step ${k >= 0 ? k : Math.min(g.steps.length, want.steps.length)} hashes ${g.steps[k]?.[0] ?? '(none)'}, the old engine ${want.steps[k]?.[0] ?? '(none)'}`);
    if (JSON.stringify(g.trap) !== JSON.stringify(want.trap)) out.push(`${id} on ${host}: it traps ${JSON.stringify(g.trap)}, on the old engine ${JSON.stringify(want.trap)} (step ${g.trap?.step ?? want.trap?.step ?? 'null: before step 0'})`);
    const c = want.checkpoints.find(([step, deep]) => g.checkpoints.find(([s]) => s === step)?.[1] !== deep);
    if (c || g.checkpoints.length !== want.checkpoints.length) {
      const step = c?.[0] ?? want.checkpoints.length;
      out.push(`${id} on ${host}: the full-state hash at checkpoint ${step} is ${g.checkpoints.find(([s]) => s === step)?.[1] ?? '(none)'}, the old engine's ${c?.[1] ?? '(none)'}; its first differing step is ${k >= 0 ? k : step}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// AC4's save and the seal (fixtures/base-golden.json, fixtures/base-seal.json).

/** The save: the golden the merge base recorded of table_copy (its memory and mutable globals) with the input it bakes. */
export interface BaseGolden extends BakeInput { base: string; made_by: string; golden: JsonObject }
export const BASE_GOLDEN = (): BaseGolden => fixture<BaseGolden>('base-golden.json');
const saveInput = (): JsonObject => { const g = BASE_GOLDEN(); return { piece: g.piece, track: g.track, steps: g.steps }; };
/** The same bake recorded again as a golden on this engine. */
export const goldenCall = (): JsonObject => ({ call: 'golden', ...saveInput() });
/** The old engine's golden read back and replayed on this one. */
export const verifyCall = (): JsonObject => ({ call: 'golden_verify', ...saveInput(), golden: BASE_GOLDEN().golden });
export const BASE_SEAL = (): { base: string; made_by: string; full: string } => fixture('base-seal.json');

/** The planted engine build (README: Surface choices): deep-show's feature, forwarded to the engine's crate. */
export const PLANT = 'plant-engine-differs';
export const PLANTED_FIXTURE = 'pass.subset';
/** deep-show of `features`, built as #238's suite builds it (a feature #238's type doesn't list is this suite's). */
export const deepShow = (features: string[]): string => S.deepShow(features as unknown as S.ShowFeature[]);
/**
 * AC4's check of a build: its kit against #238's record and its runtime digest against the merge base's. With every
 * case equal the digest must be the base's; with a case that differs it must have moved; each differing fixture is
 * named.
 */
export function sealFailures(host: string, kit: S.Kit, digest: string): string[] {
  const diffs = kitDiffs(host, kit);
  const base = BASE_SEAL().full;
  const out = [...diffs];
  if (diffs.length === 0 && digest !== base) out.push(`${host}: every kit case is #238's, yet the runtime digest moved from the merge base's ${base} to ${digest}`);
  if (diffs.length > 0 && digest === base) out.push(`${host}: the kit differs on ${differing(diffs).join(', ')}, yet the runtime digest stayed the merge base's ${base}`);
  return out;
}
