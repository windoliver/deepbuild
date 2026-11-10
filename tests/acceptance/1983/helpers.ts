// Test-side tools for the #1983 acceptance tests (README: The surface under test). They build the logic module's
// runner `deep-logic` on this Mac, write this suite's one logic program as WebAssembly bytes, run the x86_64 lane
// (`scripts/lane-x86.mjs`) with ~/.deepbuild in a temporary HOME, stand at the container runtime's command line with
// docker-shim.mjs, and read the lane's evidence records. Nothing here stands in for the lane or the logic module: every
// record, verdict, refusal and ask read here is the implementation's own; the expected values come from the issue.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1983 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
const MIB = 1024 * 1024;
/** rustup's cargo on this Mac (Homebrew's rustup keeps it off the default PATH). */
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}${delimiter}${process.env['PATH'] ?? ''}` } : {}),
};

/** Every test passes this timeout: the lane's first build of deep-logic runs under emulation, over 30 minutes under load. */
export const TIMEOUT = 7_200_000;
/** One lane run may take this long before it counts as timed out (killed by its PID, SIGKILL). */
const LANE_TIMEOUT = 6_600_000;
/** Builds before a file's tests (the slow part), so each test's own time is its own. */
export function prebuild(fn: () => void): void { beforeAll(() => { try { fn(); } catch { /* each test reports its own build failure */ } }, TIMEOUT); }

/** A host or tool this machine lacks: the test fails with this message, never passes (invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = { 1: '#1983.156a4df2', 2: '#1983.ba96b4f2', 3: '#1983.10110411', 4: '#1983.ea54db89', 5: '#1983.bc212c80', 6: '#1983.d39b413d', 7: '#1983.bcb406af' } as const;

// The issue's expected values.
/** The lane's name: its record is ~/.deepbuild/lanes/<tree>-x86_64.json, as writeRecord names it. */
export const LANE = 'x86_64';
/** The golden's recording machine, the reference Mac as deep-logic names it. */
export const RECORDING = { os: 'macos', arch: 'aarch64' } as const;
export const LANE_ARCH = 'x86_64';
export const HOST_ARCH = 'arm64';
export const NETWORK = 'none';
/** The step criterion 2's planted replay changes. */
export const STEP = 37;
/** The fields criterion 1 names, as the record names them (README: The record). */
export const NAMED_FIELDS = ['recording_machine', 'lane_arch', 'host_arch', 'emulated', 'image_digest', 'tree'] as const;
export const VERDICTS = ['PASS', 'FAIL', 'INVALID', 'BLOCKED', 'INCONCLUSIVE'];

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export const show = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${show(value)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${show(value)}`).toBe(true);
  return value as JsonValue[];
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${show(value)}`).toBe('string');
  return value as string;
}
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** This suite runs on the reference Mac (macOS arm64), the host the issue names. */
export function onReferenceMac(): void {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') blocked(`the lane runs on the reference Mac (macOS arm64); this host is ${process.platform}/${process.arch}`);
}

// ---------------------------------------------------------------------------------------------------
// The lane's image pin and the real container runtime (README: The pin; Docker).

export const LANE_SCRIPT = join(REPO, 'scripts', 'lane-x86.mjs');
export const PIN_FILE = join(REPO, 'scripts', 'lane-x86.json');
export interface Pin { image: string; digest: string; ref: string }
/** The pin in the repo: `{image, digest}`, the toolchain image of rust-toolchain.toml's channel, by digest. */
export function pin(): Pin {
  expect(existsSync(PIN_FILE), `the lane's image pin scripts/lane-x86.json exists`).toBe(true);
  const o = obj(JSON.parse(readFileSync(PIN_FILE, 'utf8')) as JsonValue, 'scripts/lane-x86.json');
  const image = str(o['image'], 'the pin\'s image');
  const digest = str(o['digest'], 'the pin\'s digest');
  const channel = /channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8'))?.[1] ?? '(none)';
  expect(image, `the pin names the rust toolchain image of rust-toolchain.toml's channel ${channel}`).toMatch(new RegExp(`^rust:${channel.replace(/\./g, '\\.')}(-[a-z0-9.-]+)?$`));
  expect(digest, 'the pin is a sha256 digest').toMatch(/^sha256:[0-9a-f]{64}$/);
  return { image, digest, ref: `${image}@${digest}` };
}
/** The one command that unblocks a missing image: never run by this suite. */
export const pullCommand = (p: Pin, platform = 'linux/amd64'): string => `docker pull --platform ${platform} ${p.ref}`;

