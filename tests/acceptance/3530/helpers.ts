import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect } from 'vitest';
import { PIECE_ITEM, brief, isObject, type Json, type JsonObject, type JudgeLimit, type Machine } from './judges.ts';
import type { Program } from './programs.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..', '..');

export const CRITERIA = { 1: '#3530.5321d459', 2: '#3530.1f0dfd22', 3: '#3530.9355f915', 4: '#3530.80a29246' } as const;
export const titlePrefix = (n: keyof typeof CRITERIA): string => `AC${n} ${CRITERIA[n]}`;

export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}; this is not a pass`); };
export const inconclusive = (why: string): never => { throw Error(`INCONCLUSIVE: ${why}; this is not a pass`); };
export function expectNoProblems(problems: readonly string[], what: string): void {
  expect(problems, `${what}: ${problems.length} ${problems.length === 1 ? 'problem' : 'problems'}\n  ${problems.slice(0, 20).join('\n  ')}\n`).toEqual([]);
}

const suppliedBinDir = process.env['DEEP_BIN_DIR'];
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
export function cargoEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
    CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
    ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
  };
  delete env['CARGO_TARGET_DIR'];
  return env;
}
const executable = (path: string, from: string): string => {
  try { accessSync(path, constants.X_OK); } catch { blocked(`deep-logic is missing or not executable (${from})`); }
  return path;
};
const built = new Set<string>();
export function logicDebug(): string {
  if (suppliedBinDir !== undefined) return executable(join(resolve(suppliedBinDir), 'deep-logic'), 'DEEP_BIN_DIR');
  if (!built.has('debug')) {
    const env = cargoEnv();
    const run = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-logic'], { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (run.error || run.status !== 0) blocked(`cargo build --locked --bin deep-logic failed: ${run.error?.message ?? run.stderr.slice(-3000)}`);
    built.add('debug');
  }
  return executable(join(REPO, 'target', 'debug', 'deep-logic'), 'target/debug');
}
export function logicRelease(): string {
  if (!built.has('release')) {
    const env = cargoEnv();
    const run = spawnSync('cargo', ['build', '--locked', '--release', '-p', 'deep-logic', '--bin', 'deep-logic'], { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (run.error || run.status !== 0) blocked(`cargo build --locked --release -p deep-logic --bin deep-logic failed: ${run.error?.message ?? run.stderr.slice(-3000)}`);
    built.add('release');
  }
  return executable(join(REPO, 'target', 'release', 'deep-logic'), 'target/release');
}

const FIRST_BUILD_LIMIT_MS = 90 * 60_000;
export function prebuild(build: () => string): void {
  beforeAll(() => { try { build(); } catch {} }, FIRST_BUILD_LIMIT_MS);
}

export interface Ran { status: number | null; signal: NodeJS.Signals | null; timedOut: boolean; replies: Json[]; stdout: string; stderr: string }
export function run(bin: string, args: string[], calls: JsonObject[], ms: number): Ran {
  const ran = spawnSync(bin, args, { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 2048 * 1024 * 1024, timeout: ms, killSignal: 'SIGKILL' });
  const code = (ran.error as NodeJS.ErrnoException | undefined)?.code;
  const timedOut = code === 'ETIMEDOUT';
  if (ran.error && !timedOut && code !== 'EPIPE') blocked(`deep-logic ${args.join(' ')} couldn't run: ${ran.error.message}`);
  const stdout = ran.stdout ?? '';
  const replies = stdout.split('\n').filter((l) => l !== '').map((l): Json => { try { return JSON.parse(l) as Json; } catch { return l; } });
  return { status: ran.status, signal: ran.signal, timedOut, replies, stdout, stderr: ran.stderr ?? '' };
}
export function answerForEachCall(ran: Ran, calls: JsonObject[], what: string): JsonObject[] {
  if (ran.timedOut) inconclusive(`${what} didn't end in time and was stopped; it had answered ${ran.replies.length} of ${calls.length} calls`);
  expect(ran.status, `${what} exits 0 (${ran.signal ?? 'no signal'}); its last output: ${ran.stdout.slice(-600)}; stderr: ${ran.stderr.slice(-1500)}`).toBe(0);
  expect(ran.replies.length, `${what} answers each call once`).toBe(calls.length);
  return ran.replies.map((r, i) => {
    expect(isObject(r), `${what}: reply ${i} is a JSON object, got ${brief(r)}`).toBe(true);
    return r as JsonObject;
  });
}
export const debugLogicAnswers = (calls: JsonObject[], ms: number): JsonObject[] => answerForEachCall(run(logicDebug(), [], calls, ms), calls, 'deep-logic');

