import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { cpus, loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, expect, type TestContext } from 'vitest';
import { parseCsv, spoil, type Edit, type Plan } from './fixtures/planted/spoil.mjs';

export { parseCsv, spoil, type Edit, type Plan };

export type Line = { [key: string]: any };
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
const HERE = fileURLToPath(new URL('./', import.meta.url));
const FIXTURES = join(HERE, 'fixtures');

export const TIMEOUT = 3_600_000;

export const AC = {
  1: 'AC1 #3569.a88c0771', 2: 'AC2 #3569.22f062d8', 3: 'AC3 #3569.9a78233f', 4: 'AC4 #3569.becbb065', 5: 'AC5 #3569.5963e451',
  6: 'AC6 #3569.eb306d67', 7: 'AC7 #3569.f14e11fa', 8: 'AC8 #3569.d0a835ea', 9: 'AC9 #3569.070ae844', 10: 'AC10 #3569.1d1485e8',
} as const;

export const KIND = 'table.derive';
export const CHECK = 'data.derived';
export const PLUGIN = join(REPO, 'packages', 'jobs', 'asset-tools');

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export const show = (v: unknown, most = 900): string => (JSON.stringify(v) ?? 'undefined').slice(0, most);
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const first = (text: string): string => text.split('\n')[0] ?? '';
export const isObject = (v: unknown): v is Line => typeof v === 'object' && v !== null && !Array.isArray(v);
const parse = (text: string): Line | undefined => { try { const v: unknown = JSON.parse(text); return isObject(v) ? v : undefined; } catch { return undefined; } };

export const fixture = (name: string): Buffer => readFileSync(join(FIXTURES, name));

const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh3569-'));
  made.push(dir);
  return dir;
}
const owned = new Set<number>();
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
afterAll(async () => {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch {  }
  const deadline = Date.now() + 5000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch {  }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}, 60_000);

function childEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|GH_|GITHUB_|AI_AGENT)/.test(key) || key === 'NODE_OPTIONS' || key === 'NODE_EXTRA_CA_CERTS') continue;
    env[key] = value;
  }
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C', ...extra };
}
export interface Ran { code: number | null; stdout: string; stderr: string }
export const shown = (r: Ran) => `exit ${r.code}, stdout ${JSON.stringify(r.stdout.slice(-1500))}, stderr ${JSON.stringify(r.stderr.slice(-1500))}`;

function runProgram(cmd: string, args: readonly string[], o: { cwd: string; env: NodeJS.ProcessEnv; input?: string; timeoutMs?: number }): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: o.cwd, env: o.env, stdio: [o.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    if (child.pid) owned.add(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (stderr = (stderr + d).slice(-200_000)));
    const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs ?? TIMEOUT);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}${error.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); if (child.pid) owned.delete(child.pid); resolve({ code, stdout, stderr }); });
    if (o.input !== undefined) { child.stdin!.on('error', () => undefined); child.stdin!.end(o.input); }
  });
}

const built = new Map<string, Promise<string>>();
const targetDir = (): string => process.env.CARGO_TARGET_DIR ?? join(REPO, 'target');

export async function binary(bin: 'deep-show' | 'deep-canvas-render' | 'deep-hook'): Promise<{ path: string } | string> {
  if (!built.has(bin)) {
    const pick = bin === 'deep-hook' ? ['-p', 'deep-hook'] : ['--bin', bin];
    built.set(bin, runProgram(NODE, [join(REPO, 'scripts/throttle.mjs'), 'build', '--wait', '1440', '--', join(REPO, 'scripts/lease'), 'cargo', 'build', '--locked', ...pick], {
      cwd: REPO,
      env: { ...process.env, PATH: `/opt/homebrew/opt/rustup/bin:${process.env.PATH ?? '/usr/bin:/bin'}`, CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG ?? '0', DEEP_LEASE_WAIT: '1440' },
      timeoutMs: 1440 * 60_000,
    }).then((r) => (r.code === 0 ? '' : `BLOCKED: cargo build --locked ${pick.join(' ')} (through scripts/throttle.mjs build) exits ${String(r.code)}: ${r.stderr.split('\n').filter((l) => !/Compiling|Blocking|Finished|Downloaded|Downloading|Updating/.test(l)).join('\n').slice(-2500)}; this is not a pass`)));
  }
  const error = await built.get(bin)!;
  if (error) return error;
  const path = join(targetDir(), 'debug', bin);
  return existsSync(path) ? { path } : `BLOCKED: cargo built ${bin} and ${path} isn't there; this is not a pass`;
}

