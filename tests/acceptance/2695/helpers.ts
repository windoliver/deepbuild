// Test-side tools for issue #2695's acceptance tests (the guard entries' proofs move out of rules.json): temp homes
// under /tmp set up by the real `deep setup` (stand-ins for launchd, systemctl, claude and codex first on PATH, as
// #1998's suite has them), or seeded with rules.json as the merge base's setup wrote it; the real hub; the real
// deep-hook run as Claude Code's hook entry runs it, built from this checkout and from the pinned merge base; `deep
// guard add` and `deep doctor`; the record read back through the hub's socket. Adapted from
// tests/acceptance/1998/helpers.ts, 2204/helpers.ts and 1097/helpers.ts (same repo, same license); this suite keeps its
// own copy so a redraft there never moves these tests. Nothing here asserts a criterion: a setup that can't be made
// throws a plain BLOCKED or INCONCLUSIVE error; the criteria's assertions are the tests' own `expect`s.
//
// Safety: every folder is under /tmp/dh2695-*; HOME is a temp folder for every process started, so no real ~/.claude,
// ~/.codex or ~/.deepbuild is read or written, and setup writes its hooks only into that temp HOME; no child inherits
// this process's DEEP_*, CLAUDE*, CODEX*, XDG_*, GIT_*, GH_* or billing keys; every process is stopped by its PID.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
/** The deep-hook `deep setup` names in the hook entries it writes, and the hub's check mode runs. */
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
/**
 * The merge base these tests were written on, pinned: origin/main before any #2695 code. Pinned rather than computed,
 * so "the merge base" stays the program whose rules.json holds the proofs after #2695 merges (README).
 */
export const BASE = '512d194bb2885717f655528fe3e2d102d9cc7640';
/** The proofs' file, read as the natural name beside rules.json (README, The proofs' file). */
export const PROOFS = 'proofs.json';

/** Each criterion's ID: `#2695.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed. */
export const AC1 = '#2695.5cc60b5e';
export const AC2 = '#2695.7026a58e';
export const AC3 = '#2695.d791b61b';
export const AC4 = '#2695.af072e8f';
export const AC5 = '#2695.f70c83fe';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const isObj = (v: unknown): v is Line => typeof v === 'object' && v !== null && !Array.isArray(v);
export const parseObject = (raw: string): Line | undefined => {
  try {
    const value: unknown = JSON.parse(raw);
    return isObj(value) ? value : undefined;
  } catch {
    return undefined;
  }
};
/** JSON with every object's keys sorted: two values are equal when these are. */
export const canonical = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh2695-'));
  made.push(dir);
  return dir;
}

