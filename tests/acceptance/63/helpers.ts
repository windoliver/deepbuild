// Test-side tools for the #63 acceptance tests: the environment cleanup, temp folders and a temp HOME with a fake
// Claude Code sign-in, the fake agent's installs (fixtures/fake-reader.pl) and what it reported, `deep find` and
// `deep read` as processes, the criterion IDs, and the reference-Mac gate with the timing judge. Nothing here stands
// in for what #63 builds: the tests reach the reading tools only through `deep read` / `deep find` (the built CLI)
// and reading jobs only through `@deepbuild/reading`'s public entry, loaded lazily in world.ts (README, The surface
// under test). The wrong programs are in wrong.ts; the criterion checks they are run through are in checks.ts.
//
// Safety: every folder is under /tmp/dh63-* (real paths) and removed after its file; HOME is a temp folder for this
// process and every child; the agent's own CLAUDE*, CODEX*, DEEP_*, ANTHROPIC_* and AI_AGENT variables are removed
// first; no test reads the real ~/.claude, ~/.codex or ~/.deepbuild; no network; no model is called; processes are
// stopped by PID only, those this suite started or that run a program from a folder it made, never by name or port.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type TestContext } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const NODE = process.execPath;
export const SECOND = 1000;
export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
/** The read cap (design: Reading by reference): "Output is capped per call, at 8,192 characters by default". */
export const CAP = 8192;
/**
 * The fake plan's 5-hour window, in tokens as the fake counts them (input + output, characters / 4). The plan is a
 * boundary these tests don't own; this size is this job's reading of the design's "212 sessions are read with 38
 * sub-reads, about 4% of one 5-hour window, instead of pasting millions of tokens" (README, Readings).
 */
export const WINDOW_TOKENS = 20_000_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

// ---- The environment: nothing of the agent running these tests.
for (const key of Object.keys(process.env)) {
  if (key.startsWith('CLAUDE') || key.startsWith('CODEX') || key.startsWith('DEEP_') || key.startsWith('ANTHROPIC_') || key === 'AI_AGENT') delete process.env[key];
}

/** The account Claude Code keeps beside the fake login (`oauthAccount.accountUuid` in ~/.claude.json). */
export const ACCOUNT = '6363aaaa-1111-4222-8333-444444444444';
const made: string[] = [];
export function tempDir(tag = 'w'): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh63-${tag}-`));
  made.push(dir);
  return dir;
}
/** HOME for this process and every child: a temp folder with a fake Claude Code sign-in (made-up values). */
export const HOME = tempDir('home');
process.env.HOME = HOME;
mkdirSync(join(HOME, '.claude'), { recursive: true });
writeFileSync(join(HOME, '.claude.json'), `${JSON.stringify({ oauthAccount: { accountUuid: ACCOUNT, emailAddress: 'dh63@example.invalid', organizationUuid: 'org-dh63' }, mcpServers: {}, projects: {} }, null, 2)}\n`);
writeFileSync(join(HOME, '.claude', '.credentials.json'), `${JSON.stringify({ claudeAiOauth: { accessToken: `sk-ant-oat01-dh63FAKE${'x'.repeat(40)}`, refreshToken: `sk-ant-ort01-dh63FAKE${'y'.repeat(40)}`, expiresAt: 4102444800000, scopes: ['user:inference'], subscriptionType: 'max' } })}\n`, { mode: 0o600 });
writeFileSync(join(HOME, '.claude', 'settings.json'), '{}\n');

// ---- Processes. Stopped by PID only: those running a program from a folder this test process made.
function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
  try { return !/Z/.test(execFileSync('/bin/ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })); } catch { return false; }
}
function processesNaming(needle: string): { pid: number; pgid: number }[] {
  const out = execFileSync('/bin/ps', ['-A', '-ww', '-o', 'pid=,pgid=,args='], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
  return out.split('\n').map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter((m): m is RegExpExecArray => m !== null)
    .filter((m) => m[3]!.includes(needle) && Number(m[1]) !== process.pid).map((m) => ({ pid: Number(m[1]), pgid: Number(m[2]) }));
}
/** Stops what runs from this file's temp folders (SIGTERM, then SIGKILL), by PID, then removes the folders. */
export async function cleanup(): Promise<void> {
  const pids = new Set<number>();
  for (const dir of made) for (const p of processesNaming(dir)) pids.add(p.pid);
  for (const pid of pids) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...pids].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of pids) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ---- IDs and handles.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function base32(value: bigint, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
export const ulid = (ms: number): string => base32(BigInt(ms), 10) + base32(BigInt(`0x${randomBytes(10).toString('hex')}`), 16);
/** A session ID as an agent writes it (a UUID), seeded so the corpus is the same on every run. */
export function seededUuid(seed: number): string {
  const h = sha256(`dh63 session ${seed}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
