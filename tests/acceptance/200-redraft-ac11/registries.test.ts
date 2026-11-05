// #200 AC11 (#200.bd93251c), a blind redraft: "mark@1, builder@1, modifier@1 and check.kind.doc@1 seal in a test build of
// the core and scene3d with today's marks, builders, modifiers and check kinds as the core's entries, every content key
// unchanged, and each one's kit refuses its planted wrong entry, naming the registry and the entry: a mark whose bounds
// leave out a pixel it draws, a builder whose element count isn't computable from its params, a modifier declared
// deform that adds vertices, and a check kind that emits a code the catalogue doesn't list; gpu.output@1's and
// gpu.function@1's kits refuse theirs the same way, an output typed vec3 that its consumer reads as vec4 and a step
// function declared exact whose body takes a float step; and a planted kit that admits any of these makes the seal
// refuse that registry, naming it, and fails this"
//
// asserts (README: What the tests assert), each condition by name:
//   (seal)         the test build of the core and scene3d (`r2,test-leave-out-effects`) seals and deep://registries lists
//                  mark@1, builder@1, modifier@1 and check.kind.doc@1, each the core's;
//   (today)        each holds today's marks, builders, modifiers and check kinds (the base's lists, README) as the core's
//                  entries: origin first_party, filled by the core, with since, digest and a passing kit result;
//   (keys)         every content key of the build's fixtures is the merge base's;
//   (planted)      each of the six kits refuses its planted wrong entry, the one the criterion describes, its result
//                  naming the registry (the row it is listed under) and the entry;
//   (admits)       `--planted kit_admits_all:<registry>` makes the seal refuse that registry, naming it and that planted
//                  entry, and this suite's kit check fails on that build, naming the registry.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const FOLDER = 'tests/acceptance/200-redraft-ac11';
const TIMEOUT = 1_800_000;
/** The test build of the core and scene3d: the smallest build set holding scene3d (r2; scene3d requires motion), effects left out. */
const FEATURES = ['r2', 'test-leave-out-effects'];
/** The times every fixture is evaluated at. */
const TIMES = ['0s', '0.5s', '1.5s'];

// ---------------------------------------------------------------------------------------------------
// Today's lists: the base's, read from its code (README: Today's lists). A name written with `@<n>` must match exactly;
// one without may be listed bare or as `<name>@<n>`.

/** The mark primitives scene3d registers (crates/deep-canvas-scene3d/src/module.rs; the `mark.*@1` kinds). */
const TODAY_MARKS = ['mark.box@1', 'mark.cylinder@1', 'mark.line@1', 'mark.point@1', 'mark.sphere@1', 'mark.text@1'];
/** The builder kinds (crates/deep-canvas-scene3d/src/builders.rs, `KINDS`). */
const TODAY_BUILDERS = ['hull@1', 'slab@1', 'lathe@1', 'extrude@1', 'tube@1', 'ball@1', 'coil@1', 'plate@1', 'display@1'];
/** The modifier kinds a builder's stack runs (crates/deep-canvas-scene3d/src/stack.rs, `KINDS`). */
const TODAY_MODIFIERS = [
  'mod.array@1', 'mod.mirror@1', 'mod.subdivide@1', 'mod.bevel@1', 'mod.solidify@1', 'mod.build@1', 'mod.store@1',
  'mod.normals@1', 'mod.curve_deform@1', 'mod.simple_deform@1', 'mod.displace@1', 'mod.sway@1', 'mod.bob@1',
  'mod.wave@1', 'mod.spin@1', 'mod.dash@1', 'mod.outline@1', 'mod.boil@1',
];
/** The core's own document check kinds (crates/deep-canvas/src/registry/mod.rs, `CORE_CHECK_KINDS`). */
const TODAY_CHECK_KINDS = [
  'document.validate', 'document.budget', 'document.frame_time', 'document.layout', 'document.determinism',
  'geometry.audit', 'film.audit', 'film.flicker', 'film.layout', 'honest_numbers', 'kind_rules',
];
const TODAY: Record<string, string[]> = {
  'mark@1': TODAY_MARKS,
  'builder@1': TODAY_BUILDERS,
  'modifier@1': TODAY_MODIFIERS,
  'check.kind.doc@1': TODAY_CHECK_KINDS,
};

/**
 * The planted wrong entry the criterion describes for each registry, recognised by the criterion's own words in the
 * planted entry's name and its failing rules (rule, message, why); gpu.output@1's by its value's types. Every pattern
 * must match (README: Recognising a planted entry).
 */