// ---- Processes this suite started. Stopped by PID only, never by name or port.
const owned = new Set<number>();
const own = (pid: number | undefined | null): void => { if (pid) owned.add(pid); };
function alive(pid: number): boolean {
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
async function stopPid(pid: number): Promise<void> {
  try { process.kill(pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 15_000;
  while (alive(pid) && Date.now() < deadline) await sleep(20);
  if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
}
const homes: Home[] = [];
/** Stops every process this suite started, the launchd stand-in's jobs included, and removes temp folders. */
export async function cleanup(): Promise<void> {
  for (const h of homes.splice(0)) {
    const file = join(h.bin, 'launchd', 'started.pids');
    if (existsSync(file)) for (const pid of readFileSync(file, 'utf8').split('\n').map(Number)) if (pid > 0) own(pid);
  }
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) {
    // A file a test made unreadable is removed with its folder.
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* left in /tmp */ }
  }
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean; pid: number }
/** Runs a command to its end, with stdin `input`, killing it (by its PID) at `timeoutMs`. */
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs: number }): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs);
    const done = (code: number | null, signal: NodeJS.Signals | null, extra = '') => {
      clearTimeout(timer);
      if (child.pid) owned.delete(child.pid);
      resolve({ code, signal, stdout, stderr: stderr + extra, ms: performance.now() - t0, timedOut, pid: child.pid ?? 0 });
    };
    child.on('error', (error) => done(null, null, error.message));
    child.on('close', (code, signal) => done(code, signal));
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''} after ${r.ms.toFixed(0)} ms, stdout ${JSON.stringify(r.stdout.slice(0, 900))}, stderr ${JSON.stringify(r.stderr.slice(0, 900))}`;

// ---- deep-hook builds: this checkout's (debug, and release for the instruction counts) and the pinned merge base's.
const CARGO_ENV = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
const builds = new Map<string, Promise<string>>();
function once(key: string, make: () => Promise<string>): Promise<string> {
  let built = builds.get(key);
  if (!built) {
    built = make().then((binary) => {
      // The first exec of a new binary is slow on macOS (it is checked before it runs); warm it once.
      spawnSync(binary, ['--help'], { stdio: 'ignore', timeout: 60_000 });
      return binary;
    });
    builds.set(key, built);
  }
  return built;
}
/** This checkout's deep-hook, `cargo build --locked -q -p deep-hook` (debug, as setup runs it) or `--release`. */
export function buildHook(release = false): Promise<string> {
  return once(release ? 'release' : 'debug', async () => {
    if (!existsSync(CLI)) throw Error(`BLOCKED: no ${CLI}: run \`npm run build --workspaces\` first`);
    const args = ['build', '--locked', '-q', '-p', 'deep-hook', ...(release ? ['--release'] : [])];
    const binary = join(REPO, 'target', release ? 'release' : 'debug', 'deep-hook');
    const r = await run('nice', ['-n', '10', 'cargo', ...args], { env: CARGO_ENV, timeoutMs: 1_800_000 });
    if (r.timedOut) throw Error(`INCONCLUSIVE: cargo ${args.join(' ')} was killed at the timeout`);
    if (r.code !== 0 || !existsSync(binary)) throw Error(`BLOCKED: deep-hook did not build: cargo ${args.join(' ')} exited ${r.code}: ${r.stderr.slice(-1500)}`);
    return binary;
  });
}
/**
 * deep-hook as the pinned merge base `BASE` has it, release: crates/deep-hook and crates/deep-contracts (its one path
 * dependency), the two adapter facts files it compiles in and Cargo.lock taken from that commit with `git archive`, built offline in a workspace of their own under
 * target/base-2695. Built once and kept; nothing in the checkout changes.
 */
export function buildBase(): Promise<string> {
  return once('base', async () => {
    const dir = join(REPO, 'target', 'base-2695', BASE.slice(0, 12));
    const binary = join(dir, 'target', 'release', 'deep-hook');
    if (existsSync(binary)) return binary;
    const src = join(dir, 'src');
    rmSync(src, { recursive: true, force: true });
    mkdirSync(src, { recursive: true });
    let tar: Buffer;
    try {
      tar = execFileSync('git', ['-C', REPO, 'archive', '--format=tar', BASE, 'crates/deep-hook', 'crates/deep-contracts', 'adapters/claude-code.facts.json', 'adapters/mcp-servers.facts.json', 'Cargo.lock'], { maxBuffer: 256 * 1024 * 1024 });
    } catch (error) {
      throw Error(`BLOCKED: the merge base ${BASE} can't be read with git archive: ${(error as Error).message.slice(0, 600)}`);
    }
    execFileSync('tar', ['-x', '-C', src], { input: tar });
    writeFileSync(join(src, 'Cargo.toml'), '[workspace]\nmembers = ["crates/deep-contracts", "crates/deep-hook"]\nresolver = "2"\n');
    const args = ['build', '--offline', '-q', '--release', '-p', 'deep-hook', '--manifest-path', join(src, 'Cargo.toml'), '--target-dir', join(dir, 'target')];
    const r = await run('nice', ['-n', '10', 'cargo', ...args], { env: CARGO_ENV, cwd: src, timeoutMs: 1_800_000 });
    if (r.timedOut) throw Error(`INCONCLUSIVE: the merge base's deep-hook build was killed at the timeout`);
    if (r.code !== 0 || !existsSync(binary)) throw Error(`BLOCKED: deep-hook at the merge base ${BASE} did not build: cargo ${args.join(' ')} exited ${r.code}: ${r.stderr.slice(-2000)}`);
    return binary;
  });
}