interface HubProcess { pid: number; socket: string; root: string; child: ChildProcess }
async function startHub(home: string, env: Record<string, string>): Promise<HubProcess> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home, env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  if (child.pid) owned.add(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err = (err + d).slice(-8000)));
  const ready = await new Promise<Line | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 300_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      if (out.includes('\n')) { clearTimeout(timer); resolve(parse(out.split('\n')[0]!)); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(undefined); });
  });
  if (ready?.ready !== true) {
    try { if (child.pid) process.kill(child.pid, 'SIGKILL'); } catch {  }
    throw Error(`BLOCKED: the hub didn't start (deep hub run): ${out.slice(0, 500)} ${err.slice(-1500)}`);
  }
  return { pid: child.pid!, socket: typeof ready.socket === 'string' ? ready.socket : join(home, '.deepbuild', 'hub.sock'), root: join(home, '.deepbuild'), child };
}

async function control(w: World, method: string, params: Line, timeoutMs = 120_000): Promise<Line> {
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

async function events(w: World, after = 0): Promise<Line[]> {
  const all: Line[] = [];
  for (let from = after; ;) {
    const reply = await control(w, 'events.read', { after: from, limit: 1000 });
    if (reply.error) throw Error(`BLOCKED: events.read was refused: ${show(reply.error)}`);
    const page = (reply.result?.events ?? []) as Line[];
    all.push(...page);
    if (page.length < 1000) return all;
    from = page[page.length - 1]!.log_pos;
  }
}
async function lastPos(w: World): Promise<number> {
  const all = await events(w);
  return all.length ? Math.max(...all.map((e) => Number(e.log_pos))) : 0;
}

export interface Outcome { isError: boolean; value: Line; text: string }
class Mcp {
  private lines: string[] = [];
  private wakers = new Set<() => void>();
  private n = 0;
  constructor(readonly child: ChildProcess) {
    let buffer = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      buffer += d;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) { this.lines.push(buffer.slice(0, i)); buffer = buffer.slice(i + 1); }
      for (const w of [...this.wakers]) w();
    });
    child.stdin!.on('error', () => undefined);
  }
  request(method: string, params: Line, timeoutMs = TIMEOUT): Promise<Line> {
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
async function startMcp(home: string, cwd: string, env: Record<string, string>): Promise<Mcp> {
  const child = spawn(NODE, [CLI, 'mcp'], { cwd, env: childEnv(home, env), stdio: ['pipe', 'pipe', 'ignore'] });
  if (child.pid) owned.add(child.pid);
  const mcp = new Mcp(child);
  const init = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-3569', version: '0' } }, 300_000);
  if (!init.result) throw Error(`BLOCKED: deep mcp refused initialize: ${show(init)}`);
  mcp.notify('notifications/initialized');
  return mcp;
}

export interface World { tmp: string; home: string; project: string; hub: HubProcess; mcp: Mcp; env: Record<string, string> }

async function openWorld(env: Record<string, string>): Promise<World | string> {
  if (!existsSync(CLI)) return `BLOCKED: ${CLI} is missing; build it with \`npm run build --workspaces\` first; this is not a pass`;
  const hook = await binary('deep-hook');
  if (typeof hook === 'string') return hook;
  const tmp = tempDir();
  const home = join(tmp, 'home');
  const project = join(tmp, 'proj');
  mkdirSync(home);
  mkdirSync(project);
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  let why = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const hub = await startHub(home, { DEEP_HUB_TEST_CONFIRM: join(tmp, 'confirm'), ...env });
      const mcp = await startMcp(home, project, env);
      return { tmp, home, project, hub, mcp, env };
    } catch (e) { why = first(message(e)); }
  }
  return `${why.startsWith('BLOCKED:') ? '' : 'BLOCKED: '}${why}; this is not a pass`;
}

