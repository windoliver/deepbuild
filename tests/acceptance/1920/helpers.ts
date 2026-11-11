// Test-side tools for the #1920 acceptance tests (README: The surface under test): `deep-show` built per Cargo
// feature set (a build set plus this suite's test features) and copied out, as #185's suite builds it; `deep-show
// run [--planted <name>]` and its `registry`, `schedule`, `fixtures`, `deep_show` and `eval` calls; the published
// plan's `interfaces` and `runtime_digest`; and the three judges this suite computes itself, with the digests the
// likely wrong seals would publish, so each test file runs every judge on planted input it must fail.
// Nothing here stands in for the seal: every digest judged is one a binary published, and the expected value is
// the design's own formula (Registry and seal: runtime digest) over what the same plan names.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1920 is three levels down). */
const REPO = join(HERE, '..', '..', '..');
const SHOW = 'deep-show';
const MIB = 1024 * 1024;

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const AC1 = '#1920.d626ec86';
export const AC2 = '#1920.73d8b8e7';

/** The issue's and the design's names. */
export const PHYSICS = 'physics@1';
export const PHYSICS_MODULE = 'physics';
/** Rapier's crate for 3D worlds (World and backend: `backend.name`), pinned at 0.36.1. */
export const RAPIER = 'rapier3d';
export const RAPIER_VERSION = '0.36.1';
/** #185's test interface, its canvas module and its implementations A and B. */
export const SIM = 'test.sim@1';
export const SIM_MODULE = 'test.sim';
export const A = 'test.sim.a';
export const B = 'test.sim.b';

/** The two planted seals, each reachable only through the startup `--planted <name>` (README: Names this suite chooses). */
export const OMITS_PHYSICS = 'runtime_digest_omits_physics';
export const HASHES_ONLY_SHAPES = 'runtime_digest_hashes_only_shapes';

/** A d1 digest as published: 64 lowercase hex. */
const DIGEST = /^[0-9a-f]{64}$/;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

// ---------------------------------------------------------------------------------------------------
// JSON

