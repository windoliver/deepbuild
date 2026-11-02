// Test-side tools for the #30 acceptance tests: temp folders, a world (the record, the asks core and the
// supervisor, #236's local host@1), a recording host, the fixture projects, the tool gates, local listeners, the
// reference-Mac timing judge, an extension host on a world (AC5's slot half) and the claim a verdict is made from
// (the claim halves). Nothing here stands in for the command check kind or the gate: the tests reach them only
// through `@deepbuild/checks-command` and `@deepbuild/gate` (README, The surface under test and The claim's
// surface), whose types alone are imported here. The wrong programs are in wrong.ts.
//
// Safety: every folder is under /tmp/dh30-* (real paths); HOME is a temp folder for this process and every child;
// the agent's own CLAUDE_* and DEEP_* variables are removed first; no test touches the real ~/.deepbuild; and every
// process a test learns the PID of is stopped by that PID only, never by name or port.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import type { CommandCheck } from '../../../packages/checks-command/src/index.ts';
import { openAsks, type Asks } from '../../../packages/asks/src/index.ts';
import type { CheckSpec } from '../../../packages/conformance/src/index.ts';
import { openExtensionHost, openTrust, packageDigest, type ExtensionHost, type ReleaseEntry } from '../../../packages/extension-host/src/index.ts';
import type { ClaimedCheck, ClaimedRuns, ClaimRequirement, RecordedRun } from '../../../packages/gate/src/index.ts';
import { openRecord, type Event, type RecordStore } from '../../../packages/record/src/index.ts';
import { openSupervisor, type Exit, type Host, type HostFacts, type Plant as SupervisorPlant, type Started, type StartSpec, type Supervisor } from '../../../packages/supervisor/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const NODE = process.execPath;
export const DAY = 86_400_000;
/** The command every Vitest fixture runs: the tool's own bin in the checkout's dependencies. */
export const VITEST = 'node_modules/.bin/vitest run';
/** check.kind@1's tool and command (packages/conformance's kit runs its suites with it). */
export const NODE_TEST = 'node --test --test-isolation=none spec/*.test.mjs';
/** Variables the run's own programs set for themselves (the shell, node:test, macOS's CoreFoundation); no runner passes them. */
export const SET_BY_THE_RUN = new Set(['PWD', 'OLDPWD', 'SHLVL', '_', '__CF_USER_TEXT_ENCODING', 'NODE_TEST_WORKER_ID', 'NODE_TEST_CONTEXT']);

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const sha256 = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex');

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key === 'AI_AGENT') delete process.env[key];
// The shell the test harness runs in: a variable a check might lean on (AC1) and a home that isn't the run's.
process.env.DH30_SHELL_FLAG = 'on';
let HOME: string | undefined;
export function home(): string {
  if (!HOME || !existsSync(HOME)) {
    HOME = realpathSync(mkdtempSync('/tmp/dh30-home-'));
    process.env.HOME = HOME;
  }
  return HOME;
}
home();

// ---- IDs.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function base32(value: bigint, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
export const ulid = (ms = Date.now()): string => base32(BigInt(ms), 10) + base32(BigInt(`0x${randomBytes(10).toString('hex')}`), 16);
export const runId = (): string => `run:${ulid()}`;

// ---- Temp folders, all removed after the file.
const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh30-${tag}-`));
  made.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (HOME) rmSync(HOME, { recursive: true, force: true });
});

/**
 * A fixture project in a temp checkout: `fixtures/<name>` copied with each `*.fixture` file renamed without that
 * suffix (so neither this suite's Vitest nor its type check picks the fixtures' own tests up), `extra` files
 * written over it, and, for a project with a package.json, the repo's installed dependencies cloned in
 * copy-on-write, as the design clones a check's ignored folders into its checkout.
 */
export function project(name: string, extra: Record<string, string> = {}): string {
  const dir = tempDir(name);
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.fixture')) renameSync(path, path.slice(0, -'.fixture'.length));
    }
  };
  walk(dir);
  for (const [path, text] of Object.entries(extra)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  if (existsSync(join(dir, 'package.json'))) {
    const from = join(REPO, 'node_modules');
    if (!existsSync(join(from, 'vitest'))) throw Error('BLOCKED: the repo\'s node_modules has no vitest (run npm ci once)');
    try {
      execFileSync('/bin/cp', ['-cR', from, join(dir, 'node_modules')], { stdio: 'pipe' });
    } catch {
      execFileSync('/bin/cp', ['-R', from, join(dir, 'node_modules')], { stdio: 'pipe' });
    }
  }
  return dir;
}

/** check@1's spec for a command check. */
export function spec(runner: string, inputs: string[] = []): CheckSpec {
  return { kind: 'command', runner, inputs, depth: 'unit', oracle: 'code', contract: null };
}

/** A command check of `runner` in `checkout` on `host`, a run handle of its own, a deadline of three minutes. */
export function command(host: Host, checkout: string, runner: string, extra: Partial<Omit<CommandCheck, 'spec'>> & { inputs?: string[] } = {}): CommandCheck {
  const { inputs, ...rest } = extra;
  return { host, run: runId(), spec: spec(runner, inputs ?? []), checkout, deadline: 180_000, ...rest };
}

/** AC8's twin: the app itself writes the refund policy too. */
export const POLICIES_TWIN_SRC = `import type { Db } from '../test/db';