export const install = (w: World, folder: string): Promise<Ran> => runProgram(NODE, [CLI, 'install', folder], { cwd: w.project, env: childEnv(w.home, w.env), timeoutMs: 1_800_000 });

export async function job(w: World, args: Line): Promise<Outcome> {
  const reply = await w.mcp.request('tools/call', { name: 'deep_job', arguments: args });
  if (reply.error) return { isError: true, value: reply.error as Line, text: JSON.stringify(reply.error) };
  const result = (reply.result ?? {}) as Line;
  const text = Array.isArray(result.content) ? String(result.content.find((c: Line) => c?.type === 'text')?.text ?? '') : '';
  const value = (result.structuredContent ?? parse(text) ?? {}) as Line;
  return { isError: result.isError === true, value, text: text || JSON.stringify(value) };
}

export async function toolsOf(w: World, kind = KIND): Promise<Line[] | string> {
  let listed: Outcome;
  try { listed = await job(w, { op: 'list' }); } catch (e) { return `BLOCKED: deep_job {op: list} gave no reply: ${first(message(e))}; this is not a pass`; }
  if (listed.isError || !Array.isArray(listed.value.kinds)) return `deep_job {op: list} gave no kinds: ${listed.text.slice(0, 900)}`;
  const k = (listed.value.kinds as Line[]).find((x) => x.kind === kind);
  if (!k) return `deep_job lists no kind ${kind}; it lists ${(listed.value.kinds as Line[]).map((x) => String(x.kind)).join(', ') || 'none'}`;
  return Array.isArray(k.tools) ? (k.tools as Line[]) : [];
}

export interface Run { outcome: Outcome; started: number; ms: number }
export async function counted(w: World, call: () => Promise<Outcome>): Promise<Run> {
  const before = await lastPos(w);
  const t0 = performance.now();
  const outcome = await call();
  const ms = performance.now() - t0;
  await sleep(500);
  const started = (await events(w, before)).filter((e) => e.kind === 'process.starting').length;
  return { outcome, started, ms };
}

export interface Hub { w: World; tool: string; plugin: string; evidence: string }

export async function openHub(env: Record<string, string> = {}): Promise<Hub | string> {
  const file = join(PLUGIN, 'deepbuild.json');
  if (!existsSync(file)) return `the asset-tools plug-in isn't at packages/jobs/asset-tools (no deepbuild.json there), so no package registers the job kind ${KIND} or its output check ${CHECK} (README: The surface under test)`;
  let manifest: Line;
  try { manifest = JSON.parse(readFileSync(file, 'utf8')) as Line; } catch (e) { return `packages/jobs/asset-tools/deepbuild.json isn't JSON: ${first(message(e))}`; }
  const mine = (Array.isArray(manifest.job_tools) ? (manifest.job_tools as Line[]) : []).filter((t) => t.kind === KIND).map((t) => String(t.tool));
  if (mine.length !== 1) return `packages/jobs/asset-tools/deepbuild.json lists ${mine.length} tools for ${KIND} in job_tools, not one: ${show(manifest.job_tools, 400)}`;
  const tool = mine[0]!;
  const w = await openWorld(env);
  if (typeof w === 'string') return w;
  const ran = await install(w, PLUGIN);
  if (ran.code !== 0) return `deep install packages/jobs/asset-tools didn't load it: ${shown(ran)}`;
  const tools = await toolsOf(w);
  if (typeof tools === 'string') return tools;
  const listed = tools.find((t) => t.tool === tool);
  if (!listed) return `deep_job lists ${KIND} without its tool ${tool}; it lists ${tools.map((t) => String(t.tool)).join(', ') || 'no tool'}`;
  return { w, tool, plugin: String(manifest.id), evidence: join(w.home, '.deepbuild', 'evidence') };
}

