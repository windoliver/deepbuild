// Test-side tools of #3548's suite (README): temporary homes with stand-ins first on PATH, the built `deep` CLI as a
// child process, a hub started as the product starts it (`deep hub start`, a dev hub's or the login service's) and
// read through `deep hub status`, the planted writer inside it, the folder's size sampled while it writes, the logs
// read back a line at a time, logs made a chunk at a time, the debug bundle read back, a command's peak resident
// memory, and the forms a scrub-list value is printed in. Nothing here stands in for the hub or for
// `deep debug bundle`, and no file is ever held whole but the bundle, which is small where the work is right.
// Processes are stopped by PID only, never by name or port.

import { execFileSync, spawn } from 'node:child_process';
import {
  chmodSync, closeSync, copyFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, realpathSync,
  rmSync, statSync, writeFileSync, writeSync,
} from 'node:fs';
import net from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGunzip, gunzipSync } from 'node:zlib';
import { FIXED, fillAt, HEAD, lineOf, plantedIn } from './fixtures/lines.mjs';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const NODE = process.execPath;
export const MIB = 1024 * 1024;
/** The issue's three numbers, each read in the unit no right reading of it fails (README: Readings). */
export const LOGS_LIMIT = 64 * MIB;
export const CUT_LIMIT = 8 * MIB;
export const RESIDENT_LIMIT = 256 * MIB;
/** A text for a message or a kept run: the checkout as <checkout>, and a home folder, a test's own too, as ~. */
export const tidy = (text: string): string => text.replaceAll(REPO.replace(/\/$/, ''), '<checkout>').replace(/(?:\/private)?\/tmp\/dh3548-\w+\/h(?![\w.-])/g, '~').replaceAll(homedir(), '~');
export const mb = (bytes: number): string => `${(bytes / 1e6).toFixed(1)} MB (${bytes.toLocaleString('en-US')} bytes)`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const parse = (raw: string): Line | undefined => {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Line) : undefined;
  } catch {
    return undefined;
  }
};
/** What a test says when the build it runs is missing: never a pass. */
export function built(): void {
  if (!existsSync(CLI)) throw Error('BLOCKED: packages/cli/dist/main.js is missing; build the workspaces first (README: How to run)');
}

// ---- Waiting: on the event, in a loop with its own bound.
// deadline: paces a bounded poll for an event (a hub answering, a line landing, a process ending); each loop has its own bound, and its caller says what never came.
export const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
/** Polls until `probe` gives a value; undefined once `ms` have passed without one. */
export async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, ms: number): Promise<T | undefined> {
  const end = Date.now() + ms;
  for (;;) {
    const got = await probe();
    if (got) return got;
    if (Date.now() > end) return undefined;
    await pause(50);
  }
}

// ---- Temporary folders (short: a socket path must fit in 104 bytes on macOS) and the processes this suite started.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh3548-'));
  made.push(dir);
  return dir;
}
/** The commands this suite runs to their end, its own children; and the hubs it started, which are not. */
const owned = new Set<number>();
const hubs = new Set<number>();
/** A hub this suite started, by the PID its health gave: stopped at cleanup if that process is still a hub. */
export const own = (pid: number | undefined): void => { if (pid) hubs.add(pid); };
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
/**
 * The hubs this suite started that still run, whether or not a test got their PID: each process whose planted writer
 * answers on its socket, w-<pid>.sock, in a home's control folder. A socket nothing answers on is a hub that ended,
 * whose PID may be another process's by now, so it is left alone.
 */