/** The docker CLI on this Mac's PATH, as the lane finds it. */
function realDocker(): string {
  for (const dir of [...(process.env['PATH'] ?? '').split(delimiter), '/opt/homebrew/bin', '/usr/local/bin']) {
    if (dir && existsSync(join(dir, 'docker'))) return join(dir, 'docker');
  }
  return blocked('no docker CLI on PATH; the lane runs in the container runtime on this Mac (Docker through colima)');
}
interface Ran { status: number | null; stdout: string; stderr: string }
/** The real runtime, never through the shim. */
export function docker(args: string[], timeoutMs = 60_000): Ran {
  const run = spawnSync(realDocker(), args, { encoding: 'utf8', maxBuffer: 64 * MIB, timeout: timeoutMs, killSignal: 'SIGKILL' });
  if (run.error) return { status: null, stdout: '', stderr: run.error.message };
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}
/** BLOCKED unless this Mac's container runtime answers. */
export function needRuntime(): void {
  const info = docker(['info', '--format', '{{.ServerVersion}}']);
  if (info.status !== 0) blocked(`Docker is unreachable (docker info: ${info.stderr.trim().split('\n').slice(-1)[0] ?? ''}); the lane runs in the container runtime on this Mac: start it (colima start)`);
}
/** BLOCKED unless the runtime answers and holds the pinned image for `platform`; nothing is pulled. */
export function needImage(p: Pin, platform: 'linux/amd64' | 'linux/arm64'): void {
  needRuntime();
  const arch = platform.split('/')[1];
  const has = docker(['image', 'inspect', '--platform', platform, '--format', '{{.Architecture}}', p.ref]);
  if (has.status !== 0 || has.stdout.trim() !== arch) blocked(`Docker has no ${platform} image of the pinned digest here and this suite pulls nothing; run: ${pullCommand(p, platform)}`);
}
/** The runtime's image list, one line per image: repository, tag, digest and ID. */
export function imageList(): string[] {
  const r = docker(['image', 'ls', '--all', '--digests', '--no-trunc', '--format', '{{.Repository}}\t{{.Tag}}\t{{.Digest}}\t{{.ID}}']);
  expect(r.status, `docker image ls answers: ${r.stderr}`).toBe(0);
  return r.stdout.split('\n').filter(Boolean).sort();
}
/** What hides the pinned image from the lane (docker-shim.mjs): its digest, its tag, and its IDs, as 12-digit prefixes. */
export function hideTokens(p: Pin): string[] {
  const ids = ['', '--platform=linux/amd64', '--platform=linux/arm64'].map((flag) => docker(['image', 'inspect', ...(flag ? [flag] : []), '--format', '{{.Id}}', p.ref]).stdout.trim().replace(/^sha256:/, ''));
  return [...new Set([p.digest.replace(/^sha256:/, '').slice(0, 12), p.image.split(':')[1] ?? p.image, ...ids.filter(Boolean).map((id) => id.slice(0, 12))])];
}

// ---------------------------------------------------------------------------------------------------
// The sandbox: a temporary HOME, so ~/.deepbuild/lanes/ is this test's, never the real one (as #1115's suite does).
// Docker's configuration (its contexts: colima's socket), cargo's and rustup's homes stay the real ones.