export interface TableSpec {

  name: string; bytes?: Buffer;

  key: string; units?: Record<string, string>;

  by?: 'url' | 'agent';
}
export interface Imported { sha: Record<string, string>; assets: Record<string, Line>; replies: Line[] }
const SESSION = 'sess-3569';
const SESSIONS = { [SESSION]: { thread: 'thread-3569', name: 'Agent', process: { pid: 4100, start: 1000 } } };
const DOC = '01JB3569D00000000000000001';

export async function importTables(hub: Hub | string, specs: TableSpec[]): Promise<Imported | string> {
  if (typeof hub === 'string') return hub;
  const show_ = await binary('deep-show');
  if (typeof show_ === 'string') return show_;
  const bytes = specs.map((s) => s.bytes ?? fixture(s.name));
  const files = Object.fromEntries(specs.map((s, i) => [s.name, bytes[i]!]));
  const server = createServer((req, res) => {
    const body = files[(req.url ?? '/').slice(1)];
    if (req.method !== 'GET' || !body) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/csv', 'content-length': body.length });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const agentDir = join(hub.w.tmp, 'agent');
  mkdirSync(agentDir, { recursive: true });
  const calls = specs.map((s, i) => {
    const units = s.units ? { units: s.units } : {};
    if (s.by === 'agent') {
      const path = join(agentDir, s.name);
      writeFileSync(path, bytes[i]!);
      return { call: 'table_import', path, key: s.key, session: SESSION, ...units };
    }
    return { call: 'table_import', url: `${base}/${s.name}`, key: s.key, ...units };
  });
  const scenario = { evidence: hub.evidence, sessions: SESSIONS, panels: { main: { rect: [0, 0, 640, 360] } }, docs: { [DOC]: { panel: 'main' } }, calls };
  let ran: Ran;
  try { ran = await runProgram(show_.path, ['run'], { cwd: REPO, env: childEnv(hub.w.home), input: `${JSON.stringify(scenario)}\n`, timeoutMs: 1_800_000 }); }
  finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  if (ran.code !== 0) return `deep-show run exits ${String(ran.code)} on the table imports: ${shown(ran)}`;
  const out = parse(ran.stdout.split('\n').find((l) => l.trim() !== '') ?? '');
  if (!out || out.ok !== true || !Array.isArray(out.replies) || out.replies.length !== specs.length) return `deep-show run didn't import the tables: ${show(out ?? ran.stdout, 1500)}`;
  const imported: Imported = { sha: {}, assets: {}, replies: out.replies as Line[] };
  for (const [i, s] of specs.entries()) {
    const reply = (out.replies as Line[])[i]!;
    const asset = reply.asset;
    if (!isObject(asset)) return `table_import of ${s.name} answers no asset: ${show(reply, 900)}`;
    if (asset.sha256 !== sha256(bytes[i]!)) return `table_import of ${s.name} answers the asset ${String(asset.sha256)}, not its bytes' ${sha256(bytes[i]!)}`;
    if (s.by === 'agent' ? asset.source !== 'agent' : !isObject(asset.source) || asset.source.url !== `${base}/${s.name}`) return `table_import of ${s.name} answers the source ${show(asset.source)}, not ${s.by === 'agent' ? 'agent' : `the URL ${base}/${s.name}`}`;
    const columns = Array.isArray(asset.probe?.table?.columns) ? (asset.probe.table.columns as Line[]) : [];
    for (const [column, unit] of Object.entries(s.units ?? {})) {
      const c = columns.find((x) => x.name === column);
      if (c?.unit !== unit) return `table_import of ${s.name} with units ${show(s.units)} probes ${column}'s unit as ${show(c?.unit)}, not ${unit} (README: units): ${show(columns, 600)}`;
    }
    imported.sha[s.name] = asset.sha256 as string;
    imported.assets[s.name] = asset;
  }
  return imported;
}

export interface DeriveParams { inputs: Record<string, string>; steps: Line[]; key: string }

export const COUNTY_UNITS = { manufacturing: 'workers' };

export const METRO = { key: 'link' };

export function byMetro(sha: { county: string; metro: string }, opts: { agg?: Record<string, string>; skip_missing?: boolean; after?: Line[] } = {}): DeriveParams {
  return {
    inputs: { county: sha.county, metro: sha.metro },
    steps: [
      { join: { with: 'metro', on: ['county'], kind: 'inner', expect: 'many_to_one' } },
      { group: { by: ['metro'], agg: opts.agg ?? { workers: 'sum(manufacturing)', counties: 'count' }, ...(opts.skip_missing === undefined ? {} : { skip_missing: opts.skip_missing }) } },
      ...(opts.after ?? []),
    ],
    key: 'metro',
  };
}

export async function derive(hub: Hub, params: DeriveParams, tool = hub.tool): Promise<Run | string> {
  try {
    return await counted(hub.w, () => job(hub.w, { op: 'run', kind: KIND, tool, params: JSON.stringify(params), inputs: null }));
  } catch (e) {
    return `BLOCKED: the ${KIND} run on ${tool} gave no reply: ${first(message(e))}; this is not a pass`;
  }
}
export const statusOf = (o: Outcome): string => String(o.value.status ?? (o.isError ? 'error' : ''));

export function outputsOf(o: Outcome): Record<string, string> {
  const outputs = isObject(o.value.outputs) ? (o.value.outputs as Line) : {};
  return Object.fromEntries(Object.entries(outputs).map(([n, v]) => [n, isObject(v) && typeof v.sha256 === 'string' ? (v.sha256 as string) : '']));
}
export const receiptOf = (o: Outcome): Line => (isObject(o.value.receipt) ? (o.value.receipt as Line) : {});
export const brief = (r: Run): string => `${r.started} process${r.started === 1 ? '' : 'es'} started; reply ${r.outcome.text.slice(0, 1200)}`;

export function stored(hub: Hub, sha: string): Buffer | null {
  if (!/^[0-9a-f]{64}$/.test(sha)) return null;
  const path = join(hub.evidence, sha.slice(0, 2), sha.slice(2));
  return existsSync(path) ? readFileSync(path) : null;
}

export function tableRecord(hub: Hub, sha: string): Line | null {
  const path = join(hub.evidence, 'tables', `${sha}.json`);
  return existsSync(path) ? parse(readFileSync(path, 'utf8')) ?? null : null;
}

export interface Table { header: string[]; rows: string[][]; text: string }
export function tableOf(text: string): Table {
  const rows = parseCsv(text);
  return { header: rows[0] ?? [], rows: rows.slice(1), text };
}

export function cell(t: Table, keyColumn: string, key: string, column: string): string | undefined {
  const k = t.header.indexOf(keyColumn);
  const c = t.header.indexOf(column);
  if (k < 0 || c < 0) return undefined;
  const found = t.rows.filter((r) => r[k] === key);
  return found.length === 1 ? found[0]![c] ?? '' : undefined;
}

export const keysOf = (t: Table, keyColumn: string): string[] => t.rows.map((r) => r[t.header.indexOf(keyColumn)] ?? '');

export interface Derived { run: Run; outputs: Record<string, string>; table: Table; receipt: Line; record: Line | null; lineage: Line | null }

export function derivedOf(hub: Hub, run: Run | string, what: string): Derived | string {
  if (typeof run === 'string') return run;
  const o = run.outcome;
  const status = statusOf(o);
  if (/blocked/i.test(status)) return `BLOCKED: ${what} is blocked: ${o.text.slice(0, 1200)}; this is not a pass`;
  if (o.isError || status !== 'done') return `${what} isn't done: ${o.text.slice(0, 1200)}`;
  const outputs = outputsOf(o);
  const bytes = stored(hub, outputs.table ?? '');
  if (!bytes) return `${what} is done, and the hub's evidence store holds no table under outputs.table.sha256 (${show(o.value.outputs, 400)})`;
  const reply = receiptOf(o);
  const fields = ['rows_in', 'rows_out', 'dropped', 'skipped', 'nonfinite'];
  let receipt: Line = reply;
  if (!fields.some((f) => f in reply) && outputs.receipt) receipt = parse(stored(hub, outputs.receipt)?.toString('utf8') ?? '') ?? {};
  const lineage = outputs.lineage ? parse(stored(hub, outputs.lineage)?.toString('utf8') ?? '') ?? null : null;
  return { run, outputs, table: tableOf(bytes.toString('utf8')), receipt, record: tableRecord(hub, outputs.table!), lineage };
}

export function refusalOf(o: Outcome): string {
  if (o.isError) return o.text || 'refused';
  return statusOf(o) === 'refused' ? String(o.value.reason ?? o.text) : '';
}

export function names(text: string, token: string): boolean {
  const plain = text.replace(/[0-9a-f]{64}/g, ' ').replace(/(?:\/[\w.@+-]+){2,}/g, ' ');
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_.])${escaped}($|[^A-Za-z0-9_])`).test(plain);
}

export const int = (text: string | undefined): number | string => (text !== undefined && /^-?\d+$/.test(text) ? Number(text) : `not an integer: ${JSON.stringify(text)}`);

export type PlantedName = 'reads_missing_as_zero' | 'sums_in_f32' | 'counts_row_twice' | 'as_is';
export const PLANTED_TOOL: Record<PlantedName, string> = {
  reads_missing_as_zero: 'reads-missing-as-zero@1.0.0',
  sums_in_f32: 'sums-in-f32@1.0.0',
  counts_row_twice: 'counts-row-twice@1.0.0',
  as_is: 'runs-as-is@1.0.0',
};
interface Registered { kind: string; descriptor: Line }

async function rightTool(tool: string): Promise<Registered | string> {
  const tools: Registered[] = [];
  const deep = new Proxy({}, {
    get: (_target, name) => {
      if (name === 'then') return undefined;
      if (name === 'registerJobTool') return async (kind: unknown, descriptor: unknown) => { tools.push({ kind: String(kind), descriptor: JSON.parse(JSON.stringify(descriptor ?? {})) as Line }); };
      return async () => undefined;
    },
  });
  try {
    const plugin = await import(pathToFileURL(join(PLUGIN, 'index.ts')).href) as { default?: (deep: unknown) => Promise<void> };
    if (typeof plugin.default !== 'function') return 'packages/jobs/asset-tools/index.ts has no default export to register its tools';
    await plugin.default(deep);
  } catch (e) {
    return `packages/jobs/asset-tools/index.ts couldn't register its tools: ${first(message(e))}`;
  }
  const right = tools.find((t) => t.kind === KIND && t.descriptor.tool === tool);
  if (!right) return `packages/jobs/asset-tools registers no tool ${tool} for ${KIND}; it registers ${tools.map((t) => `${t.kind}: ${String(t.descriptor.tool)}`).join(', ') || 'none'}`;
  const run = right.descriptor.run;
  if (!isObject(run) || typeof run.dir !== 'string' || typeof run.entry !== 'string') return `${tool} doesn't run as its own files (run {dir, entry}), so no planted tool can run it: ${show(run, 200)}`;
  return right;
}

