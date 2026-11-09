// The driver run (#37): runtime/driver.mjs started through host@1 against a stack, under the run's deadline, and
// its report read back with the files it wrote, each with its digest and size. The browser is DeepBuild's own
// runtime, so it runs as you, reaching only the stack's host; the page it drives is the repo's, served by the stack
// env-local started from the run's checkout. Nothing here is a verdict.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, type Host } from '@deepbuild/supervisor';
import type { Box } from './png.js';
import type { DriverLocator } from './journey.js';

const DRIVER = fileURLToPath(new URL('../runtime/driver.mjs', import.meta.url));
/** The fixed defaults every journey runs with (issue #37, Added Oct 9). */
export interface Profile { width: number; height: number; locale: string; timezone: string; colorScheme: 'light' | 'dark'; reducedMotion: 'reduce' | 'no-preference' }
export const PROFILE: Profile = { width: 1280, height: 720, locale: 'en-US', timezone: 'UTC', colorScheme: 'light', reducedMotion: 'reduce' };

export interface JobStep { id: string; line: number | null; deadlineMs: number; timeoutMs: number; actions: unknown[]; expects: unknown[] }
export interface JobEnd { id: string; line: number | null; oracle: string; locator?: DriverLocator; text?: string; visible?: boolean; timeoutMs?: number }
export interface Job { url: string; profile: Profile; video: boolean; trace: boolean; settle: boolean; settleMs: number; hold: boolean; masks: DriverLocator[]; steps: JobStep[]; endState: JobEnd[] }

interface Control { role: string; name: string; testId?: string }
interface AnimationEntry { target: Control | null; property: string; from: string; to: string; duration: number | null; delay: number; easing: string }
export interface ScreenElement { role: string; name: string; testId: string | null; label: string | null; explicitRole: string | null; tag: string; box: Box }
interface ReportFailure { step: string; line: number | null; assertion: boolean; message: string; selector?: string; screenshot?: string | null; box?: Box | null; action?: string; outside?: boolean; stack?: string | null }
export interface ReportStep {
  id: string; index: number; startMs: number; endMs: number | null; outcome: 'passed' | 'failed' | 'overran'; failure: ReportFailure | null;
  route: { path: string; query: string; raw: string } | null; controls: { appeared: Control[]; left: Control[]; changed: Control[] } | null;
  screenshot: string | null; snapshot: string; dom: string[]; animations: AnimationEntry[]; firstFrame: { opacity: number; transform: string } | null;
  masks: { selector: string; box: Box | null; count: number }[]; still: boolean; unstable: Box | null; elements: ScreenElement[];
  expects: { line: number | null; selector: string | null; outcome: string; box: Box | null }[];
}
export interface ReportEnd { id: string; line: number | null; oracle: string; outcome: 'passed' | 'failed' | 'reading'; selector: string | null; box: Box | null; screenshot: string | null; message: string | null; value: string | null; snapshot: string | null }
export type ReportError = { kind: 'uncaught'; message: string; at: number; step: string | null } | { kind: 'request'; url: string; status: number | null; unfinished: boolean; at: number; step: string | null };
export interface ReportRequest { url: string; method: string; type: string; started: number; ended: number | null; status: number | null; size: number | null; step: string | null; failed: string | null; unfinished: boolean }
export interface Report {
  started: string | null; steps: ReportStep[]; endState: ReportEnd[]; requests: ReportRequest[]; errors: ReportError[]; console: { text: string; at: number; step: string | null }[];
  video: string | null; trace: string | null; redaction: { state: 'complete' | 'incomplete'; since: string | null; sinceMs?: number; field?: string }; secretTyped: boolean; bundle: Record<string, number>;
  ended: number | null; died: string | null; playwright: { started: number; ended: number; own: number };
}
/** A file the run wrote, kept with its digest and size, checked when read. */
export interface Artifact { name: string; path: string; sha256: string; size: number; kind: 'png' | 'webm' | 'zip' | 'json' }
export interface DriverRun { report: Report | null; dir: string; out: string; artifacts: Artifact[]; exit: { code: number | null; cause: 'exit' | 'deadline' | 'stop'; failed: string | null; output: string }; wallMs: number; /** The driver process gone, awaited before its folder is removed. */ settled: Promise<unknown> }