/** A session ID as a handle holds it: letters and digits only, as the hub's handles hold them. */
export const letters = (id: string): string => id.replace(/[^0-9A-Za-z]/g, '');
export const sessionHandle = (id: string): string => `session:${letters(id)}`;
export const messageHandle = (id: string, message: string): string => `${sessionHandle(id)}#${message}`;

// ---- Quotes as the issue compares them: NFC, each whitespace run one space (AC10). Nothing else.
export const norm = (text: string): string => text.normalize('NFC').replace(/\s+/g, ' ');

// ---- The fake agent, installed as a file named `claude` in a folder of its own.
export interface Planted { text: string; cites: { at: string; quote: string }[] }
/** Installs the fake; `planted` are findings every top-level run adds to its answer as they are (README, The fake agent). */
export function installFake(dir: string, o: { planted?: Planted[]; version?: string } = {}): string {
  mkdirSync(dir, { recursive: true });
  const text = readFileSync(join(FIXTURES, 'fake-reader.pl'), 'utf8')
    .replace('__VERSION__', o.version ?? '2.1.304')
    .replace('__PLANTED__', Buffer.from(JSON.stringify(o.planted ?? []), 'utf8').toString('base64'));
  const path = join(dir, 'claude');
  writeFileSync(`${path}.new`, text, { mode: 0o755 });
  chmodSync(`${path}.new`, 0o755);
  execFileSync('/bin/mv', ['-f', `${path}.new`, path]);
  return path;
}

// ---- What a fake printed (a job's stdout, as the runner read it).
export function streamOf(stdout: string): Line[] {
  return stdout.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l) as Line; } catch { return { unparsed: l }; } });
}
/** The fake's own reports (`system`/`fake` lines), in order. */
export const reportsOf = (stdout: string): Line[] => streamOf(stdout).filter((e) => e.type === 'system' && e.subtype === 'fake').map((e) => e.report as Line);
/** Every prompt one run of the fake was sent, by who wrote it: the job (its main context) and each sub-read's. */
export interface Prompt { who: string; text: string }
export function promptsOf(stdout: string): Prompt[] {
  const out: Prompt[] = [];
  for (const r of reportsOf(stdout)) {
    if (r.cmd === 'start') {
      out.push({ who: 'the job (system prompt, CLAUDE.md, stdin, argv)', text: [String(r.system ?? ''), ...((r.claude_md ?? []) as Line[]).map((c) => String(c.text)), String(r.stdin ?? ''), ...((r.argv ?? []) as string[])].join('\n') });
    }
    if (r.cmd === 'subread') out.push({ who: `sub-read ${String(r.task)}`, text: `${String(r.system ?? '')}\n${String(r.prompt ?? '')}` });
  }
  return out;
}
/** Every reply the fake got from a reading tool: the handle and slice it asked for and the text it was given. */
export interface Reply { task: string | null; args: { handle: string; slice?: string }; text: string; error: boolean; slice?: Line }
export function repliesOf(stdout: string): Reply[] {
  return reportsOf(stdout).filter((r) => r.cmd === 'reply').map((r) => {
    let slice: Line | undefined;
    try { slice = JSON.parse(String(r.text)) as Line; } catch { slice = undefined; }
    return { task: (r.task ?? null) as string | null, args: r.args as Reply['args'], text: String(r.text), error: Boolean(r.error), ...(slice ? { slice } : {}) };
  });
}
/** The models a run answered on: its main session's and its sub-agents'. */
export function modelsOf(stdout: string): { main?: string; subs: string[] } {
  const stream = streamOf(stdout);
  const main = stream.filter((e) => e.type === 'assistant' && !e.parent_tool_use_id).map((e) => String(e.message?.model)).pop();
  const subs = [...new Set(stream.filter((e) => e.type === 'assistant' && e.parent_tool_use_id).map((e) => String(e.message?.model)))];
  return { ...(main ? { main } : {}), subs };
}
/** The tokens a run spent, as its messages report them: input + output, once per message ID (the facts' counting). */
export function tokensOf(stdout: string): number {
  const seen = new Set<string>();
  let total = 0;
  for (const e of streamOf(stdout)) {
    if (e.type !== 'assistant' || !e.message?.usage) continue;
    const id = String(e.message.id);
    if (seen.has(id)) continue;
    seen.add(id);
    const u = e.message.usage as Line;
    total += Number(u.input_tokens ?? 0) + Number(u.cache_creation_input_tokens ?? 0) + Number(u.output_tokens ?? 0);
  }
  return total;
}
/** The answer a run returned, as the fake reported it. */
export const answerOf = (stdout: string): Line | undefined => reportsOf(stdout).find((r) => r.cmd === 'answer');

