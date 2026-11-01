// Shared test-side tools for issue #39 (README). Temp homes with stand-ins for launchctl, systemctl and codex, or the real
// codex first on PATH; `deep setup` and the hub as processes; Codex's hooks run as Codex runs them (`deep-hook codex
// <event>`), every session's identity from its payload; one stand-in "daemon" process that is the parent of every thread's
// hooks and of one `deep mcp`, as Codex's shared app-server is; Codex's own hook list over `codex app-server`. Parts are
// adapted from tests/acceptance/120/helpers.ts and tests/acceptance/18/binding (same repo, same license); this suite keeps
// its own copy so a redraft of theirs never moves these tests. Nothing here stands in for DeepBuild.
import { expect } from 'vitest';
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const HOOK = join(REPO, 'target/debug/deep-hook');
// A fresh checkout has no target/: built at load, so HOOK stays a plain path. Cargo's lock serializes files loading this together.
if (!existsSync(HOOK)) {
  const built = spawnSync('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { cwd: REPO, encoding: 'utf8', timeout: 900_000 });
  if (built.status !== 0 || !existsSync(HOOK)) throw Error(`BLOCKED: cargo build --locked -q -p deep-hook failed: ${built.error?.message ?? built.stderr.slice(-3000)}`);
}
export const NODE = process.execPath;
export const MINUTE = 60_000;
export const STOP_TIMEOUT_S = 45 * 60;
export const FACTS = JSON.parse(readFileSync(join(REPO, 'adapters/codex.facts.json'), 'utf8')) as { versions: string[] };
export const COVERED = '0.160.0';
export const PAST_FACTS = '99.0.0';
/** The value `codex login status` prints in the stand-in: never reaches any output or file (AC9). */
export const LOGIN_SECRET = 'sk-proj-dh39FAKEprintedbylogin0000000000';

// The criteria, by their number in the issue's order and their ID (sha256 of the criterion's text; README lists each).
export const AC = {
  1: 'AC1 #39.2b854223', 2: 'AC2 #39.0215da31', 3: 'AC3 #39.a929786c', 4: 'AC4 #39.3506d285', 5: 'AC5 #39.de9f23ce', 6: 'AC6 #39.edfd0196', 7: 'AC7 #39.2bf95483', 8: 'AC8 #39.9d535982', 9: 'AC9 #39.410c1db7', 10: 'AC10 #39.1f0c31eb',
  11: 'AC11 #39.d4d2fa79', 12: 'AC12 #39.071692b0', 13: 'AC13 #39.3c135e58', 14: 'AC14 #39.c819bb37', 15: 'AC15 #39.b01d8471', 16: 'AC16 #39.3f1db111', 17: 'AC17 #39.41993b5c', 18: 'AC18 #39.ef0348e3', 19: 'AC19 #39.52f53113', 20: 'AC20 #39.977fabab',
  21: 'AC21 #39.f8985208', 22: 'AC22 #39.b7839f18', 23: 'AC23 #39.7ff25607', 24: 'AC24 #39.21dbcb3f', 25: 'AC25 #39.5981bf3b', 26: 'AC26 #39.8807ac2c', 27: 'AC27 #39.7db15b99', 28: 'AC28 #39.1d214ff1', 29: 'AC29 #39.dbdbda4f', 30: 'AC30 #39.43c7dc1e',
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const tag = (n = 4) => randomBytes(n).toString('hex');
export const parseObject = (raw: string): Line | undefined => {
  try { const v: unknown = JSON.parse(raw); return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Line) : undefined; } catch { return undefined; }
};

for (const key of Object.keys(process.env)) if (key.startsWith('DEEP_') || key.startsWith('CLAUDE')) delete process.env[key];

// ---- Temp folders under /tmp/dh39-*: a socket path must fit in 104 bytes. Processes stopped by PID only.
const made: string[] = [];
const owned = new Set<number>();
export function tempDir(): string { const d = realpathSync(mkdtempSync('/tmp/dh39-')); made.push(d); return d; }
export const own = (pid: number | undefined): void => { if (pid) owned.add(pid); };
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch { return false; }
  try { return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })); } catch { return false; }
}
export async function cleanup(): Promise<void> {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const end = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < end) await sleep(50);
  for (const pid of owned) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
}