// ---- What the merge base wrote: its shipped entries and their proofs.
export interface Call { tool_name: string; tool_input: Line; cwd?: string }
export interface RulesFile { v: number; entries: Record<string, Line>; proofs: Record<string, Line> }
let baseText: string | undefined;
/** crates/deep-hook/default-rules.json at `BASE`, verbatim: the file the merge base's setup writes as the first rules.json. */
export function baseRulesText(): string {
  if (baseText !== undefined) return baseText;
  try {
    baseText = execFileSync('git', ['-C', REPO, 'show', `${BASE}:crates/deep-hook/default-rules.json`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    throw Error(`BLOCKED: the merge base's default-rules.json can't be read with git show ${BASE}: ${(error as Error).message.slice(0, 600)}`);
  }
  return baseText;
}
/** That file, parsed. */
export function baseRules(): RulesFile {
  const parsed = parseObject(baseRulesText());
  if (!parsed || !isObj(parsed.entries) || !isObj(parsed.proofs)) throw Error(`BLOCKED: the merge base's default-rules.json has no entries and proofs`);
  return parsed as RulesFile;
}
/** The merge base's proofs, by entry: 31. */
export const baseProofs = (): Record<string, Line> => baseRules().proofs;

/** Every planted call and twin of the merge base's proofs, each named for a failure message. */
export interface Named { label: string; entry: string; call: Call }
export function provedCalls(): Named[] {
  const out: Named[] = [];
  for (const [entry, proof] of Object.entries(baseProofs())) {
    const pairs = [proof].flat() as { planted: Call; twin: Call }[];
    pairs.forEach((pair, i) => {
      for (const kind of ['planted', 'twin'] as const) {
        const call = pair[kind];
        const what = call.tool_name === 'Bash' ? String(call.tool_input.command) : `${call.tool_name} ${JSON.stringify(call.tool_input)}`;
        out.push({ label: `${entry}'s ${kind}${pairs.length > 1 ? ` #${i + 1}` : ''} \`${what}\``, entry, call });
      }
    });
  }
  return out;
}

/** The proofs a parsed proofs' file holds: its `proofs` member when it has one, else the file's own members but `v`. */
export function proofsHeld(file: Line): Line {
  if (isObj(file.proofs)) return file.proofs;
  return Object.fromEntries(Object.entries(file).filter(([k]) => k !== 'v'));
}
/** The outermost paths in a JSON value that hold a proof or a part of one: a `proofs` key, or a `planted` or `twin` member. */
export function proofKeys(value: unknown, at = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => proofKeys(v, `${at}[${i}]`));
  if (!isObj(value)) return [];
  return Object.entries(value).flatMap(([k, v]) => (['proofs', 'planted', 'twin'].includes(k) ? [`${at}.${k}`.replace(/^\./, '')] : proofKeys(v, `${at}.${k}`)));
}

// ---- Homes. `<tmp>/h` is HOME; `<tmp>/bin` comes first on PATH with the stand-ins; `<tmp>/w` is the agent's folder.
export interface Home { tmp: string; home: string; root: string; bin: string; work: string; confirm: string }
export const rulesPath = (h: Home) => join(h.root, 'rules.json');
export const proofsPath = (h: Home) => join(h.root, PROOFS);
/**
 * A fresh home: `<tmp>/bin` holds `launchctl` (the launchd stand-in, fixtures/launchd.mjs), `systemctl`, `claude` and
 * `codex` (fixtures/stub-bin.sh: each logs and exits 0), `sh-login` (your login shell) and `deep`. `<tmp>/confirm` holds
 * `confirmed`: the OS confirmation stubbed through DEEP_HUB_TEST_CONFIRM, as #1998's and #304's suites do.
 */
export function makeHome(): Home {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  const work = join(tmp, 'w');
  for (const d of [home, bin, work]) mkdirSync(d, { recursive: true });
  const covered = (JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as { versions: string[] }).versions.at(-1)!;
  for (const name of ['systemctl', 'claude', 'codex']) {
    copyFileSync(join(FIXTURES, 'stub-bin.sh'), join(bin, name));
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(bin, 'claude.version'), `${covered}\n`);
  const script = (name: string, text: string) => { writeFileSync(join(bin, name), text); chmodSync(join(bin, name), 0o755); };
  script('launchctl', `#!/bin/sh\nexec '${NODE}' '${join(FIXTURES, 'launchd.mjs')}' '${join(bin, 'launchd')}' "$@"\n`);
  script('deep', `#!/bin/sh\nexec '${NODE}' '${CLI}' "$@"\n`);
  script('sh-login', [
    '#!/bin/sh',
    '# Your login shell, as setup reads it. Login and interactive flags are dropped, so no profile of this machine is read.',
    `PATH='${bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin'; export PATH`,
    'for a; do shift; case "$a" in -l|-i|--login|-il|-li) ;; -lc|-cl|-ilc|-lic|-ic|-ci) set -- "$@" -c ;; *) set -- "$@" "$a" ;; esac; done',
    'exec /bin/sh "$@"',
    '',
  ].join('\n'));
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const h = { tmp, home, root: join(home, '.deepbuild'), bin, work, confirm };
  homes.push(h);
  return h;
}

const BILLING = /^(?:DEEP_|XDG_|CLAUDE|CODEX|GIT_|GH_|GITHUB_|ANTHROPIC_|OPENAI_|AWS_|RUST_)/;
/** A child's environment: HOME the test's, the stand-ins first on PATH, none of this process's DEEP_, XDG_, CLAUDE*, CODEX*, GIT_, GH_ or billing variables. */
export function childEnv(h: Home, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!BILLING.test(key) && key !== 'NODE_OPTIONS') env[key] = value;
  Object.assign(env, {
    HOME: h.home, XDG_CONFIG_HOME: join(h.home, '.config'), XDG_CACHE_HOME: join(h.home, '.cache'), SHELL: join(h.bin, 'sh-login'),
    PATH: `${h.bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`, LC_ALL: 'C', DEEP_HUB_TEST_CONFIRM: h.confirm,
  });
  for (const [key, value] of Object.entries(extra)) { if (value === undefined) delete env[key]; else env[key] = value; }
  return env;
}

/** `deep <args>` from the built CLI, HOME the test's home, in its work folder. */
export async function deep(h: Home, args: readonly string[], timeoutMs = 300_000): Promise<Ran> {
  await buildHook();
  return run(NODE, [CLI, ...args], { env: childEnv(h), cwd: h.work, timeoutMs });
}

function answers(socket: string, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect(socket);
    const done = (v: boolean) => { clearTimeout(timer); sock.destroy(); resolve(v); };
    const timer = setTimeout(() => done(false), timeoutMs);
    sock.setEncoding('utf8');
    sock.on('data', (d: string) => { if (d.includes('\n')) done(true); });
    sock.on('error', () => done(false));
  });
}