// ---- `deep find` and `deep read`, as processes on the built CLI (README: How to run builds it).
export interface Ran { status: number | null; stdout: string; stderr: string; ms: number }
/** Runs `deep <args>` with HOME a fresh empty folder, so nothing of an agent's own files is in reach by HOME. */
export function deep(args: readonly string[], o: { env?: Record<string, string> } = {}): Ran {
  const home = realpathSync(mkdtempSync('/tmp/dh63-clihome-'));
  const t0 = performance.now();
  const r = spawnSync(NODE, [CLI, ...args], { encoding: 'utf8', maxBuffer: 64 << 20, timeout: 60_000, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: home, LANG: 'en_US.UTF-8', ...o.env } });
  const ms = performance.now() - t0;
  rmSync(home, { recursive: true, force: true });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', ms };
}
/** reading.slice@1 (README): what `deep read --json` prints. */
export interface SliceJson {
  handle: string;
  covers: string;
  text: string;
  next?: string;
  messages?: { at: string; role: string; outside: boolean; tool?: string; start: number; end: number }[];
}
/** `deep read <handle> --slice [<cursor>] --json --root <root>`, parsed; fails the test, naming the handle, when it can't be. */
export function readSlice(root: string, handle: string, cursor?: string): SliceJson {
  const r = deep(['read', handle, '--slice', ...(cursor === undefined ? [] : [cursor]), '--json', '--root', root]);
  expect(r.status, `deep read ${handle} --slice ${cursor ?? ''} exits 0: ${r.stderr}`).toBe(0);
  let parsed: SliceJson;
  try { parsed = JSON.parse(r.stdout) as SliceJson; } catch { throw Error(`deep read ${handle} --json printed no JSON: ${r.stdout.slice(0, 500)}`); }
  return parsed;
}
/** Every slice of a handle, following `next` from the first; their texts joined are what the handle names. */
export function readAll(root: string, handle: string): { slices: SliceJson[]; text: string } {
  const slices: SliceJson[] = [readSlice(root, handle)];
  while (slices[slices.length - 1]!.next !== undefined) {
    expect(slices.length, `deep read ${handle}: a reply's next leads on, never round in circles`).toBeLessThan(200);
    slices.push(readSlice(root, handle, slices[slices.length - 1]!.next));
  }
  return { slices, text: slices.map((s) => s.text).join('') };
}

// ---- Criterion IDs: `#63.<first 8 hex of the SHA-256 of the criterion's text>` (scripts/proof-change.mjs).
export const AC = {
  1: '#63.f697c796', 2: '#63.084da449', 3: '#63.52524f64', 4: '#63.e6ad4b93', 5: '#63.69997dd3',
  6: '#63.d01b86b0', 7: '#63.b0064604', 8: '#63.82892e51', 9: '#63.d3ce9787', 10: '#63.46c00344',
} as const;

// ---- The reference Macs (design: The reference Macs), as #20's budgets read them.
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' } }).trim();
/** Why this machine's timings are a reading only, or null on a reference Mac in a fit state. */
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = sh('/usr/sbin/sysctl', '-n', 'hw.model');
    chip = sh('/usr/sbin/sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('/usr/sbin/sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = sh('/usr/bin/pmset', '-g', 'batt');
    power = sh('/usr/bin/pmset', '-g');
    therm = sh('/usr/bin/pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm || lpm[1] !== '0') return 'Low Power Mode on or unknown';
  if ([...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100) || !/No thermal warning level/.test(therm)) return 'thermal state not nominal';
  const one = Number(sh('/usr/sbin/sysctl', '-n', 'vm.loadavg').replace(/[{}]/g, '').trim().split(/\s+/)[0]);
  const cores = Number(sh('/usr/sbin/sysctl', '-n', 'hw.ncpu'));
  return one > cores ? `loaded past its core count: 1-minute load ${one.toFixed(1)} on ${cores} cores` : null;
}
/** PASS when every run is within the limit; FAIL when every run is over it by more than the margin; else INCONCLUSIVE. */
export function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const shown = `${name}: ${runs.map((r) => r.toFixed(1)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (runs.every((r) => r < limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}
