// Test-side tools for the #2399 acceptance tests, on top of #1106's own (tests/acceptance/1106/helpers.ts, imported
// as it is): where a run's egress filter listens, plain HTTP requests and CONNECT tunnels sent to that port from
// outside the run, the record's `sandbox.denied` events for a run, a marker refusal that tells the test the record
// has taken everything sent before it, a second worktree for a second run beside the first, and #1106's third
// criterion run unchanged in a Vitest of its own. Nothing here stands in for the hub, the supervisor or its filter.
//
// Safety: as #1106's helpers. Every folder is under /tmp/dh1106-* (theirs) or /tmp/dh2399-* (this file's), every
// process is stopped by PID only, HOME is a temp folder, and nothing leaves the loopback: every request here goes to
// 127.0.0.1, and every host it names ends in `.invalid`, which resolves nowhere.

import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { type Client, deep, get, home, type Hub, type Line, mustBeReady, NODE, own, ownPidDir, REPO, sleep, stopHub, type Up, waitFor } from '../1106/helpers.ts';

export const CONFIG_1106 = fileURLToPath(new URL('./fixtures/vitest-1106.config.mjs', import.meta.url));
/** How many times each criterion sends its request: the issue's 100. */
export const TIMES = 100;

// ---- The run's filter port: what the stack's own processes were told (HTTPS_PROXY), read from the app's /env.
export interface Filter { host: string; port: number; auth: Record<string, string> }
export async function filterOf(appPort: number): Promise<Filter> {
  const r = await get(appPort, '/env');
  const env = (r.body?.env ?? {}) as Record<string, string | undefined>;
  const text = env.HTTPS_PROXY || env.https_proxy;
  expect(typeof text, `the app's environment names its egress filter in HTTPS_PROXY or https_proxy (GET /env answered ${r.status ?? r.error})`).toBe('string');
  const url = new URL(text!);
  const port = Number(url.port || 80);
  expect(Number.isInteger(port) && port > 0, `the filter's address ${url.host} names a port`).toBe(true);
  const auth: Record<string, string> = url.username
    ? { 'proxy-authorization': `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')}` } : {};
  return { host: url.hostname.replace(/^\[|\]$/g, ''), port, auth };
}

/** One plain HTTP request to the filter's port, as a proxy's client sends it: `GET http://<name>/ HTTP/1.1`, `Host: <name>`. Its status, or the error's code. */
export function plain(f: Filter, name: string): Promise<number | string> {
  return new Promise((resolve) => {
    const req = http.request({ host: f.host, port: f.port, method: 'GET', path: `http://${name}/`, headers: { host: name, connection: 'close', ...f.auth }, agent: false, timeout: 30_000 }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 'no status'));
      res.on('error', () => resolve(res.statusCode ?? 'no status'));
    });
    req.on('connect', (res, socket) => { socket.destroy(); resolve(`a tunnel (${res.statusCode})`); });
    req.on('timeout', () => req.destroy(Error('timeout')));
    req.on('error', (e) => resolve((e as NodeJS.ErrnoException).code ?? e.message));
    req.end();
  });
}
/** One tunnel asked of the filter: `CONNECT <host:port> HTTP/1.1`. The status it answered (200 is a tunnel), or the error's code. */
export function tunnel(f: Filter, target: string): Promise<number | string> {
  return new Promise((resolve) => {
    const req = http.request({ host: f.host, port: f.port, method: 'CONNECT', path: target, headers: { host: target, ...f.auth }, agent: false, timeout: 30_000 });
    req.on('connect', (res, socket) => { socket.destroy(); resolve(res.statusCode ?? 'no status'); });
    req.on('response', (res) => { res.resume(); resolve(res.statusCode ?? 'no status'); });
    req.on('timeout', () => req.destroy(Error('timeout')));
    req.on('error', (e) => resolve((e as NodeJS.ErrnoException).code ?? e.message));
    req.end();
  });
}

// ---- The record's sandbox.denied events for a run.
export interface Denied { log_pos: number; operation: string; target: string }
const MARK = 'dh2399-mark-';
/** Every `sandbox.denied` in the record whose data names the run, the markers below left out, in the record's order. */
export async function denied(client: Client, run: string): Promise<Denied[]> {
  return (await all(client, run)).filter((d) => !d.target.includes(MARK));
}
async function all(client: Client, run: string): Promise<Denied[]> {
  return (await client.events('sandbox.denied')).filter((e: Line) => e.data?.run === run)
    .map((e: Line) => ({ log_pos: e.log_pos as number, operation: String(e.data.operation), target: String(e.data.target) }));
}
let marks = 0;
/**
 * Waits for the record to hold everything the filter refused so far: sends the filter one more plain request under
 * a name of its own, never sent before, and waits for that refusal in the record (the supervisor appends a run's
 * refusals in the order its filter reported them), then a moment more. False when the marker never arrived.
 */