export interface Hub { home: Home; socket: string; pid: number }
/**
 * `deep setup` in the home, insisting on exit 0, then the hub its login service (the launchd stand-in) started
 * answering at ~/.deepbuild/hub.sock; its PID is the stand-in's job's.
 */
export async function setup(h: Home): Promise<Hub> {
  if (process.platform !== 'darwin') throw Error(`BLOCKED: these tests stand in for launchd, the login service on macOS; on ${process.platform} setup would reach the real service manager`);
  const r = await deep(h, ['setup']);
  if (r.code !== 0) throw Error(`BLOCKED: deep setup must exit 0: ${shown(r)}`);
  const socket = join(h.root, 'hub.sock');
  for (const deadline = Date.now() + 60_000; !(await answers(socket));) {
    if (Date.now() > deadline) throw Error(`BLOCKED: deep setup started no hub that answers at ${socket}`);
    await sleep(250);
  }
  const state = JSON.parse(execFileSync(NODE, [join(FIXTURES, 'launchd.mjs'), join(h.bin, 'launchd'), '__state'], { encoding: 'utf8' })) as { pid: number | null; program: string[] }[];
  const job = state.find((j) => j.pid && j.program.includes('hub'));
  if (!job?.pid) throw Error(`BLOCKED: the launchd stand-in runs no hub job after deep setup: ${JSON.stringify(state)}`);
  own(job.pid);
  return { home: h, socket, pid: job.pid };
}
/**
 * A home as the merge base's setup leaves the parts these tests reach, with no setup run: <home>/.deepbuild (0700)
 * holding the merge base's default-rules.json verbatim as rules.json (proofs in it), and a setup-finished.json as setup
 * writes it. This is "a home whose rules.json still holds proofs, as an older hub wrote it".
 */