async function hubsLeft(): Promise<number[]> {
  const found: number[] = [];
  for (const dir of made) {
    let names: string[] = [];
    try { names = readdirSync(join(dir, 'c')); } catch { continue; }
    for (const name of names) {
      const pid = Number(/^w-(\d+)\.sock$/.exec(name)?.[1]);
      if (!pid) continue;
      const answers = await new Promise<boolean>((resolve) => {
        const sock = net.connect(join(dir, 'c', name));
        sock.on('connect', () => { sock.destroy(); resolve(true); });
        sock.on('error', () => resolve(false));
      });
      if (answers) found.push(pid);
    }
  }
  return found;
}
/** Whether the process with this PID is a hub now, by its arguments: a PID a hub of ours had may be another process's since. */
function isHub(pid: number): boolean {
  try { return /\shub run(\s|$)/.test(execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' })); } catch { return false; }
}
/** Stops every process this suite started, by PID (SIGTERM, then SIGKILL once 10 s have passed), and removes its folders. */
export async function cleanup(): Promise<void> {
  const mine = [...new Set([...owned, ...await hubsLeft(), ...[...hubs].filter(isHub)])];
  for (const pid of mine) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  await until(() => !mine.some(alive), 10_000);
  for (const pid of mine) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  await until(() => !mine.some(alive), 5000);
  owned.clear();
  hubs.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ---- Homes. `<tmp>/h` is HOME for every process a test starts; `<tmp>/bin` comes first on PATH with the stand-ins;
// `<tmp>/c` is where the planted writer and the launcher keep what the test reads of them.
export interface Home { tmp: string; home: string; root: string; bin: string; ctl: string }
function newest(facts: string): string {
  try {
    const versions = (JSON.parse(readFileSync(join(REPO, facts), 'utf8')) as { versions?: string[] }).versions ?? [];
    return versions[versions.length - 1] ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
export function makeHome(): Home {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  const ctl = join(tmp, 'c');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(bin);
  mkdirSync(ctl);
  for (const name of ['claude', 'codex', 'launchctl', 'systemctl']) {
    copyFileSync(join(FIXTURES, 'agent-bin.sh'), join(bin, name));
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(bin, 'claude.version'), `${newest('adapters/claude-code.facts.json')}\n`);
  writeFileSync(join(bin, 'codex.version'), `${newest('adapters/codex.facts.json')}\n`);
  writeFileSync(join(bin, 'claude.auth'), `${JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'max' })}\n`);
  writeFileSync(join(bin, 'codex.login'), 'Logged in using ChatGPT\n');
  return { tmp, home, root: join(home, '.deepbuild'), bin, ctl };
}
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/** This process's environment with no DEEP_, CLAUDE*, CODEX*, billing or NODE_OPTIONS variable of its own. */
export function bareEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|CLAUDE|CODEX|TMUX|OTEL_)/.test(key) || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  return env;
}
/** HOME the test's home and the stand-ins first on PATH, over bareEnv(); `extra` sets what a test needs. */
export function childEnv(h: Home, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env = bareEnv();
  for (const key of Object.keys(env)) if (key.startsWith('XDG_')) delete env[key];
  Object.assign(env, {
    HOME: h.home, XDG_CONFIG_HOME: join(h.home, '.config'), XDG_CACHE_HOME: join(h.home, '.cache'), SHELL: '/bin/sh', LC_ALL: 'C',
    PATH: `${h.bin}:${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`,
  });
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }
const KEEP = 1 << 20;
/** Runs a command to its end, in a process group of its own, keeping the last megabyte of what it printed. */
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    if (child.pid) owned.add(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => { stdout = (stdout + d).slice(-KEEP); });
    child.stderr.setEncoding('utf8').on('data', (d: string) => { stderr = (stderr + d).slice(-KEEP); });
    // deadline: a command that never ends is stopped with the processes it started, so its test fails on what it printed instead of hanging.
    const timer = setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* gone */ } }, o.timeoutMs ?? 120_000);
    const end = (code: number | null, signal: NodeJS.Signals | null, more = ''): void => {
      clearTimeout(timer);
      if (child.pid) owned.delete(child.pid);
      resolve({ code, signal, stdout, stderr: stderr + more });
    };
    child.on('error', (error) => end(null, null, `\n${String(error)}`));
    child.on('close', (code, signal) => end(code, signal));
  });
}
/** `deep <args>` from the built CLI, as a person runs it: a child of this test process, under no agent. */
export const deep = (h: Home, args: readonly string[], o: { env?: Record<string, string | undefined>; timeoutMs?: number } = {}): Promise<Ran> =>
  run(NODE, [CLI, ...args], { env: childEnv(h, o.env), timeoutMs: o.timeoutMs ?? 120_000 });
export const shown = (r: Ran): string => tidy(`exit ${r.code}${r.signal ? ` (${r.signal})` : ''}; stdout: ${r.stdout.slice(-1500)}\nstderr: ${r.stderr.slice(-2500)}`);