/** `<tmp>/h` is HOME for every process; `<tmp>/bin` first on PATH. */
export interface Home { tmp: string; home: string; bin: string; codexHome: string; hooksFile: string; configToml: string; root: string; codexLog: string }
/** `real`: the codex on PATH is the machine's real one (AC12, AC14, AC24), run only against this scratch home. */
export function makeHome(o: { real?: boolean; version?: string; loginExit?: number } = {}): Home {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  const codexHome = join(home, '.codex');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(codexHome, 'sessions'), { recursive: true });
  mkdirSync(bin);
  const stub = (name: string, body: string) => { writeFileSync(join(bin, name), body); chmodSync(join(bin, name), 0o755); };
  for (const n of ['launchctl', 'systemctl', 'claude']) stub(n, '#!/bin/sh\nexit 0\n');
  const codexLog = join(tmp, 'codex-calls.log');
  if (o.real) stub('codex', `#!/bin/sh\nexec '${realCodex()}' "$@"\n`);
  else {
    copyFileSync(join(FIXTURES, 'fake-codex.pl'), join(bin, 'codex'));
    chmodSync(join(bin, 'codex'), 0o755);
    writeFileSync(join(bin, 'fake-codex.json'), JSON.stringify({ version: o.version ?? COVERED, loginExit: o.loginExit ?? 0, secret: LOGIN_SECRET, log: codexLog }));
  }
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  const root = join(home, '.deepbuild');
  return { tmp, home, bin, codexHome, hooksFile: join(codexHome, 'hooks.json'), configToml: join(codexHome, 'config.toml'), root, codexLog };
}
/** The real codex this machine has (0.160.0 on the reference Mac), found on the PATH the suite started with. */
export function realCodex(): string {
  const dirs = [...(process.env.PATH ?? '').split(':'), `${process.env.HOME}/.nvm/versions/node/v22.22.1/bin`, '/usr/local/bin', '/opt/homebrew/bin'];
  const found = dirs.map((d) => join(d, 'codex')).find((p) => existsSync(p));
  if (!found) throw Error('BLOCKED: this test feeds replies to Codex\'s own hook engine, and no codex is on PATH');
  return found;
}
export function childEnv(h: Home, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(DEEP_|CLAUDE|XDG_|OPENAI_|CODEX_|ANTHROPIC_|GH_|GITHUB_)/.test(k) && k !== 'NODE_OPTIONS') env[k] = v;
  Object.assign(env, { HOME: h.home, XDG_CONFIG_HOME: join(h.home, '.config'), XDG_CACHE_HOME: join(h.home, '.cache'), SHELL: '/bin/sh', LC_ALL: 'C', PATH: `${h.bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`, DEEP_HUB_TEST_CONFIRM: join(h.tmp, 'confirm') });
  for (const [k, v] of Object.entries(extra)) { if (v === undefined) delete env[k]; else env[k] = v; }
  return env;
}
export interface Ran { code: number | null; stdout: string; stderr: string; ms: number }
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs ?? 120_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, ms: performance.now() - t0 }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code}, stdout ${JSON.stringify(r.stdout.slice(-1200))}, stderr ${JSON.stringify(r.stderr.slice(-800))}`;
export const deep = (h: Home, args: readonly string[], env: Record<string, string | undefined> = {}, timeoutMs = 180_000): Promise<Ran> => run(NODE, [CLI, ...args], { env: childEnv(h, env), timeoutMs });
export const doctor = async (h: Home): Promise<Ran> => deep(h, ['doctor', '--json']);
export function editConfig(h: Home, edit: (c: Line) => void): void {
  mkdirSync(h.root, { recursive: true });
  const file = join(h.root, 'config.json');
  const c = existsSync(file) ? (parseObject(readFileSync(file, 'utf8')) ?? {}) : {};
  edit(c);
  writeFileSync(file, `${JSON.stringify(c, null, 2)}\n`);
}
/** The slow lane's expected time, your setting (README: Assumed surfaces). */
export const slowLane = (h: Home, ms: number) => editConfig(h, (c) => { c.lanes = { ...(c.lanes ?? {}), slow: { expected_ms: ms } }; });

// ---- ~/.codex/hooks.json.
export interface Entry { event: string; group: number; index: number; matcher: unknown; hook: Line }
export const isDeepBuild = (command: unknown): boolean => typeof command === 'string' && (/deep-hook/.test(command) || /(^|[\s/'"])deep(\s|$)/.test(command));
export function hookEntries(file: string): Entry[] {
  const hooks = (parseObject(readFileSync(file, 'utf8'))?.hooks ?? {}) as Record<string, Line[]>;
  return Object.entries(hooks).flatMap(([event, groups]) => groups.flatMap((g, group) => (g.hooks as Line[]).map((hook, index) => ({ event, group, index, matcher: g.matcher ?? null, hook }))));
}
export const ourEntries = (h: Home): Entry[] => (existsSync(h.hooksFile) ? hookEntries(h.hooksFile).filter((e) => isDeepBuild(e.hook.command)) : []);
export const stopEntry = (h: Home): Entry | undefined => ourEntries(h).find((e) => e.event === 'Stop');
export function editStopTimeout(h: Home, seconds: number): void {
  const v = parseObject(readFileSync(h.hooksFile, 'utf8'))!;
  for (const g of v.hooks.Stop as Line[]) for (const hook of g.hooks as Line[]) if (isDeepBuild(hook.command)) hook.timeout = seconds;
  writeFileSync(h.hooksFile, JSON.stringify(v, null, 2));
}

// ---- Codex's own hook list and trust (the real binary, app-server's hooks/list), in this scratch home only.
export interface Listed { key: string; eventName: string; command: string; timeoutSec: number; matcher: string | null; currentHash: string; trustStatus: string; enabled: boolean }
export function hooksList(h: Home, cwd = h.tmp): Promise<Listed[]> {
  return new Promise((resolve, reject) => {
    const c = spawn(join(h.bin, 'codex'), ['app-server'], { env: childEnv(h, { CODEX_HOME: h.codexHome }), stdio: ['pipe', 'pipe', 'ignore'] });
    own(c.pid);
    let out = '';
    const timer = setTimeout(() => { c.kill(); reject(Error(`BLOCKED: codex app-server gave no hooks/list reply: ${out.slice(0, 500)}`)); }, 30_000);
    c.stdout.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      if (out.includes('"id":1,') && !c.killed && !out.includes('"id":2,') && !out.includes('sent')) { out += 'sent'; c.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n${JSON.stringify({ id: 2, method: 'hooks/list', params: { cwds: [cwd] } })}\n`); }
      const line = out.split('\n').map((l) => parseObject(l.replace(/^sent/, ''))).find((l) => l?.id === 2);
      if (line) { clearTimeout(timer); c.kill(); resolve((line.result.data as Line[]).flatMap((d2) => d2.hooks as Listed[])); }
    });
    c.stdin.write(`${JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 'dh39', version: '0' }, capabilities: { experimentalApi: true } } })}\n`);
  });
}
/** You approve each listed hook once in `/hooks`: what that writes, `[hooks.state."<key>"] trusted_hash`, in this scratch home's config. */
export async function trustAll(h: Home): Promise<Listed[]> {
  const listed = await hooksList(h);
  const toml = listed.map((l) => `[hooks.state.${JSON.stringify(l.key)}]\ntrusted_hash = ${JSON.stringify(l.currentHash)}\n`).join('\n');
  writeFileSync(h.configToml, `${existsSync(h.configToml) ? readFileSync(h.configToml, 'utf8') : ''}\n${toml}`);
  return hooksList(h);
}