const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
const show = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v)}`).toBe(true);
  return v as JsonObject;
}
function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v)}`).toBe(true);
  return v as JsonValue[];
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v)}`).toBe('string');
  return v as string;
}
const strs = (v: JsonValue | undefined, what: string): string[] => arr(v, what).map((x, i) => str(x, `${what}[${i}]`));
export const sorted = (list: readonly string[]): string[] => [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * Every path at which two JSON values differ, segments joined by `/`: an object key by key, a list of objects
 * element by element, and anything else (a string, a list of strings, a list whose length changed) as a whole.
 */
function diffPaths(a: JsonValue | undefined, b: JsonValue | undefined, at: string[] = []): string[] {
  if (isObject(a) && isObject(b)) return sorted([...new Set([...Object.keys(a), ...Object.keys(b)])]).flatMap((k) => diffPaths(a[k], b[k], [...at, k]));
  const nested = (x: JsonValue): boolean => isObject(x) || Array.isArray(x);
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every(nested)) return a.flatMap((x, i) => diffPaths(x, b[i], [...at, String(i)]));
  return a !== undefined && b !== undefined && canonical(a) === canonical(b) ? [] : [at.join('/')];
}

// ---------------------------------------------------------------------------------------------------
// Builds: one `deep-show` per Cargo feature set, built once per file, each copied out under its own name.

type BuildSet = 'core' | 'full';
/** `test-sim-a` and `test-sim-b` are #185's; the other four are this suite's (README: Names this suite chooses). */
type TestFeature = 'test-sim-a' | 'test-sim-b' | 'test-physics-rapier-patch' | 'test-sim-a-1-0-1' | 'test-sim-b-1-0-1' | 'test-sim-b-pin-feature';
export interface Build { set: BuildSet; with?: TestFeature[] }

const featuresOf = (build: Build): string[] => [build.set, ...(build.with ?? [])];
export const buildName = (build: Build): string => `${SHOW} ${featuresOf(build).join(',')}`;

/** `cargo build --locked --bin deep-show --no-default-features --features …` in the checkout, the binary copied to `to`; '' or why not. */
function buildTo(features: string[], to: string): string {
  const env: NodeJS.ProcessEnv = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const args = ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', features.join(',')];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * MIB, env });
  // Nothing unrun passes: without cargo no build runs, and every test that asks for one fails, saying so.
  if (run.error) return (run.error as NodeJS.ErrnoException).code === 'ENOENT' ? `BLOCKED: cargo isn't on PATH, so ${SHOW} can't be built` : `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(-4000)}`;
  const target = env['CARGO_TARGET_DIR'] ? resolve(REPO, env['CARGO_TARGET_DIR']) : join(REPO, 'target');
  copyFileSync(join(target, 'debug', SHOW), to);
  return '';
}

/** Builds every listed feature set once, before the file's tests; a test that asks for a build that failed fails at "the binary builds", with cargo's error. */
export function useBuilds(builds: readonly Build[]): (build: Build) => string {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1920-bins-'));
    for (const build of builds) {
      const features = featuresOf(build);
      const bin = join(dir, `${SHOW}-${features.join('+')}`);
      made.set(buildName(build), { bin, error: buildTo(features, bin) });
    }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (build: Build): string => {
    const entry = made.get(buildName(build));
    if (!entry) throw Error(`the file didn't list the build ${buildName(build)} in useBuilds`);
    expect(entry.error, `the binary builds: ${SHOW} with features ${featuresOf(build).join(',')}`).toBe('');
    return entry.bin;
  };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run [--planted <name>]`: one scenario in as a JSON line, one answer out, one reply per call.

/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1920-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

const AGENT = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Test agent: the runtime digest', process: { pid: 4100, start: 1_000 } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];

function scenario(evidence: string, calls: JsonObject[], docs: JsonObject = {}): JsonObject {
  return {
    evidence,
    sessions: { [AGENT.id]: { thread: AGENT.thread, name: AGENT.name, process: AGENT.process } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 800, 600] } },
    docs,
    calls,
  };
}

/** Runs `calls` through one process of `bin`: it starts (the seal accepts the set), exits 0 and answers each call. */
function run(bin: string, what: string, evidence: string, calls: JsonObject[], planted?: string, docs: JsonObject = {}): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify(scenario(evidence, calls, docs))}\n`, encoding: 'utf8', maxBuffer: 1024 * MIB, timeout: 540_000, killSignal: 'SIGKILL' });
  const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
  if (r.error && code !== 'ETIMEDOUT' && code !== 'EPIPE') throw Error(`${what}: ${r.error.message}`);
  expect(code === 'ETIMEDOUT' ? 'timed out' : '', `${what}: \`${args.join(' ')}\` finished in time`).toBe('');
  const stdout = r.stdout ?? '';
  expect(r.status, `${what}: \`${args.join(' ')}\` starts and exits 0; stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one answer line per scenario`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${what}: the answer`);
  expect(out['ok'], `${what}: the scenario is accepted: ${show(out)}`).toBe(true);
  const replies = arr(out['replies'], `${what}: replies`).map((x, i) => obj(x, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(calls.length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// The sealed plan as published: `schedule` (deep://schedule/<core version>), with `registry` beside it.

type Pin = { version: string; features: string[] };
type Implementation = { name: string; version: string; pins: { [crate: string]: Pin }; equivalence: string; state: string };
/** One entry of the plan's `interfaces` (#185's shape): the interface, its shape digest, its reference and the implementation the build chose. */
type Interface = { name: string; digest: string; reference: string; module: string; implementation: Implementation };
export interface Published { what: string; buildSet: string; state: string; modules: string[]; schedule: JsonObject; interfaces: Interface[] }

function interfaceOf(plan: string, name: string, v: JsonValue | undefined): Interface {
  const what = `${plan}: schedule.interfaces["${name}"]`;
  const o = obj(v, what);
  const impl = obj(o['implementation'], `${what}.implementation`);
  const pins = Object.fromEntries(Object.entries(obj(impl['pins'], `${what}.implementation.pins`)).map(([crate, p]) => {
    const pin = obj(p, `${what}.implementation.pins.${crate}`);
    expect(sorted(Object.keys(pin)), `${what}.implementation.pins.${crate} holds the pin's version and features (pins: {crate → {version, features}})`).toEqual(['features', 'version']);
    return [crate, { version: str(pin['version'], `${what}.implementation.pins.${crate}.version`), features: strs(pin['features'], `${what}.implementation.pins.${crate}.features`) }];
  }));
  const out: Interface = {
    name,
    digest: str(o['digest'], `${what}.digest`),
    reference: str(o['reference'], `${what}.reference`),
    module: str(o['module'], `${what}.module`),
    implementation: {
      name: str(impl['name'], `${what}.implementation.name`),
      version: str(impl['version'], `${what}.implementation.version`),
      pins,
      equivalence: str(impl['equivalence'], `${what}.implementation.equivalence`),
      state: str(impl['state'], `${what}.implementation.state`),
    },
  };
  expect(out.implementation.name, `${what}.implementation.name names the implementation`).not.toBe('');
  expect(out.implementation.version, `${what}.implementation.version is semver`).toMatch(SEMVER);
  expect(['bit', 'measured'], `${what}.implementation.equivalence`).toContain(out.implementation.equivalence);
  expect(['canonical', 'backend_bytes'], `${what}.implementation.state`).toContain(out.implementation.state);
  return out;
}