// ---- The hub, started as the product starts it and read through `deep hub status`.
/** The PID in the health of the hub that answers `deep hub status [--root <root>]`; undefined when none answers. */
export async function hubPid(h: Home, root?: string): Promise<number | undefined> {
  const r = await deep(h, ['hub', 'status', ...(root ? ['--root', root] : [])], { timeoutMs: 60_000 });
  const pid: unknown = r.code === 0 ? parse(r.stdout.trim().split('\n').at(-1) ?? '')?.pid : undefined;
  return typeof pid === 'number' ? pid : undefined;
}
/** Waits until no process has the PID; false when it still runs after `ms`. */
export async function gone(pid: number, ms: number): Promise<boolean> {
  const ended = (await until(() => !alive(pid), ms)) === true;
  if (ended) hubs.delete(pid);
  return ended;
}
/** The end of what the files under a folder hold, for a failure's message. */
export function tail(dir: string, bytes = 1500): string {
  return files(dir).map((path) => {
    const size = statSync(path, { throwIfNoEntry: false })?.size ?? 0;
    const buffer = Buffer.alloc(Math.min(bytes, size));
    const fd = openSync(path, 'r');
    try { readSync(fd, buffer, 0, buffer.length, size - buffer.length); } finally { closeSync(fd); }
    return tidy(`${path}: …${buffer.toString('latin1')}`);
  }).join('\n') || tidy(`${dir} holds no file`);
}

// ---- The planted writer (fixtures/writer.mjs), loaded into the hub's process through the environment it starts from.
export const writerEnv = (h: Home): Record<string, string> => ({ NODE_OPTIONS: `--import=${pathToFileURL(join(FIXTURES, 'writer.mjs')).href}`, DEEP_3548_CTL: h.ctl });
export const newTag = (): string => Math.floor(Math.random() * 2 ** 32).toString(16).padStart(8, '0');
export interface Wrote { pid: number; from: number; to: number; bytes: number; lines: number }
/** Has the writer inside the hub `pid` write `bytes` of planted lines numbered from `from`; resolves once they were written. */
export async function write(h: Home, pid: number, ask: { tag: string; from: number; bytes: number }, ms = 900_000): Promise<Wrote> {
  const path = join(h.ctl, `w-${pid}.sock`);
  if (!(await until(() => existsSync(path), 30_000))) throw Error(`BLOCKED: the planted writer isn't in the hub ${pid}: it made no ${path} (NODE_OPTIONS=--import didn't reach the hub's process)`);
  return new Promise((resolve, reject) => {
    const sock = net.connect(path);
    let text = '';
    // deadline: a writer that never answers fails its test, naming the hub and the bytes asked for, instead of hanging it.
    const timer = setTimeout(() => sock.destroy(Error(`no answer within ${ms} ms`)), ms);
    sock.setEncoding('utf8');
    sock.on('connect', () => sock.write(`${JSON.stringify(ask)}\n`));
    sock.on('data', (d: string) => { text += d; });
    sock.on('error', (error) => { clearTimeout(timer); reject(Error(`BLOCKED: the planted writer in the hub ${pid}, asked for ${ask.bytes} bytes: ${error.message}`)); });
    sock.on('close', () => {
      clearTimeout(timer);
      const reply = parse(text.trim());
      if (reply && typeof reply.to === 'number' && typeof reply.bytes === 'number') resolve(reply as Wrote);
      else reject(Error(`BLOCKED: the planted writer in the hub ${pid}, asked for ${ask.bytes} bytes, answered ${JSON.stringify(text.slice(0, 600))}`));
    });
  });
}

// ---- A folder's size, and its size while a hub writes.
/** Every file under a folder; one that goes while it is listed is left out. */
export function files(dir: string): string[] {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries.flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.isFile() ? [join(dir, e.name)] : []));
}
export interface Size { bytes: number; files: number }
/** The bytes the files under a folder hold, by each file's length. */
export function folderSize(dir: string): Size {
  let bytes = 0;
  let count = 0;
  for (const path of files(dir)) {
    const stat = statSync(path, { throwIfNoEntry: false });
    if (!stat) continue;
    bytes += stat.size;
    count++;
  }
  return { bytes, files: count };
}
export interface Watched { peak: Size; samples: number }
/** Reads the folder's size every `everyMs` until stopped: the largest reading and how many were taken. */
export function watchFolder(dir: string, everyMs = 20): { stop(): Watched } {
  let peak: Size = { bytes: 0, files: 0 };
  let samples = 0;
  const read = (): void => {
    const now = folderSize(dir);
    samples++;
    if (now.bytes > peak.bytes) peak = now;
  };
  read();
  // deadline: the criterion's "throughout": the folder is read every 20 ms for as long as the hub writes, until the test stops the reading.
  const timer = setInterval(read, everyMs);
  timer.unref();
  return { stop: () => { clearInterval(timer); read(); return { peak, samples }; } };
}