async function plantedPlugin(dir: string, right: Registered, name: PlantedName, plan: Plan): Promise<void> {
  const { packageDigest } = await import(new URL('../../../packages/extension-host/src/index.ts', import.meta.url).href) as { packageDigest: (dir: string) => string };
  const run = right.descriptor.run as Line;
  const tool = join(dir, String(run.dir));
  mkdirSync(dir, { recursive: true });
  cpSync(join(PLUGIN, String(run.dir)), tool, { recursive: true });
  writeFileSync(join(tool, 'deep-3569-tool.mjs'), readFileSync(join(FIXTURES, 'planted', 'tool.mjs.fixture')));
  writeFileSync(join(tool, 'deep-3569-spoil.mjs'), readFileSync(join(FIXTURES, 'planted', 'spoil.mjs')));
  writeFileSync(join(tool, 'deep-3569-plan.json'), `${JSON.stringify({ entry: run.entry, spoil: name, ...plan })}\n`);
  writeFileSync(join(dir, 'index.ts'), readFileSync(join(FIXTURES, 'planted', 'index.ts.fixture')));
  const descriptor = { ...right.descriptor, tool: PLANTED_TOOL[name], run: { ...run, entry: 'deep-3569-tool.mjs' } };
  writeFileSync(join(dir, 'probe.json'), `${JSON.stringify({ kind: KIND, descriptor }, null, 2)}\n`);
  const manifest: Line = {
    id: `test/${PLANTED_TOOL[name].split('@')[0]!}`, version: '1.0.0', digest: 'd1:0000000000000000000000000000000000000000000000000000000000000000',
    job_tools: [{ kind: KIND, tool: PLANTED_TOOL[name] }], requires: { preview: ['deep.registerJobTool'] },
  };
  writeFileSync(join(dir, 'deepbuild.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  manifest.digest = packageDigest(dir);
  writeFileSync(join(dir, 'deepbuild.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function installPlanted(hub: Hub, name: PlantedName, plan: Plan): Promise<string | { tool: string }> {
  const right = await rightTool(hub.tool);
  if (typeof right === 'string') return right;
  const dir = join(hub.w.tmp, `planted-${name}`);
  try { await plantedPlugin(dir, right, name, plan); } catch (e) { return `BLOCKED: the plug-in of ${PLANTED_TOOL[name]} couldn't be made: ${first(message(e))}; this is not a pass`; }
  const ran = await install(hub.w, dir);
  if (ran.code !== 0) return `deep install of the planted ${PLANTED_TOOL[name]} was refused, so it never reached ${CHECK}; it is right on every input but its own job's, so the kind's qualification must let it join (README: The planted programs): ${shown(ran)}`;
  const tools = await toolsOf(hub.w);
  if (typeof tools === 'string') return tools;
  if (!tools.some((t) => t.tool === PLANTED_TOOL[name])) return `deep install of ${PLANTED_TOOL[name]} exits 0 and deep_job doesn't list it for ${KIND}: ${tools.map((t) => String(t.tool)).join(', ')}`;
  return { tool: PLANTED_TOOL[name] };
}

export function failedCheck(r: Run | string): { check: string; reason: string; outputs: Record<string, string> } | string {
  if (typeof r === 'string') return r;
  const o = r.outcome;
  if (statusOf(o) !== 'failed') return `the run isn't failed by an output check: ${o.text.slice(0, 1200)}`;
  return { check: String(o.value.check ?? ''), reason: String(o.value.reason ?? o.text), outputs: outputsOf(o) };
}

export interface Checked { ok: boolean; errors: Line[]; numbers: Line[]; raw: Line }

export async function honest(hub: Hub, doc: Line): Promise<Checked | string> {
  const render = await binary('deep-canvas-render');
  if (typeof render === 'string') return render;
  const ran = await runProgram(render.path, ['check'], { cwd: REPO, env: childEnv(hub.w.home), input: `${JSON.stringify({ doc, look: 'clean', evidence: hub.evidence })}\n`, timeoutMs: 1_800_000 });
  if (ran.code !== 0) return `deep-canvas-render check exits ${String(ran.code)}: ${shown(ran)}`;
  const out = parse(ran.stdout.split('\n').find((l) => l.trim() !== '') ?? '');
  if (!out || typeof out.ok !== 'boolean') return `deep-canvas-render check gave no answer with ok: ${ran.stdout.slice(0, 1500)}`;
  const issues = Array.isArray(out.issues) ? (out.issues as Line[]) : [];
  return { ok: out.ok, errors: issues.filter((i) => i.severity === 'error'), numbers: Array.isArray(out.numbers) ? (out.numbers as Line[]) : [], raw: out };
}
export const shownErrors = (c: Checked): string => show(c.errors.map((e) => ({ code: e.code, ids: e.ids, path: e.path, actual: e.actual })), 2500);
const license = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture.' };

export function labelsDoc(sha: string, key: string, column: string, rows: number, reading: boolean): Line {
  const from = (c: string): Line => ({ from: 'derived', column: c });
  const x = Buffer.alloc(rows * 4);
  for (let i = 0; i < rows; i++) x.writeFloatLE(80 + 200 * i, i * 4);
  const doc: Line = {
    format: 1, id: 'chart-derived', profile: 'chart', title: 'Workers by metro', description: 'Each metro area\'s manufacturing workers, from a derived table.',
    size: [640, 360], layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    assets: { derived: { sha256: sha, license } },
    items: {
      labels: {
        id: 'labels', kind: 'marks@1', layer: 'main', name: 'Workers by metro', order: 'a1',
        params: {
          mark: 'text', n: rows, key: 'key',
          columns: { key: from(key), x: { dtype: 'f32', len: rows, data: x.toString('base64') }, y: { const: 180 }, text: from(column), size: { const: 20 } },
          encode: { x: { column: 'x' }, y: { column: 'y' }, text: { column: 'text' }, size: { column: 'size' } }, paint: { fill: { role: 'ink' } },
        },
      },
    },
  };
  if (reading) {
    doc.items.reading = { id: 'reading', kind: 'text@1', layer: 'main', name: 'reading', order: 'a8', at: { pos: [24, 320, 0] }, params: { font: 'body', size: 20, text: '' } };
    doc.bound_values = { 'reading-value': { target: 'items/reading/params/text', source: 'reading:01JB3569R00000000000000002' } };
  }
  return doc;
}

export function keyLists(value: unknown, out: string[][] = []): string[][] {
  if (Array.isArray(value)) {
    if (value.length && value.every((v) => typeof v === 'string' || Number.isInteger(v))) out.push(value.map(String).sort());
    for (const v of value) keyLists(v, out);
  } else if (isObject(value)) {
    for (const [k, v] of Object.entries(value)) if (k !== 'bytes') keyLists(v, out);
  }
  return out;
}

export function holds(value: unknown, s: string): boolean {
  if (value === s) return true;
  if (Array.isArray(value)) return value.some((v) => holds(v, s));
  if (isObject(value)) return Object.values(value).some((v) => holds(v, s));
  return false;
}

export const PROOF_DIR = join(tmpdir(), 'deep-3569-proof');
export function proof(name: string, value: unknown): void {
  mkdirSync(PROOF_DIR, { recursive: true });
  writeFileSync(join(PROOF_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => { try { return execFileSync(cmd, args, { encoding: 'utf8' }).trim(); } catch { return ''; } };

export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  const model = sh('sysctl', '-n', 'hw.model');
  const chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
  const gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(sh('pmset', '-g'));
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const therm = sh('pmset', '-g', 'therm');
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  const load = loadavg()[0]!;
  if (load > cpus().length / 2) return `loaded: a 1-minute load average of ${load.toFixed(1)} on ${cpus().length} cores`;
  return null;
}

export function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const text = `${name}: ${runs.map((r) => r.toFixed(1)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(text);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${text}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${text}`);
}