// The app reads the refund window from the policies table, and an admin screen sets it.
export function refundWindow(db: Db): number {
  const row = db.get('SELECT days FROM policies WHERE name = ?', ['refunds']);
  return Number(row?.days ?? 0);
}

export function setRefundWindow(db: Db, days: number): void {
  db.run('INSERT INTO policies (name, days) VALUES (?, ?)', ['refunds', days]);
}
`;
/** AC8's check: the policies fixture, seeded from scripts/seed.ts, or its twin whose src/ inserts into policies. */
export const policiesCheck = (host: Host, twin: boolean): CommandCheck =>
  command(host, project('policies', twin ? { 'src/policies.ts': POLICIES_TWIN_SRC } : {}), VITEST, { inputs: ['src/**', 'test/**', 'scripts/**'] });

/** Every file under a folder, relative with `/`, links left out (a clone's workspace links dangle). */
export function filesIn(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (lstatSync(path).isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(path);
      else out.push(relative(root, path).split(sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
}

// ---- The world: a record, the asks core and the supervisor on them (#236), the local host@1.
export interface World { dir: string; record: RecordStore; asks: Asks; sup: Supervisor; events(kind?: string): Promise<Event[]>; close(): Promise<void> }
export async function openWorld(plant?: SupervisorPlant): Promise<World> {
  const dir = tempDir('world');
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } }, ...(plant ? { plant } : {}) });
  const events = async (kind?: string): Promise<Event[]> => {
    const all: Event[] = [];
    for (let after = 0; ;) {
      const page = await record.read({ after, limit: 1000 });
      all.push(...page);
      if (page.length < 1000) break;
      after = page[page.length - 1]!.log_pos;
    }
    return kind ? all.filter((e) => e.kind === kind) : all;
  };
  return { dir, record, asks, sup, events, close: async () => { await sup.close(); await record.close(); } };
}

// ---- The extension host on a world (#348, #349): where a check kind installed with `replaces` runs (AC5's slot half).
/**
 * A test package in a temp folder: `fixtures/<name>` copied as `project` copies it, `files` written over it, and the
 * manifest's `digest` set to the host's own `packageDigest` of the result, as tests/acceptance/349's `pkg` does.
 */
export function pkg(name: string, files: Record<string, string> = {}): string {
  const dir = project(name, files);
  const manifestPath = join(dir, 'deepbuild.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest.digest = packageDigest(dir);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}
/** The release entry for a package folder: DeepBuild's signed release listing it, so its code runs in the hub. */
export function releaseEntry(dir: string): ReleaseEntry {
  const m = JSON.parse(readFileSync(join(dir, 'deepbuild.json'), 'utf8')) as { id: string; version: string };
  return { id: m.id, version: m.version, digest: packageDigest(dir) };
}
const hosts: ExtensionHost[] = [];
afterAll(async () => { for (const h of hosts.splice(0)) await h.close().catch(() => undefined); });
/** An extension host on the world's record, asks and supervisor, with a ~/.deepbuild of its own, whose release lists `packages`. */
export async function openHostOn(world: World, packages: string[]): Promise<ExtensionHost> {
  const home = join(tempDir('deephome'), 'deepbuild');
  mkdirSync(home, { recursive: true });
  const trust = await openTrust({ record: world.record, now: Date.now });
  const host = await openExtensionHost({ record: world.record, asks: world.asks, supervisor: world.sup, trust, home, release: packages.map(releaseEntry), now: Date.now });
  hosts.push(host);
  await host.ready();
  return host;
}
/** The command check kind's built entry, which a package in the hub imports (README, The claim's surface: AC5). */
export const CHECKS_COMMAND_DIST = join(REPO, 'packages/checks-command/dist/index.js');

// ---- A claim from command runs (README, The claim's surface): what the gate judges through @deepbuild/gate's claimVerdict.
/** The one requirement the claims here cover. */
export const REQ = 'req:30#R1';
export const CLAIM = 'claim:30';
/** A claim of one check, `source` spec, covering REQ, from the given runs; `requirement` overrides the requirement's fields. */
export function claimOf(check: Omit<ClaimedCheck, 'source' | 'covers'> & { source?: ClaimedCheck['source'] }, requirement: Partial<ClaimRequirement> = {}): ClaimedRuns {
  for (const r of check.runs) {
    if (r.outcome === 'missing') throw Error(`BLOCKED: run ${r.run} of ${check.check} never started, so no verdict can be made from it: ${r.failures[0]?.message ?? '(no message)'}`);
  }
  return {
    claim: CLAIM, agent: 'session:AGENT', repo: 'repo:dh30', task: 'task:30', commit: '0'.repeat(40),
    requirements: [{ req: REQ, depth: 'unit', oracle: 'code', on_base: 'passes', ...requirement }],
    checks: [{ source: 'spec', covers: [REQ], ...check }],
    now: Date.now(),
  };
}
export type { RecordedRun };
export const dataOf = (e: Event): Record<string, unknown> => e.data as Record<string, unknown>;

/** One call a check made on host@1, as the recording host saw it. */
export interface HostCall { call: 'start' | 'signal' | 'wait'; run: string; signal?: string; argv?: string[]; started?: Started; exit?: Exit }
/** A host@1 that logs every start, signal and wait, then hands it on to `local` (#236 AC13's recording host). */
export function recording(local: Host): { host: Host; calls: HostCall[] } {
  const calls: HostCall[] = [];
  const host: Host = {
    name: local.name,
    async start(s: StartSpec): Promise<Started> {
      const entry: HostCall = { call: 'start', run: s.run, argv: [...s.argv] };
      calls.push(entry);
      entry.started = await local.start(s);
      return entry.started;
    },
    async signal(run: string, signal: NodeJS.Signals): Promise<void> {
      calls.push({ call: 'signal', run, signal });
      return local.signal(run, signal);
    },
    async wait(run: string): Promise<Exit> {
      const entry: HostCall = { call: 'wait', run };
      calls.push(entry);
      entry.exit = await local.wait(run);
      return entry.exit;
    },
    facts: (): Promise<HostFacts> => local.facts(),
  };
  return { host, calls };
}

// ---- Processes: alive by PID (never stopped by name or port).
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
  try {
    return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }));
  } catch {
    return false;
  }
}
export async function waitFor<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(50);
  }
}

// ---- Listeners on this machine: an HTTP listener (a usage-data endpoint) and a Unix socket (the hub's socket).
export interface Listener { port: number; path: string; connections(): number; close(): Promise<void> }
const listeners: Listener[] = [];
export async function httpListener(): Promise<Listener> {
  let count = 0;
  const server = http.createServer((req, res) => {
    count++;
    req.resume();
    req.on('end', () => { res.writeHead(204); res.end(); });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  const l: Listener = {
    port: typeof address === 'object' && address ? address.port : 0, path: '', connections: () => count,
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
  listeners.push(l);
  return l;
}
export async function unixListener(path: string): Promise<Listener> {
  let count = 0;
  const server = net.createServer((sock) => { count++; sock.on('error', () => undefined); sock.resume(); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
  const l: Listener = { port: 0, path, connections: () => count, close: () => new Promise<void>((r) => server.close(() => r())) };
  listeners.push(l);
  return l;
}
export async function closeListeners(): Promise<void> {
  await Promise.all(listeners.splice(0).map((l) => l.close()));
}

// ---- Tools this machine may lack. A test that needs one fails BLOCKED naming it; it is never skipped.
const gates = new Map<string, string | null>();
function gate(name: string, probe: () => string | null): void {
  if (!gates.has(name)) gates.set(name, probe());
  const problem = gates.get(name);
  if (problem) throw Error(`BLOCKED: ${problem}`);
}
const onPath = (program: string): string | null => {
  for (const dir of (process.env.PATH ?? '').split(':').filter(Boolean)) if (existsSync(join(dir, program))) return join(dir, program);
  return null;
};
/** go test, by compiling and running a one-test module in a temp folder (a module, since GOPATH mode is off from Go 1.16). */
export function needGo(): void {
  gate('go', () => {
    const go = onPath('go');
    if (!go) return 'go isn\'t on PATH, so go test can\'t run on this machine';
    const dir = tempDir('go-probe');
    writeFileSync(join(dir, 'go.mod'), 'module probe\n\ngo 1.16\n');
    writeFileSync(join(dir, 'p.go'), 'package p\n\nfunc One() int { return 1 }\n');
    writeFileSync(join(dir, 'p_test.go'), 'package p\n\nimport "testing"\n\nfunc TestOne(t *testing.T) {\n\tif One() != 1 {\n\t\tt.Fatal("one")\n\t}\n}\n');
    const r = spawnSync(go, ['test', '-json', '.'], { cwd: dir, encoding: 'utf8', timeout: 120_000, env: { PATH: process.env.PATH, HOME: home(), GOCACHE: join(dir, 'cache') } });
    if (r.status !== 0 || !/"Action":"pass"/.test(r.stdout)) return `go test can't run on this machine (${go}, ${spawnSync(go, ['version'], { encoding: 'utf8' }).stdout.trim()}): ${(r.stderr || r.stdout || String(r.error)).trim().slice(0, 300)}`;
    return null;
  });
}
/** Jest, installed in the repo's node_modules (this repo doesn't depend on it, and nothing installs it here). */
export function needJest(): void {
  gate('jest', () => (existsSync(join(REPO, 'node_modules/jest/package.json')) ? null : 'Jest isn\'t installed in the repo\'s node_modules, and these tests add no dependency'));
}
/** pytest, as `python3 -m pytest`. */
export function needPytest(): void {
  gate('pytest', () => {
    const python = onPath('python3');
    if (!python) return 'python3 isn\'t on PATH, so pytest can\'t run on this machine';
    const r = spawnSync(python, ['-m', 'pytest', '--version'], { encoding: 'utf8', timeout: 60_000 });
    return r.status === 0 ? null : `pytest isn't installed for ${python}: ${(r.stderr || r.stdout).trim().split('\n').pop()}`;
  });
}
/** pnpm on PATH. */
export function needPnpm(): void {
  gate('pnpm', () => (onPath('pnpm') ? null : 'pnpm isn\'t on PATH on this machine (corepack would fetch it from the network)'));
}

