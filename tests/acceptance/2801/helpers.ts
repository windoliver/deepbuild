// #2801's acceptance helpers: a dev hub started with the `deep` CLI of this checkout (`deep hub start --root`), in a
// scratch home and root under the system's temp folder, whose core start the test holds open for as long as it needs
// (README, How the startup window is held), and the hub's socket read the way `deep hub status` reads it.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, constants, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, unlinkSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Obj = { [key: string]: any };

/** The hub's core stops at start without a built deep-hook (`cargo build --locked -p deep-hook`); no test runs without it. */
export function requireDeepHook(): void {
  const target = process.env.CARGO_TARGET_DIR ?? join(REPO, 'target');
  if (!['debug', 'release'].some((p) => existsSync(join(target, p, 'deep-hook')))) throw Error(`BLOCKED: no deep-hook is built under ${target}; run cargo build --locked -p deep-hook first`);
}

// ---- Scratch folders and processes: everything this suite made, removed or stopped by cleanup().
const made: string[] = [];
const roots: { home: string; root: string }[] = [];
const holds: Hold[] = [];

/** A scratch home and a dev root inside it, under the system's temp folder (short, for the socket's path limit). */
export function scratch(): { home: string; root: string } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'dh2801-')));
  made.push(dir);
  const home = join(dir, 'h');
  const root = join(dir, 'r');
  mkdirSync(home, { mode: 0o700 });
  mkdirSync(root, { mode: 0o700 });
  roots.push({ home, root });
  return { home, root };
}

/** The environment a `deep` command gets: this machine's, with HOME the scratch home and no DEEP_ or XDG_ setting. */
export function childEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  env.HOME = home;
  env.XDG_CONFIG_HOME = join(home, '.config');
  env.XDG_CACHE_HOME = join(home, '.cache');
  env.LC_ALL = 'C';
  return env;
}