interface Described { registry: string; what: string; patterns: RegExp[]; value?: boolean }
const DESCRIBED: Described[] = [
  { registry: 'mark@1', what: 'a mark whose bounds leave out a pixel it draws', patterns: [/bound/i, /leave|left out|outside|miss|beyond|exceed/i] },
  { registry: 'builder@1', what: "a builder whose element count isn't computable from its params", patterns: [/count|element/i, /param/i, /not|n't|cannot|uncomputable/i] },
  { registry: 'modifier@1', what: 'a modifier declared deform that adds vertices', patterns: [/deform/i, /vert/i] },
  { registry: 'check.kind.doc@1', what: "a check kind that emits a code the catalogue doesn't list", patterns: [/code/i, /catalog/i] },
  { registry: 'gpu.output@1', what: 'an output typed vec3 that its consumer reads as vec4', patterns: [/vec3/i, /vec4/i], value: true },
  { registry: 'gpu.function@1', what: 'a step function declared exact whose body takes a float step', patterns: [/exact/i, /float/i] },
];

// ---------------------------------------------------------------------------------------------------
// JSON

const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (v: JsonValue | undefined): JsonValue[] => (Array.isArray(v) ? v : []);
const show = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 60).join('\n  ')}`).toEqual([]);
}
const named = (listed: string, expected: string): boolean =>
  expected.includes('@') ? listed === expected : listed === expected || new RegExp(`^${expected.replace(/\./g, '\\.')}@\\d+$`).test(listed);

// ---------------------------------------------------------------------------------------------------
// Builds: `cargo build --locked --bin deep-show --no-default-features --features <set>`, copied out under its own name.

const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  CARGO_BUILD_JOBS: process.env['CARGO_BUILD_JOBS'] ?? '6',
};
const exe = (n: string): string => (process.platform === 'win32' ? `${n}.exe` : n);
function buildTo(root: string, to: string, env: NodeJS.ProcessEnv = {}): string {
  const args = ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', FEATURES.join(',')];
  const all = { ...process.env, ...CARGO_ENV, ...env };
  const r = spawnSync('cargo', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: all });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n')}`;
  const target = all['CARGO_TARGET_DIR'] ? resolve(root, all['CARGO_TARGET_DIR']) : join(root, 'target');
  copyFileSync(join(target, 'debug', exe('deep-show')), to);
  return '';
}

let bins = '';
let work = '';
let candidate = { bin: '', error: '' };
beforeAll(() => {
  bins = mkdtempSync(join(tmpdir(), 'deep-200r11-bins-'));
  work = mkdtempSync(join(tmpdir(), 'deep-200r11-'));
  const bin = join(bins, 'deep-show-candidate');
  candidate = { bin, error: buildTo(REPO, bin) };
}, 7_200_000);
afterAll(() => {
  for (const d of [bins, work]) if (d) rmSync(d, { recursive: true, force: true });
});
function bin(): string {
  expect(candidate.error, `deep-show builds with features ${FEATURES.join(',')}`).toBe('');
  return candidate.bin;
}

/**
 * The merge base's build of the same features. When the checkout is the merge base itself (HEAD is it and nothing
 * tracked outside this folder differs), its build is the candidate's, so it isn't built twice; otherwise the merge
 * base is exported by `git archive` into a folder under the OS temp folder, kept per commit so later runs build warm.
 */