export async function settled(client: Client, f: Filter, run: string, waitMs = 60_000): Promise<boolean> {
  const name = `${MARK}${++marks}-${Date.now().toString(36)}.invalid`;
  await plain(f, name);
  const seen = await waitFor(async () => (await all(client, run)).some((d) => d.target.includes(name)), waitMs, 'the marker refusal in the record').catch(() => false);
  await sleep(500);
  return seen;
}
/** The events of `now` that `before` doesn't hold. */
export const gained = (before: Denied[], now: Denied[]): Denied[] => now.filter((d) => !before.some((b) => b.log_pos === d.log_pos));
export const show = (events: Denied[]): string => JSON.stringify(events.slice(0, 6).map((d) => ({ operation: d.operation, target: d.target }))) + (events.length > 6 ? ` and ${events.length - 6} more` : '');
/** A refusal of an operation whose target names a host: `host` is the host's name, with no port. */
export const names = (operation: string, host: string) => (d: Denied): boolean => d.operation === operation && d.target.includes(host);
/** A refusal the filter reported for a request to it that carried no stand-in (the issue's two operations), or one whose target names the host. */
export const ofFilter = (host: string) => (d: Denied): boolean => d.operation === 'egress-plain-http' || d.operation === 'egress-host' || d.target.includes(host);

// ---- A second run beside the first: a second worktree of the same test repo, brought up by the same hub.
export function secondWorktree(first: string): string {
  const repo = join(dirname(first), 'repo');
  const wt = join(dirname(first), 'wt-b');
  execFileSync('/usr/bin/git', ['-C', repo, '-c', 'user.name=dh2399', '-c', 'user.email=dh2399@example.invalid', 'worktree', 'add', '-q', '-b', 'wt-b', wt],
    { env: { ...process.env, HOME: home(), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] });
  ownPidDir(join(wt, '.pids'));
  return realpathSync(wt);
}
/** `deep env up` in a worktree: the stack's run and the app's port. */
export async function up(hub: Hub, wt: string): Promise<{ run: string; port: number }> {
  const out = mustBeReady(await deep(['env', 'up', '--root', hub.root, '--json'], { cwd: wt }), wt);
  return { run: out.run as string, port: out.ports.web as number };
}
export async function down(hub: Hub, wt: string): Promise<number | null> {
  return (await deep(['env', 'down', '--root', hub.root, '--json'], { cwd: wt, timeoutMs: 60_000 })).code;
}
/** Takes every worktree's stack down, closes the client and stops the hub. */
export async function downAll(u: Up | undefined, worktrees: string[]): Promise<void> {
  if (!u) return;
  for (const wt of worktrees) await down(u.hub, wt).catch(() => undefined);
  u.client.close();
  await stopHub(u.hub);
}

// ---- #1106's third criterion, unchanged: its own test file in a Vitest of its own.
/** The name its criterion test starts with (tests/acceptance/1106/refusals.test.ts); its `(wrong program)` test doesn't. */
export const AC3_1106 = 'AC3 SHOP_API_KEY';
export interface Ran1106 { code: number | null; passed: number; failed: number; output: string; failures: string }
/**
 * Runs tests/acceptance/1106/refusals.test.ts's criterion test as that file has it. With a plant, the only thing
 * added is the hub's DEEP_HUB_PLANT, set in the test's process by fixtures/plant-setup.mjs after #1106's helpers
 * removed every DEEP_* variable, so the hub that test starts acts as the planted program. The config it runs under
 * (fixtures/vitest-1106.config.mjs) loads that setup file and keeps Vitest's cache in a temp folder.
 */
export function run1106(plant?: string): Promise<Ran1106> {
  const dir = realpathSync(mkdtempSync('/tmp/dh2399-'));
  const json = join(dir, 'result.json');
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1', DH2399_CACHE: join(dir, 'cache'), ...(plant ? { DH2399_PLANT: plant } : {}) };
  delete env.FORCE_COLOR;
  if (!plant) delete env.DH2399_PLANT;
  const args = [join(REPO, 'node_modules/vitest/vitest.mjs'), 'run', '--root', join(REPO, 'tests/acceptance/1106'), 'refusals.test.ts', '-t', AC3_1106,
    '--no-file-parallelism', '--testTimeout=600000', '--config', CONFIG_1106, '--reporter=default', '--reporter=json', `--outputFile.json=${json}`];
  return new Promise((resolve) => {
    const child = spawn(NODE, args, { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    let output = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => (output += d));
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (output += d));
    child.on('close', (code) => {
      let report: Line = {};
      try { report = JSON.parse(readFileSync(json, 'utf8')) as Line; } catch { /* no report: the counts stay 0 */ }
      rmSync(dir, { recursive: true, force: true });
      const failures = ((report.testResults ?? []) as Line[]).flatMap((file) => (file.assertionResults ?? []) as Line[])
        .filter((t) => t.status === 'failed').map((t) => `${t.fullName}: ${((t.failureMessages ?? []) as string[]).join('\n')}`).join('\n');
      resolve({ code, passed: Number(report.numPassedTests ?? 0), failed: Number(report.numFailedTests ?? 0), output, failures });
    });
  });
}