// ---- The hub.
export interface Hub { pid: number; h: Home; socket: string; root: string; child: ChildProcess; clock: number | undefined; output(): string }
export async function startHub(h: Home, o: { clock?: number; env?: Record<string, string> } = {}): Promise<Hub> {
  const env = childEnv(h, { DEEP_HUB_TEST_CLOCK: o.clock === undefined ? undefined : String(Math.round(o.clock)), DEEP_HUB_TEST_DRAFTS: existsSync(join(h.tmp, 'drafts.json')) ? join(h.tmp, 'drafts.json') : undefined, ...(o.env ?? {}) });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (out += d));
  const ready = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 120_000);
    let first = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => { out += d; first += d; if (first.includes('\n')) { clearTimeout(timer); resolve(parseObject(first.split('\n')[0]!)?.ready === true); } });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  if (!ready) throw Error(`BLOCKED: the hub didn't start: ${out.slice(0, 1500)}`);
  return { pid: child.pid!, h, socket: join(h.root, 'hub.sock'), root: h.root, child, clock: o.clock, output: () => out };
}
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const end = Date.now() + 30_000;
  while (alive(hub.pid) && Date.now() < end) await sleep(50);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
}
export async function moveOn(hub: Hub, ms: number): Promise<Hub> {
  await stopHub(hub);
  return startHub(hub.h, { clock: Math.max(hub.clock ?? 0, Date.now()) + ms });
}
/** A hub with `deep setup` run. Setup at the base exits 0 and writes Claude Code's settings only. */
export async function hubWithSetup(h: Home, o: { clock?: number } = {}): Promise<Hub> {
  const hub = await startHub(h, o);
  const r = await deep(h, ['setup']);
  if (r.code !== 0) throw Error(`BLOCKED: deep setup must exit 0: ${shown(r)}`);
  return hub;
}