const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
/** Where Playwright installed its browsers: as told, else the cache under this home, else under the account's own home (a run with HOME moved aside still finds them). */
function browsersPath(): string {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH;
  const cache = process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright';
  const homes = [homedir(), userInfo().homedir];
  return homes.map((h) => join(h, cache)).find((p) => existsSync(p)) ?? join(homes[0]!, cache);
}
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export function playwrightVersion(): string {
  try { return (JSON.parse(readFileSync(join(REPO, 'node_modules/playwright/package.json'), 'utf8')) as { version: string }).version; } catch { return 'unknown'; }
}
const hostOf = (url: string): string => { const u = new URL(url); return `${u.hostname}:${u.port || (u.protocol === 'https:' ? 443 : 80)}`; };

/**
 * Starts a process through the host, as you, writing in `dir` and reaching only `hosts`; its exit and output. With
 * `later`, the deadline isn't armed at the start: `later.arm(ms)` arms it, as a prestarted driver's job arrives.
 */
async function hosted(host: Host, run: string, argv: string[], cwd: string, env: Record<string, string>, dir: string, hosts: string[], deadline: number, stop?: AbortSignal, later?: { arm?: (ms: number) => void }): Promise<DriverRun['exit']> {
  const chunks: Buffer[] = [];
  let cause: 'exit' | 'deadline' | 'stop' = 'exit';
  const started = host.start({
    run, argv, cwd, inherit: false, env: { ...env, PATH: '/usr/bin:/bin', HOME: join(dir, 'home'), TMPDIR: dir, NO_COLOR: '1', DO_NOT_TRACK: '1' },
    grant: { run_as_you: true, write: [dir], ...(hosts.length ? { hosts } : {}) },
    output: { stdout: (c) => chunks.push(c), stderr: (c) => chunks.push(c) },
  });
  let kill: ReturnType<typeof setTimeout> | undefined;
  const halt = (why: 'deadline' | 'stop'): void => {
    if (cause !== 'exit') return;
    cause = why;
    void started.then((s) => (s.status === 'started' ? host.signal(run, 'SIGTERM') : undefined)).catch(() => undefined);
    kill = setTimeout(() => void started.then((s) => (s.status === 'started' ? host.signal(run, 'SIGKILL') : undefined)).catch(() => undefined), 2000);
  };
  const onStop = (): void => halt('stop');
  if (stop?.aborted) halt('stop');
  stop?.addEventListener('abort', onStop);
  let disarm = (): void => undefined;
  if (later) later.arm = (ms) => { disarm(); disarm = after(ms, () => halt('deadline')); };
  try {
    const s = await started;
    if (s.status !== 'started') return { code: null, cause, output: '', failed: `BLOCKED: no ${s.kind} free` };
    if (!later) disarm = after(deadline, () => halt('deadline'));
    const exit = await host.wait(run);
    await host.signal(run, 'SIGKILL').catch(() => undefined);
    return { code: exit.code, cause, output: Buffer.concat(chunks).toString('utf8'), failed: null };
  } catch (error) {
    return { code: null, cause, output: Buffer.concat(chunks).toString('utf8'), failed: error instanceof Error ? error.message : String(error) };
  } finally {
    disarm();
    clearTimeout(kill);
    stop?.removeEventListener('abort', onStop);
  }
}