let baseBin = '';
function base(): { sha: string; bin: string; same: boolean } {
  const git = (...a: string[]): string => execFileSync('git', a, { cwd: REPO, encoding: 'utf8' }).trim();
  const sha = git('merge-base', 'HEAD', 'origin/main');
  const same = git('rev-parse', 'HEAD') === sha && git('status', '--porcelain', '--untracked-files=no', '--', '.', `:(exclude)${FOLDER}`) === '';
  if (same) return { sha, bin: bin(), same };
  const dir = join(tmpdir(), 'deep-200r11-base', sha.slice(0, 12));
  if (!existsSync(join(dir, '.exported'))) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const tar = `${dir}.tar`;
    execFileSync('git', ['archive', '--format=tar', '-o', tar, sha], { cwd: REPO });
    execFileSync('tar', ['-xf', tar, '-C', dir]);
    rmSync(tar, { force: true });
    writeFileSync(join(dir, '.exported'), sha);
  }
  if (!baseBin) {
    const to = join(dir, 'deep-show-base');
    expect(buildTo(dir, to, { CARGO_TARGET_DIR: join(dir, 'target') }), `the merge base ${sha.slice(0, 12)} builds in ${dir}`).toBe('');
    baseBin = to;
  }
  return { sha, bin: baseBin, same };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run [--planted <twin>]`: the seal runs at startup; one scenario in, one answer line out (#393).

const DOC = '01JB200R110000000000000001';
const YOU = { pid: 3002, start: 3_000 };
interface Started { status: number | null; line: JsonObject | null; stdout: string; stderr: string }
function start(binary: string, calls: JsonObject[], planted?: string, extra: JsonObject = {}): Started {
  const evidence = mkdtempSync(join(work, 'ev-'));
  const sc = {
    evidence, sessions: {}, processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: YOU.pid, ppid: 1, start: YOU.start }],
    panels: { main: { rect: [0, 0, 800, 600] } }, docs: { [DOC]: { panel: 'main' } }, goldens: join(evidence, 'goldens'), ...extra, calls,
  };
  const args = planted ? ['run', '--planted', planted] : ['run'];
  const r = spawnSync(binary, args, { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  let line: JsonObject | null = null;
  try {
    const parsed = JSON.parse(r.stdout.split('\n').filter((l) => l !== '')[0] ?? 'null') as JsonValue;
    line = isObject(parsed) ? parsed : null;
  } catch { line = null; }
  return { status: r.status, line, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
function run(binary: string, calls: JsonObject[], extra: JsonObject = {}): JsonObject[] {
  const s = start(binary, calls, undefined, extra);
  expect(s.status, `deep-show run exits 0; stdout ${s.stdout.slice(0, 800)}; stderr ${s.stderr.slice(-800)}`).toBe(0);
  expect(s.line?.['ok'], `deep-show run took the scenario: ${show(s.line)}`).toBe(true);
  const replies = list(s.line!['replies']).filter(isObject);
  expect(replies.length, 'one reply per call').toBe(calls.length);
  return replies;
}

/** deep://registries in a build that sealed, or the startup's answer when it didn't. */
type Listing = { sealed: true; rows: JsonObject[] } | { sealed: false; refusal: Started };
function listing(binary: string, planted?: string): Listing {
  const s = start(binary, [{ call: 'registries' }], planted);
  if (s.status !== 0 || s.line?.['ok'] !== true) return { sealed: false, refusal: s };
  const reply = list(s.line['replies']).find(isObject);
  return { sealed: true, rows: list(reply?.['registries']).filter(isObject) };
}
const refusalText = (s: Started): string => `exit ${s.status}: ${show(s.line) ?? s.stdout.slice(0, 800)} ${s.stderr.slice(-400)}`;
const rowOf = (rows: JsonObject[], name: string): JsonObject | undefined => rows.find((r) => r['kind'] === 'registry' && r['name'] === name);

// ---------------------------------------------------------------------------------------------------
// (seal), (today): the four registries the core declares, with today's lists as the core's entries.

function todayFailures(l: Listing): string[] {
  if (!l.sealed) return [`the test build of the core and scene3d doesn't seal: ${refusalText(l.refusal)}`];
  const failures: string[] = [];
  for (const [registry, expected] of Object.entries(TODAY)) {
    const row = rowOf(l.rows, registry);
    if (!row) { failures.push(`deep://registries lists no registry ${registry}; it lists ${l.rows.map((r) => String(r['name'])).join(', ')}`); continue; }
    if (row['owner'] !== 'core') failures.push(`${registry} is declared by ${show(row['owner'])}, not the core`);
    const entries = list(row['entries']).filter(isObject);
    for (const want of expected) {
      const e = entries.find((x) => named(String(x['name']), want));
      if (!e) { failures.push(`${registry} holds no entry ${want} (today's); it holds ${entries.map((x) => String(x['name'])).join(', ') || 'none'}`); continue; }
      const at = `${registry} entry ${String(e['name'])}`;
      if (e['origin'] !== 'first_party') failures.push(`${at}: origin ${show(e['origin'])}, not first_party`);
      if (e['module'] !== 'core') failures.push(`${at}: filled by ${show(e['module'] ?? null)}, not the core`);
      if (typeof e['since'] !== 'string' || e['since'] === '') failures.push(`${at}: no since`);
      if (typeof e['digest'] !== 'string' || e['digest'] === '') failures.push(`${at}: no digest`);
      const kit = isObject(e['kit']) ? e['kit'] : {};
      if (kit['verdict'] !== 'PASS') failures.push(`${at}: its kit result is ${show(e['kit'] ?? null)}, not PASS`);
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// (planted): each kit refuses the planted wrong entry the criterion describes.

interface Found { name: string; failures: string[] }
/** The planted entry `d` describes in the registry's listed row, and why its kit's refusal doesn't hold. */
function describedPlanted(rows: JsonObject[], d: Described): Found {
  const row = rowOf(rows, d.registry);
  if (!row) return { name: '', failures: [`deep://registries lists no registry ${d.registry}`] };
  const planted = list(row['planted']).filter(isObject);
  const text = (p: JsonObject): string => {
    const result = isObject(p['result']) ? p['result'] : {};
    const failed = list(result['rules']).filter(isObject).filter((r) => r['verdict'] !== 'PASS');
    return [String(p['name']), ...failed.flatMap((r) => [r['rule'], r['message'], r['why']].map(String)), d.value ? JSON.stringify(p['value']) : ''].join(' ');
  };
  const match = planted.find((p) => d.patterns.every((re) => re.test(text(p))));
  if (!match) {
    return { name: '', failures: [`${d.registry} lists no planted wrong entry that is ${d.what}; its planted entries: ${show(planted)}`] };
  }
  const name = String(match['name']);
  const result = isObject(match['result']) ? match['result'] : {};
  const failures: string[] = [];
  if (result['verdict'] !== 'FAIL') failures.push(`${d.registry}'s kit admits its planted wrong entry ${name} (${d.what}): ${show(match['result'] ?? null)}`);
  if (result['entry'] !== name) failures.push(`${d.registry}'s kit result on ${name} names the entry ${show(result['entry'] ?? null)}`);
  const failed = list(result['rules']).filter(isObject).filter((r) => r['verdict'] === 'FAIL');
  if (result['verdict'] === 'FAIL' && !failed.some((r) => typeof r['message'] === 'string' && r['message'] !== '')) {
    failures.push(`${d.registry}'s kit refuses ${name} with no rule's message: ${show(match['result'] ?? null)}`);
  }
  return { name, failures };
}

/** This suite's kit check on one build: the registry `d` names is listed and its kit refuses the entry `d` describes. */
function kitFailures(l: Listing, d: Described): string[] {
  if (!l.sealed) return [`${d.registry}: the build doesn't seal: ${refusalText(l.refusal)}`];
  return describedPlanted(l.rows, d).failures;
}

// ---------------------------------------------------------------------------------------------------
// (keys): every content key of the build's fixtures, at each time, against the merge base's.

interface Keys { names: string[]; byFixture: Map<string, { code: string; nodes: Map<string, string> }[]> }
function keysOf(binary: string, only: readonly string[] | null): Keys {
  const [manifest, fixtures] = run(binary, [{ call: 'manifest' }, { call: 'fixtures' }]);
  const records = list(fixtures!['fixtures']).filter(isObject);
  const byFixture: Keys['byFixture'] = new Map();
  const names: string[] = [];
  for (const f of list(manifest!['fixtures']).filter(isObject)) {
    const name = String(f['name']);
    names.push(name);
    if (only && !only.includes(name)) continue;
    const doc = isObject(f['document']) ? f['document'] : {};
    // A scene is a scenario of calls; its document, when it holds one, is what is evaluated.
    const document = f['profile'] === 'scene' ? (isObject(doc['document']) ? doc['document'] : null) : doc;
    if (!document) continue;
    const own = records.find((r) => r['module'] === f['module'] && JSON.stringify(r['document']) === JSON.stringify(doc));
    const calls: JsonObject[] = [];
    for (const t of TIMES) {
      calls.push({ call: 'deep show', peer: YOU, doc: DOC, document, include: ['issues'], size: [320, 180], t });
      calls.push({ call: 'eval', doc: DOC, t });
    }
    const replies = run(binary, calls, own?.['record'] !== undefined ? { record: own['record']! } : {});
    byFixture.set(name, TIMES.map((_, i) => {
      const e = replies[2 * i + 1]!;
      const nodes = new Map<string, string>();
      for (const n of list(e['nodes']).filter(isObject)) {
        nodes.set(`${String(n['operator'])}|${n['item'] === null || n['item'] === undefined ? '-' : String(n['item'])}`, String(n['key']));
      }
      return { code: typeof e['code'] === 'string' ? e['code'] : '', nodes };
    }));
  }
  return { names, byFixture };
}

function keyFailures(before: Keys, after: Keys): string[] {
  const failures: string[] = [];
  for (const name of before.names) if (!after.names.includes(name)) failures.push(`${name}: the fixture is gone from the manifest`);
  for (const [name, times] of before.byFixture) {
    const later = after.byFixture.get(name);
    if (!later) { failures.push(`${name}: not evaluated in the candidate`); continue; }
    TIMES.forEach((t, i) => {
      const b = times[i]!;
      const a = later[i]!;
      if (a.code !== b.code) failures.push(`${name} at ${t}: eval answered ${a.code || 'nodes'}, the merge base ${b.code || 'nodes'}`);
      for (const [node, key] of b.nodes) {
        const k = a.nodes.get(node);
        if (k === undefined) failures.push(`${name} at ${t}: node ${node} is gone (its content key was ${key})`);
        else if (k !== key) failures.push(`${name} at ${t}: node ${node}'s content key changed from ${key} to ${k}`);
      }
    });
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------

describe('#200 AC11 (redraft) mark@1, builder@1, modifier@1 and check.kind.doc@1 seal with today\'s lists, and their kits and the GPU layer\'s refuse their planted wrong entries', () => {
  it('AC11 (seal, today) mark@1, builder@1, modifier@1 and check.kind.doc@1 seal in a test build of the core and scene3d with today\'s marks, builders, modifiers and check kinds as the core\'s entries', () => {
    none(todayFailures(listing(bin())), 'the four registries in the test build of the core and scene3d');
  }, TIMEOUT);

  it('AC11 (keys) every content key of the build\'s fixtures is unchanged from the merge base', () => {
    const b = base();
    const before = keysOf(b.bin, null);
    expect(before.byFixture.size, `the merge base ${b.sha.slice(0, 12)} evaluates fixtures`).toBeGreaterThan(5);
    expect([...before.byFixture.values()].some((ts) => ts.some((x) => x.nodes.size > 0)), 'the merge base evaluates nodes with content keys').toBe(true);
    // The comparison can fail: one key changed by hand is found and named.
    const [first, times] = [...before.byFixture].find(([, ts]) => ts[0]!.nodes.size > 0)!;
    const [node] = [...times[0]!.nodes.keys()];
    const altered: Keys = { names: before.names, byFixture: new Map(before.byFixture) };
    altered.byFixture.set(first, times.map((x, i) => (i === 0 ? { code: x.code, nodes: new Map([...x.nodes, [node!, 'planted']]) } : x)));
    expect(keyFailures(before, altered).some((f) => f.includes(first) && f.includes(node!) && f.includes('content key changed')), 'a changed key fails the comparison, naming the fixture and the node').toBe(true);
    const after = b.same ? before : keysOf(bin(), [...before.byFixture.keys()]);
    none(keyFailures(before, after), `content keys against the merge base ${b.sha.slice(0, 12)}${b.same ? ' (the checkout is the merge base)' : ''}`);
  }, TIMEOUT);

  it('AC11 (planted) each one\'s kit refuses its planted wrong entry, naming the registry and the entry, and gpu.output@1\'s and gpu.function@1\'s refuse theirs the same way', () => {
    const l = listing(bin());
    if (!l.sealed) { none([`the test build of the core and scene3d doesn't seal: ${refusalText(l.refusal)}`], 'the kits'); return; }
    none(DESCRIBED.flatMap((d) => describedPlanted(l.rows, d).failures), 'the kits on their planted wrong entries');
  }, TIMEOUT);

  for (const d of DESCRIBED) {
    it(`AC11 (admits) a planted kit that admits every entry makes the seal refuse ${d.registry}, naming it and its planted entry (${d.what}), and fails this`, () => {
      const clean = listing(bin());
      if (!clean.sealed) { none([`the test build doesn't seal: ${refusalText(clean.refusal)}`], 'precondition'); return; }
      const { name, failures } = describedPlanted(clean.rows, d);
      none(failures, `precondition: ${d.registry}'s planted wrong entry, ${d.what}`);
      const twin = `kit_admits_all:${d.registry}`;
      const planted = listing(bin(), twin);
      // "and fails this": this suite's kit check fails on the planted build, naming the registry.
      const caught = kitFailures(planted, d);
      expect(caught.length > 0 && caught.every((f) => f.includes(d.registry)), `the kit check fails on --planted ${twin}, naming ${d.registry}; it reported: ${caught.join('; ') || 'nothing'}`).toBe(true);
      expect(planted.sealed, `the seal refuses the build with --planted ${twin}`).toBe(false);
      if (planted.sealed) return;
      const r = planted.refusal;
      expect(r.status, `the refused startup exits non-zero: ${refusalText(r)}`).not.toBe(0);
      expect(r.line?.['ok'], `the startup answers a refusal: ${refusalText(r)}`).toBe(false);
      expect(r.line?.['registry'], `the refusal names the registry: ${refusalText(r)}`).toBe(d.registry);
      expect(JSON.stringify(r.line?.['entries'] ?? null).includes(name) || String(r.line?.['what'] ?? '').includes(name), `the refusal names the planted entry ${name}: ${refusalText(r)}`).toBe(true);
    }, TIMEOUT);
  }
});