/** One fresh process of `bin` (under a planted seal when named): its `registry` reply and its published plan. */
export function published(bin: string, build: string, evidence: string, planted?: string): Published {
  const what = planted ? `${build} --planted ${planted}` : build;
  const [reg, schedule] = run(bin, what, evidence, [{ call: 'registry' }, { call: 'schedule' }], planted);
  expect(str(schedule!['uri'], `${what}: schedule.uri`), `${what}: the sealed plan is published at deep://schedule/<core version>`).toMatch(/^deep:\/\/schedule\/.+/);
  const interfaces = Object.entries(obj(schedule!['interfaces'], `${what}: schedule.interfaces`)).map(([name, v]) => interfaceOf(what, name, v));
  return {
    what,
    buildSet: str(reg!['build_set'], `${what}: registry.build_set`),
    state: str(reg!['state'], `${what}: registry.state`),
    modules: strs(reg!['modules'], `${what}: registry.modules`),
    schedule: schedule!,
    interfaces,
  };
}
/** Where two published plans differ, the runtime digest apart: the judges below read that. */
export const planDifferences = (a: Published, b: Published): string[] => diffPaths(a.schedule, b.schedule).filter((path) => path !== 'runtime_digest');
export function theInterface(p: Published, name: string): Interface {
  const i = p.interfaces.find((x) => x.name === name);
  expect(i, `${p.what}: the plan published at deep://schedule names the interface ${name}; it names ${p.interfaces.map((x) => x.name).join(', ') || 'none'}`).toBeDefined();
  return i!;
}

/** What a judge reads of one build's published plan: the interfaces it names and the runtime digest it carries. */
export type Seal = { what: string; interfaces: Interface[]; digest: string };
export function sealOf(p: Published): Seal {
  const digest = str(p.schedule['runtime_digest'], `${p.what}: the plan published at deep://schedule carries runtime_digest (Registry and seal: \`runtime_digest: d1 digest\`)`);
  expect(digest, `${p.what}: runtime_digest is a d1 digest, 64 lowercase hex`).toMatch(DIGEST);
  return { what: p.what, interfaces: p.interfaces, digest };
}
/** The same plan carrying another digest: what a wrong seal would have published for it. */
export const withDigest = (seal: Seal, digest: string): Seal => ({ ...seal, what: `${seal.what} (planted digest)`, digest });
/** The same plan with one interface's implementation declared otherwise. */
export function declared(seal: Seal, name: string, equivalence: string, state: string): Seal {
  return { ...seal, what: `${seal.what} (${name} declared ${equivalence}, ${state})`, interfaces: seal.interfaces.map((i) => (i.name === name ? { ...i, implementation: { ...i.implementation, equivalence, state } } : i)) };
}