export interface Ran { code: number | null; stdout: string; stderr: string; began: number; ended: number }
/** `deep <args>` from this checkout (`node packages/cli/dist/main.js`), as a child process; never throws. */
export function deep(home: string, args: readonly string[], timeoutMs = 120_000): Promise<Ran> {
  return new Promise((resolve) => {
    const began = Date.now();
    const child = spawn(NODE, [CLI, ...args], { cwd: REPO, env: childEnv(home), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d: string) => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, began, ended: Date.now() }); });
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}${error.message}`, began, ended: Date.now() }); });
  });
}

// ---- How the startup window is held (README). Two files the core reads while it starts are made named pipes
// (FIFOs): <root>/evidence/records.jsonl, the evidence journal it reads before the record is open (a read that leaves
// the core's thread free), and <root>/transcripts.json, the transcript cursors it reads once the record is open (a
// read that holds the core's thread). A reader of a FIFO waits until the test opens it for writing and closes it:
// until then that step of the start doesn't end. Released, the path is unlinked first, so the file is simply absent,
// as in a fresh root, for every later read or write.

export interface Hold {
  path: string;
  /** When a reader (the hub) first opened the FIFO, or undefined while none has. */
  readerAt: number | undefined;
  releasedAt: number | undefined;
  /** Resolves when a reader opened it. */
  reader: Promise<number>;
  release(): void;
}
/** Makes `path` a FIFO and watches for its reader; release() lets the read end with no content. */
export function hold(path: string): Hold {
  mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 });
  const made = spawnSync('/usr/bin/mkfifo', ['-m', '600', path], { encoding: 'utf8' });
  if (made.status !== 0) throw Error(`BLOCKED: mkfifo ${path} failed: ${made.stderr}`);
  let fd: number | undefined;
  let arrived!: (at: number) => void;
  const h: Hold = {
    path, readerAt: undefined, releasedAt: undefined,
    reader: new Promise<number>((done) => { arrived = done; }),
    release: () => {
      if (h.releasedAt !== undefined) return;
      h.releasedAt = Date.now();
      clearInterval(watch);
      try { unlinkSync(path); } catch { /* already gone */ }
      if (fd !== undefined) closeSync(fd);
    },
  };
  // A writer's non-blocking open succeeds only once a reader has the FIFO open (ENXIO before): that is the reader's
  // arrival. The writer stays open, so the reader's read waits for the release.
  const watch = setInterval(() => {
    try {
      fd = openSync(path, constants.O_WRONLY | constants.O_NONBLOCK);
    } catch {
      return;
    }
    clearInterval(watch);
    h.readerAt = Date.now();
    arrived(h.readerAt);
  }, 5);
  holds.push(h);
  return h;
}
/** The two holds of README, How the startup window is held, made in `root` before the hub starts. */
export function holdStart(root: string): { evidence: Hold; transcripts: Hold } {
  return { evidence: hold(join(root, 'evidence', 'records.jsonl')), transcripts: hold(join(root, 'transcripts.json')) };
}

// ---- The hub's socket, read as `deep hub status` reads it (packages/hub/src/service.ts, control): its hello, the
// CLI's hello with the control token, then one call.

export type Outcome =
  | { kind: 'answer'; result: Obj }
  | { kind: 'refusal'; error: Obj }
  | { kind: 'none'; why: string };
export interface Probe { method: string; sent: number; settled: number; outcome: Outcome }

/** One control call on `root`'s socket as the cli role; 'none' when no answer came within `timeoutMs` or no hub listened. */
export function probe(root: string, method: string, params: Obj, timeoutMs: number): Promise<Probe> {
  const sent = Date.now();
  return new Promise((resolve) => {
    let token: string;
    try {
      token = readFileSync(join(root, 'control.token'), 'utf8').trim();
    } catch {
      return resolve({ method, sent, settled: Date.now(), outcome: { kind: 'none', why: 'no control token yet' } });
    }
    const sock = net.connect(join(root, 'hub.sock'));
    let buffer = '';
    let step = 0;
    let done = false;
    const finish = (outcome: Outcome) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      resolve({ method, sent, settled: Date.now(), outcome });
    };
    const timer = setTimeout(() => finish({ kind: 'none', why: `no answer within ${timeoutMs} ms (step ${step})` }), timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (error) => finish({ kind: 'none', why: error.message }));
    sock.on('close', () => finish({ kind: 'none', why: `the hub closed the connection (step ${step})` }));
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        let line: Obj;
        try {
          line = JSON.parse(buffer.slice(0, i)) as Obj;
        } catch {
          return finish({ kind: 'none', why: `a line that isn't JSON: ${buffer.slice(0, 200)}` });
        }
        buffer = buffer.slice(i + 1);
        if (step === 0) {
          step = 1;
          sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`);
        } else if (step === 1) {
          if (line.error) return finish({ kind: 'refusal', error: line.error as Obj });
          step = 2;
          sock.write(`${JSON.stringify({ v: 1, id: 'p', method, params })}\n`);
        } else if (line.id === 'p') {
          return finish(line.error ? { kind: 'refusal', error: line.error as Obj } : { kind: 'answer', result: line.result as Obj });
        }
      }
    });
  });
}

// ---- `deep hub status`'s output, sorted the way the issue's polling log reads it.

export type Try = { at: number; ms: number; code: number | null; kind: 'health' | 'refusal' | 'none'; text: string };
/** A `deep hub status` run: health (exit 0, one JSON line), a refusal ("<method> was refused: {...}") or no answer. */
export function classify(ran: Ran, t0: number): Try {
  const text = `${ran.stdout}${ran.stderr}`.trim().replace(/\s+/g, ' ').slice(0, 400);
  let health = false;
  if (ran.code === 0) {
    try { health = typeof (JSON.parse(ran.stdout.trim().split('\n').pop() ?? '') as Obj) === 'object'; } catch { health = false; }
  }
  const kind = health ? 'health' : /was refused: \{/.test(ran.stderr) ? 'refusal' : 'none';
  return { at: ran.began - t0, ms: ran.ended - ran.began, code: ran.code, kind, text };
}
export const showTries = (tries: Try[]) => tries.map((t, i) => `  try ${i + 1} at +${t.at} ms (${t.ms} ms): ${t.kind}, exit ${t.code}: ${t.text}`).join('\n');

/** The internal-error messages a refusal must never carry (the issue's TypeError and its kin). */
export const INTERNAL = /Cannot read propert|is not a function|is not defined|is not iterable|undefined|TypeError|ReferenceError|RangeError|SyntaxError|\bat .*\.js:\d+/;
/** Whether a refusal is the plain one AC1 allows: `unavailable`, its remediation naming the startup, no internal error. */
export function plainStartup(error: Obj): boolean {
  const remediation = String(error.remediation ?? '');
  return error.code === 'unavailable' && /\bstart/i.test(remediation) && !INTERNAL.test(JSON.stringify(error));
}

// ---- Stopping: every hold released, each hub this suite started stopped by `deep hub stop --root` and, if it still
// runs, by the PID its own ready line names; then the scratch folders removed. Nothing is stopped by name or port.

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function readyPid(root: string): number | undefined {
  try {
    for (const raw of readFileSync(join(root, 'logs', 'hub.log'), 'utf8').split('\n')) {
      try { const l = JSON.parse(raw) as Obj; if (l.ready === true && Number.isInteger(l.pid)) return l.pid as number; } catch { /* a line of text */ }
    }
  } catch { /* no log */ }
  return undefined;
}
/** The hub's log, for a failure's message. */
export const hubLog = (root: string): string => { try { return readFileSync(join(root, 'logs', 'hub.log'), 'utf8').slice(-2000); } catch { return '(no hub.log)'; } };

export async function cleanup(): Promise<void> {
  for (const h of holds.splice(0)) h.release();
  for (const { home, root } of roots.splice(0)) {
    if (!existsSync(join(root, 'hub.sock')) && !existsSync(join(root, 'control.token'))) continue;
    // Released, the core finishes starting; its ready line names the hub's PID.
    let pid = readyPid(root);
    for (let i = 0; i < 200 && pid === undefined && existsSync(join(root, 'hub.sock')); i++) { await sleep(100); pid = readyPid(root); }
    await deep(home, ['hub', 'stop', '--root', root], 60_000);
    if (pid !== undefined) {
      for (let i = 0; i < 100 && alive(pid); i++) await sleep(100);
      if (alive(pid)) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
      for (let i = 0; i < 50 && alive(pid); i++) await sleep(100);
      if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    }
  }
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}