/** One `cli` control call over the line protocol (#16). */
export function control(hub: Hub, method: string, params: Line = {}, timeoutMs = 30_000): Promise<Line> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(hub.socket);
    let buffer = ''; let stage = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`no reply to ${method}`)); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = parseObject(buffer.slice(0, i)) ?? {};
        buffer = buffer.slice(i + 1);
        if (stage === 0) { stage = 1; sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token: readFileSync(join(hub.root, 'control.token'), 'utf8').trim() })}\n`); }
        else if (stage === 1) { stage = 2; sock.write(`${JSON.stringify({ v: 1, id: 'c1', method, params })}\n`); }
        else if (line.id === 'c1') { clearTimeout(timer); sock.destroy(); if ('error' in line) reject(Error(`${method} refused: ${JSON.stringify(line.error)}`)); else resolve(line.result as Line); }
      }
    });
  });
}
export interface Ev { id: string; kind: string; log_pos: number; ts: number; writer: string; subject?: string; session?: string; verified?: boolean; data: Line }
export async function allEvents(hub: Hub): Promise<Ev[]> {
  const out: Ev[] = [];
  for (let from = 0; ;) {
    const r = await control(hub, 'events.read', { from, limit: 1000 }).catch(async () => control(hub, 'events.read', { after: from, limit: 1000 }));
    const page = (r.events ?? []) as Ev[];
    out.push(...page);
    if (page.length < 1000) return out;
    from = page.at(-1)!.log_pos;
  }
}
export const ofSession = (events: readonly Ev[], s: string, kind?: string) => events.filter((e) => e.session === s && (kind === undefined || e.kind === kind));
export const statusRows = async (hub: Hub): Promise<Line[]> => (await control(hub, 'status.read')).rows as Line[];
export const rowOf = async (hub: Hub, id: string): Promise<Line | undefined> => (await statusRows(hub)).find((r) => r.id === id);
export async function waitFor<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, timeoutMs: number, what: string): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > end) expect.fail(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(200);
  }
}

// ---- A Codex thread: every hook carries the payload's session_id, cwd and transcript_path; nothing else names it.
export interface Thread { id: string; cwd: string; transcript: string; turn: string; version: string }
export function newThread(h: Home, o: { cwd?: string; version?: string } = {}): Thread {
  const id = randomUUID();
  const cwd = o.cwd ?? join(h.tmp, `w${tag(3)}`);
  mkdirSync(cwd, { recursive: true });
  const transcript = join(h.codexHome, 'sessions', `rollout-${id}.jsonl`);
  const version = o.version ?? COVERED;
  writeFileSync(transcript, `${JSON.stringify({ type: 'session_meta', payload: { id, cwd, cli_version: version, originator: 'codex_cli_rs' } })}\n`);
  return { id, cwd, transcript, turn: randomUUID(), version };
}
export function payload(t: Thread, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: t.id, transcript_path: t.transcript, cwd: t.cwd, hook_event_name: event, model: 'gpt-reserve', permission_mode: 'default' };
  if (event === 'SessionStart') base.source = 'startup'; else if (event !== 'SessionEnd') base.turn_id = t.turn;
  if (event === 'Stop') Object.assign(base, { stop_hook_active: false, last_assistant_message: 'Done.' });
  return { ...base, ...extra };
}
export interface HookRun { ran: Ran; reply: Line | undefined }
/** `deep-hook codex <event>`, the hook's JSON on stdin, the hub's reply on stdout, as Codex runs an entry. */
export async function codexHook(h: Home, t: Thread, event: string, extra: Line = {}, timeoutMs = 90_000): Promise<HookRun> {
  const ran = await run(HOOK, ['codex', event], { cwd: t.cwd, env: childEnv(h), input: JSON.stringify(payload(t, event, extra)), timeoutMs });
  return { ran, reply: parseObject(ran.stdout.trim()) };
}
export const hookShown = (r: HookRun) => shown(r.ran);
export async function begin(h: Home, t: Thread, prompt = 'Fix the cart total, then stop.'): Promise<void> {
  t.turn = randomUUID();
  await codexHook(h, t, 'SessionStart');
  await codexHook(h, t, 'UserPromptSubmit', { prompt });
}
export const bash = (command: string): Line => ({ command });
export async function call(h: Home, t: Thread, command: string, during?: () => void): Promise<string> {
  const id = `call_${tag(6)}`;
  await codexHook(h, t, 'PreToolUse', { tool_name: 'Bash', tool_input: bash(command), tool_use_id: id });
  during?.();
  await codexHook(h, t, 'PostToolUse', { tool_name: 'Bash', tool_input: bash(command), tool_use_id: id, tool_response: { stdout: 'ok', stderr: '', exit_code: 0 } });
  return id;
}
/** A patch applied in a turn: the file written, as the apply_patch hook pair names it. */
export async function patch(h: Home, t: Thread, file: string, body: string): Promise<void> {
  const id = `call_${tag(6)}`;
  const input = { command: `*** Begin Patch\n*** Add File: ${file}\n+${body}\n*** End Patch\n` };
  await codexHook(h, t, 'PreToolUse', { tool_name: 'apply_patch', tool_input: input, tool_use_id: id });
  writeFileSync(join(t.cwd, file), `${body}\n`);
  await codexHook(h, t, 'PostToolUse', { tool_name: 'apply_patch', tool_input: input, tool_use_id: id, tool_response: 'Success.' });
}
export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: { PATH: '/usr/bin:/bin:/usr/local/bin', HOME: cwd, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' } }).trim();
}

// ---- A repo with one slow check on the task a typed prompt opens (README: Assumed surfaces: expected_ms, deadline_ms).
export const SLOW_ASK = 'Make the cart total include tax.';
export function slowRepo(h: Home, o: { expected_ms: number; deadline_ms: number; sleepS: number; exit?: number }): string {
  const repo = join(h.tmp, 'repo');
  mkdirSync(join(repo, '.deepbuild', 'checks'), { recursive: true });
  writeFileSync(join(repo, 'cart.txt'), 'total\n');
  writeFileSync(join(repo, '.deepbuild/checks/slow.sh'), `#!/bin/sh\nsleep ${o.sleepS}\nexit ${o.exit ?? 1}\n`, { mode: 0o755 });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  const requirement = { id: 'R1', text: 'the total includes tax', source_line: 'ask#L1', refuted_by: 'a total without tax', check: '.deepbuild/checks/slow.sh', on_base: 'fails', asserts: [], depth: 'journey', oracle: 'code', near_misses: [], expected_ms: o.expected_ms, deadline_ms: o.deadline_ms };
  writeFileSync(join(h.tmp, 'drafts.json'), JSON.stringify({ drafts: [{ ask: SLOW_ASK, requirements: [requirement], deliverables: ['cart.txt'], budget: null }] }));
  editConfig(h, (c) => { c.asks = { deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' }, default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' }, fallback: ['change-owner'], fold: 5 }; });
  return realpathSync(repo);
}
export const runEvents = (events: readonly Ev[]) => events.filter((e) => e.kind.startsWith('run.') || e.kind === 'run.scheduled');
export const finished = (events: readonly Ev[]) => events.filter((e) => e.kind === 'run.finished');
/** A slow-lane run in the record: the runner names its lane on it. */
export const inSlowLane = (events: readonly Ev[]) => events.some((e) => e.kind.startsWith('run.') && e.data?.lane === 'slow');