export function olderHome(): Home {
  const h = makeHome();
  mkdirSync(h.root, { recursive: true, mode: 0o700 });
  writeFileSync(rulesPath(h), baseRulesText(), { mode: 0o600 });
  const version = String((JSON.parse(readFileSync(join(REPO, 'packages/cli/package.json'), 'utf8')) as Line).version);
  writeFileSync(join(h.root, 'setup-finished.json'), `${JSON.stringify({ version, at: new Date().toISOString() })}\n`, { mode: 0o600 });
  return h;
}
/** Starts `deep hub run` on the home's root and waits for its ready line. */
export async function startHub(h: Home, timeoutMs = 120_000): Promise<Hub> {
  await buildHook();
  const child: ChildProcess = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(h), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  const ready = await Promise.race([
    new Promise<Line | undefined>((resolve) => {
      child.stdout!.setEncoding('utf8').on('data', (d: string) => {
        out += d;
        if (out.includes('\n')) resolve(parseObject(out.split('\n')[0]!));
      });
    }),
    exit.then(() => undefined),
    sleep(timeoutMs).then(() => undefined),
  ]);
  if (!ready || ready.ready !== true) throw Error(`BLOCKED: the hub did not start within ${timeoutMs} ms: ${err.slice(-1500)}`);
  return { home: h, socket: String(ready.socket), pid: Number(ready.pid) };
}
/** Stops a hub this suite started, by its PID. */
export async function stopHub(hub: Hub): Promise<void> {
  await stopPid(hub.pid);
  owned.delete(hub.pid);
}

/** A file's text, or undefined when it is missing; why not, when it is there and can't be read. */
export function readJson(path: string): Line | undefined {
  if (!existsSync(path)) return undefined;
  return parseObject(readFileSync(path, 'utf8'));
}

// ---- Guard files for `deep guard add` (#304's shapes).
/** A test entry whose reason carries a token no shipped entry has. */
export function testEntry(name: string, match: string): Line {
  const token = randomBytes(4).toString('hex');
  return { match, scope: 'all_repos', mode: 'block', reason: `Test entry ${name} (${token}) holds this call.`, next_step: `Leave ${name} (${token}) alone; this is a test.`, fail_closed: false };
}
export const bash = (command: string): Call => ({ tool_name: 'Bash', tool_input: { command } });
/** Writes `{v: 1, entries, proofs}` to a temp folder and returns its path. */
export function guardFile(entries: Record<string, Line>, proofs: Record<string, Line>): string {
  const path = join(tempDir(), 'guards.json');
  writeFileSync(path, `${JSON.stringify({ v: 1, entries, proofs }, null, 2)}\n`);
  return path;
}
/** `deep guard add <file>`, as you run it in your own terminal, against the hub at the home's address. */
export const guardAdd = (h: Home, file: string): Promise<Ran> => deep(h, ['guard', 'add', file], 180_000);

// ---- Hooks, shaped like Claude Code's PreToolUse payloads.
const session = randomUUID();
/** A PreToolUse payload for `call` in the home's work folder; its tool_use_id is `id`. */
export function payload(h: Home, call: Call): { id: string; body: Line } {
  const id = `toolu_${randomBytes(12).toString('hex')}`;
  const transcript = join(h.home, '.claude', 'projects', 'w', `${session}.jsonl`);
  if (!existsSync(transcript)) { mkdirSync(dirname(transcript), { recursive: true }); writeFileSync(transcript, ''); }
  return { id, body: { session_id: session, transcript_path: transcript, cwd: call.cwd ?? h.work, hook_event_name: 'PreToolUse', permission_mode: 'default', tool_name: call.tool_name, tool_input: call.tool_input, tool_use_id: id } };
}
/** deep-hook as a hook entry runs it: `deep-hook claude-code PreToolUse`, the payload on stdin, HOME the agent's. */
export async function hook(binary: string, h: Home, call: Call): Promise<Ran & { id: string }> {
  const { id, body } = payload(h, call);
  const r = await run(binary, ['claude-code', 'PreToolUse'], { cwd: h.work, env: childEnv(h), input: JSON.stringify(body), timeoutMs: 60_000 });
  if (r.timedOut) throw Error(`INCONCLUSIVE: the PreToolUse hook was killed at 60 s (the machine may be loaded): ${shown(r)}`);
  return { ...r, id };
}
/** What deep-hook's output tells Claude Code about a PreToolUse: exit 2 or a deny decision denies; exit 0 with neither allows. */
export function decision(r: Ran): 'deny' | 'allow' | 'other' {
  const out = parseObject(r.stdout.trim());
  const said: unknown = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 || said === 'deny' || said === 'block') return 'deny';
  if (r.code === 0 && (said === undefined || said === 'allow')) return 'allow';
  return 'other';
}
/** The home's spool lines by the call's tool_use_id: what deep-hook sent, or would have sent, the hub. */
export function spooled(h: Home): Map<string, Line> {
  const out = new Map<string, Line>();
  const dir = join(h.root, 'spool');
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.jsonl'))) {
    for (const line of readFileSync(join(dir, name), 'utf8').split('\n')) {
      const value = parseObject(line);
      const id: unknown = value?.payload?.tool_use_id;
      if (value && typeof id === 'string') out.set(id, value);
    }
  }
  return out;
}