// ---------------------------------------------------------------------------------------------------
// The design's formula (Registry and seal: runtime digest): a d1 digest over [{interface@major, implementation,
// version, pins}], sorted by interface, for every implementation in the sealed set whose state is backend_bytes or
// whose equivalence is measured. A d1 digest is the SHA-256 of the value's RFC 8785 bytes (technical design: One
// canonical form before any hash).

/** RFC 8785 bytes of a value holding strings, lists and objects (an entry holds no number): keys sorted, no white space. */
function canonical(v: JsonValue): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (isObject(v)) return `{${sorted(Object.keys(v)).map((k) => `${JSON.stringify(k)}:${canonical(v[k]!)}`).join(',')}}`;
  return JSON.stringify(v);
}
const d1 = (v: JsonValue): string => createHash('sha256').update(canonical(v), 'utf8').digest('hex');

type Entry = { interface: string; implementation: string; version: string; pins: { [crate: string]: Pin } };
const entryOf = (i: Interface): Entry => ({ interface: i.name, implementation: i.implementation.name, version: i.implementation.version, pins: i.implementation.pins });
const byInterface = (a: { interface: string }, b: { interface: string }): number => (a.interface < b.interface ? -1 : a.interface > b.interface ? 1 : 0);
const isCovered = (i: Interface): boolean => i.implementation.equivalence === 'measured' || i.implementation.state === 'backend_bytes';
/** Every implementation a plan names, as a digest entry, sorted by interface. */
const every = (interfaces: Interface[]): Entry[] => interfaces.map(entryOf).sort(byInterface);
/** The entries the runtime digest is over: the plan's measured or backend_bytes implementations, sorted by interface. */
const covered = (interfaces: Interface[]): Entry[] => every(interfaces.filter(isCovered));

type Judged = { ok: boolean; why: string };

/**
 * Judge 1, one build: the runtime digest covers the implementations `only` names and nothing else. It passes when
 * the implementations the plan declares measured or backend_bytes are exactly those of the interfaces in `only`,
 * and the published digest is the d1 digest of their entries as the plan names them.
 */
export function judgeCovers(seal: Seal, only: string[]): Judged {
  const entries = covered(seal.interfaces);
  const names = entries.map((e) => e.interface);
  if (JSON.stringify(names) !== JSON.stringify(sorted(only))) return { ok: false, why: `${seal.what}: the runtime digest should cover [${sorted(only).join(', ')}] and nothing else, but the plan declares [${names.join(', ')}] measured or backend_bytes` };
  const expected = d1(entries);
  if (seal.digest !== expected) return { ok: false, why: `${seal.what}: runtime_digest ${seal.digest} isn't the d1 digest of ${show(entries)}, which is ${expected}` };
  return { ok: true, why: `${seal.what}: runtime_digest is the d1 digest of ${show(entries)}` };
}

type Named = { interface: string; implementation: string };
type Followed = { ok: boolean; moved: boolean; names: Named[]; why: string };

/**
 * Judge 2, two builds: the runtime digest moves exactly when a measured or backend_bytes implementation differs
 * between them. `names` says what the verdict is about: the implementations of that class that differ, or, when
 * none does, every other implementation that differs. A failure's `why` names them too.
 */