// ---- The logs read back, a line at a time.
/** Each line of a file, without its line end, a megabyte of the file at a time; gzip is inflated on the way. */
async function eachLine(path: string, on: (line: string) => void): Promise<void> {
  const head = Buffer.alloc(2);
  const fd = openSync(path, 'r');
  let got = 0;
  try { got = readSync(fd, head, 0, 2, 0); } finally { closeSync(fd); }
  const raw = createReadStream(path, { highWaterMark: MIB });
  const stream = got === 2 && head[0] === 0x1f && head[1] === 0x8b ? raw.pipe(createGunzip()) : raw;
  let carry = '';
  for await (const chunk of stream) {
    const text = carry + (chunk as Buffer).toString('latin1');
    let from = 0;
    for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', from)) {
      on(text.slice(from, at));
      from = at + 1;
    }
    carry = text.slice(from);
  }
  if (carry) on(carry);
}
export interface LogReading {
  files: { path: string; bytes: number; lines: number; planted: number }[];
  bytes: number;
  /** Whole planted lines of the run, each number counted once; the lowest and highest number, -1 with none. */
  planted: number;
  first: number;
  last: number;
  /** Numbers between `first` and `last` that are not there: how many, and the first few. */
  missing: number;
  missingFirst: number[];
  /** Lines holding a part of a planted line beside no whole one, or beside one: how many, and the first few. */
  cut: number;
  cutFirst: { file: string; line: number; text: string }[];
  has(number: number): boolean;
}
/** What the files under `dir` hold of the run's planted lines, numbered up to `upTo`. */
export async function readLogs(dir: string, tag: string, upTo: number): Promise<LogReading> {
  const seen = new Uint8Array(upTo + 2);
  const reading: LogReading = { files: [], bytes: 0, planted: 0, first: -1, last: -1, missing: 0, missingFirst: [], cut: 0, cutFirst: [], has: (n) => seen[n] === 1 };
  for (const path of files(dir).sort()) {
    const file = { path, bytes: statSync(path, { throwIfNoEntry: false })?.size ?? 0, lines: 0, planted: 0 };
    try {
      await eachLine(path, (line) => {
        file.lines++;
        const { whole, part } = plantedIn(line, tag);
        for (const n of whole) if (n <= upTo + 1 && seen[n] !== 1) { seen[n] = 1; file.planted++; }
        if (part) {
          reading.cut++;
          if (reading.cutFirst.length < 5) reading.cutFirst.push({ file: tidy(path), line: file.lines, text: line.length > 130 ? `${line.slice(0, 90)}…${line.slice(-30)}` : line });
        }
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    reading.files.push(file);
    reading.bytes += file.bytes;
    reading.planted += file.planted;
  }
  for (let n = 0; n < seen.length; n++) {
    if (seen[n] !== 1) continue;
    if (reading.first < 0) reading.first = n;
    reading.last = n;
  }
  for (let n = reading.first; n >= 0 && n < reading.last; n++) {
    if (seen[n] === 1) continue;
    reading.missing++;
    if (reading.missingFirst.length < 5) reading.missingFirst.push(n);
  }
  return reading;
}
export const filesShown = (reading: LogReading): string => tidy(reading.files.map((f) => `${f.path} ${mb(f.bytes)}, ${f.planted} planted lines`).join('; ')) || 'no file';

// ---- A log made a chunk at a time, and where each of its lines is.
export interface Layout {
  path: string;
  tag: string;
  count: number;
  bytes: number;
  /** Line `number` as the file holds it, without its line end. */
  line(number: number): string;
  /** Where line `number` starts in the file; `count` gives the file's size. */
  offset(number: number): number;
  /** The number of the line that reads exactly `text`, or -1. */
  numberOf(text: string): number;
}
/**
 * Writes `path` as planted lines numbered from 0 until it holds at least `bytes`, each line's fill `least` to
 * `least + 210` characters. With `even`, every line and its line end is an even number of bytes; `lastExtra` makes
 * the last line that many bytes longer. `swap` gives other text for some lines, each as long as the line it replaces.
 */
export function makeLog(path: string, o: { tag: string; bytes: number; least?: number; even?: boolean; lastExtra?: number; swap?: ReadonlyMap<number, string> }): Layout {
  const fillBefore = (n: number): number => (o.even ? fillAt(n, o.least) | 1 : fillAt(n, o.least));
  const starts = [0];
  for (let r = 0; r < 211; r++) starts.push(starts[r]! + FIXED + fillBefore(r));
  const period = starts[211]!;
  const plain = (n: number): number => Math.floor(n / 211) * period + starts[n % 211]!;
  let count = Math.floor(o.bytes / period) * 211;
  while (plain(count) < o.bytes) count++;
  const extra = o.lastExtra ?? 0;
  const fill = (n: number): number => fillBefore(n) + (n === count - 1 ? extra : 0);
  const line = (n: number): string => o.swap?.get(n) ?? lineOf(o.tag, n, fill(n));
  const offset = (n: number): number => plain(n) + (n >= count ? extra : 0);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fd = openSync(path, 'w', 0o600);
  try {
    let chunk: string[] = [];
    let held = 0;
    for (let n = 0; n < count; n++) {
      const text = line(n);
      if (text.length !== FIXED - 1 + fill(n)) throw Error(`BLOCKED: line ${n} given to makeLog is ${text.length} bytes, not the ${FIXED - 1 + fill(n)} of the line it replaces`);
      chunk.push(text);
      held += text.length + 1;
      if (held >= 4 * MIB || n === count - 1) {
        writeSync(fd, `${chunk.join('\n')}\n`, null, 'latin1');
        chunk = [];
        held = 0;
      }
    }
  } finally {
    closeSync(fd);
  }
  const numberOf = (text: string): number => {
    if (!text.startsWith(`${HEAD}[[3548:${o.tag}:`)) return -1;
    const n = Number(text.slice(HEAD.length + 16, HEAD.length + 25));
    return Number.isInteger(n) && n >= 0 && n < count && text === line(n) ? n : -1;
  };
  return { path, tag: o.tag, count, bytes: offset(count), line, offset, numberOf };
}

// ---- `deep debug bundle`, run and read back.
export interface Bundled { ran: Ran; path: string | undefined; peakBytes: number | undefined }
/** `time` with the flag that prints the peak resident memory, where this system has one. */
const timed = (): string[] | undefined => (!existsSync('/usr/bin/time') ? undefined : process.platform === 'darwin' ? ['/usr/bin/time', '-l'] : process.platform === 'linux' ? ['/usr/bin/time', '-v'] : undefined);
/**
 * `deep debug bundle` with HOME the test's home: what it printed, the file whose path it printed last where that is a
 * file, and with `measure` its peak resident memory in bytes as `time` read it (undefined where it couldn't).
 */
export async function bundle(h: Home, env: Record<string, string | undefined> = {}, o: { measure?: boolean; timeoutMs?: number } = {}): Promise<Bundled> {
  const under = o.measure ? timed() : undefined;
  const args = [CLI, 'debug', 'bundle'];
  const ran = under ? await run(under[0]!, [...under.slice(1), NODE, ...args], { env: childEnv(h, env), timeoutMs: o.timeoutMs ?? 300_000 })
    : await run(NODE, args, { env: childEnv(h, env), timeoutMs: o.timeoutMs ?? 300_000 });
  const last = ran.stdout.trim().split('\n').at(-1) ?? '';
  const path = last.startsWith('/') && statSync(last, { throwIfNoEntry: false })?.isFile() ? last : undefined;
  const mac = /^\s*(\d+)\s+maximum resident set size/m.exec(ran.stderr);
  const gnu = /Maximum resident set size \(kbytes\):\s*(\d+)/.exec(ran.stderr);
  return { ran, path, peakBytes: mac ? Number(mac[1]) : gnu ? Number(gnu[1]) * 1024 : undefined };
}
/** The string-length error a command ended on, as Node words it, or undefined. */
export const stringLengthError = (ran: Ran): string | undefined => /Cannot create a string longer than [^\n]*|Invalid string length/.exec(`${ran.stderr}\n${ran.stdout}`)?.[0];

export interface Bundle { path: string; bytes: number; tooBig: boolean; text: string; json: unknown; strings: string[]; numbers: number[] }
/** The most a bundle may inflate to and still be read here: a bundle that holds the end of each log is far under it. */
const BUNDLE_MOST = 128 * MIB;
/**
 * The bundle read back: its bytes inflated when gzip, and when it is JSON (one text, or one a line) every string and
 * number in it. One that inflates past 128 MiB is `tooBig` and read no further.
 */
export function readBundle(path: string): Bundle {
  const bytes = readFileSync(path);
  let inflated: Buffer;
  try {
    inflated = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes, { maxOutputLength: BUNDLE_MOST }) : bytes;
  } catch {
    return { path, bytes: bytes.length, tooBig: true, text: '', json: undefined, strings: [], numbers: [] };
  }
  if (inflated.length > BUNDLE_MOST) return { path, bytes: bytes.length, tooBig: true, text: '', json: undefined, strings: [], numbers: [] };
  const text = inflated.toString('utf8');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    try { json = text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as unknown); } catch { json = undefined; }
  }
  const strings: string[] = [];
  const numbers: number[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      strings.push(v);
      // A value JSON holds as text of its own is read too.
      if (/^\s*[[{]/.test(v)) try { walk(JSON.parse(v)); } catch { /* not JSON */ }
    } else if (typeof v === 'number') numbers.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { strings.push(k); walk(x); }
  };
  walk(json);
  return { path, bytes: bytes.length, tooBig: false, text, json, strings, numbers };
}
/**
 * The bundle's text of the log whose last line is `lastLine`: the longest string in the bundle that holds that line,
 * or, where the bundle keeps a log as a list of its lines, that list joined by line ends. Undefined when no string
 * holds the line.
 */
export function logText(b: Bundle, lastLine: string): string | undefined {
  const found: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (v.includes(lastLine)) found.push(v);
      else if (/^\s*[[{]/.test(v)) try { walk(JSON.parse(v)); } catch { /* not JSON */ }
    } else if (Array.isArray(v)) {
      const lines = v.length > 1 && v.every((x) => typeof x === 'string') ? (v as string[]) : undefined;
      if (lines?.some((x) => x.includes(lastLine))) found.push(lines.every((x) => x.endsWith('\n')) ? lines.join('') : lines.join('\n'));
      else v.forEach(walk);
    } else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(b.json);
  return found.sort((a, c) => c.length - a.length)[0];
}
/** Whether a text holds the count `n` as its digits, with or without separators between its thousands, and no digit beside them. */
const countIn = (text: string, n: number): boolean => new RegExp(`(^|[^0-9])${n}([^0-9]|$)`).test(text.replace(/(\d)[,_\u00a0\u202f ](?=\d{3}(\D|$))/g, '$1'));
/** Whether the bundle states the count `n`: as a number, or in a string of 4,096 characters or fewer as its digits. */
export function states(b: Bundle, n: number): boolean {
  return b.numbers.includes(n) || b.strings.some((s) => s.length <= 4096 && countIn(s, n));
}

export interface Cut {
  /** The first line of the log the text holds whole, and the line of the text it is. */
  first: number;
  /** The bytes of the log before the text's first byte of it: what the bundle left out. */
  leftOut: number;
  /** The bytes of the log the text holds. */
  kept: number;
  /** The text's first characters when it starts inside a line of the log or on a line's end; undefined when it starts at a line's start. */
  midLine: string | undefined;
  /** How many bytes of the line before `first` the text holds, its line end counted: 0 when it starts at a line's start. */
  fragment: number;
  /** The text runs to the log's last line. */
  toEnd: boolean;
  /** The first line after `first` that isn't the log's next line, as the text has it; undefined when every one is. */
  differs: { number: number; got: string } | undefined;
  /** What the text holds before its first byte of the log: nothing, or lines of the bundle's own, such as a notice. */
  preamble: string;
}
/**
 * Where a bundle's text of a made log starts, read from the text itself: its first whole line of the log, what comes
 * before that line in the text (nothing, lines of the bundle's own such as a notice, or the end of the log's line
 * before, which is a text that starts mid-line), and whether the lines from there on are the log's, in order, to its
 * last. Lines `swap` replaced are not compared: the scrub changes them. Undefined when the text holds no whole line.
 */
export function readCut(layout: Layout, text: string, swapped: ReadonlySet<number> = new Set()): Cut | undefined {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const at = lines.findIndex((l) => layout.numberOf(l) >= 0);
  if (at < 0) return undefined;
  const first = layout.numberOf(lines[at]!);
  const before = at > 0 ? lines[at - 1]! : undefined;
  const lineBefore = first > 0 ? layout.line(first - 1) : '';
  // The end of the log's line before, or its line end alone: the cut fell inside that line.
  const part = before !== undefined && before.length < lineBefore.length && lineBefore.endsWith(before) && (before !== '' || at === 1);
  const stray = lines.slice(0, at).some((l) => plantedIn(l, layout.tag).part);
  const fragment = part ? before.length + 1 : 0;
  const leftOut = layout.offset(first) - fragment;
  let differs: Cut['differs'];
  for (let i = at + 1, n = first + 1; i < lines.length && !differs; i++, n++) {
    if (swapped.has(n)) continue;
    if (n >= layout.count || lines[i] !== layout.line(n)) differs = { number: n, got: lines[i]!.slice(0, 120) };
  }
  return {
    first, leftOut, kept: layout.bytes - leftOut, fragment, differs,
    preamble: lines.slice(0, part ? at - 1 : at).join('\n'),
    midLine: part || stray ? text.slice(0, 80) : undefined,
    toEnd: !differs && first + (lines.length - 1 - at) === layout.count - 1,
  };
}

export interface Held { name: string; layout: Layout; text: string | undefined; cut: Cut | undefined; stated: boolean }
/**
 * What a bundle holds of a made log: its text of it, where that text starts, and whether the bundle states the bytes
 * it left out, anywhere in it or in what the text holds before the log's first line there.
 */
export function heldOf(b: Bundle, name: string, layout: Layout, swapped?: ReadonlySet<number>): Held {
  const text = logText(b, layout.line(layout.count - 1));
  const cut = text === undefined ? undefined : readCut(layout, text, swapped);
  return { name, layout, text, cut, stated: cut !== undefined && (states(b, cut.leftOut) || countIn(cut.preamble.slice(0, 4096), cut.leftOut)) };
}

// ---- The forms a scrub-list value is printed in (design: Privacy), as tests/acceptance/19/status's sweep has them:
// raw, URL-encoded with either case of hex, and base64 after 0, 1 or 2 leading bytes in both alphabets, each as the
// core that depends on the value alone.
export interface Form { name: string; text: string }
const urlEncode = (value: string, upper: boolean): string => [...Buffer.from(value, 'utf8')].map((b) => {
  const ch = String.fromCharCode(b);
  if (/[A-Za-z0-9\-_.~]/.test(ch)) return ch;
  const h = b.toString(16).padStart(2, '0');
  return `%${upper ? h.toUpperCase() : h}`;
}).join('');
export function everyForm(value: string): Form[] {
  const bytes = Buffer.from(value, 'utf8');
  const forms: Form[] = [
    { name: 'raw', text: value },
    { name: 'URL-encoded, upper-case hex', text: urlEncode(value, true) },
    { name: 'URL-encoded, lower-case hex', text: urlEncode(value, false) },
  ];
  for (const k of [0, 1, 2]) {
    const std = Buffer.concat([Buffer.from('r:'.slice(2 - k)), bytes]).toString('base64');
    const core = std.slice(Math.ceil((8 * k) / 6), Math.floor((8 * (k + bytes.length)) / 6));
    forms.push({ name: `base64 at offset ${k}`, text: core });
    forms.push({ name: `base64url at offset ${k}`, text: core.replace(/\+/g, '-').replace(/\//g, '_') });
  }
  return forms.filter((f, i) => f.text.length >= 8 && forms.findIndex((g) => g.text === f.text) === i);
}
export interface Canary { name: string; forms: Form[] }
/**
 * The sweep: each file read as bytes, inflated too when gzip, and as every string in it when it is JSON, searched for
 * every form of every canary. One line a hit, `<file>: <canary> (<form>)`, and how many files it searched.
 */
export function sweep(paths: readonly string[], canaries: readonly Canary[]): { hits: string[]; searched: number } {
  const hits: string[] = [];
  let searched = 0;
  for (const path of [...new Set(paths)]) {
    let bytes: Buffer;
    try { bytes = readFileSync(path); } catch { continue; }
    searched++;
    let text = bytes.toString('latin1');
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      try { text += `\n${gunzipSync(bytes).toString('latin1')}\n${readBundle(path).strings.join('\n')}`; } catch { /* a cut gzip: its bytes are searched as they are */ }
    }
    for (const c of canaries) for (const f of c.forms) if (text.includes(f.text)) hits.push(`${tidy(path)}: ${c.name} (${f.name})`);
  }
  return { hits, searched };
}