// ---- One daemon: the parent of every thread's hooks and of one `deep mcp`.
const NEXT = { n: 0 };
export class Daemon {
  private waiting = new Map<number, (l: Line) => void>();
  private ids = 0;
  private constructor(private readonly child: ChildProcess) {
    let buffer = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      buffer += d;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) { const l = parseObject(buffer.slice(0, i)); buffer = buffer.slice(i + 1); if (l && typeof l.n === 'number') this.waiting.get(l.n)?.(l); }
    });
  }
  static start(h: Home, cwd: string): Daemon { const c = spawn(NODE, [join(FIXTURES, 'daemon.mjs')], { cwd, env: childEnv(h), stdio: ['pipe', 'pipe', 'inherit'] }); own(c.pid); return new Daemon(c); }
  private send(cmd: Line, timeoutMs = 150_000): Promise<Line> {
    const n = ++NEXT.n;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(`the daemon stand-in gave no answer to ${cmd.op}`)), timeoutMs);
      this.waiting.set(n, (l) => { clearTimeout(timer); if (l.failed) reject(Error(l.failed)); else resolve(l); });
      this.child.stdin!.write(`${JSON.stringify({ n, ...cmd })}\n`);
    });
  }
  async hook(t: Thread, event: string, extra: Line = {}): Promise<HookRun> {
    const l = await this.send({ op: 'hook', binary: HOOK, event, payload: payload(t, event, extra), cwd: t.cwd });
    return { ran: { code: l.code as number, stdout: l.stdout as string, stderr: l.stderr as string, ms: 0 }, reply: parseObject(String(l.stdout).trim()) };
  }
  /** A turn's first hooks, from the process the thread's deep mcp shares, as in a real Codex. */
  async begin(t: Thread, prompt = 'Pick a colour.'): Promise<void> { t.turn = randomUUID(); await this.hook(t, 'SessionStart'); await this.hook(t, 'UserPromptSubmit', { prompt }); }
  async mcp(method: string, params: Line, timeoutMs = 120_000): Promise<Line> {
    const line = { jsonrpc: '2.0', id: ++this.ids, method, params };
    const l = await this.send({ op: 'mcp', argv: [NODE, CLI, 'mcp'], line, timeoutMs }, timeoutMs + 5000);
    own(l.pid as number);
    return l.reply as Line;
  }
  async init(): Promise<void> {
    await this.mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codex', version: COVERED } });
    await this.send({ op: 'mcp', argv: [NODE, CLI, 'mcp'], line: { jsonrpc: '2.0', method: 'notifications/initialized', params: {} } });
  }
  /** The PreToolUse Codex fires for `mcp__deep__deep_ask`, then the call on the one `deep mcp`. */
  async ask(t: Thread, args: Line, timeoutMs = 120_000): Promise<{ reply: Line; ms: number }> {
    await this.hook(t, 'PreToolUse', { tool_name: 'mcp__deep__deep_ask', tool_input: args, tool_use_id: `call_${tag(6)}` });
    const t0 = performance.now();
    const reply = await this.mcp('tools/call', { name: 'deep_ask', arguments: args }, timeoutMs);
    return { reply, ms: performance.now() - t0 };
  }
  stop(): void { try { this.child.stdin!.write(`${JSON.stringify({ n: 0, op: 'exit' })}\n`); } catch { /* gone */ } }
}
export const choice = (question: string) => ({ kind: 'choice', question, options: [{ id: 'blue', label: 'Blue header' }, { id: 'green', label: 'Green header' }], recommended: 'blue' });
export const asksOf = (events: readonly Ev[], question: string) => events.filter((e) => e.kind === 'ask.created' && e.data?.question === question);
export async function answer(h: Home, handle: string, option: string): Promise<Ran> {
  const r = await deep(h, ['inbox', 'answer', handle, option]);
  if (r.code !== 0) throw Error(`BLOCKED: deep inbox answer ${handle} ${option} must exit 0: ${shown(r)}`);
  return r;
}