export function judgeFollows(a: Seal, b: Seal): Followed {
  const moved = a.digest !== b.digest;
  const differing = (pick: (interfaces: Interface[]) => Entry[]): { named: Named[]; where: string } => {
    const [ea, eb] = [pick(a.interfaces), pick(b.interfaces)];
    const named: Named[] = [];
    const where: string[] = [];
    for (const name of sorted([...new Set([...ea, ...eb].map((e) => e.interface))])) {
      const [x, y] = [ea.find((e) => e.interface === name), eb.find((e) => e.interface === name)];
      const paths = diffPaths(x, y);
      if (paths.length === 0) continue;
      named.push({ interface: name, implementation: (y ?? x)!.implementation });
      where.push(`${name}'s implementation ${(y ?? x)!.implementation} (${x && y ? paths.join(', ') : x ? 'only in the first' : 'only in the second'})`);
    }
    return { named, where: where.join('; ') };
  };
  const must = differing(covered);
  if (must.named.length > 0) {
    return { ok: moved, moved, names: must.named, why: moved
      ? `the runtime digest moves between ${a.what} and ${b.what}, where ${must.where} differs`
      : `one runtime digest (${a.digest}) for ${a.what} and ${b.what}, though ${must.where} differs` };
  }
  const others = differing(every);
  return { ok: !moved, moved, names: others.named, why: moved
    ? `the runtime digest moved (${a.digest}, then ${b.digest}) between ${a.what} and ${b.what}, though no measured or backend_bytes implementation differs${others.where ? `; what differs is ${others.where}, bit and canonical` : ''}`
    : `the runtime digest stays between ${a.what} and ${b.what}, where no measured or backend_bytes implementation differs` };
}

/**
 * The digest each likely wrong seal would publish for a plan, computed from what the plan itself names, so a judge
 * is run on that seal's output without a planted program in shipped code (README: Wrong programs and traps).
 */
export const WRONG_SEALS = {
  covers_every_implementation: {
    what: 'covers every implementation of the set, the bit and canonical ones too',
    digest: (interfaces: Interface[]): string => d1(every(interfaces)),
  },
  names_only: {
    what: 'covers each implementation\'s name but neither its version nor its pins',
    digest: (interfaces: Interface[]): string => d1(covered(interfaces).map((e) => ({ interface: e.interface, implementation: e.implementation }))),
  },
  without_pins: {
    what: 'leaves the pins out',
    digest: (interfaces: Interface[]): string => d1(covered(interfaces).map((e) => ({ interface: e.interface, implementation: e.implementation, version: e.version }))),
  },
  pin_versions_only: {
    what: 'reads each pin\'s version but not its features',
    digest: (interfaces: Interface[]): string => d1(covered(interfaces).map((e) => ({ ...e, pins: Object.fromEntries(Object.entries(e.pins).map(([crate, p]) => [crate, { version: p.version }])) }))),
  },
  only_shapes: {
    what: 'hashes only registered shapes, each covered interface with its shape digest (AC2\'s planted seal, by this formula)',
    digest: (interfaces: Interface[]): string => d1(interfaces.filter(isCovered).map((i) => ({ interface: i.name, digest: i.digest })).sort(byInterface)),
  },
  omits_physics: {
    what: 'leaves the physics implementation out (AC1\'s planted seal, by this formula)',
    digest: (interfaces: Interface[]): string => d1(covered(interfaces).filter((e) => e.interface !== PHYSICS)),
  },
} as const;
export type WrongSeal = keyof typeof WRONG_SEALS;
/** One plan as a wrong seal would have published it. */
export const underWrongSeal = (name: WrongSeal, seal: Seal): Seal => withDigest(seal, WRONG_SEALS[name].digest(seal.interfaces));

// ---------------------------------------------------------------------------------------------------
// A canvas module's kit fixtures and the hashes its implementation gives on them: every fixture the `fixtures`
// call lists for the module (#387; the kit's manifest holds each, #138), presented with `deep_show` and evaluated
// clean at 0 s with `eval`, whose nodes carry `result`, the SHA-256 of the bytes each node wrote (#387).