export interface Box { dir: string; home: string; env: NodeJS.ProcessEnv }
const boxes: string[] = [];
export function sandbox(): Box {
  const dir = mkdtempSync(join(tmpdir(), 'deep-1983-'));
  const home = join(dir, 'home');
  mkdirSync(home);
  boxes.push(dir);
  const real = homedir();
  const env: NodeJS.ProcessEnv = {
    ...process.env, ...CARGO_ENV, HOME: home,
    DOCKER_CONFIG: process.env['DOCKER_CONFIG'] ?? join(real, '.docker'),
    CARGO_HOME: process.env['CARGO_HOME'] ?? join(real, '.cargo'),
    RUSTUP_HOME: process.env['RUSTUP_HOME'] ?? join(real, '.rustup'),
  };
  return { dir, home, env };
}
afterAll(() => { for (const dir of boxes.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/** Runs `code` (an ES module body) in a node process with the sandbox's environment. */
function nodeIn(box: Box, code: string, args: string[] = []): string {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code, ...args], { cwd: REPO, env: box.env, encoding: 'utf8', maxBuffer: 64 * MIB });
  expect(r.status, `node ran: ${r.stderr.slice(-2000)}`).toBe(0);
  return r.stdout;
}
const LANES_MJS = pathToFileURL(join(REPO, 'scripts', 'lanes.mjs')).href;
/** The exact tree of this checkout, as scripts/lanes.mjs's exactTree gives it under the sandbox's environment. */
export function treeOf(box: Box): string {
  const tree = nodeIn(box, `const { exactTree } = await import(${JSON.stringify(LANES_MJS)}); process.stdout.write(String(exactTree(${JSON.stringify(REPO)})));`).trim();
  expect(tree, 'exactTree gives a tree hash').toMatch(/^[0-9a-f]{40}$/);
  return tree;
}
/** scripts/lanes.mjs's mergeRecords(tree) under the sandbox's HOME (README: Merge). */
export function mergeOf(box: Box, tree: string): JsonValue {
  const out = nodeIn(box, `const m = await import(${JSON.stringify(LANES_MJS)});
process.stdout.write(JSON.stringify(typeof m.mergeRecords === 'function' ? { merged: await m.mergeRecords(process.argv[1]) } : { missing: 'scripts/lanes.mjs exports no mergeRecords' }));`, [tree]);
  const o = obj(JSON.parse(out) as JsonValue, 'the merge');
  expect(o['missing'], 'scripts/lanes.mjs exports mergeRecords(tree)').toBeUndefined();
  return o['merged'] ?? null;
}

/** Where a lane's record for a tree lives (scripts/lanes.mjs writeRecord): ~/.deepbuild/lanes/<tree>-<lane>.json. */
export const recordPath = (box: Box, tree: string, lane = LANE): string => join(box.home, '.deepbuild', 'lanes', `${tree}-${lane}.json`);
/** The lane's record for the tree, after a lane run (its output in the message when there is none). */
export function recordOf(box: Box, tree: string, run: LaneRun | null): JsonObject {
  const file = recordPath(box, tree);
  expect(existsSync(file), `the lane wrote its record ~/.deepbuild/lanes/${tree}-${LANE}.json${run ? ` (lane exit ${run.status}${run.timedOut ? ', timed out' : ''}; stdout: ${run.stdout.slice(-1500)}; stderr: ${run.stderr.slice(-3000)})` : ''}`).toBe(true);
  return obj(JSON.parse(readFileSync(file, 'utf8')) as JsonValue, `the record ${file}`);
}
/** Writes a record where the lane writes one: a planted record, or a lane's record with a field taken out. */
export function plantRecord(box: Box, tree: string, record: JsonObject, lane = LANE): void {
  mkdirSync(join(box.home, '.deepbuild', 'lanes'), { recursive: true });
  writeFileSync(recordPath(box, tree, lane), `${JSON.stringify(record, null, 2)}\n`);
}

// ---------------------------------------------------------------------------------------------------
// The lane: `node scripts/lane-x86.mjs [--planted <name>]` with deep-logic calls on stdin (README: The lane).

export type LanePlanted = 'replay_changes_step_37' | 'container_arm64' | 'native' | 'default_network';
/** One docker command line the lane ran, as docker-shim.mjs read it. */
export interface DockerCall { group: string; verb: string; rest: string[] }
export interface LaneRun { status: number | null; timedOut: boolean; stdout: string; stderr: string; docker: DockerCall[]; pulls: JsonValue[] }
export interface Shim { hide?: string[] }

/** Runs the lane once in the sandbox; with `shim`, `docker` on its PATH is docker-shim.mjs before the real CLI. */
export function runLane(box: Box, calls: JsonObject[], opts: { planted?: LanePlanted; shim?: Shim; env?: NodeJS.ProcessEnv } = {}): LaneRun {
  expect(existsSync(LANE_SCRIPT), 'the lane\'s entry point scripts/lane-x86.mjs exists').toBe(true);
  const env: NodeJS.ProcessEnv = { ...box.env, ...opts.env };
  let log = '';
  if (opts.shim) {
    const bin = mkdtempSync(join(box.dir, 'bin-'));
    log = join(bin, 'docker.log');
    writeFileSync(log, '');
    writeFileSync(join(bin, 'docker'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(HERE, 'docker-shim.mjs'))} "$@"\n`);
    chmodSync(join(bin, 'docker'), 0o755);
    Object.assign(env, {
      PATH: `${bin}${delimiter}${env['PATH'] ?? ''}`, ACCEPTANCE_1983_DOCKER: realDocker(), ACCEPTANCE_1983_DOCKER_LOG: log,
      ACCEPTANCE_1983_HIDE: JSON.stringify(opts.shim.hide ?? []),
    });
  }
  const args = [LANE_SCRIPT, ...(opts.planted ? ['--planted', opts.planted] : [])];
  const run = spawnSync(process.execPath, args, {
    cwd: REPO, env, input: calls.map((c) => JSON.stringify(c)).join('\n') + '\n', encoding: 'utf8', maxBuffer: 512 * MIB, timeout: LANE_TIMEOUT, killSignal: 'SIGKILL',
  });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  const events = log ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as JsonObject) : [];
  return {
    status: run.status, timedOut, stdout: run.stdout ?? '', stderr: run.stderr ?? '',
    docker: events.filter((e) => e['verb'] !== undefined).map((e) => ({ group: String(e['group']), verb: String(e['verb']), rest: (e['rest'] as string[]) })),
    pulls: events.filter((e) => e['pull'] !== undefined).map((e) => e['pull'] ?? null),
  };
}
/** A container the lane started (`docker run` or `docker container run`). */
const isRun = (c: DockerCall): boolean => c.verb === 'run' && (c.group === '' || c.group === 'container');
/** The replay's containers: those whose command (after the image of the pinned digest) runs deep-logic, not cargo (README: The lane). */
export function replays(run: LaneRun, p: Pin): DockerCall[] {
  return run.docker.filter((c) => {
    if (!isRun(c)) return false;
    const image = c.rest.findIndex((a) => a.includes(p.digest));
    const command = image < 0 ? c.rest : c.rest.slice(image + 1);
    return command.some((a) => a.includes('deep-logic')) && !command.some((a) => a === 'cargo' || /\bcargo\s+build\b/.test(a));
  });
}
/** A flag's value on a docker command line (`--flag value` or `--flag=value`), or null. */
export function flagOf(rest: string[], ...names: string[]): string | null {
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    for (const n of names) {
      if (a === n) return rest[i + 1] ?? null;
      if (a.startsWith(`${n}=`)) return a.slice(n.length + 1);
    }
  }
  return null;
}
export const networkOf = (c: DockerCall): string | null => flagOf(c.rest, '--network', '--net');

// ---------------------------------------------------------------------------------------------------
// `deep-logic` on this Mac: JSON lines in, one reply per line (#531's and #532's protocol).

const LOGIC_BIN = 'deep-logic';
/** `deep-logic --planted <name>`: this suite's one planted twin of the logic module (README: Planted twins). */
export type LogicPlanted = 'budget_counts_lane_reading';
let binsDir = '';
let builtLogic: { bin: string; error: string } | undefined;
function cargo(args: string[]): string {
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating|Locking/.test(l)).join('\n').slice(-4000)}`;
  return '';
}
/** `cargo build --locked --bin deep-logic` in the checkout, copied out, once per process. */
export function logicBin(): string {
  if (!builtLogic) {
    if (!binsDir) binsDir = mkdtempSync(join(tmpdir(), 'deep-1983-bins-'));
    const bin = join(binsDir, LOGIC_BIN);
    const error = cargo(['build', '--locked', '--bin', LOGIC_BIN]);
    if (error === '') copyFileSync(join(TARGET, 'debug', LOGIC_BIN), bin);
    builtLogic = { bin, error };
  }
  expect(builtLogic.error, `${LOGIC_BIN} builds on this Mac (cargo build --locked --bin ${LOGIC_BIN})`).toBe('');
  return builtLogic.bin;
}
afterAll(() => { if (binsDir) rmSync(binsDir, { recursive: true, force: true }); binsDir = ''; builtLogic = undefined; });

/** Runs `calls` through one `deep-logic [--planted p]` process on this Mac, in the sandbox's HOME when given one. */
export function onMac(calls: JsonObject[], opts: { box?: Box; planted?: LogicPlanted } = {}): JsonObject[] {
  const args = opts.planted ? ['--planted', opts.planted] : [];
  const what = `${LOGIC_BIN} ${args.join(' ')} on this Mac`;
  const run = spawnSync(logicBin(), args, {
    cwd: REPO, env: opts.box?.env ?? process.env, input: calls.map((c) => JSON.stringify(c)).join('\n') + '\n', encoding: 'utf8', maxBuffer: 512 * MIB, timeout: 1_800_000, killSignal: 'SIGKILL',
  });
  const stdout = run.stdout ?? '';
  expect(run.status, `${what} exits 0 (${run.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter(Boolean);
  expect(lines.length, `${what}: one reply per call (stdout: ${stdout.slice(0, 600)})`).toBe(calls.length);
  return lines.map((l, i) => obj(JSON.parse(l) as JsonValue, `${what}: reply ${i}`));
}

// ---------------------------------------------------------------------------------------------------
// This suite's logic program, `tally`, as WebAssembly bytes (README: The program). It keeps one f64 s in memory at
// 8192, set by init(seed) to the seed's top 20 bits; each step k sets s to s × 1.000001 + k × 0.25 and writes
// x = [s, √s] and n = k, so every value a check reads is f64 arithmetic both architectures must give bit for bit.

export const ITEM = 'tally';
/** The first array the item writes: criterion 2's planted replay changes its first value. */
export const ARRAY = 'x';
const WRITES = { x: { type: 'f64', count: 2 }, n: { type: 'i32' } };
export const STEPS = 120;
const STATE = 8192;
const WRITES_AT = 4096;

const leb = (n: number): number[] => { const out: number[] = []; let v = n >>> 0; do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; out.push(b); } while (v); return out; };
const sleb = (n: number): number[] => {
  const out: number[] = [];
  let v = n | 0;
  for (;;) {
    const b = v & 0x7f;
    v >>= 7;
    if ((v === 0 && (b & 0x40) === 0) || (v === -1 && (b & 0x40) !== 0)) { out.push(b); return out; }
    out.push(b | 0x80);
  }
};
const f64 = (v: number): number[] => [...Buffer.from(new Float64Array([v]).buffer)];
const name = (s: string): number[] => [...leb(s.length), ...Buffer.from(s, 'utf8')];
const vec = (xs: number[][]): number[] => [...leb(xs.length), ...xs.flat()];
const section = (id: number, body: number[]): number[] => [id, ...leb(body.length), ...body];
const fn = (locals: number[][], code: number[]): number[] => { const b = [...vec(locals), ...code, 0x0b]; return [...leb(b.length), ...b]; };

/** The module: exports memory (1 page, max 1), init(i64), step(i64), reads_at 0 and writes_at 4096. */
function tallyBytes(at: { x: number; n: number } | null): Buffer {
  // init: (f64.store (i32.const 8192) (f64.convert_i64_u (i64.shr_u (local.get $seed) (i64.const 44))))
  const init = fn([], [0x41, ...sleb(STATE), 0x20, 0, 0x42, ...sleb(44), 0x88, 0xba, 0x39, 3, 0]);
  const step = at === null ? fn([], []) : fn([[1, 0x7c]], [
    // $s = (f64.add (f64.mul (f64.load 8192) 1.000001) (f64.mul (f64.convert_i64_s $k) 0.25)); (f64.store 8192 $s)
    0x41, ...sleb(STATE), 0x2b, 3, 0, 0x44, ...f64(1.000001), 0xa2, 0x20, 0, 0xb9, 0x44, ...f64(0.25), 0xa2, 0xa0, 0x21, 1,
    0x41, ...sleb(STATE), 0x20, 1, 0x39, 3, 0,
    0x41, ...sleb(WRITES_AT + at.x), 0x20, 1, 0x39, 3, 0, // x[0] = $s
    0x41, ...sleb(WRITES_AT + at.x + 8), 0x20, 1, 0x9f, 0x39, 3, 0, // x[1] = √$s
    0x41, ...sleb(WRITES_AT + at.n), 0x20, 0, 0xa7, 0x36, 2, 0, // n = (i32.wrap_i64 $k)
  ]);
  const bytes = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([[0x60, 1, 0x7e, 0]])),
    ...section(3, vec([[0], [0]])),
    ...section(5, vec([[0x01, 1, 1]])),
    ...section(6, vec([[0x7f, 0x00, 0x41, ...sleb(0), 0x0b], [0x7f, 0x00, 0x41, ...sleb(WRITES_AT), 0x0b]])),
    ...section(7, vec([[...name('memory'), 2, 0], [...name('init'), 0, 0], [...name('step'), 0, 1], [...name('reads_at'), 3, 0], [...name('writes_at'), 3, 1]])),
    ...section(10, vec([init, step])),
  ]);
  new WebAssembly.Module(bytes); // throws on bytes that aren't a valid module
  return bytes;
}
const pieceOf = (seed: number, bytes: Buffer): JsonObject => {
  const sha = sha256(bytes);
  return { seed, items: { [ITEM]: { kind: 'logic@1', params: { program: sha, writes: WRITES } } }, assets: { [sha]: bytes.toString('base64') } };
};
/** The piece with `tally`, its write offsets read from `check` of the same item with an empty step. */
export function tallyPiece(seed: number): JsonObject {
  const [checked] = onMac([{ call: 'check', piece: pieceOf(seed, tallyBytes(null)) }]);
  expect(checked!['ok'], `check admits tally: ${show(checked)}`).toBe(true);
  const entries = arr(obj(obj(obj(checked!['items'], 'check.items')[ITEM], 'check.items.tally')['layout'], 'layout')['entries'], 'layout.entries').map((e) => obj(e, 'a layout entry'));
  const offset = (n: string): number => {
    const e = entries.find((x) => x['region'] === 'writes' && x['name'] === n);
    expect(e, `the layout has the write entry ${n}: ${show(entries)}`).toBeDefined();
    return e!['offset'] as number;
  };
  return pieceOf(seed, tallyBytes({ x: offset('x'), n: offset('n') }));
}

// The calls (README: deep-logic calls).
const bakeFields = (p: JsonObject): JsonObject => ({ piece: p, track: [], steps: STEPS });
export const goldenCall = (p: JsonObject): JsonObject => ({ call: 'golden', ...bakeFields(p) });
export const verifyCall = (p: JsonObject, golden: JsonObject): JsonObject => ({ call: 'golden_verify', ...bakeFields(p), golden });
export const crossCall = (p: JsonObject, tree: string): JsonObject => ({ call: 'determinism', ...bakeFields(p), at_times: [1], compare: 'cross_machine', tree });
export const budgetCall = (p: JsonObject, tree?: string): JsonObject => ({ call: 'budget', ...bakeFields(p), fuel_share: 0.5, on: ['app'], ...(tree ? { tree } : {}) });

/** A golden of the piece recorded on this Mac: the reference Mac, macos/aarch64. */
export function macGolden(p: JsonObject): JsonObject {
  const [reply] = onMac([goldenCall(p)]);
  expect(reply!['ok'], `the golden was recorded on this Mac: ${show(reply)}`).toBe(true);
  const golden = obj(reply!['golden'], 'golden');
  expect(obj(golden['machine'], 'golden.machine'), 'the golden names its recording machine, the reference Mac').toMatchObject(RECORDING);
  return golden;
}

/** logic.determinism with compare cross_machine (README: cross_machine). */
export interface Cross { verdict: string; machines: JsonValue; failures: JsonObject[]; refusals: JsonObject[]; ask: JsonValue; raw: JsonObject }
export function crossOf(reply: JsonObject, what: string): Cross {
  expect(reply['ok'], `${what} ran (ok: true): ${show(reply)}`).toBe(true);
  expect(reply['kind'], `${what} is logic.determinism`).toBe('logic.determinism');
  const verdict = str(reply['verdict'], `${what}.verdict`);
  expect(VERDICTS, `${what}'s verdict is one of the five`).toContain(verdict);
  return {
    verdict, machines: reply['machines'] ?? null, ask: reply['ask'] ?? null, raw: reply,
    failures: arr(reply['failures'] ?? [], `${what}.failures`).map((f, i) => obj(f, `${what}.failures[${i}]`)),
    refusals: arr(reply['refusals'] ?? [], `${what}.refusals`).map((f, i) => obj(f, `${what}.refusals[${i}]`)),
  };
}
/** cross_machine on the lane's record for the tree, in the sandbox. */
export function cross(box: Box, p: JsonObject, tree: string, what: string): Cross {
  const [reply] = onMac([crossCall(p, tree)], { box });
  return crossOf(reply!, what);
}