export interface LongLivedLogic { call: (line: JsonObject, what: string) => Promise<JsonObject>; stop: () => Promise<void> }
export function longLivedLogic(bin: string, answerMs: number): LongLivedLogic {
  const child: ChildProcessWithoutNullStreams = spawn(bin, [], { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
  let said = '';
  child.stderr.setEncoding('utf8').on('data', (d: string) => { said = (said + d).slice(-2000); });
  child.stdin.on('error', () => undefined);
  const waiting: ((reply: JsonObject) => void)[] = [];
  createInterface({ input: child.stdout }).on('line', (line) => {
    let value: unknown;
    try { value = JSON.parse(line); } catch { value = undefined; }
    waiting.shift()?.(isObject(value) ? value : { ok: false, code: 'bad_output', line: line.slice(0, 600) });
  });
  let ended: string | undefined;
  const closed = new Promise<void>((done) => {
    const end = (how: string): void => {
      ended = how;
      for (const wake of waiting.splice(0)) wake({ ok: false, code: 'exited', status: how, said: said.trim() });
      done();
    };
    child.once('close', (code, signal) => end(String(code ?? signal)));
    child.once('error', (error) => end(error.message));
  });
  const kill = (): void => {
    try { if (ended === undefined && child.pid) process.kill(child.pid, 'SIGKILL'); } catch {}
  };
  return {
    call: (line, what) => {
      let timer: NodeJS.Timeout | undefined;
      const answer = new Promise<JsonObject>((done) => {
        if (ended !== undefined) { done({ ok: false, code: 'exited', status: ended, said: said.trim() }); return; }
        waiting.push(done);
        child.stdin.write(`${JSON.stringify(line)}\n`);
      });
      // deadline: only turns a deep-logic that never answers into a result that names the call.
      const late = new Promise<JsonObject>((_, reject) => { timer = setTimeout(() => { kill(); reject(Error(`INCONCLUSIVE: deep-logic gave no answer to ${what} within ${Math.round(answerMs / 1000)} s and was stopped; this is not a pass`)); }, answerMs); });
      return Promise.race([answer, late]).finally(() => clearTimeout(timer));
    },
    stop: async () => { kill(); await closed; },
  };
}

export function oneItemPiece(program: Program, seed: number, budget: { fuel: number; memory?: number }): JsonObject {
  return { seed, assets: { [program.sha]: program.b64 }, items: { [PIECE_ITEM]: { kind: 'logic@1', params: { program: program.sha, budget } } } };
}
export const checkCall = (piece: Json): JsonObject => ({ call: 'check', piece });
export const bakeCall = (piece: Json, steps: number, track: Json[] = []): JsonObject => ({ call: 'bake', piece, track, steps });
export const webPlanCall = (piece: Json, steps: number): JsonObject => ({ call: 'web_plan', piece, track: [], steps });

export const CHROME = process.env['CHROME_BIN'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PAGE_HTML = `<!doctype html><meta charset="utf-8"><title>#3530 web runner</title><script type="module">
const post = (body) => fetch('/results', { method: 'POST', body: JSON.stringify(body) });
try {
  const runner = await import('/runner.mjs');
  const requests = await (await fetch('/requests.json')).json();
  const replies = [];
  for (const request of requests) {
    try { replies.push(await runner.bake(request)); }
    catch (e) { replies.push({ ok: false, code: 'runner_threw', message: String((e && e.stack) || e) }); }
  }
  await post({ userAgent: navigator.userAgent, replies });
} catch (e) { await post({ userAgent: navigator.userAgent, error: String((e && e.stack) || e) }); }
</script>`;
export async function bakeInHeadlessChrome(source: string, requests: Json[], ms: number): Promise<{ userAgent: string; replies: Json[] }> {
  if (!existsSync(CHROME)) blocked(`no headless Chrome at ${CHROME} (set CHROME_BIN); the web player's engine runs there`);
  const profile = mkdtempSync(join(tmpdir(), 'deep-3530-chrome-'));
  let settle: (v: JsonObject) => void = () => undefined;
  const posted = new Promise<JsonObject>((res) => { settle = res; });
  const server = createServer((req, res) => {
    const url = req.url ?? '/';
    if (req.method === 'POST' && url === '/results') {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (c: string) => { body += c; });
      req.on('end', () => { res.end('ok'); try { settle(JSON.parse(body) as JsonObject); } catch { settle({ error: `unreadable post: ${body.slice(0, 500)}` }); } });
      return;
    }
    const send = (type: string, text: string): void => { res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); res.end(text); };
    if (url === '/' || url === '/index.html') send('text/html', PAGE_HTML);
    else if (url === '/runner.mjs') send('text/javascript', source);
    else if (url === '/requests.json') send('application/json', JSON.stringify(requests));
    else { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
  const port = (server.address() as AddressInfo).port;
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--use-mock-keychain', '--password-store=basic', '--disable-background-networking', '--disable-component-update',
    `--user-data-dir=${profile}`, `http://127.0.0.1:${port}/`], { detached: true, stdio: 'ignore' });
  let timer: NodeJS.Timeout | undefined;
  try {
    // deadline: only turns a page that never posts its replies into a result that says so.
    const late = new Promise<JsonObject>((res) => { timer = setTimeout(() => res({ late: true }), ms); });
    const out = await Promise.race([posted, late]);
    if (out['late'] === true) inconclusive(`headless Chrome posted no reply within ${Math.round(ms / 1000)} s and was stopped`);
    expect(out['error'] ?? null, 'the web runner page runs in headless Chrome').toBeNull();
    expect(Array.isArray(out['replies']), `the page posts its replies: ${brief(out)}`).toBe(true);
    return { userAgent: String(out['userAgent']), replies: out['replies'] as Json[] };
  } finally {
    if (timer) clearTimeout(timer);
    if (chrome.pid) { try { process.kill(-chrome.pid, 'SIGKILL'); } catch {} }
    await new Promise<void>((res) => server.close(() => res()));
    rmSync(profile, { recursive: true, force: true });
  }
}

export interface Reference { name: string; model: string; chip: string; memoryBytes: number; cores: number }
export interface Benchmark {
  judgeLimit: JudgeLimit;
  fingerprint(): Machine;
  references: Reference[];
  validateBudgets(current: unknown, base: unknown): unknown;
}
export const benchmark = (): Promise<Benchmark> => import(join(REPO, 'scripts', 'benchmark.mjs')) as Promise<Benchmark>;
export const fingerprintAtRest = (mac: Reference): Machine => ({ model: mac.model, chip: mac.chip, memoryBytes: mac.memoryBytes, power: 'ac', lowPowerMode: false, thermalState: 'nominal', macosBuild: '26B8119' });

export interface BenchmarkTaskHolders { budgets: unknown; refusal: string; timed: string[]; runs: string }
export async function benchmarkTaskHolders(): Promise<BenchmarkTaskHolders> {
  const budgets: unknown = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8'));
  let refusal = '';
  try { (await benchmark()).validateBudgets(budgets, { tasks: [] }); } catch (error) { refusal = error instanceof Error ? error.message : String(error); }
  const lanes = (await import(join(REPO, 'scripts', 'lanes.mjs'))) as { timed: string[] };
  const usage = spawnSync(process.execPath, ['benchmarks/canvas-world.mjs'], { cwd: REPO, encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL' });
  return { budgets, refusal, timed: lanes.timed, runs: `${usage.stderr ?? ''}` };
}