type NodeHash = { fixture: string; operator: string; item: string | null; result: string };
interface FixtureHashes { documents: JsonObject; hashes: NodeHash[] }

export function kitFixtureHashes(bin: string, build: string, evidence: string, module: string): FixtureHashes {
  const [listed] = run(bin, build, evidence, [{ call: 'fixtures' }]);
  const fixtures = arr(listed!['fixtures'], `${build}: fixtures`).map((f, i) => obj(f, `${build}: fixtures[${i}]`)).filter((f) => f['module'] === module);
  expect(fixtures.length, `${build}: the canvas module ${module} registers kit fixtures, which the fixtures call lists`).toBeGreaterThan(0);
  const names = fixtures.map((f, i) => str(f['name'], `${build}: ${module}'s fixture ${i}: name`));
  const ids = fixtures.map((_, i) => `01JB19200000000000000000${String(i).padStart(2, '0')}`);
  const calls: JsonObject[] = fixtures.flatMap((f, i) => [
    { call: 'deep_show', session: AGENT.id, doc: ids[i]!, document: obj(f['document'], `${build}: fixture ${names[i]}: document`), include: ['issues'] },
    { call: 'eval', doc: ids[i]!, t: '0s', clean: true },
  ]);
  const replies = run(bin, build, evidence, calls, undefined, Object.fromEntries(ids.map((id) => [id, { panel: 'main' }])));
  const hashes: NodeHash[] = [];
  names.forEach((fixture, i) => {
    expect(replies[2 * i]!['outcome'], `${build}: fixture ${fixture} is presented: ${show(replies[2 * i])}`).toBe('presented');
    const evaluated = replies[2 * i + 1]!;
    expect(evaluated['outcome'], `${build}: fixture ${fixture} is evaluated at 0 s: ${show(evaluated).slice(0, 600)}`).toBe('evaluated');
    const nodes = arr(evaluated['nodes'], `${build}: fixture ${fixture}: nodes`).map((n, k) => obj(n, `${build}: fixture ${fixture}: nodes[${k}]`)).filter((n) => n['module'] === module);
    expect(nodes.length, `${build}: fixture ${fixture} runs ${module}'s operators`).toBeGreaterThan(0);
    for (const n of nodes) {
      const result = str(n['result'], `${build}: fixture ${fixture}: ${show(n['operator'])}'s result`);
      expect(result, `${build}: fixture ${fixture}: a node's result is a SHA-256`).toMatch(DIGEST);
      hashes.push({ fixture, operator: str(n['operator'], `${build}: fixture ${fixture}: a node's operator`), item: typeof n['item'] === 'string' ? n['item'] : null, result });
    }
  });
  return { documents: Object.fromEntries(names.map((name, i) => [name, fixtures[i]!['document']!])), hashes };
}

/**
 * Judge 3: a build's kit fixtures give the reference's hashes. It passes when, on every fixture, each of the
 * module's nodes wrote the bytes the reference implementation's build wrote; a failure names the first fixture and
 * operator that differ.
 */
export function judgeReferenceHashes(reference: NodeHash[], candidate: NodeHash[]): Judged {
  const key = (n: NodeHash): string => `fixture ${n.fixture}: ${n.operator} on ${n.item ?? 'the document'}`;
  const theirs = new Map(reference.map((n) => [key(n), n.result]));
  const ours = new Map(candidate.map((n) => [key(n), n.result]));
  for (const [k, result] of theirs) {
    if (!ours.has(k)) return { ok: false, why: `${k} ran in the reference's build and not in this one` };
    if (ours.get(k) !== result) return { ok: false, why: `${k} gives ${ours.get(k)}, and the reference ${result}` };
  }
  for (const k of ours.keys()) if (!theirs.has(k)) return { ok: false, why: `${k} ran in this build and not in the reference's` };
  return { ok: theirs.size > 0, why: theirs.size > 0 ? `all ${theirs.size} nodes give the reference's hashes` : 'the reference ran no node' };
}