// ---- Output.
/** The run's stored output, both streams. */
export const outputOf = (r: { output: { stdout: string; stderr: string } }): string => `${r.output.stdout}\n${r.output.stderr}`;
/** The first line of the stored output that starts with `prefix`, without it. */
export function lineAfter(r: { output: { stdout: string; stderr: string } }, prefix: string): string {
  const line = outputOf(r).split('\n').map((l) => l.trim()).find((l) => l.startsWith(prefix));
  if (line === undefined) throw Error(`BLOCKED: the check printed no "${prefix}" line, so the probe never ran (output: ${outputOf(r).slice(0, 1500)})`);
  return line.slice(prefix.length).trim();
}

// ---- Timing on the reference Mac (tests/acceptance/14, 16 and 236's rule).
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const read = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why this machine's timings are a reading only, or null on a reference Mac in a fit state. */
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = read('sysctl', '-n', 'hw.model');
    chip = read('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(read('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = read('pmset', '-g', 'batt');
    power = read('pmset', '-g');
    therm = read('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  const fingerprint = `${model} / ${chip} / ${gib} GiB`;
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${fingerprint}`;
  if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  return null;
}
/**
 * The design's timing rule: PASS when every run is within the limit, FAIL when every run is over it by more than
 * the margin, otherwise INCONCLUSIVE. INCONCLUSIVE fails the test with that word (Nothing missing passes), never
 * a skip.
 */
export function judgeTiming(name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.abs(Math.min(...runs)), 1e-9);
  const margin = Math.max(0.05, spread);
  const shown = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  throw Error(`INCONCLUSIVE ${shown}`);
}
export const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