/**
 * How deep-hook matched each named call in the home with no hub answering: its decision and the guard entries it
 * matched, read from the line it spooled (`matched`, as it would have sent the hub). A call whose line the machine
 * gave no time to spool is made again, 5 times, then INCONCLUSIVE.
 */
export interface Matched { decision: string; matched: string[] }
export async function matchAll(binary: string, h: Home, calls: readonly Named[]): Promise<Map<string, Matched>> {
  const out = new Map<string, Matched>();
  for (const c of calls) {
    for (let tries = 0; ; tries++) {
      const r = await hook(binary, h, c.call);
      const line = spooled(h).get(r.id);
      if (line) {
        out.set(c.label, { decision: decision(r), matched: (Array.isArray(line.matched) ? (line.matched as string[]) : []).slice().sort() });
        break;
      }
      if (tries >= 4) throw Error(`INCONCLUSIVE: deep-hook (${binary}) spooled no line for ${c.label} in 5 tries (the machine may be loaded): ${shown(r)}`);
    }
  }
  return out;
}
/** The named calls whose decision or matched entries differ between two readings, each with both. */
export function differences(want: Map<string, Matched>, got: Map<string, Matched>): string[] {
  return [...want.keys()].filter((k) => canonical(want.get(k)) !== canonical(got.get(k))).map((k) => `${k}: ${JSON.stringify(got.get(k))}, where the merge base's deep-hook gives ${JSON.stringify(want.get(k))}`);
}

// ---- The record, read back through the hub's socket as the CLI reads it (the cli role, with the control token).
function control(hub: Hub, method: string, params: Line, timeoutMs = 30_000): Promise<Line> {
  const token = readFileSync(join(hub.home.root, 'control.token'), 'utf8').trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(hub.socket);
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`INCONCLUSIVE: no reply to ${method} within ${timeoutMs} ms`)); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (error) => { clearTimeout(timer); reject(Error(`BLOCKED: the hub's socket: ${error.message}`)); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = parseObject(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (step === 0) {
          step = 1;
          sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`);
        } else if (step === 1 && line?.role !== undefined) {
          step = 2;
          sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`);
        } else if (step === 2 && line?.id === 1) {
          clearTimeout(timer);
          sock.destroy();
          if (line.error) reject(Error(`BLOCKED: ${method} refused: ${JSON.stringify(line.error)}`));
          else resolve(line.result as Line);
        }
      }
    });
  });
}
/** The calls (tool_use_ids) the record holds a tool.before for. */
export async function recordedCalls(hub: Hub): Promise<Set<string>> {
  const out = new Set<string>();
  let after = 0;
  for (;;) {
    const events = (await control(hub, 'events.read', { after, limit: 1000 })).events as { kind: string; log_pos: number; data: Line }[];
    if (!events.length) return out;
    for (const e of events) if (e.kind === 'tool.before' && typeof e.data.call === 'string') out.add(e.data.call);
    after = events[events.length - 1]!.log_pos;
  }
}

// ---- Counting opens of a file: it is made a FIFO, and the test opens its write end whenever a reader waits on it.
/**
 * Puts a FIFO at `path` (a file there is moved aside to `<path>.aside`) and counts each open of it for reading: a
 * reader's open blocks until a writer opens, and the test's non-blocking open of the write end succeeds only then.
 * `stop()` puts the file back and gives the number of opens seen.
 */