interface PrestartOptions { host: Host; run: string; hosts: string[]; dir?: string; secrets?: Record<string, string>; stop?: AbortSignal }
/** A driver process started ahead of its job: it boots while the stack comes up, then waits for the job file. */
export interface Prestarted { dir: string; out: string; jobFile: string; running: Promise<DriverRun['exit']>; exited: () => boolean; /** Arms the run's deadline, from when its job is written. */ arm: (ms: number) => void; used: boolean }
export function prestart(o: PrestartOptions): Prestarted {
  const root = o.dir ?? join(tmpdir(), 'deep-journeys');
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, 'run-'));
  const out = join(dir, 'out');
  mkdirSync(out, { recursive: true });
  mkdirSync(join(dir, 'home'), { recursive: true });
  const jobFile = join(dir, 'job.json');
  const env: Record<string, string> = { DEEP_JOURNEY_JOB: jobFile, PLAYWRIGHT_BROWSERS_PATH: browsersPath() };
  for (const [name, value] of Object.entries(o.secrets ?? {})) env[`DEEP_JOURNEY_SECRET_${name}`] = value;
  let exited = false;
  // No deadline while the stack comes up: the stack's own ready wait bounds that, and a stack that never comes up cancels the driver.
  const later: { arm?: (ms: number) => void } = {};
  const running = hosted(o.host, o.run, [process.execPath, DRIVER], dirname(DRIVER), env, dir, o.hosts, 0, o.stop, later).finally(() => { exited = true; });
  return { dir, out, jobFile, running, exited: () => exited, arm: (ms) => later.arm?.(ms), used: false };
}
/** Tells a prestarted driver its job won't come (the stack never came up), and waits for it to go. */
export async function cancel(p: Prestarted): Promise<void> {
  writeFileSync(`${p.jobFile}.stop`, '');
  await p.running;
  discard(p);
}

interface DriveOptions { host: Host; run: string; job: Job; dir?: string; deadline: number; secrets?: Record<string, string>; stop?: AbortSignal; /** The driver already started for this run, waiting for its job. */ pre?: Prestarted; /** Runs beside the driver, with the run's folder, a reader of its report so far and whether the driver has exited: a planted environment's hook. */ between?: (out: string, report: () => Report | null, exited: () => boolean) => Promise<void> }
/** Runs the driver once: the report read back, and every file it wrote kept by digest. */
export async function drive(o: DriveOptions): Promise<DriverRun> {
  const p = o.pre ?? prestart({ host: o.host, run: o.run, hosts: [hostOf(o.job.url)], ...(o.dir ? { dir: o.dir } : {}), ...(o.secrets ? { secrets: o.secrets } : {}), ...(o.stop ? { stop: o.stop } : {}) });
  p.used = true;
  const { dir, out } = p;
  // Written whole, then renamed, so the waiting driver never reads half a job.
  writeFileSync(`${p.jobFile}.part`, JSON.stringify({ ...o.job, out }));
  renameSync(`${p.jobFile}.part`, p.jobFile);
  p.arm(o.deadline);
  const read = (): Report | null => { try { return JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')) as Report; } catch { return null; } };
  const started = Date.now();
  const between = o.between ? o.between(out, read, p.exited).catch(() => undefined) : Promise.resolve();
  // A driver that finished its report says so before it exits; its exit then overlaps storing what it wrote.
  let polling = true;
  const finished = (async (): Promise<DriverRun['exit'] | null> => {
    while (polling) { if (existsSync(join(out, 'done'))) return { code: 0, cause: 'exit', failed: null, output: '' }; await new Promise((r) => setTimeout(r, 5)); }
    return null;
  })();
  const exit = (await Promise.race([p.running, finished])) ?? (await p.running);
  polling = false;
  await between;
  const wallMs = Date.now() - started;
  const report = read();
  const artifacts: Artifact[] = [];
  const keep = (name: string, kind: Artifact['kind']): void => {
    const path = join(out, name);
    if (!existsSync(path)) return;
    const bytes = readFileSync(path);
    artifacts.push({ name, path, sha256: sha256(bytes), size: bytes.length, kind });
  };
  for (const f of readdirSync(out)) { if (f.endsWith('.png')) keep(f, 'png'); else if (f.endsWith('.webm')) keep(f, 'webm'); }
  keep('trace.zip', 'zip');
  keep('report.json', 'json');
  return { report, dir, out, artifacts, exit, wallMs, settled: p.running };
}
/** Removes a run's folder once its artifacts are in the store. */
export function discard(run: { dir: string }): void { rmSync(run.dir, { recursive: true, force: true }); }