export function countOpens(path: string): { stop(): Promise<number> } {
  const aside = `${path}.aside`;
  const had = existsSync(path);
  if (had) execFileSync('mv', [path, aside]);
  execFileSync('mkfifo', ['-m', '600', path]);
  let stopped = false;
  let count = 0;
  const loop = (async () => {
    while (!stopped) {
      let fd: number | undefined;
      try {
        fd = openSync(path, constants.O_WRONLY | constants.O_NONBLOCK);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENXIO') throw error;
      }
      if (fd === undefined) { await sleep(1); continue; }
      count++;
      closeSync(fd);
      // The reader reads end of file once the write end closes; give it time to close before the next try.
      await sleep(20);
    }
  })();
  return {
    async stop() {
      stopped = true;
      await loop;
      rmSync(path, { force: true });
      if (had) execFileSync('mv', [aside, path]);
      return count;
    },
  };
}

// ---- Instructions retired, by /usr/bin/time -l (macOS): the hook's own process.
/** One PreToolUse run under /usr/bin/time -l, and the instructions it retired; null where none was reported. */
export async function countedHook(binary: string, h: Home, call: Call): Promise<{ instructions: number | null; ran: Ran; id: string }> {
  const { id, body } = payload(h, call);
  const report = join(h.tmp, `time-${id}`);
  const ran = await run('/usr/bin/time', ['-l', '-o', report, binary, 'claude-code', 'PreToolUse'], { cwd: h.work, env: childEnv(h), input: JSON.stringify(body), timeoutMs: 60_000 });
  if (ran.timedOut) throw Error(`INCONCLUSIVE: the PreToolUse hook was killed at 60 s (the machine may be loaded): ${shown(ran)}`);
  const text = existsSync(report) ? readFileSync(report, 'utf8') : '';
  rmSync(report, { force: true });
  const value = Number(/^\s*(\d+)\s+instructions retired\s*$/m.exec(text)?.[1]);
  return { instructions: Number.isSafeInteger(value) && value > 0 ? value : null, ran, id };
}
export const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

/**
 * A second home for the merge base's side, beside a set-up one: the set-up home's top-level files copied (config,
 * setup-finished, generations: what deep-hook reads), rules.json as the merge base has it (the proofs in it) and no
 * proofs' file, and both homes' config.json naming the set-up home's hub by `hub.address`, so the same hub answers
 * both and only the rules files differ.
 */
export function baseSideOf(hub: Hub): Home {
  const c = hub.home;
  const b = makeHome();
  mkdirSync(b.root, { recursive: true, mode: 0o700 });
  for (const name of readdirSync(c.root)) {
    const from = join(c.root, name);
    if (name === 'rules.json' || name === PROOFS || !statSync(from).isFile()) continue;
    copyFileSync(from, join(b.root, name));
  }
  const rules = readJson(rulesPath(c));
  if (!rules) throw Error(`BLOCKED: the set-up home's rules.json isn't JSON`);
  writeFileSync(rulesPath(b), `${JSON.stringify(isObj(rules.proofs) ? rules : { ...rules, proofs: baseProofs() }, null, 2)}\n`, { mode: 0o600 });
  for (const h of [c, b]) {
    const config = readJson(join(h.root, 'config.json')) ?? {};
    config.hub = { ...(isObj(config.hub) ? config.hub : {}), address: `unix:${hub.socket}` };
    writeFileSync(join(h.root, 'config.json'), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  }
  return b;
}

// ---- deep doctor.
/** `deep doctor --json`'s items, one object a line. */
export async function doctorItems(h: Home): Promise<{ items: Line[]; ran: Ran }> {
  const ran = await deep(h, ['doctor', '--json'], 300_000);
  if (ran.timedOut) throw Error(`INCONCLUSIVE: deep doctor was killed at 300 s: ${shown(ran)}`);
  const items = ran.stdout.split('\n').map(parseObject).filter((v): v is Line => v !== undefined);
  if (!items.length) throw Error(`BLOCKED: deep doctor --json printed no item: ${shown(ran)}`);
  return { items, ran };
}
